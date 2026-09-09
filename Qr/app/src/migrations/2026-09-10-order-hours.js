// 주문 받는 시간을 한 번 정해둔다 (2026-09-10).
//
// 사장님: "영업시간이 아닐 때는 직원을 제외하고 qr 코드로 주문 안되게 해줘."
//
// 막는 기준은 설정의 「영업시간」 문구가 아니라 따로 저장한 규칙이다
// (이유는 src/openHours.js 첫머리). 그리고 이 가게에서는 그 둘이 실제로
// 다르다 —
//
//   손님에게 보여주는 영업시간   11:00-14:00, 17:00-21:00
//   손님이 주문할 수 있는 시간   11:00-13:30, 17:00-20:30
//
// 사장님(2026-09-10): "문닫기 30분 전이라 좌석에 앉아 있지만 마감시간이기
// 때문에 qr 주문 불가. 다만, 직원들이 직접 앱에서 수동 주문을 할 때는
// 가능할 수 있도록."
//
// 마감 30분 전부터는 주방이 정리에 들어간다. 그런데 손님은 아직 앉아
// 있으니 QR 은 그대로 눌린다 — 그래서 이 30분이 필요하다. 문구에서 읽어와
// 지어내지 않고 사장님이 말한 시각을 그대로 적어두는 이유가 이것이다.
// 문구를 파싱했으면 20:59 까지 주문을 받았을 것이다.
//
// 직원은 이 시간과 무관하게 언제든 넣을 수 있다(src/routes/orders.js) —
// 마감 후 정리 주문이나 전화 주문이 실제로 있고, 그것까지 막으면 직원은
// 시스템을 우회한다.
//
// 휴무 요일은 비워둔다. 지금 정기 휴무가 있는지 우리가 모르는데 여기서
// 지어내면 그날 하루가 통째로 막힌다. 태풍 같은 하루짜리 휴무와 함께
// 설정 > 주문 규칙에서 고르면 된다.
const { normalize } = require("../openHours");

const SETTING_KEY = "order_hours";
const MIGRATION_FLAG = "migration_2026_09_10_order_hours_applied";
// 사장님이 직접 말한 시각. 영업 종료 30분 전에 주문을 닫는다.
const DEFAULT_ORDER_RANGES = [
  { start: "11:00", end: "13:30" },
  { start: "17:00", end: "20:30" },
];

async function applyOrderHours20260910(store, { save }) {
  if (store.settings && store.settings[MIGRATION_FLAG]) return;
  // 사장님이 이미 직접 정해둔 값이 있으면 건드리지 않는다.
  if (!store.settings[SETTING_KEY]) {
    store.settings[SETTING_KEY] = normalize({ enabled: 1, ranges: DEFAULT_ORDER_RANGES });
  }
  store.settings[MIGRATION_FLAG] = true;
  await save();
  const cfg = store.settings[SETTING_KEY];
  console.log(
    `Ordering hours set to ${cfg.ranges.map((r) => `${r.start}~${r.end}`).join(", ")} ` +
      `(customers can't order outside these; staff can).`
  );
}

module.exports = { applyOrderHours20260910, SETTING_KEY, MIGRATION_FLAG, DEFAULT_ORDER_RANGES };
