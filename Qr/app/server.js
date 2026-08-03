require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const { connectDB } = require("./src/db");
const seed = require("./src/seed");

const app = express();

app.set("trust proxy", 1);
app.use(express.json());

// Make sure the database is connected (and seeded on first run) before any
// route handler touches `store`. This runs once per warm process and is
// cheap on every request after that.
let initPromise = null;
function ensureInit() {
  if (!initPromise) {
    initPromise = connectDB().then(() => seed());
  }
  return initPromise;
}
app.use(async (req, res, next) => {
  try {
    await ensureInit();
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
app.use("/api/photo", require("./src/routes/photos"));

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
