/* ============================================================================
   /api/sheets — 구글 시트 프록시 (Vercel 서버리스 함수)

   브라우저는 구글 시트를 직접 읽지 않는다. 시트를 비공개로 두려면 서비스 계정
   키가 필요한데, 그 키는 브라우저에 내려보내는 순간 공개되기 때문이다.
   그래서 이 함수만 키를 갖고, 브라우저는 Supabase 로그인 토큰을 들고 여기에 묻는다.

   필요한 환경변수 (Vercel → Settings → Environment Variables)
     SHEET_ID                 스프레드시트 ID (URL의 /d/<여기>/edit)
     GOOGLE_SA_EMAIL          서비스 계정 이메일 (...iam.gserviceaccount.com)
     GOOGLE_SA_PRIVATE_KEY    서비스 계정 JSON 의 private_key 값 (\n 이스케이프 그대로 넣어도 됨)
     SUPABASE_URL             https://xxxx.supabase.co
     SUPABASE_ANON_KEY        anon public key
     SHEET_DB_TAB   (선택)    기본 "1.개인화DB"
     SHEET_RAW_TAB  (선택)    기본 "3.개인화RAW"

   권한
     읽기 = 로그인한 회원 누구나 · 쓰기 = 서버관리자·운영자
   ========================================================================== */
const crypto = require("crypto");

const SHEET_ID = process.env.SHEET_ID || "";
const SA_EMAIL = process.env.GOOGLE_SA_EMAIL || "";
const SA_KEY = (process.env.GOOGLE_SA_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const SUPA_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPA_ANON = process.env.SUPABASE_ANON_KEY || "";
const DB_TAB = process.env.SHEET_DB_TAB || "1.개인화DB";
const RAW_TAB = process.env.SHEET_RAW_TAB || "3.개인화RAW";

const DB_LAST_COL = "AE";                 // A~AE 까지만 읽고 쓴다 (AF~AH 는 사용하지 않음)
const RAW_LAST_COL = "P";
/* 앱에서 고칠 수 있는 열 = A~Q, T~W.
   R·S(CTR기준·CVR기준)와 X~AE(전달~매출)는 로직·수치라 읽기만 한다. */
const EDITABLE = [[0, 16], [19, 22]];
const CACHE_MS = 5 * 60 * 1000;

const memo = {};                          // 워밍된 람다 인스턴스 안에서만 사는 캐시

/* ---------------- 구글 인증 (서비스 계정 JWT → 액세스 토큰) ---------------- */
let gTok = null;
const b64url = b => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function googleToken() {
  if (gTok && gTok.exp > Date.now() + 60000) return gTok.tok;
  if (!SA_EMAIL || !SA_KEY) throw httpErr(500, "서비스 계정 환경변수(GOOGLE_SA_EMAIL · GOOGLE_SA_PRIVATE_KEY)가 설정되지 않았습니다");
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: SA_EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600
  }));
  let sig;
  try {
    sig = crypto.createSign("RSA-SHA256").update(head + "." + claim).sign(SA_KEY);
  } catch (e) {
    throw httpErr(500, "GOOGLE_SA_PRIVATE_KEY 를 읽지 못했습니다. JSON 키의 private_key 값을 그대로(줄바꿈 포함) 넣었는지 확인하세요.");
  }
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: head + "." + claim + "." + b64url(sig)
    })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw httpErr(500, "구글 인증 실패: " + (j.error_description || j.error || r.status));
  gTok = { tok: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return gTok.tok;
}

async function gapi(path, opts) {
  const tok = await googleToken();
  const o = Object.assign({ headers: {} }, opts || {});
  o.headers = Object.assign({ Authorization: "Bearer " + tok, "Content-Type": "application/json" }, o.headers);
  const r = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + SHEET_ID + path, o);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (j.error && j.error.message) || r.status;
    if (r.status === 403) throw httpErr(403, "서비스 계정에 시트 권한이 없습니다. 시트를 " + SA_EMAIL + " 에게 공유하세요. (" + msg + ")");
    if (r.status === 404) throw httpErr(404, "시트를 찾을 수 없습니다. SHEET_ID 와 탭 이름을 확인하세요. (" + msg + ")");
    if (r.status === 400 && /not supported for this document/i.test(String(msg)))
      throw httpErr(400, "이 문서는 업로드된 엑셀 파일이라 Sheets API 로 읽을 수 없습니다. 파일 → Google 스프레드시트로 저장 후 새 URL 을 쓰세요.");
    throw httpErr(r.status === 429 ? 429 : 502, "구글 시트 오류: " + msg);
  }
  return j;
}

function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }
const a1 = (tab, range) => "'" + String(tab).replace(/'/g, "''") + "'!" + range;

/* ---------------- Supabase 로그인·권한 확인 ---------------- */
async function whoAmI(req) {
  const auth = req.headers.authorization || "";
  if (!/^Bearer\s+/i.test(auth)) return null;
  if (!SUPA_URL || !SUPA_ANON) throw httpErr(500, "SUPABASE_URL · SUPABASE_ANON_KEY 환경변수가 설정되지 않았습니다");
  const token = auth.replace(/^Bearer\s+/i, "");
  const h = { apikey: SUPA_ANON, Authorization: "Bearer " + token };
  const r = await fetch(SUPA_URL + "/auth/v1/user", { headers: h });
  if (!r.ok) return null;
  const u = await r.json();
  let role = "viewer";
  try {
    const m = await fetch(SUPA_URL + "/rest/v1/jta_members?select=role&id=eq." + encodeURIComponent(u.id), { headers: h });
    if (m.ok) { const rows = await m.json(); if (rows && rows[0] && rows[0].role) role = rows[0].role; }
  } catch (e) { /* 회원 행 조회 실패 시 최소 권한으로 */ }
  return { id: u.id, email: u.email, role };
}
const isStaff = me => me && (me.role === "server_admin" || me.role === "operator");

/* ---------------- 읽기 ---------------- */
/* 값과 수식을 함께 읽는다.
   - 값 : UNFORMATTED_VALUE — 셀 서식에 백분율이 잘못 걸려 있어도 원래 숫자가 온다
   - 날짜: FORMATTED_STRING — 일련번호가 아니라 사람이 읽는 문자열로 온다
   - 수식: FORMULA — CTR·CVR 이 어떤 열로 계산되는지 역산해 '실적 기준' 문장을 만든다 */
async function readCampaigns() {
  const range = a1(DB_TAB, "A1:" + DB_LAST_COL);
  const q = "/values/" + encodeURIComponent(range) + "?dateTimeRenderOption=FORMATTED_STRING&valueRenderOption=";
  const [vals, forms] = await Promise.all([gapi(q + "UNFORMATTED_VALUE"), gapi(q + "FORMULA")]);
  const v = vals.values || [], f = forms.values || [];
  return { header: v[0] || [], rows: v.slice(1), formulas: f.slice(1) };
}
async function readPerf() {
  const range = a1(RAW_TAB, "A1:" + RAW_LAST_COL);
  const j = await gapi("/values/" + encodeURIComponent(range) +
    "?dateTimeRenderOption=FORMATTED_STRING&valueRenderOption=UNFORMATTED_VALUE");
  const v = j.values || [];
  return { header: v[0] || [], rows: v.slice(1) };
}

async function cached(key, fn, fresh) {
  const hit = memo[key];
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return Object.assign({}, hit.data, { cachedAt: hit.at });
  const data = await fn();
  memo[key] = { at: Date.now(), data };
  return Object.assign({}, data, { cachedAt: memo[key].at });
}

/* ---------------- 쓰기 ---------------- */
const colA1 = i => {                                   // 0 → A, 26 → AA
  let s = "", n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
};
const editable = i => EDITABLE.some(([a, b]) => i >= a && i <= b);

async function tabGid(name) {
  const j = await gapi("?fields=sheets.properties(sheetId,title)");
  const s = (j.sheets || []).find(x => x.properties && x.properties.title === name);
  if (!s) throw httpErr(404, "시트 탭 '" + name + "' 을 찾을 수 없습니다");
  return s.properties.sheetId;
}

/* 캠페인코드로 행을 다시 찾아 그 행만 고친다 —
   사람이 시트를 직접 편집해 행 순서가 밀려 있어도 엉뚱한 행을 덮어쓰지 않는다. */
async function upsertCampaign(body) {
  const code = String(body.code || "").trim();
  if (!code) throw httpErr(400, "캠페인코드가 없습니다");
  const cur = await readCampaigns();
  const width = Math.max(cur.header.length, 31);
  const idx = cur.rows.findIndex(r => String((r || [])[4] || "").trim() === code);

  /* 넘어온 값 중 고칠 수 있는 열만 남긴다. 수식이 들어 있는 칸은 열과 무관하게 지킨다. */
  const incoming = Array.isArray(body.values) ? body.values : [];
  const old = idx >= 0 ? (cur.rows[idx] || []) : [];
  const oldF = idx >= 0 ? (cur.formulas[idx] || []) : [];
  const next = [];
  for (let i = 0; i < width; i++) {
    const isFormula = typeof oldF[i] === "string" && oldF[i].charAt(0) === "=";
    if (!editable(i) || isFormula) next[i] = idx >= 0 ? (oldF[i] !== undefined ? oldF[i] : "") : "";
    else next[i] = incoming[i] === undefined || incoming[i] === null ? "" : String(incoming[i]);
  }

  if (idx >= 0) {
    const row = idx + 2;                               // 헤더 1행 + 0-based
    const data = EDITABLE.map(([a, b]) => ({
      range: a1(DB_TAB, colA1(a) + row + ":" + colA1(b) + row),
      values: [next.slice(a, b + 1)]
    }));
    await gapi("/values:batchUpdate", {
      method: "POST",
      body: JSON.stringify({ valueInputOption: "USER_ENTERED", data })
    });
    return { mode: "update", row, code };
  }

  /* 새 캠페인 — A~W 만 덧붙이고, 실적 열(X~AE)의 수식은 바로 윗줄에서 복사해 채운다 */
  const lastEditable = EDITABLE[EDITABLE.length - 1][1];
  const app = await gapi("/values/" + encodeURIComponent(a1(DB_TAB, "A:" + colA1(lastEditable))) +
    ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS", {
    method: "POST",
    body: JSON.stringify({ values: [next.slice(0, lastEditable + 1)] })
  });
  const m = /![A-Z]+(\d+):/.exec((app.updates && app.updates.updatedRange) || "");
  const row = m ? Number(m[1]) : 0;
  if (row > 2) {
    try {
      const gid = await tabGid(DB_TAB);
      await gapi(":batchUpdate", {
        method: "POST",
        body: JSON.stringify({
          requests: [{
            copyPaste: {
              source: { sheetId: gid, startRowIndex: row - 2, endRowIndex: row - 1, startColumnIndex: lastEditable + 1, endColumnIndex: 31 },
              destination: { sheetId: gid, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: lastEditable + 1, endColumnIndex: 31 },
              pasteType: "PASTE_FORMULA"
            }
          }]
        })
      });
    } catch (e) { /* 수식 복사는 실패해도 등록 자체는 성공으로 둔다 */ }
  }
  return { mode: "append", row, code };
}

/* ---------------- 핸들러 ---------------- */
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");   // 응답에 시트 내용이 담기므로 CDN 캐시는 쓰지 않는다
  try {
    if (!SHEET_ID) throw httpErr(500, "SHEET_ID 환경변수가 설정되지 않았습니다");
    const me = await whoAmI(req);
    if (!me) throw httpErr(401, "로그인이 필요합니다");

    if (req.method === "GET") {
      const url = new URL(req.url, "http://x");
      const action = url.searchParams.get("action") || "all";
      const fresh = url.searchParams.get("fresh") === "1";
      if (fresh && !isStaff(me)) throw httpErr(403, "새로고침은 운영자 이상만 할 수 있습니다");
      const out = { role: me.role };
      if (action === "campaigns" || action === "all") out.campaigns = await cached("campaigns", readCampaigns, fresh);
      if (action === "perf" || action === "all") out.perf = await cached("perf", readPerf, fresh);
      return res.status(200).json(out);
    }

    if (req.method === "POST") {
      if (!isStaff(me)) throw httpErr(403, "편집 권한이 없습니다. 서버관리자에게 운영자 권한을 요청하세요.");
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      if (body.action !== "upsert") throw httpErr(400, "지원하지 않는 요청입니다");
      const r = await upsertCampaign(body);
      delete memo.campaigns;                              // 방금 쓴 내용이 바로 보이도록 캐시를 버린다
      return res.status(200).json(Object.assign({ ok: true }, r));
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "허용되지 않은 메서드입니다" });
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    return res.status(status).json({ error: (e && e.message) || "알 수 없는 오류" });
  }
};
