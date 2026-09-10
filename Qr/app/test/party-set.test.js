// 인원과 메뉴는 하나의 세트인가.
//
// 2026-09-10 사장님: "다시 한 번 말하지만 이건 늘 기억해. 완전 포장(counter
// qr)를 제외하고 모든 테이블들은 인원과 메뉴는 하나의 세트야. 삭제되던
// 결제가 완료되던, 자리 이동을 하던 합산을 하던 같이 움직이는 하나야."
//
// 그날 화면에서 이 규칙이 두 방향으로 다 깨져 있었다.
//   9번  — 자리에는 앞 손님의 (4-0), 살아 있는 주문에는 지금 손님의 (2-0)
//   A11 — 살아 있는 주문이 두 건인데 자리에는 인원이 아예 없음
//
// 사장님이 물은 것도 이것이었다: "결제 탭과 테이블/qr 코드 탭에서는 실시간
// 주문에는 있는 인원이 그냥 표시만 안되는건지 아니면 실제로 없는 데이터인데
// 실시간 주문 탭에서 억지로 만드는 건지." 답은 셋째다 — 주문은 만들어질 때
// 그 순간의 인원을 자기 안에 박아두고(결산의 손님 수가 쓰는 값이다) 그걸
// 보여준 것이고, 자리 쪽 숫자가 사라지거나 낡아 있었다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"),
  filename: require.resolve("mongodb"),
  loaded: true,
  exports: fake,
  paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "party-set";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const request = require("supertest");
const app = require("../server");
const { store, getDb } = require("../src/db");
const { partyOfTable } = require("../src/partySize");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

(async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ password: "ownerpass123" });
  await require("./disable-order-hours")();
  const itemId = store.menuItems[0].id;
  const T = store.tables.filter((t) => !t.is_counter);

  out.push("[어느 쪽이 지금 손님인가]");
  {
    const mk = (table, orders) => ({ tables: [table], orders });
    // 9번 — 자리에는 앞 손님 4명, 살아 있는 주문에는 지금 손님 2명.
    const s1 = mk(
      { id: 1, number: "9", party_size: 4, party_adults: 4, party_children: 0, party_size_updated_at: "2026-09-10T03:30:00Z" },
      [{ id: 1, table_number: "9", status: "served", party_size: 2, party_adults: 2, party_children: 0, created_at: "2026-09-10 12:31:00" }]
    );
    const p1 = partyOfTable(s1, s1.tables[0]);
    check("앞 손님 숫자가 남아 있으면 지금 주문 쪽을 따른다", p1.size === 2 && p1.from === "order", JSON.stringify(p1));

    // A11 — 자리에는 아무것도 없는데 밥은 나가 있다.
    const s2 = mk({ id: 2, number: "A11" },
      [{ id: 2, table_number: "A11", status: "served", party_size: 5, party_adults: 5, party_children: 0, created_at: "2026-09-10 12:29:00" }]);
    const p2 = partyOfTable(s2, s2.tables[0]);
    check("자리에 인원이 없어도 주문이 살아 있으면 손님은 앉아 계신다", p2.size === 5 && p2.from === "order", JSON.stringify(p2));

    // 식사 중에 일행이 늘어 직원이 고쳐 넣은 경우 — 자리 쪽이 더 나중이다.
    const s3 = mk(
      { id: 3, number: "5", party_size: 4, party_adults: 4, party_children: 0, party_size_updated_at: "2026-09-10T04:45:00Z" },
      [{ id: 3, table_number: "5", status: "served", party_size: 2, party_adults: 2, party_children: 0, created_at: "2026-09-10 12:31:00" }]
    );
    const p3 = partyOfTable(s3, s3.tables[0]);
    check("식사 중에 고쳐 넣은 인원은 그대로 지킨다", p3.size === 4 && p3.from === "table", JSON.stringify(p3));

    // 주문이 없는 자리 — 손님이 앉아 인원만 넣은 상태.
    const s4 = mk({ id: 4, number: "6", party_size: 3, party_adults: 2, party_children: 1, party_size_updated_at: "2026-09-10T04:00:00Z" }, []);
    check("주문 전에 인원만 넣은 자리도 그대로", partyOfTable(s4, s4.tables[0]).size === 3);

    // 결제된 주문은 세지 않는다 — 그 손님은 갔다.
    const s5 = mk({ id: 5, number: "8" },
      [{ id: 5, table_number: "8", status: "paid", party_size: 4, created_at: "2026-09-10 11:00:00" }]);
    check("결제된 주문으로는 손님을 만들어내지 않는다", partyOfTable(s5, s5.tables[0]).size === null);
    const s6 = mk({ id: 6, number: "8" },
      [{ id: 6, table_number: "8", status: "cancelled", party_size: 4, created_at: "2026-09-10 11:00:00" }]);
    check("취소된 주문도 마찬가지", partyOfTable(s6, s6.tables[0]).size === null);

    // 포장 카운터는 규칙 밖이다 — 서로 무관한 손님 주문이 쌓이는 자리다.
    const s7 = mk({ id: 7, number: "外帶", is_counter: true, party_size: 3 },
      [{ id: 7, table_number: "外帶", status: "served", party_size: 2, created_at: "2026-09-10 12:00:00" }]);
    check("포장 카운터는 인원을 안 센다", partyOfTable(s7, s7.tables[0]).size === null);
  }

  out.push("\n[어긋난 자리는 화면을 열 때 고쳐진다]");
  {
    const n = T[0].number;
    await agent.put(`/api/tables/${n}/party-size`).send({ adults: 3, children: 1 });
    await agent.post("/api/orders").send({ tableNumber: n, items: [{ itemId, qty: 1 }] });
    // 덮어쓰기로 자리 쪽 인원이 사라진 상태를 흉내낸다.
    const t = store.tables.find((x) => String(x.number) === String(n));
    t.party_size = null; t.party_adults = null; t.party_children = null;
    await getDb().collection("store").updateOne({ _id: "main" },
      { $set: { "tables.$[e].party_size": null } }).catch(() => {});

    const list = await agent.get("/api/tables");
    const row = list.body.find((x) => String(x.number) === String(n));
    check("목록에 인원이 다시 보인다", row.party_size === 4, JSON.stringify({ size: row.party_size }));
    check("어른/아이 구분도 살아난다", row.party_adults === 3 && row.party_children === 1,
      JSON.stringify({ a: row.party_adults, c: row.party_children }));
    check("자리 자체가 고쳐진다", t.party_size === 4, String(t.party_size));
    // 손님 화면도 다시 묻지 않는다 — 물으면 앞 손님 밥값이 남은 자리에
    // 새 인원이 찍힌다.
    const ask = await request(app).get(`/api/tables/${n}/party-size`);
    check("앉아 계신 손님에게 인원을 다시 묻지 않는다", ask.body.party_size === 4, JSON.stringify(ask.body));
  }

  out.push("\n[결제하면 둘 다 사라진다]");
  {
    const n = T[1].number;
    await agent.put(`/api/tables/${n}/party-size`).send({ adults: 2, children: 0 });
    const o = await agent.post("/api/orders").send({ tableNumber: n, items: [{ itemId, qty: 1 }] });
    await agent.patch(`/api/orders/${o.body.id}`).send({ status: "paid", paymentMethod: "cash" });
    const t = store.tables.find((x) => String(x.number) === String(n));
    check("자리에서 인원이 사라진다", !t.party_size, String(t.party_size));
    const list = await agent.get("/api/tables");
    const row = list.body.find((x) => String(x.number) === String(n));
    check("목록에서도 사라진다 — 결제된 주문으로 되살아나지 않는다", !row.party_size, String(row.party_size));
    const ask = await request(app).get(`/api/tables/${n}/party-size`);
    check("다음 손님에게는 다시 묻는다", !ask.body.party_size, JSON.stringify(ask.body));
  }

  out.push("\n[자리를 옮기면 둘 다 옮겨간다]");
  {
    const from = T[2].number;
    const to = T[3].number;
    await agent.put(`/api/tables/${from}/party-size`).send({ adults: 2, children: 1 });
    await agent.post("/api/orders").send({ tableNumber: from, items: [{ itemId, qty: 1 }] });
    await agent.post("/api/orders/move").send({ from, to });
    const tf = store.tables.find((x) => String(x.number) === String(from));
    const tt = store.tables.find((x) => String(x.number) === String(to));
    check("옮긴 자리에 인원이 있다", tt.party_size === 3, String(tt.party_size));
    check("떠난 자리에는 인원이 없다", !tf.party_size, String(tf.party_size));
    check("주문도 같이 갔다",
      store.orders.filter((o) => String(o.table_number) === String(to) && o.status !== "paid").length === 1);
    // 떠난 자리가 다시 살아나면 안 된다 — 거기 살아 있는 주문이 없다.
    const list = await agent.get("/api/tables");
    const rowFrom = list.body.find((x) => String(x.number) === String(from));
    check("떠난 자리가 되살아나지 않는다", !rowFrom.party_size, String(rowFrom.party_size));
  }

  out.push("\n[합산 결제해도 둘 다 사라진다]");
  {
    const a = T[6].number;
    const b = T[7].number;
    for (const n of [a, b]) {
      await agent.put(`/api/tables/${n}/party-size`).send({ adults: 2, children: 0 });
      await agent.post("/api/orders").send({ tableNumber: n, items: [{ itemId, qty: 1 }] });
    }
    const ids = store.orders
      .filter((o) => [String(a), String(b)].includes(String(o.table_number)) && o.status !== "paid")
      .map((o) => o.id);
    // 화면이 하는 그대로 — 동시에 보낸다(public/js/admin.js mergePayConfirmBtn).
    await Promise.all(ids.map((id) => agent.patch(`/api/orders/${id}`).send({ status: "paid", paymentMethod: "cash" })));
    const list = await agent.get("/api/tables");
    for (const n of [a, b]) {
      const row = list.body.find((x) => String(x.number) === String(n));
      check(`${n}번 인원이 사라진다`, !row.party_size, String(row.party_size));
    }
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
