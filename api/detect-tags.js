/* ============================================================================
   /api/detect-tags — 웹 모드에서 "태그 확인"을 누르면 그 주소를 서버가 대신
   열어, 페이지를 로딩만 해도 자동으로 나가는 Amplitude·Braze·GA4 요청을
   엿보고 어떤 이벤트를, 어떤 속성과 함께 보내는지 최대한 뽑아 돌려준다.

   상품 클릭처럼 사용자 동작이 있어야만 나가는 이벤트는 여기서는 잡히지
   않는다 — 그건 사용자가 실제 브라우저에서 직접 캡처한 HAR 파일을 가져오는
   api/import-har.js 쪽에서 다룬다(자세한 이유는 그 파일 머리말 참고).

   iframe 안 페이지는 다른 도메인이라 브라우저 스크립트로 직접 엿볼 수 없지만
   (api/screenshot.js와 같은 이유), 여기서는 서버 자신의 헤드리스 브라우저가
   그 페이지를 직접 열어서 "자기가 보낸" 네트워크 요청을 보는 것이라 문제 없다.

   각 업체 전송 형식(payload) 판단 로직은 api/_lib/tagvendors.js에 있다 —
   공식 문서가 아니라 실제 관찰로 짐작한 것이라, 업체가 형식을 바꾸거나
   커스텀 도메인을 쓰면 놓칠 수 있다 — "감지됨/이벤트 이름/속성"은 최선을
   다한 추정치이지 100% 보장이 아니다.

   필요한 환경변수 (api/sheets.js 와 같다)
     SUPABASE_URL, SUPABASE_ANON_KEY

   권한 — 로그인한 회원 누구나
   ========================================================================== */
const { httpErr, whoAmI, assertPublicHost, parseTargetUrl, getBrowser, preparePage } = require("./_lib/browser");
const { cleanProps, makeCollector } = require("./_lib/tagvendors");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "허용되지 않은 메서드입니다" }); }
    const me = await whoAmI(req);
    if (!me) throw httpErr(401, "로그인이 필요합니다");

    const target = parseTargetUrl(req);
    await assertPublicHost(target.hostname);

    /* 페이지 자체 주소에 실려 있는 값(예: ?dspSid=AAFB000)도 QA에 쓸모 있는
       속성인 경우가 많다 — 트래킹 요청과 별개로, 지금 연 페이지 주소의 쿼리
       파라미터를 모아 감지된 모든 이벤트의 속성에 함께 얹어 준다. */
    const pageParams = {};
    target.searchParams.forEach((v, k) => { if (v) pageParams[k] = v; });

    const collector = makeCollector(pageParams);

    const browser = await getBrowser();
    const page = await browser.newPage();
    await preparePage(page);
    try {
      page.on("request", r => collector.ingest(r.url(), r.method(), r.postData ? r.postData() : null));
      try {
        await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 10000 });
        /* Next.js 사이트는 주소의 물음표(?) 뒤 쿼리 말고도, 페이지 안에 심어 둔
           __NEXT_DATA__ 스크립트(서버에서 렌더링할 때 쓴 원본 데이터)에 dspSid 같은
           동적 라우트 값이 들어 있는 경우가 많다 — 있으면 같이 주워 담는다.
           Next.js가 아닌 사이트에서는 그냥 아무 것도 못 찾고 조용히 넘어간다. */
        try {
          const nextData = await page.evaluate(() => {
            const el = document.getElementById("__NEXT_DATA__");
            if (!el) return null;
            const j = JSON.parse(el.textContent);
            return (j.props && j.props.pageProps && j.props.pageProps.query) || null;
          });
          if (nextData) Object.assign(pageParams, cleanProps(nextData));
        } catch (e) { /* Next.js가 아니거나 모양이 다르면 그냥 건너뛴다 */ }
        /* GTM 컨테이너가 로드된 뒤에야 gtag·Amplitude·Braze 호출이 잇달아 나가는
           사이트가 많고, 실제로 재 보니 Braze는 10초 넘게 걸려서야 첫 이벤트를
           보내는 경우도 있었다 — 넉넉히 14초까지 기다린다. */
        await new Promise(r => setTimeout(r, 14000));
      } catch (e) { /* 여기까지 뜬 요청만으로 판단한다 */ }
    } finally {
      await page.close().catch(() => {});
    }

    const out = Object.assign({ pageParams }, collector.toOutput());
    console.log("[detect-tags]", target.href, JSON.stringify(out));
    return res.status(200).json(out);
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    return res.status(status).json({ error: (e && e.message) || "태그를 확인하지 못했습니다" });
  }
};

module.exports.config = { maxDuration: 45 };   // 대기 시간을 늘린 만큼(고정 14초 대기 포함) 여유를 더 둔다
