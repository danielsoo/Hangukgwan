// 언제부터가 "진짜 장사"인가.
//
// 2026-09-10 사장님: "대만 시간 기준 9월 8일 저녁부터 실제로 시행을 해서
// 그때부터는 실제 손님들이 먹고 주문한거야. 그 전까지는 전부 테스트였고."
//
// 그런데 테스트 주문도 진짜 주문과 똑같은 모양으로 데이터베이스에 남아
// 있다. 그래서 지금 결산 매출에는 우리가 시험 삼아 넣은 주문이 그대로
// 더해져 있고, 결제하지 않은 테스트 주문은 실시간 주문 목록에 영원히
// 남는다(안 끝난 주문은 아무리 오래돼도 화면에 들고 있기 때문에 —
// src/db.js).
//
// 지우지는 않는다. 사장님이 고른 방식이고, 그게 맞다 — 지운 것은 되돌릴 수
// 없고, "이게 정말 테스트였나?"를 나중에 확인할 방법도 사라진다. 대신
// 영업 시작 시각을 하나 정해두고 그 전 것은 화면과 계산에서 빼기만 한다.
// 잘못 잡았으면 시각만 고치면 되고, 아예 비우면 전부 다시 보인다.
//
// 형식은 "YYYY-MM-DD HH:MM:SS"(대만 시각) — 주문의 created_at 과 같은
// 형식이라 문자열끼리 그대로 비교하면 된다. 날짜가 아니라 시각까지 두는
// 이유는 사장님이 "9월 8일 저녁"이라고 했기 때문이다. 그날 낮의 테스트와
// 그날 저녁의 첫 손님을 갈라야 한다.
const SETTING_KEY = "service_started_at";

function normalize(value) {
  const v = String(value == null ? "" : value).trim();
  if (!v) return null;
  // "2026-09-08" → 그날 0시로 본다.
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v} 00:00:00`;
  // "2026-09-08 17:00" → 초를 채운다. 화면의 datetime-local 이 이렇게 준다.
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(v)) return `${v.replace("T", " ")}:00`;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(v)) return v.replace("T", " ");
  return null; // 알아볼 수 없는 값은 "설정 안 함"과 같게 둔다
}

/** 설정된 영업 시작 시각, 없으면 null. */
function serviceStartedAt(store) {
  return normalize(store && store.settings && store.settings[SETTING_KEY]);
}

/**
 * 주문 질의에 붙일 조건. 영업 시작이 정해져 있으면 그 이후 것만.
 * 정해지지 않았으면 아무 조건도 붙이지 않는다(예전과 똑같이 동작).
 */
function createdAtFilter(store) {
  const start = serviceStartedAt(store);
  return start ? { created_at: { $gte: start } } : null;
}

/** 이 주문이 영업 시작 전(=테스트) 것인가. */
function isBeforeService(order, store) {
  const start = serviceStartedAt(store);
  if (!start || !order || !order.created_at) return false;
  return String(order.created_at) < start;
}

module.exports = { SETTING_KEY, normalize, serviceStartedAt, createdAtFilter, isBeforeService };
