// 직원 계정의 결산 — 오늘 하루만.
//
// 사장님(2026-09-11): "결산은 현재 사장만 볼 수 있는데 직원이 볼 수 있는 건
// 결산탭에서 해당 하루만 볼 수 있게 해주고 지난 정산 추이처럼 전 데이터를
// 읽어오는 건 직원은 못 보게 해줘."
//
// ── 이 파일이 재는 것 ────────────────────────────────────────────────
//
//   막는 자리는 **서버 한 곳**이다. 화면에서 날짜 칸을 감추는 것은 막은 것이
//   아니다 — 주소창에 ?start=2026-08-01&end=2026-09-11 을 쳐 넣으면 한 달치
//   매출이 그대로 나온다. 그래서 여기서는 화면을 보지 않고, 직원 세션으로
//   **지난 날짜를 대놓고 물어본다.** 아무것도 안 나와야 통과다.
//
//   조용히 오늘로 바꿔치기하지 않는다. 사장님(2026-09-11): "직원 로그인으로는
//   쳐도 안나오게 해줘." 바꿔치기하면 어제 날짜를 쳐 넣은 사람에게 「어제
//   화면인 척하는 오늘 숫자」가 돌아가고, 그걸 어제 매출로 읽게 된다 —
//   아무것도 안 나오는 편이 틀린 것이 나오는 편보다 낫다.
//
//   그리고 사장님 쪽 길은 그대로 열려 있어야 한다 — 직원을 막다가 사장님까지
//   막아버리면 결산을 아무도 못 본다.
const path = require("path");

const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"),
  filename: require.resolve("mongodb"),
  loaded: true,
  exports: fake,
  paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.STAFF_PASSWORD = "staffpass123";
process.env.NODE_ENV = "test";

const express = require("express");
const session = require("express-session");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const { store, saveOrders } = require("../src/db");
const { taipeiDateString } = require("../src/settlement");

store.settings = {
  admin_password_hash: bcrypt.hashSync("ownerpass123", 10),
  staff_password_hash: bcrypt.hashSync("staffpass123", 10),
  staff_permissions: {},
};
store.orders = [];
store.tables = [];

const app = express();
app.use(express.json());
app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
app.use(require("../src/auth").syncSessionRole);
app.use("/api/auth", require("../src/routes/auth"));
app.use("/api/settlements", require("../src/routes/settlements"));
app.use("/api/orders", require("../src/routes/orders"));

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const TODAY = taipeiDateString();
const PAST = "2026-08-01";

// 오늘 1,000 / 지난달 9,999. 숫자를 멀리 떼어 놓은 이유는 「섞였는가」를
// 합계 하나로 바로 볼 수 있게 하기 위해서다.
let seq = 0;
const order = (date, total) => ({
  id: ++seq,
  table_number: 1,
  status: "paid",
  created_at: `${date} 12:00:00`,
  updated_at: `${date} 12:30:00`,
  paid_at: `${date} 12:30:00`,
  total,
  payment_method: "cash",
  party_size: 2,
  party_adults: 2,
  party_children: 0,
  order_type: "dine_in",
  items: [{ name_ko: "김치찌개", name_zh: "泡菜鍋", price: total, qty: 1, category: "식사" }],
});

(async () => {
  const rows = [order(TODAY, 1000), order(PAST, 9999)];
  store.orders = rows;
  await saveOrders(rows);

  const boss = request.agent(app);
  const staff = request.agent(app);
  let r;

  r = await boss.post("/api/auth/login").send({ password: "ownerpass123" });
  check("사장 로그인", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  r = await staff.post("/api/auth/login").send({ password: "staffpass123" });
  check("직원 로그인", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);

  out.push("\n[1] 직원도 결산을 연다 (오늘)");
  r = await staff.get("/api/settlements");
  check("직원 결산 조회 200", r.status === 200, `got ${r.status}`);
  check("오늘 날짜", r.body.start_date === TODAY && r.body.end_date === TODAY, JSON.stringify([r.body.start_date, r.body.end_date]));
  check("오늘 매출만", r.body.total_revenue === 1000, String(r.body.total_revenue));
  check("today_only 플래그", r.body.today_only === true, JSON.stringify(r.body.today_only));

  out.push("\n[2] 직원이 지난 날짜를 쳐 넣으면 아무것도 안 나온다 (핵심)");
  r = await staff.get(`/api/settlements?start=${PAST}&end=${TODAY}`);
  check("★ 범위 요청 거절 (403)", r.status === 403, `got ${r.status}`);
  check("★ 숫자가 하나도 안 실려 나감", r.body.total_revenue === undefined && r.body.payment_methods === undefined, JSON.stringify(r.body));
  check("거절 이유를 알려준다", r.body.error === "today_only", JSON.stringify(r.body));
  r = await staff.get(`/api/settlements?date=${PAST}`);
  check("★ ?date 로도 거절", r.status === 403, `got ${r.status}`);
  r = await staff.get(`/api/settlements?start=${TODAY}&end=2026-12-31`);
  check("★ 끝날짜만 늘려도 거절", r.status === 403, `got ${r.status}`);
  r = await staff.get(`/api/settlements?start=${PAST}&end=${PAST}`);
  check("★ 지난 하루만 집어도 거절", r.status === 403, `got ${r.status}`);

  out.push("\n[2-1] 오늘을 대놓고 적어 보내는 것은 통과 (같은 것을 달라는 말이다)");
  r = await staff.get(`/api/settlements?start=${TODAY}&end=${TODAY}`);
  check("오늘 범위는 200", r.status === 200, `got ${r.status}`);
  check("오늘 매출", r.body.total_revenue === 1000, String(r.body.total_revenue));
  r = await staff.get(`/api/settlements?shift=am`);
  check("오전만 보기는 직원도 쓴다", r.status === 200, `got ${r.status}`);

  out.push("\n[3] 지난 정산 기록·마감 저장은 사장님만");
  r = await staff.get("/api/settlements/history");
  check("직원 /history 차단", r.status === 401 || r.status === 403, `got ${r.status}`);
  r = await staff.post("/api/settlements/close").send({ date: TODAY });
  check("직원 /close 차단", r.status === 401 || r.status === 403, `got ${r.status}`);

  out.push("\n[4] 이전 주문 목록도 같은 규칙 — 지난 날짜는 안 나온다");
  r = await staff.get(`/api/orders/history?start=${PAST}&end=${TODAY}`);
  check("★ 지난 범위 거절 (403)", r.status === 403, `got ${r.status}`);
  check("★ 주문이 하나도 안 실려 나감", !Array.isArray(r.body) && !Array.isArray(r.body.orders), JSON.stringify(r.body).slice(0, 200));
  r = await staff.get(`/api/orders/history`);
  check("날짜 없이 부르면 200", r.status === 200, `got ${r.status}`);
  const list = Array.isArray(r.body) ? r.body : r.body.orders || [];
  // 「비어 있어서 통과」를 막는다 — 오늘 것은 반드시 들어 있어야 한다.
  check("오늘 주문은 보임", list.some((o) => String(o.created_at).slice(0, 10) === TODAY), JSON.stringify(list.map((o) => o.created_at)));
  check("지난달 주문이 안 나옴", list.every((o) => String(o.created_at).slice(0, 10) === TODAY), JSON.stringify(list.map((o) => o.created_at)));

  out.push("\n[5] 사장님 길은 그대로 (직원을 막다가 사장님까지 막으면 안 된다)");
  r = await boss.get(`/api/settlements?start=${PAST}&end=${TODAY}`);
  check("사장 범위 조회 200", r.status === 200, `got ${r.status}`);
  check("사장은 범위 그대로", r.body.start_date === PAST && r.body.end_date === TODAY, JSON.stringify([r.body.start_date, r.body.end_date]));
  check("사장은 두 건 다 보임", r.body.total_revenue === 10999, String(r.body.total_revenue));
  check("사장에게는 today_only 아님", r.body.today_only === false, JSON.stringify(r.body.today_only));
  r = await boss.get("/api/settlements/history");
  check("사장 /history 통과", r.status === 200, `got ${r.status}`);

  out.push("\n[6] 화면도 같은 이야기를 한다 (admin.html / admin.js)");
  const fs = require("fs");
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "admin.html"), "utf8");
  const js = fs.readFileSync(path.join(__dirname, "..", "public", "js", "admin.js"), "utf8");
  const tabBtn = html.match(/<button[^>]*data-tab="settlement"[^>]*>/);
  check("결산 탭 버튼이 owner-only 가 아님", tabBtn && !/owner-only/.test(tabBtn[0]), tabBtn && tabBtn[0]);
  check("OWNER_ONLY_TABS 에 settlement 없음", /OWNER_ONLY_TABS = new Set\(\["vip", "accounts"\]\)/.test(js));
  check("날짜 고르는 칸은 owner-only", /class="settlement-date-label owner-only"/.test(html));
  check("지난 정산 기록 사이드바는 owner-only", /class="settlement-nav owner-only"/.test(html));
  check("정산 추이 카드는 owner-only", /settlement-history-card owner-only/.test(html));
  check("직원 화면에 날짜 한 줄", /id="settlementTodayOnly"/.test(html) && /settlementTodayOnlyNote/.test(js));
  check("직원 세션은 /history 를 부르지 않음", /function loadSettlementHistory\(\) \{\s*\n\s*if \(currentRole !== "owner"\) return;/.test(js));
  // 화면이 오늘 날짜를 계산해 보내면 자정을 넘기는 순간 서버의 「오늘」과
  // 어긋나 멀쩡한 직원이 거절당한다. 직원 화면은 날짜를 아예 안 보낸다.
  check("직원 화면은 날짜를 아예 안 보낸다", (js.match(/const staffToday = currentRole !== "owner";/g) || []).length === 2);
  check("보내는 자리마다 그 검사를 거친다", (js.match(/if \(!staffToday && (start|end)\) params\.set\(/g) || []).length === 4);

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
