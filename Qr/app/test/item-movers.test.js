// 갑자기 잘 팔리거나 안 팔리는 메뉴 — 어제까지 7일 vs 그 전 4주 주 평균.
//
// 2026-09-30 사장님: "메뉴가 갑자기 안 팔리거나 갑자기 잘팔리거나 이런 걸 꾸준히
// 체크하면서 보여줬으면 좋겠는데 가능한가?"
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "item-movers";
process.env.ADMIN_PASSWORD = "ownerpass123";

const { computeItemMovers, computeTimeShift, addDays } = require("../src/itemMovers");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const TODAY = "2026-09-30";
let seq = 0;
// 하루에 qty 개씩, 날짜 [from, to] 동안.
function sell(orders, itemId, name, from, to, perDay, status = "paid") {
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!perDay) continue;
    orders.push({ id: ++seq, status, created_at: `${d} 12:00:00`, items: [{ item_id: itemId, name_ko: name, qty: perDay }] });
  }
}
const RECENT_START = "2026-09-23", END = "2026-09-29", BASE_START = "2026-08-26", BASE_END = "2026-09-22";

out.push("[고르는 규칙]");
{
  const orders = [];
  // A: 평소 주 14 → 최근 주 35 (하루 2 → 5)
  sell(orders, 1, "삼겹살", BASE_START, BASE_END, 2); sell(orders, 1, "삼겹살", RECENT_START, END, 5);
  // B: 평소 주 21 → 최근 주 7 (하루 3 → 1)
  sell(orders, 2, "해물파전", BASE_START, BASE_END, 3); sell(orders, 2, "해물파전", RECENT_START, END, 1);
  // C: 평소 주 14 → 최근 0
  sell(orders, 3, "순두부찌개", BASE_START, BASE_END, 2);
  // D: 평소 없음 → 최근 주 14 (새로 뜸)
  sell(orders, 4, "신메뉴", RECENT_START, END, 2);
  // E: 평소 주 14 → 최근 주 14 (그대로)
  sell(orders, 5, "공기밥", BASE_START, END, 2);
  // F: 평소 주 ~2 → 최근 주 5 (작은 숫자의 흔들림 — 무시)
  sell(orders, 6, "사이다", BASE_START, BASE_END, 0); for (const d of ["2026-08-27", "2026-09-03", "2026-09-10", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21"]) orders.push({ id: ++seq, status: "paid", created_at: `${d} 12:00:00`, items: [{ item_id: 6, name_ko: "사이다", qty: 1 }] });
  sell(orders, 6, "사이다", "2026-09-25", "2026-09-29", 1);
  // 취소·미결제 주문은 안 센다
  sell(orders, 7, "짜장면", RECENT_START, END, 9, "cancelled");
  // 오늘 주문은 안 센다(장사 중)
  sell(orders, 1, "삼겹살", TODAY, TODAY, 100);

  // 손님은 매일 20명으로 같다 — 기준 28일 560명, 최근 7일 140명.
  const r = computeItemMovers(orders, { today: TODAY, menuItems: [{ id: 3, name_ko: "순두부찌개" }], isSoldOut: (m) => m.id === 3, recentGuests: 140, baseGuests: 560 });
  const up = Object.fromEntries(r.up.map((m) => [m.name_ko, m]));
  const down = Object.fromEntries(r.down.map((m) => [m.name_ko, m]));
  check("기간 — 어제까지 7일, 그 전 4주", r.recent_start === RECENT_START && r.recent_end === END && r.base_start === BASE_START && r.base_end === BASE_END, JSON.stringify(r));
  check("★★ 늘어난 메뉴를 잡는다(손님 100명당 10 → 25개, +150%)", up["삼겹살"] && up["삼겹살"].recent === 35 && up["삼겹살"].expected === 14 && up["삼겹살"].base_per100 === 10 && up["삼겹살"].recent_per100 === 25 && up["삼겹살"].change_pct === 150, JSON.stringify(up["삼겹살"]));
  check("★ 오늘 판 것은 안 센다", up["삼겹살"] && up["삼겹살"].recent === 35, "");
  check("★★ 줄어든 메뉴를 잡는다(주 21 → 7)", down["해물파전"] && down["해물파전"].kind === "down" && down["해물파전"].change_pct === -67, JSON.stringify(down["해물파전"]));
  check("★★ 아예 안 팔린 메뉴 — 「7일간 0개」", down["순두부찌개"] && down["순두부찌개"].kind === "stopped" && down["순두부찌개"].recent === 0, JSON.stringify(down["순두부찌개"]));
  check("★ 지금 품절이면 그렇다고 붙인다", down["순두부찌개"] && down["순두부찌개"].sold_out === true, "");
  check("★ 새로 뜬 메뉴", up["신메뉴"] && up["신메뉴"].kind === "new", JSON.stringify(r.up.map((m) => m.name_ko)));
  check("그대로인 메뉴는 안 나온다", !up["공기밥"] && !down["공기밥"], "");
  check("★ 작은 숫자의 흔들림은 무시한다", !up["사이다"] && !down["사이다"], JSON.stringify(up["사이다"] || down["사이다"]));
  check("취소된 주문은 안 센다", !up["짜장면"], "");
  check("5주 흐름을 같이 준다(작은 선)", Array.isArray(up["삼겹살"].weeks) && up["삼겹살"].weeks.length === 5 && up["삼겹살"].weeks[4] === 35 && up["삼겹살"].weeks[0] === 14, JSON.stringify(up["삼겹살"].weeks));
  check("크게 달라진 순서로", r.up[0].name_ko === "삼겹살", JSON.stringify(r.up.map((m) => m.name_ko)));
}

out.push("\n[서비스 시작 전은 기준에서 뺀다]");
{
  const orders = [];
  sell(orders, 1, "삼겹살", "2026-09-08", BASE_END, 2);  // 서비스 시작 뒤 15일, 하루 2 → 주 14
  sell(orders, 1, "삼겹살", "2026-08-26", "2026-09-07", 50); // 시작 전 시험 주문 — 안 센다
  sell(orders, 1, "삼겹살", RECENT_START, END, 5);
  const r = computeItemMovers(orders, { today: TODAY, firstDay: "2026-09-08", recentGuests: 140, baseGuests: 300 });
  check("기준 날 수 = 서비스 시작 뒤 15일", r.base_days === 15 && r.base_start === "2026-09-08", JSON.stringify(r));
  const m = r.up.find((x) => x.name_ko === "삼겹살");
  check("★ 그 날들의 손님 수로 맞춘다(평소대로라면 14개)", m && m.expected === 14, JSON.stringify(m));
  const r2 = computeItemMovers(orders, { today: TODAY, firstDay: "2026-09-20", recentGuests: 140, baseGuests: 60 });
  check("★ 기준이 한 주도 안 되면 억지로 말하지 않는다", r2.insufficient === true && !r2.up.length && !r2.down.length, JSON.stringify(r2));
}

out.push("\n[손님 수에 비례해서 본다]");
// 2026-09-30 사장님: "전체적인 개수를 비교하면 안되고 집계 날짜와 인원수 수량과
// 비례해서 해야돼."
{
  const orders = [];
  // 모든 메뉴가 두 배로 팔린 주 — 그런데 손님도 두 배로 왔다.
  sell(orders, 1, "삼겹살", BASE_START, BASE_END, 2); sell(orders, 1, "삼겹살", RECENT_START, END, 4);
  sell(orders, 2, "해물파전", BASE_START, BASE_END, 3); sell(orders, 2, "해물파전", RECENT_START, END, 6);
  const busy = computeItemMovers(orders, { today: TODAY, recentGuests: 280, baseGuests: 560 });
  check("★★ 손님이 두 배 온 주에 다 같이 두 배 → 아무것도 안 뜬다", !busy.up.length && !busy.down.length, JSON.stringify(busy.up.concat(busy.down).map((x) => x.name_ko)));
  const flat = computeItemMovers(orders, { today: TODAY, recentGuests: 140, baseGuests: 560 });
  check("같은 판매를 손님 수 그대로로 보면 둘 다 늘었다", flat.up.length === 2, JSON.stringify(flat.up.map((x) => x.name_ko)));

  // 휴무가 끼어 손님이 반만 온 주 — 다 같이 반으로 줄었다.
  const orders2 = [];
  sell(orders2, 1, "삼겹살", BASE_START, BASE_END, 4); sell(orders2, 1, "삼겹살", RECENT_START, "2026-09-25", 4);
  sell(orders2, 2, "해물파전", BASE_START, BASE_END, 6); sell(orders2, 2, "해물파전", RECENT_START, "2026-09-25", 6);
  const slow = computeItemMovers(orders2, { today: TODAY, recentGuests: 60, baseGuests: 560 });
  check("★★ 쉬는 날이 끼어 손님이 적은 주 → 「덜 팔림」으로 안 뜬다", !slow.down.length, JSON.stringify(slow.down.map((x) => x.name_ko)));

  // 손님은 두 배인데 한 메뉴만 그대로 — 사실은 손이 덜 가는 것이다.
  const orders3 = [];
  sell(orders3, 1, "삼겹살", BASE_START, BASE_END, 3); sell(orders3, 1, "삼겹살", RECENT_START, END, 6);
  sell(orders3, 2, "해물파전", BASE_START, BASE_END, 3); sell(orders3, 2, "해물파전", RECENT_START, END, 3);
  const r3 = computeItemMovers(orders3, { today: TODAY, recentGuests: 280, baseGuests: 560 });
  check("★ 손님이 두 배인데 그대로인 메뉴 → 「덜 팔림」", r3.down.some((x) => x.name_ko === "해물파전") && !r3.up.length, JSON.stringify(r3));
  const r4 = computeItemMovers(orders3, { today: TODAY, recentGuests: 280, baseGuests: 560, weekGuests: [140, 140, 140, 140, 280] });
  const pf = r4.down.find((x) => x.name_ko === "해물파전");
  check("★ 작은 선도 손님 100명당 — 손님 두 배인 마지막 주는 절반으로 내려간다", pf && JSON.stringify(pf.weeks_per100) === JSON.stringify([15, 15, 15, 15, 7.5]), JSON.stringify(pf && pf.weeks_per100));
  check("★ 손님 수를 모르면 억지로 말하지 않는다", computeItemMovers(orders3, { today: TODAY }).insufficient === true, "");
}

out.push("\n[시간대가 바뀐 메뉴]");
// 2026-09-30 사장님: "늘 저녁에만 팔리던 메뉴가 갑자기 점심에 팔리기 시작하면 그것도 보고 싶고."
{
  const H = (half) => (o) => o.__half;
  function sellH(orders, itemId, name, from, to, perDay, half) {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (!perDay) continue;
      orders.push({ id: ++seq, status: "paid", __half: half, created_at: `${d} ${half === "am" ? "12" : "18"}:00:00`, items: [{ item_id: itemId, name_ko: name, qty: perDay }] });
    }
  }
  const halfOf = (o) => o.__half;
  const orders = [];
  // 동판불고기: 늘 저녁에만 → 최근에는 점심에도
  sellH(orders, 1, "동판불고기", BASE_START, END, 2, "pm");
  sellH(orders, 1, "동판불고기", RECENT_START, END, 2, "am");
  // 김치찌개: 점심·저녁 고르게 — 그대로
  sellH(orders, 2, "김치찌개", BASE_START, END, 2, "am"); sellH(orders, 2, "김치찌개", BASE_START, END, 2, "pm");
  // 삼겹살: 점심에 팔리다가 최근엔 저녁으로
  sellH(orders, 3, "삼겹살", BASE_START, BASE_END, 2, "am"); sellH(orders, 3, "삼겹살", RECENT_START, END, 2, "pm");
  // 사이다: 너무 적다
  sellH(orders, 4, "사이다", "2026-09-29", "2026-09-29", 1, "am"); sellH(orders, 4, "사이다", "2026-09-01", "2026-09-02", 1, "pm");
  const guests = { recentAm: 70, recentPm: 70, baseAm: 280, basePm: 280 };
  const r = computeTimeShift(orders, { today: TODAY, halfOf, guests });
  const by = Object.fromEntries(r.map((m) => [m.name_ko, m]));
  check("★★ 늘 저녁에만 팔리던 메뉴가 점심에도 → 「점심으로」", by["동판불고기"] && by["동판불고기"].kind === "to_lunch" && by["동판불고기"].lunch_share_before === 0 && by["동판불고기"].lunch_share_now === 50, JSON.stringify(by["동판불고기"]));
  check("★ 반대로 — 점심 메뉴가 저녁으로", by["삼겹살"] && by["삼겹살"].kind === "to_dinner", JSON.stringify(by["삼겹살"]));
  check("고르게 팔리는 메뉴는 안 뜬다", !by["김치찌개"], "");
  check("몇 개 안 팔린 메뉴로는 말하지 않는다", !by["사이다"], "");

  // 점심 손님만 네 배 온 주 — 점심 판매도 네 배. 손님 비례로 보면 그대로다.
  const o2 = [];
  sellH(o2, 2, "김치찌개", BASE_START, BASE_END, 2, "am"); sellH(o2, 2, "김치찌개", BASE_START, END, 2, "pm");
  sellH(o2, 2, "김치찌개", RECENT_START, END, 8, "am");
  const busyLunch = computeTimeShift(o2, { today: TODAY, halfOf, guests: { recentAm: 280, recentPm: 70, baseAm: 280, basePm: 280 } });
  check("★★ 점심 손님이 많이 온 주라 점심에 더 팔린 것 → 안 뜬다", !busyLunch.length, JSON.stringify(busyLunch));
  const flat = computeTimeShift(o2, { today: TODAY, halfOf, guests: { recentAm: 70, recentPm: 70, baseAm: 280, basePm: 280 } });
  check("같은 판매를 손님 수 그대로로 보면 「점심으로」가 뜬다(비례가 하는 일)", flat.length === 1 && flat[0].kind === "to_lunch", JSON.stringify(flat));
  check("★ 시간대 손님 수를 모르면 말하지 않는다", computeTimeShift(orders, { today: TODAY, halfOf }).length === 0, "");
}

out.push("\n[서버]");
(async () => {
  const request = require("supertest");
  const app = require("../server");
  await request(app).get("/api/menu");
  let r = await request(app).get("/api/settlements/item-movers");
  check("로그인 안 하면 못 본다", r.status === 401 || r.status === 403, `${r.status}`);
  const boss = request.agent(app);
  await boss.post("/api/auth/login").send({ password: "ownerpass123" });
  r = await boss.get("/api/settlements/item-movers");
  check("사장님은 본다", r.status === 200 && Array.isArray(r.body.up) && Array.isArray(r.body.down), JSON.stringify(r.body));
  check("하루 전체에는 시간대가 바뀐 메뉴가 같이 온다", Array.isArray(r.body.time_shift) && r.body.shift === "all", JSON.stringify(r.body));
  r = await boss.get("/api/settlements/item-movers?shift=am");
  check("점심만 볼 수 있다", r.status === 200 && r.body.shift === "am" && !("time_shift" in r.body), JSON.stringify(r.body));
  const fs = require("fs");
  const adminJs = fs.readFileSync(require("path").join(__dirname, "../public/js/admin.js"), "utf8");
  check("★ 판매 비중에 「기타」로 묶지 않는다", !/settlementPieOther"\)\} \(\$\{rest\.length\}\)/.test(adminJs) && /const slices = sorted\.map/.test(adminJs), "");
  for (const k of ["moversTitle", "moversNote", "moversNew", "moversStopped", "moversSoldOut", "moversShiftAm", "timeShiftTitle", "timeShiftRow", "timeShiftToLunch", "timeShiftNone"]) {
    check(`i18n ${k} 두 언어`, adminJs.split(`${k}:`).length - 1 === 2, "");
  }
  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
