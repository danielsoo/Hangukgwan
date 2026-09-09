// 주문 받는 시간을 한 번 정해둔다 (2026-09-10).
//
// 사장님: "영업시간이 아닐 때는 직원을 제외하고 qr 코드로 주문 안되게 해줘."
//
// 막는 기준은 설정의 「영업시간」 문구가 아니라 따로 저장한 규칙이다
// (이유는 src/openHours.js 첫머리). 그런데 사장님은 이미 그 문구에 실제
// 영업시간을 정확히 적어두셨으니, 처음 한 번은 거기서 읽어와서 출발점으로
// 삼는다 — 새 화면을 열었을 때 빈 칸부터 채우게 하지 않으려는 것이다.
//
// 문구를 못 읽으면 11:00~21:00 으로 넣는다. 이 가게의 실제 영업시간
// (11:00-14:00, 17:00-21:00)보다 넓은 쪽이라, 틀려도 손님을 잘못 막지는
// 않는다. 좁게 잡아 잘못 막는 것보다 넓게 잡아 못 막는 편이 훨씬 싸다.
//
// 휴무 요일은 비워둔다. 지금 정기 휴무가 있는지 우리가 모르는데 여기서
// 지어내면 그날 하루가 통째로 막힌다. 필요하면 설정 화면에서 고르면 된다.
const { normalize } = require("../openHours");

const SETTING_KEY = "order_hours";
const MIGRATION_FLAG = "migration_2026_09_10_order_hours_applied";

async function applyOrderHours20260910(store, { save }) {
  if (store.settings && store.settings[MIGRATION_FLAG]) return;
  // 사장님이 이미 직접 정해둔 값이 있으면 건드리지 않는다.
  if (!store.settings[SETTING_KEY]) {
    store.settings[SETTING_KEY] = normalize({ enabled: 1 }, store.settings.store_hours);
  }
  store.settings[MIGRATION_FLAG] = true;
  await save();
  const cfg = store.settings[SETTING_KEY];
  console.log(
    `Ordering hours set to ${cfg.ranges.map((r) => `${r.start}~${r.end}`).join(", ")} ` +
      `(customers can't order outside these; staff can).`
  );
}

module.exports = { applyOrderHours20260910, SETTING_KEY, MIGRATION_FLAG };
