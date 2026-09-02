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
    const admin = require("firebase-admin");
    const serviceAccount = JSON.parse(raw);
    adminApp = admin.apps && admin.apps.length ? admin.app() : admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
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
    const decoded = await app.auth().verifyIdToken(idToken);
    return { uid: decoded.uid, email: decoded.email || null, name: decoded.name || decoded.email || "손님" };
  } catch (e) {
    return null;
  }
}

module.exports = { isConfigured, verifyIdToken };
