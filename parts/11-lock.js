
/* ========================================================================
   관리자 모드 — 비밀번호를 아는 사람만 편집, 나머지는 보기 전용
   비밀번호 자체는 어디에도 저장하지 않는다. 저장되는 것은
   임의 salt + PBKDF2-SHA256 200,000회 해시뿐이라 파일을 열어봐도 원문이 없다.
   (다만 이 도구는 서버가 없으므로, 데이터 자체를 감추는 보안이 아니라
    "실수로 고치는 것"을 막는 편집 잠금이다. 아래 안내 문구로 명시한다.)
   ======================================================================== */
let admin = false;
const SESS_KEY = "jta:admin:" + location.pathname;
const PW_ITER = 200000;

function hasLock() { return !!(state.lock && state.lock.hash); }
function canEdit() {
  if (supaOn()) return isStaff();          // 서버 모드: 역할이 곧 권한 (서버에서 강제)
  return admin || !hasLock();
}
function subtleOK() { return !!(window.crypto && crypto.subtle && crypto.subtle.deriveBits); }

function b64(bytes) { let s = ""; bytes.forEach(b => s += String.fromCharCode(b)); return btoa(s); }
function unb64(str) { const bin = atob(str), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
async function derive(pw, saltB64, iter) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: unb64(saltB64), iterations: iter || PW_ITER, hash: "SHA-256" }, key, 256);
  return b64(new Uint8Array(bits));
}
async function setPassword(pw) {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  state.lock = { salt, iter: PW_ITER, hash: await derive(pw, salt, PW_ITER), changedAt: Date.now() };
  admin = true;
  try { sessionStorage.setItem(SESS_KEY, state.lock.hash); } catch (e) {}
  markDirty(); applyMode();
}
async function verifyPassword(pw) {
  if (!hasLock()) return true;
  const h = await derive(pw, state.lock.salt, state.lock.iter);
  return h === state.lock.hash;
}
function pwAgeDays() { return state.lock && state.lock.changedAt ? Math.floor((Date.now() - state.lock.changedAt) / 86400000) : null; }

function applyMode() {
  const ro = !canEdit();
  document.body.classList.toggle("ro", ro);
  const b = $("#btnLock");
  $("use", b).setAttribute("href", ro ? "#i-lock" : "#i-unlock");
  $("#lockText").textContent = ro ? "보기 전용" : (hasLock() ? "관리자" : "잠금 없음");
  b.classList.toggle("on", !ro && hasLock());
  if (ro) { sel.layer = null; setTool("select"); }
  const age = pwAgeDays();
  b.title = hasLock()
    ? (ro ? "관리자 비밀번호를 입력하면 편집할 수 있습니다" : "관리자 모드 · 비밀번호 변경 " + (age === 0 ? "오늘" : age + "일 전"))
    : "아직 잠금이 없습니다 — 누구나 편집할 수 있어요";
  renderFlow(); renderStage(); renderPanels();
}

function initLock() {
  try {
    if (hasLock() && sessionStorage.getItem(SESS_KEY) === state.lock.hash) admin = true;
  } catch (e) {}
  $("#btnLock").addEventListener("click", openLockModal);
  $("#btnLock").style.display = supaOn() ? "none" : "";     // 서버 모드에서는 비밀번호 잠금 대신 로그인
  applyMode();
  const age = pwAgeDays();
  if (admin && age !== null && age >= 90)
    setTimeout(() => toast("관리자 비밀번호를 바꾼 지 " + age + "일 됐습니다. 변경을 권장합니다.", "bad", { label: "변경", fn: openLockModal }), 1200);
}

function lockNote() {
  return "이 도구는 서버 없이 브라우저에서만 도는 페이지라, 비밀번호는 <b>편집을 막는 잠금</b>입니다. " +
    "저장되는 값은 원문이 아니라 salt를 섞은 해시(PBKDF2 20만 회)라 파일을 열어봐도 비밀번호는 보이지 않지만, " +
    "보드 내용 자체를 숨기지는 못합니다. 외부에 공개하면 안 되는 내용은 올리지 마세요.";
}

function maskPw2() { setTimeout(maskPw, 0); }
function maskPw() { setTimeout(() => $$("#modalRoot [data-k]").forEach(el => el.type = "password"), 0); }
function openLockModal() {
  if (!subtleOK()) {
    toast("이 환경에서는 암호 기능을 쓸 수 없습니다(https 또는 로컬 파일에서 열어 주세요).", "bad");
    return;
  }
  /* 1) 아직 비밀번호가 없다 → 설정 */
  if (!hasLock()) {
    maskPw2();
    return openForm({
      title: "관리자 비밀번호 설정", icon: "lock", okText: "설정하고 잠그기",
      note: lockNote(),
      fields: [
        { k: "pw", label: "새 비밀번호", ph: "8자 이상 권장" },
        { k: "pw2", label: "한 번 더" }
      ],
      values: { pw: "", pw2: "" },
      onSave: async v => {
        if (!v.pw || v.pw.length < 4) return toast("비밀번호가 너무 짧습니다", "bad");
        if (v.pw !== v.pw2) return toast("두 입력이 다릅니다", "bad");
        await setPassword(v.pw);
        toast("잠갔습니다. 이제 이 비밀번호를 아는 사람만 편집할 수 있습니다. 저장까지 해야 다른 사람에게 반영됩니다.", "ok");
      }
    });
  }
  /* 2) 잠겨 있고 아직 관리자가 아니다 → 입력 */
  if (!admin) {
    maskPw2();
    return openForm({
      title: "관리자 모드로 전환", icon: "lock", okText: "확인",
      note: "비밀번호를 모르면 보기 전용으로 사용할 수 있습니다.",
      fields: [{ k: "pw", label: "관리자 비밀번호" }],
      values: { pw: "" },
      onSave: async v => {
        const ok = await verifyPassword(v.pw);
        if (!ok) { await new Promise(r => setTimeout(r, 600)); return toast("비밀번호가 맞지 않습니다", "bad"); }
        admin = true;
        try { sessionStorage.setItem(SESS_KEY, state.lock.hash); } catch (e) {}
        applyMode();
        toast("관리자 모드입니다. 편집할 수 있습니다.", "ok");
      }
    });
  }
  /* 3) 관리자 상태 → 변경 · 해제 · 잠그기 */
  const age = pwAgeDays();
  openForm({
    title: "관리자 모드", icon: "unlock", okText: "비밀번호 변경",
    deleteText: "잠금 해제(비밀번호 삭제)",
    note: "마지막 변경: " + (age === 0 ? "오늘" : age + "일 전") + (age >= 90 ? " — 변경을 권장합니다." : "") + "<br>" + lockNote(),
    fields: [
      { k: "cur", label: "현재 비밀번호" },
      { k: "pw", label: "새 비밀번호" },
      { k: "pw2", label: "새 비밀번호 확인" }
    ],
    values: { cur: "", pw: "", pw2: "" },
    onSave: async v => {
      if (!(await verifyPassword(v.cur))) return toast("현재 비밀번호가 맞지 않습니다", "bad");
      if (!v.pw || v.pw.length < 4) return toast("새 비밀번호가 너무 짧습니다", "bad");
      if (v.pw !== v.pw2) return toast("새 비밀번호 확인이 다릅니다", "bad");
      await setPassword(v.pw);
      toast("비밀번호를 바꿨습니다. 저장해야 다른 사람에게도 적용됩니다.", "ok");
    },
    onDelete: () => confirmDel("잠금을 없애면 링크를 가진 누구나 편집할 수 있습니다. 계속할까요?", () => {
      state.lock = null; admin = true;
      try { sessionStorage.removeItem(SESS_KEY); } catch (e) {}
      markDirty(); applyMode();
      toast("잠금을 해제했습니다.", "ok");
    })
  });
  maskPw();
}
