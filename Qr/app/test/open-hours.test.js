// 영업시간이 아닐 때 주문이 막히는가 — 규칙 자체를 분 단위로 잰다.
//
// 2026-09-10 사장님: "영업시간이 아닐 때는 직원을 제외하고 qr 코드로 주문
// 안되게 해줘."
//
// 여기서 제일 중요한 건 "잘못 막지 않는가" 다. 못 막으면 직원이 주문을
// 지우면 그만이지만, 잘못 막히면 손님은 그냥 나가고 우리는 그런 일이
// 있었다는 것조차 모른다. 그래서 설정이 없거나 이상할 때 열려 있는지를
// 먼저 확인한다.
const oh = require("../src/openHours");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

// 2026-09-10 은 목요일, 09-13 은 일요일.
const HOURS = {
  order_hours: {
    enabled: 1,
    ranges: [{ start: "11:00", end: "14:00" }, { start: "17:00", end: "21:00" }],
    closed_days: [],
  },
};

out.push("[정한 적이 없으면 아무것도 막지 않는다]");
// 이 줄이 무너지면 배포하는 순간 전 매장이 주문을 못 받는다.
check("설정 자체가 없으면 열려 있다", oh.isOpenNow({}, "2026-09-10 03:00:00"));
check("store_hours 만 있어도 열려 있다",
  oh.isOpenNow({ store_hours: "11:00-21:00" }, "2026-09-10 03:00:00"));
check("꺼두면 새벽에도 열려 있다",
  oh.isOpenNow({ order_hours: { enabled: 0, ranges: HOURS.order_hours.ranges } }, "2026-09-10 03:00:00"));
check("구간이 비어 있으면 열려 있다",
  oh.isOpenNow({ order_hours: { enabled: 1, ranges: [] } }, "2026-09-10 03:00:00"));
check("구간이 쓰레기값이면 열려 있다",
  oh.isOpenNow({ order_hours: { enabled: 1, ranges: [{ start: "저녁", end: "밤" }] } }, "2026-09-10 03:00:00"));

out.push("\n[영업시간 안팎을 분 단위로]");
const t = (hhmm) => oh.isOpenNow(HOURS, `2026-09-10 ${hhmm}:00`);
check("10:59 안 받는다", !t("10:59"));
check("11:00 받는다 (여는 순간 포함)", t("11:00"));
check("13:59 받는다", t("13:59"));
check("14:00 안 받는다 (닫는 순간 제외)", !t("14:00"));
check("16:59 안 받는다 (브레이크)", !t("16:59"));
check("17:00 받는다", t("17:00"));
check("20:59 받는다", t("20:59"));
check("21:00 안 받는다", !t("21:00"));
check("새벽 03:00 안 받는다", !t("03:00"));

out.push("\n[휴무 요일은 하루 종일 안 받는다]");
const withClosed = { order_hours: Object.assign({}, HOURS.order_hours, { closed_days: [0] }) };
check("일요일(09-13) 점심에도 안 받는다", !oh.isOpenNow(withClosed, "2026-09-13 12:00:00"));
check("목요일(09-10) 점심은 그대로 받는다", oh.isOpenNow(withClosed, "2026-09-10 12:00:00"));
check("월요일(09-14) 점심도 받는다", oh.isOpenNow(withClosed, "2026-09-14 12:00:00"));
// 7일 전부 휴무는 "영영 못 받는다" 는 뜻이라 실수일 가능성이 훨씬 크다.
check("7일 전부 휴무는 무시한다",
  oh.isOpenNow({ order_hours: { enabled: 1, ranges: HOURS.order_hours.ranges, closed_days: [0,1,2,3,4,5,6] } }, "2026-09-10 12:00:00"));

out.push("\n[자정을 넘는 구간]");
// 지금 이 가게엔 없지만, 나중에 생겼을 때 조용히 틀리는 것보다 낫다.
const late = { order_hours: { enabled: 1, ranges: [{ start: "17:00", end: "02:00" }], closed_days: [] } };
check("목요일 23:00 받는다", oh.isOpenNow(late, "2026-09-10 23:00:00"));
check("금요일 01:00 받는다 (목요일 영업의 연장)", oh.isOpenNow(late, "2026-09-11 01:00:00"));
check("금요일 03:00 안 받는다", !oh.isOpenNow(late, "2026-09-11 03:00:00"));
const lateClosed = { order_hours: { enabled: 1, ranges: [{ start: "17:00", end: "02:00" }], closed_days: [4] } };
check("목요일 휴무면 금요일 01:00 도 안 받는다", !oh.isOpenNow(lateClosed, "2026-09-11 01:00:00"));

out.push("\n[언제부터 되는지 알려준다]");
// "안 됩니다" 만 보여주면 손님은 기다려야 할지 나가야 할지 알 수 없다.
check("10:00 → 오늘 11:00", oh.nextOpenAt(HOURS, "2026-09-10 10:00:00") === "2026-09-10 11:00", oh.nextOpenAt(HOURS, "2026-09-10 10:00:00"));
check("15:00 → 오늘 17:00", oh.nextOpenAt(HOURS, "2026-09-10 15:00:00") === "2026-09-10 17:00", oh.nextOpenAt(HOURS, "2026-09-10 15:00:00"));
check("22:00 → 내일 11:00", oh.nextOpenAt(HOURS, "2026-09-10 22:00:00") === "2026-09-11 11:00", oh.nextOpenAt(HOURS, "2026-09-10 22:00:00"));
check("일요일 휴무면 토요일 밤 → 월요일 11:00",
  oh.nextOpenAt(withClosed, "2026-09-12 22:00:00") === "2026-09-14 11:00", oh.nextOpenAt(withClosed, "2026-09-12 22:00:00"));
check("열려 있을 땐 굳이 계산하지 않는다", oh.orderingState(HOURS, "2026-09-10 12:00:00").next_open_at === null);

out.push("\n[이미 적어둔 영업시간에서 출발한다]");
// 사장님이 처음 이 화면을 열었을 때 빈 칸부터 시작하지 않게.
const parsed = oh.parseHoursText("11:00-14:00, 17:00-21:00");
check("두 구간을 뽑는다", parsed.length === 2, JSON.stringify(parsed));
check("첫 구간이 11:00~14:00", parsed[0].start === "11:00" && parsed[0].end === "14:00", JSON.stringify(parsed[0]));
check("물결표도 읽는다", oh.parseHoursText("11:00~21:00").length === 1);
check("한 자리 시각도 읽는다", oh.parseHoursText("9:30-18:00")[0].start === "09:30", JSON.stringify(oh.parseHoursText("9:30-18:00")));
check("못 읽으면 빈 배열", oh.parseHoursText("매일 아침부터 밤까지").length === 0);
check("못 읽으면 기본값으로 채운다",
  oh.normalize({ enabled: 1 }, "매일 아침부터 밤까지").ranges[0].start === "11:00");

out.push("\n[화면에 내려보내는 값]");
const closedState = oh.orderingState(HOURS, "2026-09-10 15:00:00");
check("지금 닫혀 있다고 말한다", closedState.open === false);
check("규칙이 켜져 있다고 말한다", closedState.enabled === true);
check("영업시간 문구를 같이 준다", closedState.ranges_text === "11:00~14:00, 17:00~21:00", closedState.ranges_text);
check("언제부터인지 같이 준다", closedState.next_open_at === "2026-09-10 17:00", closedState.next_open_at);

out.push("\n[다듬기]");
check("구간을 시각순으로 정렬한다",
  oh.normalize({ enabled: 1, ranges: [{ start: "17:00", end: "21:00" }, { start: "11:00", end: "14:00" }] }).ranges[0].start === "11:00");
check("길이 0 인 구간은 버린다",
  oh.normalize({ enabled: 1, ranges: [{ start: "11:00", end: "11:00" }] }, "17:00-21:00").ranges[0].start === "17:00");
check("휴무 요일은 0~6 만 받는다",
  JSON.stringify(oh.normalize({ enabled: 1, closed_days: [0, 9, -1, "3"] }).closed_days) === "[0,3]",
  JSON.stringify(oh.normalize({ enabled: 1, closed_days: [0, 9, -1, "3"] }).closed_days));
check("enabled 는 0/1 로 굳힌다", oh.normalize({ enabled: "yes" }).enabled === 1 && oh.normalize({}).enabled === 0);

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
