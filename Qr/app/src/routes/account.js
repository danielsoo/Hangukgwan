// The unified login used by BOTH customers and admins (사장님 요청
// 2026-09-08: "손님 계정이랑 어드민 계정 로그인하는 건 똑같이"). One form on
// the website, one account per person, one session cookie — the only
// difference between a customer and the owner is the `role` on their
// account, which decides whether the site shows the 관리자 페이지 button and
// whether src/auth.js's guards let them into /api/* admin endpoints.
//
// The legacy password-only admin login (POST /api/auth/login, src/routes/
// auth.js) is deliberately left in place: it is the fallback that keeps the
// owner from ever being locked out of /admin if something here (or the
// Firebase setup) goes wrong, and it is how the first owner account gets
// promoted before OWNER_EMAIL is set. Both write the same session fields.
const express = require("express");
const accounts = require("../accounts");
const { verifyIdToken, isConfigured } = require("../firebaseAdmin");
const { requireUser } = require("../auth");
const { store } = require("../db");

const router = express.Router();

// Every successful sign-in — email or Google, customer or owner — funnels
// through here, so the session always looks the same regardless of how the
// person got in. `isAdmin` is kept for the existing admin.js frontend, which
// has read req.session.isAdmin-shaped responses since before accounts
// existed; `role` is what the server actually enforces on.
function startSession(req, user) {
  req.session.userId = String(user._id);
  req.session.role = user.role || "customer";
  req.session.isAdmin = accounts.isAdminRole(user.role);
}

// Signing in must never silently keep the *previous* person's session data
// (a shared tablet at the counter is the realistic case). regenerate() also
// rotates the session id, which is the standard defence against session
// fixation — an attacker who somehow set a known cookie beforehand can't
// ride it into the account that just logged in.
function regenerateAndStart(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      startSession(req, user);
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}

// ---------- 회원가입 (이메일) ----------
router.post("/register", async (req, res) => {
  const { email, password, name, phone } = req.body || {};
  const normalized = accounts.normalizeEmail(email);

  if (!accounts.isValidEmail(normalized)) return res.status(400).json({ error: "invalid_email" });
  if (!accounts.isValidPassword(password)) {
    return res.status(400).json({ error: "weak_password", minLength: accounts.MIN_PASSWORD_LENGTH });
  }
  if (!String(name || "").trim()) return res.status(400).json({ error: "name_required" });

  try {
    const user = await accounts.createEmailUser({ email: normalized, password, name, phone });
    await regenerateAndStart(req, user);
    res.json({ user: accounts.publicUser(user) });
  } catch (e) {
    if (e.message === "email_taken") return res.status(409).json({ error: "email_taken" });
    console.error("[account] register failed:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------- 로그인 (이메일) ----------
router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  try {
    const user = await accounts.findByEmail(email);
    // One generic error for "no such account" and "wrong password" alike —
    // telling them apart would let anyone check which addresses are
    // registered here.
    if (!user || !accounts.verifyPassword(user, password)) {
      return res.status(401).json({ error: "invalid_credentials" });
    }
    await regenerateAndStart(req, user);
    await accounts.touchLogin(user._id);
    res.json({ user: accounts.publicUser(user) });
  } catch (e) {
    console.error("[account] login failed:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------- 로그인/회원가입 (구글) ----------
// The browser signs in with Firebase (the same Firebase project the VIP
// membership feature already uses — Admin > 설정 > 회원(VIP) 로그인) and
// sends the resulting ID token here ONCE. From then on this app's own
// session cookie is what identifies them, so the rest of the site never has
// to juggle Firebase tokens. The token is verified server-side; nothing the
// browser claims about who it is, is trusted.
router.post("/google", async (req, res) => {
  const { idToken } = req.body || {};
  if (!isConfigured()) return res.status(503).json({ error: "google_login_not_configured" });
  if (!idToken) return res.status(400).json({ error: "id_token_required" });

  try {
    const firebaseUser = await verifyIdToken(idToken);
    if (!firebaseUser) return res.status(401).json({ error: "invalid_token" });

    const user = await accounts.findOrCreateGoogleUser(firebaseUser);
    if (!user) return res.status(500).json({ error: "server_error" });

    await regenerateAndStart(req, user);
    await accounts.touchLogin(user._id);
    res.json({ user: accounts.publicUser(user) });
  } catch (e) {
    console.error("[account] google login failed:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------- 로그아웃 ----------
router.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ---------- 내 정보 ----------
// The website calls this on every page load to decide what the header shows:
// 로그인 버튼, or the person's name plus — for owner/staff only — the
// 관리자 페이지 button. Answers 200 with user:null when signed out, because
// "nobody is logged in" is a normal answer here, not an error.
router.get("/me", async (req, res) => {
  // A session created by the legacy password login has a role but no
  // userId — there is no account row behind it. Report it honestly so the
  // site can still show "관리자로 로그인됨" without inventing a profile.
  if (req.session && req.session.userId) {
    const user = await accounts.findById(req.session.userId);
    if (!user) {
      // Account deleted out from under a live session.
      return req.session.destroy(() => res.json({ user: null, isAdmin: false }));
    }
    // The role on the account row is the source of truth, not the copy in
    // the session — an owner demoting someone shouldn't have to wait for
    // that person's 12-hour cookie to expire. Re-sync it here.
    if (req.session.role !== user.role) {
      req.session.role = user.role;
      req.session.isAdmin = accounts.isAdminRole(user.role);
    }
    return res.json({ user: accounts.publicUser(user), isAdmin: accounts.isAdminRole(user.role) });
  }

  if (req.session && accounts.isAdminRole(req.session.role)) {
    return res.json({
      user: null,
      isAdmin: true,
      role: req.session.role,
      legacyPasswordLogin: true,
    });
  }

  res.json({ user: null, isAdmin: false });
});

// ---------- 내 정보 수정 ----------
router.patch("/me", requireUser, async (req, res) => {
  const { name, phone } = req.body || {};
  if (name != null && !String(name).trim()) return res.status(400).json({ error: "name_required" });
  try {
    const user = await accounts.updateProfile(req.session.userId, { name, phone });
    res.json({ user: accounts.publicUser(user) });
  } catch (e) {
    console.error("[account] profile update failed:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------- 비밀번호 변경 / 최초 설정 ----------
// Also covers a Google-only account adding a password for the first time —
// in that case there is no current password to check, and the signed-in
// session is itself the proof of identity.
router.post("/change-password", requireUser, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!accounts.isValidPassword(newPassword)) {
    return res.status(400).json({ error: "weak_password", minLength: accounts.MIN_PASSWORD_LENGTH });
  }
  try {
    const user = await accounts.findById(req.session.userId);
    if (!user) return res.status(401).json({ error: "not_authenticated" });
    if (user.password_hash && !accounts.verifyPassword(user, currentPassword)) {
      return res.status(401).json({ error: "wrong_current_password" });
    }
    await accounts.setPassword(user._id, newPassword);
    res.json({ ok: true });
  } catch (e) {
    console.error("[account] change-password failed:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------- 내 주문 내역 ----------
// 사장님 요청(2026-09-08): 손님이 로그인하면 "주문 내역 조회"가 되게.
//
// 지금까지 손님의 주문 내역은 그 브라우저의 localStorage("hgk_orders_<테이블>",
// public/js/order.js)에만 있었다. 기기를 바꾸거나 캐시를 지우면 사라지고,
// 애초에 테이블별로 나뉘어 있어서 "내가 이 가게에서 시킨 것들"이라는 목록이
// 될 수 없었다. 이제 로그인 상태로 주문하면 주문에 account_id 가 남고
// (src/routes/orders.js), 여기서 그걸 모아 돌려준다.
//
// 다른 사람 주문이 섞일 수 없도록 반드시 세션의 userId 로만 거른다 —
// 쿼리 파라미터로 계정을 받지 않는다.
router.get("/orders", requireUser, (req, res) => {
  const mine = store.orders
    .filter((o) => o.account_id && String(o.account_id) === String(req.session.userId))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 50)
    .map((o) => ({
      id: o.id,
      table_number: o.table_number,
      pickup_number: o.pickup_number || null,
      status: o.status,
      order_type: o.order_type,
      subtotal: o.subtotal,
      total: o.total,
      vip_card_number: o.vip_card_number || null,
      vip_discount_percent: o.vip_discount_percent || null,
      created_at: o.created_at,
      items: (o.items || []).map((it) => ({
        name_zh: it.name_zh,
        name_ko: it.name_ko,
        name_en: it.name_en,
        qty: it.qty,
        unit_price: it.unit_price,
        option_choice: it.option_choice || null,
        spice_choice: it.spice_choice || null,
        order_type: it.order_type || null,
        selected_addons: it.selected_addons || [],
      })),
    }));
  res.json({ orders: mine });
});

// Tells the website which sign-in buttons to render — there is no point
// showing "구글로 계속하기" before the owner has finished the Firebase setup
// (same "degrade to not-configured" pattern as firebaseAdmin.js).
router.get("/methods", (req, res) => {
  res.json({ email: true, google: isConfigured() });
});

module.exports = router;
