// 밥 먹는 중에 인원수를 고쳤다고, 손님 계산서가 비면 안 된다.
//
// 2026-09-14 사장님: "고객 폰에 이미 주문 완료되어서 주문하신 내역이
// 없습니다. 인가? 그런 내용의 중국어가 안내돼." — 「尚未點餐」이다.
//
// 손님 화면의 「我的訂單」은 착석 시각 이후에 들어온 주문만 보여준다
// (GET /api/orders/table/:n 의 created_at >= seatingStart). 앞 손님 계산서가
// 다음 손님에게 보이던 것을 막은 조건이다 — 그 자체는 맞다.
//
// 그런데 PUT /party-size 가 그 시각을 **무조건** 지금으로 덮어쓰고 있었다.
// "아이 한 명 더 왔어요" 한 번이면 방금 시킨 것이 전부 그 앞이 되어, 주문은
// 멀쩡히 있는데 손님 화면에는 아무것도 안 남는다.
//
// 지키는 것은 두 가지다. 같은 손님이 고치면 계산서가 그대로 있을 것. 그리고
// **새 손님이 앉으면 앞 손님 계산서는 여전히 안 보일 것** — 그쪽을 망가뜨리면
// 앞 손님 몫을 다음 손님에게 받는다.
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
process.env.SESSION_SECRET = "party-size-keeps-history";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const request = require("supertest");
const app = require("../server");
const { store } = require("../src/db");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const TABLE = "9";

(async () => {
  // store 는 서버가 첫 요청을 처리하면서 DB 에서 채워진다. 그 전에는 비어 있다.
  await request(app).get("/api/settings");
  await require("./disable-order-hours")();
  const itemId = store.menuItems[0].id;
  const table = () => store.tables.find((t) => String(t.number) === TABLE);

  // 앞 손님 흔적을 지우고 시작한다.
  const t0 = table();
  delete t0.party_size;
  delete t0.party_adults;
  delete t0.party_children;
  delete t0.party_size_updated_at;

  out.push("[같은 손님이 인원만 고친다]");
  const guest = request.agent(app);
  let r = await guest.put(`/api/tables/${TABLE}/party-size`).send({ adults: 2, children: 0 });
  check("앉으면서 인원을 답한다", r.status === 200, JSON.stringify(r.body));
  const seatedAt = table().party_size_updated_at;
  check("착석 시각이 찍힌다", !!seatedAt, String(seatedAt));

  r = await guest.post("/api/orders").send({ tableNumber: TABLE, items: [{ itemId, qty: 1, orderType: "dine_in", addons: [] }] });
  check("주문이 들어간다", r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
  const orderId = r.body.id;

  r = await guest.get(`/api/orders/table/${TABLE}`);
  check("내 계산서에 보인다", r.body.length === 1 && r.body[0].id === orderId, JSON.stringify(r.body.map((o) => o.id)));

  // 1초를 실제로 넘긴다. 시각 비교가 초 단위라(src/partySize.js
  // seatingStartOf), 같은 초 안에서 고치면 예전 동작으로도 계산서가 남아
  // 있어서 — 시험이 고장을 못 잡는다. 밥 먹다 인원을 고치는 데는 1초보다
  // 훨씬 오래 걸린다.
  await new Promise((r2) => setTimeout(r2, 1100));
  r = await guest.put(`/api/tables/${TABLE}/party-size`).send({ adults: 2, children: 1 });
  check("아이가 한 명 더 왔다 — 인원을 고친다", r.status === 200 && r.body.party_children === 1, JSON.stringify(r.body));
  check("착석 시각은 그대로다", table().party_size_updated_at === seatedAt, `${seatedAt} -> ${table().party_size_updated_at}`);

  r = await guest.get(`/api/orders/table/${TABLE}`);
  check("계산서가 그대로 있다", r.body.length === 1 && r.body[0].id === orderId, JSON.stringify(r.body.map((o) => o.id)));

  out.push("\n[직원이 대신 고쳐도 같다]");
  const staff = request.agent(app);
  await staff.post("/api/auth/login").send({ password: "ownerpass123" });
  await new Promise((r2) => setTimeout(r2, 1100));
  r = await staff.put(`/api/tables/${TABLE}/party-size`).send({ adults: 3, children: 1 });
  check("직원이 인원을 고친다", r.status === 200 && r.body.party_adults === 3, JSON.stringify(r.body));
  check("착석 시각은 그대로다", table().party_size_updated_at === seatedAt, `${table().party_size_updated_at}`);
  r = await guest.get(`/api/orders/table/${TABLE}`);
  check("계산서가 그대로 있다", r.body.length === 1, JSON.stringify(r.body.map((o) => o.id)));

  out.push("\n[새 손님이 앉으면 — 앞 손님 것은 안 보여야 한다]");
  // 결제가 끝나면 인원이 비워진다(clearPartySizeIfSettled). 그 상태를 만든다.
  const paid = await staff.patch(`/api/orders/${orderId}`).send({ status: "paid", paymentMethod: "cash" });
  check("앞 손님이 결제한다", paid.status === 200, `${paid.status} ${JSON.stringify(paid.body)}`);
  check("자리가 비워진다", !table().party_size_updated_at, String(table().party_size_updated_at));

  const next = request.agent(app); // 다음 손님의 폰 — 아직 아무 데도 안 묶여 있다
  // created_at 과 착석 시각은 둘 다 초 단위 문자열이다(src/partySize.js
  // seatingStartOf). 같은 초 안에서 다 벌어지면 비교가 무의미해지므로 1초를
  // 실제로 넘긴다 — 가게에서는 앞 손님이 나가고 다음 손님이 앉는 사이다.
  await new Promise((r2) => setTimeout(r2, 1100));
  r = await next.put(`/api/tables/${TABLE}/party-size`).send({ adults: 2, children: 0 });
  check("새 손님이 앉는다", r.status === 200, JSON.stringify(r.body));
  const newSeatedAt = table().party_size_updated_at;
  check("착석 시각이 새로 찍힌다", !!newSeatedAt && newSeatedAt !== seatedAt, `${seatedAt} -> ${newSeatedAt}`);

  r = await next.get(`/api/orders/table/${TABLE}`);
  check("앞 손님 계산서는 안 보인다", r.body.length === 0, JSON.stringify(r.body.map((o) => o.id)));

  out.push("\n[처음 보는 폰이 답하면 — 새 손님으로 친다]");
  // 여기는 일부러 이렇게 둔다. 앉은 자리에 처음 보는 폰이 인원을 답하는 것이
  // 「세션을 잃은 그 손님」인지 「그냥 앉은 다음 손님」인지는 알 방법이 없다.
  //
  // 둘 중 하나로 틀려야 한다면 이쪽이다. 같은 손님으로 쳤다가 틀리면 다음
  // 손님이 앞 손님의 미결제 계산서를 보게 된다 — 2026-09-13 에 사장님이
  // 그대로 겪은 일이다("이미 먹고 나간 손님것까지 주문내용에 떠"). 새 손님으로
  // 쳤다가 틀리면 계산서가 안 보일 뿐이고, 그건 직원이 바로 알려줄 수 있다.
  //
  // 손님 화면은 자리에 인원이 이미 있으면 다시 묻지 않으므로(initPartySize),
  // 이 길로 들어오는 것은 인원을 **일부러** 고치는 경우뿐이다.
  const stranger = request.agent(app);
  await stranger.get(`/api/orders/table/${TABLE}`); // 세션만 만든다
  await new Promise((r2) => setTimeout(r2, 1100));
  r = await stranger.put(`/api/tables/${TABLE}/party-size`).send({ adults: 9, children: 0 });
  check("처음 보는 폰은 그냥 지나간다(기존 규칙)", r.status === 200, `${r.status}`);
  check("착석 시각이 새로 찍힌다", table().party_size_updated_at !== newSeatedAt, `${table().party_size_updated_at}`);

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
