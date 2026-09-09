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

out.push("\n[요일마다 시간이 다를 수 있다]");
// 2026-09-10 사장님: "요일마다 다를 수 있는데 그것도 넣었어?"
// 09-10 목(4), 09-11 금(5), 09-12 토(6), 09-13 일(0), 09-14 월(1).
const byDay = {
  order_hours: {
    enabled: 1,
    ranges: [{ start: "11:00", end: "14:00" }, { start: "17:00", end: "21:00" }],
    closed_days: [1],
    day_ranges: { "6": [{ start: "11:00", end: "22:00" }] },
  },
};
check("토요일은 브레이크 없이 이어서 받는다", oh.isOpenNow(byDay, "2026-09-12 15:00:00"));
check("토요일은 21:30 에도 받는다", oh.isOpenNow(byDay, "2026-09-12 21:30:00"));
check("토요일도 22:00 에는 안 받는다", !oh.isOpenNow(byDay, "2026-09-12 22:00:00"));
check("목요일은 그대로 브레이크가 있다", !oh.isOpenNow(byDay, "2026-09-10 15:00:00"));
check("일요일도 기본 시간대로", oh.isOpenNow(byDay, "2026-09-13 12:00:00"));
// 휴무가 요일별 시간보다 세다. 문 닫는 날에 시간을 적어둔 채로 두는 일은
// 흔한데, 그때 시간이 이기면 휴무일에 주문이 들어온다.
const closedWins = {
  order_hours: {
    enabled: 1,
    ranges: [{ start: "11:00", end: "21:00" }],
    closed_days: [1],
    day_ranges: { "1": [{ start: "11:00", end: "22:00" }] },
  },
};
check("휴무 요일에 시간을 적어둬도 휴무가 이긴다", !oh.isOpenNow(closedWins, "2026-09-14 12:00:00"));
check("요일별 시간이 없는 요일은 기본을 쓴다",
  JSON.stringify(oh.rangesForDate(oh.orderHours(byDay.order_hours ? byDay : {}), "2026-09-10")) ===
    JSON.stringify(byDay.order_hours.ranges));
// 기본을 비워두고 특정 요일만 적어둔 경우 — 그 요일 말고는 전부 닫힌다.
const onlySaturday = {
  order_hours: { enabled: 1, ranges: [], closed_days: [], day_ranges: { "6": [{ start: "11:00", end: "22:00" }] } },
};
check("토요일만 적어두면 토요일엔 받는다", oh.isOpenNow(onlySaturday, "2026-09-12 12:00:00"));
check("토요일만 적어두면 다른 날은 안 받는다", !oh.isOpenNow(onlySaturday, "2026-09-10 12:00:00"));

out.push("\n[태풍처럼 그 날 하루만 쉬는 경우]");
// 2026-09-10 사장님: "특정 요일을 쉴수도 있잖아 예를 들어 태풍이 불거나
// 휴무를 해야 하거나 뭐 다양한 이유들."
// 요일 규칙으로는 못 적는 일회성 사정이다. 날짜가 가장 세다 — 평소 규칙을
// 고치는 게 아니라 하루만 덮는 것이라, 다음 날은 저절로 평소대로 돌아온다.
const typhoon = {
  order_hours: {
    enabled: 1,
    ranges: [{ start: "11:00", end: "21:00" }],
    closed_days: [],
    day_ranges: {},
    date_rules: { "2026-09-11": { closed: 1, note: "태풍" } },
  },
};
check("그 날은 낮에도 안 받는다", !oh.isOpenNow(typhoon, "2026-09-11 12:00:00"));
check("전날은 평소대로 받는다", oh.isOpenNow(typhoon, "2026-09-10 12:00:00"));
check("다음날은 저절로 돌아온다", oh.isOpenNow(typhoon, "2026-09-12 12:00:00"));
{
  const st = oh.orderingState(typhoon, "2026-09-11 12:00:00");
  check("오늘 휴무라고 알려준다", st.today_closed === true);
  check("이유도 같이 알려준다", st.today_note === "태풍", st.today_note);
  check("다음 영업은 다음날 11:00", st.next_open_at === "2026-09-12 11:00", st.next_open_at);
}
// 문을 닫지 않고 시간만 줄인 날도 이유를 손님에게 전한다 — 휴무일 때만
// 되면 "태풍이라 저녁만 합니다" 를 알릴 방법이 없다.
{
  const st = oh.orderingState({
    order_hours: {
      enabled: 1, ranges: [{ start: "11:00", end: "21:00" }], closed_days: [], day_ranges: {},
      date_rules: { "2026-09-11": { ranges: [{ start: "17:00", end: "21:00" }], note: "태풍으로 저녁만" } },
    },
  }, "2026-09-11 12:00:00");
  check("시간만 줄인 날도 이유가 나간다", st.today_note === "태풍으로 저녁만", st.today_note);
  check("그 날은 휴무가 아니다", st.today_closed === false);
  check("그 날 시간을 보여준다", st.ranges_text === "17:00~21:00", st.ranges_text);
}

// 그 날만 시간을 줄이는 경우 — 태풍이 지나간 오후에만 연다.
const halfDay = {
  order_hours: {
    enabled: 1,
    ranges: [{ start: "11:00", end: "21:00" }],
    closed_days: [],
    day_ranges: {},
    date_rules: { "2026-09-11": { ranges: [{ start: "17:00", end: "21:00" }] } },
  },
};
check("그 날 오전은 안 받는다", !oh.isOpenNow(halfDay, "2026-09-11 12:00:00"));
check("그 날 저녁은 받는다", oh.isOpenNow(halfDay, "2026-09-11 18:00:00"));
check("손님에게 그 날 시간을 보여준다",
  oh.orderingState(halfDay, "2026-09-11 09:00:00").ranges_text === "17:00~21:00",
  oh.orderingState(halfDay, "2026-09-11 09:00:00").ranges_text);

// 날짜가 요일보다 세다 — 정기 휴무일인데 그 날만 특별히 여는 경우.
const openOnHoliday = {
  order_hours: {
    enabled: 1,
    ranges: [{ start: "11:00", end: "21:00" }],
    closed_days: [1],
    day_ranges: {},
    date_rules: { "2026-09-14": { ranges: [{ start: "11:00", end: "21:00" }] } },
  },
};
check("정기 휴무일이어도 그 날만 열 수 있다", oh.isOpenNow(openOnHoliday, "2026-09-14 12:00:00"));
check("다음 주 같은 요일은 그대로 휴무", !oh.isOpenNow(openOnHoliday, "2026-09-21 12:00:00"));

out.push("\n[날짜 규칙 다듬기]");
check("날짜 형식이 아니면 버린다",
  Object.keys(oh.normalize({ enabled: 1, ranges: [{ start: "11:00", end: "21:00" }],
    date_rules: { "내일": { closed: 1 }, "2026-13-99": { closed: 1 } } }).date_rules).length === 0);
// 「닫지도 않고 시간도 없는 날」은 평소대로라는 뜻이라, 적어두지 않는 것과 같다.
check("빈 규칙은 저장하지 않는다",
  Object.keys(oh.normalize({ enabled: 1, ranges: [{ start: "11:00", end: "21:00" }],
    date_rules: { "2099-01-01": {} } }).date_rules).length === 0);
// 사유는 선택이다 (2026-09-10 사장님: "사유도 적을 수 있게 해줘 필수는
// 아니지만"). 안 적어도 규칙은 그대로 살아 있어야 한다.
check("이유 없이도 휴무는 저장된다",
  !!oh.normalize({ enabled: 1, ranges: [{ start: "11:00", end: "21:00" }],
    date_rules: { "2099-01-01": { closed: 1 } } }).date_rules["2099-01-01"].closed);
check("이유 없이 저장하면 빈 칸이 남지 않는다",
  !("note" in oh.normalize({ enabled: 1, ranges: [{ start: "11:00", end: "21:00" }],
    date_rules: { "2099-01-01": { closed: 1, note: "   " } } }).date_rules["2099-01-01"]));
// 시간을 줄인 날에도 이유를 적을 수 있어야 한다 — 휴무만 되면 "태풍이라
// 저녁만 합니다" 를 알릴 방법이 없다.
{
  const cfg = oh.normalize({ enabled: 1, ranges: [{ start: "11:00", end: "21:00" }],
    date_rules: { "2099-01-01": { ranges: [{ start: "17:00", end: "21:00" }], note: "태풍으로 저녁만" } } });
  check("시간 지정한 날에도 이유가 남는다", cfg.date_rules["2099-01-01"].note === "태풍으로 저녁만",
    JSON.stringify(cfg.date_rules));
  check("그 날 시간도 그대로 남는다", cfg.date_rules["2099-01-01"].ranges[0].start === "17:00");
}
check("이유는 40자까지",
  oh.normalize({ enabled: 1, ranges: [{ start: "11:00", end: "21:00" }],
    date_rules: { "2099-01-01": { closed: 1, note: "가".repeat(80) } } }).date_rules["2099-01-01"].note.length === 40);
// 태풍 한 번 지날 때마다 한 줄씩 영원히 쌓이면 달력이 지저분해지고 설정
// 문서도 계속 커진다. 지나간 휴무일을 다시 볼 일은 없다 — 그건 결산이
// 답할 질문이다.
check("한참 지난 날짜는 버린다",
  !oh.normalize({ enabled: 1, ranges: [{ start: "11:00", end: "21:00" }],
    date_rules: { "2020-01-01": { closed: 1 } } }).date_rules["2020-01-01"]);
check("앞날은 그대로 둔다",
  !!oh.normalize({ enabled: 1, ranges: [{ start: "11:00", end: "21:00" }],
    date_rules: { "2099-01-01": { closed: 1 } } }).date_rules["2099-01-01"]);

out.push("\n[손님에게는 「오늘」 시간을 보여준다]");
// 기본 시간을 보여주면, 요일마다 다른 가게에서 손님은 오늘 안 하는 시간을
// 읽고 그때 다시 온다.
{
  const sat = oh.orderingState(byDay, "2026-09-12 09:00:00");
  check("토요일에는 토요일 시간이 나온다", sat.ranges_text === "11:00~22:00", sat.ranges_text);
  const thu = oh.orderingState(byDay, "2026-09-10 09:00:00");
  check("목요일에는 기본 시간이 나온다", thu.ranges_text === "11:00~14:00, 17:00~21:00", thu.ranges_text);
  const mon = oh.orderingState(byDay, "2026-09-14 12:00:00");
  check("휴무일에는 오늘 휴무라고 알려준다", mon.today_closed === true && mon.ranges_text === "", JSON.stringify(mon));
  check("휴무일에도 다음 영업 시각은 알려준다", mon.next_open_at === "2026-09-15 11:00", mon.next_open_at);
}

out.push("\n[자정을 넘는 구간]");
// 지금 이 가게엔 없지만, 나중에 생겼을 때 조용히 틀리는 것보다 낫다.
const late = { order_hours: { enabled: 1, ranges: [{ start: "17:00", end: "02:00" }], closed_days: [] } };
check("목요일 23:00 받는다", oh.isOpenNow(late, "2026-09-10 23:00:00"));
check("금요일 01:00 받는다 (목요일 영업의 연장)", oh.isOpenNow(late, "2026-09-11 01:00:00"));
check("금요일 03:00 안 받는다", !oh.isOpenNow(late, "2026-09-11 03:00:00"));
const lateClosed = { order_hours: { enabled: 1, ranges: [{ start: "17:00", end: "02:00" }], closed_days: [4] } };
check("목요일 휴무면 금요일 01:00 도 안 받는다", !oh.isOpenNow(lateClosed, "2026-09-11 01:00:00"));
// 요일별 시간과 자정 넘김이 겹치는 경우 — 여기가 제일 틀리기 쉽다.
// 금요일만 새벽 2시까지 하는 가게에서 토요일 01:00 은 금요일 영업의 연장이다.
const fridayLate = {
  order_hours: {
    enabled: 1,
    ranges: [{ start: "11:00", end: "21:00" }],
    closed_days: [],
    day_ranges: { "5": [{ start: "17:00", end: "02:00" }] },
  },
};
check("토요일 01:00 은 금요일 영업의 연장이라 받는다", oh.isOpenNow(fridayLate, "2026-09-12 01:00:00"));
check("금요일 01:00 은 목요일 규칙이라 안 받는다", !oh.isOpenNow(fridayLate, "2026-09-11 01:00:00"));
check("금요일 낮 12:00 은 금요일 규칙이라 안 받는다", !oh.isOpenNow(fridayLate, "2026-09-11 12:00:00"));

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
check("요일별 시간도 0~6 만 받는다",
  Object.keys(oh.normalize({ enabled: 1, day_ranges: { "6": [{ start: "11:00", end: "22:00" }], "9": [{ start: "11:00", end: "12:00" }] } }).day_ranges).join(",") === "6");
// 빈 배열을 저장해두면 "이 요일은 기본을 쓴다" 와 "이 요일은 아무 구간도
// 없다(=휴무)" 가 같은 모양이 된다. 화면에서 시간을 다 지운 요일이 조용히
// 휴무가 되어버리므로, 문 닫는 날은 closed_days 로만 표현한다.
check("빈 요일은 저장하지 않는다",
  Object.keys(oh.normalize({ enabled: 1, day_ranges: { "6": [] } }).day_ranges).length === 0);

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
