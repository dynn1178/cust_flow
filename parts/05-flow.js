
/* ========================================================================
   여정 도식화 — 노드 배치 · 연결선 라우팅 · 자석 정렬 · 자동 정렬
   렌더 원칙: 구조가 바뀔 때만 DOM을 만들고, 드래그 중에는 속성만 갱신한다.
   ======================================================================== */
const NSZ = {};                       // 노드 실제 크기 캐시
const EDGE_EL = {};                   // 엣지 id -> DOM 참조
let flowMode = "select";
let linkFrom = null;
let laneMode = false;                 // 구간 그리기 모드 — 캔버스 배경을 드래그해 구간을 만든다
let autoLayoutDir = "v";              // 마지막으로 쓴 정렬 방향(메뉴에 표시용) — v: 세로 정렬, h: 가로 정렬

function onFrame(fn) {                // 다음 프레임에 한 번만 실행
  let id = 0, last = null;
  return function () {
    last = arguments;
    if (id) return;
    id = requestAnimationFrame(() => { id = 0; fn.apply(null, last); });
  };
}
function nodeW(n) { return (NSIZE[n.size] || NSIZE.m).w; }
function nodeRect(n) {
  const s = NSZ[n.id];
  /* midY = 포트·연결선이 좌우로 붙는 세로 기준점. 태그·캠페인 목록은 카드
     아래 바깥에 노출될 뿐 길이가 들쭉날쭉해서, 전체 높이의 절반을 쓰면 목록이
     길어질 때마다 연결선 시작점이 이미지에서 멀어진다 — 그래서 이름·이미지·
     배지를 담은 테두리(frameH)만의 세로 중앙을 쓴다. */
  const h = s ? s.h : 150;
  const midY = n.y + (s && s.frameH ? s.frameH : h) / 2;
  return { x: n.x, y: n.y, w: s ? s.w : nodeW(n), h, midY };
}

/* ---------------- 연결선 기하 ---------------- */
const SIDE_N = { n: { x: 0, y: -1 }, s: { x: 0, y: 1 }, e: { x: 1, y: 0 }, w: { x: -1, y: 0 } };
function sidePoint(r, side) {
  const midY = r.midY != null ? r.midY : r.y + r.h / 2;
  if (side === "n") return { x: r.x + r.w / 2, y: r.y };
  if (side === "s") return { x: r.x + r.w / 2, y: r.y + r.h };
  if (side === "w") return { x: r.x, y: midY };
  return { x: r.x + r.w, y: midY };
}
function autoSide(r, target) {
  const cx = r.x + r.w / 2, cy = r.midY != null ? r.midY : r.y + r.h / 2;
  const dx = target.x - cx, dy = target.y - cy;
  if (Math.abs(dx) * r.h >= Math.abs(dy) * r.w) return dx >= 0 ? "e" : "w";
  return dy >= 0 ? "s" : "n";
}
function edgeGeom(e) {
  const a = nodeById(e.from), b = nodeById(e.to);
  if (!a || !b) return null;
  const ra = nodeRect(a), rb = nodeRect(b);
  const wps = (e.points || []).map(p => ({ x: p.x, y: p.y }));
  const firstT = wps[0] || { x: rb.x + rb.w / 2, y: rb.y + rb.h / 2 };
  const lastT = wps[wps.length - 1] || { x: ra.x + ra.w / 2, y: ra.y + ra.h / 2 };
  const s1 = e.a1 && e.a1 !== "auto" ? e.a1 : autoSide(ra, firstT);
  const s2 = e.a2 && e.a2 !== "auto" ? e.a2 : autoSide(rb, lastT);
  return { p1: sidePoint(ra, s1), n1: SIDE_N[s1], p2: sidePoint(rb, s2), n2: SIDE_N[s2], wps, self: e.from === e.to, ra, rb };
}
function smoothPath(pts) {
  if (pts.length < 2) return "";
  let d = "M " + pts[0].x + " " + pts[0].y;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += " C " + c1.x + " " + c1.y + " " + c2.x + " " + c2.y + " " + p2.x + " " + p2.y;
  }
  return d;
}
function roundedPath(pts, r) {
  if (pts.length < 3) return "M " + pts.map(p => p.x + " " + p.y).join(" L ");
  let d = "M " + pts[0].x + " " + pts[0].y;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], a = pts[i - 1], b = pts[i + 1];
    const d1 = Math.hypot(p.x - a.x, p.y - a.y), d2 = Math.hypot(b.x - p.x, b.y - p.y);
    const rr = Math.min(r, d1 / 2, d2 / 2);
    if (rr < 1) { d += " L " + p.x + " " + p.y; continue; }
    const s = { x: p.x + (a.x - p.x) / d1 * rr, y: p.y + (a.y - p.y) / d1 * rr };
    const t = { x: p.x + (b.x - p.x) / d2 * rr, y: p.y + (b.y - p.y) / d2 * rr };
    d += " L " + s.x + " " + s.y + " Q " + p.x + " " + p.y + " " + t.x + " " + t.y;
  }
  const last = pts[pts.length - 1];
  return d + " L " + last.x + " " + last.y;
}
function orthoPoints(g) {
  const out = [g.p1];
  let cur = { x: g.p1.x + g.n1.x * 24, y: g.p1.y + g.n1.y * 24 };
  out.push(cur);
  let horiz = g.n1.x !== 0;
  const targets = g.wps.concat([{ x: g.p2.x + g.n2.x * 24, y: g.p2.y + g.n2.y * 24 }]);
  targets.forEach(t => {
    if (Math.abs(t.x - cur.x) > 0.5 && Math.abs(t.y - cur.y) > 0.5) {
      out.push(horiz ? { x: t.x, y: cur.y } : { x: cur.x, y: t.y });
      horiz = !horiz;
    }
    out.push(t); cur = t;
  });
  out.push(g.p2);
  return out.filter((p, i, arr) => i === 0 || Math.abs(p.x - arr[i - 1].x) > 0.4 || Math.abs(p.y - arr[i - 1].y) > 0.4);
}
function pathFor(e) {
  const g = edgeGeom(e);
  if (!g) return null;
  if (g.self) {                                     // 같은 노드로 돌아오는 연결
    const r = g.ra, x = r.x + r.w, y = r.y + r.h * 0.3, y2 = r.y + r.h * 0.72;
    return "M " + x + " " + y + " C " + (x + 86) + " " + (y - 38) + " " + (x + 86) + " " + (y2 + 38) + " " + x + " " + y2;
  }
  if (e.route === "line") return "M " + [g.p1].concat(g.wps, [g.p2]).map(p => p.x + " " + p.y).join(" L ");
  if (e.route === "ortho") return roundedPath(orthoPoints(g), 12);
  if (!g.wps.length) {                              // 기본 곡선 — 연결점 방향으로 부드럽게 빠져나간다
    const dist = Math.hypot(g.p2.x - g.p1.x, g.p2.y - g.p1.y);
    const c = clamp(dist * 0.42, 40, 190);
    return "M " + g.p1.x + " " + g.p1.y +
      " C " + (g.p1.x + g.n1.x * c) + " " + (g.p1.y + g.n1.y * c) +
      " " + (g.p2.x + g.n2.x * c) + " " + (g.p2.y + g.n2.y * c) +
      " " + g.p2.x + " " + g.p2.y;
  }
  const stub = 26;
  return smoothPath([g.p1, { x: g.p1.x + g.n1.x * stub, y: g.p1.y + g.n1.y * stub }]
    .concat(g.wps, [{ x: g.p2.x + g.n2.x * stub, y: g.p2.y + g.n2.y * stub }, g.p2]));
}

/* ---------------- 연결선 DOM ---------------- */
function edgeEl(e) {
  let rec = EDGE_EL[e.id];
  if (rec && rec.g.isConnected) return rec;
  const mk = t => document.createElementNS("http://www.w3.org/2000/svg", t);
  const g = mk("g"), wire = mk("path"), hit = mk("path"), head = mk("path"), tail = mk("path"), text = mk("text");
  g.setAttribute("data-edge", e.id);
  wire.setAttribute("class", "wire"); hit.setAttribute("class", "hit");
  head.setAttribute("class", "head"); tail.setAttribute("class", "head");
  text.setAttribute("text-anchor", "middle");
  [wire, hit, head, tail, text].forEach(x => g.appendChild(x));
  $("#edgeG").appendChild(g);
  rec = EDGE_EL[e.id] = { g, wire, hit, head, tail, text, d: "", label: null };
  return rec;
}
function headPath(rec, at, back, size) {
  const L = rec.wire.getTotalLength();
  if (!L) return "";
  const pe = rec.wire.getPointAtLength(at), pb = rec.wire.getPointAtLength(back);
  const a = Math.atan2(pe.y - pb.y, pe.x - pb.x);
  return "M " + pe.x + " " + pe.y +
    " L " + (pe.x - size * Math.cos(a - 0.4)) + " " + (pe.y - size * Math.sin(a - 0.4)) +
    " L " + (pe.x - size * Math.cos(a + 0.4)) + " " + (pe.y - size * Math.sin(a + 0.4)) + " Z";
}
function styleEdge(e, rec) {
  const on = sel.edge === e.id;
  const color = on ? "var(--accent)" : (e.hue && e.hue !== "none" ? hueOf(e.hue) : "var(--ink-3)");
  rec.g.setAttribute("class", on ? "sel" : "");
  rec.wire.style.stroke = color;
  rec.wire.style.strokeWidth = (e.width || 2) + (on ? 0.8 : 0);
  rec.head.style.fill = color; rec.tail.style.fill = color;
  if (e.style === "dashed") rec.wire.setAttribute("stroke-dasharray", (e.width || 2) * 3.2 + " " + (e.width || 2) * 2.6);
  else rec.wire.removeAttribute("stroke-dasharray");
  if (rec.label !== e.label) { rec.text.textContent = e.label || ""; rec.label = e.label; }
}
function geomEdge(e, rec) {
  const d = pathFor(e);
  if (!d) return;
  if (d !== rec.d) {
    rec.d = d;
    rec.wire.setAttribute("d", d);
    rec.hit.setAttribute("d", d);
  }
  const L = rec.wire.getTotalLength();
  const size = (7 + (e.width || 2) * 1.5) * ((HEADSZ[e.head] || HEADSZ.m).m);
  rec.head.setAttribute("d", e.kind === "none" ? "" : headPath(rec, L, Math.max(0, L - 14), size));
  rec.tail.setAttribute("d", e.kind === "both" ? headPath(rec, 0, Math.min(L, 14), size) : "");
  if (e.label) {
    const pt = rec.wire.getPointAtLength(L * 0.5);
    rec.text.setAttribute("x", pt.x);
    rec.text.setAttribute("y", pt.y - 7);
  }
}
function drawEdges() {
  const seen = {};
  B().edges.forEach(e => { const rec = edgeEl(e); seen[e.id] = 1; styleEdge(e, rec); geomEdge(e, rec); });
  Object.keys(EDGE_EL).forEach(id => { if (!seen[id]) { EDGE_EL[id].g.remove(); delete EDGE_EL[id]; } });
  drawEdgeHandles();
  updateFlowSelTools();
}
function moveEdgesOf(nodeId) {
  B().edges.forEach(e => { if (e.from === nodeId || e.to === nodeId) { const rec = EDGE_EL[e.id]; if (rec) geomEdge(e, rec); } });
  if (sel.edge) drawEdgeHandles();
}

/* 선택된 연결선의 경로 편집 손잡이 */
function drawEdgeHandles() {
  const box = $("#edgeHandles");
  const e = sel.edge ? edgeById(sel.edge) : null;
  if (!e || e.from === e.to || !canEdit()) { if (box.innerHTML) box.innerHTML = ""; return; }
  const g = edgeGeom(e); if (!g) { box.innerHTML = ""; return; }
  const pts = [g.p1].concat(g.wps, [g.p2]);
  let h = "";
  g.wps.forEach((p, i) => { h += '<circle class="wp" data-wp="' + i + '" cx="' + p.x + '" cy="' + p.y + '" r="6"></circle>'; });
  for (let i = 0; i < pts.length - 1; i++) {
    const m = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
    h += '<circle class="wpadd" data-add="' + i + '" cx="' + m.x + '" cy="' + m.y + '" r="5"></circle>';
  }
  box.innerHTML = h;
}

/* ---------------- 노드 ----------------
   보기 모드마다 카드 아래쪽 목록의 형태만 바뀐다 — 점 색으로 채널/상태를
   나타내고, 이름 아래 작은 메타 줄(선택)을 붙이는 공통 패턴(g-row)을 쓴다. */
function gRow(dotColor, name, meta, mono) {
  return '<div class="g-row' + (meta ? "" : " simple") + '"><span class="g-dot" style="background:' + dotColor + '"></span>' +
    '<div class="g-body"><span class="g-name' + (mono ? " mono" : "") + '">' + esc(name) + "</span>" +
    (meta ? '<span class="g-meta">' + meta + "</span>" : "") + "</div></div>";
}
function campRow(c) {
  const ch = CHAN[c.chan] || CHAN.push;
  return gRow(ch.c, c.name);
}
function tagRowsBig(n, plat) {
  const list = n.tags.filter(t => platformsOf(t).indexOf(plat) >= 0);
  if (!list.length) return '<div class="g-empty">' + PLAT[plat].name + " 태그 없음</div>";
  return '<div class="node-list">' + list.slice(0, 6).map(t =>
    gRow(TSTATUS_C[t.status], tagEventEn(t), (TRIGGER[t.trigger] || t.trigger) + " · " + TSTATUS[t.status] + (tagArea(t) ? " · " + esc(tagArea(t)) : ""), true)
  ).join("") + (list.length > 6 ? '<div class="g-more">+' + (list.length - 6) + "개 더</div>" : "") + "</div>";
}
function campRowsBig(n) {
  if (!n.camps.length) return '<div class="g-empty">등록된 캠페인 없음</div>';
  return '<div class="node-list">' + n.camps.slice(0, 6).map(c => {
    const ch = CHAN[c.chan] || CHAN.push;
    return gRow(CSTATUS_C[c.status], c.name, ch.name + " · " + CSTATUS[c.status] + (c.timing ? " · " + esc(c.timing) : ""));
  }).join("") + (n.camps.length > 6 ? '<div class="g-more">+' + (n.camps.length - 6) + "개 더</div>" : "") + "</div>";
}
function incompleteRowsBig(n) {
  const miss = completeness(n);
  if (!miss.length) return '<div class="g-empty">모두 등록됨</div>';
  return '<div class="node-list">' + miss.map(m => '<div class="g-miss">' + ico("alert", "xs") + esc(m) + "</div>").join("") + "</div>";
}
function focusCount(n, f) {
  if (f === "camp") return n.camps.length;
  if (f === "incomplete") return completeness(n).length;
  if (PLAT[f]) return n.tags.filter(t => platformsOf(t).indexOf(f) >= 0).length;
  return 0;
}
function nodeHtml(n) {
  const f = state.ui.focus || "all";
  const cnt = { amplitude: 0, braze: 0, ga4: 0 };
  n.tags.forEach(t => platformsOf(t).forEach(p => { if (cnt[p] != null) cnt[p]++; }));
  let bd = "";
  if (f === "all" || f === "simple") {
    /* 배지는 "플랫폼별 태그 수 + 캠페인 수"만 보여준다 — 숫자 하나하나가
       무엇을 센 것인지 카드만 보고 알 수 있어야 한다 */
    Object.keys(PLAT).forEach(p => {
      if (cnt[p]) bd += '<span class="bdg" style="--c:' + PLAT[p].c + '" title="' + PLAT[p].name + " 태그 " + cnt[p] + '개">' + ico(PLAT[p].ico, "xs") + "<b>" + cnt[p] + "</b></span>";
    });
    if (n.camps.length)
      bd += '<span class="bdg" style="--c:var(--camp)" title="CRM 캠페인 ' + n.camps.length + '개">' + ico("mega", "xs") + "<b>" + n.camps.length + "</b></span>";
  } else {
    const meta = FOCUS[f];
    bd = '<span class="bdg big" style="--c:' + (meta.c || "var(--ink-3)") + '">' + ico(meta.ico, "xs") + "<b>" + focusCount(n, f) + "</b></span>";
  }

  const th = thumbSrc(n);
  const thumb = (th ? '<img src="' + th + '" alt="" loading="lazy" decoding="async" draggable="false">'
                    : '<div class="ph">' + ico("image") + "<span>화면 미등록</span></div>") +
    '<div class="thumb-acts edit-only">' +
      '<button class="pick" data-nedit="' + n.id + '" title="페이지 이름·색·크기·모양·화면 바꾸기" tabindex="-1"><span>' +
      ico("edit", "xs") + "설정</span></button>" +
    "</div>";

  let body = "";
  if (f === "all") {
    body = n.camps.length ? '<div class="node-list">' + n.camps.slice(0, 4).map(campRow).join("") +
      (n.camps.length > 4 ? '<div class="g-more">+' + (n.camps.length - 4) + "개 더</div>" : "") + "</div>" : "";
  } else if (f === "camp") body = campRowsBig(n);
  else if (f === "incomplete") body = incompleteRowsBig(n);
  else if (PLAT[f]) body = tagRowsBig(n, f);

  const miss = completeness(n);
  const warn = miss.length ? '<span class="node-warn" title="' + esc(miss.join(" · ")) + '">' + ico("alert", "xs") + "</span>" : "";
  /* 제목·이미지·배지를 하나의 테두리(.node-frame)로 묶는다 — 확대·축소해도
     이 틀 전체가 한 덩어리로 같이 움직이니 안에서 글자가 넘칠 걱정이 없다.
     태그·캠페인 목록(body)은 지금처럼 그 바깥 아래에 그대로 노출한다.
     연결선 포트도 프레임 안에 둬서, 목록 길이와 상관없이 항상 프레임(이미지)
     세로 중앙에서 선이 시작하도록 한다. */
  return '<div class="node-frame">' +
      '<div class="node-title"><div class="node-name">' + esc(n.name) + "</div>" +
      (n.path ? '<div class="node-path">' + esc(n.path) + "</div>" : "") +
      "</div>" +
      '<div class="node-pic">' + thumb + warn + "</div>" +
      (bd ? '<div class="node-badges">' + bd + "</div>" : "") +
      '<span class="port n edit-only" data-port="' + n.id + '"></span><span class="port e edit-only" data-port="' + n.id + '"></span>' +
      '<span class="port s edit-only" data-port="' + n.id + '"></span><span class="port w edit-only" data-port="' + n.id + '"></span>' +
    "</div>" +
    (body ? '<div class="node-main">' + body + "</div>" : "");
}
function renderNodes() {
  const layer = $("#nodeLayer");
  const have = {};
  $$(".node", layer).forEach(el => { have[el.dataset.node] = el; });
  const drawn = [];
  B().nodes.forEach(n => {
    let el = have[n.id];
    if (!el) { el = document.createElement("div"); el.dataset.node = n.id; layer.appendChild(el); }
    else delete have[n.id];
    const f = state.ui.focus || "all";
    const dim = (f === "camp" || f === "incomplete" || PLAT[f]) && focusCount(n, f) === 0;
    el.className = "node size-" + (n.size || "m") + (n.sharp ? " sharp" : "") + (n.hue && n.hue !== "none" ? " hued" : "") + (dim ? " dim" : "");
    el.style.setProperty("--nc", hueOf(n.hue));
    const sig = [n.name, n.path, n.kind, n.size, n.hue, n.sharp, n.tags.length, n.camps.length, (n.layers || []).length,
      state.ui.focus, n.tags.map(t => platformsOf(t).join(",") + t.status + tagEventEn(t)).join("|"), n.camps.map(c => c.chan + c.status + c.name).join("|"),
      (thumbSrc(n) || "").length].join("§");
    if (el.dataset.sig !== sig) {
      el.innerHTML = nodeHtml(n);
      el.dataset.sig = sig;
    }
    el.style.left = n.x + "px"; el.style.top = n.y + "px";
    drawn.push([n, el]);
  });
  Object.keys(have).forEach(id => { have[id].remove(); delete NSZ[id]; });
  /* 크기 재기는 쓰기가 다 끝난 뒤에 한 번에 — 카드마다 "쓰고 바로 읽으면"
     그때마다 브라우저가 레이아웃을 다시 계산해서, 카드 수만큼 멈칫거린다 */
  drawn.forEach(pair => {
    const n = pair[0], el = pair[1], frameEl = el.querySelector(".node-frame");
    NSZ[n.id] = { w: el.offsetWidth || nodeW(n), h: el.offsetHeight || 150, frameH: frameEl ? frameEl.offsetHeight : 0 };
  });
  paintSelection();
}
function paintSelection() {
  $$("#nodeLayer .node").forEach(el => {
    el.classList.toggle("sel", el.dataset.node === sel.node);
    el.classList.toggle("link-src", el.dataset.node === linkFrom);
  });
  updateFlowSelTools();
}
/* 선택된 페이지·연결선의 설정을 우하단에서 항상 열 수 있게 — 작은 버튼이나
   얇은 선을 다시 정확히 클릭할 필요 없도록 스테이지의 "텍스트 수정"과 같은 역할 */
function updateFlowSelTools() {
  const bar = $("#flowSelTools");
  if (!bar) return;
  if (!canEdit()) { bar.style.display = "none"; return; }
  if (sel.edge) { bar.style.display = ""; $("#flowSelToolsLabel").textContent = "선 설정"; }
  else if (sel.node) { bar.style.display = ""; $("#flowSelToolsLabel").textContent = "페이지 설정"; }
  else bar.style.display = "none";
}
function renderFlow() { renderLanes(); renderNodes(); drawEdges(); renderMinimap(); }

/* 움직이는 동안에는 GPU 레이어로 부드럽게, 멈추면 레이어를 풀어
   브라우저가 현재 배율로 글자를 다시 그리게 한다(확대 시 흐려짐 방지). */
let settleTimer = 0, zoomVar = null;
function settleTransform() {
  const v = B().view, w = $("#flowWorld");
  w.style.willChange = "auto";
  /* --zoom은 카드 폭·글자 크기 계산식(.node)에 들어간다. 즉 이 값을 써넣을 때마다
     캔버스 안 카드 전부의 스타일과 레이아웃이 다시 계산된다 — 끌거나 확대하는 매
     프레임마다 그러고 있었던 것이 끊김의 가장 큰 원인이었다. 움직이는 동안에는
     GPU가 화면만 옮기고, 손을 뗀 뒤(=여기서) 한 번만 보정한다. */
  if (zoomVar !== v.zoom) { w.style.setProperty("--zoom", v.zoom); zoomVar = v.zoom; }
  w.style.transform = "translate(" + v.panX + "px," + v.panY + "px) scale(" + v.zoom + ")";
  renderMinimap();                          /* 움직임이 멈춘 뒤 한 번만 제대로 그린다 */
}
function applyTransform(live) {
  const v = B().view, w = $("#flowWorld");
  clearTimeout(settleTimer);
  if (live) {
    w.style.willChange = "transform";
    w.style.transform = "translate3d(" + v.panX + "px," + v.panY + "px,0) scale(" + v.zoom + ")";
    settleTimer = setTimeout(settleTransform, 160);
    updateMinimapView();                    /* 움직이는 중엔 미니맵의 "보이는 범위"만 옮긴다 */
  } else settleTransform();
  const zt = Math.round(v.zoom * 100) + "%";
  if ($("#zVal").textContent !== zt) $("#zVal").textContent = zt;
}
const applyTransformSoon = onFrame(function () { applyTransform(true); });
function zoomTo(z, cx, cy) {
  const v = B().view, old = v.zoom;
  z = clamp(z, 0.25, 2.2);
  if (cx == null) { const r = $("#flowSurface").getBoundingClientRect(); cx = r.width / 2; cy = r.height / 2; }
  v.panX = cx - (cx - v.panX) * (z / old);
  v.panY = cy - (cy - v.panY) * (z / old);
  v.zoom = z;
  applyTransformSoon(); markDirty();
}
function fitFlow() {
  const nodes = B().nodes;
  if (!nodes.length) return;
  const r = $("#flowSurface").getBoundingClientRect();
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  nodes.forEach(n => { const q = nodeRect(n); x1 = Math.min(x1, q.x); y1 = Math.min(y1, q.y); x2 = Math.max(x2, q.x + q.w + 90); y2 = Math.max(y2, q.y + q.h); });
  const v = B().view;
  const padT = 62, padB = 46, padX = 34;                 // 툴바·확대바에 가리지 않도록
  v.zoom = clamp(Math.min((r.width - padX * 2) / (x2 - x1), (r.height - padT - padB) / (y2 - y1)), 0.25, 1.4);
  v.panX = padX + (r.width - padX * 2 - (x2 - x1) * v.zoom) / 2 - x1 * v.zoom;
  v.panY = padT + (r.height - padT - padB - (y2 - y1) * v.zoom) / 2 - y1 * v.zoom;
  applyTransform(); markDirty();
}

/* ---------------- 자석 정렬 ---------------- */
const SNAP_T = 7;
function snapPos(n, x, y) {
  const guides = [];
  if (!state.ui.snap) return { x: Math.round(x), y: Math.round(y), guides };
  const sz = NSZ[n.id] || { w: nodeW(n), h: 150 };
  const mine = { x: [x, x + sz.w / 2, x + sz.w], y: [y, y + sz.h / 2, y + sz.h] };
  let bx = null, by = null;
  B().nodes.forEach(o => {
    if (o.id === n.id) return;
    const r = nodeRect(o);
    [r.x, r.x + r.w / 2, r.x + r.w].forEach(ov => mine.x.forEach(mv => {
      const d = Math.abs(mv - ov);
      if (d <= SNAP_T && (!bx || d < bx.d)) bx = { d, at: ov, shift: ov - mv, o: r };
    }));
    [r.y, r.y + r.h / 2, r.y + r.h].forEach(ov => mine.y.forEach(mv => {
      const d = Math.abs(mv - ov);
      if (d <= SNAP_T && (!by || d < by.d)) by = { d, at: ov, shift: ov - mv, o: r };
    }));
  });
  const nx = Math.round(bx ? x + bx.shift : Math.round(x / GRID) * GRID);
  const ny = Math.round(by ? y + by.shift : Math.round(y / GRID) * GRID);
  if (bx) guides.push({ v: true, at: bx.at, a: Math.min(ny, bx.o.y) - 26, b: Math.max(ny + sz.h, bx.o.y + bx.o.h) + 26 });
  if (by) guides.push({ v: false, at: by.at, a: Math.min(nx, by.o.x) - 26, b: Math.max(nx + sz.w, by.o.x + by.o.w) + 26 });
  return { x: nx, y: ny, guides };
}
function drawGuides(guides) {
  const g = $("#guideG");
  const html = (guides || []).map(q => q.v
    ? '<line class="guide" x1="' + q.at + '" y1="' + q.a + '" x2="' + q.at + '" y2="' + q.b + '"></line>'
    : '<line class="guide" x1="' + q.a + '" y1="' + q.at + '" x2="' + q.b + '" y2="' + q.at + '"></line>').join("");
  if (g.innerHTML !== html) g.innerHTML = html;
}

/* ---------------- 상호작용 ---------------- */
function initFlow() {
  const surf = $("#flowSurface");
  const busy = on => $("#flowPane").classList.toggle("busy", on);
  const toWorld = (ev, r) => ({ x: (ev.clientX - r.left - B().view.panX) / B().view.zoom, y: (ev.clientY - r.top - B().view.panY) / B().view.zoom });

  surf.addEventListener("wheel", e => {
    e.preventDefault();
    const r = surf.getBoundingClientRect();
    zoomTo(B().view.zoom * (e.deltaY < 0 ? 1.12 : 0.893), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  surf.addEventListener("pointerdown", e => {
    if (e.target.closest("[data-nedit]")) return;   /* 카드 안 버튼 위에서는 드래그를 준비하지 않는다 */
    if (laneMode && canEdit() && !e.target.closest(".lane-label") && !e.target.closest(".lane-edge")) { startLaneDraw(e, surf, surf.getBoundingClientRect()); return; }
    const r = surf.getBoundingClientRect();
    const wp = e.target.closest("[data-wp]"), add = e.target.closest("[data-add]");
    const port = e.target.closest("[data-port]");
    const nodeEl = e.target.closest("[data-node]");
    const edgeHit = e.target.closest("[data-edge]");
    const editable = canEdit();

    if (editable && (wp || add) && sel.edge) {           /* 경로 꺾임점 드래그 · 추가 */
      e.preventDefault(); e.stopPropagation();
      const ed = edgeById(sel.edge);
      let idx;
      if (wp) idx = +wp.dataset.wp;
      else { idx = +add.dataset.add; ed.points.splice(idx, 0, toWorld(e, r)); }
      const paint = onFrame(p => {
        ed.points[idx] = { x: Math.round(p.x), y: Math.round(p.y) };
        geomEdge(ed, EDGE_EL[ed.id]); drawEdgeHandles();
      });
      const mv = ev => paint(toWorld(ev, r));
      const up = () => {
        surf.removeEventListener("pointermove", mv); surf.removeEventListener("pointerup", up); surf.removeEventListener("pointercancel", up);
        markDirty(); geomEdge(ed, EDGE_EL[ed.id]); drawEdgeHandles();
      };
      surf.setPointerCapture(e.pointerId);
      surf.addEventListener("pointermove", mv); surf.addEventListener("pointerup", up); surf.addEventListener("pointercancel", up);
      return;
    }

    if (editable && port) {                              /* 포트 드래그 → 연결 */
      e.preventDefault(); e.stopPropagation();
      const from = port.dataset.port, ghost = $("#ghostWire");
      const rf = nodeRect(nodeById(from));
      const c0 = { x: rf.x + rf.w / 2, y: rf.y + rf.h / 2 };
      ghost.style.display = "";
      const paint = onFrame(p => ghost.setAttribute("d", "M " + c0.x + " " + c0.y + " L " + p.x + " " + p.y));
      const mv = ev => paint(toWorld(ev, r));
      const up = ev => {
        surf.removeEventListener("pointermove", mv); surf.removeEventListener("pointerup", up); surf.removeEventListener("pointercancel", up);
        ghost.style.display = "none";
        if (ev.type !== "pointerup") return;              /* 취소된 경우 연결을 만들지 않는다 */
        const tgt = document.elementFromPoint(ev.clientX, ev.clientY);
        const tn = tgt && tgt.closest("[data-node]");
        if (tn) addEdge(from, tn.dataset.node);
      };
      surf.setPointerCapture(e.pointerId);
      surf.addEventListener("pointermove", mv); surf.addEventListener("pointerup", up); surf.addEventListener("pointercancel", up);
      return;
    }

    if (nodeEl) {                                        /* 노드 선택 · 이동 */
      const id = nodeEl.dataset.node;
      if (editable && flowMode === "link") {
        e.preventDefault();
        if (!linkFrom) { linkFrom = id; paintSelection(); toast("연결할 도착 페이지를 클릭하세요"); }
        else { addEdge(linkFrom, id); linkFrom = null; paintSelection(); }
        return;
      }
      if (sel.node !== id) selectNode(id);
      if (sel.edge) { sel.edge = null; drawEdges(); }
      if (!editable) return;
      const n = nodeById(id), sx = e.clientX, sy = e.clientY, ox = n.x, oy = n.y;
      let moved = false;
      nodeEl.classList.add("dragging"); busy(true);
      const paint = onFrame(() => { nodeEl.style.left = n.x + "px"; nodeEl.style.top = n.y + "px"; moveEdgesOf(id); });
      const mv = ev => {
        const dx = (ev.clientX - sx) / B().view.zoom, dy = (ev.clientY - sy) / B().view.zoom;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
        moved = true;
        const s = snapPos(n, ox + dx, oy + dy);
        n.x = s.x; n.y = s.y;
        drawGuides(s.guides);
        paint();
      };
      const up = () => {
        surf.removeEventListener("pointermove", mv); surf.removeEventListener("pointerup", up); surf.removeEventListener("pointercancel", up);
        nodeEl.classList.remove("dragging"); busy(false); drawGuides([]);
        if (moved) { nodeEl.style.left = n.x + "px"; nodeEl.style.top = n.y + "px"; moveEdgesOf(id); markDirty(); }
      };
      surf.setPointerCapture(e.pointerId);
      surf.addEventListener("pointermove", mv); surf.addEventListener("pointerup", up); surf.addEventListener("pointercancel", up);
      return;
    }

    if (edgeHit && editable) { sel.edge = edgeHit.dataset.edge; drawEdges(); openEdgePop(sel.edge, e.clientX, e.clientY); return; }

    if (sel.edge) { sel.edge = null; drawEdges(); }       /* 배경 → 패닝 */
    const sx = e.clientX, sy = e.clientY, v = B().view, px = v.panX, py = v.panY;
    surf.classList.add("panning"); busy(true);
    const mv = ev => { v.panX = px + (ev.clientX - sx); v.panY = py + (ev.clientY - sy); applyTransformSoon(); };
    const up = () => {
      surf.removeEventListener("pointermove", mv); surf.removeEventListener("pointerup", up); surf.removeEventListener("pointercancel", up);
      surf.classList.remove("panning"); busy(false); markDirty();
    };
    surf.setPointerCapture(e.pointerId);
    surf.addEventListener("pointermove", mv); surf.addEventListener("pointerup", up); surf.addEventListener("pointercancel", up);
  });

  surf.addEventListener("dblclick", e => {
    if (!canEdit()) return;
    const wp = e.target.closest("[data-wp]");
    if (wp && sel.edge) { edgeById(sel.edge).points.splice(+wp.dataset.wp, 1); markDirty(); drawEdges(); return; }
    const n = e.target.closest("[data-node]");
    if (n) editNode(n.dataset.node);
  });

  $("#flowMode").addEventListener("click", e => {
    const b = e.target.closest("[data-mode]"); if (!b) return;
    flowMode = b.dataset.mode; linkFrom = null;
    $$("#flowMode .btn").forEach(x => x.classList.toggle("on", x === b));
    surf.classList.toggle("linking", flowMode === "link");
    paintSelection();
  });
  $("#btnAddNode").addEventListener("click", () => addNode());
  $("#btnLanes").addEventListener("click", () => {
    laneMode = !laneMode;
    $("#btnLanes").classList.toggle("on", laneMode);
    surf.classList.toggle("lane-drawing", laneMode);
    if (laneMode) toast("캔버스를 가로로 드래그해서 구간을 그리세요", "ok");
  });
  $("#btnAutoLayout").addEventListener("click", () => {
    openMenu(
      '<button class="mi' + (autoLayoutDir === "v" ? " on" : "") + '" data-act="v">' + ico("grid", "xs") + '세로 정렬<span class="cnt">기본</span></button>' +
      '<button class="mi' + (autoLayoutDir === "h" ? " on" : "") + '" data-act="h">' + ico("grid", "xs") + "가로 정렬</button>",
      $("#btnAutoLayout"), it => autoLayout(it.dataset.act)
    );
  });
  $("#btnFocus").addEventListener("click", () => {
    const cur = state.ui.focus || "all";
    openMenu(Object.entries(FOCUS).map(([k, v]) =>
      '<button class="mi' + (k === cur ? " on" : "") + '" data-act="' + k + '">' + ico(v.ico, "xs") + v.name +
      (k === "all" ? '<span class="cnt">기본</span>' : "") + "</button>").join(""), $("#btnFocus"), it => {
        state.ui.focus = it.dataset.act;
        syncFocusBtn(); markDirty(); renderFlow();
      });
  });
  $("#nodeLayer").addEventListener("click", e => {
    const b = e.target.closest("[data-nedit]");
    if (b && canEdit()) { e.stopPropagation(); if (sel.node !== b.dataset.nedit) selectNode(b.dataset.nedit); editNode(b.dataset.nedit); }
  });
  $("#btnSnap").addEventListener("click", () => {
    state.ui.snap = !state.ui.snap;
    $("#btnSnap").classList.toggle("on", state.ui.snap);
    toast(state.ui.snap ? "자석 정렬 켜짐 — 다른 페이지의 가장자리·중심선에 달라붙습니다" : "자석 정렬 꺼짐");
    markDirty();
  });
  $("#zIn").addEventListener("click", () => zoomTo(B().view.zoom * 1.15));
  $("#zOut").addEventListener("click", () => zoomTo(B().view.zoom / 1.15));
  $("#zFit").addEventListener("click", fitFlow);
  $("#btnFlowEdit").addEventListener("click", () => {
    if (sel.edge) { const r = $("#btnFlowEdit").getBoundingClientRect(); openEdgePop(sel.edge, r.left, r.top); }
    else if (sel.node) editNode(sel.node);
  });
}
function syncFocusBtn() {
  const f = state.ui.focus || "all", meta = FOCUS[f] || FOCUS.all;
  $("#focusName").textContent = meta.name;
  $("#focusIco use").setAttribute("href", "#i-" + meta.ico);
  $("#btnFocus").classList.toggle("on", f !== "all" && f !== "simple");
  $("#btnSnap").classList.toggle("on", !!state.ui.snap);
}

function addEdge(from, to) {
  if (B().edges.some(e => e.from === from && e.to === to)) { toast("이미 연결되어 있습니다"); paintSelection(); return; }
  B().edges.push({
    id: uid("e"), from, to, label: "", style: "solid", kind: "arrow",
    route: "curve", hue: "none", width: 2, a1: "auto", a2: "auto", points: []
  });
  markDirty(); renderFlow();
}

/* ---------------- 연결선 설정 ---------------- */
function openEdgePop(id, cx, cy) {
  const e = edgeById(id); if (!e) return;
  const seg = (key, opts, cur) => '<div class="seg wrap">' + Object.entries(opts).map(([k, v]) =>
    '<button class="btn sm' + (cur === k ? " on" : "") + '" data-' + key + '="' + k + '">' + esc(typeof v === "string" ? v : v.name) + "</button>").join("") + "</div>";
  const root = $("#popRoot");
  root.innerHTML =
    '<div class="popover glass wide">' +
      '<div class="frow"><span class="lbl">연결 라벨</span><input class="field" id="epLabel" value="' + esc(e.label) + '" placeholder="예: 장바구니 담기"></div>' +
      '<div class="frow"><span class="lbl">경로</span>' + seg("rt", ROUTE, e.route || "curve") + "</div>" +
      '<div class="frow"><span class="lbl">선 · 굵기</span><div class="rowseg">' + seg("st", { solid: "실선", dashed: "점선" }, e.style) +
        seg("wd", { 1: "가늘게", 2: "보통", 3: "굵게" }, String(e.width || 2)) + "</div></div>" +
      '<div class="frow"><span class="lbl">화살표</span>' + seg("kd", { arrow: "단방향", both: "양방향", none: "없음" }, e.kind) + "</div>" +
      '<div class="frow"><span class="lbl">화살촉 크기</span>' + seg("hd", HEADSZ, e.head || "m") + "</div>" +
      '<div class="frow"><span class="lbl">색</span><div class="hues">' +
        Object.entries(HUE).map(([k, h]) => '<button class="hue' + ((e.hue || "none") === k ? " on" : "") + '" data-hu="' + k + '" title="' + h.name + '" style="--h:' + h.c + '"></button>').join("") +
      "</div></div>" +
      '<div class="frow"><span class="lbl">연결점 — 출발</span>' + seg("a1", ANCHOR, e.a1 || "auto") + "</div>" +
      '<div class="frow"><span class="lbl">연결점 — 도착</span>' + seg("a2", ANCHOR, e.a2 || "auto") + "</div>" +
      '<p class="hint">선 위의 작은 점을 끌면 경로가 꺾입니다. 꺾임점을 더블클릭하면 지워집니다.</p>' +
      '<div class="rowseg">' +
        '<button class="btn sm" data-reset style="flex:1">' + ico("loop", "xs") + "경로 초기화</button>" +
        '<button class="btn sm danger" data-del style="flex:1">' + ico("trash", "xs") + "삭제</button>" +
        '<button class="btn sm primary" data-close style="flex:1">완료</button></div>' +
    "</div>";
  const pop = $(".popover", root);
  pop.style.left = clamp(cx - 150, 8, Math.max(8, innerWidth - 320)) + "px";
  pop.style.top = clamp(cy + 12, 8, Math.max(8, innerHeight - pop.offsetHeight - 12)) + "px";
  $("#epLabel", pop).addEventListener("input", ev => { e.label = ev.target.value; markDirty(); drawEdges(); });
  pop.addEventListener("click", ev => {
    const setSeg = (k, prop, num) => {
      const b = ev.target.closest("[data-" + k + "]"); if (!b) return;
      e[prop] = num ? +b.dataset[k] : b.dataset[k];
      $$("[data-" + k + "]", pop).forEach(x => x.classList.toggle("on", x === b));
    };
    if (ev.target.closest("[data-del]")) {
      B().edges = B().edges.filter(x => x.id !== id);
      root.innerHTML = ""; sel.edge = null; markDirty(); drawEdges(); return;
    }
    if (ev.target.closest("[data-reset]")) { e.points = []; e.a1 = "auto"; e.a2 = "auto"; markDirty(); drawEdges(); return; }
    if (ev.target.closest("[data-close]")) { root.innerHTML = ""; sel.edge = null; drawEdges(); return; }
    const hu = ev.target.closest("[data-hu]");
    if (hu) { e.hue = hu.dataset.hu; $$("[data-hu]", pop).forEach(x => x.classList.toggle("on", x === hu)); }
    setSeg("rt", "route"); setSeg("st", "style"); setSeg("kd", "kind"); setSeg("wd", "width", true); setSeg("hd", "head");
    setSeg("a1", "a1"); setSeg("a2", "a2");
    markDirty(); drawEdges();
  });
  const away = ev => {
    if (!ev.target.closest(".popover") && !ev.target.closest("[data-edge]") && !ev.target.closest("[data-wp]") && !ev.target.closest("[data-add]")) {
      root.innerHTML = ""; sel.edge = null; drawEdges();
      document.removeEventListener("pointerdown", away);
    }
  };
  setTimeout(() => document.addEventListener("pointerdown", away), 0);
}

/* ---------------- 노드 추가 · 편집 ---------------- */
function addNode() {
  const surf = $("#flowSurface").getBoundingClientRect(), v = B().view;
  const n = {
    id: uid("n"), kind: "page", name: "새 페이지", path: "", note: "",
    x: Math.round((surf.width / 2 - v.panX) / v.zoom - 95),
    y: Math.round((surf.height / 2 - v.panY) / v.zoom - 75),
    shot: null, shotData: null, thumb: null, shotW: DOC_W, shotH: DOC_H,
    hue: "none", size: "m", sharp: false, tags: [], camps: [], layers: []
  };
  B().nodes.push(n); markDirty(); renderFlow(); selectNode(n.id); editNode(n.id);
}
function editNode(id) {
  const n = nodeById(id); if (!n) return;
  openForm({
    title: "페이지 정보", icon: "map",
    fields: [
      { k: "name", label: "페이지 이름", ph: "예: 상품 상세" },
      { k: "kind", label: "유형", type: "select", opts: KIND },
      { k: "path", label: "경로 · 화면 ID", mono: true, ph: "/product/:id" },
      { k: "hue", label: "색", type: "swatch" },
      { k: "size", label: "카드 크기", type: "select", opts: NSIZE },
      { k: "sharp", label: "각진 모서리로", type: "check" },
      { k: "shot", label: "화면 이미지", type: "action", icon: "camera", actionLabel: shotSrc(n) ? "화면 교체·삭제" : "화면 올리기" },
      { k: "note", label: "메모", type: "textarea", ph: "이 화면에서 확인해야 할 것" }
    ],
    values: n,
    onSave: v => {
      Object.assign(n, { name: v.name || "이름 없음", kind: v.kind, path: v.path, note: v.note, hue: v.hue, size: v.size, sharp: !!v.sharp });
      markDirty(); renderFlow(); renderPanels();
    },
    onAction: (k, getValues) => {
      if (k !== "shot") return;
      /* 사진을 올리는 동안 다른 칸에 입력해 둔 내용을 잃지 않도록, 이 창을
         닫기 전에 지금까지 입력한 값을 먼저 반영해 둔다. */
      const v = getValues();
      Object.assign(n, { name: v.name || "이름 없음", kind: v.kind, path: v.path, note: v.note, hue: v.hue, size: v.size, sharp: !!v.sharp });
      markDirty(); renderFlow(); renderPanels();
      closeModal();
      openShotModal(n, () => editNode(n.id));
    },
    onDelete: () => confirmDel('"' + n.name + '" 페이지를 삭제할까요?', () => deleteNode(id))
  });
}

/* ---------------- 자동 정렬 ----------------
   지금 자리를 기준점으로 삼아 흐름 순서대로 다시 세운다.
   메뉴 라벨 "세로 정렬" — 흐름이 위→아래로 흐르도록 깊이(depth)를 세로축(y)에 놓고,
                       같은 깊이의 형제 노드는 가로로(x) 늘어놓는다.
   메뉴 라벨 "가로 정렬" — 흐름이 왼→오른쪽으로 흐르도록 깊이를 가로축(x)에 놓고,
                       같은 깊이의 형제 노드는 세로로(y) 쌓는다.
   화면(zoom·pan)은 건드리지 않으므로 시야가 튀지 않고, 되돌리기를 제공한다. */
function autoLayout(menuDir) {
  const dir0 = menuDir === "h" ? "h" : "v";
  autoLayoutDir = dir0;
  /* 아래 계산 로직은 원래 dir "h"=세로축 깊이, "v"=가로축 깊이로 짜여 있어서,
     메뉴 라벨과 맞추기 위해 여기서 뒤집어 넘긴다. */
  const dir = dir0 === "h" ? "v" : "h";
  const nodes = B().nodes, edges = B().edges;
  if (!nodes.length) return;
  const prev = nodes.map(n => ({ id: n.id, x: n.x, y: n.y }));
  const ox = Math.min.apply(null, nodes.map(n => n.x));
  const oy = Math.min.apply(null, nodes.map(n => n.y));

  const parent = {}; nodes.forEach(n => parent[n.id] = n.id);
  const find = a => parent[a] === a ? a : (parent[a] = find(parent[a]));
  edges.forEach(e => { if (parent[e.from] && parent[e.to]) parent[find(e.from)] = find(e.to); });
  const groups = {};
  nodes.forEach(n => (groups[find(n.id)] = groups[find(n.id)] || []).push(n));

  let cursor = oy;   // 다음 그룹은 항상 아래쪽으로 이어 쌓는다
  Object.keys(groups).forEach(key => {
    const g = groups[key], ids = g.map(n => n.id);
    const inner = edges.filter(e => ids.indexOf(e.from) >= 0 && ids.indexOf(e.to) >= 0 && e.from !== e.to);
    const depth = {}; ids.forEach(id => depth[id] = 0);
    for (let pass = 0; pass < ids.length + 2; pass++) {
      let moved = false;
      inner.forEach(e => { if (depth[e.to] < depth[e.from] + 1) { depth[e.to] = depth[e.from] + 1; moved = true; } });
      if (!moved) break;
    }
    const cols = {};
    g.forEach(n => (cols[depth[n.id]] = cols[depth[n.id]] || []).push(n));
    const colKeys = Object.keys(cols).map(Number).sort((a, b) => a - b);
    const order = {};
    colKeys.forEach((c, ci) => {
      cols[c].forEach((n, i) => {
        /* 화살표로 이어지지 않은(부모가 없는) 첫 열은, 생성 순서가 아니라 지금 화면에
           놓인 위치(세로 정렬은 위→아래, 가로 정렬은 왼→오른)를 기준으로 순서를 정한다 */
        if (!ci) { order[n.id] = dir === "h" ? n.x : n.y; return; }
        const ps = inner.filter(e => e.to === n.id).map(e => order[e.from]).filter(v => v != null);
        order[n.id] = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : i + 0.5;
      });
      cols[c].sort((a, b) => order[a.id] - order[b.id]);
      cols[c].forEach((n, i) => order[n.id] = i);
    });

    /* 같은 순번(i)에 있는 형제 노드들의 교차축 크기 — 세로 정렬은 높이, 가로 정렬은 너비 */
    const crossSize = [];
    const maxItems = Math.max.apply(null, colKeys.map(c => cols[c].length));
    for (let i = 0; i < maxItems; i++) {
      crossSize[i] = Math.max.apply(null, colKeys.map(c => {
        const n = cols[c][i]; if (!n) return 0;
        const z = NSZ[n.id];
        return dir === "h" ? (z ? z.w : nodeW(n)) : (z ? z.h : 150);
      }).concat([dir === "h" ? 160 : 110]));
    }

    /* 세로 정렬: main(깊이)=x는 항상 ox에서 시작, cross(형제)=y는 그룹마다 cursor에서 시작.
       가로 정렬: main(깊이)=y는 그룹마다 cursor에서 시작, cross(형제)=x는 항상 ox에서 시작. */
    const crossStart = dir === "h" ? ox : cursor;
    let main = dir === "h" ? cursor : ox;
    colKeys.forEach(c => {
      let cross = crossStart;
      const mainSize = Math.max.apply(null, cols[c].map(n => {
        const z = NSZ[n.id];
        return dir === "h" ? (z ? z.h : 150) : (z ? z.w : nodeW(n));
      }));
      cols[c].forEach((n, i) => {
        if (dir === "h") { n.x = Math.round(cross / GRID) * GRID; n.y = Math.round(main / GRID) * GRID; cross += crossSize[i] + 78; }
        else { n.x = Math.round(main / GRID) * GRID; n.y = Math.round(cross / GRID) * GRID; cross += crossSize[i] + 56; }
      });
      main += mainSize + (dir === "h" ? 56 : 78);
    });
    cursor = dir === "h" ? (main + 30) : (cursor + crossSize.reduce((a, b) => a + b + 56, 0) + 30);
  });

  markDirty(); renderFlow();
  toast("흐름 순서대로 정렬했습니다" + (dir0 === "h" ? " (가로)" : ""), "ok", {
    label: "되돌리기",
    fn: () => { prev.forEach(p => { const n = nodeById(p.id); if (n) { n.x = p.x; n.y = p.y; } }); markDirty(); renderFlow(); }
  });
}
