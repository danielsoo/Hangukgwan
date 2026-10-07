// 월 결산·연 결산 — 매출에서 식자재비·인건비를 뺀다(src/periodSettlement.js).
//
// 2026-10-06 사장님: "결산탭에 월 결산, 연결산도 만들어줄래? 그 결산에는
// 식자재 비용, 급여도 같이 넣어서 계산하면 좋을 것 같은데?"
//
// 재는 것은 **셈이 맞는가**와 **모르는 것을 모른다고 하는가**다.
const assert = require("assert");
const P = require("../src/periodSettlement");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); n++; };

// ── 기간
{
  const m = P.rangeOf("2026-09");
  eq(m.kind, "month", "달");
  eq(m.start, "2026-09-01", "달 첫날");
  eq(m.end, "2026-09-30", "달 끝날 — 30일인 달");
  eq(P.rangeOf("2026-02").end, "2026-02-28", "2월");
  eq(P.rangeOf("2024-02").end, "2024-02-29", "★ 윤년 2월은 29일");
  const y = P.rangeOf("2026");
  eq(y.kind, "year", "해");
  eq(y.start + "~" + y.end, "2026-01-01~2026-12-31", "해의 처음과 끝");
  eq(P.rangeOf("2026-13"), null, "없는 달은 안 받는다");
  eq(P.rangeOf("26-09"), null, "모양이 다르면 안 받는다");
  eq(P.rangeOf(""), null, "빈 것");
  eq(P.monthsOf(y).length, 12, "한 해는 열두 달");
  eq(P.monthsOf(m).join(), "2026-09", "한 달은 자기 하나");
  ok(P.isOngoing(P.rangeOf("2026-10"), "2026-10-06"), "★ 이 달은 아직 진행 중");
  ok(!P.isOngoing(P.rangeOf("2026-09"), "2026-10-06"), "지난 달은 끝난 달");
  ok(P.isOngoing(P.rangeOf("2026"), "2026-10-06"), "올해는 진행 중");
}

// ── 셈
{
  const range = P.rangeOf("2026-09");
  const days = [
    { date: "2026-09-01", revenue: 30000, orders: 40, guests: 95 },
    { date: "2026-09-02", revenue: 25000, orders: 33, guests: 80 },
    { date: "2026-09-03", revenue: 45000, orders: 55, guests: 130 },
  ];
  const sum = P.summarize(
    range, days,
    { total: 20000, lines: 120, byMonth: { "2026-09": 20000 }, vendors: [{ vendor: "房信菓菜行", amount: 9000 }, { vendor: "泳慶蛋行", amount: 5000 }] },
    { total: 30000, staff: 4, hours: 620, byMonth: { "2026-09": 30000 } },
    { today: "2026-10-06", daysInRange: 30 }
  );
  eq(sum.revenue.total, 100000, "매출은 하루치를 더한 것");
  eq(sum.revenue.orders, 128, "주문 건수도");
  eq(sum.revenue.guests, 305, "손님 수도");
  eq(sum.left, 50000, "★★ 남은 것 = 매출 − 식자재 − 인건비");
  eq(sum.left_pct, 50, "★ 매출의 몇 %가 남았나");
  eq(sum.cost_pct.ingredients, 20, "★ 식자재 비율");
  eq(sum.cost_pct.payroll, 30, "★ 인건비 비율");
  eq(sum.revenue.days, 3, "장사한 날");
  // 30일 중 사흘치 기록밖에 없으면 **그렇게 말한다.** 조용히 더 적은 매출을
  // 보여주면 사장님이 「장사가 안 됐구나」로 읽는다.
  eq(sum.missing_days, 27, "★★ 마감 기록이 없는 날을 센다");
  ok(!sum.ongoing, "9월은 끝난 달");
  eq(sum.by_month, null, "달 결산에는 달별 쪼개기가 없다");
}

// ── 매출이 0 인 달
{
  const sum = P.summarize(P.rangeOf("2026-08"), [], { total: 5000 }, { total: 0 }, { today: "2026-10-06", daysInRange: 31 });
  eq(sum.revenue.total, 0, "매출 0");
  eq(sum.left, -5000, "★ 산 것만 있으면 마이너스");
  eq(sum.left_pct, null, "★★ 0 으로 나누지 않는다 — 비율은 「모름」");
  eq(sum.cost_pct.ingredients, null, "비율도 모름");
}

// ── 한 해
{
  const range = P.rangeOf("2026");
  const days = [
    { date: "2026-01-10", revenue: 100000, orders: 100, guests: 200 },
    { date: "2026-02-10", revenue: 200000, orders: 180, guests: 400 },
  ];
  const sum = P.summarize(
    range, days,
    { total: 60000, lines: 900, byMonth: { "2026-01": 20000, "2026-02": 40000 }, vendors: [] },
    { total: 90000, staff: 5, hours: 7000, byMonth: { "2026-01": 40000, "2026-02": 50000 } },
    { today: "2026-10-06", daysInRange: 365 }
  );
  eq(sum.revenue.total, 300000, "한 해 매출");
  eq(sum.left, 150000, "한 해 남은 것");
  eq(sum.by_month.length, 12, "★★ 달이 열두 줄");
  const jan = sum.by_month[0];
  eq(`${jan.month} ${jan.revenue} ${jan.ingredients} ${jan.payroll} ${jan.left}`, "2026-01 100000 20000 40000 40000", "★★ 달마다 같은 셈");
  const mar = sum.by_month[2];
  eq(mar.revenue + mar.ingredients + mar.payroll, 0, "자료 없는 달은 0 — 지어내지 않는다");
  ok(sum.ongoing, "올해는 진행 중");
}

// ── LINE 문자
{
  const sum = P.summarize(
    P.rangeOf("2026-09"),
    [{ date: "2026-09-01", revenue: 100000, orders: 128, guests: 305 }],
    { total: 20000, lines: 120, byMonth: {}, vendors: [{ vendor: "房信菓菜行", amount: 9000 }] },
    { total: 30000, staff: 4, hours: 620, byMonth: {} },
    { today: "2026-10-06", daysInRange: 30 }
  );
  const link = P.linkFor("https://www.hanguoguan.com.tw", "2026-09");
  eq(link, "https://www.hanguoguan.com.tw/admin?period=2026-09#settlement", "★ 그 달을 바로 여는 주소");
  const txt = P.lineText(sum, { link });
  ok(/9월 결산/.test(txt), "제목에 몇 월인지");
  ok(/매출 NT\$100,000/.test(txt), "매출");
  ok(/식자재 NT\$20,000/.test(txt) && /인건비 NT\$30,000/.test(txt), "두 비용");
  ok(/남은 것 NT\$50,000/.test(txt), "★★ 뺀 값");
  ok(/房信菓菜行/.test(txt), "많이 쓴 업체");
  // 사장님: "더 확실하게 알고 싶다면 링크 첨부하면서 메세지에 여기서 더 볼 수
  // 있다고 하는 것도 좋을 것 같아"
  ok(txt.includes(link), "★★ 링크가 들어 있다");
  ok(/더 자세히 보시려면/.test(txt), "★★ 여기서 더 볼 수 있다고 적는다");
  // 「이익」이라고 부르면 그 숫자로 판단하시게 된다 — 빠진 비용을 밝힌다.
  ok(/임대료·수도광열·세금은 아직 안 들어갔어요/.test(txt), "★★ 빠진 비용을 밝힌다");
  ok(!/이익/.test(txt), "★★ 「이익」이라고 쓰지 않는다");
  ok(/마감 기록이 없는 날 29일/.test(txt), "★★ 빠진 날을 문자에도 적는다");
}

// ── 진행 중인 달은 그렇게 적는다
{
  const sum = P.summarize(P.rangeOf("2026-10"), [{ date: "2026-10-01", revenue: 1000, orders: 1, guests: 2 }],
    { total: 0 }, { total: 0 }, { today: "2026-10-06", daysInRange: 6 });
  ok(/아직 진행 중/.test(P.lineText(sum, {})), "★ 이 달 것은 아직 진행 중이라고");
  const txt = P.lineText(sum, {});
  ok(!/더 자세히 보시려면/.test(txt), "링크가 없으면 그 줄도 없다");
}

console.log(`period-settlement: ${n}개 통과`);
