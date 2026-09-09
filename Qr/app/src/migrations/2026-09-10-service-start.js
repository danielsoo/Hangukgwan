// 영업 시작 시각을 한 번 정해둔다 (2026-09-10).
//
// 사장님: "대만 시간 기준 9월 8일 저녁부터 실제로 시행을 해서 그때부터는
// 실제 손님들이 먹고 주문한거야. 그 전까지는 전부 테스트였고."
//
// 이 값이 없으면 지금 결산 매출에 우리가 시험 삼아 넣은 주문이 그대로
// 더해져 있고, 결제하지 않은 테스트 주문은 실시간 주문 목록에 영원히
// 남는다. 지우는 대신 이 시각 전을 화면과 계산에서 빼기만 한다
// (src/serviceStart.js).
//
// 17:00 인 이유는 "저녁"이기 때문이다 — 이 가게는 11:00–14:00 / 17:00–21:00
// 영업이라 저녁 영업 시작이 17:00 이다. 그날 낮의 테스트와 그날 저녁의 첫
// 손님이 이 선으로 갈린다. 정확한 시각이 다르면 설정 > 매장 정보에서
// 고치면 되고, 아예 비우면 예전처럼 전부 다시 보인다.
const { SETTING_KEY } = require("../serviceStart");

const DEFAULT_START = "2026-09-08 17:00:00";
const MIGRATION_FLAG = "migration_2026_09_10_service_start_applied";

async function applyServiceStart20260910(store, { save }) {
  if (store.settings && store.settings[MIGRATION_FLAG]) return;
  // 사장님이 이미 직접 정해둔 값이 있으면 건드리지 않는다.
  if (!store.settings[SETTING_KEY]) store.settings[SETTING_KEY] = DEFAULT_START;
  store.settings[MIGRATION_FLAG] = true;
  await save();
  console.log(`Service start set to ${store.settings[SETTING_KEY]} (orders before this are treated as test data).`);
}

module.exports = { applyServiceStart20260910, DEFAULT_START, MIGRATION_FLAG };
