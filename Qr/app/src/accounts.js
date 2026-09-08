// User accounts — the single login shared by customers, staff and the owner.
//
// 사장님 요청(2026-09-08): "손님 계정이랑 어드민 계정 로그인하는 건 똑같이
// 하지만 어드민 계정만 ... 어드민 페이지로 들어갈 수 있는 버튼을 만들어주고
// 싶어. 어드민도 고객도 홈페이지에 로그인할 수 있고" — 하나의 로그인 화면,
// 하나의 계정 체계, 역할(role)만 다르게. 관리자 페이지 버튼은 역할이
// owner/staff인 계정에만 보인다.
//
// Why a separate Mongo collection instead of a field on the single `store`
// document (src/db.js): `store` is re-read in full on every request and
// re-written in full on every save, so anything that grows without bound and
// is looked up by key does not belong in it. Photos already live in their own
// collection for the same reason. Accounts are looked up by email/google_uid
// on every login, so they get their own collection with real indexes.
//
// Two ways to sign in, ONE account per person:
//   - email + password  (password_hash set)
//   - Google            (google_uid set, via Firebase — the same Firebase
//                        project the VIP membership feature already uses)
// A person who signs up by email and later clicks "Sign in with Google" with
// that same address ends up in the *same* account (linkGoogle below), rather
// than silently getting a second, empty one. That is safe because Google has
// verified the address for us; we only link when the Firebase token itself
// says the email is verified.
const bcrypt = require("bcryptjs");
const { ObjectId } = require("mongodb");
const { connectDB, getDb } = require("./db");

const COLLECTION = "users";
const BCRYPT_COST = 10; // matches the existing admin/staff password hashes
const MIN_PASSWORD_LENGTH = 8;

// Roles, most privileged last. "customer" is the default for anyone who
// signs up from the website; only an owner can grant the other two (see
// src/routes/users.js).
const ROLES = ["customer", "staff", "owner"];
const ADMIN_ROLES = new Set(["owner", "staff"]);

// The one place "does this role get into the admin dashboard" is decided.
// IMPORTANT: before accounts existed, the session only ever held "owner" or
// "staff", so src/auth.js could get away with a truthiness check on
// req.session.role. Now that customers also get a session with a role, that
// check would let every customer into the admin API — every guard must go
// through this function instead.
function isAdminRole(role) {
  return ADMIN_ROLES.has(role);
}

let indexPromise = null;

async function collection() {
  await connectDB();
  const col = getDb().collection(COLLECTION);
  // Created once per process. The unique indexes are the actual guarantee
  // that one email = one account — the find-then-insert checks in
  // createUser() below are a race away from creating duplicates on their
  // own, and Mongo rejecting the second insert is what makes that safe.
  if (!indexPromise) {
    indexPromise = Promise.all([
      col.createIndex({ email: 1 }, { unique: true }),
      // sparse: Google-only accounts have no email/password, email-only
      // accounts have no google_uid — a plain unique index would treat all
      // the missing ones as a single duplicate null.
      col.createIndex({ google_uid: 1 }, { unique: true, sparse: true }),
    ]).catch((e) => {
      // Never let index creation take the app down; a duplicate would still
      // be caught by whichever index did get built, and logging beats a
      // 500 on every login.
      console.error("[accounts] index creation failed:", e.message);
    });
  }
  await indexPromise;
  return col;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

// Deliberately permissive — this rejects obvious typos ("a@b", "no-at-sign")
// without pretending to be a full RFC 5322 validator. The only address that
// truly matters is one the person can receive mail at, which no regex can
// tell us anyway.
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPassword(password) {
  return typeof password === "string" && password.length >= MIN_PASSWORD_LENGTH;
}

// What the browser is allowed to see about an account. Never includes
// password_hash, and never includes another person's row (see
// src/routes/users.js for the owner-only listing, which uses this too —
// an owner managing staff has no business seeing password hashes either).
function publicUser(user) {
  if (!user) return null;
  return {
    id: String(user._id),
    email: user.email || null,
    name: user.name || "",
    phone: user.phone || null,
    role: user.role || "customer",
    isAdmin: isAdminRole(user.role),
    // Which sign-in methods this account can actually use — the 내 계정
    // screen shows "구글 연결됨" / "비밀번호 설정됨" from these, and needs
    // them to stop a Google-only user from being offered "change password".
    hasPassword: !!user.password_hash,
    hasGoogle: !!user.google_uid,
    created_at: user.created_at || null,
  };
}

// OWNER_EMAIL lets the very first owner account exist without a
// chicken-and-egg problem: there is no admin UI to promote anyone until
// somebody is already an owner. Any address listed here (comma-separated)
// is granted the owner role the moment it registers or first signs in with
// Google. Everyone else starts as a customer and can only be promoted by an
// existing owner. Leaving it unset is fine — the legacy password login
// (POST /api/auth/login, still in place) is the other way in.
function bootstrapRoleFor(email) {
  const configured = String(process.env.OWNER_EMAIL || "")
    .split(",")
    .map((e) => normalizeEmail(e))
    .filter(Boolean);
  return configured.includes(normalizeEmail(email)) ? "owner" : "customer";
}

async function findByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return (await collection()).findOne({ email: normalized });
}

async function findByGoogleUid(uid) {
  if (!uid) return null;
  return (await collection()).findOne({ google_uid: uid });
}

async function findById(id) {
  if (!id || !ObjectId.isValid(String(id))) return null;
  return (await collection()).findOne({ _id: new ObjectId(String(id)) });
}

// Creates an email+password account. Throws "email_taken" if the address is
// already in use — including when the race that the unique index catches
// happens (Mongo error code 11000), so callers only have one error to handle.
async function createEmailUser({ email, password, name, phone }) {
  const normalized = normalizeEmail(email);
  const col = await collection();
  const doc = {
    email: normalized,
    password_hash: bcrypt.hashSync(password, BCRYPT_COST),
    google_uid: null,
    name: String(name || "").trim(),
    phone: String(phone || "").trim() || null,
    role: bootstrapRoleFor(normalized),
    created_at: new Date(),
    last_login_at: new Date(),
  };
  try {
    const result = await col.insertOne(doc);
    return { ...doc, _id: result.insertedId };
  } catch (e) {
    if (e && e.code === 11000) throw new Error("email_taken");
    throw e;
  }
}

// Finds-or-creates the account behind a verified Firebase (Google) sign-in.
// Three cases, in order:
//   1. We already know this google_uid  → that's the account.
//   2. Same email as an existing account → link Google to it, so signing up
//      by email and later using the Google button stays one account.
//   3. Neither → brand new Google-only account.
// `firebaseUser` must come from firebaseAdmin.verifyIdToken() — never from
// anything the browser claims about itself.
async function findOrCreateGoogleUser(firebaseUser) {
  const col = await collection();
  const existing = await findByGoogleUid(firebaseUser.uid);
  if (existing) return existing;

  const normalized = normalizeEmail(firebaseUser.email);
  if (normalized) {
    const byEmail = await col.findOne({ email: normalized });
    if (byEmail) {
      // Only link when this account has no *other* Google identity already
      // attached; otherwise two Google accounts sharing one address (which
      // shouldn't happen, but) would fight over the same row.
      if (!byEmail.google_uid) {
        await col.updateOne(
          { _id: byEmail._id },
          { $set: { google_uid: firebaseUser.uid, last_login_at: new Date(), name: byEmail.name || firebaseUser.name || "" } }
        );
        return col.findOne({ _id: byEmail._id });
      }
      return byEmail;
    }
  }

  const doc = {
    email: normalized || null,
    password_hash: null,
    google_uid: firebaseUser.uid,
    name: String(firebaseUser.name || "").trim(),
    phone: null,
    role: bootstrapRoleFor(normalized),
    created_at: new Date(),
    last_login_at: new Date(),
  };
  try {
    const result = await col.insertOne(doc);
    return { ...doc, _id: result.insertedId };
  } catch (e) {
    // Lost a race with a concurrent sign-in of the same person — the row we
    // wanted now exists, so use it rather than failing their login.
    if (e && e.code === 11000) {
      return (await findByGoogleUid(firebaseUser.uid)) || (normalized ? col.findOne({ email: normalized }) : null);
    }
    throw e;
  }
}

// bcrypt.compareSync against a null/absent hash would throw, so Google-only
// accounts (no password set) correctly answer "no" here instead of 500ing.
function verifyPassword(user, password) {
  if (!user || !user.password_hash || !password) return false;
  return bcrypt.compareSync(password, user.password_hash);
}

async function touchLogin(userId) {
  const col = await collection();
  await col.updateOne({ _id: new ObjectId(String(userId)) }, { $set: { last_login_at: new Date() } });
}

async function updateProfile(userId, { name, phone }) {
  const col = await collection();
  const set = {};
  if (name != null) set.name = String(name).trim();
  if (phone != null) set.phone = String(phone).trim() || null;
  if (Object.keys(set).length) await col.updateOne({ _id: new ObjectId(String(userId)) }, { $set: set });
  return findById(userId);
}

async function setPassword(userId, newPassword) {
  const col = await collection();
  await col.updateOne(
    { _id: new ObjectId(String(userId)) },
    { $set: { password_hash: bcrypt.hashSync(newPassword, BCRYPT_COST) } }
  );
}

async function setRole(userId, role) {
  if (!ROLES.includes(role)) throw new Error("invalid_role");
  const col = await collection();
  await col.updateOne({ _id: new ObjectId(String(userId)) }, { $set: { role } });
  return findById(userId);
}

// Owner-only account listing for the admin 계정 tab. Newest first, and
// capped — this is a management screen, not an export.
async function listUsers({ limit = 200 } = {}) {
  const col = await collection();
  return col.find({}).sort({ created_at: -1 }).limit(limit).toArray();
}

async function countAdmins() {
  const col = await collection();
  return col.countDocuments({ role: { $in: ["owner", "staff"] } });
}

async function countOwners() {
  const col = await collection();
  return col.countDocuments({ role: "owner" });
}

module.exports = {
  ROLES,
  MIN_PASSWORD_LENGTH,
  isAdminRole,
  normalizeEmail,
  isValidEmail,
  isValidPassword,
  publicUser,
  findByEmail,
  findByGoogleUid,
  findById,
  createEmailUser,
  findOrCreateGoogleUser,
  verifyPassword,
  touchLogin,
  updateProfile,
  setPassword,
  setRole,
  listUsers,
  countAdmins,
  countOwners,
};
