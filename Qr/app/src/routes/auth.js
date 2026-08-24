const express = require("express");
const bcrypt = require("bcryptjs");
const { store, save } = require("../db");
const { requireOwner } = require("../auth");

const router = express.Router();

// One shared password field, but two different accounts behind it — we try
// the owner's password first, then the staff password, and remember which
// one matched as the session's role. Owner always has full access; staff
// only gets whatever the owner has switched on in Admin > 설정 > 직원 권한 관리.
router.post("/login", (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: "password_required" });

  const ownerHash = store.settings.admin_password_hash;
  const staffHash = store.settings.staff_password_hash;
  if (!ownerHash) return res.status(500).json({ error: "admin_not_configured" });

  if (bcrypt.compareSync(password, ownerHash)) {
    req.session.isAdmin = true;
    req.session.role = "owner";
    return res.json({ ok: true, role: "owner" });
  }
  if (staffHash && bcrypt.compareSync(password, staffHash)) {
    req.session.isAdmin = true;
    req.session.role = "staff";
    return res.json({ ok: true, role: "staff" });
  }
  return res.status(401).json({ error: "wrong_password" });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get("/me", (req, res) => {
  if (!req.session || !req.session.role) return res.json({ isAdmin: false });
  const role = req.session.role;
  const staffPerms = store.settings.staff_permissions || {};
  const permissions =
    role === "owner"
      ? { menuEdit: true, tableEdit: true, settingsEdit: true, orderCancel: true }
      : {
          menuEdit: !!staffPerms.menuEdit,
          tableEdit: !!staffPerms.tableEdit,
          settingsEdit: !!staffPerms.settingsEdit,
          orderCancel: !!staffPerms.orderCancel,
        };
  res.json({ isAdmin: true, role, permissions });
});

// Each role changes its own password (owner changes the owner password,
// staff changes the staff password) — same endpoint, targets whichever
// account is logged in.
router.post("/change-password", async (req, res) => {
  if (!req.session || !req.session.role) return res.status(401).json({ error: "not_authenticated" });
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "invalid_input" });
  }
  const hashKey = req.session.role === "owner" ? "admin_password_hash" : "staff_password_hash";
  if (!store.settings[hashKey] || !bcrypt.compareSync(currentPassword, store.settings[hashKey])) {
    return res.status(401).json({ error: "wrong_current_password" });
  }
  store.settings[hashKey] = bcrypt.hashSync(newPassword, 10);
  await save();
  res.json({ ok: true });
});

// Owner-only: (re)set the staff password directly, without needing to know
// the old one — e.g. the very first time, or if a staff member forgets it.
router.post("/set-staff-password", requireOwner, async (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: "invalid_input" });
  store.settings.staff_password_hash = bcrypt.hashSync(newPassword, 10);
  await save();
  res.json({ ok: true });
});

module.exports = router;
