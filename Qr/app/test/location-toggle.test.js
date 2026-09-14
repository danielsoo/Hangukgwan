// 위치 확인을 켜고 끌 수 있다 — 실제로.
//
// 사장님(2026-09-10): "위치 기반을 on off 할 수 있게도 해줘."
//
// 사장님(2026-09-14): "위치기반 주문제한 해제를 누르고, 밑에 설정저장을
// 누르면 저장되었습니다. 문구 표시됨. 그런데, 새로고침을 하거나 다른 곳에
// 다녀오면, 도로 제자리로 돌아가서 위치기반주문제한이 사용된다고 체크박스에
// 체크돼 있어요."
//
// ── 이 시험을 다시 쓴 이유 ────────────────────────────────────────────
//
// 예전 이 파일은 전부 **코드 글자만 보는 검사**였다. "orders.js 안에
// `=== false` 라고 적혀 있는가" 같은 것들. 그래서 기능이 통째로 죽어 있는
// 동안에도 전부 통과했다 — 적혀 있는 그 줄이 바로 고장이었기 때문이다.
//
// 저장 코드가 받은 값을 String() 으로 감싸서 false 가 글자 "false" 로
// 저장됐고, 읽는 쪽의 `!== false` 가 전부 「켜짐」으로 답했다. 체크박스가
// 되돌아가는 것은 눈에 보이는 부분일 뿐이고, 진짜 문제는 껐다고 믿은 위치
// 제한이 손님 주문을 계속 막고 있었다는 것이다.
//
// 그래서 글자 대신 **왕복**을 잰다. 꺼서 저장하고, 다시 받아보고, 정말로
// 멀리서 주문이 되는지 본다. 화면 쪽만 코드 검사로 남긴다(브라우저 없이
// 돌릴 수 있는 시험이라 그 부분은 e2e-open-hours 계열의 몫이다).
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
process.env.SESSION_SECRET = "location-toggle";
process.env.ADMIN_PASSWORD = "ownerpass123";
process.env.OWNER_EMAIL = "boss@hangukgwan.tw";

const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../server");
const { store, save } = require("../src/db");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}
const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

// 가게(신주 죽북)와, 걸어서는 못 가는 먼 곳.
const STORE = { lat: 24.8387, lng: 121.0177 };
const FAR = { lat: 25.0330, lng: 121.5654 }; // 타이베이 101 — 60km 밖

const TABLE = "7";

(async () => {
  const staff = request.agent(app);
  await staff.post("/api/auth/login").send({ password: "ownerpass123" });
  await require("./disable-order-hours")();
  const itemId = store.menuItems[0].id;

  // 자리에 손님이 앉아 있어야 주문이 된다.
  const guest = request.agent(app);
  await guest.put(`/api/tables/${TABLE}/party-size`).send({ adults: 2, children: 0 });

  const orderFar = () =>
    guest.post("/api/orders").send({
      tableNumber: TABLE,
      items: [{ itemId, qty: 1, orderType: "dine_in", addons: [] }],
      lat: FAR.lat,
      lng: FAR.lng,
    });
  const settingsNow = async () => (await guest.get("/api/settings")).body.location_check_enabled;

  out.push("[가게 위치를 잡는다]");
  let r = await staff.put("/api/settings").send({
    store_lat: String(STORE.lat),
    store_lng: String(STORE.lng),
    order_radius_m: "200",
    location_check_enabled: true,
  });
  check("저장된다", r.status === 200, `${r.status}`);
  check("켜진 것으로 돌아온다", (await settingsNow()) === true, String(await settingsNow()));

  r = await orderFar();
  check("★ 켜져 있으면 멀리서 온 주문은 막힌다", r.status === 403 && r.body.error === "out_of_range", `${r.status} ${JSON.stringify(r.body)}`);

  out.push("\n[끈다 — 사장님이 겪은 그 자리]");
  r = await staff.put("/api/settings").send({ location_check_enabled: false });
  check("저장된다", r.status === 200, `${r.status}`);
  check("★ 저장 응답이 「꺼짐」이다", r.body.location_check_enabled === false, JSON.stringify(r.body.location_check_enabled));
  // 새로고침 = /api/settings 를 새로 받는 것.
  check("★ 새로고침해도 꺼져 있다", (await settingsNow()) === false, String(await settingsNow()));
  check("★ 저장된 값이 참/거짓이다 (글자 \"false\" 가 아니다)", store.settings.location_check_enabled === false, JSON.stringify(store.settings.location_check_enabled));

  r = await orderFar();
  check("★ 껐으면 멀리서도 주문이 들어간다", r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);

  out.push("\n[다시 켠다]");
  r = await staff.put("/api/settings").send({ location_check_enabled: true });
  check("켜진 것으로 돌아온다", (await settingsNow()) === true, String(await settingsNow()));
  r = await orderFar();
  check("★ 다시 막힌다", r.status === 403 && r.body.error === "out_of_range", `${r.status}`);

  out.push("\n[이미 저장돼 있는 글자 \"false\"]");
  // 이 고장이 있는 동안 사장님이 껐으면 데이터베이스에는 글자로 들어가 있다.
  // 고친 뒤에 그 값도 「꺼짐」으로 읽혀야 한다 — 안 그러면 사장님은 고쳤다는
  // 말을 듣고도 여전히 켜져 있는 화면을 본다.
  store.settings.location_check_enabled = "false";
  await save();
  check("★ 글자 \"false\" 도 꺼짐으로 읽는다", (await settingsNow()) === false, String(await settingsNow()));
  r = await orderFar();
  check("★ 글자 \"false\" 여도 주문이 들어간다", r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);

  out.push("\n[한 번도 저장한 적 없으면 켜진 것으로 본다]");
  delete store.settings.location_check_enabled;
  await save();
  check("켜짐으로 읽는다", (await settingsNow()) === true, String(await settingsNow()));
  r = await orderFar();
  check("막힌다", r.status === 403, `${r.status}`);

  out.push("\n[손님 화면 — 꺼져 있으면 아무것도 안 묻고, 안 기다린다]");
  //
  // 2026-09-14 사장님: "위치는 그냥 잡지 말자 그거때문에 고객이 기다릴 이유는
  // 없는 거 같아." — 그리고 "설정에서 키고 끄는 게 있잖아 그거 사용하자."
  //
  // 그러니 이 스위치를 끈 상태가 곧 사장님이 원하신 상태다. 껐을 때 정말로
  // **묻지도 않고 기다리지도 않는지**를 실제 코드로 확인한다. 서버만
  // 통과시키고 화면은 그대로 물어보면, 손님은 권한 창을 보고 잡히기를 기다린
  // 뒤 아무 쓸모 없는 좌표를 보낸다.
  const orderJs = read("public", "js", "order.js");
  check("★ 꺼져 있으면 가게 좌표를 아예 안 들고 온다", /const locationOn = s\.location_check_enabled[\s\S]{0,300}storeLat = !locationOn/.test(orderJs), "");
  check("옛 서버가 내려준 글자도 꺼짐으로 읽는다", /s\.location_check_enabled !== "false"/.test(orderJs), "");
  {
    // 가게 좌표가 없는 상태 = 스위치가 꺼진 상태다(위 한 줄이 그렇게 만든다).
    const helpers = orderJs.slice(
      orderJs.indexOf("  let warmGeoAt = 0;"),
      orderJs.indexOf("  function setSubmitBusy(on) {")
    );
    check("위치 헬퍼를 찾는다", helpers.length > 200, `${helpers.length}자`);
    let asked = 0;
    const api = new Function(
      "getGeolocation", "storeLat", "storeLng",
      `${helpers}
       return { warmGeolocation, locationOrNothing };`
    )(() => { asked++; return new Promise(() => {}); }, null, null);

    api.warmGeolocation();
    const t0 = Date.now();
    const coords = await api.locationOrNothing();
    const waited = Date.now() - t0;
    check("★ 손님 폰에 위치를 아예 안 묻는다 (권한 창도 안 뜬다)", asked === 0, `${asked}번 물었다`);
    check("★ 기다림이 없다", waited < 50, `${waited}ms`);
    check("좌표 없이 보낸다", coords === null, JSON.stringify(coords));
  }

  out.push("\n[관리자 화면]");
  const adminJs = read("public", "js", "admin.js");
  const adminHtml = read("public", "admin.html");
  check("스위치가 있다", /id="s_location_check_enabled"/.test(adminHtml), "");
  check("저장할 때 같이 보낸다", (adminJs.match(/location_check_enabled: \$\("#s_location_check_enabled"\)\.checked/g) || []).length >= 2, "");
  check("열 때 지금 값이 찍힌다", /\$\("#s_location_check_enabled"\)\.checked = locOn;/.test(adminJs), "");
  check("껐다는 것이 저장 전에도 바로 보인다", /\$\("#s_location_check_enabled"\)\.onchange/.test(adminJs), "");
  check("두 언어 모두 있다", /labelLocationCheckEnabled: "위치 확인 사용"/.test(adminJs) && /labelLocationCheckEnabled: "啟用位置確認"/.test(adminJs), "");

  out.push("\n[묻는 자리는 한 곳이다]");
  // 같은 질문을 여러 군데서 각자 비교하면 이번 같은 일이 또 난다. 읽는 곳은
  // src/locationGate.js 하나여야 한다.
  for (const f of [["src", "routes", "orders.js"], ["src", "routes", "settings.js"]]) {
    const src = read(...f);
    check(
      `${f[f.length - 1]} 가 직접 비교하지 않는다`,
      !/settings\.location_check_enabled\s*[!=]==/.test(src),
      "locationGate.isOn() 을 쓰세요"
    );
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
