// 9/13 오후 20건을 뺄 때, 딱 그 20건만 빠지는가.
//
// 실제 매출을 건드리는 일이라 시험이 두 가지를 봐야 한다.
//   1. 지울 것을 빠짐없이 지우는가
//   2. **지우면 안 되는 것을 안 지우는가** ← 이쪽이 더 중요하다
const {
  applyRemove0913Pm20260914,
  MIGRATION_FLAG,
  ARCHIVE,
  ORDER_IDS,
  isTarget,
} = require("../src/migrations/2026-09-14-remove-0913-pm-orders");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

function fakeDb(orderRows) {
  const cols = { orders: [...orderRows], [ARCHIVE]: [] };
  const api = (name) => ({
    find(filter) {
      const ids = (filter && filter._id && filter._id.$in) || null;
      const rows = cols[name].filter((r) => !ids || ids.includes(r._id));
      return { async toArray() { return rows.map((r) => ({ ...r })); } };
    },
    async bulkWrite(ops) {
      for (const op of ops) {
        const rep = op.replaceOne;
        if (!rep) continue;
        const i = cols[name].findIndex((r) => r._id === rep.filter._id);
        if (i >= 0) cols[name][i] = rep.replacement;
        else cols[name].push(rep.replacement);
      }
    },
    async countDocuments(filter) {
      const ids = (filter && filter._id && filter._id.$in) || null;
      return cols[name].filter((r) => !ids || ids.includes(r._id)).length;
    },
    async deleteMany(filter) {
      const ids = (filter && filter._id && filter._id.$in) || [];
      const before = cols[name].length;
      cols[name] = cols[name].filter((r) => !ids.includes(r._id));
      return { deletedCount: before - cols[name].length };
    },
  });
  return { cols, handle: { collection: api } };
}

const mk = (id, over = {}) => ({
  _id: id, id, created_at: "2026-09-13 17:30:00", service_period: "pm",
  status: "paid", total: 1000, table_number: "5", ...over,
});

(async () => {
  out.push("[대상을 고르는 조건]");
  check("★ 9/13 오후 결제완료면 대상", isTarget(mk(1)));
  check("★ 오전 것은 대상 아님", !isTarget(mk(1, { service_period: "am" })));
  check("★ 다른 날은 대상 아님", !isTarget(mk(1, { created_at: "2026-09-14 17:30:00" })));
  check("★ 취소된 것은 대상 아님", !isTarget(mk(1, { status: "cancelled" })));
  check("★ 안 끝난 주문은 대상 아님", !isTarget(mk(1, { status: "served" })));
  check("번호 20개", ORDER_IDS.length === 20, String(ORDER_IDS.length));

  out.push("\n[돌리면 그 20건만 빠진다]");
  const rows = [
    ...ORDER_IDS.map((id) => mk(id)),
    mk(600, { service_period: "am", total: 5000 }),     // 9/13 오전 — 남아야 한다
    mk(626, { status: "cancelled" }),                   // 9/13 오후 취소 — 남아야 한다
    mk(700, { created_at: "2026-09-14 11:00:00", service_period: "am" }), // 오늘 — 남아야 한다
  ];
  const { cols, handle } = fakeDb(rows);
  const store = { settings: {} };
  let saved = null;
  await applyRemove0913Pm20260914(store, {
    getDb: () => handle, connectDB: async () => {}, saveFields: async (f) => { saved = f; },
  });
  check("★ orders 에 3건만 남는다", cols.orders.length === 3, JSON.stringify(cols.orders.map((r) => r._id)));
  check("★ 9/13 오전 매출은 그대로", cols.orders.some((r) => r._id === 600));
  check("★ 9/13 오후 취소건은 그대로", cols.orders.some((r) => r._id === 626));
  check("★ 오늘 주문은 그대로", cols.orders.some((r) => r._id === 700));
  check("보관함에 20건", cols[ARCHIVE].length === 20, String(cols[ARCHIVE].length));
  check("★ 보관함에 원본 금액이 남아 있다", cols[ARCHIVE].every((r) => r.total === 1000));
  check("언제·왜 지웠는지 적어둔다", cols[ARCHIVE].every((r) => r.removed_at && r.removed_reason));
  check("표를 남긴다", !!store.settings[MIGRATION_FLAG] && !!saved);

  out.push("\n[두 번 돌아도 한 번만]");
  const before = cols.orders.length;
  await applyRemove0913Pm20260914(store, {
    getDb: () => handle, connectDB: async () => {}, saveFields: async () => {},
  });
  check("★ 이미 돌았으면 아무것도 안 한다", cols.orders.length === before);

  out.push("\n[번호가 맞아도 내용이 다르면 안 건드린다]");
  // 2026-09-10 에 같은 주문번호가 두 번 나온 적이 있다. 엉뚱한 주문이 같은
  // 번호를 달고 있으면 그건 손대면 안 되는 남의 매출이다.
  const wrong = [mk(614, { created_at: "2026-09-20 12:00:00", service_period: "am", total: 9999 })];
  const f2 = fakeDb(wrong);
  const store2 = { settings: {} };
  await applyRemove0913Pm20260914(store2, {
    getDb: () => f2.handle, connectDB: async () => {}, saveFields: async () => {},
  });
  check("★ 조건 안 맞는 것은 그대로 둔다", f2.cols.orders.length === 1 && f2.cols.orders[0].total === 9999);
  check("보관함도 비어 있다", f2.cols[ARCHIVE].length === 0);

  out.push("\n[보관이 덜 됐으면 원본을 안 지운다]");
  const f3 = fakeDb(ORDER_IDS.map((id) => mk(id)));
  const real = f3.handle.collection;
  f3.handle.collection = (name) => {
    const col = real(name);
    if (name === ARCHIVE) return { ...col, async countDocuments() { return 3; } }; // 덜 들어간 척
    return col;
  };
  const store3 = { settings: {} };
  await applyRemove0913Pm20260914(store3, {
    getDb: () => f3.handle, connectDB: async () => {}, saveFields: async () => {},
  });
  check("★ 원본 20건이 그대로 있다", f3.cols.orders.length === 20, String(f3.cols.orders.length));
  check("★ 표를 안 남긴다 — 다음에 다시 시도한다", !store3.settings[MIGRATION_FLAG]);

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
