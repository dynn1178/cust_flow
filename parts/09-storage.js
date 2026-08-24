
/* ========================================================================
   저장 위치 — Artifact 공유본 / 로컬 폴더(구글 드라이브 동기화 폴더 등)
   폴더 모드는 File System Access API를 쓴다. 보드는 폴더에
     journey.json  · 여정/태그/캠페인 정의 (이미지 제외, 가벼움)
     img/*.webp    · 화면 이미지 원본
   두 갈래로 저장되고, Drive 데스크톱이 동기화를 담당한다.
   ======================================================================== */
const folder = { dir: null, name: "", auto: false, lastMod: 0, timer: null };

function fsSupported() { return typeof window.showDirectoryPicker === "function"; }
function blobToDataUrl(b) {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b); });
}
async function writeFile(dirHandle, name, blob) {
  const fh = await dirHandle.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(blob); await w.close();
}
async function ensurePerm() {
  if (!folder.dir) return false;
  try {
    if ((await folder.dir.queryPermission({ mode: "readwrite" })) === "granted") return true;
    if ((await folder.dir.requestPermission({ mode: "readwrite" })) === "granted") return true;
  } catch (e) { /* 아래에서 안내 */ }
  toast("폴더 접근 권한이 필요합니다. 저장소에서 다시 연결하세요.", "bad");
  return false;
}

async function connectFolder() {
  if (!fsSupported()) { toast("이 브라우저는 폴더 연결을 지원하지 않습니다(Chrome·Edge에서 가능).", "bad"); return; }
  let dir;
  try {
    dir = await window.showDirectoryPicker({ id: "jta-board", mode: "readwrite" });
  } catch (e) { if (e && e.name !== "AbortError") toast("폴더를 열지 못했습니다", "bad"); return; }
  folder.dir = dir; folder.name = dir.name;
  try { await idbSet("folderHandle", dir); } catch (e) { /* 핸들 저장 불가 시 이번 세션만 유지 */ }
  let hasFile = false;
  try { await dir.getFileHandle("journey.json"); hasFile = true; } catch (e) {}
  if (hasFile) {
    const go = () => folderLoad(true).then(() => toast("폴더의 보드를 불러왔습니다", "ok"));
    if (dirty) confirmDel("폴더에 이미 보드가 있습니다. 지금 화면의 저장 안 된 변경을 버리고 불러올까요?", go);
    else go();
  } else {
    await folderSave();
  }
  setAutoSync(true);
  updateStorageUI();
}
async function folderSave() {
  if (!(await ensurePerm())) return;
  setSaveChip("dirty", "저장 중…");
  const snap = buildSnapshot();
  try {
    await hostUploadAll(snap);
    if (snap.uploads.length || snap.removals.length) {
      const imgDir = await folder.dir.getDirectoryHandle("img", { create: true });
      for (const u of snap.uploads) await writeFile(imgDir, u.ref.slice(4), u.blob);
      for (const r of snap.removals) { try { await imgDir.removeEntry(r.slice(4)); } catch (e) {} }
    }
    await writeFile(folder.dir, "journey.json", new Blob([JSON.stringify(snap.data, null, 2)], { type: "application/json" }));
    snap.commit(); dirty = false;
    try { folder.lastMod = (await (await folder.dir.getFileHandle("journey.json")).getFile()).lastModified; } catch (e) {}
    setSaveChip("ok", folder.name + " · " + timeAgo(state.updatedAt));
    saveDraft();
    toast("폴더에 저장했습니다" + (snap.uploads.length ? " · 이미지 " + snap.uploads.length + "개" : ""), "ok");
  } catch (e) {
    setSaveChip("dirty", "저장 안 됨");
    toast("폴더에 저장하지 못했습니다: " + (e && e.message ? e.message : ""), "bad");
  }
  updateStorageUI();
}
async function folderLoad(force) {
  if (!(await ensurePerm())) return;
  if (!force && dirty) { toast("저장 안 된 변경이 있어 불러오지 않았습니다", "bad"); return; }
  try {
    const f = await (await folder.dir.getFileHandle("journey.json")).getFile();
    const data = normalize(JSON.parse(await f.text()));
    let imgDir = null;
    try { imgDir = await folder.dir.getDirectoryHandle("img"); } catch (e) {}
    if (imgDir) {
      for (const b of data.boards) {
        for (const n of b.nodes) {
          if (n.shot && n.shot.ref) {
            try {
              const fh = await imgDir.getFileHandle(n.shot.ref.slice(4));
              n.shotData = await blobToDataUrl(await fh.getFile());
            } catch (e) { /* 파일이 없으면 썸네일로 대체 */ }
          }
        }
      }
    }
    state = data;
    savedRefs = collectRefs();
    const cb = B();
    sel = { node: cb.sel && cb.nodes.some(n => n.id === cb.sel) ? cb.sel : (cb.nodes[0] || {}).id || null, edge: null, layer: null };
    dirty = false; folder.lastMod = f.lastModified;
    mounted = { id: null, src: null, w: 0, h: 0 };
    $("#nodeLayer").innerHTML = "";
    Object.keys(EDGE_EL).forEach(k => { EDGE_EL[k].g.remove(); delete EDGE_EL[k]; });
    renderAll(); applyMode();
    setSaveChip("ok", folder.name + " · " + timeAgo(state.updatedAt));
    saveDraft();
  } catch (e) { toast("폴더에서 불러오지 못했습니다", "bad"); }
  updateStorageUI();
}
function setAutoSync(on) {
  folder.auto = on;
  clearInterval(folder.timer);
  if (on && folder.dir) folder.timer = setInterval(checkFolder, 15000);
}
async function checkFolder() {
  if (!folder.dir || dirty || document.hidden) return;
  try {
    if ((await folder.dir.queryPermission({ mode: "readwrite" })) !== "granted") return;
    const f = await (await folder.dir.getFileHandle("journey.json")).getFile();
    if (f.lastModified > folder.lastMod + 500) {
      await folderLoad(true);
      toast("폴더의 최신본으로 갱신했습니다", "ok");
    }
  } catch (e) { /* 파일이 잠깐 없는 순간은 무시 */ }
}
async function disconnectFolder() {
  setAutoSync(false);
  folder.dir = null; folder.name = "";
  try { await idbDel("folderHandle"); } catch (e) {}
  updateStorageUI();
  setSaveChip("dirty", "폴더 연결 해제됨");
}
async function restoreFolder() {
  if (!fsSupported()) return false;
  let h = null;
  try { h = await idbGet("folderHandle"); } catch (e) {}
  if (!h) return false;
  folder.dir = h; folder.name = h.name;
  let perm = "prompt";
  try { perm = await h.queryPermission({ mode: "readwrite" }); } catch (e) {}
  if (perm === "granted") { await folderLoad(true); setAutoSync(true); return true; }
  updateStorageUI();
  setSaveChip("off", folder.name + " · 권한 확인 필요");
  return "needs-permission";
}

/* ---------------- 이미지 호스팅(선택) ----------------
   업로드 엔드포인트를 지정하면 화면 이미지를 그쪽에 올리고 JSON에는 URL만 남긴다.
   설정값(토큰 포함)은 공유되는 JSON이 아니라 이 브라우저에만 저장한다. */
const HOST_KEY = "jta:imghost";
function hostCfg() { try { return JSON.parse(localStorage.getItem(HOST_KEY) || "null"); } catch (e) { return null; } }
function setHostCfg(c) { try { c ? localStorage.setItem(HOST_KEY, JSON.stringify(c)) : localStorage.removeItem(HOST_KEY); } catch (e) {} }
function dig(obj, path) { return String(path || "").split(".").reduce((o, k) => (o == null ? o : o[k]), obj); }
async function hostUploadAll(snap) {
  const cfg = hostCfg();
  if (!cfg || !cfg.url || !snap.uploads.length) return;
  const done = [];
  for (const u of snap.uploads) {
    const fd = new FormData();
    fd.append(cfg.field || "image", u.blob, u.ref.slice(4));
    const headers = {};
    if (cfg.auth) headers.Authorization = cfg.auth;
    let res;
    try {
      res = await fetch(cfg.url, { method: "POST", headers, body: fd });
    } catch (err) {
      throw new Error("이미지 호스팅에 접속하지 못했습니다. (Artifact 화면 안에서는 외부 업로드가 차단됩니다)");
    }
    if (!res.ok) throw new Error("이미지 업로드 실패 " + res.status);
    const j = await res.json().catch(() => null);
    const url = j ? dig(j, cfg.path || "data.link") : null;
    if (!url) throw new Error("응답에서 " + (cfg.path || "data.link") + " 경로를 찾지 못했습니다");
    snap.data.boards.forEach(b => b.nodes.forEach(n => {
      if (n.id === u.node.id) n.shot = { url, w: u.node.shotW, h: u.node.shotH };
    }));
    const i = snap.used.indexOf(u.ref);
    if (i >= 0) snap.used.splice(i, 1);
    done.push(u.ref);
  }
  snap.uploads.length = 0;                     // 파일로는 올리지 않는다
  toast("이미지 " + done.length + "개를 호스팅에 올렸습니다", "ok");
}
function openHostModal() {
  const c = hostCfg() || { url: "", field: "image", auth: "", path: "data.link" };
  openForm({
    title: "이미지 호스팅", icon: "up", okText: "저장",
    deleteText: hostCfg() ? "설정 삭제" : null,
    note: "화면 이미지를 외부 저장소에 올리고 JSON에는 URL만 남깁니다. 사내 S3·R2 업로더나 imgur 같은 서비스를 쓸 수 있습니다.<br>" +
      "<b>주의</b> — ① Artifact 화면 안에서는 보안 정책상 외부 업로드·표시가 모두 막히므로 내려받은 파일이나 자체 호스팅에서만 동작합니다. " +
      "② 공개 호스팅에 올린 이미지는 URL만 알면 누구나 볼 수 있으니 사내 화면 캡처에는 권장하지 않습니다. " +
      "③ 토큰은 이 브라우저에만 저장되고 공유 JSON에는 들어가지 않습니다.",
    fields: [
      { k: "url", label: "업로드 URL (POST · multipart)", mono: true, ph: "https://api.imgur.com/3/image" },
      { k: "field", label: "파일 필드 이름", mono: true, ph: "image" },
      { k: "auth", label: "Authorization 헤더", mono: true, ph: "Client-ID xxxxxxxx" },
      { k: "path", label: "응답에서 URL 위치", mono: true, ph: "data.link" }
    ],
    values: c,
    onSave: v => {
      if (!v.url) { setHostCfg(null); return toast("이미지 호스팅을 껐습니다"); }
      setHostCfg({ url: v.url, field: v.field || "image", auth: v.auth, path: v.path || "data.link" });
      toast("이미지 호스팅을 설정했습니다. 다음 저장부터 적용됩니다.", "ok");
    },
    onDelete: hostCfg() ? () => { setHostCfg(null); toast("설정을 지웠습니다"); } : null
  });
}

/* ---------------- 저장소 UI ---------------- */
function updateStorageUI() {
  const b = $("#btnShare");
  if (supaOn()) { b.style.display = ""; b.lastChild.textContent = "서버 저장"; }
  else if (folder.dir) { b.style.display = ""; b.lastChild.textContent = "폴더 저장"; }
  else if (saveAvail) { b.style.display = ""; b.lastChild.textContent = "공유 저장"; }
  else b.style.display = "none";
  $("#btnStorage").classList.toggle("on", !!folder.dir || supaOn());
}
function openStorageModal() {
  const supa = supaOn();
  const where = supa
    ? "<b>서버(Supabase)</b>에 저장 중 — 구글 로그인한 사람만 열람, 서버관리자·운영자만 편집"
    : folder.dir
    ? '<b>' + esc(folder.name) + "</b> 폴더에 저장 중"
    : (saveAvail ? "이 <b>Artifact 링크</b>에 저장 중 — 링크를 받은 사람이 같은 보드를 봅니다" : "저장 위치가 없습니다 (브라우저에만 임시 보관)");
  const rows =
    '<div class="frow"><span class="lbl">현재 저장 위치</span><div class="meta" style="font-size:12.5px">' + where + "</div></div>" +
    (folder.dir
      ? '<div class="frow"><span class="lbl">폴더 작업</span><div style="display:flex; gap:6px; flex-wrap:wrap">' +
          '<button class="btn sm" data-act="fsave">' + ico("save", "xs") + '지금 저장</button>' +
          '<button class="btn sm" data-act="fload">' + ico("down", "xs") + '다시 불러오기</button>' +
          '<button class="btn sm' + (folder.auto ? " on" : "") + '" data-act="fauto">' + ico("loop", "xs") + '자동 확인 15초</button>' +
          '<button class="btn sm danger" data-act="fout">' + ico("close", "xs") + '연결 해제</button>' +
        "</div></div>"
      : '<div class="frow"><span class="lbl">폴더에 저장하기</span>' +
        (fsSupported()
          ? '<button class="btn" data-act="fconn">' + ico("folder", "xs") + '폴더 선택해서 연결</button>' +
            '<p class="hint">구글 드라이브 데스크톱이 동기화하는 폴더(예: <span class="mono">G:\\내 드라이브\\team-journey</span>)를 고르면, 팀원은 같은 폴더를 연결해 같은 보드를 보고 고칠 수 있습니다. 저장은 <span class="mono">journey.json</span> + <span class="mono">img/</span> 두 갈래로 떨어집니다.</p>'
          : '<p class="hint">이 브라우저는 폴더 연결을 지원하지 않습니다. Chrome 또는 Edge에서 열어 주세요. (Artifact 화면 안에서는 보안 정책상 폴더 접근이 막혀 있어, 내려받은 <span class="mono">journey-atlas.html</span> 파일을 직접 열어야 합니다.)</p>') +
        "</div>") +
    '<div class="frow"><span class="lbl">파일로 주고받기</span><div style="display:flex; gap:6px">' +
      '<button class="btn sm" data-act="export">' + ico("down", "xs") + 'JSON 내보내기</button>' +
      '<button class="btn sm" data-act="import">' + ico("up", "xs") + 'JSON 불러오기</button></div>' +
      '<p class="hint">이미지는 JSON 안에 함께 담깁니다. 파일 하나로 백업하거나 다른 사람에게 넘길 때 쓰세요.</p></div>' +
    '<div class="frow"><span class="lbl">서버 (Supabase)</span>' +
      '<button class="btn sm" data-act="server">' + ico("share", "xs") + (supa ? "연결됨 — " + esc(supaCfg().url.replace("https://", "")) : "구글 로그인·회원 권한 켜기") + "</button>" +
      '<p class="hint">Supabase 프로젝트를 연결하면 구글 로그인과 서버관리자·운영자·일반회원 권한이 켜집니다. 배포한 사이트에서만 동작합니다.</p></div>' +
    '<div class="frow"><span class="lbl">이미지 호스팅 (고급)</span>' +
      '<button class="btn sm" data-act="host">' + ico("up", "xs") + (hostCfg() ? "설정됨 — " + esc(hostCfg().url.slice(0, 40)) : "업로드 서버 연결") + "</button>" +
      '<p class="hint">화면 이미지를 외부 저장소에 올리고 JSON에는 URL만 남깁니다. Artifact 화면 안에서는 차단되며, 내려받은 파일이나 자체 호스팅에서만 동작합니다.</p></div>';

  const root = modalHost();
  root.innerHTML =
    '<div class="scrim"><div class="modal glass" role="dialog" aria-modal="true">' +
      '<div class="modal-head">' + ico("folder") + "<h3>저장 위치</h3><button class=\"btn icon sm\" data-x>" + ico("close", "xs") + "</button></div>" +
      '<div class="modal-body">' + rows + "</div>" +
      '<div class="modal-foot"><div class="spacer"></div><button class="btn primary" data-x>닫기</button></div>' +
    "</div></div>";
  root.addEventListener("click", e => {
    const a = e.target.closest("[data-act]");
    if (e.target.closest("[data-x]") || e.target.classList.contains("scrim")) return closeModal();
    if (!a) return;
    const act = a.dataset.act;
    closeModal();
    if (act === "fconn") connectFolder();
    if (act === "fsave") folderSave();
    if (act === "fload") folderLoad(false);
    if (act === "fauto") { setAutoSync(!folder.auto); toast(folder.auto ? "15초마다 폴더를 확인합니다" : "자동 확인을 껐습니다"); }
    if (act === "fout") disconnectFolder();
    if (act === "export") exportJson();
    if (act === "import") importJson();
    if (act === "host") openHostModal();
    if (act === "server") openServerModal();
  });
}
