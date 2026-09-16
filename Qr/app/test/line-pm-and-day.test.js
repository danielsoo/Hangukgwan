// 저녁 마감에 두 통이 나가는가 — 오후 것만, 그리고 하루 전체.
//
// 2026-09-16 사장님(LINE 기록 스크린샷 여러 장과 함께): "오전 정산 메세지
// 보내고 오후 정산은 오후 정산만 해서 보내고 하루 전체 정산을 오후 정산
// 끝나고 한 번 더 보내줘."
//
// 예전에는 저녁에 「하루 정산」 한 통만 나갔다. 그 안에 「오전 / 오후」 두
// 줄이 있긴 했지만 **매출과 건수뿐**이라, 저녁 장사만 따로 보려면(결제수단은
// 어땠나, 할인은 얼마나 나갔나, 취소는 몇 건인가) 하루치에서 오전치를 손으로
// 빼야 했다.
//
// 재는 것 넷.
//  1) 하루에 세 통 — 오전 / 오후 / 하루 전체, 그 순서로
//  2) 오후 문자가 **오후 것만** 담는가 (오전 매출이 안 섞였는가)
//  3) 두 문자의 숫자가 서로 맞는가 — 오후 문자의 매출 = 하루 문자의 「오후」 줄
//  4) 오전 정산을 안 누른 날은 오후 문자가 **안** 나가는가 (없는 경계를
//     지어내지 않는다)
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
process.env.SESSION_SECRET = "line-pm-and-day";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";
delete process.env.CRON_SECRET;

// LINE 으로 나가는 요청만 가로챈다.
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
const { store, save, findDocs, saveDoc, saveOrders, getDb } = require("../src/db");
const { taipeiDateString } = require("../src/time");

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
  await getDb().collection("daily_settlements").deleteMany({ date: today() });
}
/** 문자에서 「매출  NT$1,234」 를 숫자로 꺼낸다. */
const revenueOf = (text) => {
  const m = /매출\s+NT\$([\d,]+)/.exec(text || "");
  return m ? Number(m[1].replace(/,/g, "")) : null;
};
/** 하루 문자의 「오후  NT$1,234 · 5건」 줄. */
const pmLineOf = (text) => {
  const m = /오후\s+NT\$([\d,]+)\s*·\s*(\d+)건/.exec(text || "");
  return m ? { revenue: Number(m[1].replace(/,/g, "")), count: Number(m[2]) } : null;
};

(async () => {
  const staff = request.agent(app);
  let r = await staff.post("/api/auth/login").send({ password: "ownerpass123" });
  check("로그인된다", r.status === 200, `${r.status}`);
  await require("./disable-order-hours")();

  store.settings.line_notify_enabled = true;
  store.settings.line_channel_access_token = "fake-token";
  store.settings.line_targets = [{ userId: "U_owner", name: "사장님" }];
  await save();

  const item = store.menuItems.find((m) => m.available && m.price > 0);
  let table = 10;
  async function payOne(qty, paidAt) {
    table++;
    const g = request.agent(app);
    await g.put(`/api/tables/${table}/party-size`).send({ adults: 2, children: 0 });
    const res = await g.post("/api/orders").send({
      tableNumber: String(table),
      items: [{ itemId: item.id, qty, orderType: "dine_in", addons: [] }],
    });
    if (res.status !== 201) throw new Error(`주문 실패 ${res.status} ${JSON.stringify(res.body)}`);
    await staff.patch(`/api/orders/${res.body.id}`).send({ status: "paid", paymentMethod: "cash" });
    const o = store.orders.find((x) => x.id === res.body.id);
    // 시각을 손으로 못 박는다. 안 그러면 오전 결제와 오전 정산이 같은 초에
    // 일어나서, 오전/오후 경계가 시험을 돌릴 때마다 달라진다.
    if (paidAt) {
      o.created_at = paidAt;
      (o.items || []).forEach((it) => { if (it.paid_at) it.paid_at = paidAt; });
      o.updated_at = paidAt;
      // 주문은 자기 컬렉션에 산다 — store 문서만 저장하면 결산이 읽는 쪽은
      // 안 바뀐다(src/db.js ORDERS_COLLECTION).
      await saveOrders([o]);
    }
    return o;
  }

  out.push("[하루에 세 통 — 오전 / 오후 / 하루]");
  await wipeSnapshot();
  pushes = [];

  const amOrder = await payOne(1, `${today()} 12:00:00`);
  r = await staff.post("/api/settlements/shift-close").send({ shift: "am" });
  check("오전 정산이 된다", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  check("★ 오전에 한 통", pushes.length === 1, `${pushes.length}`);
  check("★ 오전 문자다", /🌅 오전 정산/.test(pushes[0]), (pushes[0] || "").slice(0, 40));
  const amText = pushes[0];
  const amRevenue = revenueOf(amText);
  check("오전 매출이 적힌다", amRevenue > 0, `${amRevenue}`);

  // 오전 마감 시각을 못 박는다 — 위와 같은 이유.
  {
    const s = await snap();
    await saveDoc("daily_settlements", { ...s, am_closed_at: `${today()} 14:00:00` });
  }

  const pmOrder = await payOne(3, `${today()} 19:00:00`);
  pushes = [];
  r = await staff.post("/api/settlements/shift-close").send({ shift: "day" });
  check("하루 정산이 된다", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  check("★ 저녁에 두 통", pushes.length === 2, `${pushes.length}`);
  const [pmText, dayText] = pushes;
  check("★ 오후 것이 먼저", /🌆 오후 정산/.test(pmText || ""), (pmText || "").slice(0, 40));
  check("★ 하루 전체가 그 다음", /🌙 하루 정산/.test(dayText || ""), (dayText || "").slice(0, 40));
  if (process.env.SHOW_LINE) {
    console.log("\n──────── 오후 정산 ────────\n" + pmText + "\n──────── 하루 정산 ────────\n" + dayText + "\n───────────────────────────\n");
  }

  out.push("\n[오후 문자는 오후 것만 담는다]");
  const pmRevenue = revenueOf(pmText);
  const dayRevenue = revenueOf(dayText);
  check("★ 오후 매출은 하루 매출보다 적다", pmRevenue > 0 && pmRevenue < dayRevenue, `${pmRevenue} / ${dayRevenue}`);
  check("★ 오전 매출이 안 섞였다", pmRevenue === dayRevenue - amRevenue, `${pmRevenue} vs ${dayRevenue - amRevenue}`);
  check("★ 오후 매출 = 오후 주문값", pmRevenue === pmOrder.total, `${pmRevenue} vs ${pmOrder.total}`);
  check("오전 주문값도 맞다", amRevenue === amOrder.total, `${amRevenue} vs ${amOrder.total}`);
  check(
    "★ 오후 문자에는 「오전 / 오후」 묶음이 없다",
    !/오전 \/ 오후/.test(pmText || ""),
    "그 문자는 이미 오후 것만 담고 있다 — 다시 가를 것이 없다"
  );
  check("★ 하루 문자에는 있다", /오전 \/ 오후/.test(dayText || ""), "");

  out.push("\n[두 문자의 숫자가 서로 맞는다]");
  const pmLine = pmLineOf(dayText);
  check("하루 문자의 「오후」 줄을 찾았다", !!pmLine, (dayText || "").slice(0, 200));
  check(
    "★ 오후 문자의 매출 = 하루 문자의 「오후」 줄",
    pmLine && pmLine.revenue === pmRevenue,
    `${pmLine && pmLine.revenue} vs ${pmRevenue} — 여기가 갈리면 사장님이 두 문자를 대조하다 멈춘다`
  );
  check("★ 건수도 맞는다", pmLine && /결제\s+1건/.test(pmText || ""), `${pmLine && pmLine.count}`);

  out.push("\n[나갔는지 적어둔다]");
  let s = await snap();
  check("★ 오후 문자 기록이 남는다", !!(s && s.line_pm_at), JSON.stringify(s && s.line_pm_at));
  check("★ 보냈다고 적힌다", s && s.line_pm_ok === true, `${s && s.line_pm_ok}`);
  check("오전·하루 기록도 그대로", !!(s && s.line_am_at) && !!(s && s.line_day_at), "");
  check("★ 화면에도 돌려준다", r.body.line_pm && r.body.line_pm.sent === true, JSON.stringify(r.body.line_pm));

  r = await staff.get(`/api/settlements?date=${today()}`);
  const st = r.body.line_status || {};
  check("★ 결산 탭이 셋을 다 본다", !!(st.am && st.pm && st.day), JSON.stringify(st));
  check("오후 것이 보냈다고 온다", st.pm && st.pm.ok === true, JSON.stringify(st.pm));

  out.push("\n[오전 정산을 안 누른 날은 오후 문자가 안 나간다]");
  //
  // 가를 기준이 없다. 없는 경계를 지어내는 것보다 한 통만 보내는 쪽이 낫다
  // — 하루 문자의 「오전 / 오후」 묶음이 같은 조건으로 빠지는 것과 같다.
  await wipeSnapshot();
  await payOne(2, `${today()} 19:30:00`);
  pushes = [];
  r = await staff.post("/api/settlements/shift-close").send({ shift: "day" });
  check("하루 정산이 된다", r.status === 200, `${r.status}`);
  check("★ 한 통만 나간다", pushes.length === 1, `${pushes.length}`);
  check("★ 그 한 통은 하루 전체다", /🌙 하루 정산/.test(pushes[0] || ""), (pushes[0] || "").slice(0, 40));
  check("★ 오후 문자는 안 보냈다고 온다", r.body.line_pm === null, JSON.stringify(r.body.line_pm));
  s = await snap();
  check("기록도 안 남는다", !(s && s.line_pm_at), JSON.stringify(s && s.line_pm_at));

  out.push("\n[테스터 모드에서는 한 통도 안 나간다]");
  await wipeSnapshot();
  pushes = [];
  r = await staff.post("/api/test-mode/start").send({});
  if (r.status === 200) {
    const before = pushes.length;
    r = await staff.post("/api/settlements/shift-close").send({ shift: "day" });
    check("★ 테스트로는 안 보낸다", pushes.length === before, `${pushes.length - before}`);
    check("이유를 돌려준다", r.body.line && r.body.line.error === "test_mode", JSON.stringify(r.body.line));
    check("오후 문자도 없다", r.body.line_pm === null, JSON.stringify(r.body.line_pm));
    await staff.post("/api/test-mode/end").send({});
  } else {
    out.push(`  --   테스터 모드를 못 켰다(${r.status}) — 이 묶음은 건너뜀`);
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
