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
const requestLog = require("../requestLog");
const { nowLocal } = require("../time");

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

  // 이 인스턴스가 얼마나 오래 살아 있었고 몇 번째 요청인가.
  //
  // 2026-09-12 사장님: "근데 버셀이나 몽고 둘 다 서버가 서울인데?"
  // 맞는 지적이다. 2026-09-10 에 리전을 서울로 옮겨 왕복이 3ms 가 됐다.
  // **따뜻한 인스턴스에서는 몽고가 느릴 수가 없다.** 그런데도 느리다면
  // 남은 후보는 「매번 새로 뜨는 인스턴스」다 — 새 인스턴스는 함수 번들을
  // 풀고 Atlas 로 TLS 를 새로 맺는다. 그건 3ms 가 아니다.
  //
  // requests_served 가 계속 1~2 로 나오면 요청마다 새 인스턴스가 뜨고
  // 있다는 뜻이고, 그때는 왕복 횟수를 줄이는 것이 아무 소용이 없다.
  try {
    Object.assign(out, require("../instance").stats());
    out.mongo_connect_ms = require("../db").firstConnectMs();
  } catch (e) {
    out.instance_error = e.message;
  }

  res.set("Cache-Control", "no-store");
  res.json(out);
});

/**
 * 쌓인 기록을 사람이 읽을 수 있는 모양으로.
 *
 * 2026-09-12 사장님: "모든 기록들이 모이면서 알기 쉽잖아"
 *
 * 그래서 줄을 그대로 뱉지 않고 **요약해서** 준다. 수천 줄을 눈으로 훑어서
 * 알 수 있는 것은 없다. 알고 싶은 것은 세 가지뿐이다 —
 *
 *  1. 어느 동작이 느린가        (동작별 중앙값·상위 10%·최대)
 *  2. 느린 것이 얼마나 잦은가   (400ms 넘는 비율)
 *  3. 콜드 스타트 때문인가      (콜드일 때와 아닐 때의 값 차이)
 *
 * 3번이 핵심이다. 둘이 비슷하면 인스턴스는 죄가 없고 다른 데를 봐야 한다.
 * 콜드가 몇 배 느리면, 왕복 횟수를 줄이는 것은 거의 의미가 없다.
 */
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100));
  return sorted[i];
}

router.get("/log", requireOwner, async (req, res) => {
  const hours = Math.min(24 * 14, Math.max(1, parseInt(req.query.hours, 10) || 24));
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const out = { hours, since: since.toISOString(), slow_ms: requestLog.SLOW_MS, keep_days: requestLog.KEEP_DAYS };

  try {
    const db = require("../db").getDb();
    const rows = await db
      .collection(requestLog.COLLECTION)
      .find({ created_at: { $gte: since } })
      .limit(20000)
      .toArray();

    out.count = rows.length;
    if (!rows.length) {
      // 빈 화면이 "빠르다"로 읽히면 안 된다. 왜 비었는지 말해준다.
      // 비어 있는 것과 "기록이 고장나서 비어 있는 것"을 구별해준다.
      // 조용히 비면 그게 "빠르다"로 읽힌다.
      const why = requestLog.lastFlushError();
      out.note = why
        ? `기록을 저장하지 못하고 있습니다: ${why}`
        : "아직 쌓인 기록이 없습니다. 배포 뒤 관리자 화면을 몇 번 쓰면 쌓입니다.";
      res.set("Cache-Control", "no-store");
      return res.json(out);
    }

    const cold = rows.filter((r) => r.cold);
    const warm = rows.filter((r) => !r.cold);
    const msOf = (list) => list.map((r) => r.ms).sort((a, b) => a - b);
    const summarize = (list) => {
      const ms = msOf(list);
      return {
        n: list.length,
        p50: percentile(ms, 50),
        p90: percentile(ms, 90),
        max: ms.length ? ms[ms.length - 1] : null,
      };
    };

    out.overall = summarize(rows);
    // 이 한 줄이 "인스턴스가 문제인가"를 가른다.
    out.cold = summarize(cold);
    out.warm = summarize(warm);

    // 몽고냐 아니냐. 2026-09-12 사장님: "아침엔 빨랐는데 저녁엔 느려졌어."
    // 코드는 그대로였으니 바뀐 것은 부하다. 몽고가 느려진 것인지(M0 는
    // 여러 손님이 같이 쓰는 호스트다) 아닌지를 이 둘이 가른다.
    const withMongo = rows.filter((r) => typeof r.mongo_ms === "number");
    if (withMongo.length) {
      const mongoMs = withMongo.map((r) => r.mongo_ms).sort((a, b) => a - b);
      out.mongo = { n: withMongo.length, p50: percentile(mongoMs, 50), p90: percentile(mongoMs, 90), max: mongoMs[mongoMs.length - 1] };
      const outside = withMongo.map((r) => Math.max(0, r.ms - r.mongo_ms)).sort((a, b) => a - b);
      out.outside_mongo = { p50: percentile(outside, 50), p90: percentile(outside, 90), max: outside[outside.length - 1] };
    }

    // 화면이 잰 것과 서버가 잰 것. 차이가 곧 「앱 바깥」 — 신주에서 서울까지,
    // 연결 맺기, 함수가 깨어나는 시간이다. 서버는 자기 시계로 이걸 못 본다.
    const clientRows = rows.filter((r) => r.src === "client");
    const serverRows = rows.filter((r) => r.src !== "client");
    if (clientRows.length) {
      out.client = summarize(clientRows);
      out.server = summarize(serverRows);
      out.outside_app_p50 =
        out.client.p50 != null && out.server.p50 != null ? out.client.p50 - out.server.p50 : null;
    }

    // **시간대별.** 아침과 저녁을 갈라 보여주는 것이 이 화면의 목적이다.
    // 한 줄로 뭉친 평균은 "아침엔 빨랐다"를 지워버린다.
    const byHour = new Map();
    for (const r of rows) {
      const hh = String(r.at || "").slice(11, 13);
      if (!/^\d\d$/.test(hh)) continue;
      if (!byHour.has(hh)) byHour.set(hh, []);
      byHour.get(hh).push(r);
    }
    out.by_hour = [...byHour.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([hh, list]) => Object.assign({ hour: `${hh}시` }, summarize(list), {
        cold_n: list.filter((r) => r.cold).length,
        mongo_p50: percentile(list.filter((r) => typeof r.mongo_ms === "number").map((r) => r.mongo_ms).sort((a, b) => a - b), 50),
      }));

    const droppedRows = rows.filter((r) => r.dropped);
    if (droppedRows.length) {
      // 버린 줄이 있었다는 것 자체가 데이터다 — 그 시각에 요청이 몰렸다는 뜻.
      out.dropped_total = droppedRows.reduce((a, r) => a + (r.dropped || 0), 0);
    }
    out.cold_share_pct = Math.round((cold.length / rows.length) * 100);
    out.slow_share_pct = Math.round((rows.filter((r) => r.ms >= requestLog.SLOW_MS).length / rows.length) * 100);

    const byRoute = new Map();
    for (const r of rows) {
      const key = `${r.method} ${r.route}`;
      if (!byRoute.has(key)) byRoute.set(key, []);
      byRoute.get(key).push(r);
    }
    out.by_route = [...byRoute.entries()]
      .map(([key, list]) => Object.assign({ route: key }, summarize(list), {
        cold_n: list.filter((r) => r.cold).length,
      }))
      .sort((a, b) => b.p90 - a.p90)
      .slice(0, 30);

    // 가장 느렸던 것들 — 요약이 못 보여주는 한 건짜리 사고를 위해.
    out.slowest = rows
      .slice()
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 15)
      .map((r) => ({ at: r.at, route: `${r.method} ${r.route}`, ms: r.ms, cold: !!r.cold, nth: r.nth, status: r.status }));
  } catch (e) {
    out.error = e.message;
  }
  const flushErr = requestLog.lastFlushError();
  if (flushErr) out.log_write_error = flushErr;

  res.set("Cache-Control", "no-store");
  res.json(out);
});

/**
 * 기록을 통째로 파일 하나로.
 *
 * 2026-09-12 사장님: "일단 이틀 돌리고 나온 json 을 너한테 줄 수 있게
 * 세팅해줘."
 *
 * 요약(/log)은 화면에서 읽으라고 만든 것이고, 이건 **남에게 넘기라고**
 * 만든 것이다. 그래서 줄을 줄이지 않는다 — 요약이 이미 평균을 내버린
 * 뒤라면, 받는 쪽은 "그 한 번은 왜 3초였나"를 영영 물을 수 없다.
 *
 * 다만 요약도 같이 넣는다. 파일 하나만 보고도 큰 그림이 바로 보이게.
 */
router.get("/log/export", requireOwner, async (req, res) => {
  const hours = Math.min(24 * 14, Math.max(1, parseInt(req.query.hours, 10) || 48));
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const body = {
    // 받는 쪽이 "이게 뭔지"를 따로 묻지 않아도 되게, 파일 자체에 적어 둔다.
    what: "한국관 주문시스템 — 요청 속도 기록 (src/requestLog.js)",
    exported_at: nowLocal(),
    hours,
    since: since.toISOString(),
    how: {
      rule: "모든 요청을 기록한다 (표본 아님). 담아뒀다가 다음 요청에 한 번의 쓰기로 몰아 내보낸다.",
      src: "server=서버 안에서 보낸 시간, client=태블릿이 실제로 기다린 시간(망·콜드 스타트 포함)",
      keep_days: requestLog.KEEP_DAYS,
      fields: "ms=걸린 시간, mongo_ms=그중 몽고를 기다린 시간, mongo_ops=몽고 호출 수, cold=이 인스턴스의 첫 요청인가, nth=이 인스턴스가 처리한 몇 번째 요청, age_s=인스턴스가 살아 있던 시간",
    },
    region: process.env.VERCEL_REGION || null,
  };

  try {
    const db = require("../db").getDb();
    const rows = await db
      .collection(requestLog.COLLECTION)
      .find({ created_at: { $gte: since } })
      .limit(50000)
      .toArray();
    body.count = rows.length;
    body.rows = rows.map((r) => ({
      at: r.at,
      src: r.src || "server",
      route: `${r.method} ${r.route}`,
      status: r.status,
      ms: r.ms,
      mongo_ms: r.mongo_ms,
      mongo_ops: r.mongo_ops,
      cold: !!r.cold,
      nth: r.nth,
      age_s: r.age_s,
      region: r.region,
      dropped: r.dropped,
    }));
  } catch (e) {
    body.error = e.message;
  }
  const flushErr = requestLog.lastFlushError();
  if (flushErr) body.log_write_error = flushErr;

  const day = String(nowLocal()).slice(0, 10);
  res.set("Cache-Control", "no-store");
  res.set("Content-Disposition", `attachment; filename="hangukgwan-speed-${day}.json"`);
  res.type("application/json").send(JSON.stringify(body, null, 1));
});

module.exports = router;
