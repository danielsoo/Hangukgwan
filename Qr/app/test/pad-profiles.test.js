// 패드 프로필 — 「이 패드는 주방이다」를 한 번 고르면 프린터·자동 인쇄가 따라오고,
// 터치 수는 프로필마다 센다.
//
// 사장님(2026-09-29): "패드 프로필을 만들어줘. 여러명이 한 프로필 들어가도
// 되니까. 그냥 해당 프로필의 ip 와 프린터기 그것 때문에 있으면 좋겠다고 느낀
// 거야 / 그리고 얼마나 많은 터치 이벤트가 있는지도 프로필 별로 알 수도 있을 것
// 같고."
//
// 화면 쪽은 test/e2e-pad-profile.js 가 브라우저로 잰다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};

process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "pad-profiles";
process.env.ADMIN_PASSWORD = "ownerpass123";

const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../server");
const { store } = require("../src/db");
const padProfiles = require("../src/padProfiles");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

(async () => {
  await request(app).get("/api/menu");
  const boss = request.agent(app);
  await boss.post("/api/auth/login").send({ password: "ownerpass123" });
  let r = await boss.put("/api/settings/printers").send({
    printers: [{ name: "주방 프린터", ip: "192.168.111.142" }, { name: "카운터 프린터", ip: "192.168.111.150" }],
  });
  const [kp, cp] = r.body.printers;

  out.push("[프로필 저장]");
  r = await boss.put("/api/settings/pad-profiles").send({
    profiles: [
      { name: "주방", printerId: kp.id, autoPrint: true },
      { name: "카운터", printerId: cp.id, autoPrint: true },
      { name: "사장님 폰", printerId: "없는프린터", autoPrint: false },
    ],
  });
  check("저장된다", r.status === 200 && r.body.profiles.length === 3, JSON.stringify(r.body));
  const [kitchen, counter, phone] = r.body.profiles;
  check("번호가 붙는다", r.body.profiles.every((p) => p.id), "");
  check("★ 프로필이 프린터를 가리킨다", kitchen.printerId === kp.id && counter.printerId === cp.id, JSON.stringify(r.body.profiles));
  check("목록에 없는 프린터는 「그대로」(null)", phone.printerId === null, JSON.stringify(phone));
  check("자동 인쇄 켜기/끄기가 남는다", kitchen.autoPrint === true && phone.autoPrint === false, "");
  check("★ store 를 통째로 안 쓴다", /saveFields\(\{ "settings\.pad_profiles"/.test(fs.readFileSync(path.join(__dirname, "../src/routes/settings.js"), "utf8")), "");

  r = await boss.put("/api/settings/pad-profiles").send({ profiles: [{ name: "", printerId: kp.id }] });
  check("이름 없는 프로필은 거절", r.status === 400, `${r.status}`);
  r = await boss.put("/api/settings/pad-profiles").send({ profiles: [{ id: "none", name: "가짜" }] });
  check("「none」(프로필 없음) 번호는 못 쓴다", r.status === 200 && r.body.profiles[0].id !== "none", JSON.stringify(r.body));
  // 되돌린다
  r = await boss.put("/api/settings/pad-profiles").send({ profiles: [kitchen, counter, phone] });
  check("번호를 그대로 들고 다시 저장하면 번호가 안 바뀐다", r.body.profiles.map((p) => p.id).join() === [kitchen, counter, phone].map((p) => p.id).join(), "");

  r = await request(app).get("/api/settings/pad-profiles");
  check("로그인 안 하면 못 본다", r.status === 401 || r.status === 403, `${r.status}`);
  r = await boss.get("/api/settings/pad-profiles");
  check("로그인하면 본다", r.status === 200 && r.body.profiles.length === 3, "");

  out.push("\n[터치 수 — 프로필마다]");
  // 두 패드가 같은 「주방」 프로필 — 더해진다.
  await boss.post("/api/settings/pad-touches").send({ profileId: kitchen.id, count: 30 });
  await boss.post("/api/settings/pad-touches").send({ profileId: kitchen.id, count: 12 });
  await boss.post("/api/settings/pad-touches").send({ profileId: counter.id, count: 5 });
  await boss.post("/api/settings/pad-touches").send({ profileId: "none", count: 2 });
  r = await boss.post("/api/settings/pad-touches").send({ profileId: kitchen.id, count: 0 });
  check("0 은 거절", r.status === 400, `${r.status}`);
  r = await boss.post("/api/settings/pad-touches").send({ profileId: kitchen.id, count: "abc" });
  check("숫자가 아니면 거절", r.status === 400, `${r.status}`);
  r = await request(app).post("/api/settings/pad-touches").send({ profileId: kitchen.id, count: 3 });
  check("로그인 안 하면 못 보낸다", r.status === 401 || r.status === 403, `${r.status}`);
  // 지운 프로필을 아직 들고 있는 패드 — 버리지 않고 「프로필 없음」으로.
  await boss.post("/api/settings/pad-touches").send({ profileId: "pp_deleted", count: 1 });
  // 이상하게 큰 값 — 한 번에 들어가는 양을 막는다.
  await boss.post("/api/settings/pad-touches").send({ profileId: counter.id, count: 1e9 });

  r = await boss.get("/api/settings/pad-touches");
  const row = (id) => (r.body.rows || []).find((x) => x.profile === id) || {};
  check("★★ 같은 프로필의 두 패드가 더해진다(30+12)", row(kitchen.id).today === 42 && row(kitchen.id).week === 42, JSON.stringify(r.body));
  check("★ 프로필 없는 기기도 센다(2 + 지운 프로필 1)", row("none").today === 3, JSON.stringify(row("none")));
  check("한 번에 너무 큰 값은 잘린다", row(counter.id).today === 5 + padProfiles.MAX_TOUCHES_PER_POST, JSON.stringify(row(counter.id)));
  check("최근 7일 날짜를 준다", Array.isArray(r.body.days) && r.body.days.length === 7 && r.body.days[0] === r.body.today, JSON.stringify(r.body.days));

  // 7일 안 / 밖 — 날짜 글자로 센다.
  const { getDb } = require("../src/db");
  const days = padProfiles.daysBack(r.body.today, 8);
  await getDb().collection(padProfiles.COLLECTION).updateOne(
    { _id: `${days[6]}|${kitchen.id}` }, { $inc: { count: 100 }, $set: { day: days[6], profile: kitchen.id } }, { upsert: true });
  await getDb().collection(padProfiles.COLLECTION).updateOne(
    { _id: `${days[7]}|${kitchen.id}` }, { $inc: { count: 1000 }, $set: { day: days[7], profile: kitchen.id } }, { upsert: true });
  r = await boss.get("/api/settings/pad-touches");
  check("★ 6일 전은 7일에 들어가고 오늘에는 안 들어간다", row(kitchen.id).week === 142 && row(kitchen.id).today === 42, JSON.stringify(row(kitchen.id)));
  check("7일 전은 빠진다", row(kitchen.id).week < 1000, "");
  check("날짜 거꾸로 세기 — 달이 바뀌어도", padProfiles.daysBack("2026-10-02", 3).join() === "2026-10-02,2026-10-01,2026-09-30", "");

  out.push("\n[터치 수는 store 문서에 안 쌓인다]");
  check("★ store.settings 에 터치 수가 없다", !JSON.stringify(store.settings).includes("touch"), "");

  out.push("\n[테스터 모드 종료가 프로필을 되돌리지 않는다]");
  check("SNAPSHOT_SKIP 에 pad_profiles", /SNAPSHOT_SKIP = new Set\(\[[^\]]*"pad_profiles"/.test(fs.readFileSync(path.join(__dirname, "../src/testMode.js"), "utf8")), "");

  out.push("\n[화면 — 소스]");
  const adminJs = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
  check("프로필은 기기에 남는다(계정이 아니다)", /localStorage\.setItem\(PAD_PROFILE_KEY/.test(adminJs), "");
  check("★ 프로필이 정한 프린터를 앱에 적는다", /bridge\.setPrinter\(printer\.ip, printer\.port\)/.test(adminJs), "");
  check("★ 프린터를 못 바꾸면 말한다", /padProfilePrinterNeedsUpdate/.test(adminJs), "");
  check("★ 터치는 모아서 보낸다 — 누를 때마다가 아니라", /padTouchCount\+\+/.test(adminJs) && /await flushPadTouches\(\);\s*\n\s*\}, 60000\);/.test(adminJs), "");
  check("프로필을 고르면 「자동 인쇄 중」 이름이 프로필이 된다", /const prof = myPadProfile\(\);\s*\n\s*if \(prof\) return prof\.name;/.test(adminJs), "");
  // ko / zh 둘 다 있는가
  for (const k of ["padProfilesTitle", "padProfilePickTitle", "padProfileNone", "padTouchesTitle", "padTouchesNone", "padProfilePrinterNeedsUpdate"]) {
    const n = (adminJs.match(new RegExp(`\\b${k}:`, "g")) || []).length;
    check(`i18n ${k} 한국어·중국어`, n === 2, `${n}`);
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
