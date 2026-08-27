
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
  const tags = allTags().filter(({ t, n }) => (t.event + " " + (t.selector || "") + " " + n.name).toLowerCase().indexOf(q) >= 0);
  const camps = allCamps().filter(({ c, n }) => (c.name + " " + n.name).toLowerCase().indexOf(q) >= 0);
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
      r.tags.map(({ t, n, b }) => qsRow("tag", t.event, b.name + " · " + n.name, state.boards.indexOf(b), n.id)).join("");
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
function renderMinimap() {
  const svg = $("#minimapSvg"); if (!svg) return;
  const nodes = B().nodes;
  const mapW = 168, mapH = 112, pad = 10;
  if (!nodes.length) { svg.innerHTML = ""; return; }
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  nodes.forEach(n => { const q = nodeRect(n); x1 = Math.min(x1, q.x); y1 = Math.min(y1, q.y); x2 = Math.max(x2, q.x + q.w); y2 = Math.max(y2, q.y + q.h); });
  const bw = Math.max(1, x2 - x1), bh = Math.max(1, y2 - y1);
  const s = Math.min((mapW - pad * 2) / bw, (mapH - pad * 2) / bh);
  const ox = pad + (mapW - pad * 2 - bw * s) / 2, oy = pad + (mapH - pad * 2 - bh * s) / 2;
  const toMap = (x, y) => ({ x: ox + (x - x1) * s, y: oy + (y - y1) * s });
  let html = nodes.map(n => {
    const q = nodeRect(n), p = toMap(q.x, q.y);
    return '<rect x="' + p.x.toFixed(1) + '" y="' + p.y.toFixed(1) + '" width="' + Math.max(2, q.w * s).toFixed(1) + '" height="' + Math.max(2, q.h * s).toFixed(1) +
      '" rx="1.5" fill="' + (n.id === sel.node ? "var(--accent)" : hueOf(n.hue)) + '" opacity="' + (n.id === sel.node ? 1 : 0.7) + '"></rect>';
  }).join("");
  const surf = $("#flowSurface");
  if (surf) {
    const r = surf.getBoundingClientRect(), v = B().view;
    if (r.width && r.height && v.zoom) {
      const wx1 = -v.panX / v.zoom, wy1 = -v.panY / v.zoom, wx2 = wx1 + r.width / v.zoom, wy2 = wy1 + r.height / v.zoom;
      const vp1 = toMap(wx1, wy1), vp2 = toMap(wx2, wy2);
      html += '<rect class="mm-view" x="' + vp1.x.toFixed(1) + '" y="' + vp1.y.toFixed(1) + '" width="' + Math.max(0, vp2.x - vp1.x).toFixed(1) +
        '" height="' + Math.max(0, vp2.y - vp1.y).toFixed(1) + '"></rect>';
    }
  }
  svg.innerHTML = html;
  svg.dataset.x1 = x1; svg.dataset.y1 = y1; svg.dataset.s = s; svg.dataset.ox = ox; svg.dataset.oy = oy;
}
function initMinimap() {
  const svg = $("#minimapSvg"); if (!svg) return;
  const jump = ev => {
    const r = svg.getBoundingClientRect();
    const s = +svg.dataset.s; if (!s) return;
    const mx = (ev.clientX - r.left) * (168 / r.width), my = (ev.clientY - r.top) * (112 / r.height);
    const ox = +svg.dataset.ox, oy = +svg.dataset.oy, x1 = +svg.dataset.x1, y1 = +svg.dataset.y1;
    const wx = x1 + (mx - ox) / s, wy = y1 + (my - oy) / s;
    const sr = $("#flowSurface").getBoundingClientRect(), v = B().view;
    v.panX = sr.width / 2 - wx * v.zoom; v.panY = sr.height / 2 - wy * v.zoom;
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
  });
  $("#btnMinimap").classList.toggle("on", minimapOn);
}

/* ---------------- 구간(스윔레인) 배경 ----------------
   캔버스에 이름이 붙은 세로 구간을 배경으로 표시한다("유입 → 탐색 → 구매"
   같은 퍼널 단계). 시작 X 좌표가 작은 순서로 왼쪽부터 이어 붙이고,
   마지막 구간은 오른쪽으로 넉넉히 열어 둔다. */
function laneExtentY() {
  const nodes = B().nodes;
  if (!nodes.length) return { y1: -200, y2: 800 };
  let y1 = Infinity, y2 = -Infinity;
  nodes.forEach(n => { const q = nodeRect(n); y1 = Math.min(y1, q.y); y2 = Math.max(y2, q.y + q.h); });
  return { y1: y1 - 160, y2: y2 + 160 };
}
function renderLanes() {
  const layer = $("#laneLayer"); if (!layer) return;
  const b = B(), lanes = (b.lanes || []).slice().sort((a, z) => a.x - z.x);
  if (!lanes.length) { layer.innerHTML = ""; return; }
  const { y1, y2 } = laneExtentY(), h = Math.max(40, y2 - y1);
  layer.innerHTML = lanes.map((l, i) => {
    const nextX = i < lanes.length - 1 ? lanes[i + 1].x : l.x + 900;
    const w = Math.max(40, nextX - l.x);
    return '<div class="lane" style="left:' + l.x + "px; top:" + y1 + "px; width:" + w + "px; height:" + h + "px; --lc:" + (l.color || "#4a63e7") + '">' +
      '<div class="lane-label">' + esc(l.name || "구간") + "</div></div>";
  }).join("");
}
function laneRowHtml(l) {
  return '<div data-lane style="display:flex;gap:6px;align-items:center">' +
    '<input type="color" value="' + esc(l.color || "#4a63e7") + '" data-lc style="width:32px;height:32px;padding:2px;border-radius:8px;border:1px solid var(--stroke);background:var(--glass-2);flex:none">' +
    '<input class="field" placeholder="구간 이름 (예: 유입)" value="' + esc(l.name || "") + '" data-ln>' +
    '<input class="field mono" style="max-width:96px;flex:none" placeholder="시작 X" value="' + (l.x != null ? l.x : "") + '" data-lx>' +
    '<button class="btn icon sm" data-rmlane type="button">' + ico("close", "xs") + "</button></div>";
}
function openLaneModal() {
  if (!canEdit()) return;
  const b = B();
  const lanes = (b.lanes || []).slice().sort((a, z) => a.x - z.x);
  const root = modalHost();
  root.innerHTML =
    '<div class="scrim"><div class="modal glass" role="dialog" aria-modal="true">' +
      '<div class="modal-head">' + ico("lanes") + "<h3>구간(스윔레인)</h3><button class=\"btn icon sm\" data-x>" + ico("close", "xs") + "</button></div>" +
      '<div class="modal-body">' +
        '<p class="hint">캔버스에 세로 구간 배경을 표시합니다. 시작 X 좌표가 작은 순서대로 왼쪽부터 이어 붙습니다(비워두면 삭제).</p>' +
        '<div id="laneRows" style="display:flex;flex-direction:column;gap:6px">' + lanes.map(laneRowHtml).join("") + "</div>" +
        '<button class="btn sm" data-addlane type="button">' + ico("plus", "xs") + "구간 추가</button>" +
      "</div>" +
      '<div class="modal-foot"><div class="spacer"></div><button class="btn" data-x>취소</button><button class="btn primary" data-ok>저장</button></div>' +
    "</div></div>";
  root.addEventListener("click", e => {
    if (e.target.closest("[data-x]") || e.target.classList.contains("scrim")) return closeModal();
    if (e.target.closest("[data-addlane]")) { $("#laneRows").insertAdjacentHTML("beforeend", laneRowHtml({})); return; }
    if (e.target.closest("[data-rmlane]")) { e.target.closest("[data-lane]").remove(); return; }
    if (e.target.closest("[data-ok]")) {
      const existing = (b.lanes || []).slice();
      const rows = $$("[data-lane]", root);
      const next = [];
      rows.forEach((row, i) => {
        const name = $("[data-ln]", row).value.trim();
        const xRaw = $("[data-lx]", row).value.trim();
        if (!name && !xRaw) return;                    // 이름도 X도 비어 있으면 건너뛴다(=삭제)
        const x = xRaw === "" ? 0 : Number(xRaw);
        if (Number.isNaN(x)) return;
        next.push({ id: (existing[i] && existing[i].id) || uid("lane"), name: name || "구간", x, color: $("[data-lc]", row).value || "#4a63e7" });
      });
      b.lanes = next;
      closeModal(); markDirty(); renderFlow();
      toast("구간을 저장했습니다", "ok");
    }
  });
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
/* 반환값의 canvas.width/height는 선명도를 위해 dpr배 확대된 실제 픽셀 크기이고,
   w/h는 CSS 논리 크기다 — PDF에 넣을 때 페이지 크기(w/h)와 이미지 해상도
   (canvas.width/height)를 다르게 써야 하므로 둘 다 갖고 있어야 한다. */
function exportBoardCanvas() {
  const b = B(), nodes = b.nodes, edges = b.edges;
  if (!nodes.length) { toast("내보낼 페이지가 없습니다", "bad"); return null; }
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
  (b.lanes || []).slice().sort((p, q) => p.x - q.x).forEach((l, i, arr) => {
    const nextX = i < arr.length - 1 ? arr[i + 1].x : x2;
    const lx = l.x + ox, lw = Math.max(10, nextX - l.x);
    ctx.fillStyle = hexToRgba(l.color || "#4a63e7", 0.08);
    ctx.fillRect(lx, oy + y1 - 20, lw, (y2 - y1) + 40);
    ctx.fillStyle = l.color || "#4a63e7";
    ctx.font = "700 11px 'IBM Plex Sans KR', sans-serif";
    ctx.fillText(l.name || "", lx + 8, oy + y1 - 6);
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
    ctx.save();
    roundRectPath(ctx, x, y, q.w, q.h, 12);
    ctx.fillStyle = dark ? "#202023" : "#ffffff";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = n.hue && n.hue !== "none" ? hueOfHex(n.hue) : (dark ? "#3a3a40" : "#d7dcec");
    ctx.stroke();
    ctx.clip();
    if (n.hue && n.hue !== "none") { ctx.fillStyle = hueOfHex(n.hue); ctx.fillRect(x, y, 4, q.h); }
    ctx.restore();
    ctx.fillStyle = dark ? "#ededf0" : "#131a2c";
    ctx.font = "600 13px 'IBM Plex Sans KR', sans-serif";
    wrapText(ctx, n.name, x + 14, y + 24, q.w - 24, 16);
    ctx.font = "10px 'IBM Plex Sans KR', sans-serif";
    ctx.fillStyle = dark ? "#a6a6ad" : "#495372";
    ctx.fillText((KIND[n.kind] || "페이지") + " · 태그 " + n.tags.length + " · 캠페인 " + n.camps.length, x + 14, y + 44);
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
    const dl = window.claude && window.claude.use ? await window.claude.use("downloads") : null;
    if (dl) { await dl.save({ filename, data: blob }); toast(filename + " 저장 완료", "ok"); return; }
  } catch (e) { /* 아래 폴백 */ }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.style.display = "none";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(filename + " 저장 완료", "ok");
  } catch (e) { toast("파일을 내보낼 수 없습니다.", "bad"); }
}
function exportBoardPng() {
  const r = exportBoardCanvas(); if (!r) return;
  r.canvas.toBlob(blob => {
    if (!blob) { toast("이미지를 만들지 못했습니다", "bad"); return; }
    downloadBinary(safeBoardFilename() + ".png", blob);
  }, "image/png");
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
function exportBoardPdf() {
  const r = exportBoardCanvas(); if (!r) return;
  const jpegUrl = r.canvas.toDataURL("image/jpeg", 0.92);
  const jpegBytes = dataUrlToBytes(jpegUrl);
  const pdfBytes = buildPdfFromJpeg(jpegBytes, r.canvas.width, r.canvas.height, r.w, r.h);
  downloadBinary(safeBoardFilename() + ".pdf", new Blob([pdfBytes], { type: "application/pdf" }));
}
