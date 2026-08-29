
/* ========================================================================
   모바일 전용 동작 — 레이아웃 전환 · 터치 제스처

   짝이 되는 스타일은 parts/17-mobile.html 에 모여 있다. 모바일에서 뭔가
   달라져야 하면 두 파일만 보면 된다.

   여기서 해결하는 것
     1) 여정 지도가 PC 와 다르게 보이던 문제
        카드 폭·글자 크기는 배율이 낮아질수록 커지도록 보정돼 있다(--zoom).
        화면이 좁으면 배율이 낮게 잡히므로 카드가 넓어지고 줄바꿈·겹침이
        달라져 "다른 지도"처럼 보였다. 모바일에서는 이 보정을 끄고 배율 100%
        기준 크기로 고정한다 — PC 화면을 그대로 축소한 모습이 된다.
     2) 확대/축소가 안 되던 문제
        휠 이벤트만 있어서 손가락으로는 배율을 바꿀 수 없었다. 두 손가락
        오므리기/벌리기를 직접 처리한다.
     3) 실수로 노드가 끌려 옮겨지던 문제
        한 손가락은 기본이 화면 밀기다. 탭하면 선택, 카드를 옮기려면 0.45초
        길게 누른 뒤 끈다(편집 권한이 있을 때만). 고치는 것은 카드의 `설정` 버튼.
   ======================================================================== */
const MOBILE_MAX = 860;
let mobileOn = null;

function isMobileLayout() { return innerWidth <= MOBILE_MAX; }
/* 지도 조작을 손가락 기준으로 바꿀지 — 좁은 화면이거나 마우스가 없는 기기 */
function isTouchFlow() {
  return isMobileLayout() || (matchMedia("(pointer: coarse)").matches && innerWidth <= 1180);
}
/* 카드 크기 보정에 쓸 배율. 모바일에서는 1로 고정해 지도 모습을 PC 와 맞춘다. */
function zoomVarFor(z) { return isMobileLayout() ? 1 : z; }

/* ---------------- 레이아웃 전환 ---------------- */
const MPANES = [
  { k: "camp", ico: "mega", name: "캠페인" },
  { k: "stage", ico: "layers", name: "화면" },
  { k: "tag", ico: "tag", name: "태깅" }
];
let mPane = "camp";

function renderMobileTabs() {
  const bar = $("#mTabs");
  if (!bar) return;
  bar.innerHTML = MPANES.map(p =>
    '<button class="btn sm' + (mPane === p.k ? " on" : "") + '" data-mpane="' + p.k + '">' +
      ico(p.ico, "xs") + p.name + "</button>").join("");
  $("#deck").dataset.mpane = mPane;
}
function setMobilePane(k) {
  mPane = k;
  renderMobileTabs();
  /* 숨어 있던 영역이 나타나면 크기를 다시 재야 스테이지 배율이 맞는다 */
  if (k === "stage" && !stageZoom) renderStage();
}
/* ---------------- 화면 위치(배율·이동) ----------------
   PC 에서 맞춰 둔 화면 위치를 폰 화면에 그대로 쓰면 지도가 화면 밖으로 밀려나
   빈 캔버스만 보인다. 모바일에서는 폰 화면에 맞게 다시 잡되, 문서에 저장되는
   값은 PC 것을 그대로 지켜 준다 — 폰으로 열었다 저장해도 PC 배치가 안 바뀐다. */
const deskViews = {};
let mFittedBoard = null;

function keepDeskView() {
  const b = B();
  if (!deskViews[b.id]) deskViews[b.id] = Object.assign({}, b.view);
}
function restoreDeskViews() {
  state.boards.forEach(b => {
    if (deskViews[b.id]) { b.view = deskViews[b.id]; delete deskViews[b.id]; }
  });
}
/* 저장할 때 쓸 화면 위치 — 모바일에서 맞춘 값 대신 PC 값을 돌려준다 */
function viewForSave(b) { return deskViews[b.id] || b.view; }

/* 지도를 다시 그린 뒤마다 부른다. 보드가 바뀌었으면 폰 화면에 맞춰 다시 잡는다. */
function mobileAfterRender() {
  if (!isMobileLayout()) { mFittedBoard = null; return; }
  const b = B();
  /* 보드 id 만 보면, 서버에서 문서를 받아 와 내용이 통째로 바뀌어도 같은 판으로
     보여 다시 맞추지 않는다. 노드 수·첫/끝 노드까지 함께 본다. */
  const key = b.id + "|" + b.nodes.length + "|" + ((b.nodes[0] || {}).id || "") +
    "|" + ((b.nodes[b.nodes.length - 1] || {}).id || "");
  if (mFittedBoard === key) return;
  mFittedBoard = key;
  keepDeskView();
  requestAnimationFrame(() => { if (isMobileLayout()) { fitFlow(); applyTransform(); } });
}

/* 화면 크기가 바뀔 때마다 모바일 여부를 다시 판단한다 */
function syncMobileLayout() {
  const on = isMobileLayout();
  document.body.classList.toggle("mobile", on);
  const bar = $("#mTabs");
  if (bar) bar.style.display = on ? "" : "none";
  if (on) $("#deck").dataset.mpane = mPane; else delete $("#deck").dataset.mpane;
  if (mobileOn === on) return;
  mobileOn = on;
  if (!on) { restoreDeskViews(); mFittedBoard = null; }   // PC 로 돌아가면 원래 화면 위치로
  /* 보정 배율이 달라지므로 지도를 다시 그린다 */
  zoomVar = null;
  applyTransform();
  renderFlow();
  mobileAfterRender();
}
function initMobile() {
  const deck = $("#deck");
  if (!deck || $("#mTabs")) return;
  const bar = document.createElement("div");
  bar.className = "mtabs";
  bar.id = "mTabs";
  deck.parentNode.insertBefore(bar, deck);
  bar.addEventListener("click", e => {
    const b = e.target.closest("[data-mpane]");
    if (b) setMobilePane(b.dataset.mpane);
  });
  renderMobileTabs();
  syncMobileLayout();
  addEventListener("resize", syncMobileLayout);
  addEventListener("orientationchange", () => setTimeout(syncMobileLayout, 120));
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
