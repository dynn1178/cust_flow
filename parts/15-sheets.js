
/* ========================================================================
   구글 시트 연동 — 캠페인 마스터(1.개인화DB) · 성과 이력(3.개인화RAW)

   시트가 원본이고 이 앱은 화면이다. 캠페인 목록을 앱 안에 따로 적재하지 않고,
   접속할 때 /api/sheets 를 통해 읽어 온다. 여정 지도 문서에 저장되는 것은
   "이 페이지에 이 캠페인코드를 붙였다"는 연결 정보뿐이다.
   그래서 시트에서 사라진 캠페인은 앱에서도 저절로 사라진다.

   읽기 = 로그인한 회원 누구나 · 쓰기(추가·수정) = 운영자 이상 · 삭제는 없다.
   ======================================================================== */

/* ---------------- 컬럼 스펙 ----------------
   1.개인화DB 의 A~AE. 이 배열이 시트 ↔ 앱 사이의 유일한 기준점이다.
   edit:false 인 열은 로직·수치라서 앱에서 고칠 수 없다(가져오기만 한다). */
const SHEET_COLS = [
  { a: "A",  key: "mkt",        label: "마케팅구분",     edit: true },
  { a: "B",  key: "aarrrCode",  label: "AARRR구분코드",  edit: true },
  { a: "C",  key: "aarrrName",  label: "AARRR구분명",    edit: true },
  { a: "D",  key: "goal",       label: "목표",           edit: true },
  { a: "E",  key: "code",       label: "캠페인코드",     edit: true },
  { a: "F",  key: "title",      label: "캠페인구분",     edit: true },   // 화면 표시명
  { a: "G",  key: "fullName",   label: "캠페인명",       edit: true },   // 실제 세부 이름
  { a: "H",  key: "progress",   label: "진행도",         edit: true },
  { a: "I",  key: "chan",       label: "채널",           edit: true },
  { a: "J",  key: "trigger",    label: "트리거",         edit: true },
  { a: "K",  key: "index",      label: "Index",          edit: true },
  { a: "L",  key: "path",       label: "경로",           edit: true },
  { a: "M",  key: "status",     label: "상태",           edit: true },
  { a: "N",  key: "event",      label: "이벤트",         edit: true },
  { a: "O",  key: "apidb",      label: "API/DB",         edit: true },
  { a: "P",  key: "owner",      label: "담당자",         edit: true },
  { a: "Q",  key: "memo",       label: "메모",           edit: true },
  { a: "R",  key: "ctrBasis",   label: "CTR기준",        edit: false },
  { a: "S",  key: "cvrBasis",   label: "CVR기준",        edit: false },
  { a: "T",  key: "link1",      label: "링크1",          edit: true },
  { a: "U",  key: "link2",      label: "링크2",          edit: true },
  { a: "V",  key: "measure",    label: "성과측정",       edit: true },
  { a: "W",  key: "measureNote",label: "비고",           edit: true },
  { a: "X",  key: "sent",       label: "전달",           edit: false, num: true },
  { a: "Y",  key: "recv",       label: "수신",           edit: false, num: true },
  { a: "Z",  key: "recvU",      label: "수신(고유)",     edit: false, num: true },
  { a: "AA", key: "open",       label: "오픈",           edit: false, num: true },
  { a: "AB", key: "conv",       label: "예약/반응",      edit: false, num: true },
  { a: "AC", key: "ctr",        label: "CTR",            edit: false, num: true, rate: true },
  { a: "AD", key: "cvr",        label: "CVR",            edit: false, num: true, rate: true },
  { a: "AE", key: "revenue",    label: "매출",           edit: false, num: true }
];
const COL_BY_KEY = SHEET_COLS.reduce((m, c, i) => (m[c.key] = i, m), {});
/* 3.개인화RAW 의 A~P */
const RAW_COLS = ["date", "code", "goal", "title", "fullName", "chan", "owner",
  "sent", "recv", "recvU", "open", "conv", "ctr", "cvr", "revenue", "note"];

/* 시트의 채널 표기를 앱의 채널 코드(아이콘·색)로 옮긴다 */
const CHAN_MATCH = [
  ["앱푸시", "push"], ["웹푸시", "push"], ["푸시", "push"], ["push", "push"],
  ["인앱", "inapp"], ["인웹", "inapp"], ["팝업", "inapp"],
  ["알림톡", "kakao"], ["카카오", "kakao"], ["친구톡", "kakao"],
  ["이메일", "email"], ["메일", "email"], ["email", "email"], ["edm", "email"],
  ["문자", "sms"], ["sms", "sms"], ["lms", "sms"], ["mms", "sms"],
  ["배너", "banner"], ["띠", "banner"]
];
function chanKey(s) {
  const t = String(s || "").toLowerCase();
  for (const [needle, key] of CHAN_MATCH) if (t.indexOf(needle) >= 0) return key;
  return "inapp";
}
/* 시트의 상태(진행·중단)를 앱의 상태 코드로 */
function statusKey(s) {
  const t = String(s || "").trim();
  if (t.indexOf("중단") >= 0 || t.indexOf("종료") >= 0) return "ended";
  if (t.indexOf("테스트") >= 0) return "test";
  if (!t) return "draft";
  return "live";
}
/* 화면 표시명 — 캠페인구분은 채널만 다른 같은 이름이 여럿이라 채널을 뒤에 붙인다 */
function campLabel(m) {
  if (!m) return "";
  const base = (m.title || m.fullName || m.code || "이름 없음").trim();
  const ch = String(m.chan || "").trim();
  return ch ? base + " [" + ch + "]" : base;
}

/* ---------------- 시트에서 읽어 둔 것 ---------------- */
const SHEETS = {
  camps: [],        // 캠페인 마스터 레코드
  byCode: {},
  perf: [],         // 성과 이력 레코드
  at: 0,            // 마지막으로 읽은 시각
  err: null,
  loading: false,
  loaded: false
};
const SHEET_CACHE = "sheets:v1";

const num = v => {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v == null ? "" : v).replace(/[,\s%₩]/g, ""));
  return isFinite(n) ? n : null;
};
const colIndex = letters => {                     // "AB" → 27
  let n = 0;
  for (const ch of String(letters)) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/* 수식을 컬럼명 문장으로 바꾼다 — "=AB2/Y2" → "예약/반응 ÷ 수신".
   다른 시트를 가리키는 참조( '3.개인화RAW'!AB2 )는 건드리지 않는다. */
function formulaToBasis(f) {
  if (typeof f !== "string" || f.charAt(0) !== "=") return "";
  /* 연산자를 먼저 바꾸고 그 다음에 컬럼명을 넣는다 — 순서를 뒤집으면
     "예약/반응" 같은 컬럼명 안의 슬래시까지 나눗셈으로 오인해 쪼개진다. */
  return f.slice(1)
    .replace(/\//g, " ÷ ").replace(/\*/g, " × ")
    .replace(/(!?)\$?([A-Z]{1,2})\$?\d+/g, (m, bang, col) => {
      if (bang) return m;
      const c = SHEET_COLS[colIndex(col)];
      return c ? c.label : m;
    })
    .replace(/\s{2,}/g, " ").trim();
}
/* 셀에 걸린 링크 주소를 찾는다.
   시트에는 글자가 "ALL" 이고 주소는 따로 붙어 있는 경우가 많아 세 군데를 차례로 본다. */
function linkUrlOf(meta, formula, text) {
  if (meta) return meta;
  const m = /^=\s*HYPERLINK\s*\(\s*"([^"]+)"/i.exec(String(formula || ""));
  if (m) return m[1];
  const t = String(text || "").trim();
  return /^(https?:\/\/|www\.)/i.test(t) ? t : "";
}
/* 실적 기준 — 시트에 적어 둔 기준 문구와, 수식에서 역산한 산식을 함께 보여준다 */
function basisOf(m, kind) {
  const written = kind === "ctr" ? m.ctrBasis : m.cvrBasis;
  const derived = kind === "ctr" ? m.ctrFormula : m.cvrFormula;
  const out = [];
  if (written) out.push(String(written).trim());
  if (derived && derived !== written) out.push(derived);
  return out;
}

/* 실적 기준 블록 — 시트에 적어 둔 기준 문구를 크게, 수식에서 역산한 산식을 그 아래 흐리게.
   둘 다 없으면 "미기입"으로 남겨 어느 캠페인이 정의가 비었는지 바로 보이게 한다. */
function basisHtml(m) {
  const row = (kind, label, color) => {
    const written = String((kind === "ctr" ? m.ctrBasis : m.cvrBasis) || "").trim();
    const derived = (kind === "ctr" ? m.ctrFormula : m.cvrFormula) || "";
    if (!written && !derived) return '<div class="brow2 none"><span class="bk" style="--c:' + color + '">' + label +
      '</span><span class="bv">미기입</span></div>';
    return '<div class="brow2"><span class="bk" style="--c:' + color + '">' + label + "</span>" +
      '<span class="bv">' + (written ? '<span class="bmain" title="' + esc(written) + '">' + esc(written) + "</span>" : "") +
        (derived && derived !== written ? '<span class="bsub" title="시트 수식에서 자동으로 풀어 쓴 산식">' + esc(derived) + "</span>" : "") +
      "</span></div>";
  };
  return '<div class="basis2">' + row("ctr", "CTR", "#2f6fed") + row("cvr", "CVR", "#e0483f") + "</div>";
}

/* ---------------- 정규화 ---------------- */
function normCampRows(payload) {
  const rows = (payload && payload.rows) || [], forms = (payload && payload.formulas) || [],
        links = (payload && payload.links) || [];
  const out = [];
  rows.forEach((r, i) => {
    if (!r || !String(r[COL_BY_KEY.code] || "").trim()) return;      // 캠페인코드 없는 줄은 건너뛴다
    const m = { _row: i + 2, _raw: r.slice() };
    SHEET_COLS.forEach((c, ci) => {
      const v = r[ci];
      m[c.key] = c.num ? num(v) : (v == null ? "" : String(v).trim());
    });
    const f = forms[i] || [], lk = links[i] || [];
    m.ctrFormula = formulaToBasis(f[COL_BY_KEY.ctr]);
    m.cvrFormula = formulaToBasis(f[COL_BY_KEY.cvr]);
    m.link1Url = linkUrlOf(lk[0], f[COL_BY_KEY.link1], m.link1);
    m.link2Url = linkUrlOf(lk[1], f[COL_BY_KEY.link2], m.link2);
    m.linkList = [{ label: m.link1 || "링크1", url: m.link1Url }, { label: m.link2 || "링크2", url: m.link2Url }]
      .filter(l => l.url);
    m.chanCode = chanKey(m.chan);
    m.statusCode = statusKey(m.status);
    m.label = campLabel(m);
    out.push(m);
  });
  return out;
}
/* 날짜 → "2026-07". 시트에서 문자열로 오든 일련번호로 오든 받아 준다 */
function ym(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number") {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
  }
  const s = String(v).trim();
  const m = /^(\d{4})[-./년\s]*(\d{1,2})/.exec(s);
  return m ? m[1] + "-" + String(m[2]).padStart(2, "0") : "";
}
function normPerfRows(payload) {
  const rows = (payload && payload.rows) || [];
  const out = [];
  rows.forEach(r => {
    if (!r) return;
    const code = String(r[1] || "").trim();
    const month = ym(r[0]);
    if (!code || !month) return;
    const o = { month: month };
    RAW_COLS.forEach((k, i) => {
      const v = r[i];
      o[k] = i >= 7 && i <= 14 ? num(v) : (v == null ? "" : String(v).trim());
    });
    o.code = code;
    o.chanCode = chanKey(o.chan);
    /* CTR·CVR 은 시트에서 계산된 값을 그대로 쓴다. 0~1 로 오면 %로 맞춘다. */
    o.ctrPct = ratePct(o.ctr);
    o.cvrPct = ratePct(o.cvr);
    out.push(o);
  });
  out.sort((a, b) => a.month.localeCompare(b.month));
  return out;
}
function ratePct(v) {
  const n = num(v);
  if (n == null) return null;
  return Math.abs(n) <= 1 ? n * 100 : n;          // 0.056 → 5.6 · 5.6 → 5.6
}

/* ---------------- 불러오기 ---------------- */
async function sheetApi(path, opts) {
  const token = await ensureToken();
  if (!token) throw new Error("로그인이 필요합니다");
  const o = Object.assign({ headers: {} }, opts || {});
  o.headers = Object.assign({ Authorization: "Bearer " + token }, o.headers);
  const r = await fetch("/api/sheets" + path, o);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ("시트를 읽지 못했습니다 (" + r.status + ")"));
  return j;
}

function applySheetPayload(j, at) {
  if (j.campaigns) SHEETS.camps = normCampRows(j.campaigns);
  if (j.perf) SHEETS.perf = normPerfRows(j.perf);
  /* 조회 키는 대문자로 통일한다 — 소문자로 친 코드도 같은 캠페인으로 찾아야
     중복 등록을 막고, 여정 지도에 붙은 코드도 대소문자 차이로 끊기지 않는다 */
  SHEETS.byCode = SHEETS.camps.reduce((m, c) => (m[String(c.code).toUpperCase()] = c, m), {});
  SHEETS.at = at || Date.now();
  SHEETS.loaded = true;
}

/* 접속할 때 한 번 읽고, 그 뒤에는 새로고침 버튼으로만 다시 읽는다.
   먼저 브라우저에 남은 마지막 응답으로 화면을 그려 두고 뒤에서 갱신한다. */
async function loadSheets(opt) {
  const o = opt || {};
  if (SHEETS.loading) return;
  if (!supaOn() || !me) { SHEETS.err = "로그인하면 캠페인 시트를 불러옵니다"; renderSyncBars(); return; }
  SHEETS.loading = true; SHEETS.err = null;
  renderSyncBars();
  try {
    const j = await sheetApi("?action=all" + (o.fresh ? "&fresh=1" : ""));
    applySheetPayload(j, Date.now());
    try { await idbSet(SHEET_CACHE, { campaigns: j.campaigns, perf: j.perf, at: SHEETS.at }); } catch (e) {}
    if (o.toast) toast("캠페인 " + SHEETS.camps.length + "건 · 성과 " + SHEETS.perf.length + "행을 시트에서 불러왔습니다", "ok");
  } catch (e) {
    SHEETS.err = (e && e.message) || "시트를 읽지 못했습니다";
    if (o.toast) toast(SHEETS.err, "bad");
  } finally {
    SHEETS.loading = false;
    renderSyncBars();
    invalidateViews();
    renderFlow(); renderPanels();
    renderCampView(true);
    if (typeof renderPerfView === "function") renderPerfView(true);
  }
}
/* 지난번 접속에서 받아 둔 내용 — 시트가 느리거나 막혀 있어도 화면은 비지 않는다 */
async function loadSheetCache() {
  let c = null;
  try { c = await idbGet(SHEET_CACHE); } catch (e) {}
  if (!c || !c.campaigns) return false;
  applySheetPayload(c, c.at);
  return true;
}

function syncAgo() {
  if (!SHEETS.at) return "아직 불러오지 않음";
  return timeAgo(SHEETS.at) + " 기준";
}
function syncBarHtml() {
  if (SHEETS.loading) return '<span class="syncchip">' + ico("loop", "xs") + "시트를 읽는 중…</span>";
  if (SHEETS.err) return '<span class="syncchip bad">' + ico("alert", "xs") + esc(SHEETS.err) +
    (SHEETS.at ? " · " + esc(syncAgo()) + " 자료로 표시 중" : "") + "</span>";
  return '<span class="syncchip">' + ico("check", "xs") + "캠페인 " + SHEETS.camps.length + "건 · " + esc(syncAgo()) + "</span>";
}
function renderSyncBars() {
  $$(".syncbar").forEach(el => { el.innerHTML = syncBarHtml(); });
  $$("[data-sheet-refresh]").forEach(b => { b.disabled = !!SHEETS.loading; });
}

/* ---------------- 마스터 조회 ---------------- */
const campByCode = code => SHEETS.byCode[String(code || "").trim().toUpperCase()] || null;

/* 노드에 붙어 있는 항목 하나를 화면에 그릴 형태로 편다.
   시트 연동 항목은 {id, code} 만 문서에 저장되고, 나머지는 여기서 시트로부터 채운다.
   예전 방식으로 직접 등록해 둔 캠페인은 그대로 통과시킨다(옛 문서 호환). */
function campView(c) {
  if (!c) return null;
  if (!c.code) return c;
  const m = campByCode(c.code);
  if (!m) {
    return {
      id: c.id, code: c.code, missing: true, name: c.code + " · 시트에서 삭제됨",
      chan: "inapp", status: "ended", segment: "", timing: "", extId: c.code,
      landing: "", note: "", links: []
    };
  }
  return {
    id: c.id, code: c.code, missing: false, master: m,
    name: m.label,
    chan: m.chanCode, chanText: m.chan,
    status: m.statusCode,
    segment: m.trigger, timing: m.index,
    extId: m.code, landing: m.path, note: "",     /* 메모는 카드에 띄우지 않는다 — 길고 내부 기록용이다 */
    links: m.linkList || []
  };
}
const campViews = n => (n && n.camps ? n.camps.map(campView).filter(Boolean) : []);
/* 어느 페이지에 붙어 있는지 — 캠페인코드로 전체 보드를 훑는다 */
function placementsOf(code) {
  const out = [];
  state.boards.forEach(b => b.nodes.forEach(n => {
    if ((n.camps || []).some(c => c.code === code)) out.push({ b, n });
  }));
  return out;
}

/* ---------------- 여정 지도에 붙이기 ---------------- */
let pickFilter = { q: "", goal: "all", chan: "all", owner: "all" };

function optionsOf(list, key, cur, allLabel) {
  const names = Array.from(new Set(list.map(x => String(x[key] || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko"));
  return '<option value="all">' + esc(allLabel) + "</option>" +
    names.map(v => '<option value="' + esc(v) + '"' + (cur === v ? " selected" : "") + ">" + esc(v) + "</option>").join("");
}
function pickRows(n) {
  const has = (n.camps || []).map(c => c.code).filter(Boolean);
  const q = pickFilter.q;
  return SHEETS.camps.filter(m =>
    (pickFilter.goal === "all" || m.goal === pickFilter.goal) &&
    (pickFilter.chan === "all" || m.chan === pickFilter.chan) &&
    (pickFilter.owner === "all" || m.owner === pickFilter.owner) &&
    (!q || (m.code + " " + m.goal + " " + m.title + " " + m.fullName + " " + m.owner + " " + m.path).toLowerCase().indexOf(q) >= 0)
  ).map(m => ({ m, on: has.indexOf(m.code) >= 0 }));
}
function pickListHtml(n) {
  const rows = pickRows(n);
  if (!rows.length) return '<div class="empty">' + ico("mega") + "<div>조건에 맞는 캠페인이 없습니다</div></div>";
  return rows.map(({ m, on }) =>
    '<label class="pickrow' + (on ? " on" : "") + '">' +
      '<input type="checkbox" data-pick="' + esc(m.code) + '"' + (on ? " checked" : "") + ">" +
      '<span class="pickmain"><b>' + esc(m.label) + "</b>" +
        '<em>' + esc(m.code) + (m.goal ? " · " + esc(m.goal) : "") + (m.owner ? " · " + esc(m.owner) : "") + "</em>" +
        (m.fullName ? '<span class="pickfull mono">' + esc(m.fullName) + "</span>" : "") +
        (m.path ? '<span class="pickfull mono">' + esc(m.path) + "</span>" : "") + "</span>" +
      '<span class="chip" style="--c:' + CSTATUS_C[m.statusCode] + '">' + esc(m.status || "-") + "</span>" +
    "</label>").join("");
}
function openCampPicker() {
  const n = curNode();
  if (!n || !canEdit()) return;
  if (!SHEETS.loaded) return toast("캠페인 시트를 아직 불러오지 못했습니다. 캠페인 탭에서 새로고침해 보세요.", "bad");

  const root = modalHost();
  const draw = () => { $("#pickList", root).innerHTML = pickListHtml(n); };
  root.innerHTML =
    '<div class="scrim"><div class="modal glass wide" role="dialog" aria-modal="true">' +
      '<div class="modal-head">' + ico("mega") + "<h3>캠페인 붙이기 · " + esc(n.name) + '</h3><button class="btn icon sm" data-x>' + ico("close", "xs") + "</button></div>" +
      '<div class="modal-body">' +
        '<div class="toolrow">' +
          '<input class="field" id="pickQ" placeholder="캠페인코드 · 목표 · 캠페인명 · 담당자 · 경로 검색" style="flex:1; min-width:180px" value="' + esc(pickFilter.q) + '">' +
          '<select class="field" id="pickGoal">' + optionsOf(SHEETS.camps, "goal", pickFilter.goal, "모든 목표") + "</select>" +
          '<select class="field" id="pickChan">' + optionsOf(SHEETS.camps, "chan", pickFilter.chan, "모든 채널") + "</select>" +
          '<select class="field" id="pickOwner">' + optionsOf(SHEETS.camps, "owner", pickFilter.owner, "모든 담당자") + "</select>" +
        "</div>" +
        '<div class="picklist" id="pickList"></div>' +
        '<p class="hint">체크한 캠페인이 이 페이지에 붙습니다. 목록은 구글 시트 <b>1.개인화DB</b> 에 있는 것만 나옵니다 — ' +
          '여기 없는 캠페인은 <b>새 캠페인 등록</b>으로 시트에 먼저 추가하세요.</p>' +
      "</div>" +
      '<div class="modal-foot">' +
        (isStaff() ? '<button class="btn" data-new>' + ico("plus", "xs") + "새 캠페인 등록</button>" : "") +
        '<div class="spacer"></div><button class="btn primary" data-x>닫기</button></div>' +
    "</div></div>";
  draw();

  root.addEventListener("input", e => {
    if (e.target.id === "pickQ") { pickFilter.q = e.target.value.toLowerCase().trim(); draw(); }
  });
  root.addEventListener("change", e => {
    if (e.target.id === "pickGoal") { pickFilter.goal = e.target.value; return draw(); }
    if (e.target.id === "pickChan") { pickFilter.chan = e.target.value; return draw(); }
    if (e.target.id === "pickOwner") { pickFilter.owner = e.target.value; return draw(); }
    const cb = e.target.closest("[data-pick]");
    if (!cb) return;
    const code = cb.dataset.pick;
    if (cb.checked) {
      if (!n.camps.some(c => c.code === code)) n.camps.push({ id: uid("c"), code: code });
    } else {
      const gone = n.camps.filter(c => c.code === code).map(c => c.id);
      n.camps = n.camps.filter(c => c.code !== code);
      (n.layers || []).forEach(l => { if (gone.indexOf(l.campId) >= 0) l.campId = null; });
    }
    cb.closest(".pickrow").classList.toggle("on", cb.checked);
    markDirty(); renderFlow(); renderStage(); renderPanels(); renderCampView(true);
  });
  root.addEventListener("click", e => {
    if (e.target.closest("[data-x]") || e.target.classList.contains("scrim")) return closeModal();
    if (e.target.closest("[data-new]")) { closeModal(); editSheetCamp(null); }
  });
}

/* ---------------- 시트에 캠페인 추가 · 수정 ---------------- */
/* AARRR 구분코드 → 구분명 표는 시트에 이미 쌓인 값에서 뽑는다.
   코드에 박아 두면 시트에서 단계 이름을 바꿨을 때 앱만 옛 이름을 들고 있게 된다. */
function aarrrMap() {
  const tally = {};
  SHEETS.camps.forEach(c => {
    const k = String(c.aarrrCode || "").trim().toUpperCase(), n = String(c.aarrrName || "").trim();
    if (!k || !n) return;
    (tally[k] = tally[k] || {})[n] = (tally[k][n] || 0) + 1;
  });
  const out = {};
  Object.keys(tally).sort().forEach(k => {
    out[k] = Object.keys(tally[k]).sort((a, b) => tally[k][b] - tally[k][a])[0];
  });
  return out;
}
const aarrrLabel = code => {
  const n = aarrrMap()[String(code || "").trim().toUpperCase()];
  return n ? code + " · " + n : String(code || "");
};
/* 같은 구분코드에서 가장 큰 일련번호를 찾아 그 다음 번호를 제안한다.
   A1-002 · R1-101 처럼 세 자리를 쓰고, A2-001-01 같은 꼬리표는 무시한다. */
function nextCampCode(prefix) {
  const p = String(prefix || "").trim().toUpperCase();
  if (!p) return "";
  let max = 0, width = 3;
  SHEETS.camps.forEach(c => {
    const m = new RegExp("^" + p.replace(/[^A-Z0-9]/g, "") + "-(\\d+)").exec(String(c.code || "").trim().toUpperCase());
    if (!m) return;
    width = Math.max(width, m[1].length);
    max = Math.max(max, parseInt(m[1], 10));
  });
  return p + "-" + String(max + 1).padStart(width, "0");
}
/* 시트에 이미 쓰이고 있는 값을 모아 선택지로 만든다 (기본 목록 + 시트 실제 값) */
function optsFrom(key, base) {
  const seen = { "": "-" };
  (base || []).forEach(v => { seen[v] = v; });
  SHEETS.camps.forEach(c => {
    const v = String(c[key] || "").trim();
    if (v) seen[v] = v;
  });
  return seen;
}
const CHAN_OPTS = ["앱푸시", "LMS", "EDM", "인앱", "인웹", "인앱/웹", "알림톡"];
const PROGRESS_OPTS = ["기획", "제작", "검수", "완료", "보류"];
/* O열 API/DB 는 한 칸이라 "API" · "DB" · "API/DB" 로 적힌다. 폼에서는 두 칸으로 나눠 고른다. */
function apidbSplit(v) {
  const t = String(v || "").toUpperCase();
  return { _api: t.indexOf("API") >= 0 ? "Y" : "", _db: t.indexOf("DB") >= 0 ? "Y" : "" };
}
const apidbJoin = (api, db) => [api === "Y" ? "API" : "", db === "Y" ? "DB" : ""].filter(Boolean).join("/");

function sheetFormFields(locked) {
  const map = aarrrMap();
  const aarrrOpts = {};
  Object.keys(map).forEach(k => { aarrrOpts[k] = k + " · " + map[k]; });
  const YN = { "": "-", "Y": "Y", "N": "N" };
  /* 이미 있는 캠페인을 고칠 때는 AARRR 구분과 캠페인코드를 잠근다.
     이 값들은 성과 시트와 이어 붙이는 열쇠이자 분류 기준이라, 여기서 바꾸면
     지금까지 쌓인 성과 이력과 연결이 끊긴다. 바꿔야 하면 시트에서 직접 고친다. */
  return [
    { type: "group", label: locked ? "AARRR 구분 · 캠페인코드 (수정 불가)"
        : "AARRR 구분 — 먼저 고르면 캠페인코드가 자동으로 제안됩니다", open: true, fields: [
      locked ? { k: "aarrrCode", label: "AARRR구분코드", type: "readonly", mono: true }
             : { k: "aarrrCode", label: "AARRR구분코드", type: "select", opts: aarrrOpts },
      { k: "aarrrName", label: "AARRR구분명", type: "readonly" },
      locked ? { k: "code", label: "캠페인코드", type: "readonly", mono: true }
             : { k: "code", label: "캠페인코드", mono: true, ph: "A1-002" },
      { k: "_codeMsg", label: "", type: "note" }
    ] },
    { k: "title", label: "캠페인구분 (화면 표시명)", ph: "회원가입 유도" },
    { k: "fullName", label: "캠페인명 (세부 이름)", ph: "IN_P_CRM_가입_트리거기반_공통_앱_회원가입유도_260701~260731" },
    { k: "chan", label: "채널", type: "select", opts: optsFrom("chan", CHAN_OPTS) },
    { k: "goal", label: "목표", ph: "회원가입 증대" },
    { k: "mkt", label: "마케팅구분", type: "select", opts: optsFrom("mkt", ["개인화"]) },
    { k: "status", label: "운영상태 (시트 M열)", type: "select", opts: { "진행": "진행", "중단": "중단" } },
    { k: "progress", label: "작업 진행도 (시트 H열)", type: "select", opts: optsFrom("progress", PROGRESS_OPTS) },
    { k: "owner", label: "담당자", type: "select", opts: optsFrom("owner", []) },
    { type: "group", label: "실행 조건", open: true, fields: [
      { k: "trigger", label: "트리거", ph: "메인 페이지 로딩 시 & 로그인 = N" },
      { k: "index", label: "Index (전환 조건)", ph: "7일 이내 회원가입 = Y" },
      { k: "path", label: "경로", mono: true, ph: "/product/main.yb" },
      { k: "event", label: "이벤트", type: "select", opts: optsFrom("event", ["O", "X"]) },
      { k: "_api", label: "API 사용", type: "select", opts: YN },
      { k: "_db", label: "DB 사용", type: "select", opts: YN }
    ] },
    { type: "group", label: "링크 · 성과측정", fields: [
      { k: "link1", label: "링크1", mono: true, ph: "https://dashboard-05.braze.com/..." },
      { k: "link2", label: "링크2", mono: true, ph: "" },
      { k: "measure", label: "성과측정 여부", type: "select", opts: { "Y": "Y (측정함)", "N": "N (측정 안 함)", "": "미지정" } },
      { k: "measureNote", label: "비고 (성과측정 참고 메모)", type: "textarea" }
    ] },
    { k: "memo", label: "메모", type: "textarea" }
  ];
}
/* 앱에서 고칠 수 없는 열은 값만 보여 준다 */
function lockedFields(m) {
  if (!m) return [];
  return [{ type: "group", label: "실적 기준 · 수치 (시트에서만 수정)", open: true, fields: [
    { k: "_ctrBasis", label: "CTR 기준", type: "readonly" },
    { k: "_cvrBasis", label: "CVR 기준", type: "readonly" },
    { k: "_nums", label: "시트 집계", type: "readonly" }
  ] }];
}
/* 캠페인코드가 이미 있는지 · 구분코드와 앞자리가 맞는지 그 자리에서 알려 준다 */
function codeCheck(codeVal, prefix, editing) {
  const v = String(codeVal || "").trim().toUpperCase();
  if (!v) return { bad: true, msg: "캠페인코드는 반드시 필요합니다" };
  if (editing && v === String(editing).toUpperCase()) return { bad: false, msg: "" };
  const dup = campByCode(v);
  if (dup) return { bad: true, msg: "이미 있는 캠페인코드입니다 — " + (dup.title || dup.fullName || "") };
  if (prefix && v.indexOf(String(prefix).toUpperCase() + "-") !== 0)
    return { bad: true, msg: "AARRR구분코드가 " + prefix + " 이므로 " + prefix + "- 로 시작해야 합니다" };
  return { bad: false, msg: "쓸 수 있는 코드입니다" };
}

function editSheetCamp(code) {
  if (!isStaff()) return toast("캠페인 등록·수정은 운영자 이상만 할 수 있습니다", "bad");
  const m = code ? campByCode(code) : null;
  if (code && !m) return toast("시트에서 이 캠페인을 찾지 못했습니다. 새로고침해 보세요.", "bad");
  if (!m && !SHEETS.camps.length) return toast("캠페인 목록을 먼저 불러와야 코드를 제안할 수 있습니다", "bad");

  const map = aarrrMap();
  const values = {};
  SHEET_COLS.forEach(c => { values[c.key] = m ? (m[c.key] == null ? "" : m[c.key]) : ""; });
  Object.assign(values, apidbSplit(m ? m.apidb : ""));
  if (!m) {
    const first = Object.keys(map)[0] || "";
    values.status = "진행";
    values.aarrrCode = first;
    values.aarrrName = map[first] || "";
    values.code = nextCampCode(first);
    values.mkt = "개인화";
  }
  values._codeMsg = m
    ? "AARRR 구분과 캠페인코드는 성과 이력을 잇는 열쇠라 여기서 바꿀 수 없습니다. 시트에서 직접 고치세요."
    : "시트의 마지막 번호 다음으로 제안한 코드입니다. 바꿔도 됩니다.";
  if (m) {
    const ctr = basisOf(m, "ctr"), cvr = basisOf(m, "cvr");
    values._ctrBasis = ctr.length ? ctr.join("  ·  ") : "시트에 기준이 적혀 있지 않습니다";
    values._cvrBasis = cvr.length ? cvr.join("  ·  ") : "시트에 기준이 적혀 있지 않습니다";
    values._nums = SHEET_COLS.filter(c => c.num).map(c => {
      const v = m[c.key];
      return c.label + " " + (v == null ? "-" : c.rate ? (Math.abs(v) <= 1 ? v * 100 : v).toFixed(1) + "%" : v.toLocaleString("ko-KR"));
    }).join("  ·  ");
  }

  openForm({
    title: m ? "캠페인 수정 · " + m.code : "새 캠페인 등록",
    icon: "mega",
    okText: m ? "시트에 저장" : "시트에 등록",
    note: "<b>CTR기준·CVR기준과 전달~매출(X~AE)은 로직·수치라 앱에서 고칠 수 없습니다</b> — 시트에서 직접 수정하세요. " +
      "앱에서는 삭제할 수 없습니다. 그만 쓰는 캠페인은 상태를 <b>중단</b>으로 바꾸세요." +
      (m ? "" : "<br>새로 등록하면 실적 열의 수식은 바로 윗줄에서 복사됩니다. CTR기준·CVR기준은 시트에서 채워 주세요."),
    warn: "이 캠페인 항목은 구글 시트 데이터와 연동됩니다. 여기서 수정하면 <b>구글 시트의 데이터도 함께 변경</b>됩니다.",
    fields: sheetFormFields(!!m).concat(lockedFields(m)),
    values: values,
    /* 구분코드를 고르면 구분명과 캠페인코드를 따라 바꾸고, 코드는 칠 때마다 중복을 확인한다 */
    onChange: (k, v, root) => {
      if (m) return;                            /* 수정 중에는 코드·구분이 잠겨 있다 */
      const codeEl = $('[data-k="code"]', root);
      const prefEl = $('[data-k="aarrrCode"]', root);
      if (k === "aarrrCode") {
        const nameEl = $('[data-k="aarrrName"]', root);
        if (nameEl) nameEl.textContent = map[v] || "-";
        if (!m) codeEl.value = nextCampCode(v);
      }
      if (k === "aarrrCode" || k === "code") {
        const r = codeCheck(codeEl.value, prefEl ? prefEl.value : "", m ? m.code : null);
        const msg = $('[data-note="_codeMsg"]', root);
        if (msg) { msg.textContent = r.msg; msg.className = "fnote " + (r.bad ? "bad" : "ok"); }
        codeEl.classList.toggle("invalid", r.bad);
      }
    },
    onSave: async v => {
      const newCode = String(v.code || "").trim();
      const r = codeCheck(newCode, v.aarrrCode, m ? m.code : null);
      if (r.bad) return toast(r.msg, "bad");
      if (m && newCode.toUpperCase() !== String(m.code).toUpperCase())
        return toast("캠페인코드는 바꿀 수 없습니다. 시트에서 직접 고쳐 주세요.", "bad");
      v.code = m ? m.code : newCode;         /* 시트에는 친 그대로 적는다 */
      if (m) { v.aarrrCode = m.aarrrCode; v.aarrrName = m.aarrrName; }
      else v.aarrrName = map[v.aarrrCode] || v.aarrrName || "";
      v.apidb = apidbJoin(v._api, v._db);
      const row = [];
      SHEET_COLS.forEach((c, i) => { row[i] = c.edit ? (v[c.key] == null ? "" : String(v[c.key])) : ""; });
      toast(m ? "시트에 저장하는 중…" : "시트에 등록하는 중…");
      try {
        await sheetApi("", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "upsert", code: v.code, values: row })
        });
        await loadSheets({ fresh: true });
        toast(m ? "시트에 저장했습니다" : "시트에 등록했습니다 · " + v.code, "ok");
      } catch (e) {
        toast("시트에 쓰지 못했습니다: " + ((e && e.message) || "알 수 없는 오류"), "bad");
      }
    }
  });
}

/* ---------------- 초기화 ---------------- */
function initSheets() {
  document.addEventListener("click", e => {
    const r = e.target.closest("[data-sheet-refresh]");
    if (r) { if (!isStaff()) return toast("새로고침은 운영자 이상만 할 수 있습니다", "bad"); loadSheets({ fresh: true, toast: true }); }
    const ed = e.target.closest("[data-sheet-edit]");
    if (ed) editSheetCamp(ed.dataset.sheetEdit);
  });
}
/* 접속 직후 — 캐시로 먼저 그리고 시트를 다시 읽는다 */
async function bootSheets() {
  const had = await loadSheetCache();
  if (had) { renderSyncBars(); invalidateViews(); renderFlow(); renderPanels(); }
  await loadSheets({});
}
