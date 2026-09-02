
/* ========================================================================
   좌: CRM 캠페인 · 우: 태깅 설정 · 목록 뷰(모든 보드 통합)
   ======================================================================== */
const viewStale = { tags: true, camps: true, perf: true };
function invalidateViews() { viewStale.tags = true; viewStale.camps = true; viewStale.perf = true; }

function platChip(p) { return '<span class="chip" style="--c:' + PLAT[p].c + '">' + ico(PLAT[p].ico, "xs") + PLAT[p].name + "</span>"; }
/* 태그는 이제 플랫폼을 여러 개 체크할 수 있다. 예전 문서(단일 t.platform)도
   배열로 감싸 그대로 보여준다. */
function platformsOf(t) {
  if (t.platforms && t.platforms.length) return t.platforms;
  return t.platform ? [t.platform] : [];
}
function platChips(codes) { return (codes || []).map(platChip).join(""); }
function platformsToStr(codes) { return (codes || []).map(c => (PLAT[c] || {}).name || c).join(", "); }
function platformsFromStr(s) { return String(s || "").split(",").map(x => keyByLabel(PLAT, x, null)).filter(Boolean); }
function chanChip(c) { const h = CHAN[c] || CHAN.push; return '<span class="chip" style="--c:' + h.c + '">' + ico(h.ico, "xs") + h.name + "</span>"; }
function acts(kind, id) {
  return '<div class="card-acts edit-only"><button class="btn icon sm" data-' + kind + '-edit="' + id + '" title="수정">' + ico("edit", "xs") +
    '</button><button class="btn icon sm danger" data-' + kind + '-del="' + id + '" title="삭제">' + ico("trash", "xs") + "</button></div>";
}
function campLinkButtons(c) {
  const links = (c.links || []).filter(l => l.url);
  if (!links.length) return "";
  return '<div class="rowseg">' + links.map((l, i) =>
    '<button class="btn sm" data-goto-url="' + esc(l.url) + '" type="button" title="' + esc(l.url) + '">' +
      ico("link", "xs") + esc(l.label || "바로가기 " + (i + 1)) + "</button>").join("") + "</div>";
}
/* ---------------- 태그 표시 헬퍼 (이벤트명·영역은 신규 필드로, 예전 문서 호환을 위해 옛 필드로 폴백) ---------------- */
function tagEventEn(t) { return t.eventEn != null && t.eventEn !== "" ? t.eventEn : (t.event || ""); }
function tagArea(t) { return t.area != null && t.area !== "" ? t.area : (t.selector || ""); }
function tchanChips(codes) {
  return (codes || []).map(c => '<span class="chip" style="--c:var(--ink-3)">' + esc(TCHAN[c] || c) + "</span>").join("");
}
/* 각 속성 줄을 고정된 5개 칸(공통배지·한글명·영문key·타입·샘플)으로 렌더링한다 —
   값이 없어도 빈 칸을 그대로 두어야 grid 칼럼이 줄마다 어긋나지 않고 표처럼 정렬된다. */
function propLines(props) {
  if (!props || !props.length) return "";
  return '<div class="proplines">' + props.map(p =>
    '<div class="propline">' +
      '<span class="pcommon">' + (p.common ? '<span class="chip" style="--c:var(--camp)">공통</span>' : "") + "</span>" +
      '<span class="pko">' + esc(p.ko || "") + "</span>" +
      '<span class="pen mono">' + esc(p.en || "") + "</span>" +
      '<span class="ptype">' + esc(PTYPE[p.type] || p.type || "") + "</span>" +
      '<span class="psample mono">' + esc(p.sample || "") + "</span>" +
    "</div>").join("") + "</div>";
}
function sampleRowsOf(t) { return Object.entries(TSAMPLE_KEYS).filter(([k]) => t[k]); }
/* 태깅 설정(우측 패널) 카드 안에서는 접혔다 펼쳐지는 아코디언 + 한 줄에 하나씩 쌓아서 보여준다 */
function sampleAccordion(t) {
  const rows = sampleRowsOf(t);
  if (!rows.length) return "";
  return '<details class="tsamp"><summary>테스트 샘플 보기 (' + rows.length + ")</summary>" +
    rows.map(([k, label]) => '<div class="tsamp-row"><span class="tsamp-k">' + esc(label) + '</span><pre class="mono">' + esc(t[k]) + "</pre></div>").join("") +
  "</details>";
}
/* 태그 목록(전체 표)에서는 4개 채널을 항상 나란히 두되, 채널마다 따로 접었다 펼 수 있게 한다 —
   값이 있는 채널은 그대로 보여주고, 없는 채널은 빨간 라벨로 눈에 띄게 표시한다. */
let expandedSamples = new Set();
function sampleChannelsBlock(t) {
  return '<div class="tsamp-chset">' + Object.entries(TSAMPLE_KEYS).map(([k, label]) => {
    const has = !!t[k], key = t.id + "::" + k, open = expandedSamples.has(key);
    return '<div class="tsamp-ch' + (open ? " open" : "") + (has ? "" : " tsamp-empty") + '">' +
      '<button type="button" class="tsamp-chhead" data-samp-toggle="' + key + '">' +
        '<span class="tsamp-caret">▸</span><span class="tsamp-chlabel">' + esc(label) + "</span>" +
      "</button>" +
      (open ? '<div class="tsamp-chbody"><pre class="mono">' + esc(has ? t[k] : "(비어 있음)") + "</pre>" +
        (has ? '<button type="button" class="btn sm tsamp-copy" data-samp-copy-value="' + esc(t[k]) + '">' + ico("copy", "xs") + "복사</button>" : "") +
      "</div>" : "") +
    "</div>";
  }).join("") + "</div>";
}
function updateSampleToggleBtn(rows) {
  const btn = $("#btnToggleAllSamples"); if (!btn) return;
  const keys = [];
  rows.forEach(({ t }) => Object.keys(TSAMPLE_KEYS).forEach(k => keys.push(t.id + "::" + k)));
  const allOpen = keys.length > 0 && keys.every(k => expandedSamples.has(k));
  btn.innerHTML = ico(allOpen ? "density" : "grid", "xs") + (allOpen ? "샘플 모두 접기" : "샘플 모두 펼치기");
  btn.disabled = !keys.length;
  btn.dataset.keys = JSON.stringify(keys);
}
/* 공통 속성(문서 전체에서 공유하는 속성)은 태그마다 복사해 저장하지 않고,
   보여줄 때마다 그 태그만의 속성과 합쳐서 계산한다 — 어디서든 공통 속성을
   추가·수정·삭제하면 모든 태그에 즉시 반영되게 하기 위해서다. */
function effectiveProps(t) {
  return (state.commonProps || []).map(p => Object.assign({}, p, { common: true }))
    .concat((t.props || []).map(p => Object.assign({}, p, { common: false })));
}

/* ---------------- 태그/캠페인 CSV 일괄 업로드 · 샘플 양식 ----------------
   기존 CSV 내보내기(btnTagCsv/btnCampCsv)와 같은 컬럼·따옴표 규칙을 써서
   왕복 호환되게 만든다. */
function csvQ(s) { return '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"'; }
function csvLine(arr) { return arr.map(csvQ).join(","); }
function parseCsv(text) {
  text = String(text || "").replace(/^﻿/, "");
  const rows = []; let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r") { /* \n 에서 행을 닫는다 */ }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r[0] || "").trim() !== "");
}
function keyByLabel(map, label, fallback) {
  const s = String(label == null ? "" : label).trim();
  if (!s) return fallback;
  if (map[s]) return s;
  const hit = Object.entries(map).find(([, v]) => (typeof v === "string" ? v : v.name) === s);
  return hit ? hit[0] : fallback;
}
/* 속성 한 줄 = "한글 :: 영문key :: 타입 :: 샘플", 속성 사이는 " | "로 구분한다 */
function serializePropsStr(props) {
  return (props || []).map(p => [p.ko || "", p.en || "", PTYPE[p.type] || p.type || PTYPE.string, p.sample || ""].join(" :: ")).join(" | ");
}
function parsePropsStr(s) {
  /* 항목 끝의 공백은 " :: " 구분자의 일부(샘플이 빈 값일 때)일 수 있어 trim하지 않는다 */
  return String(s || "").split(" | ").filter(x => x.trim()).map(x => {
    const parts = x.split(" :: ").map(v => v.trim());
    return { ko: parts[0] || "", en: parts[1] || "", type: keyByLabel(PTYPE, parts[2], "string"), sample: parts[3] || "" };
  });
}
function channelsToStr(codes) { return (codes || []).map(c => TCHAN[c] || c).join(", "); }
function channelsFromStr(s) {
  return String(s || "").split(",").map(x => keyByLabel(TCHAN, x, null)).filter(Boolean);
}
function resolveBoard(name) {
  const s = String(name || "").trim();
  if (!s) return B();
  return state.boards.find(b => b.name === s) || B();
}
function addNodeInBoard(b, name, path) {
  let maxY = 0, minX = 60;
  b.nodes.forEach(n => { maxY = Math.max(maxY, n.y + (NSZ[n.id] ? NSZ[n.id].h : 150)); minX = Math.min(minX, n.x); });
  const n = {
    id: uid("n"), kind: "page", name: name || "새 페이지", path: path || "", note: "",
    x: Math.round(minX), y: Math.round(b.nodes.length ? maxY + 60 : 90), shot: null, shotData: null, thumb: null,
    shotW: DOC_W, shotH: DOC_H, hue: "none", size: "m", sharp: false, tags: [], camps: [], layers: [],
    viewMode: "shot", webUrl: ""
  };
  b.nodes.push(n);
  return n;
}
function resolveNode(b, name, path) {
  const s = String(name || "").trim() || "새 페이지";
  return b.nodes.find(n => n.name === s) || addNodeInBoard(b, s, path);
}
function readTextFile(file, cb) {
  const fr = new FileReader();
  fr.onload = () => cb(String(fr.result || ""));
  fr.onerror = () => toast("파일을 읽지 못했습니다", "bad");
  fr.readAsText(file);
}
function bulkPreviewModal(opt) {
  const root = modalHost();
  root.innerHTML =
    '<div class="scrim"><div class="modal glass" style="width:min(560px,100%)" role="dialog" aria-modal="true">' +
      '<div class="modal-head">' + ico("up") + "<h3>" + esc(opt.title) + '</h3><button class="btn icon sm" data-x>' + ico("close", "xs") + "</button></div>" +
      '<div class="modal-body">' +
        '<p class="hint">' + opt.rows.length + "개 행을 찾았습니다" + (opt.newPages ? " · 새 페이지 " + opt.newPages + "개가 생성됩니다" : "") + ".</p>" +
        '<div class="bulk">' + opt.rows.slice(0, 60).map(r => '<div class="brow"><div class="fn">' + r + "</div></div>").join("") +
        (opt.rows.length > 60 ? '<div class="bulkbar">외 ' + (opt.rows.length - 60) + "개 더</div>" : "") + "</div>" +
      "</div>" +
      '<div class="modal-foot"><div class="spacer"></div><button class="btn" data-x>취소</button>' +
        '<button class="btn primary" data-run>' + opt.rows.length + "개 가져오기</button></div>" +
    "</div></div>";
  root.addEventListener("click", e => {
    if (e.target.closest("[data-x]") || e.target.classList.contains("scrim")) return closeModal();
    if (e.target.closest("[data-run]")) { closeModal(); opt.onRun(); }
  });
}
const TAG_CSV_HEAD = ["보드", "페이지", "경로", "플랫폼", "이벤트(한글)", "이벤트(영어)", "영역", "트리거", "채널", "동작", "속성", "개발확인", "메모",
  "테스트샘플(web_pc)", "테스트샘플(web_mo)", "테스트샘플(app_aos)", "테스트샘플(app_ios)"];
function tagToCsvRow(t, n, b) {
  return [b.name, n.name, n.path, platformsToStr(platformsOf(t)), t.eventKo || "", tagEventEn(t), tagArea(t),
    TRIGGER[t.trigger] || t.trigger, channelsToStr(t.channels), t.action || "", serializePropsStr(effectiveProps(t)), TSTATUS[t.status], t.note,
    t.testSampleWebPc || "", t.testSampleWebMo || "", t.testSampleAppAos || "", t.testSampleAppIos || ""];
}
function tagCsvTemplate() {
  const example = [B().name, (B().nodes[0] || {}).name || "홈", "/home", "Amplitude", "홈 화면 노출", "home_viewed", "", "화면 노출",
    "웹 PC, 웹 모바일, 앱 AOS, 앱 iOS", "화면 진입",
    "사용자 유형 :: user_type :: 문자열 :: guest | 배너 ID 목록 :: banner_ids :: 배열 :: ",
    "적용됨", "세션 첫 화면 진입 시 1회",
    '{"user_type":"guest","banner_ids":["b1","b2"]}', "", "", ""];
  saveFile("tag-upload-template.csv", "﻿" + [csvLine(TAG_CSV_HEAD), csvLine(example)].join("\r\n"), "text/csv");
}
function openTagBulkModal(file) {
  readTextFile(file, text => {
    const rows = parseCsv(text);
    const data = rows.slice(1);
    if (!data.length) return toast("CSV에서 데이터 행을 찾지 못했습니다", "bad");
    const parsed = data.map(r => {
      const [boardName, pageName, path, platLabel, eventKo, eventEn, area, triggerLabel, channelsStr, action, propsStr, statusLabel, note,
        webPc, webMo, appAos, appIos] = r;
      const platforms = platformsFromStr(platLabel);
      return {
        boardName: boardName || "", pageName: (pageName || "새 페이지").trim(), path: path || "",
        tag: {
          platforms: platforms.length ? platforms : ["amplitude"],
          eventKo: eventKo || "", eventEn: eventEn || "unnamed_event", area: area || "",
          trigger: keyByLabel(TRIGGER, triggerLabel, "custom"), channels: channelsFromStr(channelsStr), action: action || "",
          props: parsePropsStr(propsStr), status: keyByLabel(TSTATUS, statusLabel, "todo"), note: note || "",
          testSampleWebPc: webPc || "", testSampleWebMo: webMo || "", testSampleAppAos: appAos || "", testSampleAppIos: appIos || ""
        }
      };
    });
    let newPages = 0;
    const seen = new Set();
    parsed.forEach(p => {
      const b = resolveBoard(p.boardName), key = b.id + "::" + p.pageName;
      if (!b.nodes.some(n => n.name === p.pageName) && !seen.has(key)) { newPages++; seen.add(key); }
    });
    bulkPreviewModal({
      title: "태그 일괄 업로드", rows: parsed.map(p => esc(p.pageName) + "<em>" + esc(platformsToStr(p.tag.platforms)) + " · " + esc(p.tag.eventEn) + "</em>"),
      newPages,
      onRun: () => {
        parsed.forEach(p => {
          const b = resolveBoard(p.boardName), node = resolveNode(b, p.pageName, p.path);
          node.tags.push(Object.assign({ id: uid("t") }, p.tag));
        });
        markDirty(); renderFlow(); renderPanels(); renderTagView(true);
        toast(parsed.length + "개 태그를 등록했습니다" + (newPages ? " · 새 페이지 " + newPages + "개" : ""), "ok");
      }
    });
  });
}
/* ---------------- 우측: 태깅 ---------------- */
/* 감지된 이벤트의 실제 속성값을 보고 타입을 짐작해, 태그 폼의 속성(props) 칸을
   그대로 채울 수 있는 모양으로 바꾼다 — 한글명은 비워 둬서 사람이 채우게 한다 */
function guessPropType(v) {
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  if (Array.isArray(v)) return "array";
  if (v && typeof v === "object") return "object";
  return "string";
}
function propsFromDetected(properties) {
  return Object.entries(properties || {}).map(([k, v]) => ({
    ko: "", en: k, type: guessPropType(v),
    sample: typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)
  }));
}
/* 웹 모드에서 "태그 확인"을 눌러 서버가 실제로 감지한 Amplitude·Braze·GA4
   요청을 이 페이지에 이미 등록해 둔 태그와 견줘 보여준다 — 이벤트 이름이
   같으면 "등록됨", 아니면 그 이름 그대로 새 태그를 만드는 버튼을 보여준다.
   사이트 구현에 따라 놓칠 수 있는 최선 추정치라는 점을 함께 알려준다. */
function tagDetectionHtml(n) {
  if (!n || n.viewMode !== "web") return "";
  /* 상품 클릭처럼 사용자 동작이 있어야만 나가는 이벤트는 서버가 페이지를
     가만히 열어두기만 해서는 절대 잡히지 않는다 — 가장 확실한 방법은 실제
     브라우저에서 직접 클릭해 보고 그 결과를 DevTools에서 HAR로 내보내
     가져오는 것이다(봇 감지·동의 배너·교차출처·서버 실행시간 제한 어느
     것에도 걸리지 않는다). */
  const harField = '<div class="detectrow">' +
    '<button class="btn sm" type="button" data-har-pick>' + ico("folder", "xs") + "HAR 파일 가져오기</button>" +
    '<span class="hint">실제 브라우저에서 클릭해 본 뒤 DevTools → Network → "Save all as HAR with content"로 내보낸 파일 — 클릭 이벤트까지 정확히 잡힙니다</span>' +
    "</div>";
  if (detectedTagsLoading) {
    return '<div class="tagdetect">' + harField + '<div class="detectrow">' + ico("loop", "xs spin") + "확인하는 중…</div></div>";
  }
  if (!detectedTags || detectedTagsUrl !== n.webUrl) return '<div class="tagdetect">' + harField + "</div>";
  /* "해외패키지"처럼 업무상 익숙한 키워드로, 이미 잡아 둔 이벤트 이름·속성
     이름·속성 값을 한 번에 훑어 관련된 것만 추려 본다 — 새로 요청을 보내지
     않고 지금 결과 안에서만 찾는다. */
  const searchQ = tagSearchText.trim().toLowerCase();
  const matchesSearch = ev => {
    if (!searchQ) return true;
    if (String(ev.name).toLowerCase().indexOf(searchQ) >= 0) return true;
    return Object.entries(ev.properties || {}).some(([k, v]) =>
      k.toLowerCase().indexOf(searchQ) >= 0 || String(v).toLowerCase().indexOf(searchQ) >= 0);
  };
  const searchField = '<div class="detectrow"><span class="webfield" style="flex:1; min-width:160px" title="이미 잡힌 이벤트/속성을 키워드로 찾기">' +
    ico("search", "xs") + '<input class="mono" id="tagSearchIn" placeholder="이벤트·속성 검색 (예: 해외패키지)" value="' + esc(tagSearchText) + '"></span>' +
    '<button class="btn sm" type="button" data-tag-search>탐색</button></div>';
  const rows = Object.keys(PLAT).map(key => {
    const d = detectedTags[key] || { detected: false, events: [] };
    const matchedEvents = d.events.filter(matchesSearch);
    const existingNames = n.tags.filter(t => platformsOf(t).indexOf(key) >= 0)
      .map(t => (tagEventEn(t) || t.eventKo || "").trim().toLowerCase()).filter(Boolean);
    let body;
    if (!d.detected) {
      body = '<span class="chip" style="--c:var(--ink-3)">감지 안 됨</span>';
    } else if (!d.events.length) {
      body = '<span class="chip" style="--c:var(--ink-3)">감지됨 · 이벤트 이름은 추출 못 함</span>';
    } else if (searchQ && !matchedEvents.length) {
      body = '<span class="chip" style="--c:var(--ink-3)">"' + esc(tagSearchText.trim()) + '"과 일치하는 이벤트 없음</span>';
    } else {
      body = matchedEvents.map(ev => {
        const name = ev.name, propCount = Object.keys(ev.properties || {}).length;
        const matched = existingNames.indexOf(String(name).toLowerCase()) >= 0;
        return '<span class="chip" style="--c:' + (matched ? "var(--ok)" : "var(--warn)") + '" title="' +
            (propCount ? esc(Object.keys(ev.properties).join(", ")) : "속성 없음") + '">' +
            ico(matched ? "check" : "alert", "xs") + esc(name) +
            (propCount ? " · 속성 " + propCount + "개" : "") + "</span>" +
          (!matched && canEdit() ? '<button class="btn icon sm" data-detect-add data-detect-plat="' + key + '" data-detect-name="' + esc(name) + '" title="이 이름과 속성 그대로 태그 추가">' + ico("plus", "xs") + "</button>" : "");
      }).join("");
    }
    return '<div class="detectrow">' + platChip(key) + body + "</div>";
  }).join("");
  const raw = showDetectRaw
    ? '<pre class="detectraw">' + esc(JSON.stringify(detectedTags, null, 2)) + "</pre>"
    : "";
  return '<div class="tagdetect">' + harField + '<div class="detecthead">웹에서 확인한 실제 트래킹 <span class="hint">최선 추정치 — 사이트 구현에 따라 놓칠 수 있습니다</span>' +
    '<button class="btn sm" type="button" data-detect-raw style="margin-left:auto">' + (showDetectRaw ? "원본 감추기" : "원본 보기") + "</button></div>" +
    searchField + rows + raw + "</div>";
}
let showDetectRaw = false;
function renderTagPanel() {
  const n = curNode(), box = $("#tagList");
  $("#tagCount").textContent = n ? n.tags.length : 0;
  renderTagJumpSelect();
  const detectHtml = tagDetectionHtml(n);
  if (!n) { box.innerHTML = '<div class="empty">' + ico("tag") + "<div>페이지를 선택하세요</div></div>"; updateToggleAllBtn(n); return; }
  if (!n.tags.length) {
    box.innerHTML = detectHtml + '<div class="empty">' + ico("tag") + "<div>등록된 태그가 없습니다" +
      (canEdit() ? "<br>이 화면에서 발생하는 이벤트를 추가하세요" : "") + "</div></div>";
    updateToggleAllBtn(n);
    return;
  }
  const order = { amplitude: 0, braze: 1, ga4: 2 };
  const minOrder = t => platformsOf(t).reduce((m, p) => Math.min(m, order[p] != null ? order[p] : 99), 99);
  box.innerHTML = detectHtml + n.tags.slice().sort((a, b) => minOrder(a) - minOrder(b)).map(t => {
    const expanded = expandedTags.has(t.id);
    return '<div class="card tagcard' + (expanded ? " expanded" : "") + '" data-tag="' + t.id + '">' +
      '<div class="card-top">' + platChips(platformsOf(t)) +
        '<div class="spacer"></div>' + acts("tag", t.id) + "</div>" +
      '<button type="button" class="tagsummary" data-tag-toggle="' + t.id + '">' +
        '<span class="tagcaret">▸</span>' +
        '<span class="evt">' + esc(t.action || "(태그명 없음)") + "</span>" +
        '<span class="chip" style="--c:var(--ink-3)">' + esc(TRIGGER[t.trigger] || t.trigger) + "</span>" +
      "</button>" +
      (expanded ?
        '<div style="font-size:12.5px">' + (t.eventKo ? "<b>" + esc(t.eventKo) + "</b> " : "") + (tagEventEn(t) ? '<span class="mono" style="font-size:10.5px;color:var(--ink-3)">' + esc(tagEventEn(t)) + "</span>" : "") + "</div>" +
        '<div class="meta stack">' +
          (t.path ? "<span>경로 <span class=\"mono\" style=\"font-size:10.5px\">" + esc(t.path) + "</span></span>" : "") +
          "<span><span class=\"dot\" style=\"--c:" + TSTATUS_C[t.status] + "\"></span> " + TSTATUS[t.status] + "</span>" +
          (tagArea(t) ? "<span>영역 <span class=\"mono\" style=\"font-size:10.5px\">" + esc(tagArea(t)) + "</span></span>" : "") +
        "</div>" +
        (t.channels && t.channels.length ? '<div class="rowseg">' + tchanChips(t.channels) + "</div>" : "") +
        propLines(effectiveProps(t)) +
        (t.note ? '<div class="hint">' + esc(t.note) + "</div>" : "") +
        sampleAccordion(t)
      : "") +
    "</div>";
  }).join("");
  updateToggleAllBtn(n);
}
/* ---------------- 태그 카드 펼침/접힘 · 태그로 바로 이동 ----------------
   펼침 상태는 저장하지 않는 화면 전용 상태라, 문서가 아니라 여기 모듈 전역에 둔다. */
let expandedTags = new Set();
function updateToggleAllBtn(n) {
  const btn = $("#btnToggleAllTags"); if (!btn) return;
  const tags = n ? n.tags : [];
  const allExpanded = tags.length > 0 && tags.every(t => expandedTags.has(t.id));
  btn.innerHTML = ico(allExpanded ? "density" : "grid", "xs") + (allExpanded ? "모두 접기" : "모두 펼치기");
  btn.disabled = !tags.length;
}
function renderTagJumpSelect() {
  const sel = $("#tagJumpSelect"); if (!sel) return;
  const cur = sel.value;
  const all = allTags();
  sel.innerHTML = '<option value="">등록된 태그로 이동…</option>' +
    all.map(({ t, n, b }) => '<option value="' + t.id + '">' + esc(b.name) + " · " + esc(n.name) + " · " + esc(t.action || tagEventEn(t) || "(이름 없음)") + "</option>").join("");
  if (all.some(x => x.t.id === cur)) sel.value = cur; else sel.value = "";
}
function jumpToTag(tagId) {
  const hit = allTags().find(x => x.t.id === tagId); if (!hit) return;
  const boardIdx = state.boards.indexOf(hit.b);
  jumpTo(boardIdx, hit.n.id);
  expandedTags.add(tagId);
  renderPanels();
  requestAnimationFrame(() => {
    const card = document.querySelector('#tagList [data-tag="' + tagId + '"]');
    if (!card) return;
    card.scrollIntoView({ block: "center", behavior: "smooth" });
    card.classList.add("flash"); setTimeout(() => card.classList.remove("flash"), 1400);
  });
}

/* ---------------- 좌측: 캠페인 ----------------
   목록의 원본은 구글 시트다. 문서에는 "이 페이지에 이 캠페인코드를 붙였다"만 남고,
   이름·채널·상태 같은 표시 내용은 매번 시트에서 채워 넣는다(campView). */
function campActs(c) {
  const del = '<button class="btn icon sm" data-camp-del="' + c.id + '" title="이 페이지에서 떼기">' + ico("close", "xs") + "</button>";
  const edit = c.code && !c.missing
    ? '<button class="btn icon sm staff-only" data-sheet-edit="' + esc(c.code) + '" title="수정">' + ico("edit", "xs") + "</button>"
    : (c.code ? "" : '<button class="btn icon sm" data-camp-edit="' + c.id + '" title="수정">' + ico("edit", "xs") + "</button>");
  return '<div class="card-acts edit-only">' + edit + del + "</div>";
}
function renderCampPanel() {
  const n = curNode(), box = $("#campList");
  $("#campCount").textContent = n ? n.camps.length : 0;
  if (!n) { box.innerHTML = '<div class="empty">' + ico("mega") + "<div>페이지를 선택하세요</div></div>"; return; }
  const L = (n.layers || []).find(x => x.id === sel.layer);
  const list = campViews(n);
  box.innerHTML = (list.length ? list.map(c => {
    const linked = (n.layers || []).filter(l => l.campId === c.id);
    return '<div class="card' + (L && L.campId === c.id ? " pinned" : "") + '" data-camp="' + c.id + '">' +
      '<div class="card-top">' + chanChip(c.chan) + '<div class="spacer"></div>' + campActs(c) + "</div>" +
      '<div class="card-title">' + esc(c.name) + "</div>" +
      (c.code ? '<div class="kv"><span>' + esc(c.code) + "</span></div>" : "") +
      perfBadge(c.code) +
      '<div class="meta"><span><span class="dot" style="--c:' + CSTATUS_C[c.status] + '"></span> ' + CSTATUS[c.status] + "</span>" +
        (c.segment ? "<span>트리거 <b>" + esc(c.segment) + "</b></span>" : "") +
        (c.timing ? "<span>전환 <b>" + esc(c.timing) + "</b></span>" : "") + "</div>" +
      (c.landing ? '<div class="kv"><span>' + esc(c.landing) + "</span></div>" : "") +
      campLinkButtons(c) +
      (c.note ? '<div class="hint">' + esc(c.note) + "</div>" : "") +
      (c.missing ? '<div class="hint" style="color:var(--warn)">시트에서 삭제된 캠페인입니다. 떼어 내세요.</div>' : "") +
      (linked.length ? '<div class="linkline">' + ico("pin", "xs") + "화면 레이어 " + linked.length + "곳에 배치됨</div>" : "") +
      (L && canEdit() ? '<button class="btn sm edit-only" data-link="' + c.id + '" style="align-self:flex-start">' +
        ico(L.campId === c.id ? "check" : "pin", "xs") + (L.campId === c.id ? "연결됨 · 해제" : "선택한 레이어에 연결") + "</button>" : "") +
    "</div>";
  }).join("") : '<div class="empty">' + ico("mega") + "<div>이 화면에 붙는 CRM 캠페인이 없습니다" +
    (canEdit() ? "<br><b>붙이기</b>로 구글 시트 목록에서 고르세요" : "") + "</div></div>");

  const foot = $("#layerLinkFoot");
  if (L) {
    const c = list.find(x => x.id === L.campId);
    foot.style.display = "";
    foot.innerHTML = '<div class="frow"><span class="lbl">선택한 레이어</span>' +
      '<div class="meta">' + LKIND(L) + (c ? " → <b>" + esc(c.name) + "</b>" : " → 연결된 캠페인 없음") + "</div></div>";
  } else { foot.style.display = "none"; foot.innerHTML = ""; }
}
function renderPanels() { renderTagPanel(); renderCampPanel(); }

/* ---------------- CRUD ---------------- */
function editTag(id, prefill) {
  const n = curNode(); if (!n || !canEdit()) return;
  const t = id ? n.tags.find(x => x.id === id) : Object.assign({
    platforms: ["amplitude"], path: "", eventKo: "", eventEn: "",
    area: "", trigger: "click", channels: [], action: "", props: [], status: "todo", note: "",
    testSampleWebPc: "", testSampleWebMo: "", testSampleAppAos: "", testSampleAppIos: ""
  }, prefill || {});
  const values = Object.assign({}, t, {
    eventEn: tagEventEn(t), area: tagArea(t), platforms: platformsOf(t),
    path: t.path || n.path || "",           // 경로는 기본적으로 페이지에 지정된 경로를 그대로 따른다
    props: effectiveProps(t)                // 문서 전체 공통 속성 + 이 태그만의 속성을 함께 보여준다
  });
  openForm({
    title: id ? "태그 수정" : "태그 추가", icon: "tag",
    note: "Amplitude · Braze · GA4에 실제로 심어진 이벤트 정의를 그대로 적어 두면 QA 때 이 화면이 기준이 됩니다. " +
      "속성 행의 '공통' 체크는 문서 전체 태그가 함께 쓰는 속성입니다 — 값을 바꾸거나 체크를 지우면 모든 태그에 똑같이 반영됩니다.",
    fields: [
      { k: "platforms", label: "플랫폼", type: "multi", opts: PLAT },
      { k: "area", label: "영역", mono: true, ph: "#btn-cart" },
      { k: "path", label: "경로", mono: true, ph: "/home" },
      { k: "eventKo", label: "이벤트명(한글)", ph: "장바구니 담기 클릭" },
      { k: "eventEn", label: "이벤트명(영어)", mono: true, ph: "add_to_cart_clicked" },
      { k: "action", label: "태그명", ph: "버튼 클릭" },
      { k: "trigger", label: "트리거", type: "select", opts: TRIGGER },
      { k: "channels", label: "채널", type: "multi", opts: TCHAN },
      { k: "props", label: "속성", type: "kv" },
      { k: "status", label: "개발확인", type: "select", opts: TSTATUS },
      { k: "note", label: "메모", type: "textarea" },
      { type: "group", label: "테스트 샘플 (web_pc · web_mo · app_aos · app_ios)", fields: [
        { k: "testSampleWebPc", label: "web_pc", type: "textarea", mono: true, ph: '{"user_type":"guest"}' },
        { k: "testSampleWebMo", label: "web_mo", type: "textarea", mono: true, ph: '{"user_type":"guest"}' },
        { k: "testSampleAppAos", label: "app_aos", type: "textarea", mono: true, ph: '{"user_type":"guest"}' },
        { k: "testSampleAppIos", label: "app_ios", type: "textarea", mono: true, ph: '{"user_type":"guest"}' }
      ] }
    ],
    values,
    onSave: v => {
      /* 샘플이 비어 있는 속성은 저장 시점에 테스트 샘플에서 자동으로 채운다(반자동) —
         이미 값이 있는 속성은 그대로 둔다. */
      const samples = [v.testSampleWebPc, v.testSampleWebMo, v.testSampleAppAos, v.testSampleAppIos];
      (v.props || []).forEach(p => {
        if (!p.sample && p.en) { const found = findValueInSamples(samples, p.en); if (found !== undefined) p.sample = found; }
      });
      const commonProps = [], specificProps = [];
      (v.props || []).forEach(p => {
        const clean = { ko: p.ko, en: p.en, type: p.type, sample: p.sample };
        (p.common ? commonProps : specificProps).push(clean);
      });
      state.commonProps = commonProps;
      const rec = Object.assign({}, t, v, {
        eventEn: v.eventEn || "unnamed_event", platforms: v.platforms && v.platforms.length ? v.platforms : ["amplitude"],
        props: specificProps
      });
      if (id) Object.assign(t, rec); else { rec.id = uid("t"); n.tags.push(rec); }
      markDirty(); renderFlow(); renderPanels(); renderTagView(true);
    },
    onDelete: id ? () => confirmDel("태그 " + tagEventEn(t) + " 를 삭제할까요?", () => {
      n.tags = n.tags.filter(x => x.id !== id); markDirty(); renderFlow(); renderPanels(); renderTagView(true);
    }) : null
  });
}
function editCamp(id) {
  const n = curNode(); if (!n || !canEdit()) return;
  const c = id ? n.camps.find(x => x.id === id) : { name: "", chan: "push", cat1: "", cat2: "", segment: "", timing: "", status: "draft", extId: "", landing: "", note: "", links: [] };
  const values = Object.assign({}, c, { links: c.links && c.links.length ? c.links : [{ label: "", url: "" }, { label: "", url: "" }] });
  openForm({
    title: id ? "캠페인 수정" : "캠페인 추가", icon: "mega",
    note: "이 화면에 노출되거나 이 화면으로 유입시키는 CRM 캠페인을 등록합니다.",
    fields: [
      { k: "name", label: "캠페인명", ph: "장바구니 이탈 리마인드" },
      { k: "chan", label: "채널", type: "select", opts: CHAN },
      { k: "cat1", label: "대분류", ph: "리텐션" },
      { k: "cat2", label: "소분류", ph: "장바구니 이탈" },
      { k: "segment", label: "대상 세그먼트", ph: "Cart Updated 후 4시간 미결제" },
      { k: "timing", label: "발송 타이밍", ph: "4시간 지연 발송" },
      { k: "status", label: "상태", type: "select", opts: CSTATUS },
      { k: "extId", label: "캠페인 ID", mono: true, ph: "BRZ-PUSH-2871" },
      { k: "landing", label: "랜딩 · 딥링크", mono: true, ph: "/cart" },
      { k: "links", label: "관련 링크", type: "links" },
      { k: "note", label: "메모", type: "textarea" }
    ],
    values,
    onSave: v => {
      const rec = Object.assign({}, c, v, { name: v.name || "이름 없는 캠페인" });
      if (id) Object.assign(c, rec); else { rec.id = uid("c"); n.camps.push(rec); }
      markDirty(); renderFlow(); renderPanels(); renderCampView(true);
    },
    onDelete: id ? () => confirmDel("캠페인 " + c.name + " 을 삭제할까요?", () => {
      n.camps = n.camps.filter(x => x.id !== id);
      (n.layers || []).forEach(l => { if (l.campId === id) l.campId = null; });
      markDirty(); renderFlow(); renderStage(); renderPanels(); renderCampView(true);
    }) : null
  });
}
function initPanels() {
  $("#btnAddTag").addEventListener("click", () => editTag(null));
  $("#btnAddCamp").addEventListener("click", () => openCampPicker());
  $("#btnToggleAllTags").addEventListener("click", () => {
    const n = curNode(); if (!n || !n.tags.length) return;
    const allExpanded = n.tags.every(t => expandedTags.has(t.id));
    n.tags.forEach(t => { if (allExpanded) expandedTags.delete(t.id); else expandedTags.add(t.id); });
    renderTagPanel();
  });
  $("#tagJumpSelect").addEventListener("change", e => {
    const id = e.target.value; if (id) jumpToTag(id);
  });
  $("#tagList").addEventListener("input", e => {
    if (e.target.id === "tagSearchIn") tagSearchText = e.target.value;   // "탐색" 눌러야 실제로 걸러진다
  });
  $("#tagList").addEventListener("keydown", e => {
    if (e.target.id === "tagSearchIn" && e.key === "Enter") { e.preventDefault(); renderTagPanel(); }
  });
  $("#tagList").addEventListener("click", e => {
    if (e.target.closest("[data-har-pick]")) return pickHarFile();
    if (e.target.closest("[data-tag-search]")) return renderTagPanel();
    if (e.target.closest("[data-detect-raw]")) { showDetectRaw = !showDetectRaw; return renderTagPanel(); }
    const da = e.target.closest("[data-detect-add]");
    if (da) {
      const key = da.dataset.detectPlat, name = da.dataset.detectName;
      const ev = detectedTags && detectedTags[key] && (detectedTags[key].events || []).find(x => x.name === name);
      const props = propsFromDetected(ev && ev.properties);
      return editTag(null, { platforms: [key], eventEn: name, props });
    }
    const ed = e.target.closest("[data-tag-edit]"), dl = e.target.closest("[data-tag-del]"), tg = e.target.closest("[data-tag-toggle]");
    if (ed) return editTag(ed.dataset.tagEdit);
    if (tg) {
      const id = tg.dataset.tagToggle;
      if (expandedTags.has(id)) expandedTags.delete(id); else expandedTags.add(id);
      return renderTagPanel();
    }
    if (dl && canEdit()) {
      const n = curNode(), t = n.tags.find(x => x.id === dl.dataset.tagDel);
      return confirmDel("태그 " + tagEventEn(t) + " 를 삭제할까요?", () => {
        n.tags = n.tags.filter(x => x.id !== t.id); markDirty(); renderFlow(); renderPanels(); renderTagView(true);
      });
    }
  });
  $("#campList").addEventListener("click", e => {
    const ed = e.target.closest("[data-camp-edit]"), dl = e.target.closest("[data-camp-del]"), lk = e.target.closest("[data-link]");
    const go = e.target.closest("[data-goto-url]");
    if (go) return openUrl(go.dataset.gotoUrl);
    if (ed) return editCamp(ed.dataset.campEdit);
    if (dl && canEdit()) {
      /* 시트의 캠페인 자체를 지우는 것이 아니라, 이 페이지에서 떼어 내기만 한다.
         캠페인 삭제는 앱에서 할 수 없다 — 그만 쓰는 캠페인은 시트에서 상태를 '중단'으로 바꾼다. */
      const n = curNode(), raw = n.camps.find(x => x.id === dl.dataset.campDel);
      if (!raw) return;
      const c = campView(raw);
      return confirmDel("캠페인 " + c.name + " 을(를) 이 페이지에서 뗄까요?\n캠페인 자체는 구글 시트에 그대로 남습니다.", () => {
        n.camps = n.camps.filter(x => x.id !== raw.id);
        (n.layers || []).forEach(l => { if (l.campId === raw.id) l.campId = null; });
        markDirty(); renderFlow(); renderStage(); renderPanels(); renderCampView(true);
      });
    }
    if (lk && canEdit()) {
      const n = curNode(), L = n.layers.find(x => x.id === sel.layer); if (!L) return;
      L.campId = L.campId === lk.dataset.link ? null : lk.dataset.link;
      markDirty(); renderStage(); renderPanels(); renderFlow();
    }
  });
}

/* ---------------- 태그 목록 뷰 ---------------- */
const tagFilter = { p: "all", board: "all", node: "all", status: "all", q: "", hideCommon: false };
/* 공통 속성 숨기기 필터가 켜져 있으면 속성 목록에서 공통 속성을 뺀다 */
function displayProps(t) {
  const props = effectiveProps(t);
  return tagFilter.hideCommon ? props.filter(p => !p.common) : props;
}
function boardOptions(cur) {
  return '<option value="all">모든 보드</option>' +
    state.boards.map((b, i) => '<option value="' + i + '"' + (String(cur) === String(i) ? " selected" : "") + ">" + esc(b.name) + "</option>").join("");
}
function jumpTo(boardIdx, nodeId) {
  if (boardIdx !== state.bi) switchBoard(boardIdx);
  selectNode(nodeId); switchView("map"); fitNodeIntoView(nodeId);
}
function fitNodeIntoView(nodeId) {
  const n = nodeById(nodeId); if (!n) return;
  const r = $("#flowSurface").getBoundingClientRect(), v = B().view, q = nodeRect(n);
  v.panX = r.width / 2 - (q.x + q.w / 2) * v.zoom;
  v.panY = r.height / 2 - (q.y + q.h / 2) * v.zoom;
  applyTransform();
}
function renderTagView(force) {
  if (!force && !viewStale.tags) return;
  viewStale.tags = false;
  const nodeSel = $("#tagNodeFilter"), boardSel = $("#tagBoardFilter");
  boardSel.innerHTML = boardOptions(tagFilter.board);
  const pool = tagFilter.board === "all" ? state.boards : [state.boards[+tagFilter.board]];
  const keep = tagFilter.node;
  const nodes = pool.reduce((a, b) => a.concat(b ? b.nodes : []), []);
  nodeSel.innerHTML = '<option value="all">모든 페이지</option>' + nodes.map(n => '<option value="' + n.id + '">' + esc(n.name) + "</option>").join("");
  nodeSel.value = nodes.some(n => n.id === keep) ? keep : "all";
  if (nodeSel.value === "all") tagFilter.node = "all";

  const all = allTags();
  const rows = all.filter(({ t, n, b }) =>
    (tagFilter.p === "all" || platformsOf(t).indexOf(tagFilter.p) >= 0) &&
    (tagFilter.board === "all" || state.boards[+tagFilter.board] === b) &&
    (tagFilter.node === "all" || n.id === tagFilter.node) &&
    (tagFilter.status === "all" || t.status === tagFilter.status) &&
    (!tagFilter.q || (tagEventEn(t) + " " + (t.eventKo || "") + " " + tagArea(t) + " " + (t.action || "") + " " + t.note + " " +
      effectiveProps(t).map(p => p.ko + p.en + p.sample).join(" ") + " " + n.name + " " + b.name).toLowerCase().includes(tagFilter.q))
  );
  const cnt = p => all.filter(x => platformsOf(x.t).indexOf(p) >= 0).length;
  $("#tagStats").innerHTML =
    ['<div class="stat" style="--c:var(--amp)"><span class="n">' + cnt("amplitude") + '</span><span class="t">Amplitude 이벤트</span></div>',
     '<div class="stat" style="--c:var(--braze)"><span class="n">' + cnt("braze") + '</span><span class="t">Braze 이벤트</span></div>',
     '<div class="stat" style="--c:var(--ga4)"><span class="n">' + cnt("ga4") + '</span><span class="t">GA4 이벤트</span></div>',
     '<div class="stat" style="--c:var(--ok)"><span class="n">' + all.filter(x => x.t.status === "live").length + '</span><span class="t">적용 완료</span></div>',
     '<div class="stat" style="--c:var(--warn)"><span class="n">' + all.filter(x => x.t.status === "todo").length + '</span><span class="t">작업 예정</span></div>'].join("");

  $("#tagTable").innerHTML =
    "<thead><tr><th>위치 · 플랫폼 · 상태</th><th>태그명 · 트리거 · 이벤트</th><th>속성</th><th>테스트샘플</th><th></th></tr></thead><tbody>" +
    (rows.length ? rows.map(({ t, n, b }) =>
      '<tr data-tid="' + t.id + '">' +
        /* 보드·페이지·플랫폼·개발상태를 한 칸에 모아 태그의 "신원"을 보여준다 */
        '<td><div class="meta stack td1cap">' +
          "<span>보드 <b>" + esc(b.name) + "</b></span>" +
          "<span>페이지 <b>" + esc(n.name) + "</b>" + (n.path ? ' <span class="mono" style="font-size:10.5px">(' + esc(n.path) + ")</span>" : "") + "</span>" +
          '<span>플랫폼 <span class="rowseg">' + platChips(platformsOf(t)) + "</span></span>" +
          '<span>상태 <span class="chip" style="--c:' + TSTATUS_C[t.status] + '">' + TSTATUS[t.status] + "</span></span>" +
        "</div></td>" +
        /* 동작(태그명)+트리거가 이 태그를 대표하는 제목 역할 — 여기를 눌러야만 여정 지도로 이동한다.
           테스트 샘플 펼치기 등 다른 클릭까지 이동시키지 않기 위해 이동은 이 칸에만 건다.
           이벤트·영역·채널은 공간을 아끼려고 같은 칸 안에 줄바꿈(구분선)만 두고 이어 붙인다. */
        "<td>" + '<div class="tagname-link td2cap" data-goto="' + n.id + '" data-bi="' + state.boards.indexOf(b) + '" title="여정 지도에서 보기">' +
          '<div style="font-weight:600">' + esc(t.action || "(태그명 없음)") + "</div>" +
          '<span class="chip" style="--c:var(--ink-3)">' + esc(TRIGGER[t.trigger] || t.trigger) + "</span>" +
        "</div>" +
        '<div class="meta stack tdsplit td2cap">' +
          "<span>" + (t.eventKo ? '<b style="color:var(--ink)">' + esc(t.eventKo) + "</b> " : "") + '<span class="evt">' + esc(tagEventEn(t)) + "</span></span>" +
          (tagArea(t) ? "<span>영역 <span class=\"mono\" style=\"font-size:10.5px\">" + esc(tagArea(t)) + "</span></span>" : "") +
          (t.channels && t.channels.length ? '<span class="rowseg">' + tchanChips(t.channels) + "</span>" : "") +
          (t.note ? '<span class="hint">' + esc(t.note) + "</span>" : "") +
        "</div></td>" +
        "<td>" + (propLines(displayProps(t)) || "—") + "</td>" +
        "<td>" + sampleChannelsBlock(t) + "</td>" +
        '<td><div class="rowacts edit-only"><button class="btn icon sm" data-trow-edit="' + t.id + '" data-node="' + n.id + '" data-bi="' + state.boards.indexOf(b) + '">' + ico("edit", "xs") + "</button></div></td>" +
      "</tr>").join("")
      : '<tr><td colspan="5"><div class="empty">' + ico("search") + "<div>조건에 맞는 태그가 없습니다</div></div></td></tr>") +
    "</tbody>";
  updateSampleToggleBtn(rows);
}
function initTagView() {
  $("#tagPlatFilter").addEventListener("click", e => {
    const b = e.target.closest("[data-p]"); if (!b) return;
    tagFilter.p = b.dataset.p; $$("#tagPlatFilter .btn").forEach(x => x.classList.toggle("on", x === b)); renderTagView(true);
  });
  $("#tagBoardFilter").addEventListener("change", e => { tagFilter.board = e.target.value; tagFilter.node = "all"; renderTagView(true); });
  $("#tagNodeFilter").addEventListener("change", e => { tagFilter.node = e.target.value; renderTagView(true); });
  $("#tagStatusFilter").addEventListener("change", e => { tagFilter.status = e.target.value; renderTagView(true); });
  $("#tagSearch").addEventListener("input", e => { tagFilter.q = e.target.value.toLowerCase().trim(); renderTagView(true); });
  $("#btnHideCommon").addEventListener("click", () => {
    tagFilter.hideCommon = !tagFilter.hideCommon;
    $("#btnHideCommon").classList.toggle("on", tagFilter.hideCommon);
    renderTagView(true);
  });
  $("#btnToggleAllSamples").addEventListener("click", () => {
    const btn = $("#btnToggleAllSamples");
    const keys = JSON.parse(btn.dataset.keys || "[]"); if (!keys.length) return;
    const allOpen = keys.every(k => expandedSamples.has(k));
    keys.forEach(k => { if (allOpen) expandedSamples.delete(k); else expandedSamples.add(k); });
    renderTagView(true);
  });
  $("#btnTagTemplate").addEventListener("click", tagCsvTemplate);
  $("#btnTagBulk").addEventListener("click", () => {
    if (!canEdit()) return;
    const inp = $("#tagCsvPick"); inp.value = "";
    inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) openTagBulkModal(f); };
    inp.click();
  });
  $("#tagTable").addEventListener("click", e => {
    const ed = e.target.closest("[data-trow-edit]");
    if (ed) { jumpTo(+ed.dataset.bi, ed.dataset.node); editTag(ed.dataset.trowEdit); return; }
    const cp = e.target.closest("[data-samp-copy-value]");
    if (cp) {
      navigator.clipboard.writeText(cp.dataset.sampCopyValue)
        .then(() => toast("복사했습니다", "ok"))
        .catch(() => toast("복사에 실패했습니다", "bad"));
      return;
    }
    const samp = e.target.closest("[data-samp-toggle]");
    if (samp) {
      const key = samp.dataset.sampToggle;
      if (expandedSamples.has(key)) expandedSamples.delete(key); else expandedSamples.add(key);
      return renderTagView(true);
    }
    const tr = e.target.closest("[data-goto]");
    if (tr) jumpTo(+tr.dataset.bi, tr.dataset.goto);
  });
  $("#btnTagCsv").addEventListener("click", () => {
    const body = allTags().map(({ t, n, b }) => csvLine(tagToCsvRow(t, n, b)));
    saveFile("tag-list.csv", "﻿" + [csvLine(TAG_CSV_HEAD)].concat(body).join("\r\n"), "text/csv");
  });
}

/* ---------------- 캠페인 뷰 ---------------- */
/* 운영상태는 기본으로 "진행"만 본다 — 중단된 캠페인까지 섞이면 목록이 지저분해진다 */
const campFilter = { chan: "all", aarrr: "all", goal: "all", seg: "all", owner: "all",
  status: "진행", measure: "all", place: "all", q: "" };
/* 구간(스윔레인) 배경은 지금 보고 있는 보드가 아닌 다른 보드일 수도 있어서,
   B()(현재 보드) 전제인 laneRect() 대신 보드를 인자로 받는 버전을 따로 둔다 */
function laneExtentYFor(b) {
  const nodes = b.nodes;
  if (!nodes.length) return { y1: -200, y2: 800 };
  let y1 = Infinity, y2 = -Infinity;
  nodes.forEach(n => { const q = nodeRect(n); y1 = Math.min(y1, q.y); y2 = Math.max(y2, q.y + q.h); });
  return { y1: y1 - 160, y2: y2 + 160 };
}
function laneRectFor(b, l) {
  if (l.y != null && l.h != null) return { x: l.x, y: l.y, w: l.w || 300, h: l.h };
  const { y1, y2 } = laneExtentYFor(b);
  return { x: l.x, y: y1, w: l.w || 900, h: Math.max(40, y2 - y1) };
}
function laneOfNode(b, n) {
  const q = nodeRect(n), cx = q.x + q.w / 2, cy = q.y + (q.h || 150) / 2;
  return (b.lanes || []).find(l => {
    const r = laneRectFor(b, l);
    return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
  }) || null;
}
/* 캠페인 탭 — 구글 시트 1.개인화DB 의 목록 그대로를 보여 준다.
   여정 지도에 붙었는지는 문서에서 캠페인코드로 찾아 표시한다. */
/* AARRR 구분은 코드 순서(A1 · A2 · R1 …)로 보여야 여정 단계 순서와 맞는다 */
function aarrrFilterOptions(cur) {
  const seen = {};
  SHEETS.camps.forEach(m => {
    const n = String(m.aarrrName || "").trim();
    if (n && !seen[n]) seen[n] = String(m.aarrrCode || "").trim().toUpperCase();
  });
  return '<option value="all">모든 AARRR 구분</option>' +
    Object.keys(seen).sort((a, b) => (seen[a] || "ZZ").localeCompare(seen[b] || "ZZ") || a.localeCompare(b, "ko"))
      .map(n => '<option value="' + esc(n) + '"' + (cur === n ? " selected" : "") + ">" +
        esc((seen[n] ? seen[n] + " · " : "") + n) + "</option>").join("");
}
function campColOptions(key, cur, allLabel) {
  const names = Array.from(new Set(SHEETS.camps.map(m => String(m[key] || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko"));
  return '<option value="all">' + esc(allLabel) + "</option>" +
    names.map(v => '<option value="' + esc(v) + '"' + (cur === v ? " selected" : "") + ">" + esc(v) + "</option>").join("");
}
function renderCampView(force) {
  if (!force && !viewStale.camps) return;
  viewStale.camps = false;
  const wrap = $("#view-camps");
  if (!wrap) return;
  $(".syncbar", wrap).innerHTML = syncBarHtml();

  /* 채널 버튼은 시트에 지금 값이 있는 것만이 아니라 고를 수 있는 채널을 전부 보여 준다.
     해당 캠페인이 없는 채널은 흐리게 두되 눌러 볼 수는 있게 한다. */
  const chanCount = {};
  SHEETS.camps.forEach(m => {
    const c = String(m.chan || "").trim();
    if (c) chanCount[c] = (chanCount[c] || 0) + 1;
  });
  const chans = Object.keys(optsFrom("chan", CHAN_OPTS)).filter(Boolean)
    .sort((a, b) => (CHAN_OPTS.indexOf(a) < 0) - (CHAN_OPTS.indexOf(b) < 0) ||
      (CHAN_OPTS.indexOf(a) >= 0 ? CHAN_OPTS.indexOf(a) - CHAN_OPTS.indexOf(b) : a.localeCompare(b, "ko")));
  const seg = $("#campChanFilter");
  seg.innerHTML = '<button class="btn sm' + (campFilter.chan === "all" ? " on" : "") + '" data-ch="all">전체</button>' +
    chans.map(c => '<button class="btn sm' + (campFilter.chan === c ? " on" : "") + (chanCount[c] ? "" : " off") +
      '" data-ch="' + esc(c) + '" title="' + (chanCount[c] || 0) + '건">' + esc(c) + "</button>").join("");
  $("#campAarrrFilter").innerHTML = aarrrFilterOptions(campFilter.aarrr);
  $("#campGoalFilter").innerHTML = campColOptions("goal", campFilter.goal, "모든 목표");
  $("#campSegFilter").innerHTML = campColOptions("title", campFilter.seg, "모든 캠페인구분");
  $("#campOwnerFilter").innerHTML = campColOptions("owner", campFilter.owner, "모든 담당자");

  const issues = hygieneCount();
  const chk = $("#checkCount");
  chk.textContent = issues ? "점검 " + issues : "점검";
  $("#btnCampCheck").classList.toggle("warn", issues > 0);
  $("#campStatusFilter").value = campFilter.status;
  $("#campMeasureFilter").value = campFilter.measure;

  const placed = {};
  state.boards.forEach(b => b.nodes.forEach(n => (n.camps || []).forEach(c => {
    if (c.code) (placed[c.code] = placed[c.code] || []).push({ b, n });
  })));

  const rows = SHEETS.camps.filter(m =>
    (campFilter.chan === "all" || m.chan === campFilter.chan) &&
    (campFilter.goal === "all" || m.goal === campFilter.goal) &&
    (campFilter.seg === "all" || m.title === campFilter.seg) &&
    (campFilter.owner === "all" || m.owner === campFilter.owner) &&
    (campFilter.aarrr === "all" || m.aarrrName === campFilter.aarrr) &&
    (campFilter.status === "all" || m.status === campFilter.status) &&
    (campFilter.measure === "all" || String(m.measure || "").toUpperCase() === campFilter.measure) &&
    (campFilter.place === "all" || (campFilter.place === "on" ? !!placed[m.code] : !placed[m.code])) &&
    (!campFilter.q || (m.code + " " + m.goal + " " + m.title + " " + m.fullName + " " + m.owner + " " + m.trigger).toLowerCase().includes(campFilter.q)));

  $("#campStats").innerHTML =
    ['<div class="stat" style="--c:var(--camp)"><span class="n">' + SHEETS.camps.length + '</span><span class="t">시트의 전체 캠페인</span></div>',
     '<div class="stat" style="--c:var(--ok)"><span class="n">' + SHEETS.camps.filter(m => m.statusCode === "live").length + '</span><span class="t">진행</span></div>',
     '<div class="stat" style="--c:var(--accent)"><span class="n">' + Object.keys(placed).length + '</span><span class="t">여정지도에 붙임</span></div>',
     '<div class="stat" style="--c:var(--ink-3)"><span class="n">' + rows.length + '</span><span class="t">지금 조건에 맞는 수</span></div>'].join("");

  /* 카드가 아니라 표로 — 칼럼끼리 세로로 맞아야 여러 캠페인을 한눈에 견준다 */
  /* '상태'(M열)와 '진행도'(H열)는 뜻이 다르다 — 헤더에서 구분해 준다 */
  const head = [
    ["캠페인코드", "시트 E열"], ["캠페인구분", "화면 표시명 · 시트 F열"], ["채널", "시트 I열"],
    ["AARRR · 목표", "시트 C열 · D열"], ["운영상태", "시트 M열 — 이 캠페인을 지금 돌리고 있는지 (진행 / 중단)"],
    ["작업 진행도", "시트 H열 — 세팅 작업이 어디까지 됐는지 (완료 등)"], ["담당자", "시트 P열"],
    ["캠페인명", "시트 G열 — 실제 세부 이름"], ["실적 기준", "시트 R열 · S열 + 실적 수식에서 자동으로 풀어 쓴 산식"],
    ["최신월 성과", "3.개인화RAW 의 가장 최근 달"], ["여정지도", ""], ["링크", "시트 T열 · U열"], ["", ""]];
  const body = rows.map(m => {
    const where = placed[m.code] || [];
    const links = m.linkList || [];
    const noLink = [m.link1, m.link2].filter(Boolean).length - links.length;
    return "<tr>" +
      '<td class="nowrap mono">' + esc(m.code) + "</td>" +
      '<td class="capname"><span class="nm">' + esc(m.title || "-") + "</span>" +
        (m.aarrrName ? '<span class="sub">' + esc(m.aarrrName) + "</span>" : "") + "</td>" +
      '<td class="nowrap">' + chanChip(m.chanCode) + "</td>" +
      "<td>" + esc(m.goal || "-") + (m.aarrrName ? '<span class="sub">' + esc(m.aarrrName) + "</span>" : "") + "</td>" +
      '<td class="nowrap"><span class="chip" style="--c:' + CSTATUS_C[m.statusCode] + '">' + esc(m.status || "-") + "</span></td>" +
      '<td class="nowrap">' + (m.progress ? esc(m.progress) : '<span style="color:var(--ink-3)">-</span>') +
        (String(m.measure || "").toUpperCase() === "Y" ? '<span class="sub">성과측정 Y</span>' : "") + "</td>" +
      '<td class="nowrap">' + esc(m.owner || "-") + "</td>" +
      '<td class="capfull"><span class="mono" style="font-size:11px">' + esc(m.fullName || "-") + "</span>" +
        (m.path ? '<span class="sub">' + esc(m.path) + "</span>" : "") + "</td>" +
      "<td>" + basisHtml(m) + "</td>" +
      "<td>" + (perfBadge(m.code) || '<span style="color:var(--ink-3)">-</span>') + "</td>" +
      '<td><div class="wherecell">' + (where.length
        ? where.map(({ b, n }) => '<span class="pagechip" data-goto="' + n.id + '" data-bi="' + state.boards.indexOf(b) + '">' +
            ico("map", "xs") + " " + esc(n.name) + "</span>").join("")
        : '<span style="color:var(--ink-3)">미배치</span>') + "</div></td>" +
      '<td><div class="rowseg">' + links.map(l =>
        '<button class="btn sm" data-goto-url="' + esc(l.url) + '" type="button" title="' + esc(l.url) + '">' +
          ico("link", "xs") + esc(l.label.length > 8 ? l.label.slice(0, 8) + "…" : l.label) + "</button>").join("") +
        (noLink > 0 ? '<span class="chip" style="--c:var(--ink-3)" title="셀에 글자만 있고 주소가 걸려 있지 않습니다">주소 없음</span>' : "") + "</div></td>" +
      '<td>' + (canEdit() && isStaff()
        ? '<div class="rowacts"><button class="btn icon sm" data-sheet-edit="' + esc(m.code) + '" title="수정">' + ico("edit", "xs") + "</button></div>"
        : "") + "</td>" +
    "</tr>";
  }).join("");

  $("#campTable").innerHTML = rows.length
    ? "<thead><tr>" + head.map(h => '<th' + (h[1] ? ' title="' + esc(h[1]) + '"' : "") + ">" + esc(h[0]) + "</th>").join("") + "</tr></thead><tbody>" + body + "</tbody>"
    : '<tbody><tr><td><div class="empty">' + ico("mega") +
      "<div>" + (SHEETS.camps.length ? "조건에 맞는 캠페인이 없습니다" : "구글 시트에서 캠페인을 아직 불러오지 못했습니다") + "</div></div></td></tr></tbody>";
}
function initCampView() {
  $("#campChanFilter").addEventListener("click", e => {
    const b = e.target.closest("[data-ch]"); if (!b) return;
    campFilter.chan = b.dataset.ch; $$("#campChanFilter .btn").forEach(x => x.classList.toggle("on", x === b)); renderCampView(true);
  });
  $("#campAarrrFilter").addEventListener("change", e => { campFilter.aarrr = e.target.value; renderCampView(true); });
  $("#campMeasureFilter").addEventListener("change", e => { campFilter.measure = e.target.value; renderCampView(true); });
  $("#campGoalFilter").addEventListener("change", e => { campFilter.goal = e.target.value; renderCampView(true); });
  $("#campSegFilter").addEventListener("change", e => { campFilter.seg = e.target.value; renderCampView(true); });
  $("#campOwnerFilter").addEventListener("change", e => { campFilter.owner = e.target.value; renderCampView(true); });
  $("#campStatusFilter").addEventListener("change", e => { campFilter.status = e.target.value; renderCampView(true); });
  $("#campPlaceFilter").addEventListener("change", e => { campFilter.place = e.target.value; renderCampView(true); });
  $("#campSearch").addEventListener("input", e => { campFilter.q = e.target.value.toLowerCase().trim(); renderCampView(true); });
  $("#btnCampCheck").addEventListener("click", openCheckModal);
  $("#btnNewSheetCamp").addEventListener("click", () => editSheetCamp(null));
  $("#campTable").addEventListener("click", e => {
    const go = e.target.closest("[data-goto-url]");
    if (go) return openUrl(go.dataset.gotoUrl);
    const g = e.target.closest("[data-goto]");
    if (g && g.dataset.bi != null) jumpTo(+g.dataset.bi, g.dataset.goto);
  });
  /* 시트 컬럼을 그대로 내보낸다 — 어디에 붙였는지만 한 칸 덧붙인다 */
  $("#btnCampCsv").addEventListener("click", () => {
    const cols = SHEET_COLS.filter(c => !c.num);      // 전달~매출 같은 수치는 빼고 정보 칸만 내보낸다
    const head = cols.map(c => c.label).concat("링크1 주소", "링크2 주소", "여정지도 배치");
    const body = SHEETS.camps.map(m => csvLine(cols.map(c => m[c.key]).concat(m.link1Url || "", m.link2Url || "",
      placementsOf(m.code).map(({ b, n }) => b.name + " · " + n.name).join(" / "))));
    saveFile("crm-campaigns.csv", "﻿" + [csvLine(head)].concat(body).join("\r\n"), "text/csv");
  });
}

