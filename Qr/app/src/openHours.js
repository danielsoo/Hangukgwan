// 지금 손님이 주문할 수 있는 시간인가 — 한 곳에서 답한다.
//
// 2026-09-10 사장님: "영업시간이 아닐 때는 직원을 제외하고 qr 코드로 주문
// 안되게 해줘."
//
// 왜 설정의 「영업시간」 칸을 그대로 쓰지 않는가.
// 그 칸(store_hours)은 손님에게 그대로 보여주는 자유 문구다
// ("11:00-14:00, 17:00-21:00"). 사장님이 그걸 "매일 11시~9시(브레이크
// 2~5시)" 처럼 고치는 순간 해석이 깨지는데, 해석이 깨진 결과가 "주문이 안
// 된다" 이면 문구 한 줄 고쳤다가 그날 장사를 통째로 잃는다. 그래서 막는
// 기준은 따로 저장한다 — 보여주는 문구와 막는 규칙은 다른 일이다.
//
// 저장 형태 (settings.order_hours)
//   enabled      0/1  — 이 규칙을 쓸지. 없으면(아직 정한 적 없음) 안 막는다.
//   ranges       [{ start: "11:00", end: "21:00" }, ...]  — 기본 영업시간
//   closed_days  [0..6] — 0 이 일요일. 그 요일은 하루 종일 안 받는다.
//   day_ranges   { "6": [{...}] } — 그 요일만 기본과 다를 때. 적어둔 요일만
//                넣는다(없는 요일은 기본을 쓴다). 2026-09-10 사장님:
//                "요일마다 다를 수 있는데 그것도 넣었어?"
//   date_rules   { "2026-09-15": { closed: 1, note: "태풍" } } 또는
//                { "2026-09-15": { ranges: [{...}] } } — 그 날 하루만.
//                2026-09-10 사장님: "태풍이 불거나 휴무를 해야 하거나 뭐
//                다양한 이유들." 요일 규칙으로는 못 적는 일회성 사정이다.
//
// 겹칠 때의 순서는 하나뿐이다: 그 날짜 > 요일 휴무 > 요일별 시간 > 기본.
// 날짜가 가장 세다 — 태풍으로 하루 닫는 건 평소 규칙을 잠깐 덮는 일이지
// 평소 규칙을 고치는 일이 아니다. 그리고 휴무가 시간보다 세다 — 문 닫은
// 날에 시간을 적어둔 채로 두는 일은 흔한데, 그때 시간이 이기면 휴무일에
// 주문이 들어온다.
//
// 안전한 쪽은 언제나 "받는다" 쪽이다. 설정이 없거나, 비었거나, 이상하면
// 막지 않는다 — 못 막아서 생기는 손해보다 잘못 막아서 생기는 손해가 크다.
// 잘못 막히면 손님은 그냥 나가고, 우리는 그런 일이 있었다는 것조차 모른다.
//
// 품절(src/availability.js)과 같은 방식으로 "규칙만 저장하고 물어볼 때마다
// 계산" 한다. 정해진 시각에 무언가를 켜고 끄는 예약 작업이 없어야 서버가
// 자다 깨거나 배포 중이어도 어긋나지 않는다.
const { nowLocal, taipeiDateString } = require("./time");

const DEFAULT_RANGES = [{ start: "11:00", end: "21:00" }];
const MAX_RANGES = 6;

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** "HH:MM" 인가. 시각으로 말이 되는 값만 통과시킨다. */
function isHm(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return false;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

function toHm(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  return `${pad2(parseInt(m[1], 10))}:${m[2]}`;
}

function minutesOf(hm) {
  const [h, m] = hm.split(":").map((v) => parseInt(v, 10));
  return h * 60 + m;
}

/** "YYYY-MM-DD" 의 요일. 0 이 일요일. 서버가 어느 시간대에 있든 같아야 해서 UTC 로 센다. */
function weekdayOf(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map((v) => parseInt(v, 10));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 두 "YYYY-MM-DD" 사이의 날짜 수. 0 이면 같은 날, 1 이면 다음 날. */
function daysBetween(fromDate, toDate) {
  const [ay, am, ad] = String(fromDate).split("-").map((v) => parseInt(v, 10));
  const [by, bm, bd] = String(toDate).split("-").map((v) => parseInt(v, 10));
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

function shiftDate(dateStr, n) {
  const [y, m, d] = String(dateStr).split("-").map((v) => parseInt(v, 10));
  const dt = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/**
 * 자유 문구에서 시각 구간을 뽑아본다. 설정을 처음 만들 때 사장님이 이미
 * 적어둔 영업시간을 출발점으로 쓰기 위한 것이고, 그 뒤로는 쓰지 않는다.
 * (여기서 실패해도 손해가 없다 — 못 뽑으면 기본값 11:00~21:00 로 시작하고,
 * 사장님이 화면에서 고치면 된다.)
 */
function parseHoursText(text) {
  const found = [];
  const re = /(\d{1,2}):(\d{2})\s*[-~–—]\s*(\d{1,2}):(\d{2})/g;
  let m;
  while ((m = re.exec(String(text || "")))) {
    const start = `${m[1]}:${m[2]}`;
    const end = `${m[3]}:${m[4]}`;
    if (isHm(start) && isHm(end)) found.push({ start: toHm(start), end: toHm(end) });
    if (found.length >= MAX_RANGES) break;
  }
  return found;
}

function normalizeRanges(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const r of input) {
    if (!r) continue;
    const start = r.start;
    const end = r.end;
    if (!isHm(start) || !isHm(end)) continue;
    const s = toHm(start);
    const e = toHm(end);
    if (s === e) continue; // 길이 0 인 구간은 아무 의미가 없다
    out.push({ start: s, end: e });
    if (out.length >= MAX_RANGES) break;
  }
  return out.sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
}

function normalizeClosedDays(input) {
  if (!Array.isArray(input)) return [];
  const set = new Set();
  for (const d of input) {
    const n = parseInt(d, 10);
    if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n);
  }
  // 7일 전부 휴무는 "영영 주문 못 받는다" 는 뜻이라 실수일 가능성이 훨씬 크다.
  if (set.size >= 7) return [];
  return [...set].sort((a, b) => a - b);
}

/**
 * 요일별 예외를 다듬는다. { "6": [{start,end}] } 처럼 요일 번호를 키로 쓴다.
 * 빈 배열은 저장하지 않는다 — "이 요일은 구간이 없다" 와 "기본을 쓴다" 가
 * 같은 모양이 되어버리면, 화면에서 시간을 다 지운 요일이 조용히 휴무가 된다.
 * 문을 닫는 날은 closed_days 로만 표현한다.
 */
function normalizeDayRanges(input) {
  if (!input || typeof input !== "object") return {};
  const out = {};
  for (const key of Object.keys(input)) {
    const day = parseInt(key, 10);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;
    const ranges = normalizeRanges(input[key]);
    if (ranges.length) out[String(day)] = ranges;
  }
  return out;
}

const DATE_RULE_KEEP_DAYS = 60;
const MAX_DATE_RULES = 400;

function isDateStr(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  // 모양만 맞고 실제로는 없는 날짜("2026-13-99")를 걸러낸다. Date 가
  // 알아서 넘겨버리기 때문에 다시 문자열로 만들어 같은지 본다.
  const [y, m, d] = v.split("-").map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * 날짜 하나짜리 규칙을 다듬는다.
 *
 * 지난 날짜는 버린다(기본 60일). 안 그러면 태풍 한 번 지날 때마다 한 줄씩
 * 영원히 쌓여서, 달력은 지저분해지고 설정 문서는 계속 커진다. 지나간
 * 휴무일을 다시 볼 일은 없다 — 그건 결산이 답할 질문이다.
 */
function normalizeDateRules(input, today) {
  if (!input || typeof input !== "object") return {};
  const cutoff = today ? shiftDate(today, -DATE_RULE_KEEP_DAYS) : null;
  const out = {};
  for (const key of Object.keys(input).sort()) {
    if (!isDateStr(key)) continue;
    if (cutoff && key < cutoff) continue;
    const raw = input[key] || {};
    const note = typeof raw.note === "string" ? raw.note.trim().slice(0, 40) : "";
    if (raw.closed) {
      out[key] = note ? { closed: 1, note } : { closed: 1 };
    } else {
      const ranges = normalizeRanges(raw.ranges);
      // 「닫지도 않고 시간도 없는 날」은 아무 뜻이 없다 — 평소대로라는 뜻이고,
      // 그건 적어두지 않는 것과 같다.
      if (!ranges.length) continue;
      out[key] = note ? { ranges, note } : { ranges };
    }
    if (Object.keys(out).length >= MAX_DATE_RULES) break;
  }
  return out;
}

/** 저장할 형태로 다듬는다. 사장님이 화면에서 보낸 값이 그대로 들어온다. */
function normalize(input, fallbackText) {
  const src = input && typeof input === "object" ? input : {};
  let ranges = normalizeRanges(src.ranges);
  if (!ranges.length) ranges = normalizeRanges(parseHoursText(fallbackText));
  if (!ranges.length) ranges = DEFAULT_RANGES.slice();
  return {
    enabled: src.enabled ? 1 : 0,
    ranges,
    closed_days: normalizeClosedDays(src.closed_days),
    day_ranges: normalizeDayRanges(src.day_ranges),
    date_rules: normalizeDateRules(src.date_rules, taipeiDateString()),
  };
}

/**
 * 설정에서 읽어온다. 정한 적이 없으면 enabled 0 — 즉 아무것도 막지 않는다.
 *
 * normalize() 와 일부러 다르다. normalize() 는 사장님이 화면에서 보낸 값을
 * 「저장할 형태」로 다듬는 것이라, 구간을 못 읽으면 기본값(11:00~21:00)으로
 * 채워 넣는다 — 빈 칸으로 저장되는 것보다 낫기 때문이다.
 *
 * 여기는 「지금 막을지 말지」를 판단하는 자리라 정반대여야 한다. 저장된
 * 구간을 하나도 못 읽었는데 기본값을 지어내면, 사장님이 본 적도 없는
 * 11:00~21:00 이 실제로 손님을 막는다. 못 읽으면 그냥 안 막는다.
 */
function orderHours(settings) {
  const raw = settings && settings.order_hours;
  if (!raw || typeof raw !== "object") {
    return { enabled: 0, ranges: [], closed_days: [], day_ranges: {} };
  }
  const ranges = normalizeRanges(raw.ranges);
  const dayRanges = normalizeDayRanges(raw.day_ranges);
  // 여기서는 지난 날짜를 버리지 않는다. 버리는 건 저장할 때 할 일이고,
  // 읽을 때마다 버리면 어제 날짜를 물어보는 계산(자정을 넘는 구간)이 어긋난다.
  const dateRules = normalizeDateRules(raw.date_rules, null);
  // 기본이 비어 있어도 요일별로만 적어둔 경우가 있을 수 있다 — 그때까지
  // 「읽을 게 없다」로 보고 열어버리면 사장님이 적어둔 규칙이 통째로 무시된다.
  const hasAnyRanges = ranges.length > 0 || Object.keys(dayRanges).length > 0;
  return {
    enabled: raw.enabled && hasAnyRanges ? 1 : 0,
    ranges,
    closed_days: normalizeClosedDays(raw.closed_days),
    day_ranges: dayRanges,
    date_rules: dateRules,
  };
}

/** 그 날짜에만 걸어둔 규칙(태풍 휴무 등). 없으면 null. */
function dateRuleFor(cfg, dateStr) {
  return (cfg.date_rules && cfg.date_rules[dateStr]) || null;
}

/**
 * 그 날짜에 적용되는 구간. 순서는 그 날짜 > 요일 휴무 > 요일별 > 기본.
 * 휴무면 빈 배열이고, 빈 배열은 "그날은 아무것도 안 받는다" 는 뜻이다.
 */
function rangesForDate(cfg, dateStr) {
  const rule = dateRuleFor(cfg, dateStr);
  if (rule) return rule.closed ? [] : rule.ranges || [];
  const day = weekdayOf(dateStr);
  if (cfg.closed_days.includes(day)) return [];
  const own = cfg.day_ranges && cfg.day_ranges[String(day)];
  if (own && own.length) return own;
  return cfg.ranges;
}

/**
 * 지금 주문을 받는 시간인가.
 *
 * 자정을 넘는 구간(17:00~02:00)도 다룬다 — 그런 구간은 "시작한 날" 에
 * 속한다. 그래서 화요일 01:00 은 월요일 규칙으로 판단한다. 요일마다 시간이
 * 다르면 이게 그냥 사소한 게 아니게 된다 — 금요일만 새벽 2시까지 하는
 * 가게에서 토요일 01:00 은 금요일 영업의 연장이다.
 */
function isOpenNow(settings, now = nowLocal()) {
  const cfg = orderHours(settings);
  if (!cfg.enabled) return true;

  const date = String(now).slice(0, 10);
  const mins = minutesOf(String(now).slice(11, 16));

  // 오늘 시작하는 구간
  for (const r of rangesForDate(cfg, date)) {
    const s = minutesOf(r.start);
    const e = minutesOf(r.end);
    if (s < e ? mins >= s && mins < e : mins >= s) return true;
  }
  // 어제 시작해서 자정을 넘긴 구간
  const prev = shiftDate(date, -1);
  for (const r of rangesForDate(cfg, prev)) {
    const s = minutesOf(r.start);
    const e = minutesOf(r.end);
    if (s > e && mins < e) return true;
  }
  return false;
}

/**
 * 다음에 주문을 받기 시작하는 시각. "지금은 안 되지만 언제부터 되는지" 를
 * 손님에게 말해주기 위한 것이다 — 그냥 "안 됩니다" 만 보여주면 손님은
 * 기다려야 할지 나가야 할지 알 수 없다.
 * 2주를 봐도 없으면 null (휴무 설정이 이상한 경우).
 */
function nextOpenAt(settings, now = nowLocal()) {
  const cfg = orderHours(settings);
  if (!cfg.enabled) return null;
  const today = String(now).slice(0, 10);
  for (let i = 0; i < 14; i++) {
    const date = shiftDate(today, i);
    for (const r of rangesForDate(cfg, date)) {
      const at = `${date} ${r.start}`;
      if (at > String(now).slice(0, 16)) return at;
    }
  }
  return null;
}

/** "11:00~14:00, 17:00~21:00" — 화면에 그대로 쓸 수 있는 문구. */
function rangesText(ranges) {
  return (ranges || []).map((r) => `${r.start}~${r.end}`).join(", ");
}

/**
 * 손님 화면과 관리자 화면이 함께 쓰는 한 덩어리.
 * open 만 따로 계산하는 곳이 생기면 두 화면이 서로 다른 말을 하게 된다.
 */
function orderingState(settings, now = nowLocal()) {
  const cfg = orderHours(settings);
  const open = isOpenNow(settings, now);
  const next = open ? null : nextOpenAt(settings, now);
  const todayRanges = rangesForDate(cfg, String(now).slice(0, 10));
  return {
    enabled: !!cfg.enabled,
    open,
    ranges: cfg.ranges,
    closed_days: cfg.closed_days,
    day_ranges: cfg.day_ranges,
    date_rules: cfg.date_rules,
    // 오늘 하루짜리 사정이 있으면 손님에게도 그 이유를 보여준다 — "오늘은
    // 휴무입니다" 만 있으면 손님은 다시 올지 말지를 정할 수 없다.
    today_note: (dateRuleFor(cfg, String(now).slice(0, 10)) || {}).note || "",
    // 손님에게 보여줄 문구는 "오늘" 의 시간이어야 한다. 요일마다 시간이
    // 다른 가게에서 기본 시간을 보여주면, 손님은 오늘 안 하는 시간을 읽고
    // 그때 다시 온다.
    today_ranges: todayRanges,
    today_closed: cfg.enabled ? todayRanges.length === 0 : false,
    ranges_text: rangesText(todayRanges),
    next_open_at: next,
    // "오늘 17:00" 인지 "내일 11:00" 인지는 여기서 정해서 내려보낸다.
    // 손님 폰에서 계산하면 폰의 시계와 시간대가 기준이 되는데, 여행 온
    // 손님 폰은 한국 시간일 수도 있어서 "내일" 이 하루 어긋난다.
    next_open_days: next ? daysBetween(String(now).slice(0, 10), next.slice(0, 10)) : null,
  };
}

module.exports = {
  DEFAULT_RANGES,
  DATE_RULE_KEEP_DAYS,
  rangesForDate,
  dateRuleFor,
  MAX_RANGES,
  parseHoursText,
  normalize,
  orderHours,
  isOpenNow,
  nextOpenAt,
  rangesText,
  orderingState,
  weekdayOf,
};
