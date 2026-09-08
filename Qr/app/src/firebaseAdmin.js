// Server-side verification for the customer "회원(VIP)" login — a customer
// signs in with Google in the browser using the Firebase client SDK (see
// public/js/order.js, initialized from store.settings.firebase_web_config —
// Admin > 설정 > 회원(VIP) 로그인 설정), which is fine to expose publicly:
// Firebase's web config is not a secret, it just names which Firebase
// project a request claims to belong to. The actual trust boundary is here:
// every request that says "I am this signed-in user" carries a Firebase ID
// token, and this file is what proves that token is genuinely signed by
// Google/Firebase for the project we expect, not something a client made up
// (which is exactly the requirement for a discount feature people have a
// financial incentive to fake).
//
// Needs a Firebase service account key set as the FIREBASE_SERVICE_ACCOUNT
// env var (the whole JSON key file's contents, as one string) — generated
// from Firebase Console > Project settings > Service accounts > Generate
// new private key. Never checked into the repo; set only in Vercel's
// environment variables, the same way MONGODB_URI already is.
//
// Every function below degrades gracefully to "not configured" instead of
// throwing when that env var is missing, so the rest of the app keeps
// working normally before the owner finishes the one-time Firebase setup —
// same pattern as checkLocation() in src/routes/orders.js treating an
// unconfigured store_lat/store_lng as "feature not enabled yet".
let adminApp = null;
let initTried = false;

function getAdminApp() {
  if (initTried) return adminApp;
  initTried = true;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    // firebase-admin v13 부터는 예전의 `admin.credential.cert(...)` /
    // `admin.apps` / `app.auth()` 네임스페이스가 사라지고 아래의 모듈식
    // API 만 남았다. package.json 이 ^14 를 받고 있으므로 여기도 그쪽을
    // 쓴다. 예전 방식으로 두면 키를 제대로 넣어도 초기화 단계에서
    // "Cannot read properties of undefined (reading 'cert')" 로 조용히
    // 실패해서, Google 로그인만 안 되는 상태가 된다.
    const { initializeApp, getApp, getApps, cert } = require("firebase-admin/app");
    const serviceAccount = JSON.parse(raw);
    adminApp = getApps().length ? getApp() : initializeApp({ credential: cert(serviceAccount) });
    return adminApp;
  } catch (e) {
    console.error("[firebaseAdmin] failed to initialize — check FIREBASE_SERVICE_ACCOUNT:", e.message);
    return null;
  }
}

// true once FIREBASE_SERVICE_ACCOUNT is present and parses as valid JSON
// (doesn't guarantee the credentials themselves are valid — that only shows
// up the first time a real token verification is attempted).
function isConfigured() {
  return !!getAdminApp();
}

// Verifies a Firebase ID token (the `Authorization: Bearer <token>` header
// public/js/order.js sends once a customer is signed in). Returns
// { uid, email, name } on success, or null on any failure — an expired,
// tampered, or missing token, or Firebase not configured yet. Callers treat
// null as "not signed in" rather than surfacing a distinct error, since an
// anonymous customer and an invalid token should behave identically (order
// without any VIP discount, no access to /api/members endpoints).
async function verifyIdToken(idToken) {
  const app = getAdminApp();
  if (!app || !idToken) return null;
  try {
    const { getAuth } = require("firebase-admin/auth");
    const decoded = await getAuth(app).verifyIdToken(idToken);
    return { uid: decoded.uid, email: decoded.email || null, name: decoded.name || decoded.email || "손님" };
  } catch (e) {
    return null;
  }
}

module.exports = { isConfigured, verifyIdToken };
