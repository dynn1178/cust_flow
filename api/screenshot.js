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
const dns = require("dns").promises;
const net = require("net");
const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");

const SUPA_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPA_ANON = process.env.SUPABASE_ANON_KEY || "";

function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }

async function whoAmI(req) {
  const auth = req.headers.authorization || "";
  if (!/^Bearer\s+/i.test(auth)) return null;
  if (!SUPA_URL || !SUPA_ANON) throw httpErr(500, "SUPABASE_URL · SUPABASE_ANON_KEY 환경변수가 설정되지 않았습니다");
  const token = auth.replace(/^Bearer\s+/i, "");
  const r = await fetch(SUPA_URL + "/auth/v1/user", { headers: { apikey: SUPA_ANON, Authorization: "Bearer " + token } });
  if (!r.ok) return null;
  return await r.json();
}

/* 사설·루프백·링크로컬 대역으로는 서버가 대신 요청을 보내지 않는다(SSRF 방지) —
   실제 헤드리스 브라우저로 페이지를 열기 때문에 이미지 조회(api/pagemeta)보다도
   더 신경 써야 한다. 도메인이 내부망 IP로 풀리는 경우까지 막는다. */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 ||
      (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    return low === "::1" || low.startsWith("fc") || low.startsWith("fd") || low.startsWith("fe80");
  }
  return true;
}
async function assertPublicHost(hostname) {
  if (/^localhost$/i.test(hostname)) throw httpErr(400, "내부 주소는 열 수 없습니다");
  const addrs = await dns.lookup(hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw httpErr(400, "주소를 확인할 수 없습니다");
  if (addrs.some(a => isPrivateIp(a.address))) throw httpErr(400, "내부 주소는 열 수 없습니다");
}

let browserPromise = null;                 // 워밍된 람다 인스턴스 안에서는 브라우저를 다시 띄우지 않는다
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const executablePath = await chromium.executablePath();
      /* @sparticuz/chromium은 "headless_shell" 빌드라 최신(puppeteer 기본값인) "새" 헤드리스
         모드를 지원하지 않는다 — 패키지 문서대로 args·headless 모두 "shell"로 맞춰야 한다.
         (chromium.headless 프로퍼티는 최근 버전에 더 이상 없다.) */
      return puppeteer.launch({
        args: puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
        defaultViewport: { width: 1280, height: 800 },
        executablePath,
        headless: "shell"
      });
    })().catch(e => { browserPromise = null; throw e; });
  }
  return browserPromise;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "허용되지 않은 메서드입니다" }); }
    const me = await whoAmI(req);
    if (!me) throw httpErr(401, "로그인이 필요합니다");

    const raw = new URL(req.url, "http://x").searchParams.get("url") || "";
    let target;
    try { target = new URL(raw); } catch (e) { throw httpErr(400, "올바른 주소가 아닙니다"); }
    if (!/^https?:$/.test(target.protocol)) throw httpErr(400, "http:// 또는 https:// 주소만 열 수 있습니다");
    await assertPublicHost(target.hostname);

    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      page.setDefaultNavigationTimeout(15000);
      try {
        await page.goto(target.href, { waitUntil: "load", timeout: 15000 });
      } catch (e) { /* 완전히 다 못 불러왔어도 지금까지 그려진 화면은 찍는다 */ }
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
