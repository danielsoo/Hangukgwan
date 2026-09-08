const { store } = require("./db");
const accounts = require("./accounts");
const { isAdminRole } = accounts;

// Keeps req.session.role honest for account-based logins.
//
// The session cookie lasts 12 hours, so without this an owner who demotes a
// staff member (or deletes their account) would not actually take their
// access away until that cookie happened to expire — the guards below read
// req.session.role, and the copy sitting in that person's session would
// still say "staff" for the rest of the day. For a "직원 그만뒀는데 아직
// 들어가진다" situation that is the whole point of the demote button, so the
// account row is treated as the source of truth and re-checked per request.
//
// Cost: one indexed findOne by _id, and only for sessions that came from an
// account login. The legacy password login (src/routes/auth.js) has no
// userId and is skipped entirely; anonymous customers are skipped too. Every
// /api/* request already pays for a full store refresh from Mongo
// (server.js), so this is small next to what's already there.
async function syncSessionRole(req, res, next) {
  if (!req.session || !req.session.userId) return next();
  try {
    const user = await accounts.findById(req.session.userId);
    if (!user) {
      // Account deleted while they were signed in — end the session rather
      // than leaving it holding a role that belongs to nobody.
      return req.session.destroy(() => next());
    }
    req.session.role = user.role;
    req.session.isAdmin = isAdminRole(user.role);
  } catch (e) {
    // A Mongo hiccup shouldn't log out the whole restaurant mid-service; the
    // request continues on the role already in the session. Anything that
    // actually needs the database is about to fail on its own anyway.
    console.error("[auth] session role sync failed:", e.message);
  }
  next();
}

// ⚠️ 2026-09-08, 계정 통합 시 바뀐 부분 — 이 파일에서 제일 중요한 규칙.
//
// 예전에는 세션에 role이 들어가는 경우가 "owner" 아니면 "staff" 둘뿐이라
// requireAdmin이 `if (req.session.role)`처럼 role이 있기만 하면 통과시켜도
// 안전했다. 이제는 홈페이지에서 로그인한 손님도 role: "customer"로 세션을
//갖기 때문에, 그 검사를 그대로 두면 아무 손님이나 관리자 API를 전부 호출할
// 수 있게 된다(주문 취소, 메뉴 수정, 매출 조회까지). 그래서 아래 세 개의
// 가드는 전부 isAdminRole()(= owner/staff만 true, src/accounts.js)을 거친다.
// 새 가드를 추가할 때도 role의 존재 여부가 아니라 반드시 역할 값을 확인할 것.

// Any authenticated admin session (owner or staff) — used for read access
// and actions every logged-in staff member should always be able to do
// (view orders/menu/tables, advance an order's status, print tickets).
function requireAdmin(req, res, next) {
  if (req.session && isAdminRole(req.session.role)) return next();
  return res.status(401).json({ error: "not_authenticated" });
}

// Gates a specific sensitive action (adding/editing/deleting menu items,
// tables, zones, or store settings). The owner can always do everything;
// a staff session can only do it if the owner has switched that toggle on
// in Admin > 설정 > 직원 권한 관리. Checked server-side (not just hidden in
// the UI) so a staff member can't just call the API directly to bypass it.
function requirePermission(key) {
  return (req, res, next) => {
    if (!req.session || !isAdminRole(req.session.role)) return res.status(401).json({ error: "not_authenticated" });
    if (req.session.role === "owner") return next();
    const allowed = !!(store.settings.staff_permissions && store.settings.staff_permissions[key]);
    if (!allowed) return res.status(403).json({ error: "permission_denied" });
    next();
  };
}

// Owner-only — for actions staff should never be able to do regardless of
// any toggle (granting permissions to themselves, resetting the staff
// password, changing anyone's account role).
function requireOwner(req, res, next) {
  if (req.session && req.session.role === "owner") return next();
  return res.status(401).json({ error: "owner_only" });
}

// Any signed-in account at all, INCLUDING customers — for the "my own
// stuff" endpoints the website needs (내 계정, 내 주문 내역, VIP 카드 등록).
// Deliberately separate from requireAdmin so the two can never be confused
// with each other at a call site.
function requireUser(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: "not_authenticated" });
}

module.exports = { requireAdmin, requirePermission, requireOwner, requireUser, syncSessionRole };
