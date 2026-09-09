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
//   ranges       [{ start: "11:00", end: "21:00" }, ...]  — 이 안에서만 받는다
//   closed_days  [0..6] — 0 이 일요일. 그 요일은 하루 종일 안 받는다.
//
// 안전한 쪽은 언제나 "받는다" 쪽이다. 설정이 없거나, 비었거나, 이상하면
// 막지 않는다 — 못 막아서 생기는 손해보다 잘못 막아서 생기는 손해가 크다.
// 잘못 막히면 손님은 그냥 나가고, 우리는 그런 일이 있었다는 것조차 모른다.
//
// 품절(src/availability.js)과 같은 방식으로 "규칙만 저장하고 물어볼 때마다
// 계산" 한다. 정해진 시각에 무언가를 켜고 끄는 예약 작업이 없어야 서버가
// 자다 깨거나 배포 중이어도 어긋나지 않는다.
const { nowLocal } = require("./time");

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
  if (!raw || typeof raw !== "object") return { enabled: 0, ranges: [], closed_days: [] };
  const ranges = normalizeRanges(raw.ranges);
  return {
    enabled: raw.enabled && ranges.length ? 1 : 0,
    ranges,
    closed_days: normalizeClosedDays(raw.closed_days),
  };
}

function isClosedDay(cfg, dateStr) {
  return cfg.closed_days.includes(weekdayOf(dateStr));
}

/**
 * 지금 주문을 받는 시간인가.
 *
 * 자정을 넘는 구간(17:00~02:00)도 다룬다 — 그런 구간은 "시작한 날" 에
 * 속한다. 그래서 화요일 01:00 은 월요일이 휴무인지로 갈린다. 지금 이 가게는
 * 그런 구간이 없지만, 나중에 생겼을 때 조용히 틀리는 것보다 낫다.
 */
function isOpenNow(settings, now = nowLocal()) {
  const cfg = orderHours(settings);
  if (!cfg.enabled) return true;
  if (!cfg.ranges.length) return true;

  const date = String(now).slice(0, 10);
  const mins = minutesOf(String(now).slice(11, 16));

  for (const r of cfg.ranges) {
    const s = minutesOf(r.start);
    const e = minutesOf(r.end);
    if (s < e) {
      if (mins >= s && mins < e && !isClosedDay(cfg, date)) return true;
    } else {
      // 자정을 넘는 구간
      if (mins >= s && !isClosedDay(cfg, date)) return true;
      if (mins < e && !isClosedDay(cfg, shiftDate(date, -1))) return true;
    }
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
  if (!cfg.enabled || !cfg.ranges.length) return null;
  const today = String(now).slice(0, 10);
  for (let i = 0; i < 14; i++) {
    const date = shiftDate(today, i);
    if (isClosedDay(cfg, date)) continue;
    for (const r of cfg.ranges) {
      const at = `${date} ${r.start}`;
      if (at > String(now).slice(0, 16)) return at;
    }
  }
  return null;
}

/** "11:00~14:00, 17:00~21:00" — 화면에 그대로 쓸 수 있는 문구. */
function rangesText(cfg) {
  return cfg.ranges.map((r) => `${r.start}~${r.end}`).join(", ");
}

/**
 * 손님 화면과 관리자 화면이 함께 쓰는 한 덩어리.
 * open 만 따로 계산하는 곳이 생기면 두 화면이 서로 다른 말을 하게 된다.
 */
function orderingState(settings, now = nowLocal()) {
  const cfg = orderHours(settings);
  const open = isOpenNow(settings, now);
  const next = open ? null : nextOpenAt(settings, now);
  return {
    enabled: !!cfg.enabled,
    open,
    ranges: cfg.ranges,
    closed_days: cfg.closed_days,
    ranges_text: rangesText(cfg),
    next_open_at: next,
    // "오늘 17:00" 인지 "내일 11:00" 인지는 여기서 정해서 내려보낸다.
    // 손님 폰에서 계산하면 폰의 시계와 시간대가 기준이 되는데, 여행 온
    // 손님 폰은 한국 시간일 수도 있어서 "내일" 이 하루 어긋난다.
    next_open_days: next ? daysBetween(String(now).slice(0, 10), next.slice(0, 10)) : null,
  };
}

module.exports = {
  DEFAULT_RANGES,
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
