/* ============================================================================
   /api/detect-tags — 웹 모드에서 "태그 확인"을 누르면 그 주소를 서버가 대신
   열어, 페이지가 실제로 Amplitude·Braze·GA4로 보내는 트래킹 요청을 엿보고
   어떤 이벤트를 보내는지 최대한 뽑아 돌려준다.

   iframe 안 페이지는 다른 도메인이라 브라우저 스크립트로 직접 엿볼 수 없지만
   (api/screenshot.js와 같은 이유), 여기서는 서버 자신의 헤드리스 브라우저가
   그 페이지를 직접 열어서 "자기가 보낸" 네트워크 요청을 보는 것이라 문제 없다.

   각 업체 전송 형식(payload)은 공식 문서가 아니라 실제 관찰로 짐작한 것이라,
   업체가 형식을 바꾸거나 커스텀 도메인을 쓰면 놓칠 수 있다 — "감지됨/이벤트
   이름"은 최선을 다한 추정치이지 100% 보장이 아니다.

   필요한 환경변수 (api/sheets.js 와 같다)
     SUPABASE_URL, SUPABASE_ANON_KEY

   권한 — 로그인한 회원 누구나
   ========================================================================== */
const { httpErr, whoAmI, assertPublicHost, parseTargetUrl, getBrowser } = require("./_lib/browser");

const VENDORS = {
  amplitude: { hostHas: ["amplitude.com"] },
  braze: { hostHas: ["braze.com", "braze.eu", "appboy.com"] },   // appboy = Braze의 옛 이름(오래된 SDK가 아직 씀)
  ga4: { hostHas: ["google-analytics.com"], pathHas: ["collect"] }
};
function vendorOf(u) {
  const host = u.hostname.toLowerCase();
  for (const [key, spec] of Object.entries(VENDORS)) {
    if (!spec.hostHas.some(h => host.indexOf(h) >= 0)) continue;
    if (spec.pathHas && !spec.pathHas.some(p => u.pathname.indexOf(p) >= 0)) continue;
    return key;
  }
  return null;
}

/* 각 업체가 실제 브라우저 SDK에서 이벤트를 실어 보내는 모양은 공식 규격이
   없다시피 해서(관찰 기반), 여러 형태를 순서대로 시도한다. 하나도 안 맞으면
   이벤트 이름 없이 "감지됨"만 표시한다. */
function eventsFromGA4(u, postData) {
  const names = [];
  const en = u.searchParams.get("en");
  if (en) names.push(en);
  if (postData) {
    try {
      const j = JSON.parse(postData);
      (j.events || []).forEach(e => { if (e && e.name) names.push(e.name); });
    } catch (e) { /* GET 쿼리만 있고 본문은 없는 경우가 대부분 */ }
  }
  return names;
}
function eventsFromAmplitude(u, postData) {
  const names = [];
  const tryParseBatch = raw => {
    try {
      const j = JSON.parse(raw);
      const list = Array.isArray(j) ? j : (j.events || (j.event_type ? [j] : []));
      list.forEach(e => { if (e && e.event_type) names.push(e.event_type); });
    } catch (e) { /* 아래에서 폼 인코딩으로 다시 시도 */ }
  };
  if (postData) {
    tryParseBatch(postData);
    if (!names.length) {
      try {
        const params = new URLSearchParams(postData);
        const ev = params.get("event");
        if (ev) tryParseBatch(decodeURIComponent(ev));
      } catch (e) {}
    }
  }
  const evQ = u.searchParams.get("event");
  if (evQ) tryParseBatch(evQ);
  return names;
}
function eventsFromBraze(postData) {
  const names = [];
  if (!postData) return names;
  try {
    const j = JSON.parse(postData);
    (j.events || []).forEach(e => { if (e && e.name) names.push(e.name); });
  } catch (e) {}
  return names;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "허용되지 않은 메서드입니다" }); }
    const me = await whoAmI(req);
    if (!me) throw httpErr(401, "로그인이 필요합니다");

    const target = parseTargetUrl(req);
    await assertPublicHost(target.hostname);

    const found = { amplitude: new Set(), braze: new Set(), ga4: new Set() };
    const seenVendor = { amplitude: false, braze: false, ga4: false };

    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      page.on("request", r => {
        let u;
        try { u = new URL(r.url()); } catch (e) { return; }
        const vendor = vendorOf(u);
        if (!vendor) return;
        seenVendor[vendor] = true;
        const postData = r.postData ? r.postData() : null;
        const names = vendor === "ga4" ? eventsFromGA4(u, postData)
          : vendor === "amplitude" ? eventsFromAmplitude(u, postData)
          : eventsFromBraze(postData);
        names.forEach(n => found[vendor].add(String(n).slice(0, 80)));
      });
      try {
        await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 10000 });
        await new Promise(r => setTimeout(r, 3000));   // 로딩 직후 비동기로 뜨는 트래킹 스크립트를 기다린다
      } catch (e) { /* 여기까지 뜬 요청만으로 판단한다 */ }
    } finally {
      await page.close().catch(() => {});
    }

    const out = {};
    Object.keys(VENDORS).forEach(k => {
      out[k] = { detected: seenVendor[k], events: Array.from(found[k]) };
    });
    return res.status(200).json(out);
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    return res.status(status).json({ error: (e && e.message) || "태그를 확인하지 못했습니다" });
  }
};

module.exports.config = { maxDuration: 30 };
