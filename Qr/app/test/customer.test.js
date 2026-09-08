// 손님 계정 기능: VIP 카드 연결과 주문 내역.
// 실제 라우트/가드/세션을 그대로 쓰고 mongodb 드라이버만 인메모리 대역으로.
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

const express = require("express");
const session = require("express-session");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const { store } = require("../src/db");
const { syncSessionRole } = require("../src/auth");
const { expiryDate } = require("../src/vip");

// seed() 를 돌리지 않고 이 테스트에 필요한 최소한만 손으로 채운다.
function resetStore() {
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const lastMonth = new Date(today);
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  const twoYearsAgo = new Date(today);
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

  store.settings = {
    admin_password_hash: bcrypt.hashSync("ownerpass123", 10),
    staff_permissions: {},
  };
  store.nextId = { orders: 1, vip_cards: 1, menuItems: 1, tables: 1 };
  store.menuItems = [
    { id: 1, code: "11", name_zh: "石鍋拌飯", name_ko: "돌솥비빔밥", price: 230, available: true, category_key: "rice" },
    { id: 2, code: "90", name_zh: "可樂", name_ko: "콜라", price: 60, available: true, category_key: "drink" },
  ];
  store.tables = [{ id: 1, number: "7", party_size: 2 }];
  store.orders = [];
  store.vipCards = [
    // 사장님이 발급해둔, 아직 아무도 안 가져간 카드
    { id: 1, card_number: "V0001", discount_percent: 10, issue_date: iso(lastMonth), google_uid: null, account_id: null },
    // 이미 만료된 카드
    { id: 2, card_number: "V0002", discount_percent: 10, issue_date: iso(twoYearsAgo), google_uid: null, account_id: null },
    // 예전 방식(구글 전용)으로 이미 등록돼 있는 카드
    { id: 3, card_number: "V0003", discount_percent: 20, issue_date: iso(lastMonth), google_uid: "legacy-uid", account_id: null },
  ];
  store.zones = [];
  store.payments = [];
  store.reservations = [];
  store.daily_settlements = [];
  store.categories = [];
}
resetStore();

const app = express();
app.use(express.json());
app.use(session({ secret: "t", resave: false, saveUninitialized: false }));
app.use(syncSessionRole);
app.use("/api/account", require("../src/routes/account"));
app.use("/api/members", require("../src/routes/members"));
app.use("/api/orders", require("../src/routes/orders"));

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) {
    pass++;
    out.push(`  ok   ${name}`);
  } else {
    fail++;
    out.push(`  FAIL ${name}  ${extra}`);
  }
}

(async () => {
  const alice = request.agent(app);
  const bob = request.agent(app);
  let r;

  out.push("\n[준비: 손님 두 명 가입]");
  r = await alice.post("/api/account/register").send({ email: "alice@example.com", password: "hunter2hunter", name: "앨리스" });
  check("앨리스 가입", r.status === 200, JSON.stringify(r.body));
  r = await bob.post("/api/account/register").send({ email: "bob@example.com", password: "hunter2hunter", name: "밥" });
  check("밥 가입", r.status === 200);

  out.push("\n[VIP 카드 — 로그인 계정으로 등록]");
  r = await request(app).get("/api/members/me");
  check("비로그인은 401", r.status === 401);

  r = await alice.get("/api/members/me");
  check("로그인했지만 카드 없음", r.status === 200 && r.body.membership === null, JSON.stringify(r.body));

  r = await alice.post("/api/members/register-card").send({ cardNumber: "NOPE" });
  check("없는 카드번호 거부", r.status === 400 && r.body.error === "card_not_found", JSON.stringify(r.body));

  r = await alice.post("/api/members/register-card").send({ cardNumber: "V0003" });
  check("남이 이미 가져간 카드 거부", r.status === 400 && r.body.error === "card_already_claimed", JSON.stringify(r.body));

  r = await alice.post("/api/members/register-card").send({ cardNumber: "V0001" });
  check("카드 등록 성공", r.status === 200 && r.body.membership.card_number === "V0001", JSON.stringify(r.body));
  check("등록 즉시 유효(active)", r.body.membership && r.body.membership.active === true, JSON.stringify(r.body.membership));
  check("만료일이 발급일+1년", r.body.membership.expiry_date === expiryDate(store.vipCards[0].issue_date));
  // ⚠️ 이메일로만 가입한 손님은 google_uid 가 없다. 예전 isActive()는
  // google_uid 가 있어야만 active 로 쳤기 때문에, 이 검사가 없으면
  // 이메일 가입자는 카드를 등록해도 할인이 영원히 안 걸린다.
  check("구글 없이도 계정으로 등록됨", store.vipCards[0].account_id && !store.vipCards[0].google_uid, JSON.stringify(store.vipCards[0]));

  r = await alice.post("/api/members/register-card").send({ cardNumber: "V0002" });
  check("한 계정에 카드 하나", r.status === 400 && r.body.error === "already_registered", JSON.stringify(r.body));

  r = await bob.get("/api/members/me");
  check("밥에게는 앨리스 카드가 안 보인다", r.body.membership === null, JSON.stringify(r.body));

  out.push("\n[주문에 할인이 실제로 걸리는지]");
  const orderBody = { tableNumber: "7", items: [{ itemId: 1, qty: 1 }] };
  r = await bob.post("/api/orders").send(orderBody);
  check("비회원 주문: 정가 230", r.status === 201 && r.body.total === 230, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  check("비회원 주문에 vip 표시 없음", r.body.vip_card_number == null);

  r = await alice.post("/api/orders").send(orderBody);
  check("회원 주문: 10% 할인 적용 (207)", r.status === 201 && r.body.total === 207, `total=${r.body.total}`);
  check("주문에 카드번호 기록", r.body.vip_card_number === "V0001", JSON.stringify(r.body.vip_card_number));

  out.push("\n[주문 내역 — 계정에 묶이는지]");
  r = await alice.get("/api/account/orders");
  check("앨리스 내역 1건", r.status === 200 && r.body.orders.length === 1, JSON.stringify(r.body.orders && r.body.orders.length));
  check("내역에 품목이 들어있다", r.body.orders[0].items.length === 1 && r.body.orders[0].items[0].qty === 1);
  check("내역에 할인 정보", r.body.orders[0].vip_discount_percent === 10);

  r = await bob.get("/api/account/orders");
  check("밥 내역 1건 (자기 것만)", r.body.orders.length === 1);
  // 다른 사람 주문이 섞이면 개인정보 유출이다 — 가장 중요한 검사.
  check(
    "남의 주문이 섞이지 않음",
    r.body.orders.every((o) => o.total === 230),
    JSON.stringify(r.body.orders.map((o) => o.total))
  );

  r = await request(app).get("/api/account/orders");
  check("비로그인은 내역 조회 불가", r.status === 401);

  out.push("\n[로그인 안 한 손님도 그대로 주문된다]");
  r = await request(app).post("/api/orders").send(orderBody);
  check("익명 주문 성공", r.status === 201 && r.body.total === 230, `${r.status}`);
  const anon = store.orders.find((o) => o.id === r.body.id);
  check("익명 주문은 계정이 안 붙는다", anon && anon.account_id === null);

  out.push("\n[예전 구글 전용 등록도 계속 동작]");
  const { cardBelongsTo, isActive } = require("../src/vip");
  const legacyCard = store.vipCards.find((c) => c.card_number === "V0003");
  check("구글 uid 로 본인 카드 인식", cardBelongsTo(legacyCard, { accountId: null, googleUid: "legacy-uid" }));
  check("남의 구글 uid 로는 인식 안 됨", !cardBelongsTo(legacyCard, { accountId: null, googleUid: "other-uid" }));
  check("구글 전용 카드도 여전히 유효", isActive(legacyCard) === true);
  const expired = store.vipCards.find((c) => c.card_number === "V0002");
  check("만료 카드는 무효", isActive(expired) === false);

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error("\nHARNESS ERROR:", e);
  process.exit(1);
});
