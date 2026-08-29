
/* ========================================================================
   성과 추이 — 구글 시트 3.개인화RAW 를 월 단위로 집계해 보여 준다.

   가로축은 월, 세로축은 성과. CTR 은 곡선(왼쪽 축), CVR 은 세로 막대(오른쪽 축)로
   같은 차트에 겹쳐 그린다 — CVR 이 CTR 보다 훨씬 작아 축을 나누지 않으면 바닥에 붙는다.
   ======================================================================== */
const PERF_C = ["#2f6fed", "#e0483f", "#12a97a", "#8b5cf6", "#e08a1e", "#0ea5b7"];
const perfFilter = { q: "", goal: "all", chan: "all", owner: "all", seg: "all" };
let perfPicked = [];                     // 차트에 그릴 캠페인코드 (최대 6개)

const pct1 = v => (v == null ? "-" : v.toFixed(1) + "%");
const kNum = v => (v == null ? "-" : Math.round(v).toLocaleString("ko-KR"));

/* ---------------- 집계 ---------------- */
/* 같은 캠페인·같은 달에 여러 줄이 있으면 횟수는 더하고, 비율은 수신 수로 가중평균한다 */
function perfByCampMonth() {
  const map = {};
  SHEETS.perf.forEach(r => {
    const k = r.code + "|" + r.month;
    const b = map[k] || (map[k] = {
      code: r.code, month: r.month, goal: r.goal, title: r.title, fullName: r.fullName,
      chan: r.chan, chanCode: r.chanCode, owner: r.owner,
      sent: 0, recv: 0, recvU: 0, open: 0, conv: 0, revenue: 0, _w: 0, _ctr: 0, _cvr: 0
    });
    ["sent", "recv", "recvU", "open", "conv", "revenue"].forEach(k2 => { b[k2] += r[k2] || 0; });
    const w = r.recv || r.sent || 1;
    b._w += w;
    if (r.ctrPct != null) b._ctr += r.ctrPct * w;
    if (r.cvrPct != null) b._cvr += r.cvrPct * w;
  });
  return Object.values(map).map(b => {
    b.ctr = b._w ? b._ctr / b._w : null;
    b.cvr = b._w ? b._cvr / b._w : null;
    return b;
  });
}
let perfCache = null;
function perfRows() {
  if (!perfCache || perfCache.at !== SHEETS.at) perfCache = { at: SHEETS.at, rows: perfByCampMonth() };
  return perfCache.rows;
}
const perfMonths = () => Array.from(new Set(perfRows().map(r => r.month))).sort();

/* 캠페인 하나의 월별 이력 (오래된 달 → 최근 달) */
function perfHistory(code) {
  return perfRows().filter(r => r.code === code).sort((a, b) => a.month.localeCompare(b.month));
}
/* 가장 최근 달과 그 직전 달 — 여정 지도 배지에 쓴다 */
function perfLatest(code) {
  const h = perfHistory(code);
  if (!h.length) return null;
  const cur = h[h.length - 1], prev = h[h.length - 2] || null;
  return {
    month: cur.month, ctr: cur.ctr, cvr: cur.cvr,
    dCtr: prev && cur.ctr != null && prev.ctr != null ? cur.ctr - prev.ctr : null,
    dCvr: prev && cur.cvr != null && prev.cvr != null ? cur.cvr - prev.cvr : null
  };
}
/* 캠페인 이름 옆에 붙는 전월 실적 배지 — CTR 파랑 · CVR 빨강 */
function perfBadge(code, small) {
  const p = code ? perfLatest(code) : null;
  if (!p) return "";
  const arrow = d => (d == null || Math.abs(d) < 0.05 ? "" : '<i class="' + (d > 0 ? "up" : "dn") + '">' + (d > 0 ? "▲" : "▼") + Math.abs(d).toFixed(1) + "</i>");
  return '<span class="perfbadge' + (small ? " sm" : "") + '" title="' + esc(p.month) + ' 기준 · 직전 달 대비 증감">' +
    '<span class="pb ctr">CTR ' + pct1(p.ctr) + arrow(p.dCtr) + "</span>" +
    '<span class="pb cvr">CVR ' + pct1(p.cvr) + arrow(p.dCvr) + "</span>" +
  "</span>";
}

/* ---------------- 차트 ---------------- */
/* 점들을 부드러운 곡선으로 잇는다 (Catmull-Rom → 3차 베지어) */
function smoothPath(pts) {
  if (!pts.length) return "";
  if (pts.length < 3) return "M" + pts.map(p => p[0] + " " + p[1]).join(" L");
  let d = "M" + pts[0][0] + " " + pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += " C" + c1x + " " + c1y + " " + c2x + " " + c2y + " " + p2[0] + " " + p2[1];
  }
  return d;
}
function niceMax(v) {
  if (!v || v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const s = v / mag;
  return (s <= 1 ? 1 : s <= 2 ? 2 : s <= 2.5 ? 2.5 : s <= 5 ? 5 : 10) * mag;
}
function perfChartSvg(series, months) {
  const W = 940, H = 340, L = 54, R = 54, T = 18, Bm = 46;
  const iw = W - L - R, ih = H - T - Bm;
  if (!months.length || !series.length)
    return '<div class="empty">' + ico("mega") + "<div>왼쪽 목록에서 캠페인을 선택하면 추이가 그려집니다</div></div>";

  const ctrMax = niceMax(Math.max.apply(null, series.reduce((a, s) => a.concat(s.ctr.filter(v => v != null)), [0])));
  const cvrMax = niceMax(Math.max.apply(null, series.reduce((a, s) => a.concat(s.cvr.filter(v => v != null)), [0])));
  const step = iw / months.length;
  const cx = i => L + step * (i + 0.5);
  const yCtr = v => T + ih - (v / ctrMax) * ih;
  const yCvr = v => T + ih - (v / cvrMax) * ih;

  const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const y = T + ih - f * ih;
    return '<line class="gl" x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '"/>' +
      '<text class="ax l" x="' + (L - 8) + '" y="' + (y + 4) + '">' + (ctrMax * f).toFixed(ctrMax < 5 ? 1 : 0) + "%</text>" +
      '<text class="ax r" x="' + (W - R + 8) + '" y="' + (y + 4) + '">' + (cvrMax * f).toFixed(cvrMax < 5 ? 1 : 0) + "%</text>";
  }).join("");

  const xlab = months.map((m, i) =>
    '<text class="ax c" x="' + cx(i) + '" y="' + (T + ih + 20) + '">' + esc(m.slice(2)) + "</text>").join("");

  /* CVR — 달마다 시리즈 수만큼 나란히 세운 막대 */
  const bw = Math.max(4, Math.min(20, (step * 0.56) / series.length));
  const bars = series.map((s, si) => s.cvr.map((v, i) => {
    if (v == null) return "";
    const x = cx(i) - (series.length * bw) / 2 + si * bw;
    const y = yCvr(v), h = Math.max(1, T + ih - y);
    return '<rect class="bar" x="' + x + '" y="' + y + '" width="' + (bw - 1.5) + '" height="' + h + '" fill="' + s.color + '" opacity=".34">' +
      "<title>" + esc(s.label) + " · " + esc(months[i]) + " CVR " + pct1(v) + "</title></rect>";
  }).join("")).join("");

  /* CTR — 부드러운 곡선 */
  const lines = series.map(s => {
    const pts = s.ctr.map((v, i) => (v == null ? null : [cx(i), yCtr(v)])).filter(Boolean);
    if (!pts.length) return "";
    return '<path class="ln" d="' + smoothPath(pts) + '" stroke="' + s.color + '"/>' +
      pts.map((p, i) => '<circle class="dot" cx="' + p[0] + '" cy="' + p[1] + '" r="3.4" fill="' + s.color + '"><title>' +
        esc(s.label) + " · CTR " + pct1(s.ctr.filter(v => v != null)[i]) + "</title></circle>").join("");
  }).join("");

  const legend = series.map(s =>
    '<span class="lg"><i style="background:' + s.color + '"></i>' + esc(s.label) + "</span>").join("");

  return '<div class="chartwrap"><svg class="perfchart" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="xMidYMid meet">' +
      grid + xlab + bars + lines +
      '<text class="ax cap l" x="' + L + '" y="' + (T - 4) + '">CTR (곡선)</text>' +
      '<text class="ax cap r" x="' + (W - R) + '" y="' + (T - 4) + '">CVR (막대)</text>' +
    "</svg>" +
    '<div class="legend">' + legend + "</div></div>";
}

/* ---------------- 뷰 ---------------- */
let perfIndexCache = null;
function perfCampIndex() {
  if (perfIndexCache && perfIndexCache.at === SHEETS.at) return perfIndexCache.list;
  const rows = perfRows();
  const byCode = {};
  rows.forEach(r => {
    const m = campByCode(r.code);
    const b = byCode[r.code] || (byCode[r.code] = {
      code: r.code,
      label: m ? m.label : (r.title ? r.title + (r.chan ? " [" + r.chan + "]" : "") : r.code),
      fullName: m ? m.fullName : r.fullName,
      goal: (m && m.goal) || r.goal || "미분류",
      seg: (m && m.title) || r.title || "",
      chan: (m && m.chan) || r.chan || "",
      owner: (m && m.owner) || r.owner || "",
      months: 0, inSheet: !!m
    });
    b.months++;
  });
  const list = Object.values(byCode).sort((a, b) =>
    (a.goal || "").localeCompare(b.goal || "", "ko") || a.code.localeCompare(b.code));
  perfIndexCache = { at: SHEETS.at, list };
  return list;
}
function perfCampList() {
  const q = perfFilter.q;
  return perfCampIndex().filter(b =>
    (perfFilter.goal === "all" || b.goal === perfFilter.goal) &&
    (perfFilter.chan === "all" || b.chan === perfFilter.chan) &&
    (perfFilter.owner === "all" || b.owner === perfFilter.owner) &&
    (perfFilter.seg === "all" || b.seg === perfFilter.seg) &&
    (!q || (b.code + " " + b.goal + " " + b.label + " " + b.fullName + " " + b.owner).toLowerCase().indexOf(q) >= 0)
  );
}
function perfSeriesFor(codes, months) {
  return codes.map((code, i) => {
    const h = perfHistory(code);
    const at = m => h.find(x => x.month === m) || null;
    const m0 = campByCode(code);
    return {
      code,
      label: m0 ? m0.label : ((h[0] && h[0].title) || code),
      color: PERF_C[i % PERF_C.length],
      ctr: months.map(m => { const r = at(m); return r ? r.ctr : null; }),
      cvr: months.map(m => { const r = at(m); return r ? r.cvr : null; })
    };
  });
}
function renderPerfView(force) {
  if (!force && !viewStale.perf) return;
  viewStale.perf = false;
  const wrap = $("#view-perf");
  if (!wrap) return;
  $(".syncbar", wrap).innerHTML = syncBarHtml();

  const all = perfRows();
  const list = perfCampList();
  const codes = list.map(b => b.code);
  perfPicked = perfPicked.filter(c => codes.indexOf(c) >= 0);
  if (!perfPicked.length && codes.length) perfPicked = codes.slice(0, 1);

  const opts = (key, cur, label) => {
    const names = Array.from(new Set(perfCampIndex().map(x => String(x[key] || "").trim()).filter(Boolean)));
    return '<option value="all">' + esc(label) + "</option>" +
      names.sort((a, b) => a.localeCompare(b, "ko")).map(v => '<option value="' + esc(v) + '"' + (cur === v ? " selected" : "") + ">" + esc(v) + "</option>").join("");
  };
  $("#perfGoal").innerHTML = opts("goal", perfFilter.goal, "모든 목표 (대분류)");
  $("#perfChan").innerHTML = opts("chan", perfFilter.chan, "모든 채널");
  $("#perfOwner").innerHTML = opts("owner", perfFilter.owner, "모든 담당자");
  $("#perfSeg").innerHTML = opts("seg", perfFilter.seg, "모든 캠페인구분");

  const months = perfMonths();
  const last = months[months.length - 1];
  const lastRows = all.filter(r => r.month === last);
  const wAvg = key => {
    let w = 0, s = 0;
    lastRows.forEach(r => { const q = r.recv || r.sent || 0; if (r[key] != null && q) { w += q; s += r[key] * q; } });
    return w ? s / w : null;
  };
  $("#perfStats").innerHTML = [
    '<div class="stat" style="--c:var(--accent)"><span class="n">' + (months.length ? esc(months[0]) + " ~ " + esc(last) : "-") + '</span><span class="t">집계 기간</span></div>',
    '<div class="stat" style="--c:var(--camp)"><span class="n">' + codes.length + '</span><span class="t">캠페인</span></div>',
    '<div class="stat" style="--c:#2f6fed"><span class="n">' + pct1(wAvg("ctr")) + '</span><span class="t">' + esc(last || "-") + ' 평균 CTR</span></div>',
    '<div class="stat" style="--c:#e0483f"><span class="n">' + pct1(wAvg("cvr")) + '</span><span class="t">' + esc(last || "-") + ' 평균 CVR</span></div>'
  ].join("");

  /* 목표(대분류)로 묶은 캠페인 목록 — 체크한 것이 차트에 그려진다 */
  let html = "", goal = null;
  list.forEach(b => {
    if (b.goal !== goal) { goal = b.goal; html += '<div class="perfgroup">' + esc(goal) + "</div>"; }
    const on = perfPicked.indexOf(b.code) >= 0;
    html += '<label class="pickrow' + (on ? " on" : "") + '">' +
      '<input type="checkbox" data-perf-pick="' + esc(b.code) + '"' + (on ? " checked" : "") + ">" +
      '<span class="pickmain"><b>' + esc(b.label) + "</b>" +
        "<em>" + esc(b.code) + " · " + b.months + "개월" + (b.owner ? " · " + esc(b.owner) : "") +
        (b.inSheet ? "" : " · <span style=\"color:var(--warn)\">마스터에 없음</span>") + "</em></span>" +
      perfBadge(b.code, true) + "</label>";
  });
  $("#perfList").innerHTML = html || '<div class="empty">' + ico("mega") + "<div>조건에 맞는 캠페인이 없습니다</div></div>";
  $("#perfChart").innerHTML = perfChartSvg(perfSeriesFor(perfPicked, months), months);

  /* 선택한 캠페인의 월별 수치 표 */
  const picked = perfPicked.map(c => ({ code: c, h: perfHistory(c) }));
  $("#perfTable").innerHTML = picked.length
    ? '<table class="ptable"><thead><tr><th>캠페인</th><th>월</th><th class="r">전달</th><th class="r">수신</th>' +
      '<th class="r">오픈</th><th class="r">예약/반응</th><th class="r">CTR</th><th class="r">CVR</th><th class="r">매출</th></tr></thead><tbody>' +
      picked.map(({ code, h }) => {
        const m0 = campByCode(code);
        return h.slice().reverse().map((r, i) =>
          "<tr>" + (i === 0 ? '<td rowspan="' + h.length + '">' + esc(m0 ? m0.label : code) + '<em class="mono">' + esc(code) + "</em></td>" : "") +
            "<td>" + esc(r.month) + '</td><td class="r">' + kNum(r.sent) + '</td><td class="r">' + kNum(r.recv) +
            '</td><td class="r">' + kNum(r.open) + '</td><td class="r">' + kNum(r.conv) +
            '</td><td class="r b" style="color:#2f6fed">' + pct1(r.ctr) + '</td><td class="r b" style="color:#e0483f">' + pct1(r.cvr) +
            '</td><td class="r">' + kNum(r.revenue) + "</td></tr>").join("");
      }).join("") + "</tbody></table>"
    : "";

  /* 실적 기준 — 이 캠페인의 CTR·CVR 이 무엇을 무엇으로 나눈 값인지 */
  $("#perfBasis").innerHTML = perfPicked.map(code => {
    const m = campByCode(code);
    if (!m) return "";
    const ctr = basisOf(m, "ctr"), cvr = basisOf(m, "cvr");
    if (!ctr.length && !cvr.length) return "";
    return '<div class="basiscard"><h4>' + esc(m.label) + "</h4>" +
      (ctr.length ? '<div class="brow"><span class="chip" style="--c:#2f6fed">CTR 기준</span><span>' + esc(ctr.join("  ·  ")) + "</span></div>" : "") +
      (cvr.length ? '<div class="brow"><span class="chip" style="--c:#e0483f">CVR 기준</span><span>' + esc(cvr.join("  ·  ")) + "</span></div>" : "") +
      "</div>";
  }).join("");
}
function initPerfView() {
  const wrap = $("#view-perf");
  if (!wrap) return;
  ["perfGoal", "perfChan", "perfOwner", "perfSeg"].forEach(id => {
    $("#" + id).addEventListener("change", e => {
      perfFilter[id.replace("perf", "").toLowerCase()] = e.target.value;
      renderPerfView(true);
    });
  });
  $("#perfSearch").addEventListener("input", e => { perfFilter.q = e.target.value.toLowerCase().trim(); renderPerfView(true); });
  $("#perfList").addEventListener("change", e => {
    const cb = e.target.closest("[data-perf-pick]");
    if (!cb) return;
    const code = cb.dataset.perfPick;
    if (cb.checked) {
      if (perfPicked.length >= 6) { cb.checked = false; return toast("한 번에 6개까지 겹쳐 볼 수 있습니다", "bad"); }
      if (perfPicked.indexOf(code) < 0) perfPicked.push(code);
    } else perfPicked = perfPicked.filter(c => c !== code);
    renderPerfView(true);
  });
}
