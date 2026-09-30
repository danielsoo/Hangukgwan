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

  out.push("\n[패드를 알아본다 — 어느 기기가 어느 프로필인지]");
  // 2026-09-29 사장님: "저 프로필이랑 패드랑 인식을 하는거야? 인식을 못하면 저걸 하는 의미가 없잖아."
  r = await boss.post("/api/settings/pad-seen").send({ deviceId: "dKitchenPad", profileId: kitchen.id, kind: "app", printer: "192.168.111.142:9100", canSetPrinter: true, autoPrint: true });
  check("알린다", r.status === 200, `${r.status}`);
  await boss.post("/api/settings/pad-seen").send({ deviceId: "dKitchenPad", profileId: kitchen.id, kind: "app", printer: "192.168.111.150:9100", canSetPrinter: true, autoPrint: true });
  await boss.post("/api/settings/pad-seen").send({ deviceId: "dPhone", profileId: "pp_gone", kind: "phone" });
  r = await boss.post("/api/settings/pad-seen").send({ deviceId: "bad id!", profileId: kitchen.id });
  check("이상한 기기 번호는 거절", r.status === 400, `${r.status}`);
  r = await boss.post("/api/settings/pad-seen").send({ deviceId: "dX", printer: "1.2.3.4:9100; rm", kind: "hacker" });
  r = await boss.get("/api/settings/pad-devices");
  const dev = (id) => (r.body.devices || []).find((d) => d.id === id) || {};
  check("★★ 같은 기기는 한 줄 — 마지막 알림으로 덮인다", (r.body.devices || []).filter((d) => d.id === "dKitchenPad").length === 1 && dev("dKitchenPad").printer === "192.168.111.150:9100", JSON.stringify(r.body.devices));
  check("★ 어느 프로필인지 안다", dev("dKitchenPad").profile === kitchen.id, JSON.stringify(dev("dKitchenPad")));
  check("지운 프로필이면 「프로필 없음」", dev("dPhone").profile === "none", JSON.stringify(dev("dPhone")));
  check("이상한 프린터 주소·종류는 안 받는다", dev("dX").printer === null && dev("dX").kind === "pc", JSON.stringify(dev("dX")));
  check("방금 본 기기", dev("dKitchenPad").ago_ms != null && dev("dKitchenPad").ago_ms < 60000, JSON.stringify(dev("dKitchenPad")));
  r = await request(app).get("/api/settings/pad-devices");
  check("로그인 안 하면 못 본다", r.status === 401 || r.status === 403, `${r.status}`);

  out.push("\n[앱을 다시 깔아도 자리를 기억한다 — 서버가 기기 번호로]");
  // 2026-09-29 사장님: 앱을 지웠다 다시 깔거나 앱 데이터를 지우면 패드가 잊어버리던 것.
  const seen = (b) => boss.post("/api/settings/pad-seen").send({ kind: "app", ...b });
  r = await seen({ deviceId: "aLenovo1", profileId: counter.id, chose: true, rev: 0, model: "LENOVO TB-X606F" });
  check("패드에서 고르면 rev 1", r.body.profileId === counter.id && r.body.rev === 1, JSON.stringify(r.body));
  r = await seen({ deviceId: "aLenovo1", profileId: counter.id, rev: 1 });
  check("그냥 알리면 그대로", r.body.profileId === counter.id && r.body.rev === 1, JSON.stringify(r.body));
  // 다시 깔았다 — 패드는 아무것도 모른다(프로필 없음, rev 0).
  r = await seen({ deviceId: "aLenovo1", profileId: "", rev: 0 });
  check("★★ 다시 깐 패드에 서버가 「카운터」를 돌려준다", r.body.profileId === counter.id && r.body.rev === 1, JSON.stringify(r.body));
  // 앱 데이터를 지웠는데 누가 첫 창에서 「주방」을 눌렀다 — 그건 새 결정이다.
  r = await seen({ deviceId: "aLenovo1", profileId: kitchen.id, chose: true, rev: 1 });
  check("패드에서 새로 고르면 그게 이긴다(rev 2)", r.body.profileId === kitchen.id && r.body.rev === 2, JSON.stringify(r.body));
  // 옛 판 패드가 rev 없이 들고 있는 값을 보내도 서버의 더 새 결정을 안 덮는다.
  r = await seen({ deviceId: "aLenovo1", profileId: counter.id, rev: 1 });
  check("★ 옛 값이 새 결정을 덮지 않는다", r.body.profileId === kitchen.id && r.body.rev === 2, JSON.stringify(r.body));

  out.push("\n[사장님이 설정 화면에서 「이 패드 = 카운터」로 옮긴다]");
  r = await boss.put("/api/settings/pad-devices/aLenovo1").send({ profileId: counter.id });
  check("옮겨진다(rev 3)", r.status === 200 && r.body.profileId === counter.id && r.body.rev === 3, JSON.stringify(r.body));
  r = await seen({ deviceId: "aLenovo1", profileId: kitchen.id, rev: 2 });
  check("★★ 패드가 다음에 알릴 때 「카운터」를 받는다", r.body.profileId === counter.id && r.body.rev === 3, JSON.stringify(r.body));
  r = await boss.put("/api/settings/pad-devices/nobody").send({ profileId: counter.id });
  check("없는 기기는 거절", r.status === 400, `${r.status}`);
  r = await boss.put("/api/settings/pad-devices/aLenovo1").send({ profileId: "" });
  check("빈 프로필은 거절", r.status === 400, `${r.status}`);
  r = await request(app).put("/api/settings/pad-devices/aLenovo1").send({ profileId: counter.id });
  check("로그인 안 하면 못 옮긴다", r.status === 401 || r.status === 403, `${r.status}`);
  r = await boss.get("/api/settings/pad-devices");
  const len = (r.body.devices || []).find((d) => d.id === "aLenovo1") || {};
  check("★ 기기 모델 이름이 남는다", len.model === "LENOVO TB-X606F", JSON.stringify(len));

  out.push("\n[이 기능 전에 고른 패드도 다시 깔았을 때 돌아온다]");
  // rev 없이 저장된 옛 기록
  await require("../src/db").getDb().collection(padProfiles.DEVICES_COLLECTION).updateOne(
    { _id: "aOld" }, { $set: { profile: kitchen.id, kind: "app" } }, { upsert: true });
  r = await seen({ deviceId: "aOld", profileId: kitchen.id, rev: 0 });
  check("알리면 rev 1 로 올라간다", r.body.rev === 1, JSON.stringify(r.body));
  r = await seen({ deviceId: "aOld", profileId: "", rev: 0 });
  check("★ 그 뒤 다시 깔면 돌아온다", r.body.profileId === kitchen.id, JSON.stringify(r.body));

  out.push("\n[터치 수는 store 문서에 안 쌓인다]");
  check("★ store.settings 에 터치 수가 없다", !JSON.stringify(store.settings).includes("touch"), "");

  out.push("\n[테스터 모드 종료가 프로필을 되돌리지 않는다]");
  check("SNAPSHOT_SKIP 에 pad_profiles", /SNAPSHOT_SKIP = new Set\(\[[^\]]*"pad_profiles"/.test(fs.readFileSync(path.join(__dirname, "../src/testMode.js"), "utf8")), "");

  out.push("\n[화면 — 소스]");
  const adminJs = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
  check("프로필은 기기에 남는다(계정이 아니다)", /localStorage\.setItem\(PAD_PROFILE_KEY/.test(adminJs), "");
  check("★ 프로필이 정한 프린터를 앱에 적는다", /bridge\.setPrinter\(printer\.ip, printer\.port\)/.test(adminJs), "");
  check("★ 프린터를 못 바꾸면 말한다", /padProfilePrinterNeedsUpdate/.test(adminJs), "");
  check("★ 터치는 모아서 보낸다 — 누를 때마다가 아니라", /padTouchCount\+\+/.test(adminJs) && /await flushPadTouches\(\);\s*\n\s*await refreshPadConfigQuietly\(\);\s*\n\s*await reportPadSeen\(\);\s*\n\s*\}, 60000\);/.test(adminJs), "");
  check("프로필을 고르면 「자동 인쇄 중」 이름이 프로필이 된다", /const prof = myPadProfile\(\);\s*\n\s*if \(prof\) return prof\.name;/.test(adminJs), "");
  check("★ 📍 는 잠겨 있다 — 누르면 풀지 먼저 묻는다", /showConfirm\(T\("padProfileUnlockConfirm"\)/.test(adminJs), "");
  const java = fs.readFileSync(path.join(__dirname, "../../../kiosk-app/src/tw/hangukgwan/kiosk/MainActivity.java"), "utf8");
  check("★ 앱 1.6 이 기기 번호를 준다(ANDROID_ID)", /@JavascriptInterface\s+public String deviceId\(\)/.test(java) && /Settings\.Secure\.ANDROID_ID/.test(java), "");
  check("앱이 모델 이름을 준다", /public String deviceModel\(\)/.test(java), "");
  check("★ 화면이 앱의 기기 번호를 쓴다", /bridge\.deviceId\(\)/.test(adminJs), "");
  const build = fs.readFileSync(path.join(__dirname, "../../../kiosk-app/build.sh"), "utf8");
  check("앱 판 1.6", /VERSION_NAME:-1\.6/.test(build) && /VERSION_CODE:-7/.test(build), "");
  // 2026-09-30 사장님: "설치 할 때 입력한 IP 192.168.111.142 프린터 정보를 그대로 사용하는 듯"
  const ensureFn = adminJs.slice(adminJs.indexOf("function ensureProfilePrinter("), adminJs.indexOf("function profilePrinter()"));
  check("★★ 프로필이 정한 프린터로 앱을 맞춘다", /bridge\.setPrinter\(want\.ip, want\.port\)/.test(ensureFn), "");
  const sendFn = adminJs.slice(adminJs.indexOf("async function sendRasterTicketParts("), adminJs.indexOf("async function sendRasterTicketParts(") + 600);
  check("★★ 찍기 직전마다 맞춘다(앱에 남은 옛 IP 로 안 나간다)", sendFn.indexOf("ensureProfilePrinter(bridge)") > 0 && sendFn.indexOf("ensureProfilePrinter(bridge)") < sendFn.indexOf("bridge.printBase64("), "");
  check("모든 앱 인쇄 자리에서 맞춘다", (adminJs.match(/ensureProfilePrinter\(bridge\);\s*\n\s*const r(esult)? = bridge\.printBase64\(/g) || []).length === 3, "");
  check("화면을 열 때도 맞춘다", /await askPadProfileIfNeeded\(\);[\s\S]{0,200}ensureProfilePrinter\(\)/.test(adminJs), "");
  check("★ 프로필이 정했으면 「이 기기 프린터」 칸은 잠긴다", /sel\.disabled = !canSet \|\| !!byProfile;/.test(adminJs), "");
  // ko / zh 둘 다 있는가
  for (const k of ["padProfilesTitle", "padProfilePickTitle", "padProfileNone", "padTouchesTitle", "padTouchesNone", "padProfilePrinterNeedsUpdate", "padProfileUnlockConfirm", "printerPickByProfile"]) {
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
