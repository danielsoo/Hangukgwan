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
    }
  } catch (e) {
    out.mongo_ping_error = e.message;
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

  res.set("Cache-Control", "no-store");
  res.json(out);
});

module.exports = router;
