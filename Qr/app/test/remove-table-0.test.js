// 「外帶」라는 이름이 붙은 0번 테이블을 없애는 일회성 정리.
//
// 사장님(2026-09-10): "그냥 안 되돌려도 되니까 없애줘 다"
//
// 되돌릴 수 없는 삭제라 「언제 지우지 않는가」가 이 코드의 전부다. 잘못
// 지우면 그 자리의 미결제 주문을 결제 탭에서 열 수 없게 되거나(자리로
// 주문을 찾는다), 앉아 계신 손님이 화면에서 사라지거나, 최악으로는 포장
// 주문이 들어오는 길목인 포장 카운터가 없어진다.
const { applyRemoveTable020260910 } = require("../src/migrations/2026-09-10-remove-table-0");
const { hasUnpaidOrder } = require("../src/partySize");

const FLAG = "migration_2026_09_10_remove_table_0_applied";

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const storeWith = (tableOver = {}, orders = []) => ({
  settings: {},
  tables: [
    { id: 99, number: "0", label: "外帶", ...tableOver },
    { id: 1, number: "7" },
    { id: 2, number: "COUNTER", label: "포장 카운터", is_counter: true },
  ],
  orders,
});
const order = (tableNumber, status) => ({ id: 1, table_number: String(tableNumber), status, items: [] });

async function run(store) {
  await applyRemoveTable020260910(store, {
    save: async () => {},
    refreshAndSave: async (fn) => fn(store),
    hasUnpaidOrder,
  });
  return store;
}
const has0 = (s) => s.tables.some((t) => String(t.number) === "0");

(async () => {
  out.push("[지운다]");
  {
    const s = await run(storeWith());
    check("0번이 없어진다", !has0(s));
    check("다시 보지 않도록 플래그를 세운다", s.settings[FLAG] === true);
    check("다른 자리는 그대로", s.tables.length === 2);
    check("포장 카운터는 그대로", s.tables.some((t) => t.is_counter));
  }
  {
    // 결제가 끝난 주문만 남은 자리 — 받을 돈이 없으니 지워도 된다.
    const s = await run(storeWith({}, [order("0", "paid"), order("0", "cancelled")]));
    check("결제·취소만 남았으면 지운다", !has0(s));
    check("지난 주문은 지우지 않는다 — 그날 있었던 일이다", s.orders.length === 2);
  }

  out.push("");
  out.push("[지우지 않는다 — 여기가 이 코드의 전부다]");
  for (const status of ["new", "preparing", "served"]) {
    const s = await run(storeWith({}, [order("0", status)]));
    check(`못 받은 돈이 남아 있으면(${status}) 두고 간다`, has0(s));
    check(`  그리고 플래그를 세우지 않는다(${status}) — 다음에 다시 본다`, !s.settings[FLAG]);
  }
  {
    const s = await run(storeWith({ party_size: 2 }));
    check("손님이 앉아 계시면 두고 간다", has0(s));
    check("  플래그도 세우지 않는다", !s.settings[FLAG]);
  }
  {
    // 있어서는 안 되는 상황이지만, 지우는 코드는 「없어야 한다」에 기대지
    // 않는다. 포장 카운터를 지우면 포장 QR 전체가 죽는다.
    const s = await run(storeWith({ is_counter: true }));
    check("번호가 0 인데 포장 카운터면 손대지 않는다", has0(s));
    check("  플래그도 세우지 않는다", !s.settings[FLAG]);
  }

  out.push("");
  out.push("[여러 번 불러도 안전하다 — 서버가 뜰 때마다 지나간다]");
  {
    const s = storeWith();
    await run(s);
    const after = JSON.stringify(s);
    await run(s);
    await run(s);
    check("두 번, 세 번 돌려도 그대로", JSON.stringify(s) === after);
  }
  {
    // 사장님이 화면에서 먼저 지우셨을 수도 있다.
    const s = { settings: {}, tables: [{ id: 1, number: "7" }], orders: [] };
    await run(s);
    check("이미 없으면 조용히 플래그만 세운다", s.settings[FLAG] === true && s.tables.length === 1);
  }
  {
    const s = storeWith();
    s.settings[FLAG] = true;
    await run(s);
    check("플래그가 서 있으면 아무것도 하지 않는다", has0(s));
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
