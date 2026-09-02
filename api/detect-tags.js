/* ============================================================================
   /api/detect-tags — 웹 모드에서 "태그 확인"을 누르면 그 주소를 서버가 대신
   열어, 페이지가 실제로 Amplitude·Braze·GA4로 보내는 트래킹 요청을 엿보고
   어떤 이벤트를, 어떤 속성과 함께 보내는지 최대한 뽑아 돌려준다.

   iframe 안 페이지는 다른 도메인이라 브라우저 스크립트로 직접 엿볼 수 없지만
   (api/screenshot.js와 같은 이유), 여기서는 서버 자신의 헤드리스 브라우저가
   그 페이지를 직접 열어서 "자기가 보낸" 네트워크 요청을 보는 것이라 문제 없다.

   각 업체 전송 형식(payload)은 공식 문서가 아니라 실제 관찰로 짐작한 것이라,
   업체가 형식을 바꾸거나 커스텀 도메인을 쓰면 놓칠 수 있다 — "감지됨/이벤트
   이름/속성"은 최선을 다한 추정치이지 100% 보장이 아니다.

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

/* event_properties·params·properties 안의 값만 쓰므로, SDK가 자동으로 붙이는
   부가정보(device_id·session_id·ip 등 이벤트 최상위 필드)는 애초에 안 섞인다 —
   비어 있거나 null인 값만 걸러낸다. */
function cleanProps(obj) {
  const out = {};
  Object.keys(obj || {}).forEach(k => {
    const v = obj[k];
    if (v === null || v === undefined) return;
    if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) return;
    out[k] = v;
  });
  return out;
}

/* 각 업체가 실제 브라우저 SDK에서 이벤트를 실어 보내는 모양은 공식 규격이
   없다시피 해서(관찰 기반), 여러 형태를 순서대로 시도한다. JSON 구조가 예상과
   다르면(중첩이 달라졌다든지) 정규식으로 한 번 더 훑어서 최대한 건진다.
   이름만이 아니라 그 이벤트가 실어 보낸 속성(event_properties 등)도 같이
   돌려줘서, 태그를 만들 때 속성 칸까지 자동으로 채울 수 있게 한다. */
function eventsFromGA4(u, postData) {
  const out = [];
  const en = u.searchParams.get("en");
  if (en) {
    const props = {};
    u.searchParams.forEach((v, k) => { if (k !== "en" && k !== "tid" && k !== "v") props[k] = v; });
    out.push({ name: en, properties: cleanProps(props) });
  }
  if (postData) {
    try {
      const j = JSON.parse(postData);
      (j.events || []).forEach(e => { if (e && e.name) out.push({ name: e.name, properties: cleanProps(e.params) }); });
    } catch (e) {
      const re = /"name"\s*:\s*"([^"]+)"/g;
      let m; while ((m = re.exec(postData))) out.push({ name: m[1], properties: {} });
    }
  }
  return out;
}
function eventsFromAmplitude(u, postData) {
  const out = [];
  const scan = raw => {
    if (!raw) return false;
    try {
      const j = JSON.parse(raw);
      const list = Array.isArray(j) ? j : (j.events || (j.event_type ? [j] : []));
      let any = false;
      list.forEach(e => {
        if (!e || !e.event_type) return;
        any = true;
        out.push({ name: e.event_type, properties: cleanProps(e.event_properties) });
      });
      return any;
    } catch (e) {
      const re = /"event_type"\s*:\s*"([^"]+)"/g;
      let m, any = false;
      while ((m = re.exec(raw))) { out.push({ name: m[1], properties: {} }); any = true; }
      return any;
    }
  };
  if (postData) {
    if (!scan(postData)) {
      try {
        const params = new URLSearchParams(postData);
        const ev = params.get("event");
        if (ev) scan(decodeURIComponent(ev));
      } catch (e) {}
    }
  }
  const evQ = u.searchParams.get("event");
  if (evQ) scan(evQ);
  return out;
}
function eventsFromBraze(postData) {
  const out = [];
  if (!postData) return out;
  try {
    const j = JSON.parse(postData);
    (j.events || []).forEach(e => { if (e && e.name) out.push({ name: e.name, properties: cleanProps(e.properties) }); });
  } catch (e) {}
  if (!out.length) {
    /* "events" 배열 부분만 잘라서 그 안의 name만 줍는다 — attributes 등
       다른 곳의 name까지 긁지 않도록 범위를 좁힌다 */
    const block = /"events"\s*:\s*(\[[\s\S]*?\])/.exec(postData);
    if (block) {
      const re = /"name"\s*:\s*"([^"]+)"/g;
      let m; while ((m = re.exec(block[1]))) out.push({ name: m[1], properties: {} });
    }
  }
  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "허용되지 않은 메서드입니다" }); }
    const me = await whoAmI(req);
    if (!me) throw httpErr(401, "로그인이 필요합니다");

    const target = parseTargetUrl(req);
    await assertPublicHost(target.hostname);

    const found = { amplitude: new Map(), braze: new Map(), ga4: new Map() };   // name -> merged properties
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
        const items = vendor === "ga4" ? eventsFromGA4(u, postData)
          : vendor === "amplitude" ? eventsFromAmplitude(u, postData)
          : eventsFromBraze(postData);
        items.forEach(it => {
          const name = String(it.name).slice(0, 80);
          if (!found[vendor].has(name)) found[vendor].set(name, {});
          Object.assign(found[vendor].get(name), it.properties || {});
        });
        if (debug[vendor].length < DEBUG_MAX) {
          debug[vendor].push({
            method: r.method(), url: r.url().slice(0, 300),
            body: postData ? String(postData).slice(0, 500) : null,
            parsed: items
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
      out[k] = {
        detected: seenVendor[k],
        events: Array.from(found[k].entries()).map(([name, properties]) => ({ name, properties })),
        debug: debug[k]
      };
    });
    console.log("[detect-tags]", target.href, JSON.stringify(out));
    return res.status(200).json(out);
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    return res.status(status).json({ error: (e && e.message) || "태그를 확인하지 못했습니다" });
  }
};

module.exports.config = { maxDuration: 30 };
