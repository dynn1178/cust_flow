/* ============================================================================
   /api/import-har — 상품 클릭처럼 "사용자 동작이 있어야만 나가는" 이벤트는
   서버가 페이지를 가만히 열어두기만 해서는(api/detect-tags.js) 절대 잡히지
   않는다. 그렇다고 헤드리스 브라우저가 페이지 요소를 대신 클릭하게 만들면
   ① 어떤 문구를 누를지 미리 정확히 알아야 하고 ② 실제 상거래 사이트라
   잘못된 요소(장바구니 등)를 누를 위험이 있고 ③ 봇 감지·동의 배너 때문에
   Braze 같은 SDK가 아예 응답하지 않기도 한다(preparePage로도 완전히
   해결되지 않았다).

   가장 확실한 방법은 실제 사람이 실제 로그인된 브라우저로 평소처럼 클릭해
   보는 것 — 그 세션에서 나간 요청을 DevTools의 Network 탭 → 우클릭 →
   "Save all as HAR with content"로 그대로 내보낸 걸 여기로 가져와 훑는다.
   봇 감지·동의 배너·교차출처·서버 실행시간 제한 중 어느 것도 걸리지 않는다
   — 사용자가 무엇을 클릭했는지 우리가 추측할 필요조차 없다.

   업체 판단·이벤트 추출 로직은 api/detect-tags.js와 완전히 같은 것을
   api/_lib/tagvendors.js에서 함께 쓴다 — HAR 안의 요청 하나하나를 그
   자리에서 실시간으로 보는 대신 파일로 훑어볼 뿐, "이게 어느 업체의
   어떤 이벤트인가"를 판단하는 부분은 동일하다.

   요청 본문(브라우저에서 최소한만 추려 보낸다 — HAR 원본 전체를 그대로
   올리면 이미지·응답 본문까지 실려 너무 커진다):
     POST /api/import-har?url=<지금 보고 있던 페이지 주소, 선택>
     { "entries": [{ "url": "...", "method": "POST", "postData": "..." }, ...] }

   필요한 환경변수 (api/sheets.js 와 같다)
     SUPABASE_URL, SUPABASE_ANON_KEY

   권한 — 로그인한 회원 누구나
   ========================================================================== */
const { httpErr, whoAmI } = require("./_lib/browser");
const { makeCollector } = require("./_lib/tagvendors");

const MAX_ENTRIES = 5000;   // 비정상적으로 큰 HAR을 올려도 서버가 오래 붙잡히지 않도록

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "허용되지 않은 메서드입니다" }); }
    const me = await whoAmI(req);
    if (!me) throw httpErr(401, "로그인이 필요합니다");

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const entries = Array.isArray(body.entries) ? body.entries.slice(0, MAX_ENTRIES) : null;
    if (!entries) throw httpErr(400, "올바른 HAR 데이터가 아닙니다");

    /* 페이지 주소를 같이 보내줬다면(선택) 그 쿼리 파라미터도 QA에 쓸모 있는
       속성으로 같이 얹어 준다 — api/detect-tags.js와 같은 방식. */
    const pageParams = {};
    const rawUrl = new URL(req.url, "http://x").searchParams.get("url");
    if (rawUrl) {
      try { new URL(rawUrl).searchParams.forEach((v, k) => { if (v) pageParams[k] = v; }); } catch (e) {}
    }

    const collector = makeCollector(pageParams);
    let skipped = 0;
    entries.forEach(e => {
      if (!e || !e.url) { skipped++; return; }
      collector.ingest(e.url, e.method, e.postData || null);
    });

    const out = Object.assign({ pageParams, entryCount: entries.length, skipped }, collector.toOutput());
    console.log("[import-har]", rawUrl || "(주소 없음)", "entries:", entries.length, JSON.stringify(out));
    return res.status(200).json(out);
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    return res.status(status).json({ error: (e && e.message) || "HAR을 읽지 못했습니다" });
  }
};

module.exports.config = { maxDuration: 15 };   // 헤드리스 브라우저 없이 파일만 훑으니 훨씬 빠르다
