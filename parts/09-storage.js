
/* ========================================================================
   저장 위치 — Artifact 공유본 · 서버(Supabase) · JSON 파일
   이미지 호스팅(Cloudinary)을 연결하면 화면 이미지·이미지 레이어를
   Cloudinary에 올리고 JSON에는 URL만 남긴다. 이미 등록된 이미지도
   "일괄 URL 변환"으로 나중에 한꺼번에 바꿀 수 있다.
   ======================================================================== */

/* ---------------- 이미지 호스팅 (Cloudinary · Unsigned Upload Preset) ----------------
   API Key/Secret은 쓰지 않는다 — 브라우저 코드에 넣으면 이 화면에 접근하는
   누구나 개발자도구로 꺼내볼 수 있어 사실상 공개되기 때문. Cloudinary 콘솔에서
   Signing Mode를 Unsigned로 만든 업로드 프리셋 하나만 있으면 Cloud name과
   프리셋 이름만으로 안전하게 업로드할 수 있고 폴더·태그 지정도 그대로 된다.
   설정값은 문서(state.cloud)에 저장한다 — Supabase 연결 정보와 달리 문서를
   불러온 뒤에만 쓰이므로, 한 번 저장해 두면 다른 사람이 같은 문서를 열었을 때도
   그대로 적용된다(브라우저마다 따로 연결할 필요가 없다). */
function cloudCfg() { return state.cloud || null; }
function setCloudCfg(c) { state.cloud = c; markDirty(); }
function cloudFolder(boardName) {
  const d = new Date(), ym = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  const safe = String(boardName || "board").replace(/[\/\\]+/g, "-").trim() || "board";
  return "crm/" + ym + "/" + safe;
}
function cloudTags(pageName) { return String(pageName || "page").replace(/,/g, " ").trim() || "page"; }
/* Blob(파일이 아닌)을 FormData에 파일명 없이 append하면 브라우저가 문자 그대로
   "blob"을 파일명으로 보낸다 — Cloudinary가 그걸 원본 파일명으로 그대로
   돌려줘서 Cloudinary 미디어 라이브러리에 의미 없는 "blob"만 쌓인다. 항상
   뜻이 있는 이름을 지정해서 보낸다(페이지 이름 기반). */
function safeFilename(s) { return String(s || "image").replace(/["\r\n]/g, "").trim() || "image"; }
async function cloudUpload(blob, opts) {
  const cfg = cloudCfg();
  const fd = new FormData();
  fd.append("file", blob, safeFilename(opts && opts.filename));
  fd.append("upload_preset", cfg.preset);
  if (opts && opts.folder) fd.append("folder", opts.folder);
  if (opts && opts.tags) fd.append("tags", opts.tags);
  let res;
  try {
    res = await fetch("https://api.cloudinary.com/v1_1/" + cfg.cloudName + "/image/upload", { method: "POST", body: fd });
  } catch (err) {
    throw new Error("Cloudinary에 접속하지 못했습니다. (Artifact 화면 안에서는 외부 업로드가 차단됩니다)");
  }
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error((j && j.error && j.error.message) || ("업로드 실패 " + res.status));
  if (!j || !j.secure_url) throw new Error("응답에서 URL을 찾지 못했습니다");
  return { url: j.secure_url, publicId: j.public_id, filename: j.original_filename || "", uploadedAt: j.created_at || new Date().toISOString() };
}
async function hostUploadAll(snap) {
  const cfg = cloudCfg();
  if (!cfg || !cfg.cloudName || !cfg.preset) return;
  const done = [];
  for (const u of snap.uploads) {
    const meta = await cloudUpload(u.blob, { folder: cloudFolder(u.board && u.board.name), tags: cloudTags(u.node.name), filename: u.node.name });
    snap.data.boards.forEach(b => b.nodes.forEach(n => {
      if (n.id === u.node.id) n.shot = { url: meta.url, w: u.node.shotW, h: u.node.shotH, uploadedAt: meta.uploadedAt, filename: meta.filename, publicId: meta.publicId };
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
        if (l.kind !== "image" || !l.src || isCloudHosted(l.src)) continue;
        try {
          const blob = l.src.indexOf("data:") === 0 ? dataUrlToBlob(l.src) : await (await fetch(l.src)).blob();
          const meta = await cloudUpload(blob, { folder: cloudFolder(b.name), tags: cloudTags(n.name), filename: n.name + "-layer" });
          l.src = meta.url; l.uploadedAt = meta.uploadedAt; l.filename = meta.filename; l.publicId = meta.publicId;
          layerDone++;
        } catch (e) { /* 실패한 레이어는 인라인 그대로 남는다 */ }
      }
    }
  }
  if (done.length || layerDone) toast("이미지 " + (done.length + layerDone) + "개를 Cloudinary에 올렸습니다", "ok");
}
function openCloudModal() {
  const c = cloudCfg() || { cloudName: "", preset: "" };
  openForm({
    title: "이미지 호스팅 (Cloudinary)", icon: "up", okText: "저장",
    deleteText: cloudCfg() ? "설정 삭제" : null,
    note: "화면 이미지·이미지 레이어를 Cloudinary에 올리고 JSON에는 URL만 남깁니다.<br>" +
      "Cloudinary 콘솔 → <b>Settings → Upload → Upload presets → Add upload preset</b>에서 " +
      "Signing Mode를 <b>Unsigned</b>로 만든 프리셋 이름을 적으세요. API Key·Secret은 필요 없습니다 " +
      "(브라우저 코드에 넣으면 노출되므로 쓰지 않습니다).<br>" +
      "업로드 시 <span class=\"mono\">crm/연도-월/보드이름</span> 폴더에 담기고, 페이지 이름이 태그로 붙습니다.<br>" +
      "이 설정은 이 문서에 같이 저장되므로, <b>공유 저장/서버 저장을 한 번 눌러야</b> 다른 사람이 열었을 때도 그대로 적용됩니다.",
    fields: [
      { k: "cloudName", label: "Cloud name", mono: true, ph: "pspfcgbn" },
      { k: "preset", label: "Upload preset (Unsigned)", mono: true, ph: "예: jta-unsigned" }
    ],
    values: c,
    onSave: v => {
      if (!v.cloudName || !v.preset) { setCloudCfg(null); return toast("이미지 호스팅을 껐습니다. 저장해야 다른 사람에게도 반영됩니다."); }
      setCloudCfg({ cloudName: v.cloudName.trim(), preset: v.preset.trim() });
      toast("Cloudinary를 연결했습니다. 저장해야 다른 사람에게도 적용됩니다.", "ok");
    },
    onDelete: cloudCfg() ? () => { setCloudCfg(null); toast("설정을 지웠습니다. 저장해야 다른 사람에게도 반영됩니다."); } : null
  });
}

/* ---------------- 호스팅 제공업체 식별 ----------------
   "이미 지금 쓰는 이미지 호스팅에 올라간 URL인가?"를 판단하는 지점을
   한 곳에 모아 둔다. 판단 기준은 "이 URL이 Cloudinary인가"가 아니라
   "이 URL이 진짜 최종 목적지(우리가 쓰는 호스팅)인가"이므로, Supabase
   서명 URL·구버전 파일 참조·다른 업체 URL·data: 인라인 등 그게 무엇이든
   전부 "아직 우리 호스팅이 아님 → 변환 대상"으로 취급한다.

   ⚠️ 이미지 호스팅 업체를 Cloudinary에서 다른 곳으로 바꾸면, 여기와
   cloudUpload()(업로드 엔드포인트·응답 파싱)·cloudFolder()/cloudTags()
   (그 업체의 폴더·태그 규칙)·openCloudModal()(설정 입력 필드)까지
   같이 그 업체 사양에 맞춰 고쳐야 한다. */
function isCloudHosted(url) {
  return /^https?:\/\/res\.cloudinary\.com\//.test(String(url || ""));
}

/* ---------------- 이미지 일괄 URL 변환 ----------------
   이미 등록된 화면 이미지·이미지 레이어 중 지금 쓰는 호스팅(Cloudinary)에
   있지 않은 것들을 모아 한꺼번에 올린다. */
function unhostedTargets() {
  const targets = [];
  state.boards.forEach(b => b.nodes.forEach(n => {
    const src = shotSrc(n);
    if (src && !isCloudHosted(src)) targets.push({ kind: "shot", node: n, board: b, src });
    (n.layers || []).forEach(l => {
      if (l.kind === "image" && l.src && !isCloudHosted(l.src)) targets.push({ kind: "layer", node: n, layer: l, board: b, src: l.src });
    });
  }));
  return targets;
}
async function convertTargetsToUrl(targets, onProgress) {
  let done = 0, failed = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    try {
      const blob = t.src.indexOf("data:") === 0 ? dataUrlToBlob(t.src) : await (await fetch(t.src)).blob();
      const meta = await cloudUpload(blob, {
        folder: cloudFolder(t.board.name), tags: cloudTags(t.node.name),
        filename: t.kind === "shot" ? t.node.name : t.node.name + "-layer"
      });
      if (t.kind === "shot") {
        t.node.shot = { url: meta.url, w: t.node.shotW, h: t.node.shotH, uploadedAt: meta.uploadedAt, filename: meta.filename, publicId: meta.publicId };
        t.node.shotData = null; t.node.shotDirty = false;
      } else {
        t.layer.src = meta.url; t.layer.uploadedAt = meta.uploadedAt; t.layer.filename = meta.filename; t.layer.publicId = meta.publicId;
      }
      done++;
    } catch (e) { failed++; }
    if (onProgress) onProgress(i + 1, targets.length);
  }
  return { done, failed };
}
async function convertAllImagesToUrl() {
  const cfg = cloudCfg();
  if (!cfg || !cfg.cloudName || !cfg.preset) { toast("먼저 이미지 호스팅(Cloudinary)을 설정하세요", "bad"); openCloudModal(); return; }
  const targets = unhostedTargets();
  if (!targets.length) { toast("URL로 바꿀 이미지가 없습니다 — 이미 모두 URL 형식입니다", "ok"); return; }
  const prog = openProgressModal("이미지 " + targets.length + "개를 URL로 변환하는 중");
  const r = await convertTargetsToUrl(targets, (d, t) => prog.update(d, t));
  prog.close();
  markDirty(); renderFlow(); renderStage(); renderPanels();
  toast(r.done + "개를 URL로 바꿨습니다" + (r.failed ? " · 실패 " + r.failed : "") + " — 저장해야 다른 사람에게도 반영됩니다.", r.failed ? "bad" : "ok");
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
    '<div class="frow"><span class="lbl">보드 내보내기</span><div style="display:flex; gap:6px">' +
      '<button class="btn sm" data-act="exportpng">' + ico("down", "xs") + 'PNG 이미지</button>' +
      '<button class="btn sm" data-act="exportpdf">' + ico("down", "xs") + 'PDF 문서</button></div>' +
      '<p class="hint">지금 보고 있는 보드의 여정 지도를 정리된 개요도로 그려서 이미지·PDF로 저장합니다. 발표·보고 자료에 붙여 넣기 좋습니다.</p></div>' +
    (myRole() === "server_admin"
      ? '<div class="frow"><span class="lbl">서버 (Supabase)</span>' +
        '<button class="btn sm" data-act="server">' + ico("share", "xs") + (supa ? "연결됨 — " + esc(supaCfg().url.replace("https://", "")) : "구글 로그인·회원 권한 켜기") + "</button>" +
        '<p class="hint">Supabase 프로젝트를 연결하면 구글 로그인과 서버관리자·운영자·일반회원 권한이 켜집니다. 배포한 사이트에서만 동작합니다.</p></div>'
      : "") +
    '<div class="frow"><span class="lbl">이미지 호스팅 (Cloudinary)</span><div style="display:flex; gap:6px; flex-wrap:wrap">' +
      '<button class="btn sm" data-act="host">' + ico("up", "xs") + (cloudCfg() ? "설정됨 — " + esc(cloudCfg().cloudName) : "Cloudinary 연결") + "</button>" +
      '<button class="btn sm" data-act="urlize">' + ico("loop", "xs") + "일괄 URL 변환</button></div>" +
      '<p class="hint">화면 이미지·이미지 레이어를 Cloudinary에 올리고 JSON에는 URL만 남깁니다. 연결해 두면 서버 저장 때도 자동으로 적용됩니다. 지금 URL이 아닌 이미지 <b>' + unhosted + "개</b>. Artifact 화면 안에서는 차단되며, 내려받은 파일이나 자체 호스팅에서만 동작합니다.</p></div>";

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
    if (act === "exportpng") exportBoardPng();
    if (act === "exportpdf") exportBoardPdf();
    if (act === "host") openCloudModal();
    if (act === "urlize") convertAllImagesToUrl();
    if (act === "server") openServerModal();
  });
}
