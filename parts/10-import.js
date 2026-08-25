
/* ========================================================================
   화면 이미지 등록 — 캔버스 드롭 · 노드에서 바로 올리기 · 일괄 등록
   ======================================================================== */
function pickFiles(cb) {
  const inp = $("#filesPick"); inp.value = "";
  inp.onchange = () => { const f = Array.prototype.slice.call(inp.files || []); if (f.length) cb(f); };
  inp.click();
}
function pickDir(cb) {
  const inp = $("#dirPick"); inp.value = "";
  inp.onchange = () => {
    const f = Array.prototype.slice.call(inp.files || []).filter(x => /^image\//.test(x.type));
    if (f.length) cb(f); else toast("폴더에 이미지가 없습니다", "bad");
  };
  inp.click();
}
function baseName(f) { return (f.name || "").replace(/\.[a-z0-9]+$/i, ""); }
function normName(s) {
  return String(s || "").toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/^[\s._-]*\d+[\s._-]*/, "")      // 01_, 1-, 02 같은 앞 번호 제거
    .replace(/[\s._\-/:()\[\]{}·,]+/g, "");
}
/* 파일명 ↔ 페이지 이름·경로 자동 매칭 */
function guessNode(file) {
  const f = normName(file.name);
  if (!f) return null;
  let best = null, score = 0;
  B().nodes.forEach(n => {
    [n.name, n.path].forEach(cand => {
      const t = normName(cand);
      if (!t || t.length < 2) return;
      let sc = 0;
      if (t === f) sc = 100;
      else if (t.indexOf(f) === 0 || f.indexOf(t) === 0) sc = 80;      // 앞에서부터 일치
      else if (t.indexOf(f) >= 0 || f.indexOf(t) >= 0) sc = 66;        // 어딘가 포함
      if (sc > score || (sc === score && sc > 0 && best && shotSrc(best) && !shotSrc(n))) { score = sc; best = n; }
    });
  });
  return score >= 66 ? best : null;
}
/* 새 페이지 자리 — 기존 노드 아래쪽으로 줄맞춰 */
function freeSpot(i) {
  let maxY = 0, minX = 60;
  B().nodes.forEach(n => { maxY = Math.max(maxY, n.y + (NSZ[n.id] ? NSZ[n.id].h : 150)); minX = Math.min(minX, n.x); });
  return { x: minX + (i % 6) * 262, y: (B().nodes.length ? maxY + 60 : 90) + Math.floor(i / 6) * 236 };
}
function addNodeFor(name, at) {
  const p = at || freeSpot(0);
  const n = {
    id: uid("n"), kind: "page", name: name || "새 페이지", path: "", note: "",
    x: Math.round(p.x), y: Math.round(p.y), shot: null, shotData: null, thumb: null,
    shotW: DOC_W, shotH: DOC_H, hue: "none", size: "m", sharp: false, tags: [], camps: [], layers: []
  };
  B().nodes.push(n);
  return n;
}

/* ---------------- 일괄 등록 ---------------- */
function openBulkModal(files) {
  const rows = (files || []).map((f, i) => ({ file: f, target: (guessNode(f) || {}).id || "__new__", thumb: "", i }));
  const opt = (v, label, on) => '<option value="' + v + '"' + (on ? " selected" : "") + ">" + esc(label) + "</option>";
  const rowHtml = r =>
    '<div class="brow" data-row="' + r.i + '">' +
      '<img src="' + (r.thumb || "") + '" alt="" draggable="false">' +
      '<div class="fn">' + esc(r.file.name) + "<em>" + Math.round(r.file.size / 1024) + "KB</em></div>" +
      '<select class="field" data-target="' + r.i + '">' +
        opt("__new__", "+ 새 페이지로 추가", r.target === "__new__") +
        opt("__skip__", "건너뛰기", r.target === "__skip__") +
        B().nodes.map(n => opt(n.id, n.name, r.target === n.id)).join("") +
      "</select>" +
    "</div>";

  const body = rows.length
    ? '<p class="hint">파일 이름을 페이지 이름·경로와 맞춰 자동으로 짝지었습니다. 틀린 것만 바꾸세요. ' +
      '<span class="mono">01_홈.png</span>처럼 번호가 붙어 있어도 인식합니다.</p>' +
      '<div class="bulk" id="bulkList">' + rows.map(rowHtml).join("") + "</div>" +
      '<label class="bulkbar"><input type="checkbox" id="bulkChain"> 새로 만든 페이지를 파일 순서대로 연결하기</label>' +
      '<div class="bulkbar" id="bulkStatus"></div>'
    : '<div class="empty" style="border:2px dashed var(--stroke); border-radius:var(--r-md); padding:30px">' +
      ico("stack") + "<div>스크린샷 여러 장을 한 번에 등록합니다<br>여기에 파일을 끌어다 놓거나 아래에서 고르세요</div>" +
      '<div style="display:flex; gap:6px; margin-top:6px">' +
        '<button class="btn" data-more>' + ico("image", "xs") + "파일 고르기</button>" +
        '<button class="btn" data-dir>' + ico("folder", "xs") + "폴더에서 가져오기</button></div></div>";

  const root = modalHost();
  root.innerHTML =
    '<div class="scrim"><div class="modal glass" style="width:min(620px,100%)" role="dialog" aria-modal="true">' +
      '<div class="modal-head">' + ico("stack") + '<h3>화면 일괄 등록</h3><button class="btn icon sm" data-x>' + ico("close", "xs") + "</button></div>" +
      '<div class="modal-body" id="bulkBody">' + body + "</div>" +
      '<div class="modal-foot">' +
        (rows.length ? '<button class="btn" data-more>' + ico("plus", "xs") + "파일 더 담기</button>" : "") +
        '<div class="spacer"></div><button class="btn" data-x>취소</button>' +
        (rows.length ? '<button class="btn primary" data-run>' + rows.length + "장 등록</button>" : "") +
      "</div>" +
    "</div></div>";

  rows.forEach(async r => {                       // 미리보기는 뒤에서 채운다
    try {
      const t = await readImage(r.file, 90, 0.5, false);
      r.thumb = t.src;
      const el = $('[data-row="' + r.i + '"] img');
      if (el) el.src = t.src;
    } catch (e) {}
  });

  root.addEventListener("change", e => {
    const s = e.target.closest("[data-target]");
    if (s) rows[+s.dataset.target].target = s.value;
  });
  const modal = $(".modal", root);
  ["dragenter", "dragover"].forEach(t => modal.addEventListener(t, e => { e.preventDefault(); }));
  modal.addEventListener("drop", e => {
    e.preventDefault();
    const f = Array.prototype.slice.call(e.dataTransfer.files || []).filter(x => /^image\//.test(x.type));
    if (f.length) openBulkModal((files || []).concat(f));
  });
  root.addEventListener("click", async e => {
    if (e.target.closest("[data-x]") || e.target.classList.contains("scrim")) return closeModal();
    if (e.target.closest("[data-more]")) { closeModal(); return pickFiles(more => openBulkModal((files || []).concat(more))); }
    if (e.target.closest("[data-dir]")) { closeModal(); return pickDir(more => openBulkModal((files || []).concat(more))); }
    const run = e.target.closest("[data-run]");
    if (!run) return;
    run.disabled = true;
    const chain = $("#bulkChain").checked;
    const status = $("#bulkStatus");
    const made = [];
    let done = 0, failed = 0, seen = 0;
    for (const r of rows) {
      seen++;
      if (r.target === "__skip__") continue;
      status.textContent = "처리 중… " + seen + " / " + rows.length;
      const el = $('[data-row="' + r.i + '"]');
      try {
        const node = r.target === "__new__" ? addNodeFor(baseName(r.file), freeSpot(made.length)) : nodeById(r.target);
        if (!node) continue;
        if (r.target === "__new__") made.push(node);
        await setShot(r.file, node, true);
        done++;
      } catch (err) { failed++; }
      if (el) el.classList.add("done");
    }
    if (chain) {
      for (let i = 1; i < made.length; i++) {
        if (!B().edges.some(x => x.from === made[i - 1].id && x.to === made[i].id))
          B().edges.push({ id: uid("e"), from: made[i - 1].id, to: made[i].id, label: "", style: "solid", kind: "arrow",
            route: "curve", hue: "none", width: 2, a1: "auto", a2: "auto", points: [] });
      }
    }
    closeModal();
    markDirty(); renderFlow(); renderPanels();
    if (made.length) { selectNode(made[0].id); fitFlow(); } else renderStage();
    toast(done + "장 등록 완료" + (made.length ? " · 새 페이지 " + made.length + "개" : "") + (failed ? " · 실패 " + failed : ""), failed ? "bad" : "ok");
  });
}

/* ---------------- 노드 버튼 ----------------
   캔버스에 파일을 끌어다 놓는 등록은 없앴다 — 노드 이동(포인터 드래그)과
   브라우저 네이티브 파일 드래그가 겹쳐 충돌했기 때문. 화면 등록은 노드의
   "설정" 버튼(화면 이미지) · 화면 일괄 등록 · Ctrl+V · 스테이지 드롭으로 한다. */
function initImport() {
  $("#btnBulk").addEventListener("click", () => openBulkModal([]));
}
