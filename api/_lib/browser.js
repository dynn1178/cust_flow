/* ============================================================================
   api/_lib/browser.js — 헤드리스 브라우저 서버리스 함수(screenshot·detect-tags)가
   같이 쓰는 것들: 로그인 확인, 사설망 주소 차단(SSRF 방지), 브라우저 띄우기.

   파일 이름이 밑줄로 시작하는 폴더(_lib)는 Vercel이 라우트로 취급하지 않는다 —
   요청을 받는 진짜 함수가 아니라 그 함수들이 불러 쓰는 코드일 뿐이다.
   ========================================================================== */
const dns = require("dns").promises;
const net = require("net");

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
   실제 헤드리스 브라우저로 페이지를 열기 때문에 신경 써야 한다. 도메인이
   내부망 IP로 풀리는 경우까지 막는다. */
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

function parseTargetUrl(req) {
  const raw = new URL(req.url, "http://x").searchParams.get("url") || "";
  let target;
  try { target = new URL(raw); } catch (e) { throw httpErr(400, "올바른 주소가 아닙니다"); }
  if (!/^https?:$/.test(target.protocol)) throw httpErr(400, "http:// 또는 https:// 주소만 열 수 있습니다");
  return target;
}

let browserPromise = null;                 // 워밍된 람다 인스턴스 안에서는 브라우저를 다시 띄우지 않는다
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      /* 이 함수는 CommonJS인데 @sparticuz/chromium은 ESM 전용 패키지(package.json
         "type":"module")라 require()로는 못 불러온다 — 동적 import()를 써야 한다.
         이걸 파일 맨 위가 아니라 여기서, try/catch로 감싸 늦게 부르는 이유는:
         실패하면(바이너리가 배포 번들에 안 딸려갔다든지) 핸들러가 아예 시작도
         못 해 원인 모를 500만 뜨기 때문 — 여기서 하면 진짜 에러 메시지가 응답에 실린다. */
      let chromium, puppeteer;
      try {
        chromium = (await import("@sparticuz/chromium")).default;
        puppeteer = require("puppeteer-core");
      } catch (e) {
        throw httpErr(500, "헤드리스 브라우저 모듈을 불러오지 못했습니다: " + e.message);
      }
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

/* 헤드리스 브라우저라는 게 사이트에 그대로 드러나면(User-Agent에 박힌
   "HeadlessChrome", navigator.webdriver=true, 영어 기본 언어) 일부 사이트·SDK가
   "자동화된 방문"으로 보고 실제 트래킹 이벤트를 아예 안 보내기도 한다(관찰됨 —
   Braze가 이 사이트에서 그랬다). 우리는 QA 목적으로 실제 방문자가 보는 것과
   같은 트래킹 결과를 보려는 것이라, 일반 브라우저처럼 보이도록 몇 가지만
   맞춰 준다 — 우회가 목적이 아니라 정확한 측정이 목적이다. */
async function preparePage(page) {
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  await page.setUserAgent(ua);
  await page.setExtraHTTPHeaders({ "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7" });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "languages", { get: () => ["ko-KR", "ko", "en-US", "en"] });
  });
}

module.exports = { httpErr, whoAmI, assertPublicHost, parseTargetUrl, getBrowser, preparePage };
