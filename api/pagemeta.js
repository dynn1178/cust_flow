/* ============================================================================
   /api/pagemeta — 웹 모드에서 "추가하기"를 누르면 그 주소의 <title>을 대신 읽어온다

   브라우저 안의 iframe은 다른 사이트(교차 출처) 페이지의 제목을 동일 출처 정책
   때문에 직접 읽을 수 없다. 그래서 서버가 그 주소로 대신 요청을 보내 <title>만
   뽑아 돌려준다 — 화면 자체는 여전히 브라우저의 iframe이 직접 불러온다.

   필요한 환경변수 (api/sheets.js 와 같다)
     SUPABASE_URL, SUPABASE_ANON_KEY

   권한 — 로그인한 회원 누구나 (쓰기는 앱 쪽 문서 저장 권한을 그대로 따른다)
   ========================================================================== */
const dns = require("dns").promises;
const net = require("net");

const SUPA_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPA_ANON = process.env.SUPABASE_ANON_KEY || "";

function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }

async function whoAmI(req) {
  const auth = req.headers.authorization || "";
  if (!/^Bearer\s+/i.test(auth)) return null;
  if (!SUPA_URL || !SUPA_ANON) throw httpErr(500, "SUPABASE_URL · SUPABASE_ANON_KEY 환경변수가 설정되지 않았습니다");
  const token = auth.replace(/^Bearer\s+/i, "");
  const r = await fetch(SUPA_URL + "/auth/v1/user", { headers: { apikey: SUPA_ANON, Authorization: "Bearer " + token } });
  if (!r.ok) return null;
  return await r.json();
}

/* 사설·루프백·링크로컬 대역으로는 서버가 대신 요청을 보내지 않는다(SSRF 방지) —
   도메인이 내부망 IP로 풀리는 경우까지 막으려면 이름이 아니라 실제로 풀린 주소를 봐야 한다 */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 ||
      (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    return low === "::1" || low.startsWith("fc") || low.startsWith("fd") || low.startsWith("fe80");
  }
  return true;
}
async function assertPublicHost(hostname) {
  if (/^localhost$/i.test(hostname)) throw httpErr(400, "내부 주소는 불러올 수 없습니다");
  const addrs = await dns.lookup(hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw httpErr(400, "주소를 확인할 수 없습니다");
  if (addrs.some(a => isPrivateIp(a.address))) throw httpErr(400, "내부 주소는 불러올 수 없습니다");
}

const ENTITY = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
function decodeEntities(s) {
  return String(s || "").replace(/&(#39|#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (ENTITY[e.toLowerCase()]) return ENTITY[e.toLowerCase()];
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (isFinite(code)) return String.fromCodePoint(code);
    }
    return m;
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "허용되지 않은 메서드입니다" }); }
    const me = await whoAmI(req);
    if (!me) throw httpErr(401, "로그인이 필요합니다");

    const raw = new URL(req.url, "http://x").searchParams.get("url") || "";
    let target;
    try { target = new URL(raw); } catch (e) { throw httpErr(400, "올바른 주소가 아닙니다"); }
    if (!/^https?:$/.test(target.protocol)) throw httpErr(400, "http:// 또는 https:// 주소만 불러올 수 있습니다");
    await assertPublicHost(target.hostname);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    let title = "";
    try {
      const r = await fetch(target.href, {
        signal: ctrl.signal, redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; PageMetaBot/1.0; +cust-flow)" }
      });
      if (!r.ok) throw httpErr(r.status === 404 ? 404 : 502, "페이지를 불러오지 못했습니다 (" + r.status + ")");
      const reader = r.body && r.body.getReader ? r.body.getReader() : null;
      let html = "", total = 0;
      const LIMIT = 200000;             // 200KB — <head>만 읽으면 충분하다
      if (reader) {
        while (total < LIMIT) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          html += Buffer.from(value).toString("utf8");
          if (/<\/title>/i.test(html)) break;
        }
        try { reader.cancel(); } catch (e) {}
      } else {
        html = await r.text();
      }
      const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
      if (m) title = decodeEntities(m[1].replace(/\s+/g, " ").trim());
    } finally {
      clearTimeout(timer);
    }
    return res.status(200).json({ url: target.href, title: title });
  } catch (e) {
    const status = e && e.status ? e.status : (e && e.name === "AbortError" ? 504 : 500);
    const msg = e && e.name === "AbortError" ? "페이지 응답이 너무 오래 걸립니다" : ((e && e.message) || "알 수 없는 오류");
    return res.status(status).json({ error: msg });
  }
};
