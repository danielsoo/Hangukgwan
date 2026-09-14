const express = require("express");
const bcrypt = require("bcryptjs");
const { store, save, getDb, connectDB } = require("../db");
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

router.post("/logout", async (req, res) => {
  // 테스터 모드에 참여한 채로 로그아웃하면 그 자리도 같이 비운다.
  //
  // 2026-09-13 에 이게 없어서 사고가 났다. 참여 표시는 로그인 세션 안에만
  // 있었는데(req.session.testSessionId), 로그인 세션은 12시간이면 만료된다.
  // 참여했던 기기들이 하나씩 조용히 빠져나가고 테스터 세션만 남아, 아무도
  // 안 들어 있는 채로 하루 넘게 켜져 있었다. 누가 마지막인지 알 수 없으니
  // 아무도 끄지 못했다.
  const testId = req.session && req.session.testSessionId;
  if (testId) {
    try {
      const testMode = require("../testMode");
      await connectDB();
      await testMode.leaveDevice(getDb(), testId, req.sessionID);
    } catch (e) {
      // 자리 하나 못 비웠다고 로그아웃이 막히면 안 된다.
    }
  }
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
  // 이 세션이 언제 끝나는가.
  //
  // 2026-09-14 사장님: "로딩할 때마다 로그인 화면이 떠. 그거 없애줄 수 있어?"
  //
  // 관리자 화면은 뜰 때 「로그인 화면」인 채로 시작해서, 이 답을 받아야
  // 대시보드로 바꾼다. 그 사이가 사장님이 보신 그 화면이다. 화면이 지난번
  // 답을 기억해 두면 그 사이를 없앨 수 있는데, 기억이 세션보다 오래 살면
  // 반대로 「대시보드가 떴다가 로그인으로 튕기는」 화면이 된다.
  //
  // 그래서 끝나는 시각을 같이 준다. 화면은 그 시각까지만 기억을 믿는다.
  // 비밀도 아니다 — 자기 세션이 언제 끝나는지 본인에게 알려주는 것뿐이다.
  const expires = req.session.cookie && req.session.cookie.expires;
  res.json({
    isAdmin: true,
    role,
    permissions,
    staffPasswordSet: !!store.settings.staff_password_hash,
    expiresAt: expires ? new Date(expires).toISOString() : null,
  });
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
