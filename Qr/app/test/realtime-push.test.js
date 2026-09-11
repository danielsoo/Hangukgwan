// 바뀐 것이 다른 화면에 **바로** 가는가.
//
// 사장님(2026-09-11): "현재 뭐가 바뀌거나 인원이 추가되거나 메뉴가
// 추가되거나 그게 바로바로 반영이 안되고 새로고침을 해야 바뀌어있어. ...
// 새 주문이 들어오면 화면에 뜨기까지 한 6~7초 딜레이도 있고."
//
// ── 두 가지를 잰다 ──────────────────────────────────────────────────
//
//   1. **알림이 응답보다 먼저 나간다.** 예전에는 trigger 를 던져만 놓고
//      곧바로 응답했다. 보통 서버라면 괜찮지만 서버리스는 응답을 내보내는
//      순간 인스턴스를 얼려서, 아직 안 끝난 Pusher 요청이 그대로 멈춰 선다.
//      다음 요청이 인스턴스를 깨울 때까지 주방 화면은 아무것도 모른다.
//      그래서 「알림이 나간 뒤에 응답했는가」를 시간으로 잰다.
//
//   2. **주문 말고 나머지도 알린다.** 지금까지 화면이 스스로 다시 불러오는
//      것은 주문뿐이었다. 인원수·테이블·메뉴는 로그인할 때 한 번이 전부라,
//      옆 태블릿에서 고쳐도 이 화면은 영영 몰랐다.
const path = require("path");
const fs = require("fs");

// Pusher 를 가짜로 바꾼다 — 실제로 무엇이 언제 나갔는지 보려고.
const calls = [];
let triggerDelayMs = 0;
let triggerFails = false;
class FakePusher {
  constructor(cfg) { this.cfg = cfg; }
  trigger(channel, event, payload, opts) {
    calls.push({ channel, event, payload, opts, at: Date.now() });
    if (triggerFails) return Promise.reject(new Error("pusher down"));
    return new Promise((r) => setTimeout(r, triggerDelayMs));
  }
}
require.cache[require.resolve("pusher")] = {
  id: require.resolve("pusher"), filename: require.resolve("pusher"),
  loaded: true, exports: FakePusher, paths: [],
};

process.env.PUSHER_APP_ID = "test-app";
process.env.PUSHER_KEY = "test-key";
process.env.PUSHER_SECRET = "test-secret";
process.env.PUSHER_CLUSTER = "ap3";

const express = require("express");
const request = require("supertest");
const realtime = require("../src/realtime");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const app = express();
app.use(express.json());
const router = express.Router();
router.use(realtime.broadcastOnWrite("tables"));
router.get("/read", (req, res) => res.json({ ok: true }));
router.post("/write", (req, res) => res.json({ ok: true }));
router.put("/write", (req, res) => res.json({ ok: true }));
router.patch("/write", (req, res) => res.json({ ok: true }));
router.delete("/write", (req, res) => res.json({ ok: true }));
router.post("/bad", (req, res) => res.status(400).json({ error: "nope" }));
router.post("/quiet", (req, res) => { res.locals.skipBroadcast = true; res.json({ ok: true }); });
app.use("/t", router);

const menuApp = express();
menuApp.use(express.json());
const menuRouter = express.Router();
menuRouter.use(realtime.broadcastOnWrite("menu"));
menuRouter.post("/write", (req, res) => res.json({ ok: true }));
menuApp.use("/m", menuRouter);

const src = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

(async () => {
  out.push("[1] 쓰기에는 알림이 붙고, 읽기에는 안 붙는다]");
  calls.length = 0;
  await request(app).get("/t/read");
  check("GET 은 안 쏜다", calls.length === 0, JSON.stringify(calls));

  for (const m of ["post", "put", "patch", "delete"]) {
    calls.length = 0;
    await request(app)[m]("/t/write").send({});
    check(`${m.toUpperCase()} 는 쏜다`, calls.length === 1, JSON.stringify(calls));
  }

  calls.length = 0;
  await request(app).post("/t/bad").send({});
  check("★ 실패한 요청은 안 쏜다 (아무것도 안 바뀌었다)", calls.length === 0, JSON.stringify(calls));

  calls.length = 0;
  await request(app).post("/t/quiet").send({});
  // 손님이 QR 을 열 때마다 오는 POST /seat 가 이 길로 빠진다. 안 빠지면
  // 손님 한 명이 앉을 때마다 매장 모든 태블릿이 목록을 다시 받는다.
  check("★ skipBroadcast 를 켠 라우트는 안 쏜다", calls.length === 0, JSON.stringify(calls));

  out.push("\n[2] 무엇이 바뀌었는지 같이 보낸다");
  calls.length = 0;
  await request(app).post("/t/write").send({});
  check("채널은 orders", calls[0].channel === "orders", calls[0].channel);
  check("이벤트는 data", calls[0].event === "data", calls[0].event);
  check("what=tables", calls[0].payload.what === "tables", JSON.stringify(calls[0].payload));
  calls.length = 0;
  await request(menuApp).post("/m/write").send({});
  check("★ 메뉴는 what=menu (인원 하나 고칠 때 메뉴까지 다시 받지 않게)",
    calls[0].payload.what === "menu", JSON.stringify(calls[0].payload));

  out.push("\n[3] ★★ 알림이 나간 뒤에 응답한다 (서버리스가 얼기 전에)");
  // 이게 이 파일의 핵심이다. Pusher 로 나가는 데 250ms 가 걸리게 해두고,
  // 응답이 그보다 먼저 오면 「던져놓고 응답한」 것이다 — 배포 환경에서는
  // 그 던져놓은 요청이 인스턴스와 함께 얼어붙는다.
  triggerDelayMs = 250;
  calls.length = 0;
  let t0 = Date.now();
  await request(app).post("/t/write").send({});
  let elapsed = Date.now() - t0;
  check(`★★ 응답이 알림을 기다린다 (${elapsed}ms ≥ 250ms)`, elapsed >= 240, `${elapsed}ms`);
  triggerDelayMs = 0;

  out.push("\n[4] 그렇다고 Pusher 에 발이 묶이지는 않는다");
  // 알림을 기다리다 주문이 실패하거나 몇 초씩 멈추면, 느린 것보다 나쁘다.
  triggerDelayMs = 5000; // Pusher 가 통째로 먹통인 상황
  t0 = Date.now();
  const slow = await request(app).post("/t/write").send({});
  elapsed = Date.now() - t0;
  check("★ 제한 시간을 넘기면 그냥 응답한다", slow.status === 200 && elapsed < 2000, `${slow.status} / ${elapsed}ms`);
  triggerDelayMs = 0;

  triggerFails = true;
  const failed = await request(app).post("/t/write").send({});
  check("★ Pusher 가 실패해도 요청은 성공한다", failed.status === 200 && failed.body.ok === true,
    `${failed.status} ${JSON.stringify(failed.body)}`);
  triggerFails = false;

  out.push("\n[5] 실제 라우터들이 이 길목을 지난다");
  // 라우트마다 한 줄씩 넣는 방식이었으면 여기서 셀 수가 없다.
  check("테이블", /router\.use\(broadcastOnWrite\("tables"\)\)/.test(src("src/routes/tables.js")));
  check("메뉴", /router\.use\(broadcastOnWrite\("menu"\)\)/.test(src("src/routes/menu.js")));
  check("구역", /router\.use\(broadcastOnWrite\("tables"\)\)/.test(src("src/routes/zones.js")));
  check("★ 손님이 앉는 요청은 빠져 있다",
    /router\.post\("\/:tableNumber\/seat"[\s\S]{0,400}?res\.locals\.skipBroadcast = true;/.test(src("src/routes/tables.js")));

  out.push("\n[6] 주문 알림도 응답보다 먼저 나간다");
  const ordersSrc = src("src/routes/orders.js");
  const bare = (ordersSrc.match(/\n {2}broadcastOrdersChanged\(req\);/g) || []).length;
  const awaited = (ordersSrc.match(/\n {2}await broadcastOrdersChanged\(req\);/g) || []).length;
  check(`★ 주문 알림 ${awaited}곳이 전부 await 다`, awaited >= 6 && bare === 0, `await ${awaited} / bare ${bare}`);
  check("★ VIP 카드 판매도 마찬가지",
    /await broadcastOrdersChanged\(req\);/.test(src("src/routes/vipCards.js")) &&
    !/\n {2}broadcastOrdersChanged\(req\);/.test(src("src/routes/vipCards.js")));

  out.push("\n[7] 화면이 그 알림을 듣고 다시 불러온다");
  const adminJs = src("public/js/admin.js");
  check("★ data 이벤트를 듣는다", /channel\.bind\("data",/.test(adminJs));
  check("메뉴가 바뀌면 메뉴를 다시 부른다", /what === "menu"\)\s*\{\s*\n\s*await loadMenu\(\);/.test(adminJs));
  check("그 밖에는 테이블을 다시 부른다", /await loadTables\(\);/.test(adminJs));
  check("배치도와 열려 있는 테이블 상세도 같이 갱신한다",
    /refreshChangedData[\s\S]{0,900}?renderPaymentFloorPlan\(\)[\s\S]{0,300}?openTableDetail\(/.test(adminJs));
  // 알림이 유실되거나 연결이 조용히 끊겨도 「새로고침해야 보이는」 상태로
  // 되돌아가지 않게, 가끔 스스로 다시 불러오는 안전망이 있어야 한다.
  check("★ 알림이 못 올 때를 위한 안전망 타이머가 있다",
    /dataTimer = setInterval\(/.test(adminJs) && /DATA_REFRESH_MS/.test(adminJs));
  check("로그아웃하면 그 타이머도 멈춘다", /clearInterval\(dataTimer\)/.test(adminJs));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
