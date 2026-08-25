
/* ========================================================================
   저장 위치 — Artifact 공유본 · 서버(Supabase) · JSON 파일
   이미지 호스팅(선택)을 연결하면 화면 이미지·이미지 레이어를 외부 저장소에
   올리고 JSON에는 URL만 남긴다. 이미 등록된 이미지도 "일괄 URL 변환"으로
   나중에 한꺼번에 바꿀 수 있다.
   ======================================================================== */

/* ---------------- 이미지 호스팅(선택) ----------------
   업로드 엔드포인트를 지정하면 화면 이미지·이미지 레이어를 그쪽에 올리고
   JSON에는 URL만 남긴다. 설정값(토큰 포함)은 공유되는 JSON이 아니라
   이 브라우저에만 저장한다. */
const HOST_KEY = "jta:imghost";
function hostCfg() { try { return JSON.parse(localStorage.getItem(HOST_KEY) || "null"); } catch (e) { return null; } }
function setHostCfg(c) { try { c ? localStorage.setItem(HOST_KEY, JSON.stringify(c)) : localStorage.removeItem(HOST_KEY); } catch (e) {} }
function dig(obj, path) { return String(path || "").split(".").reduce((o, k) => (o == null ? o : o[k]), obj); }
async function hostUpload(blob, filename) {
  const cfg = hostCfg();
  const fd = new FormData();
  fd.append(cfg.field || "image", blob, filename);
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
  return url;
}
async function hostUploadAll(snap) {
  const cfg = hostCfg();
  if (!cfg || !cfg.url) return;
  const done = [];
  for (const u of snap.uploads) {
    const url = await hostUpload(u.blob, u.ref.slice(4));
    snap.data.boards.forEach(b => b.nodes.forEach(n => {
      if (n.id === u.node.id) n.shot = { url, w: u.node.shotW, h: u.node.shotH };
    }));
    const i = snap.used.indexOf(u.ref);
    if (i >= 0) snap.used.splice(i, 1);
    done.push(u.ref);
  }
  snap.uploads.length = 0;                     // 파일로는 올리지 않는다

  let layerDone = 0;                           // 이미지 레이어도 같은 호스팅으로 올린다(각각 독립적으로 시도)
  for (const b of snap.data.boards) {
    for (const n of b.nodes) {
      for (const l of (n.layers || [])) {
        if (l.kind !== "image" || !l.src || l.src.indexOf("data:") !== 0) continue;
        try {
          const blob = dataUrlToBlob(l.src);
          l.src = await hostUpload(blob, l.id + "." + extOf(blob.type));
          layerDone++;
        } catch (e) { /* 실패한 레이어는 인라인 그대로 남는다 */ }
      }
    }
  }
  if (done.length || layerDone) toast("이미지 " + (done.length + layerDone) + "개를 호스팅에 올렸습니다", "ok");
}
function openHostModal() {
  const c = hostCfg() || { url: "", field: "image", auth: "", path: "data.link" };
  openForm({
    title: "이미지 호스팅", icon: "up", okText: "저장",
    deleteText: hostCfg() ? "설정 삭제" : null,
    note: "화면 이미지·이미지 레이어를 외부 저장소에 올리고 JSON에는 URL만 남깁니다. 사내 S3·R2 업로더나 imgur 같은 서비스를 쓸 수 있습니다.<br>" +
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

/* ---------------- 이미지 일괄 URL 변환 ----------------
   이미 등록된 화면 이미지·이미지 레이어 중 URL이 아닌 것들을 모아
   이미지 호스팅에 한꺼번에 올린다. Supabase 서버 모드는 자체 비공개
   버킷(서명 URL)을 이미 쓰고 있어 대상에서 제외한다. */
function unhostedTargets() {
  const targets = [];
  state.boards.forEach(b => b.nodes.forEach(n => {
    const src = shotSrc(n);
    if (src && !(n.shot && n.shot.url)) targets.push({ kind: "shot", node: n, src });
    (n.layers || []).forEach(l => {
      if (l.kind === "image" && l.src && l.src.indexOf("data:") === 0) targets.push({ kind: "layer", node: n, layer: l, src: l.src });
    });
  }));
  return targets;
}
async function convertAllImagesToUrl() {
  const cfg = hostCfg();
  if (!cfg || !cfg.url) { toast("먼저 이미지 호스팅을 설정하세요", "bad"); openHostModal(); return; }
  const targets = unhostedTargets();
  if (!targets.length) { toast("URL로 바꿀 이미지가 없습니다 — 이미 모두 URL 형식입니다", "ok"); return; }
  toast("이미지 " + targets.length + "개를 URL로 바꾸는 중…");
  let done = 0, failed = 0;
  for (const t of targets) {
    try {
      const blob = t.src.indexOf("data:") === 0 ? dataUrlToBlob(t.src) : await (await fetch(t.src)).blob();
      const name = (t.kind === "shot" ? t.node.id : t.layer.id) + "." + extOf(blob.type);
      const url = await hostUpload(blob, name);
      if (t.kind === "shot") { t.node.shot = { url, w: t.node.shotW, h: t.node.shotH }; t.node.shotData = null; t.node.shotDirty = false; }
      else t.layer.src = url;
      done++;
    } catch (e) { failed++; }
  }
  markDirty(); renderFlow(); renderStage(); renderPanels();
  toast(done + "개를 URL로 바꿨습니다" + (failed ? " · 실패 " + failed : "") + " — 공유 저장을 눌러야 다른 사람에게도 반영됩니다.", failed ? "bad" : "ok");
}

/* ---------------- 저장소 UI ---------------- */
function updateStorageUI() {
  const b = $("#btnShare");
  if (supaOn()) { b.style.display = ""; b.lastChild.textContent = "서버 저장"; }
  else if (saveAvail) { b.style.display = ""; b.lastChild.textContent = "공유 저장"; }
  else b.style.display = "none";
  $("#btnStorage").classList.toggle("on", supaOn());
}
function openStorageModal() {
  const supa = supaOn();
  const where = supa
    ? "<b>서버(Supabase)</b>에 저장 중 — 구글 로그인한 사람만 열람, 서버관리자·운영자만 편집"
    : (saveAvail ? "이 <b>Artifact 링크</b>에 저장 중 — 링크를 받은 사람이 같은 보드를 봅니다" : "저장 위치가 없습니다 (브라우저에만 임시 보관)");
  const unhosted = unhostedTargets().length;
  const rows =
    '<div class="frow"><span class="lbl">현재 저장 위치</span><div class="meta" style="font-size:12.5px">' + where + "</div></div>" +
    '<div class="frow"><span class="lbl">파일로 주고받기</span><div style="display:flex; gap:6px">' +
      '<button class="btn sm" data-act="export">' + ico("down", "xs") + 'JSON 내보내기</button>' +
      '<button class="btn sm" data-act="import">' + ico("up", "xs") + 'JSON 불러오기</button></div>' +
      '<p class="hint">이미지는 JSON 안에 함께 담깁니다. 파일 하나로 백업하거나 다른 사람에게 넘길 때 쓰세요.</p></div>' +
    '<div class="frow"><span class="lbl">서버 (Supabase)</span>' +
      '<button class="btn sm" data-act="server">' + ico("share", "xs") + (supa ? "연결됨 — " + esc(supaCfg().url.replace("https://", "")) : "구글 로그인·회원 권한 켜기") + "</button>" +
      '<p class="hint">Supabase 프로젝트를 연결하면 구글 로그인과 서버관리자·운영자·일반회원 권한이 켜집니다. 배포한 사이트에서만 동작합니다.</p></div>' +
    '<div class="frow"><span class="lbl">이미지 호스팅 (고급)</span><div style="display:flex; gap:6px; flex-wrap:wrap">' +
      '<button class="btn sm" data-act="host">' + ico("up", "xs") + (hostCfg() ? "설정됨 — " + esc(hostCfg().url.slice(0, 40)) : "업로드 서버 연결") + "</button>" +
      '<button class="btn sm" data-act="urlize">' + ico("loop", "xs") + "일괄 URL 변환</button></div>" +
      '<p class="hint">화면 이미지·이미지 레이어를 외부 저장소에 올리고 JSON에는 URL만 남깁니다. 지금 URL이 아닌 이미지 <b>' + unhosted + "개</b>. Artifact 화면 안에서는 차단되며, 내려받은 파일이나 자체 호스팅에서만 동작합니다.</p></div>";

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
    if (act === "export") exportJson();
    if (act === "import") importJson();
    if (act === "host") openHostModal();
    if (act === "urlize") convertAllImagesToUrl();
    if (act === "server") openServerModal();
  });
}
