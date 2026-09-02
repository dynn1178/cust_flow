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

/* GA4는 요즘 사이트가 서버사이드 GTM·자체 프록시 도메인으로 우회해서 보내는
   경우가 흔해 호스트 이름만으로는 자주 놓친다 — 그래서 호스트 이름과 별개로
   "tid=G-..." 쿼리(측정 ID 규격)가 있으면 도메인이 무엇이든 GA4로 본다. */
function looksLikeGA4(u) {
  const host = u.hostname.toLowerCase();
  if (host.indexOf("google-analytics.com") >= 0 || host.indexOf("analytics.google.com") >= 0) return true;
  const tid = u.searchParams.get("tid");
  return !!(tid && /^G-/i.test(tid));
}
function vendorOf(u) {
  const host = u.hostname.toLowerCase();
  if (host.indexOf("amplitude.com") >= 0) return "amplitude";
  if (host.indexOf("braze.com") >= 0 || host.indexOf("braze.eu") >= 0 || host.indexOf("appboy.com") >= 0) return "braze";  // appboy = Braze의 옛 이름(오래된 SDK가 아직 씀)
  if (looksLikeGA4(u)) return "ga4";
  return null;
}

/* 각 업체가 실제 브라우저 SDK에서 이벤트를 실어 보내는 모양은 공식 규격이
   없다시피 해서(관찰 기반), 여러 형태를 순서대로 시도한다. JSON 구조가 예상과
   다르면(중첩이 달라졌다든지) 정규식으로 한 번 더 훑어서 최대한 건진다.
   하나도 안 맞으면 이벤트 이름 없이 "감지됨"만 표시한다. */
function eventsFromGA4(u, postData) {
  const names = [];
  const en = u.searchParams.get("en");
  if (en) names.push(en);
  if (postData) {
    try {
      const j = JSON.parse(postData);
      (j.events || []).forEach(e => { if (e && e.name) names.push(e.name); });
    } catch (e) {
      const re = /"name"\s*:\s*"([^"]+)"/g;
      let m; while ((m = re.exec(postData))) names.push(m[1]);
    }
  }
  return names;
}
function eventsFromAmplitude(u, postData) {
  const names = new Set();
  const scan = raw => {
    if (!raw) return;
    try {
      const j = JSON.parse(raw);
      const list = Array.isArray(j) ? j : (j.events || (j.event_type ? [j] : []));
      list.forEach(e => { if (e && e.event_type) names.add(e.event_type); });
    } catch (e) {
      const re = /"event_type"\s*:\s*"([^"]+)"/g;
      let m; while ((m = re.exec(raw))) names.add(m[1]);
    }
  };
  if (postData) {
    scan(postData);
    if (!names.size) {
      try {
        const params = new URLSearchParams(postData);
        const ev = params.get("event");
        if (ev) scan(decodeURIComponent(ev));
      } catch (e) {}
    }
  }
  const evQ = u.searchParams.get("event");
  if (evQ) scan(evQ);
  return Array.from(names);
}
function eventsFromBraze(postData) {
  const names = new Set();
  if (!postData) return [];
  try {
    const j = JSON.parse(postData);
    (j.events || []).forEach(e => { if (e && e.name) names.add(e.name); });
  } catch (e) {}
  if (!names.size) {
    /* "events" 배열 부분만 잘라서 그 안의 name만 줍는다 — attributes 등
       다른 곳의 name까지 긁지 않도록 범위를 좁힌다 */
    const block = /"events"\s*:\s*(\[[\s\S]*?\])/.exec(postData);
    if (block) {
      const re = /"name"\s*:\s*"([^"]+)"/g;
      let m; while ((m = re.exec(block[1]))) names.add(m[1]);
    }
  }
  return Array.from(names);
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
    /* 파싱이 실제로 맞는지 확인하려면 원본을 봐야 한다 — 업체별로 몇 개만
       잘라서 같이 돌려준다(요청 주소 + 본문 앞부분). 응답에 실린 값은 그대로
       브라우저 콘솔에도 찍어서, Vercel 로그에 못 들어가도 확인할 수 있게 한다. */
    const debug = { amplitude: [], braze: [], ga4: [] };
    const DEBUG_MAX = 4;

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
        if (debug[vendor].length < DEBUG_MAX) {
          debug[vendor].push({
            method: r.method(), url: r.url().slice(0, 300),
            body: postData ? String(postData).slice(0, 500) : null,
            parsedNames: names
          });
        }
      });
      try {
        await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 10000 });
        /* GTM 컨테이너가 로드된 뒤에야 gtag·Amplitude 호출이 잇달아 나가는 사이트가
           많다 — 그 사슬이 다 이어지려면 몇 초는 걸려서 넉넉히 기다린다 */
        await new Promise(r => setTimeout(r, 7000));
      } catch (e) { /* 여기까지 뜬 요청만으로 판단한다 */ }
    } finally {
      await page.close().catch(() => {});
    }

    const out = {};
    ["amplitude", "braze", "ga4"].forEach(k => {
      out[k] = { detected: seenVendor[k], events: Array.from(found[k]), debug: debug[k] };
    });
    console.log("[detect-tags]", target.href, JSON.stringify(out));
    return res.status(200).json(out);
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    return res.status(status).json({ error: (e && e.message) || "태그를 확인하지 못했습니다" });
  }
};

module.exports.config = { maxDuration: 30 };
