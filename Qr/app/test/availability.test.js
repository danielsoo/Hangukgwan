// 품절 기간 규칙 — 언제 팔리고 언제 안 팔리는가.
//
// 2026-09-09 사장님: "완전히 품절은 지금처럼 품절로 하면 되는데, 김밥이나
// 다른 음식들은 당일 품절이라서 다음날 자동으로 품절 풀어지게 가능한지
// 직원들이 다음날 잊어버릴까봐 간절히 물어봄. 품절 기간을 정할 수 있게도
// 하자. 언제부터 언제까지 이렇게 혹은 그냥 계속."
//
// 사장님이 고른 규칙: 「오늘만 품절」은 다음날 영업 시작(11:00)에 풀린다.
// 그 순간이 정확한지가 이 기능의 전부다 — 하루 일찍 풀리면 없는 김밥이
// 팔리고, 하루 늦게 풀리면 있는 김밥을 못 판다.
const {
  openingTime, addDays, soldOutWindow, soldOutWindowActive, isAvailableNow, withAvailability, DEFAULT_OPENING,
} = require("../src/availability");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const S = { store_hours: "11:00-14:00, 17:00-21:00" };
const item = (over) => Object.assign({ available: 1, soldout_from: null, soldout_until: null }, over);

out.push("[영업 시작 시각은 설정에서 읽는다]");
// 같은 값을 두 군데 적어두면 한쪽만 바뀌어 어긋난다.
check("11:00-14:00, 17:00-21:00 → 11:00", openingTime(S) === "11:00", openingTime(S));
check("09:30 부터 여는 가게", openingTime({ store_hours: "09:30-22:00" }) === "09:30");
check("한 자리 시각도 읽는다", openingTime({ store_hours: "9:00-21:00" }) === "09:00");
check("설정이 없으면 기본값", openingTime({}) === DEFAULT_OPENING);
check("말이 안 되는 값이면 기본값", openingTime({ store_hours: "영업시간 문의" }) === DEFAULT_OPENING);
check("시각 범위를 벗어나면 기본값", openingTime({ store_hours: "99:99-22:00" }) === DEFAULT_OPENING);

out.push("\n[오늘만 품절 — 다음날 영업 시작에 풀린다]");
const today = item({ soldout_from: "2026-09-09", soldout_until: "2026-09-09" });
const shows = (it, now) => (isAvailableNow(it, S, now) ? "판매" : "품절");
check("당일 새벽에도 품절", shows(today, "2026-09-09 03:00:00") === "품절");
check("당일 점심 품절", shows(today, "2026-09-09 12:30:00") === "품절");
check("당일 마감 후 품절", shows(today, "2026-09-09 23:59:59") === "품절");
check("다음날 문 열기 전까지 품절", shows(today, "2026-09-10 10:59:59") === "품절");
check("다음날 영업 시작에 풀린다", shows(today, "2026-09-10 11:00:00") === "판매");
check("다음날 낮에는 판매", shows(today, "2026-09-10 13:00:00") === "판매");
check("그 다음날도 판매", shows(today, "2026-09-11 09:00:00") === "판매");
// 어제 찍은 「오늘만」은 오늘 이미 풀려 있어야 한다.
check("어제 찍은 것은 오늘 풀려 있다",
  shows(item({ soldout_from: "2026-09-08", soldout_until: "2026-09-08" }), "2026-09-09 11:30:00") === "판매");

out.push("\n[영업 시작이 바뀌면 풀리는 시각도 따라간다]");
const S9 = { store_hours: "09:30-22:00" };
check("9:29 에는 아직 품절", isAvailableNow(today, S9, "2026-09-10 09:29:00") === false);
check("9:30 에 풀린다", isAvailableNow(today, S9, "2026-09-10 09:30:00") === true);

out.push("\n[기간 지정]");
const range = item({ soldout_from: "2026-09-12", soldout_until: "2026-09-15" });
check("시작일 전에는 판매", shows(range, "2026-09-11 20:00:00") === "판매");
check("시작일 0시부터 품절", shows(range, "2026-09-12 00:00:00") === "품절");
check("기간 중에는 품절", shows(range, "2026-09-14 12:00:00") === "품절");
check("종료일 당일도 품절", shows(range, "2026-09-15 21:00:00") === "품절");
check("종료일 다음날 문 열기 전까지 품절", shows(range, "2026-09-16 10:00:00") === "품절");
check("종료일 다음날 영업 시작에 풀린다", shows(range, "2026-09-16 11:00:00") === "판매");

out.push("\n[한쪽만 적은 경우]");
check("종료일만 적으면 그때까지 품절",
  shows(item({ soldout_until: "2026-09-15" }), "2026-08-01 12:00:00") === "품절");
check("종료일만 적어도 그 뒤에는 풀린다",
  shows(item({ soldout_until: "2026-09-15" }), "2026-09-16 11:00:00") === "판매");
check("시작일만 적으면 그날부터 계속 품절",
  shows(item({ soldout_from: "2026-09-12" }), "2027-01-01 12:00:00") === "품절");
check("시작일만 적었으면 그 전에는 판매",
  shows(item({ soldout_from: "2026-09-12" }), "2026-09-11 23:00:00") === "판매");

out.push("\n[계속 품절과 겹칠 때]");
// 기간이 「계속 품절」을 되살리면 안 된다 — 없는 걸 파는 쪽이 더 나쁘다.
check("계속 품절이면 기간과 무관하게 품절",
  shows(item({ available: 0 }), "2026-09-09 12:00:00") === "품절");
check("계속 품절 + 기간 밖이어도 품절",
  shows(item({ available: 0, soldout_from: "2026-01-01", soldout_until: "2026-01-02" }), "2026-09-09 12:00:00") === "품절");

out.push("\n[기간이 없으면 예전과 똑같이 동작한다]");
check("판매 중", shows(item({}), "2026-09-09 12:00:00") === "판매");
check("품절", shows(item({ available: 0 }), "2026-09-09 12:00:00") === "품절");
// 이 기능이 생기기 전에 저장된 메뉴에는 날짜 칸이 아예 없다.
check("옛 데이터(날짜 칸 없음)도 그대로", isAvailableNow({ available: 1 }, S, "2026-09-09 12:00:00") === true);
check("옛 데이터 품절도 그대로", isAvailableNow({ available: 0 }, S, "2026-09-09 12:00:00") === false);
// 깨진 값이 들어와도 팔리지 않게 만들면 안 된다 — 무시하고 예전대로.
check("날짜가 깨져 있으면 기간이 없는 것으로 본다",
  isAvailableNow(item({ soldout_until: "내일까지" }), S, "2026-09-09 12:00:00") === true);
check("빈 문자열도 기간이 아니다",
  isAvailableNow(item({ soldout_from: "", soldout_until: "" }), S, "2026-09-09 12:00:00") === true);

out.push("\n[날짜 더하기 — 월말·연말·윤년]");
check("9/30 다음날은 10/1", addDays("2026-09-30", 1) === "2026-10-01");
check("12/31 다음날은 이듬해 1/1", addDays("2026-12-31", 1) === "2027-01-01");
check("2028년 2/28 다음날은 2/29(윤년)", addDays("2028-02-28", 1) === "2028-02-29");
check("2026년 2/28 다음날은 3/1(평년)", addDays("2026-02-28", 1) === "2026-03-01");
// 월말에 「오늘만」을 찍어도 정확히 다음날 풀려야 한다.
check("9/30 에 찍은 오늘만은 10/1 영업 시작에 풀린다",
  isAvailableNow(item({ soldout_from: "2026-09-30", soldout_until: "2026-09-30" }), S, "2026-10-01 11:00:00") === true);
check("그 전에는 아직 품절",
  isAvailableNow(item({ soldout_from: "2026-09-30", soldout_until: "2026-09-30" }), S, "2026-10-01 10:59:00") === false);

out.push("\n[화면에 내보내는 모양]");
const shown = withAvailability(item({ soldout_from: "2026-09-09", soldout_until: "2026-09-09" }), S, "2026-09-09 12:00:00");
check("available 은 계산된 값이다", shown.available === 0);
check("원래 스위치도 같이 담는다", shown.available_stored === 1);
check("날짜를 그대로 담는다", shown.soldout_from === "2026-09-09" && shown.soldout_until === "2026-09-09");
const shown2 = withAvailability(item({ soldout_from: "2026-09-09", soldout_until: "2026-09-09" }), S, "2026-09-10 12:00:00");
check("풀린 뒤에는 available 이 1", shown2.available === 1);
check("풀려도 날짜는 남는다(언제 걸었는지 보인다)", shown2.soldout_until === "2026-09-09");
const shown3 = withAvailability({ available: 0 }, S, "2026-09-09 12:00:00");
check("계속 품절은 available_stored 가 0", shown3.available_stored === 0 && shown3.available === 0);
check("깨진 날짜는 null 로 정리해서 내보낸다",
  withAvailability(item({ soldout_from: "쓰레기" }), S, "2026-09-09 12:00:00").soldout_from === null);

out.push("\n[기간 구간 계산]");
const w = soldOutWindow(item({ soldout_from: "2026-09-09", soldout_until: "2026-09-09" }), S);
check("시작은 그 날 0시", w.from === "2026-09-09 00:00:00", w.from);
check("끝은 다음날 영업 시작", w.until === "2026-09-10 11:00:00", w.until);
check("기간이 없으면 양쪽 다 없다",
  soldOutWindow(item({}), S).from === null && soldOutWindow(item({}), S).until === null);
check("기간이 없으면 활성도 아니다", soldOutWindowActive(item({}), S, "2026-09-09 12:00:00") === false);

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
