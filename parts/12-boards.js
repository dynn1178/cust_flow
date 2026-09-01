
/* ========================================================================
   여정 보드 — 여러 판을 만들고 전환·복제·삭제·템플릿으로 주고받기
   태그 목록과 캠페인 목록은 모든 보드를 한 번에 보여준다.
   ======================================================================== */
function newBoard(name) {
  return { id: uid("b"), name: name || "새 여정", nodes: [], edges: [], lanes: [], sel: null, view: { zoom: 1, panX: 40, panY: 30, fitted: true } };
}
function syncBoardName() {
  $("#boardName").textContent = B().name;
  $("#btnBoards").title = "보드 " + state.boards.length + "개 · 클릭해서 전환";
}
function switchBoard(i) {
  if (i === state.bi || !state.boards[i]) return;
  B().sel = sel.node;
  state.bi = i;
  const b = B();
  sel = { node: b.sel && b.nodes.some(n => n.id === b.sel) ? b.sel : (b.nodes[0] || {}).id || null, edge: null, layer: null };
  mounted = { id: null, key: null, w: 0, h: 0 };
  Object.keys(EDGE_EL).forEach(k => { EDGE_EL[k].g.remove(); delete EDGE_EL[k]; });
  Object.keys(NSZ).forEach(k => delete NSZ[k]);
  $("#nodeLayer").innerHTML = "";
  historyOf(b); updateHistoryUI();
  syncBoardName(); applyTransform(); renderFlow(); renderStage(); renderPanels();
  markDirty();
}
function closeMenu() { $("#menuRoot").innerHTML = ""; }
function openMenu(html, anchorEl, onClick) {
  const root = $("#menuRoot");
  root.innerHTML = '<div class="menu glass">' + html + "</div>";
  const m = $(".menu", root), r = anchorEl.getBoundingClientRect();
  m.style.left = clamp(r.left, 8, innerWidth - 300) + "px";
  m.style.top = Math.min(r.bottom + 6, innerHeight - m.offsetHeight - 10) + "px";
  m.addEventListener("click", e => {
    const it = e.target.closest("[data-act],[data-go]");
    if (!it) return;
    closeMenu(); onClick(it);
  });
  const away = e => { if (!e.target.closest(".menu") && !e.target.closest("#btnBoards")) { closeMenu(); document.removeEventListener("pointerdown", away); } };
  setTimeout(() => document.addEventListener("pointerdown", away), 0);
}
function openBoardMenu() {
  const list = state.boards.map((b, i) =>
    '<button class="mi' + (i === state.bi ? " on" : "") + '" data-go="' + i + '">' + ico("map", "xs") +
    esc(b.name) + '<span class="cnt">' + b.nodes.length + "판</span></button>").join("");
  const acts = canEdit() ? '<div class="sepline"></div>' +
    '<button class="mi" data-act="add">' + ico("plus", "xs") + "새 보드 추가</button>" +
    '<button class="mi" data-act="rename">' + ico("edit", "xs") + "이름 변경</button>" +
    '<button class="mi" data-act="dup">' + ico("copy", "xs") + "이 보드 복제</button>" +
    (state.boards.length > 1 ? '<button class="mi" data-act="del" style="color:var(--bad)">' + ico("trash", "xs") + "이 보드 삭제</button>" : "")
    : '<div class="sepline"></div><div class="mi" style="cursor:default">' + ico("lock", "xs") + "보기 전용입니다</div>";
  openMenu(list + acts, $("#btnBoards"), it => {
    if (it.dataset.go != null) return switchBoard(+it.dataset.go);
    const a = it.dataset.act;
    if (a === "add") {
      openForm({
        title: "새 보드", icon: "map", okText: "만들기",
        fields: [{ k: "name", label: "보드 이름", ph: "예: 리텐션 · 재구매 여정" }],
        values: { name: "" },
        onSave: v => {
          state.boards.push(newBoard(v.name || "새 여정"));
          state.bi = state.boards.length - 1;
          sel = { node: null, edge: null, layer: null };
          mounted = { id: null, key: null, w: 0, h: 0 };
          $("#nodeLayer").innerHTML = "";
          Object.keys(EDGE_EL).forEach(k => { EDGE_EL[k].g.remove(); delete EDGE_EL[k]; });
          historyOf(B()); updateHistoryUI();
          syncBoardName(); applyTransform(); renderFlow(); renderStage(); renderPanels();
          markDirty(); toast("보드를 만들었습니다. 페이지를 추가하거나 스크린샷을 끌어다 놓으세요.", "ok");
        }
      });
    }
    if (a === "rename") {
      openForm({
        title: "보드 이름", icon: "edit",
        fields: [{ k: "name", label: "이름" }], values: { name: B().name },
        onSave: v => { B().name = v.name || B().name; syncBoardName(); markDirty(); renderTagView(true); renderCampView(true); }
      });
    }
    if (a === "dup") {
      const copy = JSON.parse(JSON.stringify(B()));
      copy.id = uid("b"); copy.name = B().name + " 복사본";
      copy.nodes.forEach(n => { n.shotDirty = !!n.shotData; });
      state.boards.splice(state.bi + 1, 0, copy);
      switchBoard(state.bi + 1); syncBoardName();
      toast("보드를 복제했습니다", "ok");
    }
    if (a === "del") {
      confirmDel('"' + B().name + '" 보드를 삭제할까요? 이 보드의 페이지·태그·캠페인이 모두 사라집니다.', () => {
        const goneId = B().id;
        state.boards.splice(state.bi, 1);
        state.bi = Math.max(0, state.bi - 1);
        delete history[goneId];
        sel = { node: (B().nodes[0] || {}).id || null, edge: null, layer: null };
        mounted = { id: null, key: null, w: 0, h: 0 };
        $("#nodeLayer").innerHTML = "";
        Object.keys(EDGE_EL).forEach(k => { EDGE_EL[k].g.remove(); delete EDGE_EL[k]; });
        historyOf(B()); updateHistoryUI();
        syncBoardName(); applyTransform(); renderFlow(); renderStage(); renderPanels();
        markDirty();
      });
    }
  });
}
function initBoards() {
  $("#btnBoards").addEventListener("click", openBoardMenu);
  syncBoardName();
}
