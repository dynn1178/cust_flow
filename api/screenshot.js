/* ============================================================================
   /api/screenshot — 웹 모드에서 "추가하기·수정하기"를 누르면 지금 로딩된
   페이지를 서버가 대신 열어 화면을 찍어 돌려준다.

   브라우저 안의 iframe은 다른 도메인 페이지 화면을 동일 출처 정책 때문에
   직접 캔버스로 읽을 수 없다(임베드는 되지만 픽셀은 못 읽는다). 그래서
   여기서 헤드리스 브라우저(Chromium)로 그 주소를 실제로 열어 스크린샷을
   찍은 뒤 이미지 바이트를 그대로 응답한다 — 화면 자체는 여전히 브라우저의
   iframe이 따로 보여 준다.

   필요한 환경변수 (api/sheets.js 와 같다)
     SUPABASE_URL, SUPABASE_ANON_KEY

   권한 — 로그인한 회원 누구나
   ========================================================================== */
const { httpErr, whoAmI, assertPublicHost, parseTargetUrl, getBrowser, preparePage } = require("./_lib/browser");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "허용되지 않은 메서드입니다" }); }
    const me = await whoAmI(req);
    if (!me) throw httpErr(401, "로그인이 필요합니다");

    const target = parseTargetUrl(req);
    await assertPublicHost(target.hostname);

    const browser = await getBrowser();
    const page = await browser.newPage();
    await preparePage(page);
    try {
      /* "load"(모든 하위 자원까지 다 끝나기를 기다림)는 광고·추적 스크립트가 계속
         떠 있는 페이지에서 몇 초씩 안 끝나기도 해서 너무 느렸다. 그렇다고
         "domcontentloaded" 직후 곧장 찍으면 이번엔 화면·이미지가 하나도 안
         그려진 채로 찍혀 버렸다(특히 스크롤해야 불러오는 지연 로딩 이미지, 웹폰트).
         "networkidle2"(동시 요청이 2개 이하로 잠깐 잦아들 때)로 균형을 잡고,
         지연 로딩 이미지가 뜨도록 한 번 끝까지 스크롤했다가 되돌아온다.
         동영상·오디오는 화면을 찍는 데 필요 없으니 아예 안 받는다. */
      await page.setRequestInterception(true);
      page.on("request", r => { if (r.resourceType() === "media") r.abort(); else r.continue(); });
      try {
        await page.goto(target.href, { waitUntil: "networkidle2", timeout: 12000 });
      } catch (e) { /* 끝까지 잠잠해지지 않아도 지금까지 그려진 화면은 찍는다 */ }
      try {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await new Promise(r => setTimeout(r, 400));
        await page.evaluate(() => window.scrollTo(0, 0));
        await new Promise(r => setTimeout(r, 700));
      } catch (e) { /* 스크롤이 안 돼도(페이지 오류 등) 화면은 그대로 찍는다 */ }
      const buf = await page.screenshot({ type: "jpeg", quality: 82 });
      res.setHeader("Content-Type", "image/jpeg");
      return res.status(200).send(buf);
    } finally {
      await page.close().catch(() => {});
    }
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    return res.status(status).json({ error: (e && e.message) || "화면을 찍지 못했습니다" });
  }
};

module.exports.config = { maxDuration: 30 };
