// 늘 거기 있는 시험용 자리를 하나 만든다.
//
// 사장님(2026-09-16): "지금 테이블이 실제 주문이 있어서 그러는데 차라리
// 테스트 테이블을 만들어줘. 테스터를 키든 안 켜든 볼 수 있게 해줘. 그리고
// 결제탭에서도 테스터 테이블을 한 곳 만들어줘서 사용할 수 있으면 좋겠어.
// 일반 테이블처럼 근데 그건 결산이나 실제 영수증은 발급 안되게해줘."
//
// 테스터 모드(src/testMode.js)는 **기기**를 통째로 시험용으로 바꾼다. 장사
// 중에 그걸 켜기는 부담스럽다 — 진짜 테이블에 진짜 주문이 들어 있는데 화면
// 규칙이 바뀌니까. 그래서 자리 하나를 아예 시험용으로 못 박는다.
//
// 포장 카운터(is_counter)와 같은 방식이다: 평범한 테이블 한 행일 뿐이라
// 주문·주방·결제 파이프라인이 통째로 그대로 돈다. 다른 것은 표 하나
// (is_test)와, 그 자리의 주문에 붙는 test_session 값뿐이다.
//
// 배치도에 **자리까지 잡아준다.** 포장 카운터는 zone_id 가 null 이라 배치도
// 어디에도 안 나타났고, 사장님이 그걸 찾지 못해 「外帶」라는 가짜 테이블을
// 직접 만들어 쓰고 계셨다(2026-09-05). 같은 일을 반복하지 않는다 — 사장님이
// "결제탭에서도 사용할 수 있으면 좋겠어" 라고 한 것이 바로 이 부분이다.
const { TEST_TABLE_NUMBER } = require("../testMode");

const MIGRATION_FLAG = "migration_2026_09_16_test_table_applied";

/** 첫 구역의 오른쪽 아래 빈 자리. 구역이 없으면 배치 없이 만든다. */
function placementFor(store) {
  const zones = store.zones || [];
  if (!zones.length) return { zone_id: null, x: 10, y: 10 };
  const zone = [...zones].sort((a, b) => a.sort_order - b.sort_order)[0];
  const inZone = (store.tables || []).filter((t) => t.zone_id === zone.id);
  // 이미 놓인 것들보다 아래에 둔다 — 겹쳐 놓으면 배치도 계산이 자리를
  // 다시 잡아주긴 하지만, 맨 뒤에 오는 편이 눈에 찾기 쉽다.
  const maxY = inZone.reduce((m, t) => Math.max(m, Number(t.y) || 0), 0);
  return { zone_id: zone.id, x: 10, y: maxY + 80 };
}

async function applyTestTable20260916(store, { save, nextId }) {
  if (store.settings && store.settings[MIGRATION_FLAG]) return;

  store.tables = store.tables || [];
  const existing = store.tables.find((t) => t.is_test || String(t.number) === TEST_TABLE_NUMBER);
  if (!existing) {
    const { zone_id, x, y } = placementFor(store);
    store.tables.push({
      id: nextId("tables"),
      number: TEST_TABLE_NUMBER,
      // 한 글자. 배치도 타일이 70px 이라 긴 이름은 안 들어간다(2026-09-17).
      label: TEST_TABLE_NUMBER,
      // 맨 뒤로. 진짜 자리들 사이에 끼면 직원이 헷갈린다.
      sort_order: 9999,
      zone_id,
      x,
      y,
      width: 70,
      height: 70,
      is_test: true,
    });
    console.log("[migration] 테스트 테이블을 만들었습니다.");
  } else if (!existing.is_test) {
    // 번호만 같고 표가 없던 자리 — 표를 붙여 준다.
    existing.is_test = true;
    console.log("[migration] 기존 TEST 자리에 시험용 표를 붙였습니다.");
  }

  store.settings = store.settings || {};
  store.settings[MIGRATION_FLAG] = true;
  await save();
}

module.exports = { applyTestTable20260916, placementFor, MIGRATION_FLAG };
