const { store } = require("./db");

// Any authenticated admin session (owner or staff) — used for read access
// and actions every logged-in staff member should always be able to do
// (view orders/menu/tables, advance an order's status, print tickets).
function requireAdmin(req, res, next) {
  if (req.session && req.session.role) return next();
  return res.status(401).json({ error: "not_authenticated" });
}

// Gates a specific sensitive action (adding/editing/deleting menu items,
// tables, zones, or store settings). The owner can always do everything;
// a staff session can only do it if the owner has switched that toggle on
// in Admin > 설정 > 직원 권한 관리. Checked server-side (not just hidden in
// the UI) so a staff member can't just call the API directly to bypass it.
function requirePermission(key) {
  return (req, res, next) => {
    if (!req.session || !req.session.role) return res.status(401).json({ error: "not_authenticated" });
    if (req.session.role === "owner") return next();
    const allowed = !!(store.settings.staff_permissions && store.settings.staff_permissions[key]);
    if (!allowed) return res.status(403).json({ error: "permission_denied" });
    next();
  };
}

// Owner-only — for actions staff should never be able to do regardless of
// any toggle (granting permissions to themselves, resetting the staff
// password).
function requireOwner(req, res, next) {
  if (req.session && req.session.role === "owner") return next();
  return res.status(401).json({ error: "owner_only" });
}

module.exports = { requireAdmin, requirePermission, requireOwner };
