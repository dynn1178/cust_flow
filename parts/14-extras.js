
/* ========================================================================
   추가 기능 모음 — 실행 취소 · 빠른 편집(복제/삭제) · 빠른 검색 · 미니맵 ·
   구간(스윔레인) 배경 · 보드 이미지/PDF 내보내기
   ======================================================================== */

/* ---------------- 실행 취소 / 다시 실행 ----------------
   보드별로 독립된 되돌리기 이력을 가진다(다른 보드를 오가며 편집해도 꼬이지
   않도록). markDirty() 호출이 짧게 이어지면(타이핑 등) 하나의 되돌리기
   단계로 묶는다. 화면 이미지 원본(shotData·thumb)은 용량이 커서 이력에
   담지 않는다 — 되돌리기는 배치·이름·태그·캠페인·레이어·연결선·구간 같은
   구조 변경에만 적용되고, 화면 이미지 등록/삭제나 보드 자체의 추가/삭제는
   대상이 아니다. */
const HISTORY_LIMIT = 50, HISTORY_COALESCE_MS = 600;
let history = {};             // boardId -> { base, undo:[], redo:[] }
let historyTimer = null;
let applyingHistory = false;

function boardSnapshot(b) {
  return JSON.stringify({
    nodes: b.nodes.map(n => { const c = Object.assign({}, n); delete c.shotData; delete c.thumb; return c; }),
    edges: b.edges, lanes: b.lanes || [], selNode: sel.node
  });
}
function historyOf(b) {
  if (!b) return null;
  let h = history[b.id];
  if (!h) h = history[b.id] = { base: boardSnapshot(b), undo: [], redo: [] };
  return h;
}
function updateHistoryUI() {
  const h = history[B().id];
  const u = $("#btnUndo"), r = $("#btnRedo");
  if (u) u.disabled = !h || !h.undo.length;
  if (r) r.disabled = !h || !h.redo.length;
}
function flushHistory() {
  clearTimeout(historyTimer); historyTimer = null;
  if (applyingHistory) return;
  const b = B(); if (!b) return;
  const h = historyOf(b);
  const cur = boardSnapshot(b);
  if (cur === h.base) return;
  h.undo.push(h.base);
  if (h.undo.length > HISTORY_LIMIT) h.undo.shift();
  h.redo = [];
  h.base = cur;
  updateHistoryUI();
}
function scheduleHistory() {
  if (applyingHistory) return;
  clearTimeout(historyTimer);
  historyTimer = setTimeout(flushHistory, HISTORY_COALESCE_MS);
}
function applyBoardSnapshot(b, json) {
  const snap = JSON.parse(json);
  applyingHistory = true;
  b.nodes = snap.nodes; b.edges = snap.edges; b.lanes = snap.lanes || [];
  if (b === B()) {
    sel = { node: snap.selNode && b.nodes.some(n => n.id === snap.selNode) ? snap.selNode : (b.nodes[0] || {}).id || null, edge: null, layer: null };
    mounted = { id: null, src: null, w: 0, h: 0 };
    Object.keys(EDGE_EL).forEach(k => { EDGE_EL[k].g.remove(); delete EDGE_EL[k]; });
    Object.keys(NSZ).forEach(k => delete NSZ[k]);
    $("#nodeLayer").innerHTML = "";
    renderFlow(); renderStage(); renderPanels();
  }
  applyingHistory = false;
  if (!dirty) { dirty = true; }
  setSaveChip("dirty", "저장 안 됨");
  invalidateViews();
  clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 900);
}
function undo() {
  if (!canEdit()) return;
  flushHistory();
  const b = B(), h = historyOf(b);
  if (!h.undo.length) { toast("되돌릴 내용이 없습니다"); return; }
  h.redo.push(h.base);
  h.base = h.undo.pop();
  applyBoardSnapshot(b, h.base);
  updateHistoryUI();
  toast("되돌렸습니다", "ok");
}
function redo() {
  if (!canEdit()) return;
  const b = B(), h = historyOf(b);
  if (!h.redo.length) { toast("다시 실행할 내용이 없습니다"); return; }
  h.undo.push(h.base);
  h.base = h.redo.pop();
  applyBoardSnapshot(b, h.base);
  updateHistoryUI();
  toast("다시 실행했습니다", "ok");
}
function seedHistoryForAllBoards() {
  history = {};
  state.boards.forEach(historyOf);
  updateHistoryUI();
}
function wireUndoRedoButtons() {
  $("#btnUndo").addEventListener("click", undo);
  $("#btnRedo").addEventListener("click", redo);
  updateHistoryUI();
}

/* ---------------- 빠른 편집: 복제 · 삭제 ---------------- */
function deleteNode(id) {
  B().nodes = B().nodes.filter(x => x.id !== id);
  B().edges = B().edges.filter(e => e.from !== id && e.to !== id);
  if (sel.node === id) sel.node = B().nodes.length ? B().nodes[0].id : null;
  markDirty(); renderFlow(); selectNode(sel.node);
}
function duplicateNode(id) {
  const n = nodeById(id); if (!n || !canEdit()) return;
  const copy = JSON.parse(JSON.stringify(n));
  copy.id = uid("n");
  copy.name = n.name + " 사본";
  copy.x = n.x + 32; copy.y = n.y + 32;
  copy.shotDirty = !!copy.shotData;
  copy.tags = copy.tags.map(t => Object.assign({}, t, { id: uid("t") }));
  copy.camps = copy.camps.map(c => Object.assign({}, c, { id: uid("c") }));
  /* 레이어의 캠페인 연결은 복제하지 않는다 — 같은 캠페인이 두 화면에 중복
     연결되면 캠페인 패널에서 어느 화면 기준인지 헷갈리기 때문. */
  copy.layers = (copy.layers || []).map(l => Object.assign({}, l, { id: uid("l"), campId: null }));
  B().nodes.push(copy);
  markDirty(); renderFlow(); selectNode(copy.id);
  toast('"' + n.name + '"을(를) 복제했습니다', "ok");
}

/* ---------------- 빠른 검색(Ctrl+F) — 페이지 · 태그 · 캠페인 ---------------- */
function globalSearchResults(q) {
  q = String(q || "").toLowerCase().trim();
  if (!q) return { nodes: [], tags: [], camps: [] };
  const nodes = [];
  state.boards.forEach(b => b.nodes.forEach(n => {
    if ((n.name + " " + (n.path || "")).toLowerCase().indexOf(q) >= 0) nodes.push({ n, b });
  }));
  const tags = allTags().filter(({ t, n }) => (tagEventEn(t) + " " + (t.eventKo || "") + " " + tagArea(t) + " " + n.name).toLowerCase().indexOf(q) >= 0);
  /* 여정 지도에 붙어 있는 캠페인은 시트에서 이름을 가져와 검색한다 */
  const camps = allCamps().map(({ c, n, b }) => ({ c: campView(c), n, b }))
    .filter(({ c, n }) => c && (c.name + " " + (c.code || "") + " " + n.name).toLowerCase().indexOf(q) >= 0);
  return { nodes: nodes.slice(0, 20), tags: tags.slice(0, 20), camps: camps.slice(0, 20) };
}
function qsRow(icoName, title, sub, bi, nodeId) {
  return '<button class="qs-row" type="button" data-bi="' + bi + '" data-node="' + nodeId + '">' + ico(icoName, "xs") +
    '<span class="qs-t">' + esc(title) + '</span><span class="qs-s">' + esc(sub) + "</span></button>";
}
function openQuickSearch() {
  const root = modalHost();
  root.innerHTML =
    '<div class="scrim"><div class="modal glass qsearch" role="dialog" aria-modal="true">' +
      '<div class="modal-head">' + ico("search") + "<h3>빠른 검색</h3><button class=\"btn icon sm\" data-x>" + ico("close", "xs") + "</button></div>" +
      '<div class="modal-body" style="gap:8px">' +
        '<input class="field" id="qsInput" placeholder="페이지 이름·경로·이벤트·캠페인 검색">' +
        '<div id="qsResults" class="qs-results"></div>' +
      "</div>" +
    "</div></div>";
  const inp = $("#qsInput"), out = $("#qsResults");
  const render = () => {
    const r = globalSearchResults(inp.value);
    const total = r.nodes.length + r.tags.length + r.camps.length;
    if (!inp.value.trim()) { out.innerHTML = '<p class="hint" style="padding:2px">페이지 이름, 경로, 이벤트명, 캠페인명으로 찾을 수 있습니다.</p>'; return; }
    if (!total) { out.innerHTML = '<div class="empty">' + ico("search") + "<div>일치하는 결과가 없습니다</div></div>"; return; }
    let html = "";
    if (r.nodes.length) html += '<div class="qs-group">페이지 · ' + r.nodes.length + "개</div>" +
      r.nodes.map(({ n, b }) => qsRow("map", n.name, b.name + (n.path ? " · " + n.path : ""), state.boards.indexOf(b), n.id)).join("");
    if (r.tags.length) html += '<div class="qs-group">태그 · ' + r.tags.length + "개</div>" +
      r.tags.map(({ t, n, b }) => qsRow("tag", tagEventEn(t), b.name + " · " + n.name, state.boards.indexOf(b), n.id)).join("");
    if (r.camps.length) html += '<div class="qs-group">캠페인 · ' + r.camps.length + "개</div>" +
      r.camps.map(({ c, n, b }) => qsRow("mega", c.name, b.name + " · " + n.name, state.boards.indexOf(b), n.id)).join("");
    out.innerHTML = html;
  };
  inp.addEventListener("input", render);
  out.addEventListener("click", e => {
    const row = e.target.closest("[data-node]"); if (!row) return;
    closeModal(); jumpTo(+row.dataset.bi, row.dataset.node);
  });
  root.addEventListener("keydown", e => {
    if (e.key === "Escape") { e.stopPropagation(); closeModal(); }
    if (e.key === "Enter") { const first = $(".qs-row", out); if (first) first.click(); }
  });
  root.addEventListener("click", e => { if (e.target.closest("[data-x]") || e.target.classList.contains("scrim")) closeModal(); });
  render();
  setTimeout(() => inp.focus(), 0);
}

/* ---------------- 미니맵 ---------------- */
/* 흐름 캔버스의 크기 — 미니맵을 그릴 때마다 getBoundingClientRect()를 부르면
   그때마다 레이아웃을 강제로 다시 계산하게 된다(끌고 있는 동안엔 매 프레임).
   실제로 크기가 바뀔 때만 ResizeObserver로 받아 캐시해 둔다. */
let flowBox = { w: 0, h: 0 };
function watchFlowSize() {
  const surf = $("#flowSurface"); if (!surf) return;
  const read = () => { flowBox = { w: surf.clientWidth, h: surf.clientHeight }; };
  read();
  if (window.ResizeObserver) new ResizeObserver(() => { read(); updateMinimapView(); }).observe(surf);
  else addEventListener("resize", read);
}
function minimapHidden() { const m = $("#minimap"); return !m || m.style.display === "none"; }
/* 미니맵 좌표계(마지막 그리기 기준)로 지금 보이는 범위를 사각형으로 환산한다 */
function minimapViewRect() {
  const d = $("#minimapSvg").dataset, v = B().view;
  if (!d.s || !flowBox.w || !flowBox.h || !v.zoom) return null;
  const s = +d.s, x1 = +d.x1, y1 = +d.y1, ox = +d.ox, oy = +d.oy;
  const px = ox + (-v.panX / v.zoom - x1) * s, py = oy + (-v.panY / v.zoom - y1) * s;
  return { x: px, y: py, w: Math.max(0, flowBox.w / v.zoom * s), h: Math.max(0, flowBox.h / v.zoom * s) };
}
/* 지도를 끄는 동안 부르는 가벼운 갱신 — 노드 사각형은 그대로이므로 SVG를 다시
   만들지 않고(문자열 조립 + 파싱 없음) 보이는 범위 사각형 하나만 옮긴다 */
function updateMinimapView() {
  if (minimapHidden()) return;
  const el = $("#minimapSvg .mm-view");
  if (!el) { renderMinimap(); return; }
  const r = minimapViewRect(); if (!r) return;
  el.setAttribute("x", r.x.toFixed(1)); el.setAttribute("y", r.y.toFixed(1));
  el.setAttribute("width", r.w.toFixed(1)); el.setAttribute("height", r.h.toFixed(1));
}
function renderMinimap() {
  const svg = $("#minimapSvg"); if (!svg || minimapHidden()) return;
  const nodes = B().nodes;
  const mapW = 168, mapH = 112, pad = 10;
  if (!nodes.length) { svg.innerHTML = ""; return; }
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  nodes.forEach(n => { const q = nodeRect(n); x1 = Math.min(x1, q.x); y1 = Math.min(y1, q.y); x2 = Math.max(x2, q.x + q.w); y2 = Math.max(y2, q.y + q.h); });
  const bw = Math.max(1, x2 - x1), bh = Math.max(1, y2 - y1);
  const s = Math.min((mapW - pad * 2) / bw, (mapH - pad * 2) / bh);
  const ox = pad + (mapW - pad * 2 - bw * s) / 2, oy = pad + (mapH - pad * 2 - bh * s) / 2;
  let html = nodes.map(n => {
    const q = nodeRect(n), px = ox + (q.x - x1) * s, py = oy + (q.y - y1) * s;
    return '<rect x="' + px.toFixed(1) + '" y="' + py.toFixed(1) + '" width="' + Math.max(2, q.w * s).toFixed(1) + '" height="' + Math.max(2, q.h * s).toFixed(1) +
      '" rx="1.5" fill="' + (n.id === sel.node ? "var(--accent)" : hueOf(n.hue)) + '" opacity="' + (n.id === sel.node ? 1 : 0.7) + '"></rect>';
  }).join("");
  svg.dataset.x1 = x1; svg.dataset.y1 = y1; svg.dataset.s = s; svg.dataset.ox = ox; svg.dataset.oy = oy;
  const vr = minimapViewRect();
  if (vr) html += '<rect class="mm-view" x="' + vr.x.toFixed(1) + '" y="' + vr.y.toFixed(1) +
    '" width="' + vr.w.toFixed(1) + '" height="' + vr.h.toFixed(1) + '"></rect>';
  svg.innerHTML = html;
}
function initMinimap() {
  const svg = $("#minimapSvg"); if (!svg) return;
  watchFlowSize();
  const jump = ev => {
    const r = svg.getBoundingClientRect();
    const s = +svg.dataset.s; if (!s) return;
    const mx = (ev.clientX - r.left) * (168 / r.width), my = (ev.clientY - r.top) * (112 / r.height);
    const ox = +svg.dataset.ox, oy = +svg.dataset.oy, x1 = +svg.dataset.x1, y1 = +svg.dataset.y1;
    const wx = x1 + (mx - ox) / s, wy = y1 + (my - oy) / s;
    const v = B().view;
    v.panX = flowBox.w / 2 - wx * v.zoom; v.panY = flowBox.h / 2 - wy * v.zoom;
    applyTransform(); markDirty();
  };
  svg.addEventListener("pointerdown", e => {
    e.preventDefault(); jump(e);
    const mv = ev => jump(ev);
    const up = () => { svg.removeEventListener("pointermove", mv); svg.removeEventListener("pointerup", up); };
    svg.setPointerCapture(e.pointerId);
    svg.addEventListener("pointermove", mv); svg.addEventListener("pointerup", up);
  });
  let minimapOn = true;
  $("#btnMinimap").addEventListener("click", () => {
    minimapOn = !minimapOn;
    $("#minimap").style.display = minimapOn ? "" : "none";
    $("#btnMinimap").classList.toggle("on", minimapOn);
    if (minimapOn) renderMinimap();          /* 꺼둔 동안엔 그리지 않으므로 켤 때 한 번 채운다 */
  });
  $("#btnMinimap").classList.toggle("on", minimapOn);
}

/* ---------------- 구간(스윔레인) 배경 ----------------
   캔버스에 이름이 붙은 구간을 배경으로 그린다("유입 → 탐색 → 구매" 같은 퍼널
   단계, 또는 가로·세로를 섞은 임의 영역). 좌표를 입력하는 대신 캔버스에서
   직접 사각형으로 그려서 만들고, 라벨을 끌면 이동, 네 변을 끌면 그 방향으로만
   크기를 조절한다. */
const LANE_PALETTE = ["#4a63e7", "#7c4ddb", "#12a97a", "#e08a1e", "#e0483f", "#0f9a70", "#64748b"];
function nextLaneColor() { return LANE_PALETTE[(B().lanes || []).length % LANE_PALETTE.length]; }
function laneById(id) { return (B().lanes || []).find(l => l.id === id); }
function laneExtentY() {
  const nodes = B().nodes;
  if (!nodes.length) return { y1: -200, y2: 800 };
  let y1 = Infinity, y2 = -Infinity;
  nodes.forEach(n => { const q = nodeRect(n); y1 = Math.min(y1, q.y); y2 = Math.max(y2, q.y + q.h); });
  return { y1: y1 - 160, y2: y2 + 160 };
}
/* 예전에는 구간이 세로 전체를 덮는 띠(x·w만 저장)였다 — y·h가 없는 예전
   데이터는 그때 모습 그대로 보이도록 세로 범위를 자동 계산해서 채운다. */
function laneRect(l) {
  if (l.y != null && l.h != null) return { x: l.x, y: l.y, w: l.w || 300, h: l.h };
  const { y1, y2 } = laneExtentY();
  return { x: l.x, y: y1, w: l.w || 900, h: Math.max(40, y2 - y1) };
}
function renderLanes() {
  const layer = $("#laneLayer"); if (!layer) return;
  const lanes = B().lanes || [];
  if (!lanes.length) { layer.innerHTML = ""; return; }
  const editable = canEdit();
  layer.innerHTML = lanes.map(l => {
    const r = laneRect(l);
    return '<div class="lane" data-lane="' + l.id + '" style="left:' + r.x + "px; top:" + r.y + "px; width:" + r.w + "px; height:" + r.h + "px; --lc:" + (l.color || "#4a63e7") + '">' +
      (editable ? '<div class="lane-edge l" data-edge="l"></div><div class="lane-edge r" data-edge="r"></div>' +
        '<div class="lane-edge t" data-edge="t"></div><div class="lane-edge b" data-edge="b"></div>' : "") +
      '<div class="lane-label"' + (editable ? "" : ' style="pointer-events:none"') + '><span class="lane-name">' + esc(l.name || "구간") + "</span>" +
      (editable ? '<span class="lane-editcue">' + ico("edit", "xs") + "</span>" : "") + "</div></div>";
  }).join("");
}
/* 캔버스 배경을 대각선으로 드래그해서 새 구간을 사각형으로 그린다 —
   initFlow()의 pointerdown 핸들러에서 laneMode일 때 이 함수로 넘어온다
   (노드 드래그·패닝과 겹치지 않도록 가장 먼저 분기). */
function startLaneDraw(e, surf, r) {
  e.preventDefault();
  const v = B().view;
  const toWorld = (cx, cy) => ({ x: (cx - r.left - v.panX) / v.zoom, y: (cy - r.top - v.panY) / v.zoom });
  const start = toWorld(e.clientX, e.clientY);
  let cur = start;
  const color = nextLaneColor();
  const preview = document.createElement("div");
  preview.className = "lane lane-preview";
  preview.style.setProperty("--lc", color);
  $("#laneLayer").appendChild(preview);
  const paint = () => {
    const x1 = Math.min(start.x, cur.x), y1 = Math.min(start.y, cur.y);
    const w = Math.max(4, Math.abs(cur.x - start.x)), h = Math.max(4, Math.abs(cur.y - start.y));
    preview.style.left = x1 + "px"; preview.style.top = y1 + "px"; preview.style.width = w + "px"; preview.style.height = h + "px";
  };
  paint();
  const mv = ev => { cur = toWorld(ev.clientX, ev.clientY); paint(); };
  const up = ev => {
    surf.removeEventListener("pointermove", mv); surf.removeEventListener("pointerup", up); surf.removeEventListener("pointercancel", up);
    preview.remove();
    laneMode = false; $("#btnLanes").classList.remove("on"); surf.classList.remove("lane-drawing");
    const x1 = Math.round(Math.min(start.x, cur.x)), y1 = Math.round(Math.min(start.y, cur.y));
    const w = Math.round(Math.abs(cur.x - start.x)), h = Math.round(Math.abs(cur.y - start.y));
    if (w < 20 || h < 20) return;
    const lane = { id: uid("lane"), name: "구간 " + ((B().lanes || []).length + 1), x: x1, y: y1, w, h, color };
    B().lanes = (B().lanes || []).concat(lane);
    markDirty(); renderFlow();
    if (ev.type === "pointerup") openLaneRenamePopover(lane.id, ev.clientX, ev.clientY);
  };
  surf.setPointerCapture(e.pointerId);
  surf.addEventListener("pointermove", mv); surf.addEventListener("pointerup", up); surf.addEventListener("pointercancel", up);
}
/* 라벨(이동)·네 변(그 방향으로 크기 조절) 드래그, 라벨을 드래그 없이 누르면
   이름·색 편집 팝오버를 연다. */
function initLaneInteractions() {
  const laneLayer = $("#laneLayer");
  laneLayer.addEventListener("pointerdown", e => {
    if (!canEdit()) return;
    const label = e.target.closest(".lane-label");
    const edge = e.target.closest(".lane-edge");
    if (!label && !edge) return;
    e.preventDefault(); e.stopPropagation();
    const laneEl = e.target.closest(".lane"), lane = laneById(laneEl.dataset.lane);
    if (!lane) return;
    const r0 = laneRect(lane);
    if (lane.y == null || lane.h == null) { lane.x = r0.x; lane.y = r0.y; lane.w = r0.w; lane.h = r0.h; }
    const v = B().view, sx = e.clientX, sy = e.clientY, ox = lane.x, oy = lane.y, ow = lane.w, oh = lane.h;
    const side = edge ? edge.dataset.edge : null;
    let moved = false;
    const mv = ev => {
      const dx = (ev.clientX - sx) / v.zoom, dy = (ev.clientY - sy) / v.zoom;
      if (Math.abs(ev.clientX - sx) > 3 || Math.abs(ev.clientY - sy) > 3) moved = true;
      if (label) { lane.x = Math.round(ox + dx); lane.y = Math.round(oy + dy); }
      else if (side === "r") lane.w = Math.max(20, Math.round(ow + dx));
      else if (side === "l") { const nx = Math.round(ox + dx), nw = Math.round(ow - dx); if (nw >= 20) { lane.x = nx; lane.w = nw; } }
      else if (side === "b") lane.h = Math.max(20, Math.round(oh + dy));
      else if (side === "t") { const ny = Math.round(oy + dy), nh = Math.round(oh - dy); if (nh >= 20) { lane.y = ny; lane.h = nh; } }
      renderFlow();
    };
    const up = () => {
      document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up);
      if (moved) markDirty();
      else if (label) openLaneRenamePopover(lane.id, sx, sy);
    };
    document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up);
  });
}
function openLaneRenamePopover(laneId, cx, cy) {
  const lane = laneById(laneId); if (!lane) return;
  const root = $("#popRoot");
  root.innerHTML =
    '<div class="popover glass">' +
      '<div class="frow"><span class="lbl">구간 이름</span><input class="field" id="lnName" value="' + esc(lane.name || "") + '" placeholder="예: 유입"></div>' +
      '<div class="frow"><span class="lbl">색</span><div class="hues" id="lnHues">' +
        LANE_PALETTE.map(c => '<button type="button" class="hue' + (lane.color === c ? " on" : "") + '" data-c="' + c + '" style="--h:' + c + '"></button>').join("") +
      "</div></div>" +
      '<div class="rowseg">' +
        '<button class="btn sm danger" data-dellane style="flex:1">' + ico("trash", "xs") + "삭제</button>" +
        '<button class="btn sm primary" data-closelane style="flex:1">완료</button></div>' +
    "</div>";
  const pop = $(".popover", root);
  pop.style.left = clamp(cx - 130, 8, Math.max(8, innerWidth - 300)) + "px";
  pop.style.top = clamp(cy + 12, 8, Math.max(8, innerHeight - pop.offsetHeight - 12)) + "px";
  $("#lnName", pop).addEventListener("input", ev => { lane.name = ev.target.value; markDirty(); renderFlow(); });
  pop.addEventListener("click", ev => {
    const c = ev.target.closest("[data-c]");
    if (c) { lane.color = c.dataset.c; $$("[data-c]", pop).forEach(x => x.classList.toggle("on", x === c)); markDirty(); renderFlow(); return; }
    if (ev.target.closest("[data-dellane]")) { B().lanes = (B().lanes || []).filter(x => x.id !== laneId); root.innerHTML = ""; markDirty(); renderFlow(); return; }
    if (ev.target.closest("[data-closelane]")) { root.innerHTML = ""; }
  });
  const away = ev => {
    if (!ev.target.closest(".popover") && !ev.target.closest(".lane-label")) {
      root.innerHTML = "";
      document.removeEventListener("pointerdown", away);
    }
  };
  setTimeout(() => document.addEventListener("pointerdown", away), 0);
  setTimeout(() => { const f = $("#lnName", pop); if (f) f.focus(); }, 0);
}

/* ---------------- 보드 이미지 / PDF 내보내기 ----------------
   화면(카드) 스타일을 그대로 캡처하는 대신, Canvas 2D로 정갈한 개요도를
   새로 그린다 — 외부 라이브러리 없이 동작하고, Cloudinary 같은 외부
   호스팅 이미지의 CORS 문제로 내보내기가 실패하는 상황을 피할 수 있다. */
function roundRectPath(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function wrapText(ctx, text, x, y, maxW, lh, maxLines) {
  maxLines = maxLines || 2;
  const chars = String(text || "").split("");
  let line = "", lines = [];
  for (let i = 0; i < chars.length; i++) {
    const test = line + chars[i];
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line); line = chars[i];
      if (lines.length === maxLines) break;
    } else line = test;
  }
  if (lines.length < maxLines && line) lines.push(line);
  const consumed = lines.join("").length;
  if (consumed < chars.length && lines.length) lines[lines.length - 1] = lines[lines.length - 1].replace(/.$/, "…");
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
}
function hueOfHex(k) {
  const h = HUE[k] || HUE.none;
  if (h.c.indexOf("var(") === 0) {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--ink-3").trim();
    return v || "#7b849f";
  }
  return h.c;
}
/* 썸네일을 CORS 허용 모드로 미리 불러온다 — crossOrigin을 지정하면 서버가
   CORS를 허용하지 않을 때 "오염된 채로 로드"되는 대신 아예 로드가 실패하므로
   (onerror), 캔버스를 더럽혀 내보내기 전체가 막히는 일 없이 그 카드만
   썸네일 없이 그려진다. */
function loadImageSafe(src, timeoutMs) {
  return new Promise(resolve => {
    if (!src) { resolve(null); return; }
    const img = new Image();
    let done = false;
    const finish = ok => { if (done) return; done = true; resolve(ok ? img : null); };
    img.crossOrigin = "anonymous";
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.src = src;
    setTimeout(() => finish(false), timeoutMs || 6000);
  });
}
function drawCover(ctx, img, dx, dy, dw, dh) {
  const ir = img.width / img.height, dr = dw / dh;
  let sx, sy, sw, sh;
  if (ir > dr) { sh = img.height; sw = sh * dr; sx = (img.width - sw) / 2; sy = 0; }
  else { sw = img.width; sh = sw / dr; sx = 0; sy = (img.height - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}
/* 반환값의 canvas.width/height는 선명도를 위해 dpr배 확대된 실제 픽셀 크기이고,
   w/h는 CSS 논리 크기다 — PDF에 넣을 때 페이지 크기(w/h)와 이미지 해상도
   (canvas.width/height)를 다르게 써야 하므로 둘 다 갖고 있어야 한다. */
async function exportBoardCanvas() {
  const b = B(), nodes = b.nodes, edges = b.edges;
  if (!nodes.length) { toast("내보낼 페이지가 없습니다", "bad"); return null; }
  const thumbImgs = {};
  await Promise.all(nodes.map(async n => {
    const src = thumbSrc(n); if (!src) return;
    const img = await loadImageSafe(src);
    if (img) thumbImgs[n.id] = img;
  }));
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  nodes.forEach(n => { const q = nodeRect(n); x1 = Math.min(x1, q.x); y1 = Math.min(y1, q.y); x2 = Math.max(x2, q.x + q.w); y2 = Math.max(y2, q.y + q.h); });
  const pad = 60, titleH = 56;
  const w = Math.ceil(x2 - x1 + pad * 2), h = Math.ceil(y2 - y1 + pad * 2 + titleH);
  const dpr = 2;
  const cv = document.createElement("canvas");
  cv.width = w * dpr; cv.height = h * dpr;
  const ctx = cv.getContext("2d");
  ctx.scale(dpr, dpr);
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  ctx.fillStyle = dark ? "#0a0a0b" : "#eef1f9";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = dark ? "#ededf0" : "#131a2c";
  ctx.font = "700 20px 'IBM Plex Sans KR', sans-serif";
  ctx.fillText(b.name, pad, 34);
  ctx.font = "12px 'IBM Plex Sans KR', sans-serif";
  ctx.fillStyle = dark ? "#a6a6ad" : "#7b849f";
  ctx.fillText("Customer Journey Atlas · " + new Date().toLocaleDateString("ko-KR"), pad, 52);

  const ox = pad - x1, oy = pad + titleH - y1;
  (b.lanes || []).forEach(l => {
    const lr = laneRect(l);
    const lx = lr.x + ox, ly = lr.y + oy;
    ctx.fillStyle = hexToRgba(l.color || "#4a63e7", 0.08);
    ctx.fillRect(lx, ly, lr.w, lr.h);
    ctx.strokeStyle = hexToRgba(l.color || "#4a63e7", 0.4);
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(lx, ly, lr.w, lr.h);
    ctx.setLineDash([]);
    ctx.fillStyle = l.color || "#4a63e7";
    ctx.font = "700 11px 'IBM Plex Sans KR', sans-serif";
    ctx.fillText(l.name || "", lx + 8, ly + 16);
  });
  edges.forEach(e => {
    const d = pathFor(e); if (!d) return;
    try {
      const p = new Path2D(d);
      ctx.save(); ctx.translate(ox, oy);
      ctx.strokeStyle = e.hue && e.hue !== "none" ? hueOfHex(e.hue) : (dark ? "#74747c" : "#7b849f");
      ctx.lineWidth = e.width || 2;
      if (e.style === "dashed") ctx.setLineDash([(e.width || 2) * 3.2, (e.width || 2) * 2.6]);
      ctx.stroke(p);
      ctx.restore();
    } catch (err) { /* 알 수 없는 경로 문자열은 건너뛴다 */ }
  });
  nodes.forEach(n => {
    const q = nodeRect(n), x = q.x + ox, y = q.y + oy;
    const img = thumbImgs[n.id];
    const thumbH = img ? Math.round(Math.min(q.h * 0.52, 128)) : 0;
    ctx.save();
    roundRectPath(ctx, x, y, q.w, q.h, 12);
    ctx.fillStyle = dark ? "#202023" : "#ffffff";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = n.hue && n.hue !== "none" ? hueOfHex(n.hue) : (dark ? "#3a3a40" : "#d7dcec");
    ctx.stroke();
    ctx.clip();
    if (img) {
      drawCover(ctx, img, x, y, q.w, thumbH);
      ctx.fillStyle = hexToRgba(dark ? "#000000" : "#ffffff", 0.02);
      ctx.fillRect(x, y + thumbH - 1, q.w, 1);
    }
    if (n.hue && n.hue !== "none") { ctx.fillStyle = hueOfHex(n.hue); ctx.fillRect(x, y, 4, q.h); }
    ctx.restore();
    const textTop = y + thumbH;
    ctx.fillStyle = dark ? "#ededf0" : "#131a2c";
    ctx.font = "600 13px 'IBM Plex Sans KR', sans-serif";
    wrapText(ctx, n.name, x + 14, textTop + 20, q.w - 24, 16);
    ctx.font = "10px 'IBM Plex Sans KR', sans-serif";
    ctx.fillStyle = dark ? "#a6a6ad" : "#495372";
    ctx.fillText((KIND[n.kind] || "페이지") + " · 태그 " + n.tags.length + " · 캠페인 " + n.camps.length, x + 14, textTop + 40);
    if (n.path) { ctx.font = "10px monospace"; ctx.fillStyle = dark ? "#74747c" : "#7b849f"; ctx.fillText(n.path, x + 14, y + q.h - 12); }
  });
  return { canvas: cv, w, h };
}
function hexToRgba(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "rgba(74,99,231," + a + ")";
  const n = parseInt(m[1], 16);
  return "rgba(" + [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(",") + "," + a + ")";
}
function safeBoardFilename() { return String(B().name || "board").replace(/[\\/:*?"<>|]/g, "").trim() || "board"; }
async function downloadBinary(filename, blob) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.style.display = "none";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(filename + " 저장 완료", "ok");
  } catch (e) { toast("파일을 내보낼 수 없습니다.", "bad"); }
}
async function exportBoardPng() {
  toast("이미지를 만드는 중…");
  const r = await exportBoardCanvas(); if (!r) return;
  try {
    r.canvas.toBlob(blob => {
      if (!blob) { toast("이미지를 만들지 못했습니다", "bad"); return; }
      downloadBinary(safeBoardFilename() + ".png", blob);
    }, "image/png");
  } catch (e) { toast("이미지를 만들지 못했습니다", "bad"); }
}
/* ---------------- 최소 PDF 생성기 ----------------
   외부 라이브러리 없이, JPEG 이미지를 그대로 한 페이지에 담는 PDF를 손으로
   조립한다. DCTDecode 필터를 쓰면 JPEG 바이트를 압축 없이 그대로 넣을 수
   있어 zlib 구현이 필요 없다 — 대부분의 PDF 뷰어가 지원하는 잘 알려진
   방식이다. */
function dataUrlToBytes(dataUrl) {
  const i = dataUrl.indexOf(","), b64 = dataUrl.slice(i + 1);
  const bin = atob(b64), arr = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
  return arr;
}
function bytesToBinaryString(bytes) {
  let s = ""; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return s;
}
function buildPdfFromJpeg(jpegBytes, pxW, pxH, ptW, ptH) {
  let out = "%PDF-1.4\n";
  const objOffsets = [0];
  const addObj = body => { objOffsets.push(out.length); out += body; };
  addObj("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  addObj("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  addObj("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + ptW + " " + ptH + "] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n");
  const jpegStr = bytesToBinaryString(jpegBytes);
  addObj("4 0 obj\n<< /Type /XObject /Subtype /Image /Width " + pxW + " /Height " + pxH +
    " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + jpegBytes.length + " >>\nstream\n" + jpegStr + "\nendstream\nendobj\n");
  const content = "q " + ptW + " 0 0 " + ptH + " 0 0 cm /Im0 Do Q";
  addObj("5 0 obj\n<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream\nendobj\n");
  const xrefStart = out.length;
  out += "xref\n0 " + objOffsets.length + "\n0000000000 65535 f \n";
  for (let i = 1; i < objOffsets.length; i++) out += String(objOffsets[i]).padStart(10, "0") + " 00000 n \n";
  out += "trailer\n<< /Size " + objOffsets.length + " /Root 1 0 R >>\nstartxref\n" + xrefStart + "\n%%EOF";
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
async function exportBoardPdf() {
  toast("PDF를 만드는 중…");
  const r = await exportBoardCanvas(); if (!r) return;
  try {
    const jpegUrl = r.canvas.toDataURL("image/jpeg", 0.92);
    const jpegBytes = dataUrlToBytes(jpegUrl);
    const pdfBytes = buildPdfFromJpeg(jpegBytes, r.canvas.width, r.canvas.height, r.w, r.h);
    downloadBinary(safeBoardFilename() + ".pdf", new Blob([pdfBytes], { type: "application/pdf" }));
  } catch (e) { toast("PDF를 만들지 못했습니다", "bad"); }
}
