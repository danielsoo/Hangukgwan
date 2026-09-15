// 오전 정산만 누른 날, 밤 크론이 하루 마감 문자를 보내는가.
//
// 2026-09-15 사장님: "15일 저녁 장사 마치고 보니까 정산이 되어있는 거 같은데
// line으로는 안오네?"
//
// 크론(21:30)은 "오늘 사람이 마감했으면 같은 내용을 한 번 더 보내지 않는다"는
// 규칙을 갖고 있었다. 그런데 그 판단을 last_shift_closed_at 으로 했다 —
// **오전 정산을 눌러도 찍히는 값이다.** 그래서 오전만 누르고 저녁에 안 누른
// 날은 크론이 그날 결산은 만들면서 문자는 건너뛰었다. 사장님 눈에는
// 「정산은 되어 있는데 LINE 은 안 온 날」이 된다. 저녁 매출을 아무도 문자로
// 못 받는다.
//
// 이제 보는 것은 day_closed_at — 하루 정산을 눌렀을 때만 찍힌다.
//
// 그리고 나갔는지 안 나갔는지를 그날 칸에 적는다. 이번에 원인을 찾을 때
// 기록이 하나도 없어서 코드를 거꾸로 읽어야 했다.
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
process.env.SESSION_SECRET = "line-cron-am-only";
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
const { store, save, findDocs } = require("../src/db");
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
  const db = require("../src/db").getDb();
  await db.collection("daily_settlements").deleteMany({ date: today() });
}

(async () => {
  const staff = request.agent(app);
  let r = await staff.post("/api/auth/login").send({ password: "ownerpass123" });
  check("로그인된다", r.status === 200, `${r.status}`);
  await require("./disable-order-hours")();

  store.settings.line_notify_enabled = true;
  store.settings.line_channel_access_token = "fake-token";
  store.settings.line_targets = [{ userId: "U_owner", name: "사장님" }];
  await save();

  out.push("\n[오전 정산만 누른 날]");
  pushes = [];
  await wipeSnapshot();
  r = await staff.post("/api/settlements/shift-close").send({ shift: "am" });
  check("오전 정산이 된다", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  check("오전 문자가 나간다", pushes.length === 1, `${pushes.length}`);
  let s = await snap();
  check("★ 오전만 눌렀으면 day_closed_at 이 없다", !!s && !s.day_closed_at, JSON.stringify(s && s.day_closed_at));
  check("오전 시각은 찍힌다", !!(s && s.am_closed_at), "");

  pushes = [];
  r = await staff.get("/api/settlements/cron-close");
  check("크론이 돈다", r.status === 200, `${r.status}`);
  check("★ 저녁 마감 문자가 나간다 — 예전에는 여기서 건너뛰었다", pushes.length === 1, `${pushes.length}`);
  check("건너뛰었다고 보고하지 않는다", r.body.line_skipped === false, JSON.stringify(r.body));

  out.push("\n[하루 정산을 누른 날 — 두 번 보내지 않는다]");
  pushes = [];
  await wipeSnapshot();
  r = await staff.post("/api/settlements/shift-close").send({ shift: "day" });
  check("하루 정산이 된다", r.status === 200, `${r.status}`);
  check("하루 문자가 나간다", pushes.length === 1, `${pushes.length}`);
  s = await snap();
  check("★ day_closed_at 이 찍힌다", !!(s && s.day_closed_at), "");

  pushes = [];
  r = await staff.get("/api/settlements/cron-close");
  check("★ 크론은 조용하다 — 같은 내용을 두 번 보내지 않는다", pushes.length === 0, `${pushes.length}`);
  check("건너뛰었다고 보고한다", r.body.line_skipped === true, JSON.stringify(r.body));

  out.push("\n[나갔는지 안 나갔는지를 적어둔다]");
  s = await snap();
  check("★ 하루 문자 기록이 남는다", !!(s && s.line_day_at), JSON.stringify(s && s.line_day_at));
  check("★ 보냈다고 적힌다", s && s.line_day_ok === true, `${s && s.line_day_ok}`);

  pushes = [];
  await wipeSnapshot();
  store.settings.line_notify_enabled = false;
  await save();
  r = await staff.post("/api/settlements/shift-close").send({ shift: "day" });
  check("알림이 꺼져 있어도 정산 자체는 된다", r.status === 200, `${r.status}`);
  check("문자는 안 나간다", pushes.length === 0, `${pushes.length}`);
  check("화면에 이유를 돌려준다", r.body.line && r.body.line.error === "disabled", JSON.stringify(r.body.line));
  s = await snap();
  check("★ 안 보냈다고 적힌다", s && s.line_day_ok === false, `${s && s.line_day_ok}`);
  check("★ 왜 안 보냈는지도 적힌다", s && s.line_day_error === "disabled", `${s && s.line_day_error}`);

  out.push("\n[결산 화면이 그 기록을 본다]");
  r = await staff.get(`/api/settlements?date=${today()}`);
  check("결산을 읽는다", r.status === 200, `${r.status}`);
  check("★ 하루를 볼 때 line_status 를 준다", !!(r.body.line_status && r.body.line_status.day), JSON.stringify(r.body.line_status));
  const dayStatus = (r.body.line_status && r.body.line_status.day) || null;
  check("★ 안 갔다는 것과 이유가 같이 온다", !!dayStatus && dayStatus.ok === false && dayStatus.error === "disabled", JSON.stringify(dayStatus));
  r = await staff.get(`/api/settlements?start=2026-01-01&end=${today()}`);
  check("기간을 여러 날로 잡으면 안 준다 — 어느 날인지 답할 수 없다", r.body.line_status == null, JSON.stringify(r.body.line_status));

  out.push("\n[화면에 한 줄로 보인다]");
  const fs = require("fs");
  const path = require("path");
  const adminJs = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
  const adminHtml = fs.readFileSync(path.join(__dirname, "../public/admin.html"), "utf8");
  check("자리가 있다", /id="settlementLineNote"/.test(adminHtml), "");
  check("★ 결산을 그릴 때 같이 그린다", /renderSettlementLineNote\(data\)/.test(adminJs), "");
  check("★ 안 간 이유를 사장님 말로 옮긴다", /lineWhyDisabled/.test(adminJs) && /lineWhyNoTargets/.test(adminJs), "");
  for (const k of ["lineShiftAm", "lineShiftDay", "lineSentAt", "lineNotSent"]) {
    check(`${k} 가 한국어/중국어 둘 다 있다`, adminJs.split(`${k}:`).length - 1 >= 2, "");
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
