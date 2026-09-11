// 정산하면 남은 인원수도 같이 비워지는가.
//
// 사장님(2026-09-10, 정산 후 테이블 목록 스크린샷과 함께):
//   "보면 여전히 메뉴는 없는데 사람 인원수는 있어 이건 뭐야"
//
// 손님이 QR 을 찍고 인원수만 답한 뒤 폰으로는 주문을 안 하는 일이 흔하다.
// 인원수는 주문보다 먼저 찍히는데 지워지는 건 결제가 끝나는 순간 하나뿐이라,
// 주문이 없으면 지울 계기가 영영 오지 않는다. 매일 쌓여서 다음 장사 때 빈
// 자리가 손님 있는 자리로 보인다.
//
// 여기서 재는 것은 「무엇을 비우고 무엇을 남기는가」다. 잘못 비우면 앉아
// 계신 손님이 사라지고, 안 비우면 원래 문제 그대로다.
const { clearIdleSeats } = require("../src/partySize");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const seat = (number, over = {}) => ({
  id: Number(String(number).replace(/\D/g, "")) || 900,
  number: String(number),
  party_size: 2,
  party_adults: 2,
  party_children: 0,
  party_size_updated_at: "2026-09-10T05:10:16.411Z",
  ...over,
});
const order = (tableNumber, status) => ({
  id: Math.floor(Math.random() * 1e6),
  table_number: String(tableNumber),
  status,
  party_size: 2,
  created_at: "2026-09-10 12:00:00",
  items: [],
});

// patchArrayItem 을 타지 않도록 db 를 갈아끼운다 — 이 테스트가 재는 것은
// 규칙이지 저장 경로가 아니다.
const writes = [];
require.cache[require.resolve("../src/db")] = {
  id: require.resolve("../src/db"),
  filename: require.resolve("../src/db"),
  loaded: true,
  exports: { patchArrayItem: async (col, id, patch) => { writes.push({ col, id, patch }); } },
  paths: [],
};

(async () => {
  out.push("[비우는 것]");
  {
    // 인원수만 있고 주문이 아예 없던 자리 — 사장님이 보신 그 자리다.
    const store = { tables: [seat("10")], orders: [] };
    const cleared = await clearIdleSeats(store);
    check("주문이 없던 자리는 비운다", cleared.length === 1 && cleared[0] === "10", JSON.stringify(cleared));
    check("네 칸이 전부 비워진다",
      store.tables[0].party_size === null &&
        store.tables[0].party_adults === null &&
        store.tables[0].party_children === null &&
        store.tables[0].party_size_updated_at === null);
  }
  {
    // 주문이 전부 취소된 자리. 취소로는 일부러 안 지우므로 여기까지 남는다.
    const store = { tables: [seat("22")], orders: [order("22", "cancelled")] };
    check("취소만 남은 자리도 비운다", (await clearIdleSeats(store)).length === 1);
  }
  {
    const store = { tables: [seat("A3")], orders: [order("A3", "paid")] };
    check("결제가 끝난 자리도 비운다", (await clearIdleSeats(store)).length === 1);
  }
  {
    const store = { tables: [seat("10"), seat("22"), seat("A3")], orders: [] };
    check("여러 자리를 한 번에", (await clearIdleSeats(store)).length === 3);
  }

  out.push("");
  out.push("[남기는 것 — 여기를 잘못하면 손님이 사라진다]");
  for (const status of ["new", "preparing", "served"]) {
    const store = { tables: [seat("7")], orders: [order("7", status)] };
    const cleared = await clearIdleSeats(store);
    check(`아직 못 받은 돈이 있으면(${status}) 그대로 둔다`,
      cleared.length === 0 && store.tables[0].party_size === 2, JSON.stringify(cleared));
  }
  {
    // 포장 카운터는 「이 자리에 몇 명」이 성립하지 않는 자리다.
    const store = { tables: [seat("COUNTER", { is_counter: true })], orders: [] };
    check("포장 카운터는 건드리지 않는다", (await clearIdleSeats(store)).length === 0);
  }
  {
    const store = { tables: [seat("11", { party_size: null, party_adults: null, party_children: null })], orders: [] };
    check("이미 비어 있는 자리는 세지 않는다", (await clearIdleSeats(store)).length === 0);
  }
  {
    // 한 자리만 돈이 남았을 때, 나머지는 비우고 그 자리만 남아야 한다.
    const store = { tables: [seat("10"), seat("7"), seat("COUNTER", { is_counter: true })], orders: [order("7", "served")] };
    const cleared = await clearIdleSeats(store);
    check("섞여 있어도 골라낸다", cleared.length === 1 && cleared[0] === "10", JSON.stringify(cleared));
    check("돈 남은 자리는 그대로", store.tables[1].party_size === 2);
  }

  out.push("");
  out.push("[저장은 그 자리 인원수 칸만 — store 문서를 통째로 쓰지 않는다]");
  {
    writes.length = 0;
    const store = { tables: [seat("10")], orders: [] };
    await clearIdleSeats(store);
    check("자리마다 한 번씩만 쓴다", writes.length === 1, JSON.stringify(writes));
    check("tables 컬렉션의 그 행에만", writes[0].col === "tables" && writes[0].id === 10, JSON.stringify(writes[0]));
    // 인원수 칸만 쓴다 — store 문서를 통째로 쓰지 않는다. 칸 목록은
    // src/partySize.js 의 PARTY_KEYS 가 정한다(2026-09-11 에
    // party_test_session 이 하나 늘었다). 여기서 목록을 다시 적으면 칸이
    // 늘 때마다 두 곳을 고쳐야 하므로, 그쪽을 가져다 쓴다.
    const { PARTY_KEYS } = require("../src/partySize");
    const keys = Object.keys(writes[0].patch).sort().join(",");
    check("인원수 칸만 쓴다 (PARTY_KEYS 그대로)",
      keys === [...PARTY_KEYS].sort().join(","), `${keys} vs ${[...PARTY_KEYS].sort().join(",")}`);
    check("다른 칸은 건드리지 않는다",
      Object.keys(writes[0].patch).every((k) => k.startsWith("party_")), keys);
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
