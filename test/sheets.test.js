/* ============================================================================
   시트 처리 로직 회귀 테스트

     node test/sheets.test.js

   브라우저·구글 시트 없이 parts/15-sheets.js · parts/16-perf.js 의 데이터 처리
   함수만 떼어 내 돌린다. 넣는 값은 실제 1.개인화DB · 3.개인화RAW 의 샘플 행이다.
   컬럼 순서·수식 해석·통계 판정이 틀어지면 여기서 먼저 걸린다.
   ========================================================================== */
const fs = require("fs"), vm = require("vm");

const prelude = `
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const ico = () => "<svg/>";
const CHAN = { push:{name:"앱 푸시",c:"p",ico:"braze"}, inapp:{name:"인앱",c:"i",ico:"mega"},
  email:{name:"이메일",c:"e",ico:"mail"}, kakao:{name:"알림톡",c:"k",ico:"chat"},
  banner:{name:"배너",c:"b",ico:"banner"}, sms:{name:"문자",c:"s",ico:"chat"} };
const CSTATUS = { live:"운영중", draft:"기획중", test:"테스트", ended:"종료" };
const CSTATUS_C = { live:"g", draft:"d", test:"t", ended:"r" };
const state = { boards: [{ nodes: [{ camps: [{ id:"c1", code:"A1-002" }] }] }] };
const viewStale = { perf: true };
const $ = () => null, $$ = () => [];
const toast = () => {};
`;

const path = require("path");
const root = path.join(__dirname, "..");                 // 어느 위치에서 실행해도 되게
const src = prelude +
  fs.readFileSync(path.join(root, "parts/15-sheets.js"), "utf8") +
  fs.readFileSync(path.join(root, "parts/16-perf.js"), "utf8");

/* 최상위 const/function 은 vm 컨텍스트 객체에 붙지 않으므로 명시적으로 내보낸다 */
const EXPORTS = ["SHEETS","aarrrMap","nextCampCode","codeCheck","ym","ratePct","perfHistory",
  "denomOf","perfLatest","perfAlerts","perfSeriesFor","trimMonths","perfFunnel","perfCampIndex",
  "hygieneReport","perfChartSvg","perfBadge","formulaToBasis","linkUrlOf","applySheetPayload",
  "normCampRows","normPerfRows","chanKey","statusKey","campLabel","basisHtml","chartCurve","niceMax"];
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(src + ";globalThis.__x = {" + EXPORTS.map(n => n + ":" + n).join(",") + "};",
  ctx, { filename: "bundle.js" });
Object.assign(ctx, ctx.__x);

/* ── 사용자가 준 1.개인화DB 실제 행 (A~AE = 31칸) ── */
const dbRows = [
  ["개인화","A1","획득 (인지)","회원가입 증대","A1-002","회원가입 유도",
   "IN_P_CRM_가입_트리거기반_공통_앱_회원가입유도_260701~260731","완료","인앱",
   "속성 메인 페이지 로딩 시 & 로그인 = N","7일 이내 회원가입 = Y","/product/main.yb","진행","O","","백지민",
   "실시간/자동화\nㄴ pkg_view_prodMain이 잡히면서 모수 증가로 CTR 감소",
   "(apppush clicks+join clicks)/impression","Conversion B","ALL","","Y","",
   52935,52935,52848,2980,760,0.056,0.014,9809523],
  ["개인화","A1","획득 (인지)","로그인 회원 증대","A1-003","로그인 유도",
   "IN_P_CRM_가입_트리거기반_공통_앱_회원가입유도_260701~260731","완료","인앱",
   "속성 메인 페이지 로딩 시 & 로그인 = N","7일 이내 로그인","/product/main.yb","진행","","","백지민",
   "실시간/자동화","(apppush clicks+join clicks)/impression","Conversion C","ALL","","Y","",
   52935,52935,52848,2980,5397,0.056,0.102,9809523],
  ["개인화","A2","활성화 (경험/탐색)","마케팅 가능 모수 증대","A2-001-01","앱 푸시 수신 동의 유도",
   "In_P_CRM_수신동의_트리거기반_공통_앱_푸시 유도","완료","인앱",
   "속성 메인 페이지 로딩 시 & 푸시 수신 동의 = N","캠페인 클릭 & 푸시 수신 동의 = Y","/product/main.yb","진행","O","","배지원",
   "실시간/자동화","body clicks/Unique Impressions","*26.04 재정의","ALL","","Y","SQL",
   22388,22388,22332,3267,204,0.146,0.029,5938183]
];
/* AC(CTR)·AD(CVR) 자리에 수식이 들어 있는 경우 */
const dbFormulas = [
  Array(28).fill("").concat(["=AA2/Y2","=AB2/Z2",""]),
  Array(28).fill("").concat(["=AA3/Y3","=AB3/Y3",""]),
  Array(28).fill("").concat(["","",""])
];
/* T·U열 셀에 걸린 하이퍼링크 */
const dbLinks = [
  ["https://dashboard-05.braze.com/engagement/campaigns/aaa", ""],
  ["", ""],
  ["https://dashboard-05.braze.com/engagement/campaigns/bbb", "https://example.com/b"]
];

/* ── 사용자가 준 3.개인화RAW 실제 행 (A~P = 16칸) ── */
const R = (d, code, goal, seg, name, chan, own, sent, recv, recvU, open, conv, ctr, cvr, rev) =>
  [d, code, goal, seg, name, chan, own, sent, recv, recvU, open, conv, ctr, cvr, rev, ""];
const rawRows = [
  R("2026-06-01","R1-010","매출 전환 (PKG)","쿠폰 만료 D-3 안내","(NEW) PKG 쿠폰 만료 전 안내","앱푸시","미정",1329,1326,1123,274,55,0.207,0.049,352517),
  R("2026-06-01","R1-101","매출 전환 (OTA)","항공 프로모션 노선 추천","OTA_항공탐색_항공판매","앱푸시","미정",71,71,63,19,0,0.268,0,0),
  R("2026-06-01","R2-007","재방문 유도","여행이력기반 추천","260204_In_P_CRM_여행이력기반","인앱","미정",31108,31108,29499,2916,1183,0.094,0.038,8011758),
  R("2026-07-01","A1-002","회원가입 증대","회원가입 유도","IN_P_CRM_가입","인앱","백지민",52935,52935,52848,2980,760,0.056,0.014,9809523),
  R("2026-07-01","A1-003","로그인 회원 증대","로그인 유도","IN_P_CRM_가입","인앱","백지민",52935,52935,52848,2980,5397,0.056,0.102,9809523),
  R("2026-08-01","A1-002","회원가입 증대","회원가입 유도","IN_P_CRM_가입","인앱","백지민",50000,50000,49900,1400,700,0.028,0.014,9000000),
  R("2026-08-01","R1-010","매출 전환 (PKG)","쿠폰 만료 D-3 안내","(NEW) PKG","앱푸시","미정",0,0,0,0,0,0,0,0),
  R("2026-07-01","R1-010","매출 전환 (PKG)","쿠폰 만료 D-3 안내","(NEW) PKG","앱푸시","미정",1300,1300,1100,270,54,0.208,0.049,350000),
  R("2026-05-01","R1-010","매출 전환 (PKG)","쿠폰 만료 D-3 안내","(NEW) PKG","앱푸시","미정",1310,1310,1110,272,54,0.208,0.049,351000),
  R("2026-06-01","ZZ-999","알 수 없음","고아 코드","마스터에 없는 캠페인","인앱","미정",10,10,10,1,0,0.1,0,0)
];

ctx.applySheetPayload({ campaigns: { rows: dbRows, formulas: dbFormulas, links: dbLinks },
                        perf: { rows: rawRows } }, 1234);

let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log("  ✗ " + name + "\n      기대: " + JSON.stringify(want) + "\n      실제: " + JSON.stringify(got)); }
  else console.log("  ✓ " + name + "  → " + JSON.stringify(got));
};

console.log("\n[1] 캠페인 마스터 정규화");
const S = ctx.SHEETS;
eq("캠페인 3건 로드", S.camps.length, 3);
eq("표시명 = 캠페인구분 [채널]", S.camps[0].label, "회원가입 유도 [인앱]");
eq("채널 코드 매핑", S.camps[0].chanCode, "inapp");
eq("상태 코드 매핑", S.camps[0].statusCode, "live");
eq("CTR 수식 → 컬럼명", S.camps[0].ctrFormula, "오픈 ÷ 수신");
eq("CVR 수식 → 컬럼명", S.camps[0].cvrFormula, "예약/반응 ÷ 수신(고유)");
eq("링크 글자는 ALL, 주소는 메타데이터", [S.camps[0].link1, S.camps[0].link1Url],
   ["ALL", "https://dashboard-05.braze.com/engagement/campaigns/aaa"]);
eq("주소 없는 링크는 목록에서 빠짐", S.camps[1].linkList.length, 0);
eq("퍼센트 서식 CTR 값", S.camps[0].ctr, 0.056);

console.log("\n[2] AARRR 매핑 · 코드 제안 · 중복 검사");
eq("AARRR 표는 시트에서 추출", ctx.aarrrMap(), { A1: "획득 (인지)", A2: "활성화 (경험/탐색)" });
eq("A1 다음 번호 제안", ctx.nextCampCode("A1"), "A1-004");
eq("A2 다음 번호 제안", ctx.nextCampCode("A2"), "A2-002");
eq("처음 쓰는 구분코드", ctx.nextCampCode("R9"), "R9-001");
eq("중복 코드 거부", ctx.codeCheck("A1-002", "A1", null).bad, true);
eq("접두사 불일치 거부", ctx.codeCheck("A2-004", "A1", null).bad, true);
eq("정상 코드 통과", ctx.codeCheck("A1-004", "A1", null).bad, false);
eq("수정 중 자기 코드는 통과", ctx.codeCheck("A1-002", "A1", "A1-002").bad, false);

console.log("\n[3] 성과 이력 정규화 · 집계");
eq("월 파싱", ctx.ym("2026-06-01"), "2026-06");
eq("0~1 비율을 %로", ctx.ratePct(0.056), 5.6000000000000005);
eq("이미 %인 값은 그대로", ctx.ratePct(20.7), 20.7);
const h = ctx.perfHistory("A1-002");
eq("A1-002 이력 2개월", h.map(r => r.month), ["2026-07", "2026-08"]);
eq("CTR 값(%)", [h[0].ctr.toFixed(1), h[1].ctr.toFixed(1)], ["5.6", "2.8"]);

console.log("\n[4] 통계적 유의성 (핵심 로직)");
eq("분모 역산 — 오픈2980 / CTR5.6% ≈ 수신52935", ctx.denomOf(2980, 5.6, null), 53214);
const big = ctx.perfLatest("A1-002");
eq("수신 5만 건의 2.8%p 하락은 유의", big.sigCtr, true);
eq("하락 폭", big.dCtr.toFixed(1), "-2.8");
eq("배지 기준월", big.month, "2026-08");
const small = ctx.perfLatest("R1-101");
eq("수신 71건 · 직전 달 없음 → 유의 판정 불가", small.sigCtr, false);

console.log("\n[5] 급락 감지");
const al = ctx.perfAlerts();
eq("급락 캠페인 코드", al.map(a => a.code + ":" + a.kind), ["A1-002:ctr"]);
eq("하락률 50% 이상", al.length ? al[0].drop > 0.4 : false, true);

console.log("\n[6] 빈 달·앞뒤 0 제거");
const months = ["2026-05", "2026-06", "2026-07", "2026-08"];
const ser = ctx.perfSeriesFor(["R1-010"], months);
eq("R1-010 월별 CTR", ser[0].ctr.map(v => v == null ? null : +v.toFixed(1)), [20.8, 20.7, 20.8, 0]);
const keep = ctx.trimMonths(ser, months);
eq("뒤쪽 0인 달은 잘림", keep.map(i => months[i]), ["2026-05", "2026-06", "2026-07"]);

console.log("\n[7] AARRR 요약 · 목록 정렬");
const fn = ctx.perfFunnel("2026-05", "2026-08");
eq("단계별 묶음", fn.map(f => f.code), ["A1", "기타"]);
eq("A1 캠페인 2건", fn[0].count, 2);
const idx = ctx.perfCampIndex();
eq("AARRR 순 → 그 안에서 최신 데이터 순", idx.map(b => b.code),
   ["A1-002", "A1-003", "R1-010", "R1-101", "R2-007", "ZZ-999"]);
eq("마지막 데이터 달 기록", idx[0].last, "2026-08");

console.log("\n[8] 점검 리포트");
const groups = ctx.hygieneReport().map(g => g.key + ":" + g.rows.length);
eq("점검 항목", groups, ["drop:1", "nodata:1", "unplaced:2", "orphan:4", "nolink:1"]);

console.log("\n[9] 차트 렌더링 (오류 없이 SVG 가 나오는지)");
const svg = ctx.perfChartSvg(ser, months);
eq("SVG 생성", svg.indexOf("<svg") >= 0, true);
eq("NaN 없음", svg.indexOf("NaN") < 0, true);
eq("undefined 없음", svg.indexOf("undefined") < 0, true);
const empty = ctx.perfChartSvg([], []);
eq("빈 데이터도 안전", empty.indexOf("NaN") < 0, true);
const badge = ctx.perfBadge("A1-002", "line");
eq("배지에 NaN 없음", badge.indexOf("NaN") < 0, true);
eq("배지 월 표기 (2608)", badge.indexOf("(2608)") >= 0, true);

console.log("\n[10] 없는 데이터 방어");
eq("성과 없는 코드 배지", ctx.perfBadge("없는코드", "line"), "");
eq("빈 시트에서 코드 제안", ctx.nextCampCode(""), "");
eq("수식 아닌 값", ctx.formulaToBasis("Conversion B"), "");
eq("HYPERLINK 수식에서 주소 추출",
   ctx.linkUrlOf("", '=HYPERLINK("https://x.com/a","ALL")', "ALL"), "https://x.com/a");

console.log(fail ? "\n실패 " + fail + "건\n" : "\n전부 통과\n");
process.exit(fail ? 1 : 0);
