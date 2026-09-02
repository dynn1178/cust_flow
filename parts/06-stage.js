
/* ========================================================================
   스테이지 — 화면 크게 보기 · 레이어 그리기 · 캠페인 배치
   렌더 원칙: 화면 이미지는 한 번만 붙이고, 레이어 SVG만 다시 그린다.
   ======================================================================== */
let mounted = { id: null, key: null, w: 0, h: 0 };
let browseMode = "shot";   // 페이지 카드가 없을 때 스테이지가 빈 안내인지 웹 둘러보기인지
let browseUrl = "";        // 카드 없이 웹으로 둘러볼 때 쓰는 임시 주소 — 문서에 저장되지 않는다
/* 동일 출처 정책 때문에 iframe 안에서 링크를 눌러 다른 곳으로 이동했는지는
   감지할 수 있어도(load 이벤트) 그 새 주소를 읽을 수는 없다 — true면 지금
   화면과 우리가 아는 주소(webUrl)가 어긋나 있을 수 있다는 뜻 */
let addrUnknown = false;
/* "태그 확인" 결과 — 마지막으로 확인한 주소와 그 결과(업체별 감지 여부·이벤트 이름)를
   들고 있다가 태깅 패널에서 등록된 태그와 비교해 보여준다. 문서에는 저장하지 않는다. */
let detectedTags = null;         // { amplitude:{detected,events}, braze:{...}, ga4:{...} }
let detectedTagsUrl = null;
let detectedTagsLoading = false;
/* 잡힌 이벤트가 많아지면 하나하나 훑어보기 번거롭다 — "해외패키지"처럼
   업무상 익숙한 키워드로 이벤트 이름·속성 이름·속성 값을 한 번에 훑어서
   관련된 것만 추려 보여준다. 새로 요청을 보내는 게 아니라 이미 받아 둔
   결과(detectedTags) 안에서만 걸러낸다. */
let tagSearchText = "";
/* 캡처만 봐서는 "무엇을 눌러서" 나온 이벤트인지 알 수 없다 — 사용자가 여기
   적어 두면, "+"로 새 태그를 만들 때 이벤트명(한글) 칸에 그대로 들어간다. */
let tagClickLabel = "";

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
  const webMode = n ? n.viewMode === "web" : browseMode === "web";

  wrap.classList.toggle("webmode", webMode);
  $("#stageTools").classList.toggle("grow", webMode);
  $$("#stageMode .btn").forEach(b => b.classList.toggle("on", b.dataset.mode === (webMode ? "web" : "shot")));
  $$(".imgonly").forEach(el => { el.style.display = webMode ? "none" : ""; });
  $$(".webonly").forEach(el => { el.style.display = webMode ? "" : "none"; });
  /* 카드가 없을 때는 이름 바꾸기·수정하기가 가리킬 대상이 없다 */
  $("#webNameField").style.display = (webMode && n) ? "" : "none";
  $("#webEditCur").style.display = (webMode && n) ? "" : "none";

  if (!n) {
    if (!webMode) {
      doc.innerHTML = ""; doc.style.width = doc.style.height = "0";
      mounted = { id: null, key: null, w: 0, h: 0 };
      empty.style.display = "grid"; $("#stageTitle").textContent = "페이지를 선택하세요"; $("#stageFoot").innerHTML = "";
      return;
    }
    empty.style.display = "none";
    $("#stageTitle").textContent = "웹 둘러보기";
    renderWebToolbar(null);
    renderWebFrame("__browse__", browseUrl);
    $("#stageFoot").innerHTML = webHintHtml("페이지 카드 없이 주소부터 둘러볼 수 있습니다 — 추가하기를 누르면 지금 화면으로 새 카드가 만들어집니다.");
    return;
  }

  empty.style.display = "none";
  $("#stageTitle").textContent = n.name;

  if (webMode) {
    renderWebToolbar(n);
    renderWebFrame(n.id, n.webUrl);
    $("#stageFoot").innerHTML = webHintHtml("웹 모드 — 페이지의 링크를 눌러 그대로 이동할 수 있습니다.");
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
/* #stageDoc 안에 iframe(또는 안내문)을 채운다 — 카드가 있을 때는 id로, 카드
   없이 둘러볼 때는 "__browse__"로 구분해서 같은 mounted 캐시를 함께 쓴다 */
function renderWebFrame(id, url) {
  const doc = $("#stageDoc");
  const key = "web:" + (url || "");
  if (mounted.id !== id || mounted.key !== key) {
    doc.style.width = ""; doc.style.height = "";        // 웹 모드는 CSS(.webmode)가 100% 채움을 맡는다
    addrUnknown = false;                                // 방금 우리가 직접 넣은 주소이니 다시 믿을 수 있는 상태
    if (url !== detectedTagsUrl) { detectedTags = null; detectedTagsUrl = null; renderTagPanel(); }
    doc.innerHTML = url
      ? '<iframe class="webview" src="' + esc(url) + '" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerpolicy="no-referrer"></iframe>'
      : '<div class="noshot"><div class="empty">' + ico("link") + "<div>위 주소창에 페이지 주소를 입력하고<br>이동을 눌러 주세요</div></div></div>";
    mounted = { id: id, key: key, w: 0, h: 0 };
    const f = doc.querySelector("iframe.webview");
    if (f) {
      let firstLoad = true;
      /* 이 load는 우리가 방금 넣은 src 자체가 뜬 것 — 그다음부터 fire되는 load는
         전부 사용자가 iframe 안 링크를 눌러 다른 곳으로 넘어갔다는 뜻이다.
         어디로 갔는지는 동일 출처 정책 때문에 알 수 없어 경고만 띄운다. */
      f.addEventListener("load", () => {
        if (firstLoad) { firstLoad = false; return; }
        addrUnknown = true;
        renderStageFootWebHint();
      });
    }
  }
}
function renderStageFootWebHint() {
  const foot = $("#stageFoot");
  if (!foot || !$(".weburl-hint", foot)) return;
  foot.innerHTML = webHintHtml();
}
function webHintHtml(defaultText) {
  return addrUnknown
    ? '<span class="weburl-hint" style="color:var(--warn); font-size:11.5px; font-weight:500">' + ico("alert", "xs") +
      "다른 페이지로 이동한 상태입니다 — 지금 주소를 알 수 없어 추가·수정하면 마지막으로 불러온 주소로 기록됩니다. " +
      "정확히 담으려면 그 페이지 주소를 복사해 위 주소창에 붙여넣고 이동하세요.</span>"
    : '<span class="weburl-hint" style="color:var(--ink-3); font-size:11.5px">' + defaultText + "</span>";
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
  if (n && document.activeElement !== nameInp) nameInp.value = n.name || "";
  if (document.activeElement !== urlInp) urlInp.value = (n ? n.webUrl : browseUrl) || "";
}
/* n이 없으면(카드 없이 둘러보는 중) 문서에 저장하지 않는 임시 주소(browseUrl)에 담는다 */
function loadWebUrl(n, raw) {
  const u = normalizeUrl(raw);
  if (!u) return;
  if (n) { n.webUrl = u; markDirty(); } else { browseUrl = u; }
  renderStage();
}
/* 지금 로딩된 화면을 서버가 대신 열어 찍어 온다(교차 출처 iframe은 브라우저가
   직접 캡처할 수 없어 서버 헤드리스 브라우저를 거친다) — 대상 사이트가 봇을
   막아 두었거나 시간이 오래 걸리면 실패할 수 있다. */
let lastScreenshotError = "";
async function captureScreenshot(url) {
  try {
    const token = await ensureToken().catch(() => null);
    const h = token ? { Authorization: "Bearer " + token } : {};
    const r = await fetch("/api/screenshot?url=" + encodeURIComponent(url), { headers: h });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      lastScreenshotError = j.error || ("서버 응답 " + r.status);
      console.error("[screenshot] 실패:", r.status, j.error);
      return null;
    }
    return await r.blob();
  } catch (e) {
    lastScreenshotError = (e && e.message) || "네트워크 오류";
    console.error("[screenshot] 요청 실패:", e);
    return null;
  }
}
/* 태그 확인 — 서버가 그 주소를 직접 열어 Amplitude·Braze·GA4로 실제 나가는
   트래킹 요청을 엿보고 어떤 이벤트를 보내는지 최대한 뽑아 온다(최선 추정치).
   결과는 태깅 패널에서 등록된 태그와 비교해 보여준다. */
async function checkPageTags() {
  const n = curNode();
  const url = liveIframeUrl() || (n ? n.webUrl : browseUrl);
  if (!url) return toast("먼저 주소를 입력하고 이동해 주세요", "bad");
  detectedTagsLoading = true; detectedTags = null; detectedTagsUrl = url;
  renderPanels();
  stageBusy("태그를 확인하는 중… (트래킹 스크립트가 다 뜰 때까지 20초 넘게 걸릴 수 있습니다)");
  try {
    const token = await ensureToken().catch(() => null);
    const h = token ? { Authorization: "Bearer " + token } : {};
    const r = await fetch("/api/detect-tags?url=" + encodeURIComponent(url), { headers: h });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ("서버 응답 " + r.status));
    detectedTags = j;
    const found = Object.keys(j).filter(k => j[k] && j[k].detected).map(k => PLAT[k] ? PLAT[k].name : k);
    toast(found.length ? "감지됨 · " + found.join(", ") : "이 페이지에서 Amplitude·Braze·GA4 요청을 찾지 못했습니다", found.length ? "ok" : "bad");
    /* 파싱이 실제와 맞는지 확인할 원본 샘플 — 콘솔에서 "detect-tags 원본"으로 펼쳐 볼 수 있다 */
    console.groupCollapsed("[태그 확인] 원본 샘플 (문제 있으면 이걸 복사해서 알려주세요)");
    console.log(j);
    console.groupEnd();
  } catch (e) {
    detectedTags = null; detectedTagsUrl = null;
    toast("태그 확인에 실패했습니다: " + ((e && e.message) || "알 수 없는 오류"), "bad");
  } finally {
    detectedTagsLoading = false;
    renderStage(); renderPanels();
  }
}
/* 상품 클릭처럼 사용자 동작이 있어야만 나가는 이벤트는 checkPageTags()처럼
   서버가 페이지를 가만히 열어두기만 해서는 절대 잡히지 않는다 — 실제
   브라우저에서 직접 클릭해 보고 DevTools Network 탭에서 내보낸 HAR 파일을
   그대로 가져와서 그 안의 요청들을 훑는다. 봇 감지·동의 배너·교차출처·
   서버 실행시간 제한 어느 것도 걸리지 않는, 가장 확실한 방법이다. */
/* DevTools를 열어 Network 탭 → "Save all as HAR with content"를 매번 누르는
   게 불편하다는 요청 — 그렇다고 우리 앱 페이지에서 다른 도메인 탭의 네트워크
   요청을 대신 지켜볼 방법은 없다(교차출처). 대신 즐겨찾기 막대에 한 번만
   등록해 두는 북마클릿을 준다 — 실제 사이트 탭에서 그 즐겨찾기를 누르면 그
   페이지 자신의 자바스크립트로 fetch·XHR·sendBeacon을 가로채 기록하고, 다시
   누르면 지금까지 잡은 걸 우리가 이미 읽을 줄 아는 .har 파일로 내려받는다 —
   DevTools도, "Save as HAR"도 필요 없다. */
function harCaptureScript() {
  return "(function(){" +
    "if(window.__tagcapActive){" +
      "window.__tagcapActive=false;" +
      "var entries=(window.__tagcapEntries||[]).map(function(e){return {request:{url:e.url,method:e.method,postData:e.postData!=null?{text:e.postData}:undefined}};});" +
      "var har={log:{version:'1.2',creator:{name:'tagcap-bookmarklet',version:'1'},entries:entries}};" +
      "var blob=new Blob([JSON.stringify(har)],{type:'application/json'});" +
      "var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='tagcap-'+Date.now()+'.har';" +
      "document.body.appendChild(a);a.click();a.remove();" +
      "if(window.__tagcapRestore){window.__tagcapRestore.forEach(function(fn){fn();});window.__tagcapRestore=null;}" +
      "if(window.__tagcapBadge){window.__tagcapBadge.remove();window.__tagcapBadge=null;}" +
      "alert('캡처 종료 — '+entries.length+'개 요청을 파일로 저장했습니다.');" +
      "return;" +
    "}" +
    "window.__tagcapActive=true;window.__tagcapEntries=[];" +
    "function push(u,m,b){try{window.__tagcapEntries.push({url:String(u),method:m||'GET',postData:b!=null?String(b):null});}catch(e){}}" +
    "var oF=window.fetch;" +
    "window.fetch=function(input,init){try{var u=typeof input==='string'?input:(input&&input.url);var m=(init&&init.method)||(input&&input.method)||'GET';var b=(init&&init.body)||null;push(u,m,typeof b==='string'?b:null);}catch(e){}return oF.apply(this,arguments);};" +
    "var X=window.XMLHttpRequest,oO=X.prototype.open,oS=X.prototype.send;" +
    "X.prototype.open=function(m,u){this.__tcM=m;this.__tcU=u;return oO.apply(this,arguments);};" +
    "X.prototype.send=function(b){push(this.__tcU,this.__tcM,typeof b==='string'?b:null);return oS.apply(this,arguments);};" +
    "var oB=navigator.sendBeacon?navigator.sendBeacon.bind(navigator):null;" +
    "if(oB){navigator.sendBeacon=function(u,d){push(u,'POST',typeof d==='string'?d:null);return oB(u,d);};}" +
    "window.__tagcapRestore=[function(){window.fetch=oF;},function(){X.prototype.open=oO;X.prototype.send=oS;},function(){if(oB)navigator.sendBeacon=oB;}];" +
    "var badge=document.createElement('div');badge.textContent='🔴 태그 캡처 중 — 즐겨찾기를 다시 누르면 종료·다운로드됩니다';" +
    "badge.style.cssText='position:fixed;top:8px;right:8px;z-index:2147483647;background:#111;color:#fff;padding:6px 10px;border-radius:6px;font:12px sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3)';" +
    "document.body.appendChild(badge);window.__tagcapBadge=badge;" +
  "})();";
}
function harBookmarkletHref() { return "javascript:" + encodeURIComponent(harCaptureScript()); }
function openHarExportModal() {
  const root = modalHost();
  root.innerHTML =
    '<div class="scrim"><div class="modal glass" style="width:min(480px,100%)" role="dialog" aria-modal="true">' +
      '<div class="modal-head">' + ico("share") + "<h3>DevTools 없이 캡처하기</h3>" +
        '<button class="btn icon sm" data-x>' + ico("close", "xs") + "</button></div>" +
      '<div class="modal-body">' +
        '<p class="hint">아래 링크를 즐겨찾기 막대로 <b>드래그</b>해서 등록하세요 — 클릭하면 지금 이 화면에서 실행되어 아무 효과가 없습니다.</p>' +
        '<p style="text-align:center; margin:16px 0">' +
          '<a href="' + esc(harBookmarkletHref()) + '" class="btn primary" data-bookmarklet style="display:inline-flex">' + ico("cursor", "xs") + "태그 캡처</a>" +
        "</p>" +
        '<ol class="hint" style="padding-left:18px; margin:0; display:flex; flex-direction:column; gap:6px">' +
          "<li>실제 사이트를 열고 방금 등록한 즐겨찾기를 클릭 — 화면 오른쪽 위에 캡처 중 표시가 뜹니다.</li>" +
          "<li>확인하고 싶은 만큼 클릭·이동해 보세요.</li>" +
          "<li>즐겨찾기를 다시 클릭 — 캡처가 끝나며 .har 파일이 자동으로 저장됩니다.</li>" +
          '<li>여기로 돌아와 <b>"HAR 파일 가져오기"</b>로 그 파일을 선택하세요.</li>' +
        "</ol>" +
        '<p class="hint" style="margin:10px 0 0">완전히 다른 페이지로 새로고침하면 캡처가 초기화됩니다 — 화면 이동 없이 내용만 바뀌는 사이트(이번 사이트처럼)에서 잘 맞습니다.</p>' +
      "</div>" +
      '<div class="modal-foot"><div class="spacer"></div><button class="btn" data-x>닫기</button></div>' +
    "</div></div>";
  root.addEventListener("click", e => {
    if (e.target.closest("[data-bookmarklet]")) { e.preventDefault(); return toast("클릭 말고 즐겨찾기 막대로 드래그해 주세요", "bad"); }
    if (e.target.closest("[data-x]") || e.target.classList.contains("scrim")) closeModal();
  });
}
function pickHarFile() {
  const n = curNode();
  const url = liveIframeUrl() || (n ? n.webUrl : browseUrl);
  const inp = $("#harPick"); inp.value = "";
  inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) importHarFile(f, url); };
  inp.click();
}
async function importHarFile(file, url) {
  detectedTagsLoading = true; detectedTags = null; detectedTagsUrl = url || null;
  renderStage(); renderPanels();
  stageBusy("HAR 파일을 읽는 중…");
  try {
    const text = await file.text();
    let har;
    try { har = JSON.parse(text); } catch (e) { throw new Error("HAR 파일을 읽지 못했습니다(JSON 형식이 아님)"); }
    const rawEntries = har && har.log && Array.isArray(har.log.entries) ? har.log.entries : null;
    if (!rawEntries) throw new Error("올바른 HAR 파일이 아닙니다");
    /* 응답 본문·헤더·타이밍 등은 필요 없다 — 업체 판단에 쓰는 url·method·요청
       본문만 추려서 올린다(이미지 등까지 실린 원본 HAR은 훨씬 크다). */
    const entries = rawEntries.map(e => ({
      url: e && e.request && e.request.url,
      method: e && e.request && e.request.method,
      postData: e && e.request && e.request.postData ? e.request.postData.text : null
    })).filter(e => e.url);
    if (!entries.length) throw new Error("HAR 안에 요청이 없습니다");
    const token = await ensureToken().catch(() => null);
    const h = Object.assign({ "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {});
    const apiUrl = "/api/import-har" + (url ? "?url=" + encodeURIComponent(url) : "");
    const r = await fetch(apiUrl, { method: "POST", headers: h, body: JSON.stringify({ entries }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ("서버 응답 " + r.status));
    detectedTags = j; detectedTagsUrl = url || null;
    const found = Object.keys(j).filter(k => j[k] && j[k].detected).map(k => PLAT[k] ? PLAT[k].name : k);
    toast(found.length ? "가져옴(" + entries.length + "개 요청) · 감지됨 " + found.join(", ") : "이 HAR에서 Amplitude·Braze·GA4 요청을 찾지 못했습니다", found.length ? "ok" : "bad");
    console.groupCollapsed("[HAR 가져오기] 원본 샘플 (문제 있으면 이걸 복사해서 알려주세요)");
    console.log(j);
    console.groupEnd();
  } catch (e) {
    detectedTags = null; detectedTagsUrl = null;
    toast("HAR 가져오기에 실패했습니다: " + ((e && e.message) || "알 수 없는 오류"), "bad");
  } finally {
    detectedTagsLoading = false;
    renderStage(); renderPanels();
  }
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
/* 지금 이 브라우저 탭에 실제로 그려져 있는 화면을 그대로 찍는다 — 화면 공유
   API(getDisplayMedia)는 동일 출처 정책과 무관하게 "사람 눈에 보이는 픽셀"을
   그대로 가져오므로, 다른 도메인 iframe 안에서 링크를 눌러 어디로 이동했든
   지금 보이는 그 화면 그대로 캡처된다 — 서버 왕복도 필요 없다.

   전에는 화면 위의 좌표를 계산해서 웹페이지 영역만 잘라냈는데, 이 계산이
   레이아웃이 조금만 밀려도 어긋나서 옆의 툴바·상태줄까지 같이 잘리곤 했다.
   이제는 아예 스테이지 영역을 브라우저 전체화면으로 띄운다 — 그러면 화면에
   보이는 게 웹페이지뿐이라 계산해서 잘라낼 필요 자체가 없어진다(찍은 화면
   전체가 곧 웹페이지다).

   전에는 아래쪽 내용까지 담으려고 iframe을 화면 높이의 몇 배로 늘려 한 번에
   더 그리게 한 뒤 스크롤하며 이어 붙였는데, 이건 실제 스크롤이 아니라
   "그냥 더 크게 그리기"라서 스크롤 시점에만 나타나는 스티키 내비게이션 같은
   요소가 중간에 원래 자리 그대로 나타나 "헤더가 또 나온다" 같은 어색한
   이음매가 생겼다. 그래서 지금은 화면에 보이는 딱 한 구간만, 깔끔하게 찍는다. */
const CAPTURE_WIDTH = 1400;    // 전체화면 폭 그대로 찍으면 내용이 작게 나와서, 이 폭으로 좁혀 그만큼 크게(확대) 담는다
async function captureVisibleTab() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) return null;
  const scroller = $("#stageScroll"), doc = $("#stageDoc");
  if (!scroller || !doc) return null;
  let stream = null, video = null, wentFullscreen = false;
  const savedDocWidth = doc.style.width;
  const savedDocMargin = doc.style.margin;
  try {
    /* getDisplayMedia는 사용자 클릭에 바짝 붙어 있어야 브라우저가 허용하므로
       전체화면 전환보다 먼저 요청한다 — 스트림은 전체화면으로 바뀐 뒤에도
       같은 탭을 계속 비추므로 다시 요청할 필요가 없다 */
    stream = await navigator.mediaDevices.getDisplayMedia({
      /* 해상도를 안 정하면 브라우저가 화면보다 낮은 화질로 캡처해서 흐릿하게
         나온다 — 화면 실제 배율(레티나 등 devicePixelRatio)만큼 높게 요청해서
         가능한 한 원본 화질에 가깝게 받는다 */
      video: {
        displaySurface: "browser",
        width: { ideal: Math.round(window.screen.width * (window.devicePixelRatio || 1)) },
        height: { ideal: Math.round(window.screen.height * (window.devicePixelRatio || 1)) },
        frameRate: { ideal: 5, max: 10 }
      },
      preferCurrentTab: true,
      selfBrowserSurface: "include",
      audio: false
    });
    if (scroller.requestFullscreen) {
      try { await scroller.requestFullscreen(); wentFullscreen = true; } catch (e) { /* 막히면 지금 크기 그대로 찍는다 */ }
    }
    /* 화면 전체 폭 그대로 찍으면 내용이 작아 보이니, 가운데에 딱 CAPTURE_WIDTH만큼만
       두고 그 안에서만 페이지를 그리게 한다 — 양옆 남는 부분은 잘라내고 안 쓴다 */
    if (wentFullscreen) { doc.style.width = CAPTURE_WIDTH + "px"; doc.style.margin = "0 auto"; }
    await new Promise(r => setTimeout(r, wentFullscreen ? 500 : 100));   // 전체화면 전환·리플로우 시간

    video = document.createElement("video");
    video.srcObject = stream; video.muted = true;
    await video.play();
    await new Promise(r => requestAnimationFrame(r));      // 첫 프레임이 실제로 그려질 때까지 한 틱 대기
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;

    /* 가운데로 좁혀 둔 영역이 화면 위 어디에 실제로 그려졌는지 재서(가운데 정렬
       계산을 직접 하지 않고 실측한다 — margin:auto 값을 브라우저가 어떻게
       반올림하는지까지 정확히 맞추기 위해), 캡처 해상도 기준 좌표로 바꾼다 */
    let cropX = 0, cropW = vw;
    if (wentFullscreen && scroller.clientWidth > 0) {
      const r = doc.getBoundingClientRect(), scaleX = vw / scroller.clientWidth;
      cropX = Math.max(0, Math.round(r.left * scaleX));
      cropW = Math.max(1, Math.min(vw - cropX, Math.round(r.width * scaleX)));
    }
    const canvas = document.createElement("canvas");
    canvas.width = cropW; canvas.height = vh;
    canvas.getContext("2d").drawImage(video, cropX, 0, cropW, vh, 0, 0, cropW, vh);
    /* PNG(무손실)는 사진·배너가 섞인 페이지에서 용량이 훨씬 커진다 — JPEG를
       쓰되 화질을 높여(0.95) setShot()에서 한 번 더 압축돼도 티가 덜 나게 한다 */
    return await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.95));
  } catch (e) {
    return null;                 // 사용자가 공유를 취소했거나, 브라우저가 지원하지 않는다
  } finally {
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (video) { video.srcObject = null; video.remove(); }
    doc.style.width = savedDocWidth;
    doc.style.margin = savedDocMargin;
    if (wentFullscreen && document.fullscreenElement) { try { await document.exitFullscreen(); } catch (e) {} }
  }
}
/* 스테이지 아래쪽 안내줄을 잠깐 "무엇을 하는 중"으로 바꿔서 진행 상태를 보여준다 —
   토스트 하나로는 여러 단계(캡처 → 카드 생성)가 이어질 때 잘 안 보이기 때문 */
function stageBusy(msg) {
  const foot = $("#stageFoot");
  if (!foot) return;
  foot.innerHTML = '<span style="color:var(--accent); font-size:11.5px; font-weight:600; display:inline-flex; align-items:center; gap:5px">' +
    ico("loop", "xs spin") + esc(msg) + "</span>";
}
async function captureCurrentWeb(url) {
  /* getDisplayMedia로 화면을 찍는 동안은 상태 문구를 띄우지 않는다 — #stageFoot에
     글자를 넣으면 줄 수가 바뀌면서 레이아웃이 미세하게 밀리거나, 그 문구 자체가
     찍힌 화면 안에 그대로 나와 버린다. 공유 승인 창(브라우저 자체 UI)이 뜨는 것만으로
     충분히 "지금 뭔가 하고 있다"는 게 보인다. */
  let blob = await captureVisibleTab();
  if (!blob) { stageBusy("화면을 서버로 캡처하는 중…"); blob = await captureScreenshot(url); }
  if (!blob) { stageBusy("클립보드 이미지를 확인하는 중…"); blob = await captureClipboardImage(); }
  return blob;
}
/* 추가하기 — 지금 웹 정보로 완전히 새 페이지 카드를 만든다. 지금 보고 있는
   카드는 건드리지 않고 그대로 웹 모드에 남아 있어, 링크를 계속 따라가며
   여러 카드를 잇달아 만들 수 있다. */
async function addNewWebPage() {
  const n = curNode();
  const url = liveIframeUrl() || (n ? n.webUrl : browseUrl);
  if (!url) return toast("먼저 주소를 입력하고 이동해 주세요", "bad");
  const blob = await captureCurrentWeb(url);
  stageBusy("페이지 카드를 만드는 중…");
  const created = addNodeInBoard(B(), nameFromUrl(url), urlPath(url));
  created.webUrl = url;
  if (blob) { try { await setShot(blob, created, true); } catch (e) { /* 이미지 없이 진행 */ } }
  markDirty(); renderFlow(); renderPanels();
  $("#stageFoot").innerHTML = webHintHtml(n
    ? "웹 모드 — 페이지의 링크를 눌러 그대로 이동할 수 있습니다."
    : "페이지 카드 없이 주소부터 둘러볼 수 있습니다 — 추가하기를 누르면 지금 화면으로 새 카드가 만들어집니다.");
  toast("새 페이지를 추가했습니다 · " + created.name + (blob ? " · 이미지 포함" : " · 화면은 못 찍었습니다 (" + (lastScreenshotError || "알 수 없는 오류") + ")"), blob ? "ok" : "bad");
}
/* 수정하기 — 지금 선택돼 있는(현재 스테이지에 열려 있는) 카드를 지금 웹
   정보로 덮어쓴다. 새로 만들지 않고 항상 curNode() 하나만 대상으로 한다. */
async function updateCurWebPage() {
  const n = curNode();
  if (!n) return;                                    // 수정할 카드가 없으면(버튼도 숨겨져 있다) 아무 것도 하지 않는다
  const url = liveIframeUrl() || n.webUrl;
  if (!url) return toast("먼저 주소를 입력하고 이동해 주세요", "bad");
  const blob = await captureCurrentWeb(url);
  stageBusy("카드 정보를 수정하는 중…");
  n.path = urlPath(url);
  n.name = nameFromUrl(url);
  if (blob) { try { await setShot(blob, n, true); } catch (e) { /* 이미지 없이 진행 */ } }
  markDirty(); renderFlow(); renderStage(); renderPanels();
  toast("이 페이지 정보를 수정했습니다" + (blob ? " · 이미지 포함" : " · 화면은 못 찍었습니다 (" + (lastScreenshotError || "알 수 없는 오류") + ")"), blob ? "ok" : "bad");
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
    const b = e.target.closest("[data-mode]");
    if (!b || !canEdit()) return;
    const n = curNode();
    if (n) { n.viewMode = b.dataset.mode; markDirty(); } else { browseMode = b.dataset.mode; }
    renderStage();
  });
  $("#webGo").addEventListener("click", () => { if (canEdit()) loadWebUrl(curNode(), $("#webUrlIn").value); });
  $("#webUrlIn").addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    if (canEdit()) loadWebUrl(curNode(), e.target.value);
  });
  $("#webAddNew").addEventListener("click", () => { if (canEdit()) addNewWebPage(); });
  $("#webEditCur").addEventListener("click", () => { if (canEdit()) updateCurWebPage(); });
  $("#webCheckTags").addEventListener("click", () => { if (!detectedTagsLoading) checkPageTags(); });
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
