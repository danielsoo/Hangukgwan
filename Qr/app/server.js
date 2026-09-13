require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const compression = require("compression");
const { nowLocal } = require("./src/time");
const MongoStore = require("connect-mongo");
const { refreshStore, save, nextId, savePhoto, deletePhoto, store, getDb, connectDB, getClient, ensureOrderIdFloor, refreshAndSave } = require("./src/db");
const seed = require("./src/seed");
// 0번 테이블 정리 마이그레이션이 「지워도 안전한가」를 묻는 데 쓴다.
const { hasUnpaidOrder } = require("./src/partySize");
const { applyFeedback202609 } = require("./src/migrations/2026-09-feedback");
const { applyFollowup202609 } = require("./src/migrations/2026-09-followup");
const { applyMenuFixes20260904 } = require("./src/migrations/2026-09-04-menu-fixes");
const { applyTakeoutOptions20260907 } = require("./src/migrations/2026-09-07-takeout-options");
const { applyOrdersCollection20260910 } = require("./src/migrations/2026-09-10-orders-collection");
const { applyServiceStart20260910 } = require("./src/migrations/2026-09-10-service-start");
const { applySplitCollections20260910 } = require("./src/migrations/2026-09-10-split-collections");
const { applyOrderHours20260910 } = require("./src/migrations/2026-09-10-order-hours");
// 배포한 것이 화면에 안 닿던 문제 — 자세한 배경은 그 파일 맨 위 주석.
const { sendStamped } = require("./src/assetVersion");
const { applyTraditionalCategory20260910 } = require("./src/migrations/2026-09-10-traditional-category");
const { applyRemoveTable020260910 } = require("./src/migrations/2026-09-10-remove-table-0");
const { applySpiceBasic20260910 } = require("./src/migrations/2026-09-10-spice-basic");
const { applyServicePeriodBackfill20260910 } = require("./src/migrations/2026-09-10-service-period-backfill");

const app = express();

app.set("trust proxy", 1);

// gzip/deflate every response below this (HTML/CSS/JS/JSON) — 사장님
// 피드백: "터치 후 반응 속도랑 링크 타고 들어가는 속도가... 느려". Typically
// cuts text-response transfer size by 60-80% for negligible CPU cost, which
// matters most exactly where this app is slowest: a customer's phone on
// restaurant wifi/mobile data. Placed first so it wraps everything —
// static files and every /api/* JSON response alike.
app.use(compression());

// ── 재는 것은 제일 앞에서 ────────────────────────────────────────────
//
// 2026-09-12 사장님: "그럼 모든 행동이 이제 다 로그로 남는거지?"
//
// 아니었다. 재는 자리가 아래쪽(/api 전용 미들웨어)이라, 그 위에서 끝나는
// 것들 — 손님이 받는 메뉴 사진(/api/photo), 화면 파일(js/css), 페이지
// 자체 — 은 하나도 안 잡혔다. 손님이 QR 을 찍고 기다리는 시간의 상당 부분이
// 바로 그것들인데.
//
// 그래서 재는 것만 맨 앞으로 옮긴다. 기록은 메모리에 담기만 하므로 여기
// 있어도 값이 들지 않는다. 몽고에 내보내는 것은 그대로 아래에 둔다 — 거기가
// 어차피 store 를 읽는 자리라, 그것과 나란히 나가면 공짜다.
//
// 다만 /api 가 아닌 것(사진·파일)은 **느리거나 인스턴스가 방금 떴을 때만**
// 담는다. 전부 담으면 사진 한 장 한 장이 줄을 차지해서, 정작 봐야 할 줄이
// 상한에 밀려 사라진다.
app.use((req, res, next) => {
  // 이 요청이 몽고에서 보낸 시간을 요청마다 따로 센다(src/dbTiming.js).
  // 전역 변수로 세면 동시에 들어온 요청들이 서로의 시간을 더해서, 바쁠수록
  // 숫자가 부풀어 오른다 — 하필 바쁠 때를 보려는 것인데.
  require("./src/dbTiming").run(() => {
    try {
      startMeasuring(req, res);
    } catch (e) {
      // 재는 것이 요청을 막지 않는다.
    }
    next();
  });
});

function startMeasuring(req, res) {
  const instance = require("./src/instance");
  const requestLog = require("./src/requestLog");
  instance.countRequest();

  const startedAt = Date.now();
  const stats = instance.stats();
  const isApi = String(req.path || "").indexOf("/api/") === 0;
  // **주소를 지금 잡아 둔다.** res.end 는 라우터 안에서 불리는데, 그때
  // req.path 는 그 라우터에 상대적인 값으로 바뀌어 있다 — /api/orders 가
  // "/" 로, /api/auth/login 이 "/login" 으로 기록됐다(2026-09-12 실제로
  // 그렇게 쌓였다). 요약이 통째로 무의미해진다.
  const routeAtEntry = requestLog.routeOf(req.originalUrl ? req.originalUrl.split("?")[0] : req.path);

  // 화면이 실제로 기다린 시간. 앞 요청들의 값이 헤더에 얹혀 온다
  // (public/js/clientTiming.js — 손님 화면과 관리자 화면이 같이 쓴다).
  // 서버가 자기 시계로는 볼 수 없는 구간 — 기기에서 서울까지, 연결 맺기,
  // 함수가 깨어나는 시간 — 이 여기 들어 있다.
  try {
    const raw = req.get("X-Client-Timing");
    if (raw) {
      for (const part of String(raw).slice(0, 2000).split(";")) {
        const [route, ms, status] = part.split("|");
        if (!route || !/^\d+$/.test(ms || "")) continue;
        // click: 으로 시작하면 「누른 것 하나가 끝날 때까지」다. 요청 하나가
        // 아니라 사람이 실제로 기다린 시간이라, 요청 줄과 섞으면 안 된다
        // — 결제 완료 한 번이 PATCH 세 줄로 흩어지는 것을 막으려고 따로
        // 재는 값인데, 섞으면 도로 흩어진다.
        const isClick = route.indexOf("click:") === 0;
        requestLog.record({
          created_at: new Date(),
          at: nowLocal(),
          // client=요청 하나를 화면이 잰 값, click=누른 것 하나가 끝날 때까지
          src: isClick ? "click" : "client",
          route: isClick ? route.slice(6).slice(0, 80) : requestLog.routeOf(route),
          method: isClick ? "CLICK" : "GET",
          // click 줄의 status 자리에는 그 누름이 보낸 요청 수가 들어 있다.
          status: isClick ? 0 : parseInt(status, 10) || 0,
          reqs: isClick ? parseInt(status, 10) || 0 : undefined,
          ms: Math.min(600000, parseInt(ms, 10)),
        });
      }
    }
  } catch (e) {
    // 헤더가 이상해도 요청은 그대로 간다.
  }

  // 응답을 내보내기 직전에 담는다. **여기서 몽고에 쓰지 않는다** — 담기만
  // 하고, 다음 /api 요청이 store 를 읽을 때 나란히 나간다. 서버리스는 응답을
  // 내보내는 순간 인스턴스를 얼려서, 응답 뒤에 쓰려고 하면 그 쓰기가 다음
  // 요청까지 매달려 있게 된다. 어제 Pusher 에서 그 일이 있었다.
  const endResponse = res.end.bind(res);
  res.end = function (...args) {
    try {
      const ms = Date.now() - startedAt;
      const cold = stats.requests_served === 1;
      // 사진·파일은 느리거나 방금 뜬 인스턴스일 때만. 위 주석 참고.
      if (isApi || cold || ms >= requestLog.SLOW_MS) {
        const mongo = require("./src/dbTiming").current();
        requestLog.record({
          created_at: new Date(), // 몽고 TTL 이 보는 값 — Date 여야 한다
          at: nowLocal(),
          src: "server",
          route: routeAtEntry,
          method: req.method,
          status: res.statusCode,
          ms,
          // 이 요청이 몽고를 기다린 시간. ms 와의 차이가 곧 「몽고 밖에서 쓴
          // 시간」이다 — 아침과 저녁의 차이가 어느 쪽인지를 이 둘이 가른다.
          mongo_ms: mongo.mongo_ms,
          mongo_ops: mongo.mongo_ops,
          cold,
          nth: stats.requests_served,
          age_s: stats.instance_age_s,
          region: process.env.VERCEL_REGION || null,
        });
      }
    } catch (e) {
      // 기록이 응답을 막지 않는다.
    }
    return endResponse(...args);
  };
}


// The `verify` hook stashes the raw request body on req.rawBody — needed by
// the LINE webhook route (src/routes/lineWebhook.js) to check the
// X-Line-Signature header, which is an HMAC over the exact raw bytes LINE
// sent (re-serializing req.body wouldn't byte-for-byte match). Harmless for
// every other route, which just keep using the parsed req.body as before.
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

// Static files (css/js/images) and the two page shells right below never
// read `store` — they're served here, before the per-request Mongo refresh
// further down, instead of after it like before. That refresh used to sit
// ahead of both, which meant a customer scanning a QR code paid for a full
// MongoDB round-trip before EVERY single asset request the page made —
// order.html, main.css, order.js, i18n.js, every menu photo — even though
// none of those responses depend on that freshly-fetched data at all.
// 사장님 피드백: "링크 타고 들어가는 속도가... 느려" — this was a big piece of
// that (see loadFirebaseSdk() in order.js for the other piece: the
// Firebase SDK no longer loads at all for a store that hasn't set up
// 회원(VIP) login).
// 정적 파일의 캐시 길이는 src/assetVersion.js 가 정한다 — 주소에 배포
// 지문(?v=)이 박혀 있을 때만 오래 준다. 2026-09-12 "로그인도 그렇고 버튼
// 누르는 것도 그렇고 다" 느리다는 말에 대한 화면 쪽 답이 그 파일에 있다.
app.use(
  express.static(path.join(__dirname, "public"), {
    setHeaders: require("./src/assetVersion").staticSetHeaders,
  })
);

// Customer ordering page — table number is read client-side from the URL.
// Doesn't touch `store`, just serves the same static HTML shell for every
// table, so (like the static assets above) it doesn't need to wait on
// refreshStore()/seed()/migrations below.
// sendStamped: /js /css 주소에 배포 지문을 박아 보낸다(src/assetVersion.js).
// 안 그러면 한 시간 캐시와 "열어둔 탭은 js 를 다시 안 받는다" 가 겹쳐서,
// 배포한 고침이 가게 화면에 며칠씩 안 닿는다.
app.get("/t/:tableNumber", sendStamped("order.html"));

// Owner dashboard — same reasoning: the real auth/data checks happen
// client-side via the /api/* calls admin.js makes afterward, not here.
app.get("/admin", sendStamped("admin.html"));

// 홈페이지(Web/) — 자세한 배경은 src/site.js 주석. 여기 순서가 중요하다:
// 위의 /t/:tableNumber 와 /admin 이 먼저 잡히고, 그 다음 홈페이지가 "/",
// "/menu/", "/login/", "/account/" 같은 나머지를 가져간다. /api/* 는
// site.js 가 스스로 비켜준다.
const { siteMiddleware } = require("./src/site");
const site = siteMiddleware();
if (site) app.use(site);

// 홈페이지 빌드가 없을 때만 여기까지 온다(로컬에서 주문 시스템만 띄운
// 경우). 그때는 예전처럼 관리자 화면으로 보낸다 — 빈 화면보다 낫다.
app.get("/", (req, res) => {
  res.redirect("/admin");
});

// Menu/cover photos (src/routes/photos.js) read straight from Mongo's
// separate `photos` collection via getPhoto() — never the in-memory
// `store` — and already set their own 1-year immutable Cache-Control
// header. They gained nothing from waiting on the store refresh below, yet
// every menu item's photo paid for one anyway: a customer's very first
// page load fetches a photo per menu item, so this alone used to mean
// "however many dishes have photos" extra full-store round-trips stacked
// on the critical path before the menu was even visible.
app.use("/api/photo", require("./src/routes/photos"));

// Refresh `store` from Mongo before every single /api/* request (not just
// once per warm process) — Vercel can keep multiple separate server
// instances alive at the same time, each with its own in-memory copy of
// `store`. Without a per-request refresh, an instance that loaded the data
// a while ago could save() its stale snapshot over another instance's more
// recent changes, which is what caused data to randomly appear to "reset".
// seed() only needs to actually run its first-time setup once per process
// (its own internal checks make repeat calls cheap no-ops either way).
// Everything above (static files, the two page shells) already returned a
// response and never reaches this point, so only /api/* traffic (plus a
// genuine 404) pays for this.
let seededOnce = false;
let migratedOnce = false;
// 이 인스턴스가 몇 번째 요청을 처리하고 있나 (src/instance.js). 1 이면 방금
// 뜬 것이다 — 콜드 스타트. /api/_diag 가 그 값을 보여준다.
// 여기서부터가 /api 전용이다. store 를 새로 읽고, 담아둔 기록을 그것과
// 나란히 내보낸다. (재는 것은 위의 startMeasuring 이 이미 다 했다.)
app.use(storeRefreshAndFlush);

async function storeRefreshAndFlush(req, res, next) {
  const requestLog = require("./src/requestLog");
  try {
    // 담아둔 기록은 30초씩 모은 뒤 store 읽기와 **나란히** 내보낸다.
    // 매 요청마다 한 줄씩 쓰면 연결 포화 때 진단 기능이 장애를 더 키운다.
    await Promise.all([
      refreshStore(),
      // getDb() 는 connectDB() 전에는 못 쓴다. 예전에는 첫 /api 요청에
      // 담아둔 기록이 없어서 이 자리에 오지도 않았는데, 재는 자리를 맨
      // 앞으로 옮기면서 화면 파일 요청들이 먼저 담기게 됐다 — 그래서 **첫
      // 요청이 500 으로 죽었다**(2026-09-12, 브라우저로 확인). 연결이 끝난
      // 뒤에 내보낸다. connectDB() 는 같은 약속을 돌려주므로 refreshStore()
      // 와 나란히 가는 것은 그대로다.
      connectDB().then(() => (requestLog.shouldFlush() ? requestLog.flush(getDb()) : null)),
    ]);
    if (!seededOnce) {
      await seed();
      seededOnce = true;
    }
    // One-time data migrations against an already-live database — see the
    // file-level comment in src/migrations/2026-09-feedback.js for why this
    // is separate from seed() above (seed() only ever does anything on a
    // completely empty database). Each migration is internally idempotent
    // (checks its own store.settings flag), so calling it again is always
    // safe even if this per-process guard somehow ran more than once.
    // 주문 번호가 이미 겹쳐 있을 수 있다 — 실제 최대 번호 위로 한 번 올린다
    // (src/db.js ensureOrderIdFloor, 2026-09-10 9번 테이블).
    await ensureOrderIdFloor();
    if (!migratedOnce) {
      await applyFeedback202609(store, { save, nextId, savePhoto });
      await applyFollowup202609(store, { save });
      await applyMenuFixes20260904(store, { save, deletePhoto });
      await applyTakeoutOptions20260907(store, { save });
      // 주문을 store 문서 밖으로 — 이 앱이 느렸던 가장 큰 이유다(src/db.js).
      await applyOrdersCollection20260910(store, { save, getDb, connectDB });
      // 9/8 저녁 이전은 테스트 — 결산과 주문 목록에서 뺀다(src/serviceStart.js).
      await applyServiceStart20260910(store, { save });
      // 결제기록·정산·예약도 밖으로 — 지금은 옮길 게 몇 줄뿐이라 가장 싸다.
      await applySplitCollections20260910(store, { save, getDb, connectDB });
      // 영업시간 밖에는 손님이 QR 로 주문하지 못하게 — 직원은 그대로 된다
      // (src/openHours.js).
      await applyOrderHours20260910(store, { save });
      // 구이류와 기타 사이에 "전통한식요리 經典韓式料理" — 71~83번이 그리로
      // 옮겨가고 빈 기타는 없어진다.
      await applyTraditionalCategory20260910(store, { save, nextId });
      // 포장 손님이 들어오던 「外帶」 0번 테이블을 없앤다. 지워도 안전할
      // 때만 지우고, 아니면 다음 부팅에 다시 본다.
      await applyRemoveTable020260910(store, { save, refreshAndSave, hasUnpaidOrder });
      await applySpiceBasic20260910(store, { save });
      await applyServicePeriodBackfill20260910(store, { getDb, connectDB, save });
      migratedOnce = true;
    }
    next();
  } catch (e) {
    console.error("Startup / DB connection failed:", e);
    res.status(500).json({ error: "server_not_ready" });
  }
}

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    store: MongoStore.create({
      // mongoUrl 을 주면 connect-mongo 가 자기 몫의 MongoClient 를 또 하나
      // 만든다 — src/db.js 가 이미 만든 것과 별개로. 서버리스에서는
      // 인스턴스가 뜰 때마다 Atlas 로 가는 TLS 핸드셰이크를 두 번 하고,
      // 연결 수도 두 배로 쓴다는 뜻이다(무료 M0 는 연결 한도가 있다).
      // 같은 클라이언트를 넘겨 하나만 쓰게 한다.
      clientPromise: getClient(),
      dbName: process.env.MONGODB_DB || "hangukgwan",
      collectionName: "sessions",
      // 세션 만료 시각만 늘리는 쓰기를 요청마다 하지 않는다.
      //
      // resave:false 는 "세션 내용이 안 바뀌면 다시 저장하지 마라"이지만,
      // connect-mongo 는 그와 별개로 만료 시각을 갱신하려고 매 요청 touch
      // 를 한다 — 그래서 관리자 화면이 4초마다 폴링할 때마다 Mongo 에 쓰기가
      // 한 번씩 더 나갔다. touchAfter 를 두면 마지막 갱신에서 이만큼 지난
      // 뒤에만 쓴다. 세션은 12시간짜리라 10분 단위로 늘려도 만료가 앞당겨질
      // 일이 없다.
      touchAfter: 10 * 60, // 초
    }),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 12, // 12 hours
      secure: process.env.NODE_ENV === "production" && process.env.DISABLE_SECURE_COOKIE !== "1",
      sameSite: "lax",
    },
  })
);

// Re-reads the signed-in account's current role from the database before any
// route runs, so promoting/demoting someone takes effect on their very next
// request instead of whenever their 12-hour session cookie happens to expire
// (see src/auth.js). Must come after the session middleware above and before
// every route that guards on a role.
app.use(require("./src/auth").syncSessionRole);

// The unified customer+admin login (사장님 요청 2026-09-08). /api/auth
// below is the legacy password-only admin login, kept as the never-locked-out
// fallback; /api/account is the one the website's login form uses.
app.use("/api/account", require("./src/routes/account"));
app.use("/api/users", require("./src/routes/users"));
app.use("/api/auth", require("./src/routes/auth"));
app.use("/api/menu", require("./src/routes/menu"));
app.use("/api/tables", require("./src/routes/tables"));
app.use("/api/zones", require("./src/routes/zones"));
app.use("/api/orders", require("./src/routes/orders"));
// 테스터 모드 — 진짜 가게를 건드리지 않고 뭐든 해보는 자리(src/testMode.js).
app.use("/api/test-mode", require("./src/routes/testMode"));
app.use("/api/settings", require("./src/routes/settings"));
app.use("/api/settlements", require("./src/routes/settlements"));
app.use("/api/reservations", require("./src/routes/reservations"));
app.use("/api/line/webhook", require("./src/routes/lineWebhook"));
app.use("/api/payment", require("./src/routes/payments"));
app.use("/api/vip-cards", require("./src/routes/vipCards"));
// 사장 전용 진단 수치 (읽기 전용) — src/routes/diag.js 주석 참고.
// 관리자 화면이 뜰 때 필요한 것을 한 번에 답한다. 열세 번 나가던 요청이
// 한 번이 된다(src/routes/bootstrap.js). 실패하면 화면이 예전처럼 하나씩
// 부르므로, 이 줄이 없어도 앱은 그대로 돈다.
app.use("/api/bootstrap", require("./src/routes/bootstrap"));
app.use("/api/_diag", require("./src/routes/diag"));
app.use("/api/members", require("./src/routes/members"));

// Only start a listening server for local dev / Railway / Render. On
// Vercel this file is required by api/index.js as a plain request handler
// instead, so app.listen() must not run there.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Hangukgwan QR ordering system running on port ${PORT}`);
  });
}

module.exports = app;
