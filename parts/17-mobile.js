/* ========================================================================
   좁은 화면 안내 · 터치 제스처

   이 도구는 넓은 화면 전용이다. 폰 크기(≤860px)에서는 본 화면 대신 안내만
   보여 준다 — 화면을 감추는 일은 CSS 가 하고(parts/17-mobile.html), 여기서는
   안내에 지금 주소를 채워 PC 에서 열 수 있게만 해 준다.

   태블릿·터치 노트북처럼 화면은 넓은데 마우스가 없는 기기는 그대로 쓴다.
   다만 휠 이벤트만으로는 배율을 바꿀 수 없고, 스치듯 밀다 카드가 딸려 옮겨지므로
   손가락 조작을 따로 처리한다 — 한 손가락은 화면 밀기(탭은 선택), 두 손가락은
   확대/축소, 카드를 옮기려면 0.45초 길게 누른 뒤 끈다.
   ======================================================================== */
const MOBILE_MAX = 860;

/* 안내 화면이 뜨는 폭 — 여기서는 본 화면이 감춰져 있다(레이아웃 계산을 건너뛴다) */
function isMobileLayout() { return innerWidth <= MOBILE_MAX; }
/* 지도 조작을 손가락 기준으로 바꿀지 — 화면은 넓지만 마우스가 없는 기기 */
function isTouchFlow() {
  return matchMedia("(pointer: coarse)").matches && innerWidth <= 1180;
}
/* 05-flow.js·04-core.js 가 부르는 자리 — 지금은 PC 값을 그대로 쓴다 */
function zoomVarFor(z) { return z; }
function viewForSave(b) { return b.view; }

function initMobile() {
  const url = $("#pcGateUrl");
  if (url) url.textContent = location.host + location.pathname;
}

/* ---------------- 터치 제스처 ----------------
   한 손가락 = 화면 밀기(끝에서 거의 안 움직였으면 탭 = 선택)
   두 손가락 = 확대/축소 + 밀기. 두 손가락 사이 가운데 점이 제자리에 머문다. */
const touchPts = new Map();
let gest = null;

const gestMid = () => {
  let x = 0, y = 0;
  touchPts.forEach(p => { x += p.x; y += p.y; });
  return { x: x / touchPts.size, y: y / touchPts.size };
};
const gestSpan = () => {
  const a = Array.from(touchPts.values());
  return a.length < 2 ? 0 : Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
};

/* 05-flow.js 의 pointerdown 맨 앞에서 부른다. true 를 돌려주면 그쪽 처리는 건너뛴다. */
function mobileFlowPointer(e, surf) {
  if (!isTouchFlow() || e.pointerType !== "touch") return false;
  const rect = surf.getBoundingClientRect();
  touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { surf.setPointerCapture(e.pointerId); } catch (err) {}

  if (!gest) {
    const nodeEl = e.target.closest("[data-node]");
    gest = {
      surf: surf, rect: rect, moved: 0, mode: "pan",
      sx: e.clientX, sy: e.clientY,
      node: nodeEl ? nodeEl.dataset.node : null,
      el: nodeEl || null,
      base: anchorNow()
    };
    surf.addEventListener("pointermove", onTouchMove);
    surf.addEventListener("pointerup", onTouchEnd);
    surf.addEventListener("pointercancel", onTouchEnd);
    $("#flowPane").classList.add("busy");
    /* 길게 누르면 그 카드를 집어 옮긴다 — 스치듯 밀다가 지도가 흐트러지는 일이 없도록
       일부러 한 박자 기다린다. 편집 권한이 있을 때만. */
    if (gest.node && canEdit() && flowMode !== "link") {
      gest.hold = setTimeout(beginTouchNodeDrag, 450);
    }
  } else {
    clearTimeout(gest.hold);
    gest.node = null;                       // 손가락이 늘면 탭도, 카드 옮기기도 아니다
    if (gest.mode === "node") endTouchNodeDrag();
    gest.mode = "pan";
    gest.base = anchorNow();
  }
  return true;
}
function beginTouchNodeDrag() {
  if (!gest || gest.moved > 8 || !gest.node) return;
  const n = nodeById(gest.node);
  if (!n) return;
  gest.mode = "node";
  gest.ox = n.x; gest.oy = n.y;
  if (gest.el) gest.el.classList.add("dragging");
  if (navigator.vibrate) navigator.vibrate(12);          // 집혔다는 것을 손에 알린다
  toast("카드를 끌어 옮기세요");
}
function endTouchNodeDrag() {
  if (gest && gest.el) gest.el.classList.remove("dragging");
}
/* 지금 손가락 위치를 기준점으로 다시 잡는다 — 손가락이 늘거나 줄어도 화면이 튀지 않는다 */
function anchorNow() {
  const v = B().view, m = gestMid();
  return { zoom: v.zoom, panX: v.panX, panY: v.panY, mx: m.x, my: m.y, span: gestSpan() };
}
function onTouchMove(e) {
  if (!gest || !touchPts.has(e.pointerId)) return;
  e.preventDefault();
  touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  gest.moved = Math.max(gest.moved, Math.abs(e.clientX - gest.sx) + Math.abs(e.clientY - gest.sy));
  if (gest.moved > 8) clearTimeout(gest.hold);          // 밀기 시작했으면 길게 누르기는 취소

  if (gest.mode === "node") {                            /* 집어 든 카드 옮기기 */
    const n = nodeById(gest.node), z = B().view.zoom;
    if (!n) return;
    n.x = Math.round(gest.ox + (e.clientX - gest.sx) / z);
    n.y = Math.round(gest.oy + (e.clientY - gest.sy) / z);
    if (gest.el) { gest.el.style.left = n.x + "px"; gest.el.style.top = n.y + "px"; }
    moveEdgesOf(gest.node);
    return;
  }

  const v = B().view, b = gest.base, m = gestMid(), r = gest.rect;
  let z = b.zoom;
  if (touchPts.size >= 2 && b.span > 0) z = clamp(b.zoom * (gestSpan() / b.span), 0.15, 2.5);
  /* 처음 손가락이 있던 자리의 지도 좌표가 지금 손가락 자리에 그대로 오도록 민다 */
  const wx = (b.mx - r.left - b.panX) / b.zoom, wy = (b.my - r.top - b.panY) / b.zoom;
  v.zoom = z;
  v.panX = m.x - r.left - wx * z;
  v.panY = m.y - r.top - wy * z;
  applyTransformSoon();
}
function onTouchEnd(e) {
  touchPts.delete(e.pointerId);
  if (!gest) return;
  if (touchPts.size > 0) { gest.base = anchorNow(); return; }   // 아직 손가락이 남아 있다
  clearTimeout(gest.hold);
  endTouchNodeDrag();
  const g = gest;
  gest = null;
  g.surf.removeEventListener("pointermove", onTouchMove);
  g.surf.removeEventListener("pointerup", onTouchEnd);
  g.surf.removeEventListener("pointercancel", onTouchEnd);
  $("#flowPane").classList.remove("busy");
  if (g.moved < 8 && g.node) selectNode(g.node);               // 거의 안 움직였으면 탭 = 선택
  applyTransform();
  markDirty();
}
