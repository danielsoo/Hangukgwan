// 메뉴가 "지금" 팔리는가 — 품절 기간까지 계산해서 한 곳에서 답한다.
//
// 2026-09-09 사장님: "완전히 품절은 지금처럼 품절로 하면 되는데, 김밥이나
// 다른 음식들은 당일 품절이라서 다음날 자동으로 품절 풀어지게 가능한지
// 직원들이 다음날 잊어버릴까봐 간절히 물어봄. 품절 기간을 정할 수 있게도
// 하자. 언제부터 언제까지 이렇게 혹은 그냥 계속."
//
// 저장하는 건 "규칙"이지 "지금 상태"가 아니다. 날짜만 적어두고 팔리는지는
// 물어볼 때마다 계산한다 — 그래서 정해진 시각에 무언가를 되돌려놓는 예약
// 작업이 필요 없다. 그런 작업은 서버가 자다 깨거나, 배포 중이거나, 시간대가
// 어긋나면 조용히 건너뛰고, 그러면 김밥이 다음 날에도 품절인 채로 남는다 —
// 직원이 잊어버리는 것과 똑같은 결과가 된다.
//
// 저장 형태
//   available       0/1  — 「계속 품절」 스위치. 지금까지와 같다.
//   soldout_from    "YYYY-MM-DD" 또는 없음 — 이 날짜부터 품절
//   soldout_until   "YYYY-MM-DD" 또는 없음 — 이 날짜까지 품절(그날 포함)
//
// 날짜만 적는 이유는 직원이 화면에서 고르는 것도 날짜이기 때문이다. 시각은
// 규칙으로 정한다 — 시작은 그 날 0시, 끝은 "다음 날 영업 시작". 사장님이
// 고른 규칙(2026-09-09)이고, 21시에 닫고 11시에 여는 가게라 손님이 없는
// 시간에 조용히 풀린다.
//
// 「오늘만 품절」은 from = until = 오늘일 뿐이다. 따로 다루지 않는다.
const { nowLocal, taipeiDateString } = require("./time");

const DEFAULT_OPENING = "11:00";

/** "9:5" 같은 건 안 받는다. "H:MM"/"HH:MM" 만 "HH:MM" 으로 돌려준다. */
function hhmm(v) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(v == null ? "" : v));
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (!(h >= 0 && h <= 23) || !(min >= 0 && min <= 59)) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * 품절이 풀리는 시각 "HH:MM".
 *
 * 사장님(2026-09-11): "이거 품절 10일까지였는데 오늘 11일인데 안 풀렸어."
 * 안 풀린 게 아니라 **아직 그 시각이 안 된 것**이었다. 규칙이 자정이 아니라
 * 「다음 날 영업 시작」이라, 11시 전에 보시면 그 날짜가 지났는데도 품절로
 * 보인다. 그게 맞는 동작이긴 한데, 화면 어디에도 그 시각이 안 적혀 있으면
 * 고장으로 읽힌다 — 그래서 (1) 시각을 사장님이 직접 고를 수 있게 하고,
 * (2) 배지에 그 시각을 적는다(withAvailability 의 soldout_release_at).
 *
 * 고른 값이 없으면 예전과 같이 영업 시작 시각을 쓴다. 이미 그렇게 돌던
 * 가게의 동작이 배포만으로 바뀌면 안 된다.
 */
function releaseTime(settings) {
  return hhmm(settings && settings.soldout_release_time) || openingTime(settings);
}

// 영업 시작 시각을 설정의 store_hours("11:00-14:00, 17:00-21:00")에서 읽는다.
// 사장님이 영업시간을 바꾸면 품절 풀리는 시각도 같이 따라간다 — 같은 값을
// 두 군데 적어두면 한쪽만 바뀌어 어긋난다.
function openingTime(settings) {
  const m = /(\d{1,2}):(\d{2})/.exec((settings && settings.store_hours) || "");
  if (!m) return DEFAULT_OPENING;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (!(h >= 0 && h <= 23) || !(min >= 0 && min <= 59)) return DEFAULT_OPENING;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" 에 며칠을 더한다. 월말·윤년은 Date 에게 맡긴다. */
function addDays(dateStr, n) {
  const [y, m, d] = String(dateStr).split("-").map((v) => parseInt(v, 10));
  // UTC 로 계산한다 — 서버가 어느 시간대에 있든 날짜 더하기는 같아야 한다.
  const t = Date.UTC(y, m - 1, d) + n * 24 * 60 * 60 * 1000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function isDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * 품절 기간을 실제 시각 구간으로 편다.
 * from 은 그 날 0시(포함), until 은 "그 다음 날 영업 시작"(미포함).
 * 둘 다 "YYYY-MM-DD HH:MM:SS" — nowLocal() 과 같은 형식이라 문자열끼리
 * 그대로 비교하면 된다(자릿수가 고정이라 사전순 = 시간순).
 */
function soldOutWindow(item, settings) {
  const from = isDate(item.soldout_from) ? `${item.soldout_from} 00:00:00` : null;
  const until = isDate(item.soldout_until)
    ? `${addDays(item.soldout_until, 1)} ${releaseTime(settings)}:00`
    : null;
  return { from, until };
}

/** 지금 품절 기간 안인가. 기간이 아예 없으면 false. */
function soldOutWindowActive(item, settings, now = nowLocal()) {
  const { from, until } = soldOutWindow(item, settings);
  if (!from && !until) return false;
  if (from && now < from) return false;
  if (until && now >= until) return false;
  return true;
}

/**
 * 지금 팔리는가. 「계속 품절」이거나 품절 기간 안이면 안 팔린다.
 *
 * 둘을 OR 로 묶는 이유: 기간이 「계속 품절」을 덮어써서 되살리는 일이 없어야
 * 한다. 화면은 네 가지(판매 중 / 오늘만 / 기간 / 계속)를 서로 배타적으로
 * 저장하므로 실제로 둘이 겹칠 일은 없지만, 겹쳤을 때 "덜 파는" 쪽으로
 * 기우는 편이 안전하다 — 없는 걸 파는 것보다 낫다.
 */
function isAvailableNow(item, settings, now = nowLocal()) {
  if (!item.available) return false;
  return !soldOutWindowActive(item, settings, now);
}

/**
 * 손님/관리자 화면에 내보낼 모양. available 은 계산된 값으로 덮어써서
 * 기존에 available 을 보던 코드가 전부 그대로 맞게 하고, 관리자 화면이
 * 「무엇으로 설정돼 있는지」 알 수 있도록 원래 값과 날짜를 같이 담는다.
 */
function withAvailability(item, settings, now = nowLocal()) {
  return {
    ...item,
    available: isAvailableNow(item, settings, now) ? 1 : 0,
    // 관리자 화면 전용 — 저장된 「계속 품절」 스위치 그 자체.
    available_stored: item.available ? 1 : 0,
    soldout_from: isDate(item.soldout_from) ? item.soldout_from : null,
    soldout_until: isDate(item.soldout_until) ? item.soldout_until : null,
    // **언제 다시 팔리는지.** 화면이 이 값을 그대로 적고, 그 시각에 맞춰
    // 목록을 다시 불러온다. 규칙을 화면에 한 번 더 적어두면 언젠가 한쪽만
    // 고쳐진다 — 계산은 여기서만 한다.
    // 「계속 품절」처럼 끝이 없으면 null 이다. 없는 시각을 지어내지 않는다.
    soldout_release_at: soldOutWindow(item, settings).until,
  };
}

/** 오늘 날짜(대만 기준) — 「오늘만 품절」이 쓰는 값. */
function today(d = new Date()) {
  return taipeiDateString(d);
}

module.exports = {
  DEFAULT_OPENING,
  hhmm,
  openingTime,
  releaseTime,
  addDays,
  soldOutWindow,
  soldOutWindowActive,
  isAvailableNow,
  withAvailability,
  today,
};
