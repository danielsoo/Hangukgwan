require("dotenv").config();
require("./src/seed")(); // idempotent — creates tables/menu/admin on first run

const path = require("path");
const express = require("express");
const session = require("express-session");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set("trust proxy", 1);
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
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
app.use("/api/orders", require("./src/routes/orders")(io));
app.use("/api/settings", require("./src/routes/settings"));

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

io.on("connection", () => {
  // no auth needed to receive live order events — order data itself
  // (table number + food items) isn't sensitive, and this keeps the
  // real-time dashboard simple to run anywhere.
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Hangukgwan QR ordering system running on port ${PORT}`);
});
