const express = require("express");
const bcrypt = require("bcryptjs");
const { store, save } = require("../db");
const { requireOwner } = require("../auth");
const { isAdminRole } = require("../accounts");

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

  // This login is not tied to an account row, so any userId left over from
  // an account login on the same browser must go — otherwise
  // /api/account/me would look that account up, find role "customer" on it,
  // and re-sync this session's role back down to customer (that endpoint
  // treats the account row as the source of truth), silently undoing the
  // admin login that just succeeded.
  if (bcrypt.compareSync(password, ownerHash)) {
    delete req.session.userId;
    req.session.isAdmin = true;
    req.session.role = "owner";
    return res.json({ ok: true, role: "owner" });
  }
  if (staffHash && bcrypt.compareSync(password, staffHash)) {
    delete req.session.userId;
    req.session.isAdmin = true;
    req.session.role = "staff";
    return res.json({ ok: true, role: "staff" });
  }
  return res.status(401).json({ error: "wrong_password" });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// admin.js's checkAuth() calls this on every load of /admin to decide
// between the login screen and the dashboard. Since the 2026-09-08 account
// merge, a signed-in *customer* also has a session role, so this must check
// the role's value (isAdminRole) rather than merely that one exists —
// otherwise every customer who logged in on the website would be handed the
// admin dashboard UI. (The API calls that dashboard then makes are
// separately guarded by src/auth.js, which was fixed the same way, so this
// was never the only line standing between a customer and the data — but it
// is the one that decides what they get shown.)
router.get("/me", (req, res) => {
  if (!req.session || !isAdminRole(req.session.role)) return res.json({ isAdmin: false });
  const role = req.session.role;
  const staffPerms = store.settings.staff_permissions || {};
  // NOTE: reservationManage was missing from this list even though it's a
  // real toggle in staff_permissions (see settings.js's STAFF_PERMISSION_KEYS
  // and admin.js's canManageReservations()) — the frontend defaults an
  // unlisted key to true only when `data.permissions` itself is entirely
  // absent, so once /me started returning a permissions object at all, a
  // staff session's actual reservationManage toggle was silently never
  // reaching the browser. Added here alongside the new orderEdit toggle.
  const permissions =
    role === "owner"
      ? { menuEdit: true, tableEdit: true, settingsEdit: true, orderCancel: true, orderEdit: true, reservationManage: true }
      : {
          menuEdit: !!staffPerms.menuEdit,
          tableEdit: !!staffPerms.tableEdit,
          settingsEdit: !!staffPerms.settingsEdit,
          orderCancel: !!staffPerms.orderCancel,
          orderEdit: !!staffPerms.orderEdit,
          reservationManage: !!staffPerms.reservationManage,
        };
  // staffPasswordSet: 사장 화면이 "직원 비밀번호가 아직 정해지지 않았다" 를
  // 띄우기 위한 것. 해시 자체는 절대 내보내지 않는다.
  res.json({ isAdmin: true, role, permissions, staffPasswordSet: !!store.settings.staff_password_hash });
});

// Each role changes its own password (owner changes the owner password,
// staff changes the staff password) — same endpoint, targets whichever
// account is logged in.
// NOTE: this changes the shared 사장/직원 *password*, not an account's
// password (that's POST /api/account/change-password). isAdminRole, not a
// bare role check — a signed-in customer must not reach the branch below
// that picks between the owner and staff password hashes.
router.post("/change-password", async (req, res) => {
  if (!req.session || !isAdminRole(req.session.role)) return res.status(401).json({ error: "not_authenticated" });
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
