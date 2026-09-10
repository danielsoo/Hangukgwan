require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const compression = require("compression");
const MongoStore = require("connect-mongo");
const { refreshStore, save, nextId, savePhoto, deletePhoto, store, getDb, connectDB, getClient } = require("./src/db");
const seed = require("./src/seed");
const { applyFeedback202609 } = require("./src/migrations/2026-09-feedback");
const { applyFollowup202609 } = require("./src/migrations/2026-09-followup");
const { applyMenuFixes20260904 } = require("./src/migrations/2026-09-04-menu-fixes");
const { applyTakeoutOptions20260907 } = require("./src/migrations/2026-09-07-takeout-options");
const { applyOrdersCollection20260910 } = require("./src/migrations/2026-09-10-orders-collection");
const { applyServiceStart20260910 } = require("./src/migrations/2026-09-10-service-start");
const { applySplitCollections20260910 } = require("./src/migrations/2026-09-10-split-collections");
const { applyOrderHours20260910 } = require("./src/migrations/2026-09-10-order-hours");
const { applyTraditionalCategory20260910 } = require("./src/migrations/2026-09-10-traditional-category");

const app = express();

app.set("trust proxy", 1);

// gzip/deflate every response below this (HTML/CSS/JS/JSON) — 사장님
// 피드백: "터치 후 반응 속도랑 링크 타고 들어가는 속도가... 느려". Typically
// cuts text-response transfer size by 60-80% for negligible CPU cost, which
// matters most exactly where this app is slowest: a customer's phone on
// restaurant wifi/mobile data. Placed first so it wraps everything —
// static files and every /api/* JSON response alike.
app.use(compression());

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
app.use(
  express.static(path.join(__dirname, "public"), {
    // No cache-busting/hashed filenames in this app, so a long maxAge risks
    // an admin device or a customer's phone holding onto a stale JS/CSS
    // file for a while after a deploy. 1 hour balances real repeat-visit
    // savings (the same table's QR scanned again later, staff reloading
    // /admin through a shift) against how long a fix could take to
    // visibly land — always fixable sooner with a manual hard refresh.
    //
    // Local dev (NODE_ENV !== "production", e.g. `node server.js` on
    // localhost while testing a fix) skips this entirely — 2026-09-05:
    // 사장님이 로컬(localhost:3000)에서 admin.js를 고칠 때마다 이 1시간
    // 캐시 때문에 일반 새로고침으로는 방금 배포(로컬 저장)한 최신 코드가
    // 안 보이고 하드리프레시가 필요해서 "고쳤다는데 왜 그대로냐"는 혼란이
    // 반복됐다. 실제 운영(production)에서는 그대로 1시간 캐시 유지.
    maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
  })
);

// Customer ordering page — table number is read client-side from the URL.
// Doesn't touch `store`, just serves the same static HTML shell for every
// table, so (like the static assets above) it doesn't need to wait on
// refreshStore()/seed()/migrations below.
app.get("/t/:tableNumber", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "order.html"));
});

// Owner dashboard — same reasoning: the real auth/data checks happen
// client-side via the /api/* calls admin.js makes afterward, not here.
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

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
app.use(async (req, res, next) => {
  try {
    await refreshStore();
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
      migratedOnce = true;
    }
    next();
  } catch (e) {
    console.error("Startup / DB connection failed:", e);
    res.status(500).json({ error: "server_not_ready" });
  }
});

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
