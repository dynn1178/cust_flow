
/* ========================================================================
   스테이지 — 화면 크게 보기 · 레이어 그리기 · 캠페인 배치
   렌더 원칙: 화면 이미지는 한 번만 붙이고, 레이어 SVG만 다시 그린다.
   ======================================================================== */
let mounted = { id: null, src: null, w: 0, h: 0 };

function docSize(n) { return { w: n.shotW || DOC_W, h: n.shotH || DOC_H }; }
/* 화면 이미지 크기만이 아니라, 이미지 밖으로(위·아래·왼쪽·오른쪽 어느 쪽이든)
   삐져나온 도형·텍스트 레이어까지 포함한 실제 콘텐츠 범위 — 맞춤(가로/세로/
   전체 화면) 계산과 캔버스 크기는 항상 이 범위를 기준으로 한다. x1/y1은
   이미지 왼쪽 위(0,0) 기준으로 왼쪽·위로 얼마나 더 넓어졌는지(음수)를 담는다. */
function docExtent(n) {
  const base = docSize(n);
  if (!n || !n.layers || !n.layers.length) return { x1: 0, y1: 0, w: base.w, h: base.h };
  let x1 = 0, y1 = 0, x2 = base.w, y2 = base.h;
  n.layers.forEach(l => {
    const b = bbox(l);
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
  });
  return { x1, y1, w: x2 - x1, h: y2 - y1 };
}
function stageScale(n) {
  const d = docExtent(n);
  if (stageZoom) return stageZoom;
  const box = $("#stageScroll").getBoundingClientRect();
  const availW = box.width - 36, availH = box.height - 36;
  const s = stageFitMode === "height" ? availH / d.h
    : stageFitMode === "contain" ? Math.min(availW / d.w, availH / d.h)
    : availW / d.w;                  // "width" — 기본값
  return clamp(s, 0.05, 4);
}
/* 이미지 자체는 항상 레이어 좌표계의 (0,0)~(base.w,base.h)에 있으므로, 범위가
   왼쪽·위로 넓어졌으면(x1/y1이 음수) 그만큼 이미지를 오른쪽·아래로 밀어서
   그려야 캔버스 왼쪽 위 모서리와 좌표계가 맞는다. */
function positionShotEl(el, base, ext, s) {
  el.style.left = Math.round(-ext.x1 * s) + "px";
  el.style.top = Math.round(-ext.y1 * s) + "px";
  el.style.width = Math.round(base.w * s) + "px";
  el.style.height = Math.round(base.h * s) + "px";
}
/* 드래그 중에는 화면 이미지·캔버스 크기를 건드리지 않다가(스크롤이 튀지
   않도록), 그리기·이동·크기 조절이 끝나는 시점에만 맞춤 범위를 다시 맞춘다. */
function resyncStageExtent() {
  const n = curNode(); if (!n) return;
  const base = docSize(n), ext = docExtent(n), s = stageScale(n);
  const doc = $("#stageDoc");
  doc.style.width = Math.round(ext.w * s) + "px";
  doc.style.height = Math.round(ext.h * s) + "px";
  const img = doc.querySelector(".shot, .noshot");
  if (img) positionShotEl(img, base, ext, s);
  const svg = $("#layerSvg");
  if (svg) svg.setAttribute("viewBox", ext.x1 + " " + ext.y1 + " " + ext.w + " " + ext.h);
}
function bbox(l) {
  if (l.kind === "pen") {
    const xs = l.points.map(p => p[0]), ys = l.points.map(p => p[1]);
    return { x: Math.min.apply(null, xs), y: Math.min.apply(null, ys), w: Math.max.apply(null, xs) - Math.min.apply(null, xs), h: Math.max.apply(null, ys) - Math.min.apply(null, ys) };
  }
  if (l.kind === "text") return { x: l.x, y: l.y, w: Math.max(40, (l.text || "").length * (l.size || 18) * 0.62), h: (l.size || 18) * 1.25 };
  return { x: Math.min(l.x, l.x + l.w), y: Math.min(l.y, l.y + l.h), w: Math.abs(l.w), h: Math.abs(l.h) };
}
function layerMarkup(l, n, idx) {
  const c = l.color || "#e0483f", sw = l.stroke || 3;
  let s = "", hit = "";     // hit = 클릭하기 쉽도록 얹는 투명 히트 영역(보이는 도형보다 넓게)
  if (l.kind === "rect") {
    const x = Math.min(l.x, l.x + l.w), y = Math.min(l.y, l.y + l.h), w = Math.abs(l.w), h = Math.abs(l.h);
    s = '<rect class="shape" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="6" fill="' + (l.fill || "none") + '" stroke="' + c + '" stroke-width="' + sw + '"/>';
    hit = '<rect class="hit-area" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="6"/>';
  } else if (l.kind === "ellipse") {
    const cx = l.x + l.w / 2, cy = l.y + l.h / 2, rx = Math.abs(l.w / 2), ry = Math.abs(l.h / 2);
    s = '<ellipse class="shape" cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="' + (l.fill || "none") + '" stroke="' + c + '" stroke-width="' + sw + '"/>';
    hit = '<ellipse class="hit-area" cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '"/>';
  } else if (l.kind === "arrow") {
    const x2 = l.x + l.w, y2 = l.y + l.h, a = Math.atan2(l.h, l.w), hl = 13 + sw * 2;
    const p1 = [x2 - hl * Math.cos(a - 0.42), y2 - hl * Math.sin(a - 0.42)], p2 = [x2 - hl * Math.cos(a + 0.42), y2 - hl * Math.sin(a + 0.42)];
    s = '<line class="shape" x1="' + l.x + '" y1="' + l.y + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round"/>' +
        '<polygon points="' + x2 + "," + y2 + " " + p1.join(",") + " " + p2.join(",") + '" fill="' + c + '"/>';
    hit = '<line class="hit-line" x1="' + l.x + '" y1="' + l.y + '" x2="' + x2 + '" y2="' + y2 + '"/>';
  } else if (l.kind === "text") {
    const outline = l.outline !== false;    /* 명시적으로 꺼야만 사라지는 기본 켜짐(흰 외곽선/그림자) */
    s = '<text class="ltext" x="' + l.x + '" y="' + l.y + '" font-size="' + (l.size || 18) + '" fill="' + c + '"' +
      (outline ? ' stroke="rgba(255,255,255,.85)" stroke-width="' + ((l.size || 18) * 0.22) + '" paint-order="stroke"' : "") +
      ">" + esc(l.text || "텍스트") + "</text>";
  }
  else if (l.kind === "pen") {
    s = '<polyline class="shape" points="' + l.points.map(p => p[0] + "," + p[1]).join(" ") + '" fill="none" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round"/>';
    hit = '<polyline class="hit-line" points="' + l.points.map(p => p[0] + "," + p[1]).join(" ") + '" stroke-linecap="round" stroke-linejoin="round"/>';
  }
  else if (l.kind === "image")
    s = '<image href="' + l.src + '" x="' + l.x + '" y="' + l.y + '" width="' + Math.abs(l.w) + '" height="' + Math.abs(l.h) + '" preserveAspectRatio="none" draggable="false"/>';

  let pin = "";
  if (l.campId) {
    const b = bbox(l), found = n.camps.find(x => x.id === l.campId);
    const col = found ? CHAN[found.chan].c : "var(--camp)";
    pin = '<g class="pin" data-pin="' + l.campId + '" transform="translate(' + b.x + "," + b.y + ')">' +
      '<circle r="11" fill="' + col + '"/><text>' + (idx + 1) + "</text></g>";
  }
  let editBtn = "";
  if (l.kind === "text" && canEdit()) {
    editBtn = '<g class="lyr-editbtn" data-edit-layer="' + l.id + '" transform="translate(' + (l.x - 4) + "," + (l.y - 26) + ')">' +
      '<circle cx="11" cy="11" r="11"/><svg x="3" y="3" width="16" height="16" viewBox="0 0 24 24"><use href="#i-edit"/></svg></g>';
  }
  return '<g class="lyr" data-layer="' + l.id + '">' + s + hit + pin + editBtn + "</g>";
}
/* 텍스트는 글꼴·언어에 따라 폭이 크게 달라져 추정치(bbox)가 부정확하다.
   실제 DOM에 그려진 뒤 getBBox()로 재는 편이 항상 정확하다. */
function measureBbox(svg, l) {
  if (l.kind === "text") {
    const el = svg.querySelector('[data-layer="' + l.id + '"] text');
    if (el) { try { const r = el.getBBox(); return { x: r.x, y: r.y, w: r.width, h: r.height }; } catch (e) {} }
  }
  return bbox(l);
}
function renderLayers() {
  const n = curNode(), svg = $("#layerSvg");
  if (!n || !svg) return;
  const s = stageScale(n);
  svg.innerHTML = (n.layers || []).map((l, i) => layerMarkup(l, n, i)).join("");
  const L = (n.layers || []).find(x => x.id === sel.layer);
  if (L) {
    const b = measureBbox(svg, L), hs = 6 / s;
    svg.insertAdjacentHTML("beforeend",
      '<rect class="selbox" x="' + (b.x - 3) + '" y="' + (b.y - 3) + '" width="' + (b.w + 6) + '" height="' + (b.h + 6) + '"/>' +
      (L.kind === "pen" ? "" : '<rect class="handle" data-handle="1" x="' + (b.x + b.w - hs) + '" y="' + (b.y + b.h - hs) + '" width="' + hs * 2 + '" height="' + hs * 2 + '" rx="' + hs * 0.5 + '"/>'));
  }
}
const paintLayers = onFrame(renderLayers);

function renderStage() {
  const n = curNode();
  const doc = $("#stageDoc"), empty = $("#stageEmpty");
  if (!n) {
    doc.innerHTML = ""; doc.style.width = doc.style.height = "0";
    mounted = { id: null, src: null, w: 0, h: 0 };
    empty.style.display = "grid"; $("#stageTitle").textContent = "페이지를 선택하세요"; $("#stageFoot").innerHTML = "";
    return;
  }
  empty.style.display = "none";
  $("#stageTitle").textContent = n.name;
  const base = docSize(n), ext = docExtent(n), s = stageScale(n), src = shotSrc(n);
  doc.style.width = Math.round(ext.w * s) + "px";
  doc.style.height = Math.round(ext.h * s) + "px";
  $("#sVal").textContent = stageZoom ? Math.round(s * 100) + "%" : "맞춤";
  $("#sFit").classList.toggle("on", !stageZoom);
  $("#sFitName").textContent = STAGE_FIT[stageFitMode].name;

  const shotStyle = "left:" + Math.round(-ext.x1 * s) + "px; top:" + Math.round(-ext.y1 * s) + "px; width:" + Math.round(base.w * s) + "px; height:" + Math.round(base.h * s) + "px;";
  if (mounted.id !== n.id || mounted.src !== src || mounted.w !== base.w || mounted.h !== base.h) {
    const shot = src
      ? '<img class="shot" src="' + src + '" alt="' + esc(n.name) + ' 화면" draggable="false" style="' + shotStyle + '">'
      : '<div class="noshot" style="' + shotStyle + '"><div class="empty">' + ico("image") + "<div>화면 이미지를 올리거나 붙여넣기(Ctrl+V)<br>없이도 레이어를 그릴 수 있습니다</div></div></div>";
    doc.innerHTML = shot + '<svg id="layerSvg" viewBox="' + ext.x1 + " " + ext.y1 + " " + ext.w + " " + ext.h + '"></svg>';
    mounted = { id: n.id, src: src, w: base.w, h: base.h };
  } else {
    const img = doc.querySelector(".shot, .noshot");
    if (img) positionShotEl(img, base, ext, s);
    const svg = $("#layerSvg");
    if (svg) svg.setAttribute("viewBox", ext.x1 + " " + ext.y1 + " " + ext.w + " " + ext.h);
  }
  renderLayers();
  renderStageFoot(n, (n.layers || []).find(x => x.id === sel.layer));
}
function renderStageFoot(n, L) {
  const d = docSize(n);
  let html = '<span class="mono" style="font-size:11px">' + d.w + " × " + d.h + "</span>";
  html += '<span class="tool-sep"></span><span>레이어 ' + (n.layers || []).length + "개</span>";
  if (L) {
    const camp = L.campId ? n.camps.find(c => c.id === L.campId) : null;
    html += '<span class="tool-sep"></span><span style="color:var(--ink-2)">선택: ' + LKIND(L) + "</span>";
    if (camp) html += '<span class="chip" style="--c:' + CHAN[camp.chan].c + '">' + ico("mega", "xs") + esc(camp.name) + "</span>";
    html += '<div class="spacer"></div>' +
      (L.kind === "text" ? '<button class="btn sm" data-lact="edittext">' + ico("edit", "xs") + "텍스트 수정</button>" : "") +
      '<button class="btn sm" data-lact="front">앞으로</button><button class="btn sm" data-lact="back">뒤로</button>' +
      '<button class="btn sm danger" data-lact="del">' + ico("trash", "xs") + "삭제</button>";
  } else {
    html += '<div class="spacer"></div><span>도형을 그린 뒤 왼쪽 패널에서 캠페인을 연결하세요</span>';
  }
  $("#stageFoot").innerHTML = html;
}
function LKIND(l) { return { rect: "사각형", ellipse: "원", arrow: "화살표", text: "텍스트", pen: "펜", image: "이미지" }[l.kind] || l.kind; }
function editTextLayer(n, l) {
  if (!canEdit()) return;
  openForm({
    title: "텍스트 레이어 수정", icon: "text", okText: "저장",
    fields: [{ k: "text", label: "내용" }, { k: "size", label: "글자 크기(px)", ph: "18" }, { k: "outline", label: "그림자 효과(흰 테두리)", type: "check" }],
    values: { text: l.text || "", size: String(l.size || 18), outline: l.outline !== false },
    onSave: v => {
      l.text = v.text || "텍스트"; l.size = Number(v.size) || 18; l.outline = !!v.outline;
      markDirty(); renderFlow(); renderStage(); renderPanels();
    },
    onDelete: () => confirmDel("이 텍스트 레이어를 삭제할까요?", () => {
      n.layers = n.layers.filter(x => x.id !== l.id); sel.layer = null;
      markDirty(); renderFlow(); renderStage(); renderPanels();
    })
  });
}

/* ---------------- 이미지 처리 ---------------- */
let webpOk = null;
function supportsWebp() {
  if (webpOk === null) {
    const cv = document.createElement("canvas"); cv.width = cv.height = 1;
    webpOk = cv.toDataURL("image/webp").indexOf("data:image/webp") === 0;
  }
  return webpOk;
}
function readImage(file, maxW, quality, keepAlpha) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const r = Math.min(1, maxW / img.width);
        const w = Math.max(1, Math.round(img.width * r)), h = Math.max(1, Math.round(img.height * r));
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        const type = supportsWebp() ? "image/webp" : (keepAlpha ? "image/png" : "image/jpeg");
        res({ src: cv.toDataURL(type, quality), w, h, type });
      };
      img.onerror = rej; img.src = fr.result;
    };
    fr.onerror = rej; fr.readAsDataURL(file);
  });
}
async function setShot(file, node, quiet) {
  const n = node || curNode(); if (!n || !file) return;
  try {
    const big = await readImage(file, 1200, 0.82, false);
    const th = await readImage(file, 300, 0.6, false);
    n.shotData = big.src; n.shotW = big.w; n.shotH = big.h; n.shotType = big.type;
    n.thumb = th.src; n.shotDirty = true;
    if (n.id === sel.node) stageZoom = null;
    markDirty();
    if (!quiet) {
      renderFlow();
      if (n.id === sel.node) renderStage();
      toast("화면 이미지를 등록했습니다 · " + Math.round(big.src.length / 1365) + "KB", "ok");
    }
  } catch (e) {
    if (quiet) throw e;
    toast("이미지를 읽지 못했습니다", "bad");
  }
}
async function addImageLayer(file) {
  const n = curNode(); if (!n || !file) return;
  try {
    const im = await readImage(file, 640, 0.82, true);
    const d = docSize(n), r = Math.min(1, (d.w * 0.55) / im.w);
    n.layers.push({ id: uid("l"), kind: "image", src: im.src, x: Math.round(d.w * 0.1), y: Math.round(d.h * 0.1), w: Math.round(im.w * r), h: Math.round(im.h * r), campId: null });
    sel.layer = n.layers[n.layers.length - 1].id;
    markDirty(); renderFlow(); renderStage(); renderPanels();
  } catch (e) { toast("이미지를 읽지 못했습니다", "bad"); }
}
function removeShot(node) {
  const n = node || curNode(); if (!n) return;
  n.shotData = null; n.shot = null; n.thumb = null; n.shotW = DOC_W; n.shotH = DOC_H; n.shotDirty = false;
  markDirty(); renderFlow(); if (n.id === sel.node) renderStage();
}
/* 화면 이미지 올리기/교체/삭제 — 노드 카드의 "설정"과 스테이지 카메라 버튼이 함께 쓴다.
   onDone은 이 흐름(올리기·교체·삭제·그냥 닫기)이 끝난 뒤 한 번 불린다 — 페이지
   정보 수정 창에서 열었을 때 그 창을 다시 띄워 입력하던 내용을 이어가게 하기 위함. */
function openShotModal(n, onDone) {
  const done = () => { if (onDone) onDone(); };
  if (n && shotSrc(n)) {
    openForm({
      title: "화면 이미지", icon: "image", okText: "새 이미지 올리기",
      fields: [], note: "현재 등록된 화면을 교체하거나 삭제합니다. 레이어는 그대로 유지됩니다.",
      values: {}, onSave: () => pickFile(f => setShot(f, n).then(done), done),
      onDelete: () => confirmDel("이 화면의 이미지를 삭제할까요?", () => { removeShot(n); done(); }),
      onClose: done
    });
  } else pickFile(f => setShot(f, n).then(done), done);
}
function pickFile(cb, onCancel) {
  const inp = $("#filePick");
  inp.value = "";
  inp.onchange = () => { if (inp.files && inp.files[0]) cb(inp.files[0]); else if (onCancel) onCancel(); };
  inp.oncancel = () => { if (onCancel) onCancel(); };   // 최신 브라우저: 선택 취소도 감지
  inp.click();
}

/* ---------------- 레이어 상호작용 ---------------- */
function initStage() {
  const doc = $("#stageDoc"), wrap = $("#stageWrap");
  const toDoc = ev => {
    const n = curNode(), d = docExtent(n), r = doc.getBoundingClientRect();
    return { x: d.x1 + (ev.clientX - r.left) / (r.width / d.w), y: d.y1 + (ev.clientY - r.top) / (r.height / d.h) };
  };

  doc.addEventListener("pointerdown", e => {
    const n = curNode(); if (!n || !canEdit()) return;
    const editBtn = e.target.closest("[data-edit-layer]");
    if (editBtn) {                                       /* 텍스트 레이어 위 편집 버튼 — 어떤 도구든 항상 동작 */
      e.preventDefault(); e.stopPropagation();
      const l = n.layers.find(x => x.id === editBtn.dataset.editLayer);
      if (l) editTextLayer(n, l);
      return;
    }
    const p = toDoc(e);
    const handle = e.target.closest("[data-handle]");
    const lyrEl = e.target.closest("[data-layer]");

    if (layerTool !== "select") {                       /* 새 레이어 그리기 */
      e.preventDefault();
      if (layerTool === "text") {
        openForm({
          title: "텍스트 레이어", icon: "text",
          fields: [{ k: "text", label: "내용" }, { k: "size", label: "글자 크기(px)", ph: "18" }, { k: "outline", label: "그림자 효과(흰 테두리)", type: "check" }],
          values: { text: "", size: "18", outline: true },
          onSave: v => {
            n.layers.push({ id: uid("l"), kind: "text", text: v.text || "텍스트", size: Number(v.size) || 18, outline: !!v.outline, x: Math.round(p.x), y: Math.round(p.y), color: drawColor, campId: null });
            sel.layer = n.layers[n.layers.length - 1].id;
            setTool("select"); markDirty(); renderFlow(); renderStage(); renderPanels();
          }
        });
        return;
      }
      const l = layerTool === "pen"
        ? { id: uid("l"), kind: "pen", points: [[p.x, p.y]], color: drawColor, stroke: drawStroke, campId: null }
        : { id: uid("l"), kind: layerTool, x: p.x, y: p.y, w: 0, h: 0, color: drawColor, stroke: drawStroke, fill: "none", campId: null };
      n.layers.push(l); sel.layer = l.id;
      const mv = ev => {
        const q = toDoc(ev);
        if (l.kind === "pen") { const last = l.points[l.points.length - 1]; if (Math.abs(q.x - last[0]) + Math.abs(q.y - last[1]) > 2) l.points.push([q.x, q.y]); }
        else { l.w = q.x - l.x; l.h = q.y - l.y; }
        paintLayers();
      };
      const up = () => {
        doc.removeEventListener("pointermove", mv); doc.removeEventListener("pointerup", up); doc.removeEventListener("pointercancel", up);
        if (l.kind !== "pen" && Math.abs(l.w) < 6 && Math.abs(l.h) < 6) { n.layers = n.layers.filter(x => x.id !== l.id); sel.layer = null; }
        if (l.kind === "pen" && l.points.length < 3) { n.layers = n.layers.filter(x => x.id !== l.id); sel.layer = null; }
        setTool("select"); markDirty(); renderFlow(); renderStage(); renderPanels();
      };
      doc.setPointerCapture(e.pointerId);
      doc.addEventListener("pointermove", mv); doc.addEventListener("pointerup", up); doc.addEventListener("pointercancel", up);
      return;
    }

    if (handle && sel.layer) {                           /* 리사이즈 */
      e.preventDefault();
      const l = n.layers.find(x => x.id === sel.layer);
      const mv = ev => { const q = toDoc(ev); l.w = q.x - l.x; l.h = q.y - l.y; paintLayers(); };
      const up = () => { doc.removeEventListener("pointermove", mv); doc.removeEventListener("pointerup", up); doc.removeEventListener("pointercancel", up); markDirty(); renderLayers(); resyncStageExtent(); };
      doc.setPointerCapture(e.pointerId);
      doc.addEventListener("pointermove", mv); doc.addEventListener("pointerup", up); doc.addEventListener("pointercancel", up);
      return;
    }

    if (lyrEl) {                                         /* 선택 + 이동 */
      e.preventDefault();
      const l = n.layers.find(x => x.id === lyrEl.dataset.layer);
      if (sel.layer !== l.id) { sel.layer = l.id; renderLayers(); renderStageFoot(n, l); renderPanels(); }
      const st = { x: p.x, y: p.y }, orig = l.kind === "pen" ? l.points.map(q => q.slice()) : { x: l.x, y: l.y };
      let moved = false;
      const mv = ev => {
        const q = toDoc(ev), dx = q.x - st.x, dy = q.y - st.y;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 1) return;
        moved = true;
        if (l.kind === "pen") l.points = orig.map(pt => [pt[0] + dx, pt[1] + dy]);
        else { l.x = orig.x + dx; l.y = orig.y + dy; }
        paintLayers();
      };
      const up = () => { doc.removeEventListener("pointermove", mv); doc.removeEventListener("pointerup", up); doc.removeEventListener("pointercancel", up); if (moved) { markDirty(); renderLayers(); resyncStageExtent(); } };
      doc.setPointerCapture(e.pointerId);
      doc.addEventListener("pointermove", mv); doc.addEventListener("pointerup", up); doc.addEventListener("pointercancel", up);
      return;
    }
    if (sel.layer) { sel.layer = null; renderLayers(); renderStageFoot(n, null); renderPanels(); }
  });

  $("#stageFoot").addEventListener("click", e => {
    const b = e.target.closest("[data-lact]"); if (!b) return;
    const n = curNode(), i = n.layers.findIndex(x => x.id === sel.layer);
    if (i < 0) return;
    const l = n.layers[i];
    if (b.dataset.lact === "edittext") return editTextLayer(n, l);
    if (b.dataset.lact === "del") { n.layers.splice(i, 1); sel.layer = null; }
    if (b.dataset.lact === "front") { n.layers.splice(i, 1); n.layers.push(l); }
    if (b.dataset.lact === "back") { n.layers.splice(i, 1); n.layers.unshift(l); }
    markDirty(); renderFlow(); renderStage(); renderPanels();
  });
  doc.addEventListener("dblclick", e => {
    const n = curNode(); if (!n || !canEdit()) return;
    const lyrEl = e.target.closest("[data-layer]"); if (!lyrEl) return;
    const l = n.layers.find(x => x.id === lyrEl.dataset.layer);
    if (l && l.kind === "text") editTextLayer(n, l);
  });

  $("#layerTools").addEventListener("click", e => {
    const b = e.target.closest("[data-tool]"); if (b) setTool(b.dataset.tool);
  });
  $("#swatches").innerHTML = SWATCH.map(c => '<button class="sw' + (c === drawColor ? " on" : "") + '" data-c="' + c + '" style="background:' + c + '" title="' + c + '"></button>').join("");
  $("#swatches").addEventListener("click", e => {
    const b = e.target.closest("[data-c]"); if (!b) return;
    drawColor = b.dataset.c;
    $$(".sw").forEach(x => x.classList.toggle("on", x === b));
    const n = curNode(), L = n && n.layers.find(x => x.id === sel.layer);
    if (L) { L.color = drawColor; markDirty(); renderLayers(); }
  });

  const STROKES = { 2: "얇게", 3: "보통", 6: "굵게" };
  $("#strokeSeg").innerHTML = Object.entries(STROKES).map(([w, name]) =>
    '<button class="btn sm' + (+w === drawStroke ? " on" : "") + '" data-sw="' + w + '" title="' + name + '">' + name + "</button>").join("");
  $("#strokeSeg").addEventListener("click", e => {
    const b = e.target.closest("[data-sw]"); if (!b) return;
    drawStroke = +b.dataset.sw;
    $$("#strokeSeg .btn").forEach(x => x.classList.toggle("on", x === b));
    const n = curNode(), L = n && n.layers.find(x => x.id === sel.layer);
    if (L && "stroke" in L) { L.stroke = drawStroke; markDirty(); renderLayers(); }
  });

  $("#btnShot").addEventListener("click", () => openShotModal(curNode()));
  $("#btnLayerImg").addEventListener("click", () => pickFile(addImageLayer));
  $("#sIn").addEventListener("click", () => { stageZoom = clamp(stageScale(curNode()) * 1.2, .1, 4); renderStage(); });
  $("#sOut").addEventListener("click", () => { stageZoom = clamp(stageScale(curNode()) / 1.2, .1, 4); renderStage(); });
  $("#sFit").addEventListener("click", () => {
    openMenu(Object.entries(STAGE_FIT).map(([k, v]) =>
      '<button class="mi' + (k === stageFitMode && !stageZoom ? " on" : "") + '" data-act="' + k + '">' + ico("fit", "xs") + v.name +
      (k === "width" ? '<span class="cnt">기본</span>' : "") + "</button>").join(""), $("#sFit"), it => {
        stageFitMode = it.dataset.act; stageZoom = null; renderStage();
      });
  });

  /* Alt + 휠 = 화면 확대/축소, Alt를 누르지 않으면 평소대로 세로 스크롤 */
  $("#stageScroll").addEventListener("wheel", e => {
    if (!e.altKey) return;
    e.preventDefault();
    const n = curNode(); if (!n) return;
    stageZoom = clamp(stageScale(n) * (e.deltaY < 0 ? 1.08 : 1 / 1.08), .05, 4);
    renderStage();
  }, { passive: false });

  /* 실제 OS 파일 드래그일 때만 반응한다 — 레이어를 옮기다가(포인터 드래그) 우연히
     브라우저 기본 이미지 드래그가 겹쳐도 드롭존이 잘못 뜨지 않도록 방어한다. */
  const hasFiles = e => e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") >= 0;
  ["dragenter", "dragover"].forEach(t => wrap.addEventListener(t, e => { if (!hasFiles(e)) return; e.preventDefault(); wrap.classList.add("dragover"); }));
  wrap.addEventListener("dragleave", e => { if (wrap.contains(e.relatedTarget)) return; wrap.classList.remove("dragover"); });
  wrap.addEventListener("drop", e => {
    wrap.classList.remove("dragover");
    if (!canEdit() || !hasFiles(e)) return;
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && /^image\//.test(f.type)) { const n = curNode(); n && shotSrc(n) ? addImageLayer(f) : setShot(f); }
  });
  document.addEventListener("paste", e => {
    if (!canEdit()) return;
    const items = e.clipboardData && e.clipboardData.items; if (!items) return;
    for (const it of items) {
      if (it.type && it.type.indexOf("image") === 0) {
        const f = it.getAsFile();
        if (f) { const n = curNode(); n && shotSrc(n) ? addImageLayer(f) : setShot(f); e.preventDefault(); }
        return;
      }
    }
  });
  const fitSoon = onFrame(() => { if (!stageZoom) renderStage(); });
  new ResizeObserver(fitSoon).observe($("#stageScroll"));
}
function setTool(t) {
  layerTool = t;
  $$("#layerTools .btn").forEach(b => b.classList.toggle("on", b.dataset.tool === t));
  $("#stageDoc").style.cursor = t === "select" ? "default" : "crosshair";
}
function selectNode(id) {
  sel.node = id; sel.layer = null;
  state.ui.sel = id;
  paintSelection(); renderStage(); renderPanels();
}
