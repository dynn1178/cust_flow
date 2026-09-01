
/* ========================================================================
   스테이지 — 화면 크게 보기 · 레이어 그리기 · 캠페인 배치
   렌더 원칙: 화면 이미지는 한 번만 붙이고, 레이어 SVG만 다시 그린다.
   ======================================================================== */
let mounted = { id: null, key: null, w: 0, h: 0 };

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
let lastFitScale = 1;
function stageScale(n) {
  const d = docExtent(n);
  if (stageZoom) return stageZoom;
  const box = $("#stageScroll").getBoundingClientRect();
  /* 패널 확장 중이라 스테이지가 숨겨져 있으면 크기가 0이다 — 배율을 새로 재지 않고
     마지막 맞춤 배율을 그대로 쓴다(다시 펼치면 그때 제대로 계산된다) */
  if (box.width < 1 || box.height < 1) return lastFitScale;
  const availW = box.width - 36, availH = box.height - 36;
  const s = stageFitMode === "height" ? availH / d.h
    : stageFitMode === "contain" ? Math.min(availW / d.w, availH / d.h)
    : availW / d.w;                  // "width" — 기본값
  return (lastFitScale = clamp(s, 0.05, 4));
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
  const img = doc.querySelector(".shot, .noshot, .webview");
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
    const bw = l.stroke || 0, bc = l.borderColor || "#111827";
    const border = bw > 0
      ? '<text class="ltext ltext-border" x="' + l.x + '" y="' + l.y + '" font-size="' + (l.size || 18) + '" fill="none" stroke="' + bc + '" stroke-width="' + bw + '" stroke-linejoin="round">' + esc(l.text || "텍스트") + "</text>"
      : "";
    s = border + '<text class="ltext ltext-fill" x="' + l.x + '" y="' + l.y + '" font-size="' + (l.size || 18) + '" fill="' + c + '"' +
      (outline ? ' stroke="rgba(255,255,255,.85)" stroke-width="' + ((l.size || 18) * 0.22) + '" paint-order="stroke"' : "") +
      ">" + esc(l.text || "텍스트") + "</text>";
  }
  else if (l.kind === "pen") {
    s = '<polyline class="shape" points="' + l.points.map(p => p[0] + "," + p[1]).join(" ") + '" fill="none" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round"/>';
    hit = '<polyline class="hit-line" points="' + l.points.map(p => p[0] + "," + p[1]).join(" ") + '" stroke-linecap="round" stroke-linejoin="round"/>';
  }
  else if (l.kind === "image") {
    const bw = l.stroke || 0;
    s = '<image href="' + l.src + '" x="' + l.x + '" y="' + l.y + '" width="' + Math.abs(l.w) + '" height="' + Math.abs(l.h) + '" preserveAspectRatio="none" draggable="false"/>' +
      (bw > 0 ? '<rect x="' + l.x + '" y="' + l.y + '" width="' + Math.abs(l.w) + '" height="' + Math.abs(l.h) + '" fill="none" stroke="' + (l.color || "#111827") + '" stroke-width="' + bw + '" pointer-events="none"/>' : "");
  }

  let pin = "";
  if (l.campId) {
    const b = bbox(l), found = campView(n.camps.find(x => x.id === l.campId));
    const col = found && CHAN[found.chan] ? CHAN[found.chan].c : "var(--camp)";
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
    const el = svg.querySelector('[data-layer="' + l.id + '"] .ltext-fill');
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
  const doc = $("#stageDoc"), empty = $("#stageEmpty"), wrap = $("#stageWrap");
  if (!n) {
    doc.innerHTML = ""; doc.style.width = doc.style.height = "0";
    mounted = { id: null, key: null, w: 0, h: 0 };
    empty.style.display = "grid"; $("#stageTitle").textContent = "페이지를 선택하세요"; $("#stageFoot").innerHTML = "";
    wrap.classList.remove("webmode");
    return;
  }
  empty.style.display = "none";
  $("#stageTitle").textContent = n.name;
  const webMode = n.viewMode === "web";
  wrap.classList.toggle("webmode", webMode);
  $("#stageTools").classList.toggle("grow", webMode);
  $$("#stageMode .btn").forEach(b => b.classList.toggle("on", b.dataset.mode === (webMode ? "web" : "shot")));
  $$(".imgonly").forEach(el => { el.style.display = webMode ? "none" : ""; });
  $$(".webonly").forEach(el => { el.style.display = webMode ? "" : "none"; });

  if (webMode) {
    renderWebToolbar(n);
    const key = "web:" + (n.webUrl || "");
    if (mounted.id !== n.id || mounted.key !== key) {
      doc.style.width = ""; doc.style.height = "";        // 웹 모드는 CSS(.webmode)가 100% 채움을 맡는다
      doc.innerHTML = n.webUrl
        ? '<iframe class="webview" src="' + esc(n.webUrl) + '" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerpolicy="no-referrer"></iframe>'
        : '<div class="noshot"><div class="empty">' + ico("link") + "<div>위 주소창에 페이지 주소를 입력하고<br>이동을 눌러 주세요</div></div></div>";
      mounted = { id: n.id, key: key, w: 0, h: 0 };
    }
    $("#stageFoot").innerHTML = '<span style="color:var(--ink-3); font-size:11.5px">' +
      "웹 모드 — 페이지의 링크를 눌러 그대로 이동할 수 있습니다. 다른 도메인으로 이동한 뒤에는 브라우저 보안정책상 주소가 자동으로 갱신되지 않으니, " +
      "정확히 담으려면 주소창에 직접 입력해 이동한 뒤 담아 주세요.</span>";
    return;
  }

  const base = docSize(n), ext = docExtent(n), s = stageScale(n), src = shotSrc(n);
  doc.style.width = Math.round(ext.w * s) + "px";
  doc.style.height = Math.round(ext.h * s) + "px";
  $("#sVal").textContent = stageZoom ? Math.round(s * 100) + "%" : "맞춤";
  $("#sFit").classList.toggle("on", !stageZoom);
  $("#sFitName").textContent = STAGE_FIT[stageFitMode].name;

  const shotStyle = "left:" + Math.round(-ext.x1 * s) + "px; top:" + Math.round(-ext.y1 * s) + "px; width:" + Math.round(base.w * s) + "px; height:" + Math.round(base.h * s) + "px;";
  const key = "shot:" + src;
  if (mounted.id !== n.id || mounted.key !== key || mounted.w !== base.w || mounted.h !== base.h) {
    const shot = src
      ? '<img class="shot" src="' + src + '" alt="' + esc(n.name) + ' 화면" draggable="false" style="' + shotStyle + '">'
      : '<div class="noshot" style="' + shotStyle + '"><div class="empty">' + ico("image") + "<div>화면 이미지를 올리거나 붙여넣기(Ctrl+V)<br>없이도 레이어를 그릴 수 있습니다</div></div></div>";
    doc.innerHTML = shot + '<svg id="layerSvg" viewBox="' + ext.x1 + " " + ext.y1 + " " + ext.w + " " + ext.h + '"></svg>';
    mounted = { id: n.id, key: key, w: base.w, h: base.h };
  } else {
    const img = doc.querySelector(".shot, .noshot");
    if (img) positionShotEl(img, base, ext, s);
    const svg = $("#layerSvg");
    if (svg) svg.setAttribute("viewBox", ext.x1 + " " + ext.y1 + " " + ext.w + " " + ext.h);
  }
  renderLayers();
  renderStageFoot(n, (n.layers || []).find(x => x.id === sel.layer));
}
/* ---------------- 웹 모드 ----------------
   실제 웹페이지를 iframe으로 그대로 띄워 링크를 따라 돌아다니며 "페이지 컨텐츠"
   (주소·경로·화면 이미지)를 빠르게 모으기 위한 기능이다. 스크린샷 모드처럼
   축소·배치하지 않고 패널을 꽉 채우는 실제 브라우저처럼 보여 주고, 바깥의
   팬·줌 스크롤은 없앤 채 iframe 자체의 스크롤만 남긴다. */
function normalizeUrl(v) {                          // 주소가 없으면 https:// 를 붙여 준다
  const t = String(v || "").trim();
  if (!t) return "";
  return /^https?:\/\//i.test(t) ? t : "https://" + t.replace(/^\/+/, "");
}
function urlPath(u) {
  try { const x = new URL(u); return x.pathname + x.search; } catch (e) { return ""; }
}
/* 교차 출처 iframe은 동일 출처 정책 때문에 실제 표시 중인 주소를 읽을 수 없다 —
   같은 출처일 때만(드묾) 성공하고, 그 밖에는 마지막으로 입력한 주소로 대신한다 */
function liveIframeUrl() {
  const f = $("#stageDoc iframe.webview");
  if (!f) return null;
  try {
    const href = f.contentWindow.location.href;
    return href && href !== "about:blank" ? href : null;
  } catch (e) { return null; }
}
/* 주소에서 이름을 뽑는다 — 마지막 경로 조각(예: "main.yb"), 없으면 호스트 이름.
   절대 전체 URL 그대로는 쓰지 않는다(주소창과 구별이 안 되기 때문) */
function nameFromUrl(url) {
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);
    return segs.length ? decodeURIComponent(segs[segs.length - 1]) : u.hostname;
  } catch (e) { return url; }
}
function renderWebToolbar(n) {
  const nameInp = $("#webNameIn"), urlInp = $("#webUrlIn");
  if (document.activeElement !== nameInp) nameInp.value = n.name || "";
  if (document.activeElement !== urlInp) urlInp.value = n.webUrl || "";
}
function loadWebUrl(n, raw) {
  const u = normalizeUrl(raw);
  if (!u) return;
  n.webUrl = u; markDirty(); renderStage();
}
/* 지금 로딩된 화면을 서버가 대신 열어 찍어 온다(교차 출처 iframe은 브라우저가
   직접 캡처할 수 없어 서버 헤드리스 브라우저를 거친다) — 대상 사이트가 봇을
   막아 두었거나 시간이 오래 걸리면 실패할 수 있다. */
async function captureScreenshot(url) {
  try {
    const token = await ensureToken().catch(() => null);
    const h = token ? { Authorization: "Bearer " + token } : {};
    const r = await fetch("/api/screenshot?url=" + encodeURIComponent(url), { headers: h });
    if (!r.ok) return null;
    return await r.blob();
  } catch (e) { return null; }
}
/* 서버 캡처가 안 되면(사이트 차단·시간초과 등) 클립보드에 이미지가 있는지
   마지막으로 확인한다 — 스크린샷 도구 등으로 방금 복사해 둔 것을 대신 쓴다 */
async function captureClipboardImage() {
  if (!navigator.clipboard || !navigator.clipboard.read) return null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find(t => t.indexOf("image/") === 0);
      if (type) return await item.getType(type);
    }
  } catch (e) { /* 권한 거부 · 클립보드에 이미지 없음 등 — 조용히 건너뛴다 */ }
  return null;
}
async function captureCurrentWeb(url) {
  toast("화면을 캡처하는 중…");
  let blob = await captureScreenshot(url);
  if (!blob) blob = await captureClipboardImage();
  return blob;
}
/* 추가하기 — 지금 웹 정보로 완전히 새 페이지 카드를 만든다. 지금 보고 있는
   카드는 건드리지 않고 그대로 웹 모드에 남아 있어, 링크를 계속 따라가며
   여러 카드를 잇달아 만들 수 있다. */
async function addNewWebPage() {
  const n = curNode();
  const url = n && (liveIframeUrl() || n.webUrl);
  if (!url) return toast("먼저 주소를 입력하고 이동해 주세요", "bad");
  const blob = await captureCurrentWeb(url);
  const created = addNodeInBoard(B(), nameFromUrl(url), urlPath(url));
  created.webUrl = url;
  if (blob) { try { await setShot(blob, created, true); } catch (e) { /* 이미지 없이 진행 */ } }
  markDirty(); renderFlow(); renderPanels();
  toast("새 페이지를 추가했습니다 · " + created.name + (blob ? " · 이미지 포함" : " · 화면은 못 찍었습니다"), blob ? "ok" : "bad");
}
/* 수정하기 — 지금 선택돼 있는(현재 스테이지에 열려 있는) 카드를 지금 웹
   정보로 덮어쓴다. 새로 만들지 않고 항상 curNode() 하나만 대상으로 한다. */
async function updateCurWebPage() {
  const n = curNode();
  const url = n && (liveIframeUrl() || n.webUrl);
  if (!url) return toast("먼저 주소를 입력하고 이동해 주세요", "bad");
  const blob = await captureCurrentWeb(url);
  n.path = urlPath(url);
  n.name = nameFromUrl(url);
  if (blob) { try { await setShot(blob, n, true); } catch (e) { /* 이미지 없이 진행 */ } }
  markDirty(); renderFlow(); renderStage(); renderPanels();
  toast("이 페이지 정보를 수정했습니다" + (blob ? " · 이미지 포함" : " · 화면은 못 찍었습니다"), blob ? "ok" : "bad");
}
function renderStageFoot(n, L) {
  const d = docSize(n);
  let html = '<span class="mono" style="font-size:11px">' + d.w + " × " + d.h + "</span>";
  html += '<span class="tool-sep"></span><span>레이어 ' + (n.layers || []).length + "개</span>";
  if ((n.layers || []).length) html += '<button class="btn sm" data-lact="list">' + ico("layers", "xs") + "레이어 목록</button>";
  if (L) {
    const camp = L.campId ? campView(n.camps.find(c => c.id === L.campId)) : null;
    html += '<span class="tool-sep"></span><span style="color:var(--ink-2)">선택: ' + LKIND(L) + "</span>";
    if (camp) html += '<span class="chip" style="--c:' + (CHAN[camp.chan] || CHAN.push).c + '">' + ico("mega", "xs") + esc(camp.name) + "</span>";
    html += '<div class="spacer"></div>' +
      (L.kind === "text" ? '<button class="btn sm" data-lact="edittext">' + ico("edit", "xs") + "텍스트 수정</button>" : "") +
      '<button class="btn sm" data-lact="front">앞으로</button><button class="btn sm" data-lact="back">뒤로</button>' +
      '<button class="btn sm danger" data-lact="del">' + ico("trash", "xs") + "삭제</button>";
  } else {
    html += '<div class="spacer"></div>';
  }
  $("#stageFoot").innerHTML = html;
  renderStageTools();
}
function LKIND(l) { return { rect: "사각형", ellipse: "원", arrow: "화살표", text: "텍스트", pen: "펜", image: "이미지" }[l.kind] || l.kind; }
const LKIND_ICO = { rect: "square", ellipse: "circle", arrow: "arrow", text: "text", pen: "pen", image: "image" };
/* 레이어 목록 팝업 — 항목을 누르면 그 레이어를 고르고, 스테이지를 그 위치로 스크롤해 보여준다 */
function openLayerListMenu(n, anchorEl) {
  if (!n.layers.length) return;
  const list = n.layers.map((l, i) => {
    const label = l.kind === "text" ? esc((l.text || "텍스트").slice(0, 22)) : LKIND(l);
    const camp = l.campId ? campView(n.camps.find(c => c.id === l.campId)) : null;
    return '<button class="mi' + (l.id === sel.layer ? " on" : "") + '" data-go="' + l.id + '">' +
      ico(LKIND_ICO[l.kind] || "square", "xs") + (i + 1) + ". " + label +
      (camp ? '<span class="cnt">' + esc(camp.name) + "</span>" : "") + "</button>";
  }).join("");
  openMenu(list, anchorEl, it => { if (it.dataset.go) jumpToLayer(it.dataset.go); });
}
function jumpToLayer(id) {
  const n = curNode(); if (!n) return;
  const l = n.layers.find(x => x.id === id); if (!l) return;
  sel.layer = id;
  renderLayers(); renderStageFoot(n, l); renderPanels();
  const b = bbox(l), ext = docExtent(n), s = stageScale(n), box = $("#stageScroll");
  box.scrollTo({
    left: (b.x + b.w / 2 - ext.x1) * s - box.clientWidth / 2,
    top: (b.y + b.h / 2 - ext.y1) * s - box.clientHeight / 2,
    behavior: "smooth"
  });
}

const STROKES = { 0: "없음", 2: "얇게", 3: "보통", 6: "굵게" };
/* 색 스와치가 두 가지 대상을 가질 수 있는 레이어 — 도형은 선/채우기, 텍스트는 글자색/테두리색.
   그 밖(이미지·펜·화살표)은 항상 primary(색 하나)만 쓴다. */
function fillTarget(l) { return !!l && (l.kind === "rect" || l.kind === "ellipse"); }
function borderTarget(l) { return !!l && l.kind === "text"; }
/* 스테이지 위쪽 색·굵기 툴바 — 선택된 레이어 종류에 맞춰 다시 그린다.
   레이어 선택이 바뀌거나(renderStageFoot) 색/굵기를 바꾼 직후 호출한다. */
function renderStageTools() {
  const modeSeg = $("#colorMode"); if (!modeSeg) return;
  const n = curNode(), L = n && n.layers.find(x => x.id === sel.layer);
  const hasTab = fillTarget(L) || borderTarget(L);
  if (!hasTab) colorMode = "primary";
  modeSeg.style.display = hasTab ? "" : "none";
  if (hasTab) {
    const labels = fillTarget(L) ? ["선", "채우기"] : ["글자", "테두리"];
    modeSeg.innerHTML = ["primary", "secondary"].map((k, i) =>
      '<button class="btn sm' + (colorMode === k ? " on" : "") + '" data-mode="' + k + '">' + labels[i] + "</button>").join("");
  }

  const secondary = colorMode === "secondary" && hasTab;
  let cur;
  if (!L) cur = drawColor;
  else if (secondary) cur = fillTarget(L) ? (L.fill || "none") : (L.stroke > 0 ? (L.borderColor || "#111827") : "none");
  else cur = L.color || drawColor;

  $("#swatches").innerHTML =
    (secondary ? '<button class="sw sw-none' + (cur === "none" ? " on" : "") + '" data-c="none" title="없음"></button>' : "") +
    SWATCH.map(c => '<button class="sw' + (c === cur ? " on" : "") + '" data-c="' + c + '" style="background:' + c + '" title="' + c + '"></button>').join("");

  const curStroke = L && "stroke" in L ? (L.stroke || 0) : drawStroke;
  $("#strokeSeg").innerHTML = Object.entries(STROKES).map(([w, name]) =>
    '<button class="btn sm' + (+w === curStroke ? " on" : "") + '" data-sw="' + w + '" title="' + name + '">' + name + "</button>").join("");
}
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
    if (n.id === sel.node) stageZoom = 1;
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
    const im = await readImage(file, 1200, 0.85, true);
    const d = docSize(n);
    /* 예전에는 항상 페이지 폭의 55%로 줄여 넣었다 — 실제 이미지보다 훨씬 작게
       보이는 원인이었다. 이제는 페이지 안에 다 들어가면 원래(디코딩된) 크기
       그대로 넣고, 넘칠 때만 딱 맞을 만큼만 줄인다. */
    const r = Math.min(1, (d.w * 0.85) / im.w, (d.h * 0.85) / im.h);
    n.layers.push({ id: uid("l"), kind: "image", src: im.src, x: Math.round(d.w * 0.1), y: Math.round(d.h * 0.1), w: Math.round(im.w * r), h: Math.round(im.h * r), color: null, stroke: 0, campId: null });
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
    const n = curNode(); if (!n || !canEdit() || n.viewMode === "web") return;   /* 웹 모드에서는 클릭이 그대로 iframe(링크)으로 전달돼야 한다 */
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
            n.layers.push({ id: uid("l"), kind: "text", text: v.text || "텍스트", size: Number(v.size) || 18, outline: !!v.outline, x: Math.round(p.x), y: Math.round(p.y), color: drawColor, stroke: 0, borderColor: "#111827", campId: null });
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
    const n = curNode(); if (!n) return;
    if (b.dataset.lact === "list") return openLayerListMenu(n, b);
    const i = n.layers.findIndex(x => x.id === sel.layer);
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
  renderStageTools();
  $("#colorMode").addEventListener("click", e => {
    const b = e.target.closest("[data-mode]"); if (!b) return;
    colorMode = b.dataset.mode;
    renderStageTools();
  });
  $("#swatches").addEventListener("click", e => {
    const b = e.target.closest("[data-c]"); if (!b) return;
    const c = b.dataset.c;
    const n = curNode(), L = n && n.layers.find(x => x.id === sel.layer);
    const secondary = colorMode === "secondary" && (fillTarget(L) || borderTarget(L));
    if (secondary && fillTarget(L)) { L.fill = c; markDirty(); renderLayers(); renderStageTools(); return; }
    if (secondary && borderTarget(L)) {
      if (c === "none") { L.stroke = 0; }
      else { L.borderColor = c; if (!(L.stroke > 0)) L.stroke = drawStroke || 2; }
      markDirty(); renderLayers(); renderStageTools(); return;
    }
    if (c === "none") return;               /* '없음'은 채우기·테두리 모드에서만 의미가 있다 */
    drawColor = c;
    if (L) L.color = c;
    markDirty(); if (L) renderLayers();
    renderStageTools();
  });

  $("#strokeSeg").addEventListener("click", e => {
    const b = e.target.closest("[data-sw]"); if (!b) return;
    const sw = +b.dataset.sw;
    drawStroke = sw || drawStroke;
    const n = curNode(), L = n && n.layers.find(x => x.id === sel.layer);
    if (L && "stroke" in L) { L.stroke = sw; markDirty(); renderLayers(); }
    renderStageTools();
  });

  $("#btnShot").addEventListener("click", () => openShotModal(curNode()));
  $("#btnLayerImg").addEventListener("click", () => pickFile(addImageLayer));

  $("#stageMode").addEventListener("click", e => {
    const b = e.target.closest("[data-mode]"), n = curNode();
    if (!b || !n || !canEdit()) return;
    n.viewMode = b.dataset.mode; markDirty(); renderStage();
  });
  $("#webGo").addEventListener("click", () => { const n = curNode(); if (n && canEdit()) loadWebUrl(n, $("#webUrlIn").value); });
  $("#webUrlIn").addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    const n = curNode(); if (n && canEdit()) loadWebUrl(n, e.target.value);
  });
  $("#webAddNew").addEventListener("click", () => { if (canEdit()) addNewWebPage(); });
  $("#webEditCur").addEventListener("click", () => { if (canEdit()) updateCurWebPage(); });
  const commitWebName = e => {
    const n = curNode(); if (!n || !canEdit()) return;
    const v = e.target.value.trim();
    if (v && v !== n.name) { n.name = v; markDirty(); $("#stageTitle").textContent = n.name; renderFlow(); }
  };
  $("#webNameIn").addEventListener("change", commitWebName);
  $("#webNameIn").addEventListener("keydown", e => { if (e.key === "Enter") e.target.blur(); });
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
  const inWebMode = () => { const n = curNode(); return n && n.viewMode === "web"; };
  ["dragenter", "dragover"].forEach(t => wrap.addEventListener(t, e => { if (inWebMode() || !hasFiles(e)) return; e.preventDefault(); wrap.classList.add("dragover"); }));
  wrap.addEventListener("dragleave", e => { if (wrap.contains(e.relatedTarget)) return; wrap.classList.remove("dragover"); });
  wrap.addEventListener("drop", e => {
    wrap.classList.remove("dragover");
    if (!canEdit() || !hasFiles(e) || inWebMode()) return;
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && /^image\//.test(f.type)) { const n = curNode(); n && shotSrc(n) ? addImageLayer(f) : setShot(f); }
  });
  document.addEventListener("paste", e => {
    if (!canEdit() || inWebMode()) return;             /* 웹 모드에서 붙여넣기는 "추가하기/수정하기"가 대신 처리한다 */
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
