
/* ========================================================================
   좌: CRM 캠페인 · 우: 태깅 설정 · 목록 뷰(모든 보드 통합)
   ======================================================================== */
const viewStale = { tags: true, camps: true, album: true };
function invalidateViews() { viewStale.tags = true; viewStale.camps = true; viewStale.album = true; }

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
/* 태그 목록(전체 표)에서는 접지 않고 채널별 샘플을 항상 옆으로 나란히(칼럼) 펼쳐서 보여준다 */
function sampleColumns(t) {
  const rows = sampleRowsOf(t);
  if (!rows.length) return "";
  return '<div class="tsamp-cols">' + rows.map(([k, label]) => '<div class="tsamp-col"><span class="tsamp-k">' + esc(label) + '</span><pre class="mono">' + esc(t[k]) + "</pre></div>").join("") + "</div>";
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
    shotW: DOC_W, shotH: DOC_H, hue: "none", size: "m", sharp: false, tags: [], camps: [], layers: []
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
function campCsvTemplate() {
  const head = ["보드", "페이지", "캠페인명", "채널", "대분류", "소분류", "세그먼트", "타이밍", "상태", "캠페인ID", "랜딩", "메모"];
  const example = [B().name, (B().nodes[0] || {}).name || "홈", "장바구니 이탈 리마인드", "앱 푸시", "리텐션", "장바구니 이탈",
    "Cart Updated 후 4시간 미결제", "4시간 지연 발송", "운영중", "BRZ-PUSH-2871", "/cart", "1일 1회 · 야간 발송 제외"];
  saveFile("campaign-upload-template.csv", "﻿" + [csvLine(head), csvLine(example)].join("\r\n"), "text/csv");
}
function openCampBulkModal(file) {
  readTextFile(file, text => {
    const rows = parseCsv(text);
    const data = rows.slice(1);
    if (!data.length) return toast("CSV에서 데이터 행을 찾지 못했습니다", "bad");
    const parsed = data.map(r => {
      const [boardName, pageName, name, chanLabel, cat1, cat2, segment, timing, statusLabel, extId, landing, note] = r;
      return {
        boardName: boardName || "", pageName: (pageName || "새 페이지").trim(),
        camp: {
          name: name || "이름 없는 캠페인", chan: keyByLabel(CHAN, chanLabel, "push"), cat1: cat1 || "", cat2: cat2 || "",
          segment: segment || "", timing: timing || "", status: keyByLabel(CSTATUS, statusLabel, "draft"),
          extId: extId || "", landing: landing || "", note: note || ""
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
      title: "캠페인 일괄 업로드", rows: parsed.map(p => esc(p.pageName) + "<em>" + esc((CHAN[p.camp.chan] || CHAN.push).name) + " · " + esc(p.camp.name) + "</em>"),
      newPages,
      onRun: () => {
        parsed.forEach(p => {
          const b = resolveBoard(p.boardName), node = resolveNode(b, p.pageName, "");
          node.camps.push(Object.assign({ id: uid("c") }, p.camp));
        });
        markDirty(); renderFlow(); renderPanels(); renderCampView(true);
        toast(parsed.length + "개 캠페인을 등록했습니다" + (newPages ? " · 새 페이지 " + newPages + "개" : ""), "ok");
      }
    });
  });
}

/* ---------------- 우측: 태깅 ---------------- */
function renderTagPanel() {
  const n = curNode(), box = $("#tagList");
  $("#tagCount").textContent = n ? n.tags.length : 0;
  renderTagJumpSelect();
  if (!n) { box.innerHTML = '<div class="empty">' + ico("tag") + "<div>페이지를 선택하세요</div></div>"; updateToggleAllBtn(n); return; }
  if (!n.tags.length) {
    box.innerHTML = '<div class="empty">' + ico("tag") + "<div>등록된 태그가 없습니다" +
      (canEdit() ? "<br>이 화면에서 발생하는 이벤트를 추가하세요" : "") + "</div></div>";
    updateToggleAllBtn(n);
    return;
  }
  const order = { amplitude: 0, braze: 1, ga4: 2 };
  const minOrder = t => platformsOf(t).reduce((m, p) => Math.min(m, order[p] != null ? order[p] : 99), 99);
  box.innerHTML = n.tags.slice().sort((a, b) => minOrder(a) - minOrder(b)).map(t => {
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

/* ---------------- 좌측: 캠페인 ---------------- */
function renderCampPanel() {
  const n = curNode(), box = $("#campList");
  $("#campCount").textContent = n ? n.camps.length : 0;
  if (!n) { box.innerHTML = '<div class="empty">' + ico("mega") + "<div>페이지를 선택하세요</div></div>"; return; }
  const L = (n.layers || []).find(x => x.id === sel.layer);
  box.innerHTML = (n.camps.length ? n.camps.map(c => {
    const linked = (n.layers || []).filter(l => l.campId === c.id);
    return '<div class="card' + (L && L.campId === c.id ? " pinned" : "") + '" data-camp="' + c.id + '">' +
      '<div class="card-top">' + chanChip(c.chan) + '<div class="spacer"></div>' + acts("camp", c.id) + "</div>" +
      '<div class="card-title">' + esc(c.name) + "</div>" +
      '<div class="meta"><span><span class="dot" style="--c:' + CSTATUS_C[c.status] + '"></span> ' + CSTATUS[c.status] + "</span>" +
        (c.segment ? "<span>세그먼트 <b>" + esc(c.segment) + "</b></span>" : "") +
        (c.timing ? "<span>타이밍 <b>" + esc(c.timing) + "</b></span>" : "") + "</div>" +
      (c.extId || c.landing ? '<div class="kv">' + (c.extId ? "<span>" + esc(c.extId) + "</span>" : "") + (c.landing ? "<span>" + esc(c.landing) + "</span>" : "") + "</div>" : "") +
      campLinkButtons(c) +
      (c.note ? '<div class="hint">' + esc(c.note) + "</div>" : "") +
      (linked.length ? '<div class="linkline">' + ico("pin", "xs") + "화면 레이어 " + linked.length + "곳에 배치됨</div>" : "") +
      (L && canEdit() ? '<button class="btn sm edit-only" data-link="' + c.id + '" style="align-self:flex-start">' +
        ico(L.campId === c.id ? "check" : "pin", "xs") + (L.campId === c.id ? "연결됨 · 해제" : "선택한 레이어에 연결") + "</button>" : "") +
    "</div>";
  }).join("") : '<div class="empty">' + ico("mega") + "<div>이 화면에 붙는 CRM 캠페인이 없습니다" +
    (canEdit() ? "<br>추가 버튼으로 등록하세요" : "") + "</div></div>");

  const foot = $("#layerLinkFoot");
  if (L) {
    const c = L.campId ? n.camps.find(x => x.id === L.campId) : null;
    foot.style.display = "";
    foot.innerHTML = '<div class="frow"><span class="lbl">선택한 레이어</span>' +
      '<div class="meta">' + LKIND(L) + (c ? " → <b>" + esc(c.name) + "</b>" : " → 연결된 캠페인 없음") + "</div></div>";
  } else { foot.style.display = "none"; foot.innerHTML = ""; }
}
function renderPanels() { renderTagPanel(); renderCampPanel(); }

/* ---------------- CRUD ---------------- */
function editTag(id) {
  const n = curNode(); if (!n || !canEdit()) return;
  const t = id ? n.tags.find(x => x.id === id) : {
    platforms: ["amplitude"], path: "", eventKo: "", eventEn: "",
    area: "", trigger: "click", channels: [], action: "", props: [], status: "todo", note: "",
    testSampleWebPc: "", testSampleWebMo: "", testSampleAppAos: "", testSampleAppIos: ""
  };
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
  $("#btnAddCamp").addEventListener("click", () => editCamp(null));
  $("#btnToggleAllTags").addEventListener("click", () => {
    const n = curNode(); if (!n || !n.tags.length) return;
    const allExpanded = n.tags.every(t => expandedTags.has(t.id));
    n.tags.forEach(t => { if (allExpanded) expandedTags.delete(t.id); else expandedTags.add(t.id); });
    renderTagPanel();
  });
  $("#tagJumpSelect").addEventListener("change", e => {
    const id = e.target.value; if (id) jumpToTag(id);
  });
  $("#tagList").addEventListener("click", e => {
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
      const n = curNode(), c = n.camps.find(x => x.id === dl.dataset.campDel);
      return confirmDel("캠페인 " + c.name + " 을 삭제할까요?", () => {
        n.camps = n.camps.filter(x => x.id !== c.id);
        (n.layers || []).forEach(l => { if (l.campId === c.id) l.campId = null; });
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
    "<thead><tr><th>보드</th><th>페이지</th><th>플랫폼</th><th>태그명 · 트리거</th><th>이벤트 · 영역 · 채널</th><th>속성</th><th>개발확인</th><th>테스트샘플</th><th></th></tr></thead><tbody>" +
    (rows.length ? rows.map(({ t, n, b }) =>
      '<tr data-tid="' + t.id + '">' +
        '<td class="nowrap" style="color:var(--ink-3)">' + esc(b.name) + "</td>" +
        '<td class="nowrap"><b>' + esc(n.name) + "</b>" + (n.path ? '<div class="mono" style="font-size:10.5px;color:var(--ink-3)">' + esc(n.path) + "</div>" : "") + "</td>" +
        "<td>" + platChips(platformsOf(t)) + "</td>" +
        /* 동작(태그명)+트리거가 이 태그를 대표하는 제목 역할 — 여기를 눌러야만 여정 지도로 이동한다.
           테스트 샘플 펼치기 등 다른 클릭까지 이동시키지 않기 위해 이동은 이 칸에만 건다. */
        "<td>" + '<div class="tagname-link" data-goto="' + n.id + '" data-bi="' + state.boards.indexOf(b) + '" title="여정 지도에서 보기">' +
          '<div style="font-weight:600">' + esc(t.action || "(태그명 없음)") + "</div>" +
          '<span class="chip" style="--c:var(--ink-3)">' + esc(TRIGGER[t.trigger] || t.trigger) + "</span>" +
        "</div></td>" +
        '<td><div class="meta stack">' +
          "<span>" + (t.eventKo ? '<b style="color:var(--ink)">' + esc(t.eventKo) + "</b> " : "") + '<span class="evt">' + esc(tagEventEn(t)) + "</span></span>" +
          (tagArea(t) ? "<span>영역 <span class=\"mono\" style=\"font-size:10.5px\">" + esc(tagArea(t)) + "</span></span>" : "") +
          (t.channels && t.channels.length ? '<span class="rowseg">' + tchanChips(t.channels) + "</span>" : "") +
          (t.note ? '<span class="hint">' + esc(t.note) + "</span>" : "") +
        "</div></td>" +
        "<td>" + (propLines(displayProps(t)) || "—") + "</td>" +
        '<td class="nowrap"><span class="chip" style="--c:' + TSTATUS_C[t.status] + '">' + TSTATUS[t.status] + "</span></td>" +
        "<td>" + (sampleColumns(t) || "—") + "</td>" +
        '<td><div class="rowacts edit-only"><button class="btn icon sm" data-trow-edit="' + t.id + '" data-node="' + n.id + '" data-bi="' + state.boards.indexOf(b) + '">' + ico("edit", "xs") + "</button></div></td>" +
      "</tr>").join("")
      : '<tr><td colspan="9"><div class="empty">' + ico("search") + "<div>조건에 맞는 태그가 없습니다</div></div></td></tr>") +
    "</tbody>";
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
    const tr = e.target.closest("[data-goto]");
    if (tr) jumpTo(+tr.dataset.bi, tr.dataset.goto);
  });
  $("#btnTagCsv").addEventListener("click", () => {
    const body = allTags().map(({ t, n, b }) => csvLine(tagToCsvRow(t, n, b)));
    saveFile("tag-list.csv", "﻿" + [csvLine(TAG_CSV_HEAD)].concat(body).join("\r\n"), "text/csv");
  });
}

/* ---------------- 캠페인 뷰 ---------------- */
const campFilter = { chan: "all", board: "all", status: "all", cat1: "all", cat2: "all", q: "" };
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
function camCatOptions(all, key, cur) {
  const names = Array.from(new Set(all.map(x => (x.c[key] || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko"));
  return '<option value="all">전체</option>' + names.map(v => '<option value="' + esc(v) + '"' + (cur === v ? " selected" : "") + ">" + esc(v) + "</option>").join("");
}
function renderCampView(force) {
  if (!force && !viewStale.camps) return;
  viewStale.camps = false;
  const seg = $("#campChanFilter");
  if (!seg.children.length) {
    seg.innerHTML = '<button class="btn sm on" data-ch="all">전체</button>' +
      Object.entries(CHAN).map(([k, v]) => '<button class="btn sm" data-ch="' + k + '">' + esc(v.name) + "</button>").join("");
  }
  $("#campBoardFilter").innerHTML = boardOptions(campFilter.board);
  const all = allCamps();
  if (!all.some(x => (x.c.cat1 || "") === campFilter.cat1)) campFilter.cat1 = "all";
  if (!all.some(x => (x.c.cat2 || "") === campFilter.cat2)) campFilter.cat2 = "all";
  $("#campCat1Filter").innerHTML = camCatOptions(all, "cat1", campFilter.cat1);
  $("#campCat2Filter").innerHTML = camCatOptions(all, "cat2", campFilter.cat2);
  const rows = all.filter(({ c, n, b }) =>
    (campFilter.chan === "all" || c.chan === campFilter.chan) &&
    (campFilter.board === "all" || state.boards[+campFilter.board] === b) &&
    (campFilter.status === "all" || c.status === campFilter.status) &&
    (campFilter.cat1 === "all" || (c.cat1 || "") === campFilter.cat1) &&
    (campFilter.cat2 === "all" || (c.cat2 || "") === campFilter.cat2) &&
    (!campFilter.q || (c.name + " " + c.segment + " " + c.timing + " " + c.extId + " " + (c.cat1 || "") + " " + (c.cat2 || "") + " " + n.name + " " + b.name).toLowerCase().includes(campFilter.q)));
  /* 여정 지도 상의 위치(왼쪽→오른쪽, 위쪽→아래쪽)를 따라 캠페인을 여정 순서대로 보여준다 */
  rows.sort((x, y) => {
    const bi = state.boards.indexOf(x.b) - state.boards.indexOf(y.b); if (bi) return bi;
    const qx = nodeRect(x.n), qy = nodeRect(y.n);
    return (qx.x - qy.x) || (qx.y - qy.y);
  });

  $("#campStats").innerHTML =
    ['<div class="stat" style="--c:var(--camp)"><span class="n">' + all.length + '</span><span class="t">전체 캠페인</span></div>',
     '<div class="stat" style="--c:var(--ok)"><span class="n">' + all.filter(x => x.c.status === "live").length + '</span><span class="t">운영중</span></div>',
     '<div class="stat" style="--c:var(--warn)"><span class="n">' + all.filter(x => x.c.status === "test").length + '</span><span class="t">테스트</span></div>',
     '<div class="stat" style="--c:var(--accent)"><span class="n">' + new Set(all.map(x => x.n.id)).size + '</span><span class="t">캠페인이 붙은 화면</span></div>'].join("");

  $("#campGrid").innerHTML = rows.length ? rows.map(({ c, n, b }) => {
    const pins = (n.layers || []).filter(l => l.campId === c.id).length;
    const lane = laneOfNode(b, n);
    const links = campLinkButtons(c);
    return '<div class="ccard" style="--c:' + (CHAN[c.chan] || CHAN.push).c + '">' +
      '<div class="crow">' +
        '<div class="rowseg">' + (c.cat1 ? '<span class="chip" style="--c:var(--ink-3)">' + esc(c.cat1) + "</span>" : "") +
          (c.cat2 ? '<span class="chip" style="--c:var(--ink-3)">' + esc(c.cat2) + "</span>" : "") + "</div>" +
        '<span class="chip" style="--c:' + CSTATUS_C[c.status] + '">' + CSTATUS[c.status] + "</span>" +
      "</div>" +
      '<div class="crow">' + "<h3>" + esc(c.name) + "</h3>" + chanChip(c.chan) + "</div>" +
      '<div class="crow">' +
        '<span class="pagechip" data-goto="' + n.id + '" data-bi="' + state.boards.indexOf(b) + '">' + ico("map", "xs") + " " + esc(b.name) + " · " + esc(n.name) + "</span>" +
        (links || "") +
      "</div>" +
      (c.segment || c.timing ? '<div class="meta">' + (c.segment ? "<span>세그먼트 <b>" + esc(c.segment) + "</b></span>" : "") +
        (c.timing ? "<span>타이밍 <b>" + esc(c.timing) + "</b></span>" : "") + "</div>" : "") +
      (c.extId || c.landing ? '<div class="kv">' + (c.extId ? "<span>" + esc(c.extId) + "</span>" : "") + (c.landing ? "<span>" + esc(c.landing) + "</span>" : "") + "</div>" : "") +
      (lane || pins ? '<div class="where">' +
        (lane ? '<span class="pagechip lanechip" style="--c:' + (lane.color || "var(--accent)") + '" title="여정 지도의 구간">' + ico("lanes", "xs") + " " + esc(lane.name || "구간") + "</span>" : "") +
        (pins ? '<span class="pagechip">' + ico("pin", "xs") + " 화면 배치 " + pins + "</span>" : "") + "</div>" : "") +
      (c.note ? '<div class="hint">' + esc(c.note) + "</div>" : "") +
    "</div>";
  }).join("") : '<div class="empty" style="grid-column:1/-1">' + ico("mega") + "<div>조건에 맞는 캠페인이 없습니다</div></div>";
}
function initCampView() {
  $("#campChanFilter").addEventListener("click", e => {
    const b = e.target.closest("[data-ch]"); if (!b) return;
    campFilter.chan = b.dataset.ch; $$("#campChanFilter .btn").forEach(x => x.classList.toggle("on", x === b)); renderCampView(true);
  });
  $("#campBoardFilter").addEventListener("change", e => { campFilter.board = e.target.value; renderCampView(true); });
  $("#campStatusFilter").addEventListener("change", e => { campFilter.status = e.target.value; renderCampView(true); });
  $("#campCat1Filter").addEventListener("change", e => { campFilter.cat1 = e.target.value; renderCampView(true); });
  $("#campCat2Filter").addEventListener("change", e => { campFilter.cat2 = e.target.value; renderCampView(true); });
  $("#campSearch").addEventListener("input", e => { campFilter.q = e.target.value.toLowerCase().trim(); renderCampView(true); });
  $("#btnCampTemplate").addEventListener("click", campCsvTemplate);
  $("#btnCampBulk").addEventListener("click", () => {
    if (!canEdit()) return;
    const inp = $("#campCsvPick"); inp.value = "";
    inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) openCampBulkModal(f); };
    inp.click();
  });
  $("#campGrid").addEventListener("click", e => {
    const go = e.target.closest("[data-goto-url]");
    if (go) return openUrl(go.dataset.gotoUrl);
    const g = e.target.closest("[data-goto]");
    if (g && g.dataset.bi != null) jumpTo(+g.dataset.bi, g.dataset.goto);
  });
  $("#btnCampCsv").addEventListener("click", () => {
    const head = ["보드", "페이지", "캠페인명", "채널", "대분류", "소분류", "세그먼트", "타이밍", "상태", "캠페인ID", "랜딩", "메모"];
    const q = s => '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"';
    const body = allCamps().map(({ c, n, b }) => [b.name, n.name, c.name, (CHAN[c.chan] || CHAN.push).name, c.cat1 || "", c.cat2 || "", c.segment, c.timing, CSTATUS[c.status], c.extId, c.landing, c.note].map(q).join(","));
    saveFile("crm-campaigns.csv", "﻿" + [head.map(q).join(",")].concat(body).join("\r\n"), "text/csv");
  });
}

/* ---------------- 앨범 뷰 — 문서에 등록된 Cloudinary 이미지 모아보기 ----------------
   Cloudinary Admin API(계정 전체 조회)는 API Secret이 필요해 쓰지 않는다. 대신
   이 문서의 노드·레이어에 이미 걸려 있는 Cloudinary URL만 모아 보여준다 —
   업로드 태그(=페이지 이름)로 자동 분류되고, 문서에서 지운 이미지는 당연히 빠진다. */
function fallbackName(url) { try { return decodeURIComponent(String(url).split("/").pop() || "image"); } catch (e) { return "image"; } }
/* Blob을 파일명 없이 올렸던 예전 업로드는 Cloudinary가 문자 그대로 "blob"을
   원본 파일명으로 돌려준다 — 뜻이 없으니 화면에는 페이지 이름으로 대신 보여준다.
   새로 올리는 이미지는 cloudUpload()가 항상 페이지 이름 기반 파일명을 보내므로
   이 문제가 생기지 않는다. */
function displayFilename(rawName, url, pageName) {
  if (rawName && rawName !== "blob") return rawName;
  return pageName || fallbackName(url);
}
function allCloudImages() {
  const out = [];
  state.boards.forEach(b => b.nodes.forEach(n => {
    if (n.shot && n.shot.url) out.push({
      kind: "shot", url: n.shot.url, tag: n.name, node: n, board: b,
      uploadedAt: n.shot.uploadedAt || null, filename: displayFilename(n.shot.filename, n.shot.url, n.name)
    });
    (n.layers || []).forEach(l => {
      if (l.kind === "image" && l.src && /^https?:/.test(l.src)) out.push({
        kind: "layer", url: l.src, tag: n.name, node: n, board: b, layer: l,
        uploadedAt: l.uploadedAt || null, filename: displayFilename(l.filename, l.src, n.name)
      });
    });
  }));
  return out;
}
const albumFilter = { board: "all", tag: "all", q: "", sort: "new", group: true };
function albumTagOptions(all, cur) {
  const names = Array.from(new Set(all.map(x => x.tag))).sort((a, b) => a.localeCompare(b, "ko"));
  return '<option value="all">모든 태그</option>' + names.map(n => '<option value="' + esc(n) + '"' + (cur === n ? " selected" : "") + ">" + esc(n) + "</option>").join("");
}
function albumCard(x) {
  return '<div class="acard" data-goto="' + x.node.id + '" data-bi="' + state.boards.indexOf(x.board) + '">' +
    '<img src="' + esc(x.url) + '" alt="" loading="lazy" draggable="false">' +
    '<div class="a-meta">' +
      '<div class="a-name">' + esc(x.filename) + "</div>" +
      '<div class="a-sub">' + esc(x.board.name) + " · " + esc(x.tag) + (x.uploadedAt ? " · " + timeAgo(new Date(x.uploadedAt).getTime()) : "") + "</div>" +
    "</div></div>";
}
function renderAlbumView(force) {
  if (!force && !viewStale.album) return;
  viewStale.album = false;
  const all = allCloudImages();
  $("#albumBoardFilter").innerHTML = boardOptions(albumFilter.board);
  if (!all.some(x => x.tag === albumFilter.tag)) albumFilter.tag = "all";
  $("#albumTagFilter").innerHTML = albumTagOptions(all, albumFilter.tag);

  const rows = all.filter(x =>
    (albumFilter.board === "all" || state.boards[+albumFilter.board] === x.board) &&
    (albumFilter.tag === "all" || x.tag === albumFilter.tag) &&
    (!albumFilter.q || (x.filename + " " + x.tag + " " + x.board.name).toLowerCase().includes(albumFilter.q))
  );
  const byDate = (a, b) => (a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0) - (b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0);
  if (albumFilter.sort === "new") rows.sort((a, b) => byDate(b, a));
  else if (albumFilter.sort === "old") rows.sort(byDate);
  else rows.sort((a, b) => a.filename.localeCompare(b.filename, "ko"));

  $("#albumStats").innerHTML =
    ['<div class="stat" style="--c:var(--accent)"><span class="n">' + all.length + '</span><span class="t">전체 이미지</span></div>',
     '<div class="stat" style="--c:var(--camp)"><span class="n">' + new Set(all.map(x => x.tag)).size + '</span><span class="t">태그(페이지) 수</span></div>',
     '<div class="stat" style="--c:var(--ok)"><span class="n">' + rows.length + '</span><span class="t">현재 조건에 맞는 이미지</span></div>'].join("");

  const body = $("#albumBody");
  if (!rows.length) { body.innerHTML = '<div class="empty">' + ico("image") + "<div>조건에 맞는 이미지가 없습니다<br>Cloudinary로 변환된 이미지만 여기 모입니다</div></div>"; return; }
  if (albumFilter.group) {
    const groups = {};
    rows.forEach(x => (groups[x.tag] = groups[x.tag] || []).push(x));
    body.innerHTML = Object.keys(groups).sort((a, b) => a.localeCompare(b, "ko")).map(tag =>
      '<h3 class="album-group-title">' + esc(tag) + ' <span class="hint">(' + groups[tag].length + ")</span></h3>" +
      '<div class="grid-cards">' + groups[tag].map(albumCard).join("") + "</div>"
    ).join("");
  } else {
    body.innerHTML = '<div class="grid-cards">' + rows.map(albumCard).join("") + "</div>";
  }
}
function initAlbumView() {
  $("#albumBoardFilter").addEventListener("change", e => { albumFilter.board = e.target.value; renderAlbumView(true); });
  $("#albumTagFilter").addEventListener("change", e => { albumFilter.tag = e.target.value; renderAlbumView(true); });
  $("#albumSort").addEventListener("change", e => { albumFilter.sort = e.target.value; renderAlbumView(true); });
  $("#albumSearch").addEventListener("input", e => { albumFilter.q = e.target.value.toLowerCase().trim(); renderAlbumView(true); });
  $("#btnAlbumGroup").addEventListener("click", () => {
    albumFilter.group = !albumFilter.group;
    $("#btnAlbumGroup").classList.toggle("on", albumFilter.group);
    renderAlbumView(true);
  });
  $("#albumBody").addEventListener("click", e => {
    const g = e.target.closest("[data-goto]");
    if (g && g.dataset.bi != null) jumpTo(+g.dataset.bi, g.dataset.goto);
  });
}
