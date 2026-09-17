// 시험용 자리의 이름을 「T」 한 글자로 줄인다.
//
// 2026-09-17 사장님: "지금 테스트 테이블이 이름이 길어 그냥 T 라고 해줘."
//
// 만들 때는 번호 "TEST" · 이름 "테스트 테이블" 이었다. 배치도 타일은 한 변이
// 70px 이라 그 이름이 들어가지 않고, 영수증에는 「桌號 TEST」 라고 찍힌다.
// 둘 다 「T」 한 글자면 충분하다 — 그 자리가 어디에 쓰는 자리인지는 붉은
// 「테스트」 배지가 따로 말해준다.
//
// 번호까지 바꾸므로 **이미 그 자리에 들어가 있는 주문도 같이 옮긴다.**
// 주문은 자리를 번호(table_number)로 가리키기 때문에, 자리만 바꾸면 그
// 주문들이 없는 자리를 가리키는 미아가 된다.
const { TEST_TABLE_NUMBER, TEST_TABLE_SESSION } = require("../testMode");

const MIGRATION_FLAG = "migration_2026_09_17_test_table_short_name_applied";
const OLD_NUMBER = "TEST";
const OLD_LABELS = ["테스트 테이블", "TEST"];

async function applyTestTableShortName20260917(store, { save, findOrders, saveOrders } = {}) {
  if (store.settings && store.settings[MIGRATION_FLAG]) return;

  const table = (store.tables || []).find((t) => t.is_test || String(t.number) === OLD_NUMBER);
  if (table) {
    const was = String(table.number);
    table.number = TEST_TABLE_NUMBER;
    // 사장님이 직접 다른 이름을 지어 뒀으면 그건 놔둔다 — 우리가 지은
    // 이름일 때만 바꾼다.
    if (!table.label || OLD_LABELS.includes(String(table.label))) table.label = TEST_TABLE_NUMBER;

    if (was !== TEST_TABLE_NUMBER && typeof findOrders === "function" && typeof saveOrders === "function") {
      // 그 자리의 주문을 같이 옮긴다. 시험용 표(test_session)가 붙은 것만
      // 건드린다 — 혹시 예전에 누가 "TEST" 라는 번호로 진짜 주문을 넣었다면
      // 그건 우리 것이 아니다.
      const rows = await findOrders({ table_number: was });
      const mine = (rows || []).filter((o) => o.test_session === TEST_TABLE_SESSION);
      if (mine.length) {
        mine.forEach((o) => {
          o.table_number = TEST_TABLE_NUMBER;
        });
        await saveOrders(mine);
      }
      console.log(`[migration] 시험용 자리를 「${TEST_TABLE_NUMBER}」로 줄였습니다 (주문 ${mine.length}건 함께 옮김).`);
    } else if (was !== TEST_TABLE_NUMBER) {
      console.log(`[migration] 시험용 자리를 「${TEST_TABLE_NUMBER}」로 줄였습니다.`);
    }
  }

  store.settings = store.settings || {};
  store.settings[MIGRATION_FLAG] = true;
  await save();
}

module.exports = { applyTestTableShortName20260917, MIGRATION_FLAG, OLD_NUMBER };
