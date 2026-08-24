
/* ========================================================================
   구글 로그인 · 회원 권한 (Supabase)
   - SDK 없이 REST/Auth 엔드포인트만 fetch 로 호출한다 (단일 HTML 유지)
   - 권한은 서버(RLS)에서 강제된다. 아래 UI 숨김은 편의일 뿐 방어선이 아니다.
   - 배포한 사이트에서만 동작한다. claude.ai Artifact 안에서는 외부 도메인
     접근이 차단되므로 로그인 버튼이 나타나지 않는다.
   ======================================================================== */
const SUPA_DEFAULT = { url: "", anon: "", bucket: "jta-images", docId: "main" };
const SUPA_KEY = "jta:supabase";
const SESS = "jta:session";
const ROLE = {
  server_admin: { name: "서버관리자", c: "var(--bad)" },
  operator:     { name: "운영자",     c: "var(--accent)" },
  viewer:       { name: "일반회원",   c: "var(--ink-3)" }
};
let me = null;                    // { id, email, name, avatar, role }
let session = null;               // { access_token, refresh_token, expires_at }
let docStamp = null;              // 서버가 준 updated_at — 덮어쓰기 충돌 감지용

function supaCfg() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SUPA_KEY) || "null"); } catch (e) {}
  return Object.assign({}, SUPA_DEFAULT, saved || {});
}
function supaOn() { const c = supaCfg(); return !!(c.url && c.anon); }
function myRole() { return me ? me.role : null; }
function isStaff() { return myRole() === "server_admin" || myRole() === "operator"; }

/* ---------------- 세션 ---------------- */
function saveSession(s) {
  session = s;
  try { s ? localStorage.setItem(SESS, JSON.stringify(s)) : localStorage.removeItem(SESS); } catch (e) {}
}
function loadSession() {
  try { session = JSON.parse(localStorage.getItem(SESS) || "null"); } catch (e) { session = null; }
  return session;
}
function readCallback() {                        // 로그인 후 되돌아온 주소의 #토큰
  const h = location.hash || "";
  if (h.indexOf("access_token=") < 0) return false;
  const q = new URLSearchParams(h.slice(1));
  saveSession({
    access_token: q.get("access_token"),
    refresh_token: q.get("refresh_token"),
    expires_at: Date.now() + (Number(q.get("expires_in")) || 3600) * 1000
  });
  history.replaceState(null, "", location.pathname + location.search);
  return true;
}
async function ensureToken() {
  if (!session) return null;
  if (session.expires_at - Date.now() > 60000) return session.access_token;
  const c = supaCfg();
  try {
    const r = await fetch(c.url + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: c.anon, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    if (!r.ok) throw new Error("refresh");
    const j = await r.json();
    saveSession({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000 });
    return session.access_token;
  } catch (e) { saveSession(null); me = null; return null; }
}
async function sapi(path, opts) {
  const c = supaCfg(), token = await ensureToken();
  const o = Object.assign({ headers: {} }, opts || {});
  o.headers = Object.assign({ apikey: c.anon, Authorization: "Bearer " + (token || c.anon) }, o.headers);
  const r = await fetch(c.url + path, o);
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    const err = new Error(txt || r.status);
    err.status = r.status;
    throw err;
  }
  return r.status === 204 ? null : r.json().catch(() => null);
}

/* ---------------- 로그인 · 프로필 ---------------- */
function signIn() {
  const c = supaCfg();
  const back = location.origin + location.pathname;
  location.href = c.url + "/auth/v1/authorize?provider=google&redirect_to=" + encodeURIComponent(back);
}
async function signOut() {
  try { await sapi("/auth/v1/logout", { method: "POST" }); } catch (e) {}
  saveSession(null); me = null;
  applyRoleUI(); applyMode();
  toast("로그아웃했습니다");
}
async function fetchMe() {
  if (!session) { me = null; return null; }
  try {
    const u = await sapi("/auth/v1/user", {});
    if (!u || !u.id) throw new Error("no user");
    let rows = await sapi("/rest/v1/jta_members?select=*&id=eq." + u.id, {});
    let p = rows && rows[0];
    if (!p) {                                   // 트리거가 아직 안 만든 경우 대비
      await new Promise(r => setTimeout(r, 800));
      rows = await sapi("/rest/v1/jta_members?select=*&id=eq." + u.id, {});
      p = rows && rows[0];
    }
    me = p ? { id: p.id, email: p.email, name: p.name || p.email, avatar: p.avatar, role: p.role }
           : { id: u.id, email: u.email, name: u.email, avatar: null, role: "viewer" };
  } catch (e) { me = null; saveSession(null); }
  return me;
}

/* ---------------- 문서 읽기 · 쓰기 ---------------- */
async function serverLoad() {
  const c = supaCfg();
  const rows = await sapi("/rest/v1/jta_docs?select=*&id=eq." + encodeURIComponent(c.docId), {});
  const row = rows && rows[0];
  if (!row) return false;
  docStamp = row.updated_at;
  const data = normalize(row.data && row.data.boards ? row.data : (row.data || {}));
  await signImages(data);
  state = data;
  savedRefs = [];
  const b = state.boards[state.bi] || state.boards[0];
  sel = { node: b.sel && b.nodes.some(n => n.id === b.sel) ? b.sel : (b.nodes[0] || {}).id || null, edge: null, layer: null };
  mounted = { id: null, src: null, w: 0, h: 0 };
  $("#nodeLayer").innerHTML = "";
  Object.keys(EDGE_EL).forEach(k => { EDGE_EL[k].g.remove(); delete EDGE_EL[k]; });
  dirty = false;
  renderAll();
  setSaveChip("ok", "서버 · " + timeAgo(new Date(row.updated_at).getTime()));
  return true;
}
async function signImages(data) {                 // 비공개 버킷 → 7일짜리 서명 주소
  const c = supaCfg();
  const paths = [];
  data.boards.forEach(b => b.nodes.forEach(n => { if (n.shot && n.shot.path) paths.push(n.shot.path); }));
  if (!paths.length) return;
  try {
    const res = await sapi("/storage/v1/object/sign/" + c.bucket, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 604800, paths })
    });
    const map = {};
    (res || []).forEach(r => { if (r.signedURL) map[r.path || r.signedURL] = c.url + "/storage/v1" + r.signedURL; });
    data.boards.forEach(b => b.nodes.forEach(n => {
      if (n.shot && n.shot.path && map[n.shot.path]) n.shot.url = map[n.shot.path];
    }));
  } catch (e) { /* 서명 실패 시 썸네일만 보인다 */ }
}
async function serverSave() {
  if (!me) { toast("먼저 구글 계정으로 로그인하세요", "bad"); return; }
  if (!isStaff()) { toast("편집 권한이 없습니다. 서버관리자에게 운영자 권한을 요청하세요.", "bad"); return; }
  const c = supaCfg();
  setSaveChip("dirty", "저장 중…");
  const snap = buildSnapshot();
  try {
    for (const u of snap.uploads) {              // 이미지 → Storage
      const path = u.ref.slice(4);
      await sapi("/storage/v1/object/" + c.bucket + "/" + path, {
        method: "POST",
        headers: { "Content-Type": u.blob.type, "x-upsert": "true" },
        body: u.blob
      });
      snap.data.boards.forEach(b => b.nodes.forEach(n => {
        if (n.id === u.node.id) n.shot = { path, w: u.node.shotW, h: u.node.shotH };
      }));
    }
    snap.uploads.length = 0;
    const body = { id: c.docId, title: state.title, data: snap.data, updated_at: new Date().toISOString(), updated_by: me.id };
    let res;
    if (docStamp) {                               // 내가 불러온 판본 위에만 덮어쓴다
      res = await sapi("/rest/v1/jta_docs?id=eq." + encodeURIComponent(c.docId) +
        "&updated_at=eq." + encodeURIComponent(docStamp), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify(body)
      });
      if (!res || !res.length) {                  // 아무 행도 안 바뀜 = 그 사이 누가 저장함
        setSaveChip("dirty", "저장 안 됨");
        return toast("다른 사람이 먼저 저장했습니다. 새로고침해 최신본을 받은 뒤 다시 저장하세요.", "bad");
      }
    } else {                                      // 문서가 아직 없다 → 새로 만든다
      res = await sapi("/rest/v1/jta_docs", {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(body)
      });
      if (!res || !res.length) throw new Error("문서를 만들지 못했습니다");
    }
    docStamp = res[0].updated_at;
    snap.commit();
    await signImages(state);
    dirty = false;
    mounted = { id: null, src: null, w: 0, h: 0 };
    renderFlow(); renderStage();
    setSaveChip("ok", "서버 저장됨 · 방금");
    toast("서버에 저장했습니다. 다른 사람도 새로고침하면 보입니다.", "ok");
  } catch (e) {
    setSaveChip("dirty", "저장 안 됨");
    toast("저장 실패: " + String(e.message || e).slice(0, 120), "bad");
  }
}

/* ---------------- 회원 관리 ---------------- */
async function openMembersModal() {
  if (!isStaff()) return;
  let rows = [];
  try { rows = await sapi("/rest/v1/jta_members?select=*&order=created_at.asc", {}) || []; }
  catch (e) { return toast("회원 목록을 불러오지 못했습니다", "bad"); }
  const canGrant = myRole() === "server_admin";
  const row = p => {
    const r = ROLE[p.role] || ROLE.viewer;
    return '<div class="brow" data-uid="' + p.id + '">' +
      (p.avatar ? '<img class="avatar" src="' + esc(p.avatar) + '" alt="">' : '<span class="avatar ph">' + ico("lock", "xs") + "</span>") +
      '<div class="fn">' + esc(p.name || p.email) + "<em>" + esc(p.email) + "</em></div>" +
      (canGrant
        ? '<select class="field" data-role="' + p.id + '">' + Object.entries(ROLE).map(([k, v]) =>
            '<option value="' + k + '"' + (p.role === k ? " selected" : "") + ">" + v.name + "</option>").join("") + "</select>"
        : '<span class="chip" style="--c:' + r.c + '">' + r.name + "</span>") +
      "</div>";
  };
  const root = modalHost();
  root.innerHTML =
    '<div class="scrim"><div class="modal glass" style="width:min(560px,100%)">' +
      '<div class="modal-head">' + ico("lock") + "<h3>회원 · 권한</h3><button class=\"btn icon sm\" data-x>" + ico("close", "xs") + "</button></div>" +
      '<div class="modal-body">' +
        '<p class="hint">권한은 서버에서 강제됩니다(브라우저를 고쳐도 우회되지 않습니다).<br>' +
        '<b>서버관리자</b> 모든 권한 + 권한 지정·양도 · <b>운영자</b> 권한 지정만 제외한 모든 편집 · <b>일반회원</b> 열람만(편집·다운로드·저장 불가)</p>' +
        '<div class="bulk">' + (rows.length ? rows.map(row).join("") : '<div class="empty">아직 가입한 사람이 없습니다</div>') + "</div>" +
        (canGrant ? '<p class="hint">역할을 바꾸면 즉시 저장됩니다. 서버관리자를 양도하려면 상대를 <b>서버관리자</b>로 올린 뒤 본인을 <b>운영자</b>로 내리세요.</p>'
                  : '<p class="hint">역할 변경은 서버관리자만 할 수 있습니다.</p>') +
      "</div>" +
      '<div class="modal-foot"><div class="spacer"></div><button class="btn primary" data-x>닫기</button></div>' +
    "</div></div>";
  root.addEventListener("click", e => { if (e.target.closest("[data-x]") || e.target.classList.contains("scrim")) closeModal(); });
  root.addEventListener("change", async e => {
    const s = e.target.closest("[data-role]"); if (!s) return;
    const id = s.dataset.role, role = s.value;
    try {
      await sapi("/rest/v1/jta_members?id=eq." + id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({ role })
      });
      toast("권한을 바꿨습니다", "ok");
      if (me && id === me.id) { await fetchMe(); applyRoleUI(); applyMode(); }
    } catch (err) {
      toast(String(err.message || err).indexOf("마지막 서버관리자") >= 0
        ? "마지막 서버관리자는 강등할 수 없습니다. 다른 사람을 먼저 서버관리자로 지정하세요."
        : "권한 변경 실패", "bad");
      openMembersModal();
    }
  });
}

/* ---------------- UI ---------------- */
function applyRoleUI() {
  const on = supaOn();
  const btn = $("#btnAuth"), label = $("#authName");
  btn.style.display = "";                       // 항상 보이게 — 설정 입구가 여기다
  document.body.classList.toggle("viewer", on && !isStaff());
  if (!on) {
    label.textContent = "로그인 설정";
    btn.classList.remove("on");
    btn.title = "구글 로그인을 쓰려면 Supabase 프로젝트를 연결하세요";
    $("use", btn).setAttribute("href", "#i-lock");
    return;
  }
  $("use", btn).setAttribute("href", me ? "#i-check" : "#i-lock");
  btn.title = me ? me.email : "구글 계정으로 로그인";
  if (me) {
    const r = ROLE[me.role] || ROLE.viewer;
    label.innerHTML = esc(me.name) + ' <span class="rolechip" style="--c:' + r.c + '">' + r.name + "</span>";
    $("#btnAuth").classList.add("on");
  } else {
    label.textContent = "구글로 로그인";
    $("#btnAuth").classList.remove("on");
  }
}
function openAuthMenu() {
  if (!supaOn()) return openServerModal();       // 아직 서버 미연결 → 설정부터
  if (!me) return signIn();
  openMenu(
    '<div class="mi" style="cursor:default">' + ico("check", "xs") + esc(me.email) + "</div>" +
    (isStaff() ? '<button class="mi" data-act="members">' + ico("lock", "xs") + "회원 · 권한 관리</button>" : "") +
    '<div class="sepline"></div>' +
    '<button class="mi" data-act="out">' + ico("close", "xs") + "로그아웃</button>",
    $("#btnAuth"), it => {
      if (it.dataset.act === "members") openMembersModal();
      if (it.dataset.act === "out") signOut();
    });
}
function openServerModal() {
  const c = supaCfg();
  openForm({
    title: "서버 연결 (Supabase)", icon: "share", okText: "저장하고 새로고침",
    deleteText: c.url ? "연결 해제" : null,
    note: "Supabase 프로젝트의 <b>Project URL</b>과 <b>anon public key</b>를 넣으면 구글 로그인·회원 권한·서버 저장이 켜집니다. " +
      "anon key는 공개되어도 되는 값이고, 실제 권한은 서버의 RLS 정책이 판단합니다.<br>" +
      "먼저 <span class=\"mono\">supabase/schema.sql</span>을 SQL Editor에서 한 번 실행하고, Authentication → Providers에서 Google을 켜 주세요. " +
      "이 설정은 배포된 사이트에서만 동작합니다(Artifact 화면 안에서는 외부 접속이 차단됩니다).",
    fields: [
      { k: "url", label: "Project URL", mono: true, ph: "https://xxxx.supabase.co" },
      { k: "anon", label: "anon public key", mono: true, ph: "eyJhbGciOi..." },
      { k: "bucket", label: "이미지 버킷", mono: true, ph: "jta-images" },
      { k: "docId", label: "문서 ID", mono: true, ph: "main" }
    ],
    values: c,
    onSave: v => {
      if (!v.url || !v.anon) { toast("URL과 anon key가 모두 필요합니다", "bad"); return; }
      try { localStorage.setItem(SUPA_KEY, JSON.stringify({ url: v.url.replace(/\/+$/, ""), anon: v.anon, bucket: v.bucket || "jta-images", docId: v.docId || "main" })); } catch (e) {}
      location.reload();
    },
    onDelete: c.url ? () => { try { localStorage.removeItem(SUPA_KEY); localStorage.removeItem(SESS); } catch (e) {} location.reload(); } : null
  });
}
function initAuth() {
  $("#btnAuth").addEventListener("click", openAuthMenu);
  applyRoleUI();
}
