<script>
"use strict";
/* ========================================================================
   Journey Tag Atlas — 고객 여정 · 태깅 · CRM 캠페인 통합 보드
   ======================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.prototype.slice.call(r.querySelectorAll(s));
const uid = p => p + Math.random().toString(36).slice(2, 7) + Date.now().toString(36).slice(-3);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ico = (n, cls) => '<svg class="ico ' + (cls || "") + '"><use href="#i-' + n + '"/></svg>';

/* ---------------- 도메인 상수 ---------------- */
const PLAT = {
  amplitude: { name: "Amplitude", ico: "amp", c: "var(--amp)" },
  braze:     { name: "Braze",     ico: "braze", c: "var(--braze)" },
  ga4:       { name: "GA4",       ico: "ga4", c: "var(--ga4)" }
};
const TRIGGER = { view: "화면 노출", click: "클릭", submit: "제출/전송", scroll: "스크롤", timer: "체류", custom: "커스텀" };
const TSTATUS = { live: "적용됨", todo: "작업 예정", deprecated: "폐기" };
const TSTATUS_C = { live: "var(--ok)", todo: "var(--warn)", deprecated: "var(--ink-3)" };
const TCHAN = { web_pc: "웹 PC", web_mo: "웹 모바일", app_aos: "앱 AOS", app_ios: "앱 iOS" };
const PTYPE = { string: "문자열", number: "숫자", boolean: "불리언", array: "배열", object: "객체" };
const TSAMPLE_KEYS = { testSampleWebPc: "web_pc", testSampleWebMo: "web_mo", testSampleAppAos: "app_aos", testSampleAppIos: "app_ios" };
const CHAN = {
  push:   { name: "앱 푸시", c: "var(--braze)", ico: "braze" },
  inapp:  { name: "인앱 메시지", c: "var(--camp)", ico: "mega" },
  email:  { name: "이메일", c: "var(--amp)", ico: "mail" },
  kakao:  { name: "알림톡", c: "var(--ga4)", ico: "chat" },
  banner: { name: "배너·띠", c: "var(--accent)", ico: "banner" },
  sms:    { name: "문자", c: "var(--ok)", ico: "chat" }
};
const CSTATUS = { live: "운영중", draft: "기획중", test: "테스트", ended: "종료" };
const CSTATUS_C = { live: "var(--ok)", draft: "var(--ink-3)", test: "var(--warn)", ended: "var(--bad)" };
const KIND = { entry: "진입", page: "페이지", modal: "모달·시트", decision: "분기", exit: "이탈·종료" };
const SWATCH = ["#e0483f", "#f2913c", "#12a97a", "#2f6fed", "#8b5cf6", "#111827", "#ffffff"];
/* 노드·연결선 공통 색 팔레트 */
const HUE = {
  none:   { name: "기본", c: "var(--ink-3)" },
  blue:   { name: "파랑", c: "#3b76f0" },
  violet: { name: "보라", c: "#8b5cf6" },
  green:  { name: "초록", c: "#12a97a" },
  amber:  { name: "주황", c: "#e08a1e" },
  red:    { name: "빨강", c: "#e0483f" },
  slate:  { name: "회색", c: "#64748b" }
};
const NSIZE = { s: { name: "작게", w: 150 }, m: { name: "보통", w: 190 }, l: { name: "크게", w: 240 } };
const ROUTE = { curve: "곡선", ortho: "직각", line: "직선" };
const HEADSZ = { s: { name: "작게", m: 0.72 }, m: { name: "보통", m: 1 }, l: { name: "크게", m: 1.5 }, xl: { name: "아주 크게", m: 2.1 } };
/* 카드에서 무엇을 크게 볼지 — 페이지 이름은 그대로 두고 아래 항목만 바뀐다 */
const FOCUS = {
  all:       { name: "전체", ico: "density" },
  simple:    { name: "간단", ico: "density" },
  camp:      { name: "캠페인 위주", ico: "mega", c: "var(--camp)" },
  amplitude: { name: "Amplitude 위주", ico: "amp", c: "var(--amp)" },
  braze:     { name: "Braze 위주", ico: "braze", c: "var(--braze)" },
  ga4:       { name: "GA4 위주", ico: "ga4", c: "var(--ga4)" },
  incomplete:{ name: "미완성만", ico: "alert", c: "var(--warn)" }
};
/* 데이터 완성도 — 화면 이미지·태그가 없는 페이지를 놓치지 않도록 */
function completeness(n) {
  const missing = [];
  if (!thumbSrc(n)) missing.push("화면 이미지 없음");
  if (!n.tags.length) missing.push("태그 없음");
  return missing;
}
const ANCHOR = { auto: "자동", n: "위", e: "오른쪽", s: "아래", w: "왼쪽" };
const DOC_W = 390, DOC_H = 844;
const GRID = 22;

/* ---------------- 시드 데이터 ---------------- */
function seed() {
  const N = (id, kind, name, path, x, y, note, style) => Object.assign({
    id, kind, name, path, x, y, note: note || "", shot: null, shotData: null, thumb: null,
    shotW: DOC_W, shotH: DOC_H, hue: "none", size: "m", sharp: false, tags: [], camps: [], layers: []
  }, style || {});
  const T = (platform, event, trigger, selector, status, props, note, extra) => {
    const ex = extra || {}, ts = ex.testSamples || {};
    return {
      id: uid("t"), platforms: ex.platforms || [platform],
      screenKo: ex.screenKo || "", path: ex.path || "",
      eventKo: ex.eventKo || "", eventEn: event,
      area: selector || "", trigger, channels: ex.channels || [], action: ex.action || "",
      props: (props || []).map(p => ({
        ko: p.ko || "", en: p.en || p.k || "",
        type: p.type || (PTYPE[p.v] ? p.v : "string"),
        sample: p.sample != null ? p.sample : (PTYPE[p.v] ? "" : (p.v || ""))
      })),
      status, note: note || "",
      testSampleWebPc: ts.web_pc || "", testSampleWebMo: ts.web_mo || "",
      testSampleAppAos: ts.app_aos || "", testSampleAppIos: ts.app_ios || ""
    };
  };
  const C = (name, chan, segment, timing, status, extId, landing, note) =>
    ({ id: uid("c"), name, chan, segment, timing, status, extId: extId || "", landing: landing || "", note: note || "" });

  const nodes = [
    N("n1", "entry", "앱 실행 · 스플래시", "app://launch", 66, 88, "", { hue: "slate", size: "s" }),
    N("n2", "page", "홈 (비회원)", "/home", 330, 88, "로그인 없이 진입하는 첫 화면. 상단 배너 3종 롤링.", { hue: "blue" }),
    N("n3", "page", "카테고리 · 검색", "/category", 594, 88),
    N("n4", "page", "상품 상세", "/product/:id", 858, 88, "옵션 변경 시 같은 화면에서 재조회.", { hue: "blue" }),
    N("n5", "decision", "로그인 · 회원가입", "/auth", 1122, 88, "구매·찜 시도 시 노출되는 분기 지점.", { hue: "amber" }),
    N("n9", "exit", "이탈 (앱 종료)", "app://exit", 330, 374, "", { hue: "red", size: "s" }),
    N("n6", "page", "장바구니", "/cart", 858, 374, "", { hue: "green" }),
    N("n7", "page", "주문서 · 결제", "/checkout", 1122, 374, "", { hue: "green" }),
    N("n8", "page", "주문 완료", "/order/complete", 1386, 374, "", { hue: "green" })
  ];
  const map = Object.fromEntries(nodes.map(n => [n.id, n]));

  map.n2.tags = [
    T("amplitude", "home_viewed", "view", "", "live",
      [{ ko: "배너 ID 목록", en: "banner_ids", type: "array", sample: "" }],
      "세션 첫 화면 진입 시 1회",
      {
        screenKo: "홈", eventKo: "홈 화면 노출", action: "화면 진입", channels: ["web_pc", "web_mo", "app_aos", "app_ios"],
        testSamples: { web_pc: '{"user_type":"guest","banner_ids":["b1","b2","b3"]}', app_aos: '{"user_type":"member","banner_ids":["b1"]}' }
      }),
    T("amplitude", "home_banner_clicked", "click", ".main-banner .slide", "live", [{ k: "banner_id", v: "string" }, { k: "slot", v: "1|2|3" }],
      "", { screenKo: "홈", eventKo: "홈 배너 클릭", action: "배너 슬라이드 탭", channels: ["web_pc", "web_mo"] }),
    T("braze", "Home Screen Viewed", "view", "", "live", [{ k: "is_logged_in", v: "boolean" }], "인앱 메시지 트리거 이벤트"),
    T("ga4", "screen_view", "view", "", "live", [{ k: "screen_name", v: "home" }, { k: "screen_class", v: "HomeActivity" }]),
    T("ga4", "select_promotion", "click", ".main-banner .slide", "todo", [{ k: "promotion_name", v: "string" }], "GA4 표준 이벤트로 교체 예정")
  ];
  map.n4.tags = [
    T("amplitude", "product_detail_viewed", "view", "", "live", [{ k: "product_id", v: "string" }, { k: "price", v: "number" }, { k: "soldout", v: "boolean" }]),
    T("amplitude", "add_to_cart_clicked", "click", "#btn-cart", "live", [{ k: "product_id", v: "string" }, { k: "option_id", v: "string" }, { k: "qty", v: "number" }]),
    T("braze", "Product Viewed", "view", "", "live", [{ k: "product_id", v: "string" }, { k: "category", v: "string" }], "가격 인하 푸시 세그먼트 소스"),
    T("ga4", "view_item", "view", "", "live", [{ k: "items", v: "array" }, { k: "value", v: "number" }]),
    T("ga4", "add_to_cart", "click", "#btn-cart", "live", [{ k: "items", v: "array" }])
  ];
  map.n5.tags = [
    T("amplitude", "login_attempted", "submit", "form#login", "live", [{ k: "method", v: "kakao | apple | email" }]),
    T("amplitude", "signup_completed", "submit", "form#signup", "live", [{ k: "method", v: "string" }, { k: "referrer_page", v: "string" }]),
    T("braze", "user_identified", "custom", "", "live", [{ k: "external_id", v: "string" }], "로그인 성공 직후 changeUser 호출")
  ];
  map.n6.tags = [
    T("amplitude", "cart_viewed", "view", "", "live", [{ k: "item_count", v: "number" }, { k: "cart_value", v: "number" }]),
    T("braze", "Cart Updated", "custom", "", "live", [{ k: "cart_value", v: "number" }], "장바구니 이탈 캠페인 트리거"),
    T("ga4", "view_cart", "view", "", "live", [{ k: "items", v: "array" }])
  ];
  map.n7.tags = [
    T("amplitude", "checkout_started", "view", "", "live", [{ k: "payment_method", v: "string" }]),
    T("ga4", "begin_checkout", "view", "", "todo", [{ k: "items", v: "array" }], "결제 리뉴얼 후 재검증 필요")
  ];
  map.n8.tags = [
    T("amplitude", "purchase_completed", "view", "", "live", [{ k: "order_id", v: "string" }, { k: "revenue", v: "number" }, { k: "coupon_id", v: "string" }]),
    T("braze", "purchase", "custom", "", "live", [{ k: "product_id", v: "string" }, { k: "price", v: "number" }], "Braze Purchase 객체로 전송"),
    T("ga4", "purchase", "view", "", "live", [{ k: "transaction_id", v: "string" }, { k: "value", v: "number" }])
  ];

  map.n2.camps = [
    C("첫 방문 15% 쿠폰팩", "inapp", "설치 후 7일 이내 · 비회원", "홈 진입 3초 후", "live", "BRZ-INAPP-1042", "/promo/welcome", "홈 진입 이벤트 트리거. 세션당 1회 캡."),
    C("시즌 기획전 상단 띠배너", "banner", "전체", "상시", "live", "CMS-BNR-208", "/event/season")
  ];
  map.n4.camps = [C("찜한 상품 가격 인하 알림", "push", "Product Viewed 3일 내 · 미구매", "가격 변동 감지 시", "live", "BRZ-PUSH-3310", "/product/:id")];
  map.n6.camps = [C("장바구니 이탈 리마인드", "push", "Cart Updated 후 4시간 미결제", "4시간 지연 발송", "live", "BRZ-PUSH-2871", "/cart", "1일 1회 · 야간 발송 제외")];
  map.n8.camps = [C("첫 구매 감사 · 리뷰 요청", "kakao", "첫 주문 완료 회원", "배송 완료 D+2", "test", "KKO-1180", "/review/write")];
  map.n9.camps = [C("미전환 이탈 리마케팅", "email", "3일 내 방문 · 장바구니 0", "D+3 오전 10시", "draft", "BRZ-EMAIL-770", "/home")];

  const E = (from, to, label, style, extra) => Object.assign({
    id: uid("e"), from, to, label: label || "", style: style || "solid", kind: "arrow",
    route: "curve", hue: "none", width: 2, head: "m", a1: "auto", a2: "auto", points: []
  }, extra || {});
  const edges = [
    E("n1", "n2", "앱 진입"),
    E("n2", "n3", "카테고리 탐색"),
    E("n3", "n4", "상품 선택"),
    E("n4", "n6", "장바구니 담기", "solid", { hue: "green" }),
    E("n4", "n5", "구매·찜 시도", "dashed", { hue: "amber" }),
    E("n5", "n6", "로그인 완료"),
    E("n6", "n7", "주문하기", "solid", { hue: "green" }),
    E("n7", "n8", "결제 성공", "solid", { hue: "green" }),
    E("n2", "n9", "미전환 이탈", "dashed", { hue: "red" }),
    E("n9", "n2", "리마케팅 복귀", "dashed", { hue: "violet", route: "ortho" })
  ];
  return {
    v: 2, title: "고객 여정 태그 맵", updatedAt: 0, bi: 0,
    boards: [{ id: "b1", name: "커머스 앱 · 구매 여정", nodes, edges, lanes: [], sel: "n2", view: { zoom: 0.72, panX: 24, panY: 12, fitted: false } }],
    ui: { flowH: 372, leftW: 274, rightW: 300, focus: "all", snap: true },
    /* 문서 전체 태그가 공유하는 속성 — 어느 태그에서 값을 바꾸거나 체크를 해제해도 모든 태그에 반영된다 */
    commonProps: [{ ko: "사용자 유형", en: "user_type", type: "string", sample: "guest" }]
  };
}

/* ---------------- 상태 ---------------- */
let state = seed();
let sel = { node: "n2", edge: null, layer: null };
let stageZoom = 1;               // 기본값 100% · null = 맞춤 모드 (stageFitMode 방식대로 자동 계산)
let stageFitMode = "width";      // 맞춤 모드일 때 계산 방식: width(가로 맞춤, 기본) · height(세로 맞춤) · contain(전체 화면 맞춤)
const STAGE_FIT = {
  width: { name: "가로 맞춤" },
  height: { name: "세로 맞춤" },
  contain: { name: "전체 화면 맞춤" }
};
let layerTool = "select";
let drawColor = SWATCH[0];
let drawStroke = 3;
let dirty = false;
let savedRefs = [];              // 마지막 저장 시점에 쓰이던 이미지 파일 목록
const DRAFT_KEY = "draft:" + location.pathname;

const B = () => state.boards[state.bi] || state.boards[0];
const nodeById = id => B().nodes.find(n => n.id === id);
const curNode = () => nodeById(sel.node);
const edgeById = id => B().edges.find(e => e.id === id);
/* 태그·캠페인 목록은 모든 보드를 한 번에 본다 */
const allTags = () => state.boards.reduce((a, b) => a.concat(b.nodes.reduce((c, n) => c.concat(n.tags.map(t => ({ t, n, b }))), [])), []);
const allCamps = () => state.boards.reduce((a, b) => a.concat(b.nodes.reduce((c, n) => c.concat(n.camps.map(x => ({ c: x, n, b }))), [])), []);
const hueOf = k => (HUE[k] || HUE.none).c;

/* ---------------- 화면 이미지 주소 ----------------
   n.shotData = 아직 저장 안 된 원본(dataURL)
   n.shot     = {ref,w,h} 저장된 파일 · {url,w,h} 외부 호스팅 주소 */
function shotSrc(n) {
  if (!n) return null;
  if (n.shotData) return n.shotData;
  if (typeof n.shot === "string") return n.shot;          // 예전 인라인 형식
  if (n.shot && n.shot.url) return n.shot.url;
  if (n.shot && n.shot.ref) return "data/" + n.shot.ref;
  return null;
}
function thumbSrc(n) { return n && (n.thumb || shotSrc(n)); }
function dataUrlToBlob(u) {
  const i = u.indexOf(","), head = u.slice(0, i), b64 = u.slice(i + 1);
  const mime = (/:(.*?);/.exec(head) || [, "image/jpeg"])[1];
  const bin = atob(b64), arr = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
  return new Blob([arr], { type: mime });
}
function extOf(mime) { return mime.indexOf("webp") > 0 ? "webp" : mime.indexOf("png") > 0 ? "png" : "jpg"; }

/* ---------------- IndexedDB 임시 저장 ---------------- */
let dbPromise = null;
function idb() {
  if (!dbPromise) dbPromise = new Promise((res, rej) => {
    const r = indexedDB.open("jta-db", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbPromise;
}
async function idbSet(k, v) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction("kv", "readwrite");
    t.objectStore("kv").put(v, k);
    t.oncomplete = () => res(); t.onerror = () => rej(t.error);
  });
}
async function idbGet(k) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction("kv", "readonly"), q = t.objectStore("kv").get(k);
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
}
/* ---------------- 토스트 ---------------- */
function toast(msg, kind, action) {
  const el = document.createElement("div");
  el.className = "toast " + (kind || "");
  el.textContent = msg;
  if (action) {
    const b = document.createElement("button");
    b.className = "btn sm"; b.textContent = action.label;
    b.onclick = () => { el.remove(); action.fn(); };
    el.appendChild(b); el.style.pointerEvents = "auto";
  }
  $("#toast").appendChild(el);
  setTimeout(() => { el.style.transition = "opacity .3s"; el.style.opacity = "0"; setTimeout(() => el.remove(), 320); }, action ? 6000 : 2600);
}

/* ---------------- 저장 ---------------- */
let draftTimer = null;
function markDirty() {
  if (!dirty) { dirty = true; setSaveChip("dirty", "저장 안 됨"); }
  invalidateViews();
  scheduleHistory();
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 900);
}
function saveDraft() {
  const run = () => idbSet(DRAFT_KEY, { data: state, savedAt: Date.now(), base: state.updatedAt, refs: savedRefs }).catch(() => {});
  if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 2500 }); else setTimeout(run, 0);
}
function setSaveChip(st, text) {
  const c = $("#saveChip"); c.dataset.state = st; $("#saveText").textContent = text;
}

/* 저장용 스냅샷: 이미지를 파일(또는 호스팅 URL)로 분리하고 JSON에는 참조만 남긴다 */
function buildSnapshot() {
  const uploads = [], used = [];
  const boards = state.boards.map(b => {
    const nodes = b.nodes.map(n => {
      const c = Object.assign({}, n);
      delete c.shotData; delete c.shotDirty;
      const legacy = typeof n.shot === "string" ? n.shot : null;
      const raw = n.shotDirty && n.shotData ? n.shotData : legacy;
      if (raw) {
        const blob = dataUrlToBlob(raw);
        const ref = "img/" + n.id + "-" + Date.now().toString(36) + "." + extOf(blob.type);
        uploads.push({ ref, blob, node: n, board: b });
        c.shot = { ref, w: n.shotW, h: n.shotH };
      } else if (n.shot && n.shot.path) c.shot = { path: n.shot.path, w: n.shot.w, h: n.shot.h };  // 서버 저장소
      else if (n.shot && n.shot.url) c.shot = { url: n.shot.url, w: n.shot.w, h: n.shot.h };
      else if (n.shot && n.shot.ref) c.shot = { ref: n.shot.ref, w: n.shot.w, h: n.shot.h };
      else c.shot = null;
      if (c.shot && c.shot.ref) used.push(c.shot.ref);
      return c;
    });
    return Object.assign({}, b, { nodes });
  });
  const data = Object.assign({}, state, { boards, updatedAt: Date.now() });
  const removals = savedRefs.filter(r => used.indexOf(r) < 0);
  return {
    data, uploads, removals, used,
    commit() {
      state.boards.forEach((b, bi) => b.nodes.forEach((n, i) => { n.shot = boards[bi].nodes[i].shot; n.shotDirty = false; }));
      state.updatedAt = data.updatedAt;
      savedRefs = used;
    }
  };
}
function timeAgo(ts) {
  if (!ts) return "방금";
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return "방금";
  if (d < 3600) return Math.floor(d / 60) + "분 전";
  if (d < 86400) return Math.floor(d / 3600) + "시간 전";
  return new Date(ts).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}
async function saveFile(filename, text, mime) {
  try {
    const blob = new Blob([text], { type: (mime || "application/octet-stream") + ";charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.style.display = "none";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(filename + " 저장 완료", "ok");
    return;
  } catch (e) { /* 브라우저가 다운로드를 막은 드문 경우에만 아래 클립보드 폴백으로 온다 */ }
  try { await navigator.clipboard.writeText(text); toast("다운로드가 막혀 있어 클립보드에 복사했습니다.", "ok"); }
  catch (e) { toast("파일을 내보낼 수 없습니다.", "bad"); }
}

/* ---------------- 모달 ---------------- */
function modalHost() {                    // 이전 모달의 이벤트 리스너까지 버린다
  const old = $("#modalRoot"), fresh = old.cloneNode(false);
  old.replaceWith(fresh);
  return fresh;
}
function closeModal() { modalHost(); }
function fieldRow(f, vals) {
  const v = vals[f.k];
  if (f.type === "select") {
    const os = Object.entries(f.opts).map(([k, o]) => '<option value="' + k + '"' + (v === k ? " selected" : "") + ">" + esc(typeof o === "string" ? o : o.name) + "</option>").join("");
    return '<div class="frow"><span class="lbl">' + esc(f.label) + '</span><select class="field" data-k="' + f.k + '">' + os + "</select></div>";
  }
  if (f.type === "swatch") {
    return '<div class="frow"><span class="lbl">' + esc(f.label) + '</span><div class="hues" data-hue="' + f.k + '">' +
      Object.entries(HUE).map(([k, h]) => '<button type="button" class="hue' + (v === k ? " on" : "") + '" data-v="' + k + '" title="' + h.name +
        '" style="--h:' + h.c + '"></button>').join("") + "</div></div>";
  }
  if (f.type === "multi") {
    const sel = v || [];
    return '<div class="frow"><span class="lbl">' + esc(f.label) + '</span><div class="seg-check" data-multi="' + f.k + '">' +
      Object.entries(f.opts).map(([k, o]) => '<label class="chkbtn"><input type="checkbox" data-mc="' + f.k + '" value="' + k + '"' +
        (sel.indexOf(k) >= 0 ? " checked" : "") + ">" + esc(typeof o === "string" ? o : o.name) + "</label>").join("") + "</div></div>";
  }
  if (f.type === "textarea")
    return '<div class="frow"><span class="lbl">' + esc(f.label) + '</span><textarea class="field' + (f.mono ? " mono" : "") + '" data-k="' + f.k + '" placeholder="' + esc(f.ph || "") + '">' + esc(v || "") + "</textarea></div>";
  if (f.type === "kv") {
    const items = (v || []).map(kvRow).join("");
    return '<div class="frow"><span class="lbl">' + esc(f.label) + '</span><div class="proplist" data-kv="' + f.k + '">' + items +
      '</div><button class="btn sm" data-addkv="' + f.k + '" type="button">' + ico("plus", "xs") + "속성 추가</button></div>";
  }
  if (f.type === "links") {
    const items = (v || []).map(linkRow).join("");
    return '<div class="frow"><span class="lbl">' + esc(f.label) + '</span><div class="linklist" data-links="' + f.k + '">' + items +
      '</div><button class="btn sm" data-addlink="' + f.k + '" type="button">' + ico("plus", "xs") + "링크 추가</button></div>";
  }
  if (f.type === "readonly")
    return '<div class="frow"><span class="lbl">' + esc(f.label) + '</span><div class="ro' + (f.mono ? " mono" : "") + '">' + esc(v || "-") + "</div></div>";
  if (f.type === "check")
    return '<label class="bulkbar"><input type="checkbox" data-c="' + f.k + '"' + (v ? " checked" : "") + "> " + esc(f.label) + "</label>";
  if (f.type === "action")
    return '<div class="frow"><span class="lbl">' + esc(f.label) + '</span><button type="button" class="btn sm" data-action="' + f.k + '">' +
      (f.icon ? ico(f.icon, "xs") : "") + esc(f.actionLabel || f.label) + "</button></div>";
  if (f.type === "group")
    return '<details class="fgroup"' + (f.open ? " open" : "") + "><summary>" + esc(f.label) + '</summary><div class="fgroup-body">' +
      f.fields.map(sub => fieldRow(sub, vals)).join("") + "</div></details>";
  return '<div class="frow"><span class="lbl">' + esc(f.label) + '</span><input class="field' + (f.mono ? " mono" : "") + '" data-k="' + f.k + '" value="' + esc(v || "") + '" placeholder="' + esc(f.ph || "") + '"></div>';
}
/* 속성(영문 key)로 테스트 샘플 JSON 안을 재귀 탐색해 값을 자동으로 채운다 */
function deepFindKey(obj, key) {
  if (obj && typeof obj === "object") {
    if (!Array.isArray(obj) && Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
    for (const k of Object.keys(obj)) {
      const r = deepFindKey(obj[k], key);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}
/* samples: 원문 텍스트(JSON 또는 대충 쓴 key:value) 배열에서 key를 찾아 값을 돌려준다.
   저장 시 자동 채우기(반자동)와 폼 안의 "자동" 버튼이 이 함수를 함께 쓴다. */
function findValueInSamples(samples, key) {
  for (const raw of (samples || [])) {
    const s = raw && String(raw).trim();
    if (!s) continue;
    try {
      const v = deepFindKey(JSON.parse(s), key);
      if (v !== undefined) return typeof v === "object" ? JSON.stringify(v) : String(v);
    } catch (e) {
      const m = new RegExp('["\']?' + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '["\']?\\s*[:=]\\s*("(?:[^"\\\\]|\\\\.)*"|[^,\\n}]+)').exec(s);
      if (m) return m[1].trim().replace(/^"(.*)"$/, "$1");
    }
  }
  return undefined;
}
function findSampleValue(root, key) {
  const keys = ["testSampleWebPc", "testSampleWebMo", "testSampleAppAos", "testSampleAppIos"];
  return findValueInSamples(keys.map(k => { const el = $('[data-k="' + k + '"]', root); return el ? el.value : ""; }), key);
}
function openForm(opt) {
  const vals = Object.assign({}, opt.values);
  const rows = opt.fields.map(f => fieldRow(f, vals)).join("");

  const root = modalHost();
  root.innerHTML =
    '<div class="scrim"><div class="modal glass" role="dialog" aria-modal="true">' +
      '<div class="modal-head">' + ico(opt.icon || "edit") + "<h3>" + esc(opt.title) + '</h3><button class="btn icon sm" data-x>' + ico("close", "xs") + "</button></div>" +
      '<div class="modal-body">' + rows + (opt.note ? '<p class="hint">' + opt.note + "</p>" : "") + "</div>" +
      '<div class="modal-foot">' + (opt.onDelete ? '<button class="btn danger" data-del>' + ico("trash", "xs") + (opt.deleteText || "삭제") + "</button>" : "") +
        '<div class="spacer"></div><button class="btn" data-x>취소</button><button class="btn primary" data-ok>' + esc(opt.okText || "저장") + "</button></div>" +
    "</div></div>";

  const collect = () => {
    const out = Object.assign({}, vals);
    $$("[data-k]", root).forEach(el => { out[el.dataset.k] = el.value.trim(); });
    $$("[data-c]", root).forEach(el => { out[el.dataset.c] = el.checked; });
    $$("[data-hue]", root).forEach(box => { const on = $(".hue.on", box); out[box.dataset.hue] = on ? on.dataset.v : "none"; });
    const multiGroups = {};
    $$("[data-mc]", root).forEach(el => { (multiGroups[el.dataset.mc] = multiGroups[el.dataset.mc] || []).push(el); });
    Object.entries(multiGroups).forEach(([k, els]) => { out[k] = els.filter(e => e.checked).map(e => e.value); });
    $$("[data-kv]", root).forEach(box => {
      out[box.dataset.kv] = $$(".proprow", box).map(r => ({
        ko: $('[data-pf="ko"]', r).value.trim(), en: $('[data-pf="en"]', r).value.trim(),
        type: $('[data-pf="type"]', r).value, sample: $('[data-pf="sample"]', r).value.trim(),
        common: $('[data-pf="common"]', r).checked
      })).filter(p => p.ko || p.en || p.sample);
    });
    $$("[data-links]", root).forEach(box => {
      out[box.dataset.links] = $$(".linkrow", box).map(r => ({
        label: $('[data-lf="label"]', r).value.trim(), url: $('[data-lf="url"]', r).value.trim()
      })).filter(l => l.label || l.url);
    });
    return out;
  };
  root.addEventListener("click", e => {
    const t = e.target;
    /* 입력 중인 수정 창은 배경(scrim)을 눌러도 닫히지 않게 한다 — 편집 도중
       실수로 바깥을 눌러 작성 중이던 내용을 잃어버리는 사고를 막기 위함.
       닫으려면 X · 취소 버튼이나 Esc를 쓴다. */
    if (t.closest("[data-x]")) { closeModal(); if (opt.onClose) opt.onClose(); return; }
    const act = t.closest("[data-action]");
    if (act && opt.onAction) { opt.onAction(act.dataset.action, collect); return; }
    const hue = t.closest(".hue");
    if (hue) { $$(".hue", hue.parentNode).forEach(h => h.classList.toggle("on", h === hue)); return; }
    if (t.closest("[data-addkv]")) {
      const k = t.closest("[data-addkv]").dataset.addkv;
      $('[data-kv="' + k + '"]', root).insertAdjacentHTML("beforeend", kvRow({ ko: "", en: "", type: "string", sample: "" }));
    }
    if (t.closest("[data-rmkv]")) t.closest(".proprow").remove();
    const auto = t.closest("[data-autoprop]");
    if (auto) {
      const row = auto.closest(".proprow"), en = $('[data-pf="en"]', row).value.trim(), sampleEl = $('[data-pf="sample"]', row);
      if (!en) { toast("영문 key를 먼저 입력하세요", "bad"); return; }
      const found = findSampleValue(root, en);
      if (found === undefined) toast("테스트 샘플에서 '" + en + "' 키를 찾지 못했습니다", "bad");
      else { sampleEl.value = found; toast("샘플값을 채웠습니다", "ok"); }
      return;
    }
    if (t.closest("[data-addlink]")) {
      const k = t.closest("[data-addlink]").dataset.addlink;
      $('[data-links="' + k + '"]', root).insertAdjacentHTML("beforeend", linkRow({ label: "", url: "" }));
    }
    if (t.closest("[data-rmlink]")) t.closest(".linkrow").remove();
    const goLink = t.closest("[data-gotolink]");
    if (goLink) {
      const row = goLink.closest(".linkrow"), url = $('[data-lf="url"]', row).value.trim();
      if (!url) toast("링크를 먼저 입력하세요", "bad"); else openUrl(url);
      return;
    }
    if (t.closest("[data-del]")) { closeModal(); opt.onDelete(); }
    if (t.closest("[data-ok]")) { const d = collect(); closeModal(); opt.onSave(d); }
  });
  /* 스프레드시트에서 여러 줄(한글\t영문\t타입\t샘플)을 그대로 복사해 붙여넣으면
     칸마다 자동으로 나눠 채우고, 모자란 줄은 새 속성 행으로 늘려준다. */
  root.addEventListener("paste", e => {
    const el = e.target;
    if (!el.matches || !el.matches('[data-pf]')) return;
    const text = (e.clipboardData || window.clipboardData).getData("text");
    if (!text || (text.indexOf("\t") < 0 && text.indexOf("\n") < 0)) return;   // 일반 값 하나는 기본 붙여넣기 그대로 둔다
    e.preventDefault();
    const box = el.closest("[data-kv]"); if (!box) return;
    const colOrder = ["ko", "en", "type", "sample"];
    const startIdx = colOrder.indexOf(el.dataset.pf);
    const startRowIdx = $$(".proprow", box).indexOf(el.closest(".proprow"));
    const lines = text.replace(/\r/g, "").split("\n").filter(l => l.length);
    lines.forEach((line, i) => {
      let rows = $$(".proprow", box), row = rows[startRowIdx + i];
      if (!row) { box.insertAdjacentHTML("beforeend", kvRow({ ko: "", en: "", type: "string", sample: "" })); rows = $$(".proprow", box); row = rows[rows.length - 1]; }
      line.split("\t").forEach((val, ci) => {
        const col = colOrder[startIdx + ci], input = col && $('[data-pf="' + col + '"]', row);
        if (!input) return;
        input.value = col === "type" ? resolvePropType(val) : val.trim();
      });
    });
    toast(lines.length + "개 속성을 붙여넣었습니다", "ok");
  });
  root.addEventListener("keydown", e => { if (e.key === "Escape") { closeModal(); if (opt.onClose) opt.onClose(); } });
  const first = $(".field", root); if (first) first.focus();
}
/* 붙여넣은 타입 텍스트를 select의 실제 값으로 매칭한다 — 한글 라벨(문자열·숫자…)과
   스프레드시트에서 흔한 영어 타입 이름(String·Number…) 둘 다 인식한다. */
const PTYPE_ALIAS = { string: "string", str: "string", text: "string", number: "number", num: "number", int: "number",
  float: "number", boolean: "boolean", bool: "boolean", array: "array", list: "array", object: "object", obj: "object", json: "object" };
function resolvePropType(raw) {
  const s = String(raw || "").trim();
  if (!s) return "string";
  const byLabel = keyByLabel(PTYPE, s, null);
  if (byLabel) return byLabel;
  return PTYPE_ALIAS[s.toLowerCase()] || "string";
}
function kvRow(p) {
  return '<div class="proprow">' +
    '<label class="propchk" title="공통 속성 — 체크하면 이 문서의 모든 태그에 같은 속성이 자동으로 표시되고, 값을 바꾸거나 체크를 지우면 모든 태그에 함께 반영됩니다">' +
      '<input type="checkbox" data-pf="common"' + (p.common ? " checked" : "") + "></label>" +
    '<input class="field" data-pf="ko" value="' + esc(p.ko || "") + '" placeholder="속성명(한글)">' +
    '<input class="field mono" data-pf="en" value="' + esc(p.en || "") + '" placeholder="영문 key">' +
    '<select class="field" data-pf="type">' + Object.entries(PTYPE).map(([k, name]) =>
      '<option value="' + k + '"' + ((p.type || "string") === k ? " selected" : "") + ">" + name + "</option>").join("") + "</select>" +
    '<input class="field mono" data-pf="sample" value="' + esc(p.sample || "") + '" placeholder="샘플값">' +
    '<button class="btn icon sm" data-autoprop type="button" title="테스트 샘플에서 자동 채우기">' + ico("search", "xs") + "</button>" +
    '<button class="btn icon sm" data-rmkv type="button" title="삭제">' + ico("close", "xs") + "</button>" +
  "</div>";
}
function linkRow(l) {
  return '<div class="linkrow">' +
    '<input class="field" data-lf="label" value="' + esc(l.label || "") + '" placeholder="링크 이름 (예: 소재 시안)">' +
    '<input class="field mono" data-lf="url" value="' + esc(l.url || "") + '" placeholder="https://...">' +
    '<button class="btn icon sm" data-gotolink type="button" title="바로가기">' + ico("link", "xs") + "</button>" +
    '<button class="btn icon sm" data-rmlink type="button" title="삭제">' + ico("close", "xs") + "</button>" +
  "</div>";
}
/* http(s) 접두어 없이 입력해도 새 탭에서 열리게 보정한다.
   window.open()이 팝업 차단에 막히는 경우가 있어, 실제 <a target="_blank"> 클릭을
   흉내 내는 방식을 우선 쓰고 실패하면 window.open으로 폴백한다. */
function openUrl(url) {
  const u = String(url || "").trim();
  if (!u) return;
  const href = /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : "https://" + u;
  try {
    const a = document.createElement("a");
    a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer";
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) {
    window.open(href, "_blank", "noopener");
  }
}
function confirmDel(msg, fn) {
  const root = modalHost();
  root.innerHTML = '<div class="scrim"><div class="modal glass" style="width:min(380px,100%)">' +
    '<div class="modal-body"><h3 style="margin:0;font-size:14.5px">' + esc(msg) + "</h3><p class=\"hint\">되돌릴 수 없습니다.</p></div>" +
    '<div class="modal-foot"><button class="btn" data-x>취소</button><button class="btn primary" data-ok style="background:var(--bad)">삭제</button></div></div></div>';
  root.addEventListener("click", e => {
    if (e.target.closest("[data-x]") || e.target.classList.contains("scrim")) closeModal();
    if (e.target.closest("[data-ok]")) { closeModal(); fn(); }
  });
}
/* 취소 버튼 없는 진행바 모달 — 이미지 업로드처럼 닫을 수 없는(중간에 끊으면 데이터가 애매해지는) 작업에 쓴다 */
function openProgressModal(title) {
  const root = modalHost();
  root.innerHTML =
    '<div class="scrim"><div class="modal glass" style="width:min(420px,100%)" role="dialog" aria-modal="true">' +
      '<div class="modal-head">' + ico("up") + "<h3>" + esc(title) + "</h3></div>" +
      '<div class="modal-body">' +
        '<div class="pbar"><div class="pbar-fill" id="pbarFill" style="width:0%"></div></div>' +
        '<p class="hint" id="pbarText">준비 중…</p>' +
      "</div>" +
    "</div></div>";
  return {
    update(done, total) {
      const pct = total ? Math.round(done / total * 100) : 0;
      const fill = $("#pbarFill"), text = $("#pbarText");
      if (fill) fill.style.width = pct + "%";
      if (text) text.textContent = done + " / " + total + "개 업로드 중… (" + pct + "%)";
    },
    close() { closeModal(); }
  };
}
