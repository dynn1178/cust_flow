
/* ========================================================================
   성과 추이 — 구글 시트 3.개인화RAW 를 월 단위로 집계해 보여 준다.

   가로축은 월, 세로축은 성과. CTR 은 곡선(왼쪽 축), CVR 은 세로 막대(오른쪽 축)로
   같은 차트에 겹쳐 그린다 — CVR 이 CTR 보다 훨씬 작아 축을 나누지 않으면 바닥에 붙는다.
   ======================================================================== */
const PERF_C = ["#2f6fed", "#e0483f", "#12a97a", "#8b5cf6", "#e08a1e", "#0ea5b7"];
const perfFilter = { q: "", goal: "all", chan: "all", owner: "all", seg: "all" };
let perfPicked = [];                          // 차트에 그릴 캠페인코드 (최대 6개)
const perfPeriod = { from: null, to: null };  // 집계 기간 — 직접 고른다
let perfShowLabels = true;                    // 각 점·막대에 값을 적을지

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

/* 캠페인 하나의 월별 이력 (오래된 달 → 최근 달).
   여정 지도·점검처럼 캠페인 수만큼 반복해 부르는 곳이 있어 색인을 한 번만 만들어 둔다. */
let histCache = null;
function perfHistory(code) {
  if (!histCache || histCache.at !== SHEETS.at) {
    const by = {};
    perfRows().forEach(r => { (by[r.code] = by[r.code] || []).push(r); });
    Object.keys(by).forEach(k => by[k].sort((a, b) => a.month.localeCompare(b.month)));
    histCache = { at: SHEETS.at, by: by };
  }
  return histCache.by[code] || [];
}
/* 비율의 분모를 되돌려 구한다 — 캠페인마다 CTR·CVR 의 분모가 달라서
   시트가 준 비율과 분자로부터 역산하는 편이 정확하다. 안 되면 수신 수로 대신한다. */
function denomOf(count, pct, fallback) {
  if (count != null && pct) {
    const d = count / (pct / 100);
    if (isFinite(d) && d >= 1) return Math.round(d);
  }
  return fallback || null;
}
/* 두 달의 비율 차이가 표본 수를 감안해도 의미가 있는지 (이항 비율 z-검정).
   수신 5만 건의 0.4%p 와 수신 71건의 0.4%p 는 전혀 다른 이야기다. */
function ratioZ(p1, n1, p2, n2) {
  if (p1 == null || p2 == null || !n1 || !n2) return null;
  const a = p1 / 100, b = p2 / 100;
  const pool = (a * n1 + b * n2) / (n1 + n2);
  const se = Math.sqrt(pool * (1 - pool) * (1 / n1 + 1 / n2));
  if (!se || !isFinite(se)) return null;
  return (a - b) / se;
}
const SIG_Z = 1.96;                        // 95% 신뢰수준
function monthZ(cur, prev, kind) {
  if (!cur || !prev) return null;
  const k = kind === "ctr" ? "open" : "conv";
  return ratioZ(cur[kind], denomOf(cur[k], cur[kind], cur.recv),
                prev[kind], denomOf(prev[k], prev[kind], prev.recv));
}
/* 가장 최근 달과 그 직전 달 — 여정 지도 배지에 쓴다 */
function perfLatest(code) {
  const h = perfHistory(code);
  if (!h.length) return null;
  const cur = h[h.length - 1], prev = h[h.length - 2] || null;
  const zc = monthZ(cur, prev, "ctr"), zv = monthZ(cur, prev, "cvr");
  return {
    month: cur.month, ctr: cur.ctr, cvr: cur.cvr, prevMonth: prev ? prev.month : null,
    dCtr: prev && cur.ctr != null && prev.ctr != null ? cur.ctr - prev.ctr : null,
    dCvr: prev && cur.cvr != null && prev.cvr != null ? cur.cvr - prev.cvr : null,
    sigCtr: zc != null && Math.abs(zc) >= SIG_Z,
    sigCvr: zv != null && Math.abs(zv) >= SIG_Z
  };
}
/* 급락 감지 — 최신월이 직전 3개월 평균보다 30% 이상 낮고, 그 차이가 통계적으로도 유의할 때 */
const DROP_RATE = 0.3;
function perfAlerts() {
  const out = [];
  perfCampIndex().forEach(b => {
    const h = perfHistory(b.code);
    if (h.length < 3) return;
    const cur = h[h.length - 1], base = h.slice(Math.max(0, h.length - 4), h.length - 1);
    ["ctr", "cvr"].forEach(kind => {
      const vals = base.map(r => r[kind]).filter(v => v != null);
      if (!vals.length || cur[kind] == null) return;
      const avg = vals.reduce((a, v) => a + v, 0) / vals.length;
      if (!avg || cur[kind] >= avg * (1 - DROP_RATE)) return;
      const z = monthZ(cur, base[base.length - 1], kind);
      if (z == null || Math.abs(z) < SIG_Z) return;      // 표본이 적어 흔들린 것은 거른다
      out.push({ code: b.code, label: b.label, kind: kind, month: cur.month,
        cur: cur[kind], base: avg, drop: (avg - cur[kind]) / avg });
    });
  });
  return out.sort((a, b) => b.drop - a.drop);
}
/* 캠페인 이름 옆에 붙는 최신월 실적 배지 — CTR 파랑 · CVR 빨강.
   mode "line" 은 여정 지도 노드 카드용으로, 라벨 없이 한 줄로 줄여 캠페인 이름과 같은 크기로 나온다.
   달마다 마지막 데이터가 있는 달이 다르므로 어느 달 실적인지 앞에 적는다. */
function perfBadge(code, mode) {
  const p = code ? perfLatest(code) : null;
  if (!p) return "";
  /* 화살표는 통계적으로 의미 있는 변화만 진하게 — 표본이 적어 흔들린 값은 흐리게 둔다 */
  const arrow = (d, sig) => (d == null || Math.abs(d) < 0.05 ? "" :
    '<i class="' + (d > 0 ? "up" : "dn") + (sig ? " sig" : "") + '">' + (d > 0 ? "▲" : "▼") + Math.abs(d).toFixed(1) + "</i>");
  const short = p.month.slice(2).replace("-", "");                 // 2026-07 → 2607
  const tip = p.month + " 실적 · 앞이 CTR, 뒤가 CVR" +
    (p.prevMonth ? " · " + p.prevMonth + " 대비 증감 (진한 화살표 = 표본을 감안해도 의미 있는 변화)" : "");
  if (mode === "line") {
    return '<span class="perfline" title="' + esc(tip) + '">' +
      '<span class="ctr">' + pct1(p.ctr) + arrow(p.dCtr, p.sigCtr) + "</span>" +
      '<span class="sep">/</span><span class="cvr">' + pct1(p.cvr) + arrow(p.dCvr, p.sigCvr) + "</span>" +
      '<span class="mon">(' + esc(short) + ")</span></span>";
  }
  return '<span class="perfbadge' + (mode === "sm" ? " sm" : "") + '" title="' + esc(tip) + '">' +
    '<span class="pb ctr">CTR ' + pct1(p.ctr) + arrow(p.dCtr, p.sigCtr) + "</span>" +
    '<span class="pb cvr">CVR ' + pct1(p.cvr) + arrow(p.dCvr, p.sigCvr) + "</span>" +
    '<span class="pb mon">' + esc(short) + "</span>" +
  "</span>";
}

/* ---------------- AARRR 단계 요약 ----------------
   목표별로 흩어져 있는 캠페인을 획득·활성화·유지·매출 같은 단계로 묶어
   "우리 CRM 이 어느 단계에 몰려 있고 어디가 비어 있는가"를 한 줄로 보여 준다. */
function perfFunnel(fromM, toM) {
  const bucket = {};
  perfRows().forEach(r => {
    if (fromM && r.month < fromM) return;
    if (toM && r.month > toM) return;
    const m = campByCode(r.code);
    const key = (m && String(m.aarrrCode || "").trim().toUpperCase()) || "기타";
    const b = bucket[key] || (bucket[key] = {
      code: key, name: (m && m.aarrrName) || "구분 없음",
      codes: {}, recv: 0, conv: 0, revenue: 0, _w: 0, _ctr: 0, _cvr: 0
    });
    b.codes[r.code] = 1;
    b.recv += r.recv || 0; b.conv += r.conv || 0; b.revenue += r.revenue || 0;
    const w = r.recv || r.sent || 0;
    if (w) { b._w += w; if (r.ctr != null) b._ctr += r.ctr * w; if (r.cvr != null) b._cvr += r.cvr * w; }
  });
  return Object.keys(bucket).sort().map(k => {
    const b = bucket[k];
    b.count = Object.keys(b.codes).length;
    b.ctr = b._w ? b._ctr / b._w : null;
    b.cvr = b._w ? b._cvr / b._w : null;
    return b;
  });
}
function perfFunnelHtml(fromM, toM) {
  const rows = perfFunnel(fromM, toM);
  if (!rows.length) return "";
  const maxRev = Math.max.apply(null, rows.map(r => r.revenue).concat(1));
  return '<div class="funnel">' + rows.map(r =>
    '<div class="fcell" style="--fill:' + Math.round((r.revenue / maxRev) * 100) + '%">' +
      '<div class="fk">' + esc(r.code) + '<em>' + esc(r.name) + "</em></div>" +
      '<div class="fv"><b>' + kNum(r.revenue) + "</b><span>매출</span></div>" +
      '<div class="fm">캠페인 ' + r.count + " · 수신 " + kNum(r.recv) + " · 전환 " + kNum(r.conv) + "</div>" +
      '<div class="fm"><span style="color:#2f6fed">CTR ' + pct1(r.ctr) + '</span> · <span style="color:#e0483f">CVR ' + pct1(r.cvr) + "</span></div>" +
    "</div>").join("") + "</div>";
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
/* 축 위쪽 끝을 실제 값에 맞춰 자동으로 잡는다 (1 · 2 · 2.5 · 5 · 10 단위) */
function niceMax(v) {
  if (!v || v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const s = v / mag;
  return (s <= 1 ? 1 : s <= 2 ? 2 : s <= 2.5 ? 2.5 : s <= 5 ? 5 : 10) * mag;
}
/* 그릴 달을 추린다.
   1) 고른 캠페인 모두 값이 없는 달은 뺀다
   2) 구간 앞뒤로 값이 0인 달도 뺀다 — 시작 전·종료 후 구간이 그래프를 납작하게 만든다 */
function trimMonths(series, months) {
  const has = i => series.some(s => s.ctr[i] != null || s.cvr[i] != null);
  const nonZero = i => series.some(s => (s.ctr[i] || 0) > 0 || (s.cvr[i] || 0) > 0);
  let a = 0, b = months.length - 1;
  while (a <= b && (!has(a) || !nonZero(a))) a++;
  while (b >= a && (!has(b) || !nonZero(b))) b--;
  const out = [];
  for (let i = a; i <= b; i++) if (has(i)) out.push(i);
  return out;
}
const GEO = { W: 880, H: 176, L: 46, R: 46, T: 22, B: 30 };
let chartCtx = null;                       // 마우스 오버 값 표시가 참조할 마지막 렌더 정보

function perfChartSvg(series, months) {
  const W = GEO.W, H = GEO.H, L = GEO.L, R = GEO.R, T = GEO.T;
  const iw = W - L - R, ih = H - T - GEO.B;
  chartCtx = null;
  if (!months.length || !series.length)
    return '<div class="empty">' + ico("chart") + "<div>왼쪽 목록에서 캠페인을 고르면 추이가 그려집니다</div></div>";

  const flat = k => series.reduce((a, s) => a.concat(s[k].filter(v => v != null)), []);
  const cv = flat("ctr"), vv = flat("cvr");
  /* CTR(곡선)은 값들이 0에서 멀면 축 아래쪽을 잘라 낸다 — 낮은 그래프에서 등락이 눌리지 않게.
     CVR(막대)은 길이가 곧 크기라서 언제나 0에서 시작한다. */
  const ctrHi = cv.length ? Math.max.apply(null, cv) : 1;
  const ctrLo = cv.length ? Math.min.apply(null, cv) : 0;
  const ctrMax = niceMax(ctrHi + (ctrHi - ctrLo) * 0.15 || ctrHi);
  const ctrMin = ctrLo > ctrMax * 0.45 ? Math.max(0, Math.floor((ctrLo - (ctrHi - ctrLo) * 0.3) * 10) / 10) : 0;
  const cvrMax = niceMax(vv.length ? Math.max.apply(null, vv) : 1);
  const step = iw / months.length;
  const cx = i => L + step * (i + 0.5);
  const yCtr = v => T + ih - ((v - ctrMin) / (ctrMax - ctrMin || 1)) * ih;
  const yCvr = v => T + ih - (v / cvrMax) * ih;
  const dec = m => (m < 5 ? 1 : 0);
  const showLabels = perfShowLabels && series.length <= 3;   // 넷 이상이면 겹쳐서 못 읽는다

  const grid = [0, 0.5, 1].map(f => {
    const y = T + ih - f * ih;
    return '<line class="gl" x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '"/>' +
      '<text class="ax l" x="' + (L - 6) + '" y="' + (y + 3) + '">' + (ctrMin + (ctrMax - ctrMin) * f).toFixed(dec(ctrMax)) + "%</text>" +
      '<text class="ax r" x="' + (W - R + 6) + '" y="' + (y + 3) + '">' + (cvrMax * f).toFixed(dec(cvrMax)) + "%</text>";
  }).join("");
  /* 달이 많으면 글자가 서로 겹치므로 몇 칸씩 건너뛴다.
     맨 마지막 달은 반드시 남기고 거기서부터 거꾸로 세어 나간다. */
  const every = Math.max(1, Math.ceil(30 / step));
  const xlab = months.map((m, i) =>
    ((months.length - 1 - i) % every === 0
      ? '<text class="ax c" x="' + cx(i) + '" y="' + (T + ih + 16) + '">' + esc(m.slice(2)) + "</text>"
      : "")).join("");

  /* CVR — 달마다 시리즈 수만큼 나란히 세운 막대 */
  const bw = Math.max(3, Math.min(13, (step * 0.5) / series.length));
  const bars = series.map((s, si) => s.cvr.map((v, i) => {
    if (v == null) return "";
    const x = cx(i) - (series.length * bw) / 2 + si * bw;
    const y = yCvr(v), h = Math.max(1, T + ih - y);
    return '<rect class="bar" x="' + x + '" y="' + y + '" width="' + (bw - 1.2) + '" height="' + h + '" fill="' + s.color + '" opacity=".32"/>' +
      (showLabels ? '<text class="vlab" x="' + (x + (bw - 1.2) / 2) + '" y="' + (y - 3) + '" fill="' + s.color + '">' + v.toFixed(1) + "</text>" : "");
  }).join("")).join("");

  /* CTR — 부드러운 곡선 */
  const lines = series.map(s => {
    const pts = [];
    s.ctr.forEach((v, i) => { if (v != null) pts.push([cx(i), yCtr(v), v]); });
    if (!pts.length) return "";
    return '<path class="ln" d="' + smoothPath(pts.map(p => [p[0], p[1]])) + '" stroke="' + s.color + '"/>' +
      pts.map(p => '<circle class="dot" cx="' + p[0] + '" cy="' + p[1] + '" r="2.6" fill="' + s.color + '"/>' +
        (showLabels ? '<text class="vlab" x="' + p[0] + '" y="' + (p[1] - 7) + '" fill="' + s.color + '">' + p[2].toFixed(1) + "%</text>" : "")).join("");
  }).join("");

  /* 달마다 투명한 판을 깔아 마우스를 올리면 그 달의 정확한 값을 띄운다 */
  const hits = months.map((m, i) =>
    '<rect class="hit" data-mi="' + i + '" x="' + (L + step * i) + '" y="' + T + '" width="' + step + '" height="' + ih + '"/>').join("");

  chartCtx = { series: series, months: months, W: W, L: L, step: step };

  return '<div class="chartwrap"><svg class="perfchart" id="perfSvg" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="xMidYMid meet">' +
      grid + xlab + bars + lines +
      '<line class="vline" id="perfGuide" x1="0" y1="' + T + '" x2="0" y2="' + (T + ih) + '" style="display:none"/>' + hits +
      '<text class="ax cap l" x="' + L + '" y="' + (T - 7) + '">CTR 곡선 · 왼쪽 축' + (ctrMin > 0 ? " (0부터가 아님)" : "") + "</text>" +
      '<text class="ax cap r" x="' + (W - R) + '" y="' + (T - 7) + '">CVR 막대 · 오른쪽 축</text>' +
    "</svg>" +
    '<div class="chart-tip" id="perfTip"></div>' +
    '<div class="legend">' + series.map(s =>
      '<span class="lg"><i style="background:' + s.color + '"></i>' + esc(s.label) + "</span>").join("") + "</div></div>";
}

/* ---------------- 목록 ---------------- */
let perfIndexCache = null;
function perfCampIndex() {
  if (perfIndexCache && perfIndexCache.at === SHEETS.at) return perfIndexCache.list;
  const byCode = {};
  perfRows().forEach(r => {
    const m = campByCode(r.code);
    const b = byCode[r.code] || (byCode[r.code] = {
      code: r.code,
      label: m ? m.label : (r.title ? r.title + (r.chan ? " [" + r.chan + "]" : "") : r.code),
      fullName: m ? m.fullName : r.fullName,
      goal: (m && m.goal) || r.goal || "미분류",
      seg: (m && m.title) || r.title || "미분류",      // 캠페인구분 — 목록을 이 기준으로 묶는다
      chan: (m && m.chan) || r.chan || "",
      owner: (m && m.owner) || r.owner || "",
      months: 0, inSheet: !!m
    });
    b.months++;
  });
  const list = Object.values(byCode).sort((a, b) =>
    (a.seg || "").localeCompare(b.seg || "", "ko") || a.code.localeCompare(b.code));
  perfIndexCache = { at: SHEETS.at, list: list };
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
      code: code,
      label: m0 ? m0.label : ((h[0] && h[0].title) || code),
      color: PERF_C[i % PERF_C.length],
      rows: months.map(at),
      ctr: months.map(m => { const r = at(m); return r ? r.ctr : null; }),
      cvr: months.map(m => { const r = at(m); return r ? r.cvr : null; })
    };
  });
}
function monthOptions(all, cur) {
  return all.map(m => '<option value="' + esc(m) + '"' + (cur === m ? " selected" : "") + ">" + esc(m) + "</option>").join("");
}

/* ---------------- 뷰 ---------------- */
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
  $("#perfGoal").innerHTML = opts("goal", perfFilter.goal, "모든 목표");
  $("#perfChan").innerHTML = opts("chan", perfFilter.chan, "모든 채널");
  $("#perfOwner").innerHTML = opts("owner", perfFilter.owner, "모든 담당자");
  $("#perfSeg").innerHTML = opts("seg", perfFilter.seg, "모든 캠페인구분");

  /* 집계 기간 — 데이터가 있는 달 안에서 고른다 */
  const allMonths = perfMonths();
  if (allMonths.length) {
    if (!perfPeriod.from || allMonths.indexOf(perfPeriod.from) < 0) perfPeriod.from = allMonths[0];
    if (!perfPeriod.to || allMonths.indexOf(perfPeriod.to) < 0) perfPeriod.to = allMonths[allMonths.length - 1];
    if (perfPeriod.from > perfPeriod.to) perfPeriod.from = perfPeriod.to;
  }
  $("#perfFrom").innerHTML = monthOptions(allMonths, perfPeriod.from);
  $("#perfTo").innerHTML = monthOptions(allMonths, perfPeriod.to);
  $("#perfLabels").checked = perfShowLabels;

  const inRange = allMonths.filter(m => m >= perfPeriod.from && m <= perfPeriod.to);
  const last = inRange[inRange.length - 1];
  const lastRows = all.filter(r => r.month === last);
  const wAvg = key => {
    let w = 0, s = 0;
    lastRows.forEach(r => { const q = r.recv || r.sent || 0; if (r[key] != null && q) { w += q; s += r[key] * q; } });
    return w ? s / w : null;
  };
  $("#perfStats").innerHTML = [
    '<div class="stat" style="--c:var(--accent)"><span class="n">' + (inRange.length ? esc(inRange[0]) + " ~ " + esc(last) : "-") + '</span><span class="t">집계 기간</span></div>',
    '<div class="stat" style="--c:var(--camp)"><span class="n">' + codes.length + '</span><span class="t">캠페인</span></div>',
    '<div class="stat" style="--c:#2f6fed"><span class="n">' + pct1(wAvg("ctr")) + '</span><span class="t">' + esc(last || "-") + ' 평균 CTR</span></div>',
    '<div class="stat" style="--c:#e0483f"><span class="n">' + pct1(wAvg("cvr")) + '</span><span class="t">' + esc(last || "-") + ' 평균 CVR</span></div>'
  ].join("");

  /* 캠페인구분으로 묶은 목록 — 성과 수치는 오른쪽 차트·표에서 본다 */
  let html = "", seg = null;
  list.forEach(b => {
    if (b.seg !== seg) { seg = b.seg; html += '<div class="perfgroup">' + esc(seg || "미분류") + "</div>"; }
    const on = perfPicked.indexOf(b.code) >= 0;
    html += '<label class="pickrow' + (on ? " on" : "") + '">' +
      '<input type="checkbox" data-perf-pick="' + esc(b.code) + '"' + (on ? " checked" : "") + ">" +
      '<span class="pickmain"><b>' + esc(b.label) + "</b>" +
        "<em>" + esc(b.code) + " · " + b.months + "개월" + (b.owner ? " · " + esc(b.owner) : "") +
        (b.inSheet ? "" : ' · <span style="color:var(--warn)">마스터에 없음</span>') + "</em></span></label>";
  });
  $("#perfList").innerHTML = html || '<div class="empty">' + ico("mega") + "<div>조건에 맞는 캠페인이 없습니다</div></div>";

  /* 값이 없는 달과 앞뒤 0 구간을 걷어낸 뒤에 그린다 */
  const full = perfSeriesFor(perfPicked, inRange);
  const keep = trimMonths(full, inRange);
  const months = keep.map(i => inRange[i]);
  const series = full.map(s => Object.assign({}, s, {
    ctr: keep.map(i => s.ctr[i]), cvr: keep.map(i => s.cvr[i]), rows: keep.map(i => s.rows[i])
  }));
  $("#perfFunnel").innerHTML = perfFunnelHtml(perfPeriod.from, perfPeriod.to);
  $("#perfChart").innerHTML = perfChartSvg(series, months);

  const picked = perfPicked
    .map(c => ({ code: c, h: perfHistory(c).filter(r => r.month >= perfPeriod.from && r.month <= perfPeriod.to) }))
    .filter(x => x.h.length);
  $("#perfTable").innerHTML = picked.length
    ? '<table class="ptable"><thead><tr><th>캠페인</th><th>월</th><th class="r">전달</th><th class="r">수신</th>' +
      '<th class="r">오픈</th><th class="r">예약/반응</th><th class="r">CTR</th><th class="r">CVR</th><th class="r">매출</th></tr></thead><tbody>' +
      picked.map(p => {
        const m0 = campByCode(p.code);
        return p.h.slice().reverse().map((r, i) =>
          "<tr>" + (i === 0 ? '<td rowspan="' + p.h.length + '">' + esc(m0 ? m0.label : p.code) + '<em class="mono">' + esc(p.code) + "</em></td>" : "") +
            "<td>" + esc(r.month) + '</td><td class="r">' + kNum(r.sent) + '</td><td class="r">' + kNum(r.recv) +
            '</td><td class="r">' + kNum(r.open) + '</td><td class="r">' + kNum(r.conv) +
            '</td><td class="r b" style="color:#2f6fed">' + pct1(r.ctr) + '</td><td class="r b" style="color:#e0483f">' + pct1(r.cvr) +
            '</td><td class="r">' + kNum(r.revenue) + "</td></tr>").join("");
      }).join("") + "</tbody></table>"
    : "";

  /* 실적 기준 — 이 캠페인의 CTR·CVR 이 무엇을 무엇으로 나눈 값인지 */
  $("#perfBasis").innerHTML = perfPicked.map((code, i) => {
    const m = campByCode(code);
    if (!m) return "";
    return '<div class="basiscard" style="border-left:3px solid ' + PERF_C[i % PERF_C.length] + '">' +
      "<h4>" + esc(m.label) + "</h4>" + basisHtml(m) + "</div>";
  }).join("");
}

/* ---------------- 마우스를 올리면 그 달의 정확한 값 ---------------- */
function perfTipMove(e) {
  const svg = $("#perfSvg"), tip = $("#perfTip"), guide = $("#perfGuide");
  if (!svg || !tip || !chartCtx) return;
  const r = svg.getBoundingClientRect();
  if (!r.width) return;
  const x = ((e.clientX - r.left) / r.width) * chartCtx.W;
  const i = Math.floor((x - chartCtx.L) / chartCtx.step);
  if (i < 0 || i >= chartCtx.months.length) return perfTipOut();
  const gx = chartCtx.L + chartCtx.step * (i + 0.5);
  guide.setAttribute("x1", gx); guide.setAttribute("x2", gx); guide.style.display = "";
  tip.innerHTML = "<b>" + esc(chartCtx.months[i]) + "</b>" +
    chartCtx.series.map(s => {
      const row = s.rows[i];
      return '<div class="tr"><i style="background:' + s.color + '"></i><span>' + esc(s.label) + "</span></div>" +
        '<div class="tr" style="padding-left:14px; color:var(--ink-3)">CTR <b style="color:#2f6fed">' + pct1(s.ctr[i]) +
          '</b> · CVR <b style="color:#e0483f">' + pct1(s.cvr[i]) + "</b>" +
          (row ? " · 수신 <b>" + kNum(row.recv) + "</b>" : "") + "</div>";
    }).join("");
  const box = svg.parentNode.getBoundingClientRect();
  tip.style.display = "block";
  const px = e.clientX - box.left, py = e.clientY - box.top;
  tip.style.left = Math.max(4, Math.min(px + 14, box.width - tip.offsetWidth - 8)) + "px";
  tip.style.top = Math.max(4, py - tip.offsetHeight - 10) + "px";
}
function perfTipOut() {
  const tip = $("#perfTip"), guide = $("#perfGuide");
  if (tip) tip.style.display = "none";
  if (guide) guide.style.display = "none";
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
  $("#perfFrom").addEventListener("change", e => { perfPeriod.from = e.target.value; renderPerfView(true); });
  $("#perfTo").addEventListener("change", e => { perfPeriod.to = e.target.value; renderPerfView(true); });
  $("#perfLabels").addEventListener("change", e => { perfShowLabels = e.target.checked; renderPerfView(true); });
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
  const chart = $("#perfChart");
  chart.addEventListener("mousemove", perfTipMove);
  chart.addEventListener("mouseleave", perfTipOut);
}

/* ---------------- 점검 — 급락 주의 · 데이터 누락 ----------------
   시트를 여럿이 함께 쓰다 보면 "측정하기로 해 놓고 데이터가 안 쌓이는 캠페인",
   "진행중인데 여정지도에 안 붙은 캠페인", "CTR·CVR 기준이 비어 있는 캠페인" 이 쌓인다.
   사람이 눈으로 찾을 수 없으니 앱이 대신 모아 보여 준다. */
function hygieneReport() {
  const withPerf = {};
  SHEETS.perf.forEach(r => { withPerf[r.code] = 1; });
  const placedCodes = {};
  state.boards.forEach(b => b.nodes.forEach(n => (n.camps || []).forEach(c => { if (c.code) placedCodes[c.code] = 1; })));
  const live = SHEETS.camps.filter(m => m.statusCode === "live");

  return [
    { key: "drop", icon: "alert", tone: "bad", title: "성과 급락 주의",
      hint: "최신월이 직전 3개월 평균보다 30% 이상 낮고, 표본을 감안해도 의미 있는 하락입니다.",
      rows: perfAlerts().map(a => ({
        code: a.code, name: a.label,
        detail: (a.kind === "ctr" ? "CTR" : "CVR") + " " + pct1(a.base) + " → " + pct1(a.cur) +
          " (" + Math.round(a.drop * 100) + "% 하락 · " + a.month + ")"
      })) },
    { key: "nodata", icon: "chart", tone: "warn", title: "성과측정 Y 인데 데이터가 없음",
      hint: "시트 V열이 Y 인데 3.개인화RAW 에 이 캠페인코드로 쌓인 줄이 하나도 없습니다.",
      rows: SHEETS.camps.filter(m => String(m.measure || "").toUpperCase() === "Y" && !withPerf[m.code])
        .map(m => ({ code: m.code, name: m.label, detail: m.owner || "담당자 미지정" })) },
    { key: "unplaced", icon: "map", tone: "warn", title: "진행중인데 여정지도에 안 붙음",
      hint: "운영상태가 진행인데 어느 페이지에도 배치되지 않았습니다. 어느 화면에서 나가는 캠페인인지 알 수 없습니다.",
      rows: live.filter(m => !placedCodes[m.code])
        .map(m => ({ code: m.code, name: m.label, detail: m.path || "경로 미기입" })) },
    { key: "nobasis", icon: "edit", tone: "warn", title: "CTR · CVR 기준 미기입",
      hint: "분모가 캠페인마다 달라 기준이 없으면 숫자를 비교할 수 없습니다. 시트 R열·S열을 채워 주세요.",
      rows: live.filter(m => !String(m.ctrBasis || "").trim() && !m.ctrFormula &&
                             !String(m.cvrBasis || "").trim() && !m.cvrFormula)
        .map(m => ({ code: m.code, name: m.label, detail: m.owner || "담당자 미지정" })) },
    { key: "orphan", icon: "alert", tone: "warn", title: "성과는 있는데 마스터에 없는 코드",
      hint: "3.개인화RAW 에는 있지만 1.개인화DB 에 같은 캠페인코드가 없습니다. 코드 오타이거나 마스터 등록이 빠졌습니다.",
      rows: Object.keys(withPerf).filter(c => !campByCode(c)).map(c => {
        const r = SHEETS.perf.find(x => x.code === c) || {};
        return { code: c, name: r.title || r.fullName || "-", detail: r.month || "" };
      }) },
    { key: "nolink", icon: "link", tone: "info", title: "링크 글자만 있고 주소가 없음",
      hint: "시트 T·U열에 글자는 있는데 하이퍼링크가 걸려 있지 않습니다. 셀에서 Ctrl+K 로 주소를 걸어 주세요.",
      rows: SHEETS.camps.filter(m => (m.link1 && !m.link1Url) || (m.link2 && !m.link2Url))
        .map(m => ({ code: m.code, name: m.label, detail: [m.link1, m.link2].filter(Boolean).join(" · ") })) }
  ].filter(g => g.rows.length);
}
let hygCache = null;
function hygieneCached() {
  const key = SHEETS.at + "|" + state.boards.reduce((a, b) => a + b.nodes.reduce((c, n) => c + (n.camps || []).length, 0), 0);
  if (!hygCache || hygCache.key !== key) hygCache = { key: key, list: hygieneReport() };
  return hygCache.list;
}
function hygieneCount() {
  try { return hygieneCached().reduce((a, g) => a + g.rows.length, 0); } catch (e) { return 0; }
}
function openCheckModal() {
  const groups = hygieneCached();
  const root = modalHost();
  const body = groups.length
    ? groups.map(g =>
        '<div class="chkgroup"><div class="chkhead ' + g.tone + '">' + ico(g.icon, "xs") +
          "<b>" + esc(g.title) + "</b><span class=\"n\">" + g.rows.length + "</span></div>" +
          '<p class="hint">' + esc(g.hint) + "</p>" +
          '<div class="chklist">' + g.rows.slice(0, 40).map(r =>
            '<button class="chkrow" type="button" data-chk="' + esc(r.code) + '">' +
              '<span class="mono">' + esc(r.code) + "</span>" +
              "<span>" + esc(r.name) + "</span>" +
              '<em>' + esc(r.detail || "") + "</em></button>").join("") +
            (g.rows.length > 40 ? '<div class="hint">외 ' + (g.rows.length - 40) + "건</div>" : "") +
          "</div></div>").join("")
    : '<div class="empty">' + ico("check") + "<div>지금은 걸리는 항목이 없습니다</div></div>";

  root.innerHTML =
    '<div class="scrim"><div class="modal glass wide" role="dialog" aria-modal="true">' +
      '<div class="modal-head">' + ico("alert") + '<h3>점검</h3><button class="btn icon sm" data-x>' + ico("close", "xs") + "</button></div>" +
      '<div class="modal-body">' + body + "</div>" +
      '<div class="modal-foot"><div class="spacer"></div><button class="btn primary" data-x>닫기</button></div>' +
    "</div></div>";
  root.addEventListener("click", e => {
    if (e.target.closest("[data-x]") || e.target.classList.contains("scrim")) return closeModal();
    const row = e.target.closest("[data-chk]");
    if (row && isStaff() && campByCode(row.dataset.chk)) { closeModal(); editSheetCamp(row.dataset.chk); }
  });
}
