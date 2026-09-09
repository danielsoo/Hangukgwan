// 이 파일을 부르는 테스트들이 재는 건 영업시간이 아니다.
//
// 2026-09-10 부터 손님 주문에는 「주문 받는 시간」이 걸린다
// (src/openHours.js). 씨앗이 기본으로 11:00~14:00, 17:00~21:00 을 넣어두므로,
// 그대로 두면 이 테스트들은 점심에 돌리면 통과하고 새벽에 돌리면 403 으로
// 깨진다. 시각에 따라 결과가 달라지는 테스트는 없느니만 못하다 — 진짜
// 회귀인지 그냥 지금이 밤인지 구분할 수 없기 때문이다.
//
// 그 규칙 자체는 test/open-hours.test.js(분 단위)와
// test/e2e-open-hours.js(화면·주문까지)가 잰다.
//
// store 가 DB 에서 채워진 뒤에 불러야 한다 — 서버가 첫 요청을 처리한 다음.
module.exports = async function disableOrderHours() {
  const { store, save } = require("../src/db");
  store.settings.order_hours = { enabled: 0, ranges: [], closed_days: [] };
  await save();
};
