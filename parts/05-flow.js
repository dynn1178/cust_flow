
/* ========================================================================
   여정 도식화 — 노드 배치 · 연결선 라우팅 · 자석 정렬 · 자동 정렬
   렌더 원칙: 구조가 바뀔 때만 DOM을 만들고, 드래그 중에는 속성만 갱신한다.
   ======================================================================== */
const NSZ = {};                       // 노드 실제 크기 캐시
const EDGE_EL = {};                   // 엣지 id -> DOM 참조
let flowMode = "select";
let linkFrom = null;
let selMulti = [];                    // 다중 선택 모드에서 골라 둔 노드 id 목록
let laneMode = false;                 // 구간 그리기 모드 — 캔버스 배경을 드래그해 구간을 만든다
let autoLayoutDir = "v";              // 마지막으로 쓴 정렬 방향(메뉴에 표시용) — v: 세로 정렬, h: 가로 정렬
let edgePopPos = null;                // 연결선 설정 창을 옮긴 위치 — 다음에 열 때도 같은 자리에 띄운다

function onFrame(fn) {                // 다음 프레임에 한 번만 실행
  let id = 0, last = null;
  return function () {
    last = arguments;
    if (id) return;
    id = requestAnimationFrame(() => { id = 0; fn.apply(null, last); });
  };
}
function nodeW(n) { const t = n.kind === "keyword" ? NSIZE_KEYWORD : NSIZE; return (t[n.size] || t.m).w; }
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
/* 연결선 전용 "기준" 크기 — 실제 렌더 크기(nodeRect)는 확대·축소에 따라
   카드 너비가 늘었다 줄었다 하고(가독성 보정), 태그 목록 길이에 따라 높이도
   들쭉날쭉해서, 이걸 그대로 연결선 계산에 쓰면 배율을 바꾸거나 태그를
   추가/삭제할 때마다 화살표가 붙는 자리·곡선 모양이 계속 흔들렸다. 연결선은
   항상 이 고정된 기준 크기만 보고 계산해서, 레이아웃이 어떻게 바뀌든 흐름이
   그대로 유지되게 한다. */
const NOM_PIC_H = { s: 99, m: 129, l: 165 };
const NOM_KW_H = { s: 34, m: 38, l: 44 };
function nodeNominalRect(n) {
  const w = nodeW(n);
  const h = n.kind === "keyword" ? (NOM_KW_H[n.size] || NOM_KW_H.m) : (NOM_PIC_H[n.size] || NOM_PIC_H.m) + 34;
  return { x: n.x, y: n.y, w, h, midY: n.y + h / 2 };
}
/* 화살표가 실제로 닿는 자리 전용 — 기준 크기(nom)를 쓰되, 확대·축소 배율이
   낮아 카드가 기준보다 실제로 더 크게 보일 때는(가독성 보정) 그만큼은
   따라가게 해서 화살촉이 카드 안쪽에 가려지지 않게 한다. 100% 이상
   배율에서는 실제 크기가 기준과 같아 완전히 고정된다 — "어느 변에 붙을지"
   판정(autoSide)에는 이 값 대신 항상 nom을 그대로 쓴다. */
function nodeVisibleRect(n, nom) {
  const s = NSZ[n.id];
  const w = s ? Math.max(nom.w, s.w) : nom.w;
  const h = s && s.frameH ? Math.max(nom.h, s.frameH) : nom.h;
  /* fullH = 태그·캠페인 목록까지 합친 카드 전체 높이(NSZ.h는 원래 이걸 잰다) —
     "아래(s)" 연결점 전용이다. midY(좌우 연결점 세로 중앙)는 그대로 프레임
     기준을 쓴다 — 목록 길이가 들쭉날쭉해도 좌우 연결점은 흔들리면 안 된다. */
  const fullH = s && s.h ? Math.max(nom.h, s.h) : h;
  return { x: n.x, y: n.y, w, h, fullH, midY: n.y + h / 2 };
}

/* ---------------- 연결선 기하 ---------------- */
const SIDE_N = { n: { x: 0, y: -1 }, s: { x: 0, y: 1 }, e: { x: 1, y: 0 }, w: { x: -1, y: 0 } };
/* t(0~100) = 그 변을 따라 어디에 붙을지(왼→오 · 위→아래). 안 주면(=undefined)
   예전처럼 항상 정가운데(50)에 붙는다 — 저장된 예전 연결선도 그대로 보인다. */
function sidePoint(r, side, t) {
  const midY = r.midY != null ? r.midY : r.y + r.h / 2;
  const pct = (t == null ? 50 : clamp(t, 0, 100)) / 100;
  if (side === "n") return { x: r.x + r.w * pct, y: r.y };
  if (side === "s") return { x: r.x + r.w * pct, y: r.y + (r.fullH != null ? r.fullH : r.h) };
  if (side === "w") return { x: r.x, y: midY + r.h * (pct - 0.5) };
  return { x: r.x + r.w, y: midY + r.h * (pct - 0.5) };
}
function autoSide(r, target) {
  const cx = r.x + r.w / 2, cy = r.midY != null ? r.midY : r.y + r.h / 2;
  const dx = target.x - cx, dy = target.y - cy;
  if (Math.abs(dx) * r.h >= Math.abs(dy) * r.w) return dx >= 0 ? "e" : "w";
  return dy >= 0 ? "s" : "n";
}
/* 두 카드가 겹치거나 나란히 붙어 있을 때, 양쪽 연결점을 각자 따로(자기
   중심에서 상대 중심까지의 각도만 보고) 고르면 서로 마주보지 않는 변을
   고르는 경우가 생긴다 — 그러면 선이 상대 카드를 가로질러 들어갔다 나오면서
   화살표가 카드 안쪽으로 숨어 안 보이게 된다(카드가 겹쳐 있을 때 특히 흔함).
   그래서 waypoint(노란 점)로 손수 방향을 잡지 않은 기본 연결은, 두 카드의
   위치 관계를 같이 보고 "겹치는 축의 반대쪽" 변끼리 마주보게 짝지어 고른다:
   세로로는 겹치는데(같은 높이대) 가로로 떨어져 있으면 좌우 변끼리,
   가로로는 겹치는데 세로로 떨어져 있으면 위아래 변끼리. 둘 다 겹치거나
   (완전히 포개짐) 둘 다 안 겹치면(대각선 배치) 기존 각도 판정을 그대로 쓴다. */
function overlapsRange(a1, a2, b1, b2) { return a1 < b2 && b1 < a2; }
function autoSidePair(ra, rb) {
  const overlapY = overlapsRange(ra.y, ra.y + ra.h, rb.y, rb.y + rb.h);
  const overlapX = overlapsRange(ra.x, ra.x + ra.w, rb.x, rb.x + rb.w);
  const cxA = ra.x + ra.w / 2, cxB = rb.x + rb.w / 2;
  const cyA = ra.midY != null ? ra.midY : ra.y + ra.h / 2, cyB = rb.midY != null ? rb.midY : rb.y + rb.h / 2;
  if (overlapY && !overlapX) return cxB >= cxA ? ["e", "w"] : ["w", "e"];
  if (overlapX && !overlapY) return cyB >= cyA ? ["s", "n"] : ["n", "s"];
  const dx = cxB - cxA, dy = cyB - cyA;
  if (Math.abs(dx) * (ra.h + rb.h) >= Math.abs(dy) * (ra.w + rb.w)) return dx >= 0 ? ["e", "w"] : ["w", "e"];
  return dy >= 0 ? ["s", "n"] : ["n", "s"];
}
/* 곡선이 카드 자기 자신 위로 다시 들어오는지 볼 때 쓴다 — r.fullH가 있으면
   (태그·캠페인 목록까지 늘어진 카드) 그 바닥까지를 카드 영역으로 본다. */
function rectContainsPt(r, x, y) {
  const top = r.y, bottom = r.y + (r.fullH != null ? r.fullH : r.h);
  return x > r.x + 1 && x < r.x + r.w - 1 && y > top + 1 && y < bottom - 1;
}
function bezierPoint(p0, c1, c2, p1, t) {
  const mt = 1 - t, mt2 = mt * mt, t2 = t * t;
  return {
    x: mt2 * mt * p0.x + 3 * mt2 * t * c1.x + 3 * mt * t2 * c2.x + t2 * t * p1.x,
    y: mt2 * mt * p0.y + 3 * mt2 * t * c1.y + 3 * mt * t2 * c2.y + t2 * t * p1.y
  };
}
function edgeGeom(e) {
  const a = nodeById(e.from), b = nodeById(e.to);
  if (!a || !b) return null;
  const raNom = nodeNominalRect(a), rbNom = nodeNominalRect(b);
  const ra = nodeVisibleRect(a, raNom), rb = nodeVisibleRect(b, rbNom);
  const wps = (e.points || []).map(p => ({ x: p.x, y: p.y }));
  const firstT = wps[0] || null;
  const lastT = wps[wps.length - 1] || null;
  const pinned1 = e.a1 && e.a1 !== "auto", pinned2 = e.a2 && e.a2 !== "auto";
  /* 어느 변에 붙을지는 항상 기준 크기(raNom/rbNom)로만 판정 — 카드가
     커져도 이 판정 자체는 흔들리지 않는다. waypoint가 있거나 사용자가
     직접 변을 고정했으면 그 지점/그 변을 그대로 쓰고(기존 동작 그대로),
     둘 다 자동일 때만 위 짝짓기 판정을 쓴다. */
  const pair = autoSidePair(raNom, rbNom);
  const s1 = pinned1 ? e.a1 : (firstT ? autoSide(raNom, firstT) : pair[0]);
  const s2 = pinned2 ? e.a2 : (lastT ? autoSide(rbNom, lastT) : pair[1]);
  const t1 = e.a1t, t2 = e.a2t;
  return { p1: sidePoint(ra, s1, t1), n1: SIDE_N[s1], p2: sidePoint(rb, s2, t2), n2: SIDE_N[s2], wps, self: e.from === e.to, ra, rb, s1, s2, t1, t2 };
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
  if (g.self) {                                     // 같은 노드로 돌아오는 연결 — 고리가 선택한 연결점(위/아래/좌/우, 그 변 위 위치) 쪽으로 튀어나오게 그린다
    const r = g.ra, n1 = SIDE_N[g.s1], n2 = SIDE_N[g.s2];
    /* 예전엔 여기서 두 점을 억지로 벌려(spread) 놓았는데, 지금은 "붙는 위치"
       슬라이더로 이미 원하는 만큼 떨어뜨릴 수 있어 그 위에 또 벌리면 카드
       밖으로 튀어나가 버렸다(화살표가 카드와 동떨어져 보이던 원인) — 이제는
       고른 위치(sidePoint) 그대로 쓴다. */
    const p1 = sidePoint(r, g.s1, g.t1), p2 = sidePoint(r, g.s2, g.t2);
    if (e.route === "ortho") return roundedPath(orthoPoints({ p1, n1, p2, n2, wps: g.wps }), 12);
    if (g.wps.length) return smoothPath([p1].concat(g.wps, [p2]));   // 노란 점으로 높이를 고정했을 때
    const tangent = side => (side === "n" || side === "s") ? { x: 1, y: 0 } : { x: 0, y: 1 };
    const t1 = tangent(g.s1), t2 = tangent(g.s2), bulge = 86, flare = 38;   // 그 밖(직선 포함, 예전 데이터도)은 모두 기본 곡선 고리
    const c1 = { x: p1.x + n1.x * bulge - t1.x * flare, y: p1.y + n1.y * bulge - t1.y * flare };
    const c2 = { x: p2.x + n2.x * bulge + t2.x * flare, y: p2.y + n2.y * bulge + t2.y * flare };
    return "M " + p1.x + " " + p1.y + " C " + c1.x + " " + c1.y + " " + c2.x + " " + c2.y + " " + p2.x + " " + p2.y;
  }
  if (e.route === "line") return "M " + [g.p1].concat(g.wps, [g.p2]).map(p => p.x + " " + p.y).join(" L ");
  if (e.route === "ortho") return roundedPath(orthoPoints(g), 12);
  if (!g.wps.length) {                              // 기본 곡선 — 연결점 방향으로 부드럽게 빠져나간다
    const dist = Math.hypot(g.p2.x - g.p1.x, g.p2.y - g.p1.y);
    /* 태그·캠페인 목록은 프레임 아래로 늘어져 있다. "아래(s)" 연결점은 이제
       목록까지 합친 진짜 카드 바닥에 붙어서(nodeVisibleRect의 fullH) 더 이상
       목록을 가로지르지 않는다 — 여기서는 좌/우(e·w)로 나간 뒤 아래로 굽어
       들어가면서 자기 카드의 목록 위를 스치는 경우만 다룬다. */
    const listExtra = (id, side) => {
      if (side !== "e" && side !== "w") return 0;
      const s = NSZ[id];
      return s && s.frameH ? Math.max(0, s.h - s.frameH) : 0;
    };
    let c1 = clamp(Math.max(dist * 0.42, listExtra(e.from, g.s1) + 34), 40, 220);
    let c2 = clamp(Math.max(dist * 0.42, listExtra(e.to, g.s2) + 34), 40, 220);
    /* 계산한 곡선이 (다른 카드가 아니라) 자기 자신의 출발·도착 카드를 다시
       가로질러 들어가는지만 확인한다 — 캔버스의 다른 카드는 검사하지 않아
       가볍다(부딪혀도 상관없다는 전제). 걸리면 그만큼 더 빠져나간 뒤에
       휘도록 늘려서 다시 확인 — 몇 번 반복해도 안 풀리면 그 상태로 둔다. */
    for (let i = 0; i < 4; i++) {
      const cp1 = { x: g.p1.x + g.n1.x * c1, y: g.p1.y + g.n1.y * c1 };
      const cp2 = { x: g.p2.x + g.n2.x * c2, y: g.p2.y + g.n2.y * c2 };
      let hitA = false, hitB = false;
      for (let s = 1; s <= 8; s++) {
        const t = s / 9;
        const pt = bezierPoint(g.p1, cp1, cp2, g.p2, t);
        if (t < 0.5 && rectContainsPt(g.ra, pt.x, pt.y)) hitA = true;
        if (t > 0.5 && rectContainsPt(g.rb, pt.x, pt.y)) hitB = true;
      }
      if (!hitA && !hitB) break;
      if (hitA) c1 = Math.min(c1 * 1.6, 280);
      if (hitB) c2 = Math.min(c2 * 1.6, 280);
    }
    return "M " + g.p1.x + " " + g.p1.y +
      " C " + (g.p1.x + g.n1.x * c1) + " " + (g.p1.y + g.n1.y * c1) +
      " " + (g.p2.x + g.n2.x * c2) + " " + (g.p2.y + g.n2.y * c2) +
      " " + g.p2.x + " " + g.p2.y;
  }
  if (g.wps.length === 1) {                          // 높이 고정 점(노란 점) — 가장 흔한 경우, 손으로 짠 2구간 곡선
    /* 예전엔 [p1, p1에서 짧게 튀어나온 점, 점, p2에서 짧게 튀어나온 점, p2]를
       한 번에 스플라인(smoothPath)으로 이었는데, 카드 바로 앞의 이 "짧은
       구간"과 그 다음 "점까지의 먼 구간" 사이 접선을 자동으로 추정하다 보니
       점을 카드에서 멀리 옮길수록 카드를 빠져나가자마자 반대로 한 번 꺾였다가
       다시 꺾이는 군더더기 곡선이 생겼다(스크린샷의 "지나치게 휘어짐").
       접선을 자동 추정에 맡기지 않고 직접 정해서, 카드에서는 항상 수직으로
       빠져나가고 점 앞뒤에서는 전체 방향(출발→도착)을 따라 매끄럽게 지나가게 한다. */
    const wp = g.wps[0];
    const d1 = Math.hypot(wp.x - g.p1.x, wp.y - g.p1.y), d2 = Math.hypot(g.p2.x - wp.x, g.p2.y - wp.y);
    const k1 = clamp(d1 * 0.5, 30, 140), k2 = clamp(d2 * 0.5, 30, 140);
    const dx = g.p2.x - g.p1.x, dy = g.p2.y - g.p1.y, dlen = Math.hypot(dx, dy) || 1, ux = dx / dlen, uy = dy / dlen;
    const c1 = { x: g.p1.x + g.n1.x * k1, y: g.p1.y + g.n1.y * k1 };
    const c2 = { x: wp.x - ux * k1 * 0.6, y: wp.y - uy * k1 * 0.6 };
    const c3 = { x: wp.x + ux * k2 * 0.6, y: wp.y + uy * k2 * 0.6 };
    const c4 = { x: g.p2.x + g.n2.x * k2, y: g.p2.y + g.n2.y * k2 };
    return "M " + g.p1.x + " " + g.p1.y +
      " C " + c1.x + " " + c1.y + " " + c2.x + " " + c2.y + " " + wp.x + " " + wp.y +
      " C " + c3.x + " " + c3.y + " " + c4.x + " " + c4.y + " " + g.p2.x + " " + g.p2.y;
  }
  const stub = 26;                                    // 점이 여러 개인(수동으로 더 꺾은) 경우 — 예전 방식 유지
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
  /* "반대" — 단방향 화살표의 머리를 도착이 아니라 출발 쪽에 그린다.
     양방향·없음은 방향이 의미 없어 그대로 둔다. */
  const headAtEnd = e.kind !== "none" && !(e.kind === "arrow" && e.reverse);
  const headAtStart = e.kind === "both" || (e.kind === "arrow" && e.reverse);
  rec.head.setAttribute("d", headAtEnd ? headPath(rec, L, Math.max(0, L - 14), size) : "");
  rec.tail.setAttribute("d", headAtStart ? headPath(rec, 0, Math.min(L, 14), size) : "");
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

/* 선택된 연결선의 경로 편집 손잡이 — 점이 하나도 없으면(=아직 자동 경로) 실제
   그려진 곡선의 중점에 노란 점을 놓아 "위·아래로 끌면 그 높이로 고정" 임을
   보여준다. 점을 만들고 나면(=높이를 고정하면) 같은 점을 계속 노란색으로 둔다. */
function drawEdgeHandles() {
  const box = $("#edgeHandles");
  const e = sel.edge ? edgeById(sel.edge) : null;
  if (!e || !canEdit()) { if (box.innerHTML) box.innerHTML = ""; return; }
  const g = edgeGeom(e); if (!g) { box.innerHTML = ""; return; }
  const pts = [g.p1].concat(g.wps, [g.p2]);
  const isDefaultCurve = e.route !== "ortho" && e.route !== "line";
  const isHeightOnly = isDefaultCurve && g.wps.length <= 1; // 기본 곡선에서 점이 0개(자동) 또는 1개(높이 고정)일 때만 "높이 점"으로 다룬다
  let h = "";
  g.wps.forEach((p, i) => {
    h += '<circle class="wp' + (isHeightOnly ? " hgt" : "") + '" data-wp="' + i + '" cx="' + p.x + '" cy="' + p.y + '" r="' + (isHeightOnly ? 7 : 6) + '"><title>' +
      (isHeightOnly ? "드래그해서 높이 조절 · 더블클릭하면 자동으로" : "드래그해서 위치 조절 · 더블클릭하면 점 삭제") + "</title></circle>";
    /* 높이를 고정한 뒤엔 처음 쓰는 사람도 바로 알아볼 수 있게, 더블클릭 대신
       누르기만 하면 되는 × 되돌리기 버튼을 점 옆에 항상 띄워 둔다. */
    if (isHeightOnly && g.wps.length === 1) {
      h += '<g class="wp-reset" data-wpreset="' + i + '" transform="translate(' + (p.x + 13) + "," + (p.y - 13) + ')">' +
        '<circle r="8"></circle><path d="M-3 -3 L3 3 M3 -3 L-3 3"></path><title>자동 높이로 되돌리기</title></g>';
    }
  });
  for (let i = 0; i < pts.length - 1; i++) {
    let m;
    const heightAdd = isDefaultCurve && pts.length === 2;  // 아직 점이 없는 기본 곡선 구간 — 실제 곡선 위의 중점을 쓴다(직선 중점이 아니라)
    if (heightAdd) {
      const rec = EDGE_EL[e.id], L = rec && rec.wire && rec.wire.getTotalLength();
      m = L ? rec.wire.getPointAtLength(L / 2) : { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
    } else {
      m = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
    }
    h += '<circle class="wpadd' + (heightAdd ? " hgt" : "") + '" data-add="' + i + '"' +
      (heightAdd ? ' data-hgt="1" data-lockx="' + m.x + '"' : "") +
      ' cx="' + m.x + '" cy="' + m.y + '" r="' + (heightAdd ? 7 : 5) + '"><title>' +
      (heightAdd ? "드래그해서 높이 고정" : "드래그해서 선을 나누고 점 추가") + "</title></circle>";
  }
  box.innerHTML = h;
}

/* ---------------- 노드 ----------------
   보기 모드마다 카드 아래쪽 목록의 형태만 바뀐다 — 점 색으로 채널/상태를
   나타내고, 이름 아래 작은 메타 줄(선택)을 붙이는 공통 패턴(g-row)을 쓴다. */
function gRow(dotColor, name, meta, mono, extra) {
  return '<div class="g-row' + (meta ? "" : " simple") + '"><span class="g-dot" style="background:' + dotColor + '"></span>' +
    '<div class="g-body"><span class="g-name' + (mono ? " mono" : "") + '">' + esc(name) + "</span>" +
    (meta ? '<span class="g-meta">' + meta + "</span>" : "") + (extra || "") + "</div></div>";
}
function campRow(raw) {
  const c = campView(raw);
  const ch = CHAN[c.chan] || CHAN.push;
  /* 실적은 이름 바로 아래 한 줄로 — g-body 안에 넣어야 확대/축소 때 이름과 같은 비율로 커진다 */
  return gRow(ch.c, c.name, "", false, perfBadge(c.code, "line"));
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
  return '<div class="node-list">' + n.camps.slice(0, 6).map(raw => {
    const c = campView(raw);
    const ch = CHAN[c.chan] || CHAN.push;
    return gRow(CSTATUS_C[c.status], c.name, ch.name + " · " + CSTATUS[c.status], false, perfBadge(c.code, "line"));
  }).join("") + (n.camps.length > 6 ? '<div class="g-more">+' + (n.camps.length - 6) + "개 더</div>" : "") + "</div>";
}
function incompleteRowsBig(n) {
  const miss = completeness(n);
  if (!miss.length) return '<div class="g-empty">모두 등록됨</div>';
  return '<div class="node-list">' + miss.map(m => '<div class="g-miss">' + ico("alert", "xs") + esc(m) + "</div>").join("") + "</div>";
}
/* 이 페이지에 붙은 캠페인들의 최신월 실적을 합친다 — 성과 위주 보기의 색·배지에 쓴다 */
function nodePerfSum(n) {
  let rev = 0, cnt = 0;
  (n.camps || []).forEach(c => {
    if (!c.code) return;
    const h = perfHistory(c.code);
    if (!h.length) return;
    cnt++; rev += h[h.length - 1].revenue || 0;
  });
  return { rev: rev, count: cnt };
}
function focusCount(n, f) {
  if (f === "camp") return n.camps.length;
  if (f === "perf") return nodePerfSum(n).count;
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
  } else if (f === "perf") {
    /* 성과 위주 보기에서는 개수가 아니라 이 화면이 만든 최신월 매출을 크게 보여 준다 */
    const ps = nodePerfSum(n);
    bd = '<span class="bdg big" style="--c:var(--ok)" title="이 페이지에 붙은 캠페인들의 최신월 매출 합계">' +
      ico("chart", "xs") + "<b>" + (ps.count ? Math.round(ps.rev).toLocaleString("ko-KR") : "-") + "</b></span>";
  } else {
    const meta = FOCUS[f];
    bd = '<span class="bdg big" style="--c:' + (meta.c || "var(--ink-3)") + '">' + ico(meta.ico, "xs") + "<b>" + focusCount(n, f) + "</b></span>";
  }

  let body = "";
  if (f === "all") {
    body = n.camps.length ? '<div class="node-list">' + n.camps.slice(0, 4).map(campRow).join("") +
      (n.camps.length > 4 ? '<div class="g-more">+' + (n.camps.length - 4) + "개 더</div>" : "") + "</div>" : "";
  } else if (f === "camp" || f === "perf") body = campRowsBig(n);
  else if (f === "incomplete") body = incompleteRowsBig(n);
  else if (PLAT[f]) body = tagRowsBig(n, f);

  const miss = completeness(n);
  const warn = miss.length ? '<span class="node-warn" title="' + esc(miss.join(" · ")) + '">' + ico("alert", "xs") + "</span>" : "";

  /* 키워드형 — 화면 이미지 없이 이름만 작은 알약(pill) 모양으로 보여준다.
     태그·캠페인은 다른 페이지와 똑같이 달 수 있어 배지·목록(body)은 그대로 쓴다. */
  if (n.kind === "keyword") {
    return '<div class="node-frame">' +
        '<div class="kw-pill"><span class="kw-name" title="' + esc(n.name) + '">' + esc(n.name) + "</span></div>" +
      "</div>" +
      (bd ? '<div class="node-badges kw-badges">' + bd + "</div>" : "") +
      (body ? '<div class="node-main">' + body + "</div>" : "");
  }

  const th = thumbSrc(n);
  const thumb = (th ? '<img src="' + th + '" alt="" loading="lazy" decoding="async" draggable="false">'
                    : '<div class="ph">' + ico("image") + "<span>화면 미등록</span></div>") +
    '<div class="thumb-acts edit-only">' +
      '<button class="pick" data-nedit="' + n.id + '" title="페이지 이름·색·크기·모양·화면 바꾸기" tabindex="-1"><span>' +
      ico("edit", "xs") + "설정</span></button>" +
    "</div>";

  /* 제목·이미지·배지를 하나의 테두리(.node-frame)로 묶는다 — 확대·축소해도
     이 틀 전체가 한 덩어리로 같이 움직이니 안에서 글자가 넘칠 걱정이 없다.
     태그·캠페인 목록(body)은 지금처럼 그 바깥 아래에 그대로 노출한다. */
  return '<div class="node-frame">' +
      '<div class="node-title"><div class="node-name" title="' + esc(n.name) + '">' + esc(n.name) + "</div>" +
      (n.path ? '<div class="node-path">' + esc(n.path) + "</div>" : "") +
      "</div>" +
      '<div class="node-pic">' + thumb + warn + "</div>" +
      (bd ? '<div class="node-badges">' + bd + "</div>" : "") +
    "</div>" +
    (body ? '<div class="node-main">' + body + "</div>" : "");
}
function renderNodes() {
  const layer = $("#nodeLayer");
  const focusNow = state.ui.focus || "all";
  const heatMax = focusNow === "perf"
    ? Math.max.apply(null, B().nodes.map(x => nodePerfSum(x).rev).concat(0)) : 0;
  const have = {};
  $$(".node", layer).forEach(el => { have[el.dataset.node] = el; });
  const drawn = [];
  B().nodes.forEach(n => {
    let el = have[n.id];
    if (!el) { el = document.createElement("div"); el.dataset.node = n.id; layer.appendChild(el); }
    else delete have[n.id];
    const f = state.ui.focus || "all";
    const dim = (f === "camp" || f === "perf" || f === "incomplete" || PLAT[f]) && focusCount(n, f) === 0;
    el.className = "node size-" + (n.size || "m") + (n.kind === "keyword" ? " kind-keyword" : "") + (n.sharp ? " sharp" : "") +
      (n.hue && n.hue !== "none" ? " hued emph-" + (n.emph || "border") : "") +
      (dim ? " dim" : "") + (f === "perf" ? " heat" : "");
    el.style.setProperty("--nc", hueOf(n.hue));
    /* 성과 위주 보기 — 매출이 큰 화면일수록 진하게 칠해 여정 위에서 바로 보이게 한다 */
    if (f === "perf") el.style.setProperty("--heat", heatMax ? (nodePerfSum(n).rev / heatMax).toFixed(3) : 0);
    const sig = [n.name, n.path, n.kind, n.size, n.hue, n.sharp, n.tags.length, n.camps.length, (n.layers || []).length,
      state.ui.focus, n.tags.map(t => platformsOf(t).join(",") + t.status + tagEventEn(t)).join("|"),
      /* 시트를 다시 읽으면 캠페인 이름·상태·실적이 바뀌므로 마지막 동기화 시각도 서명에 넣는다 */
      SHEETS.at, heatMax, n.camps.map(c => c.code || (c.chan + c.status + c.name)).join("|"),
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
  measureNodes();
  paintSelection();
}
/* 카드 실제 크기를 다시 재 NSZ 에 담는다. 연결선은 이 값으로 붙을 자리를 정하므로,
   카드 크기가 달라질 수 있는 일(--zoom 변경 등) 뒤에는 반드시 다시 재야 한다. */
function measureNodes() {
  $$("#nodeLayer .node").forEach(el => {
    const id = el.dataset.node, frameEl = el.querySelector(".node-frame");
    const n = nodeById(id);
    if (!n) return;
    NSZ[id] = { w: el.offsetWidth || nodeW(n), h: el.offsetHeight || 150, frameH: frameEl ? frameEl.offsetHeight : 0 };
  });
}
function paintSelection() {
  $$("#nodeLayer .node").forEach(el => {
    const id = el.dataset.node;
    el.classList.toggle("sel", id === sel.node || selMulti.indexOf(id) >= 0);
    el.classList.toggle("link-src", id === linkFrom);
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
  const zv = zoomVarFor(v.zoom);
  if (zoomVar !== zv) {
    w.style.setProperty("--zoom", zv); zoomVar = zv;
    /* 카드 폭·글자 크기가 방금 달라졌다. 크기를 다시 재고 연결선도 다시 그린다 —
       이걸 빼먹으면 다음에 화면을 다시 그리는 순간(예: 저장) 화살표가 튄다. */
    measureNodes(); drawEdges();
  }
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

/* 배경(또는 보기 전용일 때 카드 위)을 끌어 화면을 민다 */
function startPan(e, surf) {
  const sx = e.clientX, sy = e.clientY, v = B().view, px = v.panX, py = v.panY;
  surf.classList.add("panning");
  $("#flowPane").classList.add("busy");
  const mv = ev => { v.panX = px + (ev.clientX - sx); v.panY = py + (ev.clientY - sy); applyTransformSoon(); };
  const up = () => {
    surf.removeEventListener("pointermove", mv); surf.removeEventListener("pointerup", up); surf.removeEventListener("pointercancel", up);
    surf.classList.remove("panning");
    $("#flowPane").classList.remove("busy");
    markDirty();
  };
  try { surf.setPointerCapture(e.pointerId); } catch (err) {}
  surf.addEventListener("pointermove", mv); surf.addEventListener("pointerup", up); surf.addEventListener("pointercancel", up);
}
/* 다중 선택 모드 — 빈 캔버스를 대각선으로 드래그해 사각형과 겹치는 카드를
   한 번에 고른다. 살짝 눌렀다 떼기만 하면(거의 안 움직였으면) 그냥 선택 해제. */
function startMultiSelectDrag(e, surf, r, additive) {
  e.preventDefault();
  const v = B().view;
  const toW = (cx, cy) => ({ x: (cx - r.left - v.panX) / v.zoom, y: (cy - r.top - v.panY) / v.zoom });
  const start = toW(e.clientX, e.clientY);
  let cur = start;
  const box = document.createElement("div");
  box.className = "marquee";
  $("#flowWorld").appendChild(box);
  const paint = () => {
    const x1 = Math.min(start.x, cur.x), y1 = Math.min(start.y, cur.y);
    box.style.left = x1 + "px"; box.style.top = y1 + "px";
    box.style.width = Math.abs(cur.x - start.x) + "px"; box.style.height = Math.abs(cur.y - start.y) + "px";
  };
  paint();
  const mv = ev => { cur = toW(ev.clientX, ev.clientY); paint(); };
  const up = () => {
    surf.removeEventListener("pointermove", mv); surf.removeEventListener("pointerup", up); surf.removeEventListener("pointercancel", up);
    box.remove();
    const x1 = Math.min(start.x, cur.x), y1 = Math.min(start.y, cur.y), x2 = Math.max(start.x, cur.x), y2 = Math.max(start.y, cur.y);
    if (x2 - x1 < 4 && y2 - y1 < 4) {
      if (!additive) { selMulti = []; paintSelection(); renderPanels(); }
      return;
    }
    const hit = B().nodes.filter(n => {
      const q = nodeRect(n);
      return q.x < x2 && q.x + q.w > x1 && q.y < y2 && q.y + q.h > y1;
    }).map(n => n.id);
    selMulti = additive ? Array.from(new Set(selMulti.concat(hit))) : hit;
    paintSelection(); renderPanels();
  };
  surf.setPointerCapture(e.pointerId);
  surf.addEventListener("pointermove", mv); surf.addEventListener("pointerup", up); surf.addEventListener("pointercancel", up);
}

/* ---------------- 상호작용 ---------------- */
function initFlow() {
  const surf = $("#flowSurface");
  const busy = on => $("#flowPane").classList.toggle("busy", on);
  const toWorld = (ev, r) => ({ x: (ev.clientX - r.left - B().view.panX) / B().view.zoom, y: (ev.clientY - r.top - B().view.panY) / B().view.zoom });
  let lastWpTap = { key: null, t: 0 };   /* 노란 점 더블클릭 감지용 — pointerdown에 preventDefault를 걸면
                                             브라우저가 click/dblclick 합성 자체를 하지 않아 직접 잰다 */

  surf.addEventListener("wheel", e => {
    e.preventDefault();
    const r = surf.getBoundingClientRect();
    zoomTo(B().view.zoom * (e.deltaY < 0 ? 1.12 : 0.893), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  surf.addEventListener("pointerdown", e => {
    if (e.target.closest("[data-nedit]")) return;   /* 카드 안 버튼 위에서는 드래그를 준비하지 않는다 */
    /* 손가락 조작은 전용 제스처로 — 한 손가락은 밀기, 두 손가락은 확대/축소.
       노드가 실수로 끌려 옮겨지지 않게 하려는 것이기도 하다. */
    if (mobileFlowPointer(e, surf)) return;
    if (laneMode && canEdit() && !e.target.closest(".lane-label") && !e.target.closest(".lane-edge")) { startLaneDraw(e, surf, surf.getBoundingClientRect()); return; }
    const r = surf.getBoundingClientRect();
    const wpReset = e.target.closest("[data-wpreset]");
    if (canEdit() && wpReset && sel.edge) {              /* 높이 고정 점 옆의 × — 눌러서 바로 자동으로 되돌린다 */
      e.preventDefault(); e.stopPropagation();
      edgeById(sel.edge).points.splice(+wpReset.dataset.wpreset, 1);
      markDirty(); drawEdges();
      return;
    }
    const wp = e.target.closest("[data-wp]"), add = e.target.closest("[data-add]");
    const nodeEl = e.target.closest("[data-node]");
    const edgeHit = e.target.closest("[data-edge]");
    const editable = canEdit();

    if (editable && (wp || add) && sel.edge) {           /* 경로 꺾임점 드래그 · 추가 */
      e.preventDefault(); e.stopPropagation();
      const ed = edgeById(sel.edge);
      let idx, lockX = null;
      /* 아직 손대지 않은 기본(자동) 곡선 경로의 노란 점 — 좌우로는 움직이지 않고
         높이(위·아래)만 고정한다. 점이 이미 하나 있으면 그 점도 계속 같은
         규칙을 따른다(점 하나짜리 경로 = "높이 고정" 용도로 취급). 이 관례는
         기본 곡선 전용이다 — ortho/line 경로는 애초에 좌우로 꺾어 돌아가는
         용도라 X를 잠그면 그 점을 영영 좌우로 옮길 수 없게 되어 버린다. */
      const isDefaultCurve = ed.route !== "ortho" && ed.route !== "line";
      if (wp) {
        idx = +wp.dataset.wp;
        if (isDefaultCurve && ed.points.length === 1) lockX = ed.points[idx].x;
        const key = sel.edge + ":" + idx, now = Date.now();
        if (lastWpTap.key === key && now - lastWpTap.t < 400) {   /* 짧게 두 번 = 더블클릭 → 점 삭제(자동으로) */
          lastWpTap = { key: null, t: 0 };
          ed.points.splice(idx, 1); markDirty(); drawEdges();
          return;
        }
        lastWpTap = { key, t: now };
      }
      else {
        idx = +add.dataset.add;
        if (add.dataset.hgt) lockX = +add.dataset.lockx;
        const init = toWorld(e, r);
        ed.points.splice(idx, 0, lockX != null ? { x: lockX, y: Math.round(init.y) } : init);
      }
      const paint = onFrame(p => {
        ed.points[idx] = { x: lockX != null ? lockX : Math.round(p.x), y: Math.round(p.y) };
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

    if (nodeEl) {                                        /* 노드 선택 · 이동 */
      const id = nodeEl.dataset.node;
      if (editable && flowMode === "link") {
        e.preventDefault();
        if (!linkFrom) { linkFrom = id; paintSelection(); toast("연결할 도착 페이지를 클릭하세요"); }
        else { addEdge(linkFrom, id); linkFrom = null; paintSelection(); }
        return;
      }
      if (editable && flowMode === "multi") {             /* 다중 선택 — 고른 것끼리 한 번에 옮긴다 */
        e.preventDefault();
        if (selMulti.indexOf(id) < 0) selMulti = e.shiftKey ? selMulti.concat(id) : [id];
        if (sel.edge) { sel.edge = null; drawEdges(); }
        paintSelection(); renderPanels();
        const ids = selMulti.slice();
        const starts = {}, els = {};
        ids.forEach(gid => { const gn = nodeById(gid); if (gn) { starts[gid] = { x: gn.x, y: gn.y }; els[gid] = $('.node[data-node="' + gid + '"]'); } });
        const sx = e.clientX, sy = e.clientY;
        let moved = false;
        ids.forEach(gid => { if (els[gid]) els[gid].classList.add("dragging"); });
        busy(true);
        const paint = onFrame(() => ids.forEach(gid => {
          const gn = nodeById(gid), gel = els[gid];
          if (gel) { gel.style.left = gn.x + "px"; gel.style.top = gn.y + "px"; }
          moveEdgesOf(gid);
        }));
        const mv = ev => {
          const dx = (ev.clientX - sx) / B().view.zoom, dy = (ev.clientY - sy) / B().view.zoom;
          if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
          moved = true;
          ids.forEach(gid => { const gn = nodeById(gid), st = starts[gid]; if (gn && st) { gn.x = Math.round(st.x + dx); gn.y = Math.round(st.y + dy); } });
          paint();
        };
        const up = () => {
          surf.removeEventListener("pointermove", mv); surf.removeEventListener("pointerup", up); surf.removeEventListener("pointercancel", up);
          ids.forEach(gid => { if (els[gid]) els[gid].classList.remove("dragging"); });
          busy(false);
          if (moved) { markDirty(); }
        };
        surf.setPointerCapture(e.pointerId);
        surf.addEventListener("pointermove", mv); surf.addEventListener("pointerup", up); surf.addEventListener("pointercancel", up);
        return;
      }
      if (sel.node !== id) selectNode(id);
      if (sel.edge) { sel.edge = null; drawEdges(); }
      if (!editable) { startPan(e, surf); return; }   /* 보기 전용 — 카드 위에서도 화면을 민다 */
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

    if (editable && flowMode === "multi") {               /* 빈 캔버스를 드래그 = 사각형으로 여러 개 고르기 */
      startMultiSelectDrag(e, surf, r, e.shiftKey);
      return;
    }

    if (edgeHit && editable) { sel.edge = edgeHit.dataset.edge; drawEdges(); openEdgePop(sel.edge, e.clientX, e.clientY); return; }

    if (sel.edge) { sel.edge = null; drawEdges(); }       /* 배경 → 패닝 */
    startPan(e, surf);
  });

  surf.addEventListener("dblclick", e => {
    if (!canEdit()) return;
    /* 점(.wp/.wpadd) 위 더블클릭은 pointerdown 쪽 수동 판정으로 처리한다 —
       그 핸들러가 pointerdown에 preventDefault를 걸어 브라우저가 만드는
       click/dblclick 합성 이벤트 자체가 여기까지 오지 않기 때문. */
    const n = e.target.closest("[data-node]");
    if (n) editNode(n.dataset.node);
  });

  $("#flowMode").addEventListener("click", e => {
    const b = e.target.closest("[data-mode]"); if (!b) return;
    const wasMulti = flowMode === "multi";
    flowMode = b.dataset.mode; linkFrom = null;
    /* 다중 선택 모드를 나가면 골라 둔 것 중 하나를 단일 선택으로 이어받고,
       들어갈 때는 기존 단일 선택을 비워 둘 다 동시에 켜져 보이지 않게 한다. */
    if (wasMulti && flowMode !== "multi") { sel.node = selMulti[0] || sel.node; selMulti = []; }
    if (flowMode === "multi") sel.node = null;
    $$("#flowMode .btn").forEach(x => x.classList.toggle("on", x === b));
    surf.classList.toggle("linking", flowMode === "link");
    surf.classList.toggle("multi-selecting", flowMode === "multi");
    paintSelection(); renderPanels();
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
    route: "curve", hue: "none", width: 2, head: "l", a1: "auto", a2: "auto", points: []
  });
  markDirty(); renderFlow();
}

/* ---------------- 연결선 설정 ---------------- */
function openEdgePop(id, cx, cy) {
  const e = edgeById(id); if (!e) return;
  const seg = (key, opts, cur) => '<div class="seg wrap">' + Object.entries(opts).map(([k, v]) =>
    '<button class="btn sm' + (cur === k ? " on" : "") + '" data-' + key + '="' + k + '">' + esc(typeof v === "string" ? v : v.name) + "</button>").join("") + "</div>";
  /* 연결점이 붙는 변을 고른 뒤, 그 변을 따라 0(왼쪽·위)~100(오른쪽·아래) 중
     어디에 붙을지 슬라이더로 정한다. 변이 "자동"이면 의미가 없어 비활성화한다. */
  const posRow = key => {
    const disabled = !e[key] || e[key] === "auto";
    const val = e[key + "t"] != null ? clamp(e[key + "t"], 0, 100) : 50;
    return '<div class="frow"><span class="lbl">붙는 위치(0~100)</span><div class="posrow">' +
      '<input type="range" min="0" max="100" step="1" value="' + val + '" data-posr="' + key + '"' + (disabled ? " disabled" : "") + '>' +
      '<input type="number" min="0" max="100" class="field mono" value="' + val + '" data-posi="' + key + '"' + (disabled ? " disabled" : "") + '>' +
      '<button type="button" class="btn icon sm" data-posreset="' + key + '" title="가운데(50)로 되돌리기">' + ico("loop", "xs") + "</button>" +
    "</div></div>";
  };
  const root = $("#popRoot");
  root.innerHTML =
    '<div class="popover glass wide">' +
      '<div class="popover-head" data-draghandle title="드래그해서 옮기기">' + ico("density", "xs") + "<span>연결선 설정</span></div>" +
      '<div class="frow"><span class="lbl">연결 라벨</span><input class="field" id="epLabel" value="' + esc(e.label) + '" placeholder="예: 장바구니 담기"></div>' +
      '<div class="frow"><span class="lbl">경로</span>' + seg("rt", e.from === e.to ?
        Object.fromEntries(Object.entries(ROUTE).filter(([k]) => k !== "line")) : ROUTE, e.route || "curve") + "</div>" +
      '<div class="frow"><span class="lbl">선 · 굵기</span><div class="rowseg">' + seg("st", { solid: "실선", dashed: "점선" }, e.style) +
        seg("wd", { 1: "가늘게", 2: "보통", 3: "굵게" }, String(e.width || 2)) + "</div></div>" +
      '<div class="frow"><span class="lbl">화살표</span><div class="rowseg" style="align-items:center">' +
        seg("kd", { arrow: "단방향", both: "양방향", none: "없음" }, e.kind) +
        '<label class="chkbtn"><input type="checkbox" data-rev' + (e.reverse ? " checked" : "") + '> 반대</label>' +
      "</div></div>" +
      '<div class="frow"><span class="lbl">화살촉 크기</span>' + seg("hd", HEADSZ, e.head || "m") + "</div>" +
      '<div class="frow"><span class="lbl">색</span><div class="hues">' +
        Object.entries(HUE).map(([k, h]) => '<button class="hue' + ((e.hue || "none") === k ? " on" : "") + '" data-hu="' + k + '" title="' + h.name + '" style="--h:' + h.c + '"></button>').join("") +
      "</div></div>" +
      '<div class="frow"><span class="lbl">연결점 — 출발</span>' + seg("a1", ANCHOR, e.a1 || "auto") + "</div>" +
      posRow("a1") +
      '<div class="frow"><span class="lbl">연결점 — 도착</span>' + seg("a2", ANCHOR, e.a2 || "auto") + "</div>" +
      posRow("a2") +
      '<p class="hint">선 위의 작은 점을 끌면 경로가 꺾입니다. 꺾임점을 더블클릭하면 지워집니다.</p>' +
      '<div class="rowseg">' +
        '<button class="btn sm" data-reset style="flex:1">' + ico("loop", "xs") + "경로 초기화</button>" +
        '<button class="btn sm danger" data-del style="flex:1">' + ico("trash", "xs") + "삭제</button>" +
        '<button class="btn sm primary" data-close style="flex:1">완료</button></div>' +
    "</div>";
  const pop = $(".popover", root);
  /* 한 번 옮겨두면 다음에 열 때도 같은 자리 — 처음(또는 아직 안 옮겼으면)만
     클릭한 자리 옆에 띄운다. 옮긴 뒤에도 화면 밖으로 나가지 않게 다시 잰다. */
  if (edgePopPos) {
    pop.style.left = clamp(edgePopPos.left, 8, Math.max(8, innerWidth - 320)) + "px";
    pop.style.top = clamp(edgePopPos.top, 8, Math.max(8, innerHeight - pop.offsetHeight - 12)) + "px";
  } else {
    pop.style.left = clamp(cx - 150, 8, Math.max(8, innerWidth - 320)) + "px";
    pop.style.top = clamp(cy + 12, 8, Math.max(8, innerHeight - pop.offsetHeight - 12)) + "px";
  }
  $("[data-draghandle]", pop).addEventListener("pointerdown", ev => {
    ev.preventDefault();
    const r = pop.getBoundingClientRect(), dx = ev.clientX - r.left, dy = ev.clientY - r.top;
    const handle = ev.currentTarget;
    const mv = mv2 => {
      const left = clamp(mv2.clientX - dx, 4, innerWidth - r.width - 4);
      const top = clamp(mv2.clientY - dy, 4, innerHeight - r.height - 4);
      pop.style.left = left + "px"; pop.style.top = top + "px";
    };
    const up = () => {
      handle.removeEventListener("pointermove", mv); handle.removeEventListener("pointerup", up); handle.removeEventListener("pointercancel", up);
      edgePopPos = { left: parseFloat(pop.style.left), top: parseFloat(pop.style.top) };
    };
    handle.setPointerCapture(ev.pointerId);
    handle.addEventListener("pointermove", mv); handle.addEventListener("pointerup", up); handle.addEventListener("pointercancel", up);
  });
  $("#epLabel", pop).addEventListener("input", ev => { e.label = ev.target.value; markDirty(); drawEdges(); });
  /* 연결점이 "자동"이면 붙는 위치를 정해도 의미가 없어 슬라이더를 비활성화한다 —
     변을 고르거나 초기화할 때마다 다시 맞춰준다. */
  const syncPos = key => {
    const disabled = !e[key] || e[key] === "auto";
    $('[data-posr="' + key + '"]', pop).disabled = disabled;
    $('[data-posi="' + key + '"]', pop).disabled = disabled;
  };
  const setPos = (key, v) => {
    v = clamp(Math.round(v), 0, 100);
    e[key + "t"] = v;
    $('[data-posr="' + key + '"]', pop).value = v;
    $('[data-posi="' + key + '"]', pop).value = v;
    markDirty(); drawEdges();
  };
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
    if (ev.target.closest("[data-reset]")) {
      e.points = []; e.a1 = "auto"; e.a2 = "auto"; e.a1t = 50; e.a2t = 50;
      markDirty(); drawEdges();
      $$("[data-a1]", pop).forEach(x => x.classList.toggle("on", x.dataset.a1 === "auto"));
      $$("[data-a2]", pop).forEach(x => x.classList.toggle("on", x.dataset.a2 === "auto"));
      $('[data-posr="a1"]', pop).value = 50; $('[data-posi="a1"]', pop).value = 50;
      $('[data-posr="a2"]', pop).value = 50; $('[data-posi="a2"]', pop).value = 50;
      syncPos("a1"); syncPos("a2");
      return;
    }
    if (ev.target.closest("[data-close]")) { root.innerHTML = ""; sel.edge = null; drawEdges(); return; }
    const posReset = ev.target.closest("[data-posreset]");
    if (posReset) { setPos(posReset.dataset.posreset, 50); return; }
    const hu = ev.target.closest("[data-hu]");
    if (hu) { e.hue = hu.dataset.hu; $$("[data-hu]", pop).forEach(x => x.classList.toggle("on", x === hu)); }
    setSeg("rt", "route"); setSeg("st", "style"); setSeg("kd", "kind"); setSeg("wd", "width", true); setSeg("hd", "head");
    setSeg("a1", "a1"); setSeg("a2", "a2");
    syncPos("a1"); syncPos("a2");
    markDirty(); drawEdges();
  });
  pop.addEventListener("input", ev => {
    const r = ev.target.closest("[data-posr]"), n = ev.target.closest("[data-posi]");
    if (r) setPos(r.dataset.posr, +r.value);
    else if (n) setPos(n.dataset.posi, +n.value || 0);
  });
  pop.addEventListener("dblclick", ev => {
    const r = ev.target.closest("[data-posr]"); if (r) setPos(r.dataset.posr, 50);
  });
  pop.addEventListener("change", ev => {
    const rev = ev.target.closest("[data-rev]");
    if (rev) { e.reverse = rev.checked; markDirty(); drawEdges(); }
  });
  const away = ev => {
    if (!ev.target.closest(".popover") && !ev.target.closest("[data-edge]") && !ev.target.closest("[data-wp]") &&
        !ev.target.closest("[data-add]") && !ev.target.closest("[data-wpreset]")) {
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
    hue: "none", emph: "border", size: "m", sharp: false, tags: [], camps: [], layers: [],
    viewMode: "shot", webUrl: ""
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
      { k: "emph", label: "강조 효과", type: "select", opts: EMPH },
      { k: "size", label: "카드 크기", type: "select", opts: NSIZE },
      { k: "sharp", label: "각진 모서리로", type: "check" },
      n.kind === "keyword" ? null : { k: "shot", label: "화면 이미지", type: "action", icon: "camera", actionLabel: shotSrc(n) ? "화면 교체·삭제" : "화면 올리기" },
      { k: "note", label: "메모", type: "textarea", ph: "이 화면에서 확인해야 할 것" }
    ].filter(Boolean),
    values: Object.assign({ emph: "border" }, n),
    onSave: v => {
      Object.assign(n, { name: v.name || "이름 없음", kind: v.kind, path: v.path, note: v.note, hue: v.hue, emph: v.emph, size: v.size, sharp: !!v.sharp });
      markDirty(); renderFlow(); renderPanels();
    },
    onAction: (k, getValues) => {
      if (k !== "shot") return;
      /* 사진을 올리는 동안 다른 칸에 입력해 둔 내용을 잃지 않도록, 이 창을
         닫기 전에 지금까지 입력한 값을 먼저 반영해 둔다. */
      const v = getValues();
      Object.assign(n, { name: v.name || "이름 없음", kind: v.kind, path: v.path, note: v.note, hue: v.hue, emph: v.emph, size: v.size, sharp: !!v.sharp });
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
