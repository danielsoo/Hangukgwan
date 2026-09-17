// 이미 만들어져 있던 시험용 자리의 이름을 「T」로 줄인다.
//
// 2026-09-17 사장님: "지금 테스트 테이블이 이름이 길어 그냥 T 라고 해줘."
//
// 만들 때는 번호 "TEST" · 이름 "테스트 테이블" 이었다. 배치도 타일은 한 변이
// 70px 이라 그 이름이 들어가지 않고, 영수증에는 「桌號 TEST」로 찍힌다.
//
// ── 여기서 조심할 것 ─────────────────────────────────────────────────
//
// **번호까지 바꾸므로 그 자리의 주문이 미아가 될 수 있다.** 주문은 자리를
// 번호(table_number)로 가리킨다. 자리만 바꾸고 주문을 놔두면 그 주문들은
// 없는 자리를 가리키게 되고, 결제탭에서도 안 보이고 인원 정리도 안 된다.
//
// 그렇다고 "TEST" 번호의 주문을 전부 옮기면 안 된다 — 혹시 예전에 누가
// 그 번호로 진짜 주문을 넣어뒀다면 그건 우리 것이 아니다. 시험용 표
// (test_session)가 붙은 것만 옮긴다.
const { applyTestTableShortName20260917, MIGRATION_FLAG, OLD_NUMBER } = require("../src/migrations/2026-09-17-test-table-short-name");
const testMode = require("../src/testMode");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

function fixture() {
  const store = {
    tables: [
      { id: 1, number: OLD_NUMBER, label: "테스트 테이블", is_test: true, zone_id: 3, x: 10, y: 200 },
      { id: 2, number: "9", label: "9번" },
      { id: 3, number: "12", label: "12번" },
    ],
    settings: {},
  };
  const orders = [
    { id: 1, table_number: OLD_NUMBER, test_session: testMode.TEST_TABLE_SESSION },
    { id: 2, table_number: OLD_NUMBER, test_session: testMode.TEST_TABLE_SESSION },
    // 시험용 표가 없는 주문 — 우리 것이 아니다.
    { id: 3, table_number: OLD_NUMBER },
    { id: 4, table_number: "9", test_session: testMode.TEST_TABLE_SESSION },
  ];
  const saved = [];
  const deps = {
    save: async () => {},
    findOrders: async (q) => orders.filter((o) => o.table_number === q.table_number),
    saveOrders: async (rows) => { saved.push(...rows.map((r) => r.id)); },
  };
  return { store, orders, saved, deps };
}

(async () => {
  out.push("[자리 이름을 줄인다]");
  {
    const f = fixture();
    await applyTestTableShortName20260917(f.store, f.deps);
    const tt = f.store.tables.find((t) => t.is_test);
    check("★ 번호가 T", tt.number === "T", `${tt.number}`);
    check("★ 이름도 T", tt.label === "T", `${tt.label}`);
    check("상수와 같다", tt.number === testMode.TEST_TABLE_NUMBER, "");
    check("배치도 자리는 그대로", tt.zone_id === 3 && tt.x === 10 && tt.y === 200, JSON.stringify(tt));
    check("진짜 자리는 안 건드린다", f.store.tables[1].number === "9" && f.store.tables[2].number === "12", "");
  }

  out.push("\n[그 자리의 주문도 같이 옮긴다]");
  {
    const f = fixture();
    await applyTestTableShortName20260917(f.store, f.deps);
    check("★ 시험용 주문이 새 번호를 가리킨다", f.orders[0].table_number === "T" && f.orders[1].table_number === "T", JSON.stringify(f.orders));
    check("★ 저장까지 했다", f.saved.sort().join(",") === "1,2", JSON.stringify(f.saved));
    check(
      "★ 시험용 표가 없는 주문은 그대로 둔다",
      f.orders[2].table_number === OLD_NUMBER,
      "그 번호로 들어온 진짜 주문일 수 있다 — 우리 것만 옮긴다"
    );
    check("다른 자리 주문도 그대로", f.orders[3].table_number === "9", "");
  }

  out.push("\n[두 번 돌아도 안전하다]");
  {
    const f = fixture();
    await applyTestTableShortName20260917(f.store, f.deps);
    const before = f.saved.length;
    await applyTestTableShortName20260917(f.store, f.deps);
    check("★ 표가 서 있으면 다시 안 돈다", f.store.settings[MIGRATION_FLAG] === true && f.saved.length === before, `${f.saved.length} vs ${before}`);
  }

  out.push("\n[사장님이 직접 지은 이름은 놔둔다]");
  {
    const f = fixture();
    f.store.tables[0].label = "시험용 (건드리지 마세요)";
    await applyTestTableShortName20260917(f.store, f.deps);
    const tt = f.store.tables.find((t) => t.is_test);
    check("★ 이름은 그대로", tt.label === "시험용 (건드리지 마세요)", tt.label);
    check("번호는 그래도 줄인다", tt.number === "T", tt.number);
  }

  out.push("\n[자리가 아직 없어도 안 터진다]");
  {
    const store = { tables: [{ id: 2, number: "9" }], settings: {} };
    await applyTestTableShortName20260917(store, { save: async () => {} });
    check("★ 조용히 넘어간다", store.settings[MIGRATION_FLAG] === true, "");
  }

  out.push("\n[줄이기 전 번호도 계속 알아본다]");
  // 마이그레이션이 아직 안 돈 서버, 또는 옛 화면이 떠 있는 태블릿.
  check("★ TEST 도 시험용 자리다", testMode.isTestTable({ number: "TEST" }) === true, "");
  check("★ T 도 시험용 자리다", testMode.isTestTable({ number: "T" }) === true, "");
  check("표만 있어도 알아본다", testMode.isTestTable({ number: "31", is_test: true }) === true, "");
  check("진짜 자리는 아니다", testMode.isTestTable({ number: "12" }) === false, "");

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error(e);
  process.exit(1);
});
