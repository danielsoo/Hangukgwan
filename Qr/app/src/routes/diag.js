// 사장 전용 진단 화면용 수치. 읽기만 하고 아무것도 바꾸지 않는다.
//
// 왜 있나 — 2026-09-08 속도 점검:
// 밖에서 재면 "API 가 300ms" 까지만 알 수 있고, 그 안에서 무엇이 시간을
// 쓰는지는 알 수 없었다. 특히 함수 리전을 대만 가까이(도쿄/싱가포르)로
// 옮기는 게 도움이 될지 손해일지는 **몽고가 어디 있느냐**에 달려 있는데,
// 접속 문자열만 봐서는 알 수 없다. 함수 안에서 직접 재는 수밖에 없다.
//
// - mongo_ping_ms 가 작으면(≲20ms) 몽고가 함수와 같은 지역에 있다는 뜻이라,
//   리전을 옮기면 몽고 왕복이 태평양을 건너게 되어 오히려 느려진다.
// - 크면(≳100ms) 이미 멀리 있다는 뜻이라, 손님 가까이로 옮기는 게 이득이다.
const express = require("express");
const { store } = require("../db");
const { requireOwner } = require("../auth");

const router = express.Router();

router.get("/", requireOwner, async (req, res) => {
  const out = {
    // Vercel 이 넣어주는 값들. 로컬에서는 없다.
    region: process.env.VERCEL_REGION || null,
    env: process.env.VERCEL_ENV || process.env.NODE_ENV || null,
    node: process.version,
  };

  // 몽고 왕복 시간 — refreshStore() 가 매 요청 치르는 비용의 하한선.
  try {
    // getDb() 는 동기 함수이고 connectDB() 이후에만 유효하다. 이 라우트는
    // server.js 의 refreshStore() 미들웨어 뒤에 있으므로 이미 연결돼 있다.
    const db = require("../db").getDb();
    if (db && typeof db.command === "function") {
      const t0 = Date.now();
      await db.command({ ping: 1 });
      out.mongo_ping_ms = Date.now() - t0;
    } else {
      // 조용히 빠지면 「줄이 아예 없는」 화면이 되고, 그건 「빨랐다」로
      // 읽힌다. 못 쟀으면 못 쟀다고 적는다.
      out.mongo_ping_ms = null;
      out.mongo_ping_error = "no db handle";
    }
  } catch (e) {
    out.mongo_ping_error = e.message;
  }

  // 매 요청이 치르는 두 번의 읽기 — refreshStore() 가 하는 일 그대로다.
  // mongo_ping_ms 는 「왕복 자체」의 값이고, 이 둘은 「실제로 읽는 양까지
  // 합친」 값이다. 둘의 차이가 크면 문서가 커진 것이고, 둘 다 크면 몽고가
  // 멀리 있는 것이다. 어느 쪽이냐에 따라 할 일이 완전히 다르다.
  try {
    const db = require("../db").getDb();
    const { ORDERS_COLLECTION, recentCutoff } = require("../db");
    if (db) {
      let t = Date.now();
      await db.collection("store").findOne({ _id: "main" }, { projection: { orders: 0 } });
      out.store_read_ms = Date.now() - t;

      t = Date.now();
      const cutoff = recentCutoff();
      await db
        .collection(ORDERS_COLLECTION)
        .find({ $or: [{ status: { $nin: ["paid", "cancelled"] } }, { created_at: { $gte: cutoff } }] })
        .toArray();
      out.orders_read_ms = Date.now() - t;
    }
  } catch (e) {
    out.read_error = e.message;
  }

  // store 문서 하나에 전부 들어 있어서, 이 크기가 곧 매 요청 내려받는 양이다.
  try {
    out.store_kb = Math.round(JSON.stringify(store).length / 1024);
    out.rows = {};
    for (const k of ["menuItems", "tables", "orders", "payments", "daily_settlements", "reservations", "vipCards", "vip_cards", "zones", "categories"]) {
      if (Array.isArray(store[k])) out.rows[k] = store[k].length;
    }
    // 어느 배열이 그 크기를 차지하는지 — 쪼갤 대상을 고르는 근거.
    out.kb_by_key = Object.fromEntries(
      Object.entries(store)
        .filter(([, v]) => Array.isArray(v))
        .map(([k, v]) => [k, Math.round(JSON.stringify(v).length / 1024)])
        .filter(([, kb]) => kb >= 1)
        .sort((a, b) => b[1] - a[1])
    );
  } catch (e) {
    out.store_error = e.message;
  }

  // Pusher 왕복 시간.
  //
  // 2026-09-11 에 「알림을 보낸 뒤에 응답한다」로 바꿨다 — 서버리스는 응답을
  // 내보내는 순간 인스턴스를 얼려서, 던져만 놓은 알림이 몇 초씩 늦게 나가기
  // 때문이다(src/realtime.js). 그 대신 **모든 쓰기가 이 왕복만큼 느려진다.**
  //
  // 그래서 그 값을 여기서 잰다. 몽고 왕복과 같은 이유다 — 밖에서 재면
  // 「버튼이 느리다」까지만 알 수 있고, 그 안에서 무엇이 시간을 쓰는지는
  // 알 수 없다. 수십 ms 면 정상, 수백 ms 면 이 대기가 체감 속도를 깎고
  // 있다는 뜻이라 제한 시간을 줄이거나 방식을 다시 봐야 한다.
  try {
    const rt = require("../realtime");
    if (rt.pusherConfigured()) {
      const t0 = Date.now();
      await rt.pingPusher();
      out.pusher_ms = Date.now() - t0;
    } else {
      out.pusher_ms = null; // 설정 안 됨 — 쓰기가 알림을 기다리지 않는다
    }
    out.pusher_timeout_ms = rt.TRIGGER_TIMEOUT_MS;
  } catch (e) {
    out.pusher_error = e.message;
  }

  res.set("Cache-Control", "no-store");
  res.json(out);
});

module.exports = router;
