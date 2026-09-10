// 「外帶」라는 이름이 붙은 0번 테이블을 없앤다.
//
// 사장님(2026-09-10): "현재 포장 0번은 버릴거야 전부 그거랑 관련된 거 전부.
// counter 걸로 쓸거야" / "그냥 안 되돌려도 되니까 없애줘 다"
//
// 무슨 일이었나 — claude/takeout-counter-vs-table-0.md
//
// 포장 손님이 진짜 포장 카운터(is_counter, 번호 COUNTER)가 아니라 번호 0
// 짜리 일반 테이블로 들어오고 있었다. 그래서 포장인데 인원수를 묻고,
// 픽업번호도 이름도 없고, 주문 카드에 「테이블 0」 이라고 찍혔다. 게다가
// 자리 하나라서 포장 손님 두 분이 동시에 주문하면 계산이 한 장으로 붙었다.
//
// 아무도 못 알아챈 이유는 자리를 부르는 곳마다 `라벨 있으면 라벨, 없으면
// 번호` 로만 적어서, 라벨이 「外帶」면 번호 0 이 어디에도 안 보였기 때문이다.
// 그건 이미 고쳤다(tableDisplayName, QR 인쇄 시트). 이 파일은 남은 그 자리
// 자체를 없앤다.
//
// 관리자 화면에서 ✕ 한 번이면 되는 일을 굳이 코드로 두는 이유: 지우는
// 순간이 안전한지 여기서 한 번 더 재기 위해서다. 아래 세 가지 중 하나라도
// 걸리면 지우지 않고, 플래그도 세우지 않는다 — 다음에 서버가 뜰 때 다시
// 본다. 그 사이에 정리가 끝나 있으면 그때 지워진다.
const MIGRATION_FLAG = "migration_2026_09_10_remove_table_0_applied";

const TARGET_NUMBER = "0";

async function applyRemoveTable020260910(store, { save, refreshAndSave, hasUnpaidOrder }) {
  if (store.settings && store.settings[MIGRATION_FLAG]) return;

  const table = (store.tables || []).find((t) => String(t.number) === TARGET_NUMBER);
  if (!table) {
    // 이미 없다(사장님이 화면에서 먼저 지우셨을 수도 있다). 할 일이 없으니
    // 플래그를 세우고 다시는 보지 않는다.
    store.settings = store.settings || {};
    store.settings[MIGRATION_FLAG] = true;
    await save();
    return;
  }

  // 1. 포장 카운터는 절대 건드리지 않는다. 번호가 0 으로 바뀌어 있는
  //    상황은 없어야 하지만, 지우는 코드에서 "없어야 한다" 에 기대지 않는다.
  if (table.is_counter) return;
  // 2. 못 받은 돈이 남아 있으면 안 된다. 지우는 순간 그 주문은 결제 탭
  //    배치도에서 열 수 없는 주문이 된다 — 자리로 주문을 찾기 때문이다.
  if (hasUnpaidOrder(store, table.number)) return;
  // 3. 손님이 앉아 계신 걸로 되어 있으면 안 된다. 주문을 아직 안 넣었을 뿐
  //    사람은 그 자리에 있을 수 있다.
  if (table.party_size) return;

  // 지난 주문들은 지우지 않는다. 그 주문에 찍힌 table_number "0" 은 그날
  // 실제로 있었던 일이고, 결산이 지난 날짜를 다시 계산할 때 쓰는 값이다.
  // 자리를 없애는 것과 장부를 고치는 것은 다른 일이다.
  await refreshAndSave((s) => {
    s.tables = s.tables.filter((t) => String(t.number) !== TARGET_NUMBER);
    s.settings = s.settings || {};
    s.settings[MIGRATION_FLAG] = true;
  });
  console.log(`Removed table ${TARGET_NUMBER} (${table.label || "no label"}) — takeout now goes through the counter QR only.`);
}

module.exports = { applyRemoveTable020260910 };
