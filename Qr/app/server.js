require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const { refreshStore } = require("./src/db");
const seed = require("./src/seed");

const app = express();

app.set("trust proxy", 1);
// The `verify` hook stashes the raw request body on req.rawBody — needed by
// the LINE webhook route (src/routes/lineWebhook.js) to check the
// X-Line-Signature header, which is an HMAC over the exact raw bytes LINE
// sent (re-serializing req.body wouldn't byte-for-byte match). Harmless for
// every other route, which just keep using the parsed req.body as before.
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

// Refresh `store` from Mongo before every single request (not just once per
// warm process) — Vercel can keep multiple separate server instances alive
// at the same time, each with its own in-memory copy of `store`. Without a
// per-request refresh, an instance that loaded the data a while ago could
// save() its stale snapshot over another instance's more recent changes,
// which is what caused data to randomly appear to "reset". seed() only
// needs to actually run its first-time setup once per process (its own
// internal checks make repeat calls cheap no-ops either way).
let seededOnce = false;
app.use(async (req, res, next) => {
  try {
    await refreshStore();
    if (!seededOnce) {
      await seed();
      seededOnce = true;
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
      mongoUrl: process.env.MONGODB_URI,
      dbName: process.env.MONGODB_DB || "hangukgwan",
      collectionName: "sessions",
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

app.use(express.static(path.join(__dirname, "public")));

app.use("/api/auth", require("./src/routes/auth"));
app.use("/api/menu", require("./src/routes/menu"));
app.use("/api/tables", require("./src/routes/tables"));
app.use("/api/zones", require("./src/routes/zones"));
app.use("/api/orders", require("./src/routes/orders"));
app.use("/api/settings", require("./src/routes/settings"));
app.use("/api/settlements", require("./src/routes/settlements"));
app.use("/api/reservations", require("./src/routes/reservations"));
app.use("/api/line/webhook", require("./src/routes/lineWebhook"));
app.use("/api/payment", require("./src/routes/payments"));
app.use("/api/photo", require("./src/routes/photos"));
app.use("/api/vip-cards", require("./src/routes/vipCards"));
app.use("/api/members", require("./src/routes/members"));

// Customer ordering page — table number is read client-side from the URL
app.get("/t/:tableNumber", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "order.html"));
});

// Owner dashboard
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/", (req, res) => {
  res.redirect("/admin");
});

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
