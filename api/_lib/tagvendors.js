/* ============================================================================
   api/_lib/tagvendors.js — Amplitude·Braze·GA4로 나가는 요청인지 알아보고,
   이벤트 이름·속성을 뽑아내는 순수 로직. api/detect-tags.js(서버가 직접 페이지를
   열어 실시간으로 지켜보는 방식)와 api/import-har.js(사용자가 자기 브라우저에서
   직접 캡처한 HAR을 가져오는 방식) 둘 다 같은 요청(url·method·body) 하나하나를
   보고 판단하는 부분은 완전히 같아서 여기 하나로 모아 둔다.

   파일 이름이 밑줄로 시작하는 폴더(_lib)는 Vercel이 라우트로 취급하지 않는다.
   ========================================================================== */

/* GA4는 요즘 사이트가 서버사이드 GTM·자체 프록시 도메인으로 우회해서 보내는
   경우가 흔해 호스트 이름만으로는 자주 놓친다 — 그래서 호스트 이름과 별개로
   "tid=G-..." 쿼리(측정 ID 규격)가 있으면 도메인이 무엇이든 GA4로 본다. */
function looksLikeGA4(u) {
  const host = u.hostname.toLowerCase();
  if (host.indexOf("google-analytics.com") >= 0 || host.indexOf("analytics.google.com") >= 0) return true;
  const tid = u.searchParams.get("tid");
  return !!(tid && /^G-/i.test(tid));
}
/* 광고 차단 우회 등으로 자체(커스텀) 도메인 뒤에 Braze를 숨겨 두면 호스트
   이름만으로는 못 알아본다 — Braze SDK가 보내는 요청 본문에는 어느 도메인을
   쓰든 항상 app_group_id가 실려 있어서, 이 필드로 도메인과 무관하게 알아본다. */
function looksLikeBrazeBody(postData) {
  if (!postData) return false;
  try {
    const j = JSON.parse(postData);
    return !!(j && (j.app_group_id || j.appGroupId) && (j.events || j.attributes || j.triggers || j.purchases));
  } catch (e) {
    return /"app_group_id"\s*:/.test(postData);
  }
}
function vendorOf(u, postData) {
  const host = u.hostname.toLowerCase();
  if (host.indexOf("amplitude.com") >= 0) return "amplitude";
  if (host.indexOf("braze.com") >= 0 || host.indexOf("braze.eu") >= 0 || host.indexOf("appboy.com") >= 0) return "braze";  // appboy = Braze의 옛 이름(오래된 SDK가 아직 씀)
  if (looksLikeGA4(u)) return "ga4";
  if (looksLikeBrazeBody(postData)) return "braze";
  return null;
}

/* 실제로 관찰해 보니 자체 래퍼를 쓰는 사이트가 많다 — 예를 들어
   {name:"ss", data:{n:"pkg_view_prodMain", p:{deviceType:"WEB_PC", ...}}}
   처럼 진짜 속성이 몇 단계 더 안쪽(data.p)에 들어있는 경우가 흔하다.
   그래서 얼마나 깊이 들어있든 상관없이 맨 안쪽 값(leaf)까지 내려가서
   "그 값의 원래 키 이름 = 값"으로 펼쳐 담는다 — deviceType이 어디에 있든
   그대로 deviceType 속성이 되게 하려는 것. 배열이나 빈 객체는 그대로 하나의
   값으로 남긴다(펼치면 의미가 사라지는 경우가 많아서). */
function flattenProps(obj, depth) {
  const out = {};
  if (!obj || typeof obj !== "object" || (depth || 0) > 4) return out;
  Object.keys(obj).forEach(k => {
    const v = obj[k];
    if (v === null || v === undefined || v === "") return;
    if (Array.isArray(v)) { if (v.length) out[k] = v; return; }
    if (typeof v === "object") {
      const nested = flattenProps(v, (depth || 0) + 1);
      if (Object.keys(nested).length) Object.assign(out, nested);
      return;
    }
    out[k] = v;
  });
  return out;
}
const cleanProps = flattenProps;

/* 각 업체가 실제 브라우저 SDK에서 이벤트를 실어 보내는 모양은 공식 규격이
   없다시피 해서(관찰 기반), 여러 형태를 순서대로 시도한다. JSON 구조가 예상과
   다르면(중첩이 달라졌다든지) 정규식으로 한 번 더 훑어서 최대한 건진다.
   이름만이 아니라 그 이벤트가 실어 보낸 속성(event_properties 등)도 같이
   돌려줘서, 태그를 만들 때 속성 칸까지 자동으로 채울 수 있게 한다. */
/* GA4(Measurement Protocol)가 쓰는 프로토콜용 파라미터 — 클라이언트 ID·동의값·
   User-Agent Client Hints 등 SDK가 자동으로 붙이는 것들이라 실제로 개발자가
   심은 "이벤트 속성"이 아니다. 이 목록에 없는 나머지만 속성으로 본다.
   ep.* / epn.* (커스텀 파라미터의 공식 접두사)는 접두사를 떼고 남긴다. */
const GA4_RESERVED = ["v", "tid", "gtm", "_p", "cid", "_gaz", "gcd", "npa", "dma", "dma_cps",
  "_eu", "are", "frm", "pscdl", "_s", "sid", "sct", "seg", "dl", "dt", "ul", "sr", "uaa", "uab",
  "uafvl", "uam", "uamb", "uap", "uapv", "uafm", "_et", "_fplc", "gcs", "_dbg", "tfd", "en", "_ss",
  "ir", "rcb", "uaw", "gaf", "tag_exp", "_fv", "_nsi", "aip", "cs", "cm", "cn", "ck", "cc", "ci",
  "richsstsse", "gtm_up", "up", "uid", "_c"];
function eventsFromGA4(u, postData) {
  const out = [];
  const en = u.searchParams.get("en");
  if (en) {
    const props = {};
    u.searchParams.forEach((v, k) => {
      if (GA4_RESERVED.indexOf(k) >= 0) return;
      const clean = k.replace(/^epn?\./, "");     // ep.discount, epn.price 같은 커스텀 파라미터 접두사
      props[clean] = v;
    });
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
/* 표준 Amplitude SDK는 {event_type, event_properties}로 보내지만, 자체 래퍼를
   씌운 사이트는 {name, data:{n, p}} 처럼 아예 다른 키 이름을 쓰기도 한다.
   이벤트 이름이 될 만한 필드와, 나머지는 전부 속성 후보로 본다. */
const AMP_NAME_KEYS = ["event_type", "name", "eventType", "n"];
const AMP_META_KEYS = ["device_id", "event_id", "session_id", "insert_id", "ip", "language",
  "library", "platform", "time", "user_agent", "user_id", "app_version", "os_name", "os_version",
  "device_model", "country", "region", "city", "dma", "idfa", "adid", "uuid"];
function eventsFromAmplitude(u, postData) {
  const out = [];
  const scan = raw => {
    if (!raw) return false;
    try {
      const j = JSON.parse(raw);
      const list = Array.isArray(j) ? j : (j.events || (AMP_NAME_KEYS.some(k => j[k]) ? [j] : []));
      let any = false;
      list.forEach(e => {
        if (!e) return;
        const nameKey = AMP_NAME_KEYS.find(k => e[k]);
        if (!nameKey) return;
        any = true;
        const rest = {};
        Object.keys(e).forEach(k => {
          if (k === nameKey || k === "event_properties" || k === "user_properties") return;
          if (AMP_META_KEYS.indexOf(k) < 0) rest[k] = e[k];
        });
        out.push({ name: e[nameKey], properties: flattenProps(Object.assign({}, e.event_properties, rest)) });
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
    (j.events || []).forEach(e => {
      if (!e) return;
      /* 표준 Braze는 {name, properties}지만, 자체 래퍼를 쓰는 사이트는
         {name:"ce", data:{n:실제이름, p:실제속성}} 처럼 진짜 이름·속성이
         한 단계 더 안쪽(data)에 있다 — Amplitude 때와 같은 패턴이라 똑같이 본다. */
      const realName = (e.data && e.data.n) || e.name;
      if (!realName) return;
      const propsSrc = (e.data && e.data.p) ? e.data.p : e.properties;
      out.push({ name: realName, properties: flattenProps(propsSrc) });
    });
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

/* 요청(url·method·body)을 하나씩 넣어 주면 알아서 업체를 가리고 이벤트를
   쌓아 두는 누산기 — 실시간 크롤링(page.on("request"))이든 HAR 파일을
   한 줄씩 훑는 것이든 호출하는 쪽만 다를 뿐 이 안의 판단 로직은 똑같다. */
function makeCollector(pageParams) {
  const found = { amplitude: new Map(), braze: new Map(), ga4: new Map() };   // name -> properties
  const seenVendor = { amplitude: false, braze: false, ga4: false };
  /* 파싱이 실제로 맞는지 확인하려면 원본을 봐야 한다 — 업체별로 몇 개만
     잘라서 같이 돌려준다(요청 주소 + 본문 앞부분). */
  const debug = { amplitude: [], braze: [], ga4: [] };
  const DEBUG_MAX = 4;

  function ingest(urlStr, method, postData) {
    let u;
    try { u = new URL(urlStr); } catch (e) { return; }
    const vendor = vendorOf(u, postData);
    if (!vendor) return;   // GA4/Amplitude/Braze만 본다
    seenVendor[vendor] = true;
    const items = vendor === "ga4" ? eventsFromGA4(u, postData)
      : vendor === "amplitude" ? eventsFromAmplitude(u, postData)
      : eventsFromBraze(postData);
    items.forEach(it => {
      const name = String(it.name).slice(0, 80);
      if (!found[vendor].has(name)) found[vendor].set(name, Object.assign({}, pageParams));
      Object.assign(found[vendor].get(name), it.properties || {});
    });
    if (debug[vendor].length < DEBUG_MAX) {
      debug[vendor].push({
        method: method || "GET", url: String(urlStr).slice(0, 300),
        body: postData ? String(postData).slice(0, 500) : null,
        parsed: items
      });
    }
  }

  function toOutput() {
    const out = {};
    ["amplitude", "braze", "ga4"].forEach(k => {
      out[k] = {
        detected: seenVendor[k],
        events: Array.from(found[k].entries()).map(([name, properties]) => ({ name, properties })),
        debug: debug[k]
      };
    });
    return out;
  }

  return { ingest, toOutput };
}

module.exports = { vendorOf, flattenProps, cleanProps, eventsFromGA4, eventsFromAmplitude, eventsFromBraze, makeCollector };
