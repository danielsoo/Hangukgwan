// 받을 돈이 남았으면 자동 마감을 미룬다.
//
// 2026-09-22 사장님: "자동으로 할 때 그런 상황이 생기면 무시하고 진행하지
// 말고 라인으로 문자를 보내줘 그리고 대기 시켜주고 그러다 다음 영업 시간
// 5분전까지도 안되면 그때는 그냥 강제로 해줘."
//
// ── 왜 미루는가
//
// 마감은 「여기까지 받았다」를 못 박는 일이다. 받을 돈이 남았는데 그대로
// 박으면 그 돈은 장부에서 조용히 사라진다.
//
// 사람이 누를 때는 화면이 묻는다 — "미결제 N건을 전부 결제완료로 처리할까요?"
// 자동(밤 23:00 크론)은 물을 사람이 없다. 그래서 멈추고 사람을 부른다.
//
// 그렇다고 영영 기다리지는 않는다. 다음 장사가 시작되면 어제 돈과 오늘 돈이
// 한 판에 섞인다. 「다음 영업 5분 전」은 이 저장소가 이미 쓰는 경계다
// (src/servicePeriod.js LEAD_MIN — 자동 오전 마감도 같은 규칙, 사장님이
// 2026-09-10 에 오전 건으로 같은 말씀을 하셨다).
//
// ── 이 시험이 재는 것
//
// 「문자가 예쁘게 나가는가」가 아니라 **돈이 사라지지 않는가**다:
//
//   · 미결제가 있는데 마감해 버리지 않는가  ← 제일 중요하다
//   · 미뤘다는 사실이 사장님께 가는가, 언제까지인지 적혀 있는가
//   · 정리되면 그 자리에서 마감하는가 (영영 안 닫히면 그것도 고장이다)
//   · 강제 시각이 지나면 남아 있어도 닫는가, 그리고 그렇다고 적는가
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
process.env.SESSION_SECRET = "close-hold-unpaid";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";
delete process.env.CRON_SECRET;

const realFetch = global.fetch;
let pushes = [];
global.fetch = async (url, opts) => {
  const href = String(url && url.url ? url.url : url);
  if (href.startsWith("https://api.line.me/")) {
    const body = JSON.parse((opts && opts.body) || "{}");
    pushes.push((body.messages && body.messages[0] && body.messages[0].text) || "");
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return realFetch(url, opts);
};

const request = require("supertest");
const app = require("../server");
const { store, save, findDocs } = require("../src/db");
const { taipeiDateString } = require("../src/time");
const settlements = require("../src/routes/settlements");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}
const today = () => taipeiDateString();
async function snap() {
  const rows = await findDocs("daily_settlements", { date: today() });
  return (rows || []).find((r) => !r.test_session) || null;
}
async function wipeSnapshot() {
  await require("../src/db").getDb().collection("daily_settlements").deleteMany({ date: today() });
}
// 영업시간을 켜둔다 — nextOpenAt 이 답을 내야 「다음 영업 5분 전」이 나온다.
// 두 구간 다 정각에 시작하므로 5분을 빼면 늘 :55 다. 시험이 몇 시에 돌든
// 같은 답이 나오게 하려고 이렇게 잡는다.
async function enableHours() {
  store.settings.order_hours = {
    enabled: 1,
    ranges: [{ start: "11:00", end: "14:00" }, { start: "17:00", end: "21:00" }],
    closed_days: [],
    day_ranges: {},
  };
  await save();
}

(async () => {
  const staff = request.agent(app);
  let r = await staff.post("/api/auth/login").send({ password: "ownerpass123" });
  check("로그인된다", r.status === 200, `${r.status}`);

  store.settings.line_notify_enabled = true;
  store.settings.line_channel_access_token = "fake-token";
  store.settings.line_targets = [{ userId: "U_owner", name: "사장님" }];
  await save();

  // 주문을 만드는 동안에는 영업시간을 끈다 — 이 시험이 재는 것은 영업시간이
  // 아니다(test/disable-order-hours.js 주석).
  await require("./disable-order-hours")();
  const item = (store.menuItems || [])[0];
  const table = String((store.tables || []).find((t) => !t.is_counter).number);

  async function placeOrder({ paid }) {
    // 손님 주문에는 영업시간이 걸린다. 이 시험이 재는 것은 영업시간이 아니므로
    // 넣는 동안에는 꺼둔다 — 켠 채로 두면 시험이 몇 시에 도느냐에 따라 403 이
    // 난다(test/disable-order-hours.js 주석).
    await require("./disable-order-hours")();
    const g = request.agent(app);
    await g.put(`/api/tables/${table}/party-size`).send({ adults: 2, children: 0 });
    const res = await g.post("/api/orders").send({
      tableNumber: table,
      items: [{ itemId: item.id, qty: 1, orderType: "dine_in", addons: [] }],
    });
    if (res.status !== 201) throw new Error(`주문 실패 ${res.status} ${JSON.stringify(res.body)}`);
    if (paid) {
      await staff.patch(`/api/orders/${res.body.id}`).send({ status: "paid", paymentMethod: "cash" });
    }
    return res.body.id;
  }

  // ── 1. 미결제가 있으면 마감하지 않는다 ─────────────────────────────
  out.push("\n[미결제가 남아 있으면 마감하지 않는다]");
  await wipeSnapshot();
  await settlements.maybePendingDayClose({}); // 앞 시험의 표가 남아 있지 않게
  delete store.settings[settlements.PENDING_DATE];
  delete store.settings[settlements.PENDING_FORCE_AT];
  await save();

  const paidId = await placeOrder({ paid: true });
  const unpaidId = await placeOrder({ paid: false });
  await enableHours();

  pushes = [];
  r = await staff.get("/api/settlements/cron-close");
  check("크론이 돈다", r.status === 200, `${r.status}`);
  check("★ 마감하지 않고 미뤘다고 답한다", r.body.held === true, JSON.stringify(r.body));
  check("★ 몇 건인지 답한다", r.body.unpaid_count === 1, `${r.body.unpaid_count}`);

  let s = await snap();
  check("★★ day_closed_at 이 찍히지 않는다 — 돈이 남았는데 닫으면 안 된다", !(s && s.day_closed_at), JSON.stringify(s && s.day_closed_at));
  check("미뤘다는 것은 그날 칸에 적는다", !!(s && s.close_held_at), JSON.stringify(s && s.close_held_at));
  check("★ 마감 문자를 보냈다고 적지 않는다 — 아직 안 나갔다", !(s && s.line_day_at), JSON.stringify(s && s.line_day_at));

  // ── 2. 문자가 나가고, 언제까지인지 적혀 있다 ──────────────────────
  out.push("\n[사장님께 알린다]");
  check("★ 문자가 한 통 나간다", pushes.length === 1, `${pushes.length}`);
  const notice = String(pushes[0] || "");
  check("★ 미뤘다고 적는다", /마감을 미뤘습니다/.test(notice), notice.slice(0, 40));
  check("★ 몇 건·얼마인지 적는다", /1건/.test(notice) && /NT\$/.test(notice), notice);
  check("★ 무엇을 하면 되는지 적는다", /오후 정산/.test(notice), notice);
  check(
    "★★ 언제 그대로 마감하는지 적는다 — 「기다립니다」만으로는 아무도 안 본다",
    /까지 그대로면/.test(notice),
    notice
  );

  const forceAt = store.settings[settlements.PENDING_FORCE_AT];
  check("★ 미룸 표가 남는다", store.settings[settlements.PENDING_DATE] === today(), `${store.settings[settlements.PENDING_DATE]}`);
  check("★ 강제 시각은 다음 영업 5분 전 (:55)", /:55:00$/.test(String(forceAt)), String(forceAt));

  // ── 3. 강제 시각 전에는 아무것도 하지 않는다 ─────────────────────
  out.push("\n[강제 시각 전에는 계속 기다린다]");
  pushes = [];
  store.settings[settlements.PENDING_FORCE_AT] = "2999-01-01 10:55:00";
  await save();
  await settlements.maybePendingDayClose({});
  s = await snap();
  check("★ 아직 닫지 않는다", !(s && s.day_closed_at), JSON.stringify(s && s.day_closed_at));
  check("문자도 더 안 보낸다", pushes.length === 0, `${pushes.length}`);

  // ── 4. 미결제가 정리되면 그 자리에서 마감한다 ────────────────────
  out.push("\n[정리되면 기다릴 이유가 없다]");
  await staff.patch(`/api/orders/${unpaidId}`).send({ status: "paid", paymentMethod: "cash" });
  pushes = [];
  await settlements.maybePendingDayClose({});
  s = await snap();
  check("★★ 이제 마감된다", !!(s && s.day_closed_at), JSON.stringify(s && s.day_closed_at));
  check("★ 자동이었다고 표시한다", s && s.day_closed_auto === true, `${s && s.day_closed_auto}`);
  check("★ 마감 문자가 나간다", pushes.length >= 1, `${pushes.length}`);
  check(
    "★ 강제로 닫았다고는 적지 않는다 — 정리되고 닫은 것이다",
    !pushes.some((p) => /그대로 마감했습니다/.test(String(p))),
    pushes.join(" | ").slice(0, 120)
  );
  check("★ 미룸 표는 걷힌다", !store.settings[settlements.PENDING_DATE], `${store.settings[settlements.PENDING_DATE]}`);

  // ── 5. 안 풀려도 강제 시각이 되면 닫는다 ─────────────────────────
  out.push("\n[다음 영업 5분 전이 되면 남아 있어도 닫는다]");
  await wipeSnapshot();
  await placeOrder({ paid: false });
  await enableHours();
  pushes = [];
  r = await staff.get("/api/settlements/cron-close");
  check("다시 미룬다", r.body.held === true, JSON.stringify(r.body));

  // 강제 시각을 지난 것으로 바꿔 놓고 폴링을 한 번 돌린다.
  store.settings[settlements.PENDING_FORCE_AT] = "2000-01-01 10:55:00";
  await save();
  pushes = [];
  await settlements.maybePendingDayClose({});
  s = await snap();
  check("★★ 미결제가 남아 있어도 닫는다", !!(s && s.day_closed_at), JSON.stringify(s && s.day_closed_at));
  check("★ 문자가 나간다", pushes.length >= 1, `${pushes.length}`);
  check(
    "★★ 그대로 닫았다고 적는다 — 매출을 「다 받은 돈」으로 읽으면 안 된다",
    pushes.some((p) => /그대로 마감했습니다/.test(String(p))),
    pushes.join(" | ").slice(-160)
  );
  check("미룸 표는 걷힌다", !store.settings[settlements.PENDING_DATE], `${store.settings[settlements.PENDING_DATE]}`);

  // ── 6. 사람이 먼저 누르면 자동은 비킨다 ──────────────────────────
  out.push("\n[사람이 먼저 누르면 자동은 비킨다]");
  await wipeSnapshot();
  await placeOrder({ paid: false });
  await enableHours();
  await staff.get("/api/settlements/cron-close"); // 미룬다
  check("미룬 상태다", store.settings[settlements.PENDING_DATE] === today(), `${store.settings[settlements.PENDING_DATE]}`);
  pushes = [];
  r = await staff.post("/api/settlements/shift-close").send({ shift: "day" });
  check("사람이 오후 정산을 누른다", r.status === 200, `${r.status}`);
  pushes = [];
  await settlements.maybePendingDayClose({});
  check("★ 자동은 아무것도 하지 않는다", pushes.length === 0, `${pushes.length}`);
  check("★ 미룸 표가 걷힌다", !store.settings[settlements.PENDING_DATE], `${store.settings[settlements.PENDING_DATE]}`);

  // ── 7. 미결제가 없으면 예전처럼 바로 마감한다 (회귀) ─────────────
  out.push("\n[미결제가 없는 날은 그대로 마감한다]");
  await wipeSnapshot();
  // 앞 구간들이 미결제를 남겨뒀다 — 마감해도 미결제는 그대로다(그게 맞다,
  // 받지도 않은 돈을 받은 것으로 적지 않는다). 여기서는 「하나도 없는 날」을
  // 재는 것이므로 먼저 전부 받은 것으로 돌린다.
  const { OPEN } = require("../src/orderStatus");
  for (const o of (store.orders || []).filter((x) => OPEN.includes(x.status))) {
    await staff.patch(`/api/orders/${o.id}`).send({ status: "paid", paymentMethod: "cash" });
  }
  await placeOrder({ paid: true });
  await enableHours();
  pushes = [];
  r = await staff.get("/api/settlements/cron-close");
  check("★ 미루지 않는다", r.body.held !== true, JSON.stringify(r.body));
  check("★ 그 자리에서 마감한다", r.body.auto === true, JSON.stringify(r.body));
  s = await snap();
  check("★ day_closed_at 이 찍힌다", !!(s && s.day_closed_at), "");
  check("★ 문자가 나간다", pushes.length >= 1, `${pushes.length}`);

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log(out.join("\n"));
  console.error(e);
  process.exit(1);
});
