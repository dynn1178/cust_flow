
/* ========================================================================
   셸 — 영역 크기 조절 · 뷰 전환 · 파일 입출력 · 부팅
   ======================================================================== */
function applySizes() {
  const u = state.ui;
  u.flowH = clamp(u.flowH, 130, Math.max(180, innerHeight - 260));
  u.leftW = clamp(u.leftW, 190, 520);
  u.rightW = clamp(u.rightW, 190, 560);
  $("#flowPane").style.height = u.flowH + "px";
  $("#paneLeft").style.width = u.leftW + "px";
  $("#paneRight").style.width = u.rightW + "px";
}
function initSplitters() {
  const drag = (el, onMove) => {
    el.addEventListener("pointerdown", e => {
      e.preventDefault(); el.setPointerCapture(e.pointerId);
      const start = { x: e.clientX, y: e.clientY, u: Object.assign({}, state.ui) };
      const mv = ev => { onMove(ev.clientX - start.x, ev.clientY - start.y, start.u); applySizes(); };
      const up = () => { el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); markDirty(); if (!stageZoom) renderStage(); };
      el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up);
    });
    el.addEventListener("keydown", e => {
      const step = e.shiftKey ? 40 : 12;
      const k = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!k) return;
      e.preventDefault(); onMove(k[0], k[1], Object.assign({}, state.ui)); applySizes(); markDirty(); if (!stageZoom) renderStage();
    });
  };
  drag($("#splitH"), (dx, dy, u) => { state.ui.flowH = u.flowH + dy; });
  drag($("#splitL"), (dx, dy, u) => { state.ui.leftW = u.leftW + dx; });
  drag($("#splitR"), (dx, dy, u) => { state.ui.rightW = u.rightW - dx; });
  addEventListener("resize", () => { applySizes(); if (!stageZoom) renderStage(); });
}

/* 테마 — 기본은 라이트. 사용자가 고르면 그 선택을 기억한다(OS 설정보다 우선) */
const THEME_KEY = "jta:theme";
function initTheme() {
  let t = null;
  try { t = localStorage.getItem(THEME_KEY); } catch (e) {}
  document.documentElement.setAttribute("data-theme", t === "dark" ? "dark" : "light");
}
initTheme();

/* 목록 뷰는 열 때만 그린다 — 탭 전환이 즉시 반응하도록 */
function switchView(v) {
  $$(".view").forEach(s => s.classList.toggle("on", s.id === "view-" + v));
  $$("#viewTabs .btn").forEach(b => b.classList.toggle("on", b.dataset.view === v));
  if (v === "tags") renderTagView();
  if (v === "camps") renderCampView();
  if (v === "album") renderAlbumView();
  if (v === "map") { applySizes(); applyTransform(); if (!stageZoom) renderStage(); }
}

function initShell() {
  $("#viewTabs").addEventListener("click", e => { const b = e.target.closest("[data-view]"); if (b) switchView(b.dataset.view); });
  $("#btnShare").addEventListener("click", () => (supaOn() ? serverSave() : shareSave()));
  $("#btnTheme").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "light";
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    drawEdges();
  });
  $("#btnStorage").addEventListener("click", openStorageModal);
  $("#btnExport").addEventListener("click", exportJson);
  $("#btnImport").addEventListener("click", importJson);
  $("#btnQuickSearch").addEventListener("click", openQuickSearch);

  document.addEventListener("keydown", e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (canEdit()) (supaOn() ? serverSave() : shareSave()); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); openQuickSearch(); return; }
    if (typing) return;
    if (e.key === "Escape") {
      closeModal(); $("#popRoot").innerHTML = ""; closeMenu();
      sel.layer = null; sel.edge = null; setTool("select");
      renderStage(); renderPanels(); drawEdges();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && canEdit()) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y" && canEdit()) { e.preventDefault(); redo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && canEdit() && sel.node && !sel.layer) { e.preventDefault(); duplicateNode(sel.node); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && canEdit()) {
      const n = curNode();
      if (sel.layer && n) { n.layers = n.layers.filter(l => l.id !== sel.layer); sel.layer = null; markDirty(); renderFlow(); renderStage(); renderPanels(); e.preventDefault(); }
      else if (sel.edge) { B().edges = B().edges.filter(x => x.id !== sel.edge); sel.edge = null; markDirty(); renderFlow(); e.preventDefault(); }
      else if (sel.node && n) { e.preventDefault(); confirmDel('"' + n.name + '" 페이지를 삭제할까요?', () => deleteNode(n.id)); }
    }
    if (/^Arrow(Up|Down|Left|Right)$/.test(e.key) && canEdit() && sel.node && !sel.layer && !sel.edge) {
      const n = curNode(); if (!n) return;
      e.preventDefault();
      const step = e.shiftKey ? GRID : 1;
      if (e.key === "ArrowUp") n.y -= step;
      else if (e.key === "ArrowDown") n.y += step;
      else if (e.key === "ArrowLeft") n.x -= step;
      else n.x += step;
      const el = $('[data-node="' + n.id + '"]');
      if (el) { el.style.left = n.x + "px"; el.style.top = n.y + "px"; moveEdgesOf(n.id); }
      markDirty();
    }
  });
  addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
}

/* ---------------- 파일로 주고받기 ---------------- */
function inlineBoards() {                     // 이미지를 data URL로 담아 파일 하나로 완결시킨다
  return state.boards.map(b => Object.assign({}, b, {
    nodes: b.nodes.map(n => {
      const c = Object.assign({}, n);
      const s = shotSrc(n);
      delete c.shotDirty; delete c.shotData;
      c.shot = s && s.indexOf("data:") === 0 ? s : n.shot;
      return c;
    })
  }));
}
function exportJson() {
  const name = (state.title || "journey").replace(/[\\/:*?"<>|]/g, "") + ".json";
  saveFile(name, JSON.stringify(Object.assign({}, state, { boards: inlineBoards() }), null, 2), "application/json");
}
function importJson() {
  if (!canEdit()) return;
  const inp = $("#jsonPick"); inp.value = "";
  inp.onchange = () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const data = normalize(JSON.parse(fr.result));
        state = data;
        savedRefs = [];
        state.boards.forEach(b => b.nodes.forEach(n => {
          if (typeof n.shot === "string") { n.shotData = n.shot; n.shot = null; n.shotDirty = true; }
        }));
        sel = { node: (B().nodes[0] || {}).id || null, edge: null, layer: null };
        mounted = { id: null, src: null, w: 0, h: 0 };
        $("#nodeLayer").innerHTML = "";
        Object.keys(EDGE_EL).forEach(k => { EDGE_EL[k].g.remove(); delete EDGE_EL[k]; });
        markDirty(); renderAll(); applyMode();
        toast("불러왔습니다. 공유하려면 저장하세요.", "ok");
      } catch (err) { toast("JSON을 읽지 못했습니다", "bad"); }
    };
    fr.readAsText(f);
  };
  inp.click();
}

/* ---------------- 데이터 정규화 ----------------
   태그 스키마 개편(2026-08) 이전 문서를 열어도 깨지지 않도록, 예전 필드
   (event/selector, props의 k/v)를 신규 필드로 옮겨 채운다. */
function normalizeTag(t) {
  t = t || {};
  const out = Object.assign({
    common: false, screenKo: "", path: "", eventKo: "", eventEn: "", area: "", trigger: "click",
    channels: [], action: "", props: [], status: "todo", note: "",
    testSampleWebPc: "", testSampleWebMo: "", testSampleAppAos: "", testSampleAppIos: ""
  }, t);
  if (!out.eventEn && t.event) out.eventEn = t.event;
  if (!out.area && t.selector) out.area = t.selector;
  out.props = (out.props || []).map(p => (p && (p.en != null || p.ko != null || p.sample != null))
    ? { ko: p.ko || "", en: p.en || "", type: p.type || "string", sample: p.sample || "" }
    : { ko: "", en: (p && p.k) || "", type: "string", sample: (p && p.v) || "" });
  return out;
}
function normalizeBoard(b) {
  b = b || {};
  b.id = b.id || uid("b");
  b.name = b.name || "여정";
  b.lanes = b.lanes || [];
  b.nodes = (b.nodes || []).map(n => Object.assign({
    kind: "page", path: "", note: "", shot: null, shotData: null, thumb: null,
    shotW: DOC_W, shotH: DOC_H, hue: "none", size: "m", sharp: false, tags: [], camps: [], layers: []
  }, n));
  b.nodes.forEach(n => { n.tags = (n.tags || []).map(normalizeTag); });
  b.edges = (b.edges || []).map(e => Object.assign({
    label: "", style: "solid", kind: "arrow", route: "curve", hue: "none", width: 2, head: "m", a1: "auto", a2: "auto", points: []
  }, e));
  b.edges.forEach(e => { if (e.kind === "loop") e.kind = "arrow"; });   // 루프 화살표는 더 이상 쓰지 않는다
  b.view = Object.assign({ zoom: 0.8, panX: 24, panY: 12, fitted: true }, b.view || {});
  return b;
}
function normalize(s) {
  s = s || {};
  if (!s.boards) {                                   // v1(단일 판) → v2(보드 여러 개)
    const u = s.ui || {};
    s.boards = [{
      id: "b1", name: "메인 여정", nodes: s.nodes || [], edges: s.edges || [], sel: u.sel,
      view: { zoom: u.zoom || 0.8, panX: u.panX || 24, panY: u.panY || 12, fitted: true }
    }];
    delete s.nodes; delete s.edges;
  }
  s.boards = s.boards.map(normalizeBoard);
  if (!s.boards.length) s.boards = [newBoard("메인 여정")];
  s.bi = clamp(s.bi || 0, 0, s.boards.length - 1);
  s.ui = Object.assign({ flowH: 372, leftW: 274, rightW: 300, focus: "all", snap: true }, s.ui || {});
  if (s.ui.density) { s.ui.focus = s.ui.density === "simple" ? "simple" : "all"; delete s.ui.density; }
  if (!FOCUS[s.ui.focus]) s.ui.focus = "all";
  ["zoom", "panX", "panY", "sel", "fitted"].forEach(k => delete s.ui[k]);
  s.title = s.title || "고객 여정 태그 맵";
  s.updatedAt = s.updatedAt || 0;
  s.cloud = s.cloud || null;          // 이미지 호스팅(Cloudinary) 설정 — 문서에 같이 저장돼 모두에게 적용된다
  s.v = 2;
  return s;
}
function renderAll() {
  syncBoardName(); syncFocusBtn();
  applySizes(); applyTransform(); renderFlow();
  if (!B().nodes.some(n => n.id === sel.node)) sel.node = (B().nodes[0] || {}).id || null;
  renderStage(); renderPanels(); invalidateViews();
  seedHistoryForAllBoards();
}

async function boot() {
  initFlow(); initStage(); initPanels(); initTagView(); initCampView(); initAlbumView(); initShell(); initSplitters(); initImport(); initBoards(); initAuth();
  initMinimap(); wireUndoRedoButtons(); initLaneInteractions();

  /* 0) 서버(Supabase) 모드 — 구글 로그인 + 역할 권한 */
  if (supaOn()) {
    if (readCallback() === "redirect") return;   // 로그인 시작 지점으로 되돌아가는 중
    loadSession();
    await fetchMe();
    applyRoleUI();
    let ok = false;
    if (me) { try { ok = await serverLoad(); } catch (e) { toast("서버에서 불러오지 못했습니다", "bad"); } }
    if (!me) { setSaveChip("off", "로그인이 필요합니다"); renderAll(); }
    else if (!ok) { setSaveChip("dirty", "서버에 문서가 없습니다 — 저장하면 만들어집니다"); renderAll(); }
    $("#btnShare").innerHTML = ico("share") + "<span>서버 저장</span>";
    updateStorageUI(); initLock();
    return;
  }

  const api = await claudeApi();
  saveAvail = !!api;

  let remote = null;                                  // 1) Artifact 공유본
  if (location.protocol !== "file:" && window.claude) {   // 자체 호스팅에서는 없는 파일이라 요청하지 않는다
    try {
      const r = await fetch("data/journey.json", { cache: "no-store" });
      if (r.ok) remote = normalize(await r.json());
    } catch (e) { /* 아직 저장 전 */ }
  }
  let draft = null;                                   // 2) 저장 안 된 로컬 초안
  try { draft = await idbGet(DRAFT_KEY); } catch (e) {}

  if (remote) {
    state = remote;
    savedRefs = collectRefs();
    setSaveChip("ok", "공유본 · " + timeAgo(remote.updatedAt));
  }
  if (draft && draft.data) {
    const newer = !remote || (draft.base === remote.updatedAt && draft.savedAt > (remote.updatedAt || 0));
    if (newer) {
      state = normalize(draft.data);
      savedRefs = draft.refs || collectRefs();
      dirty = true; setSaveChip("dirty", "저장 안 된 변경 있음");
    }
  }
  if (!remote && !draft) setSaveChip("dirty", "샘플 데이터");

  const b = B();
  sel.node = b.sel && b.nodes.some(n => n.id === b.sel) ? b.sel : (b.nodes[0] || {}).id || null;
  if (!api && !dirty) setSaveChip("off", "로컬 전용");

  renderAll();
  updateStorageUI();
  initLock();
  if (!B().view.fitted) { fitFlow(); B().view.fitted = true; setSaveChip("dirty", saveAvail ? "샘플 데이터 · 저장 전" : "샘플 데이터"); }
}
function collectRefs() {
  return state.boards.reduce((a, b) => a.concat(b.nodes.filter(n => n.shot && n.shot.ref).map(n => n.shot.ref)), []);
}
boot();
</script>
