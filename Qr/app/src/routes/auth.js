const express = require("express");
const bcrypt = require("bcryptjs");
const { store, save } = require("../db");

const router = express.Router();

router.post("/login", (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: "password_required" });

  const hash = store.settings.admin_password_hash;
  if (!hash) return res.status(500).json({ error: "admin_not_configured" });

  const ok = bcrypt.compareSync(password, hash);
  if (!ok) return res.status(401).json({ error: "wrong_password" });

  req.session.isAdmin = true;
  res.json({ ok: true });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get("/me", (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

router.post("/change-password", async (req, res) => {
  if (!req.session || !req.session.isAdmin) return res.status(401).json({ error: "not_authenticated" });
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "invalid_input" });
  }
  if (!bcrypt.compareSync(currentPassword, store.settings.admin_password_hash)) {
    return res.status(401).json({ error: "wrong_current_password" });
  }
  store.settings.admin_password_hash = bcrypt.hashSync(newPassword, 10);
  await save();
  res.json({ ok: true });
});

module.exports = router;
