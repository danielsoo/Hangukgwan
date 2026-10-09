const crypto = require("crypto");
const { connectDB, getDb } = require("./db");

const COLLECTION = "owner_login_activity";
// 관리자 화면이 1분마다 신호를 보낸다. 백그라운드 탭의 타이머가 조금
// 늦어져도 바로 꺼진 것으로 보이지 않도록 두 번 반의 간격을 둔다.
const ONLINE_WINDOW_MS = 150 * 1000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
// 관리자 API는 몇 초마다 들어온다. 접속 기록 때문에 그때마다 Mongo를 쓰지
// 않도록 인스턴스 안에서 최근 신호를 잠깐 기억한다. 세션 객체에 적으면
// connect-mongo가 세션까지 다시 저장하므로 주문 처리 성능이 나빠진다.
const recentTouches = new Map();

function sessionKey(req) {
  const sid = String((req && req.sessionID) || "");
  if (!sid) return null;
  // 세션 ID 자체는 로그인 권한과 다름없다. 기록 화면이나 DB에 원문을 남기지
  // 않고, 서버 비밀키로 만든 되돌릴 수 없는 표지만 저장한다.
  return crypto
    .createHmac("sha256", process.env.SESSION_SECRET || "dev-secret-change-me")
    .update(sid)
    .digest("hex");
}

function cleanHeader(value, max = 160) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  let text = String(raw).trim();
  try {
    text = decodeURIComponent(text);
  } catch (e) {
    // 인코딩이 잘못된 프록시 헤더는 원문을 짧게 잘라 쓴다.
  }
  return text ? text.slice(0, max) : null;
}

function requestIp(req) {
  // Vercel/Express가 신뢰하는 가장 가까운 프록시 뒤의 주소를 우선한다.
  // 로컬·테스트 환경에서는 x-forwarded-for 또는 socket 주소로 내려간다.
  const forwarded = cleanHeader(req && req.headers && req.headers["x-forwarded-for"], 200);
  const first = forwarded && forwarded.split(",")[0].trim();
  const ip = first || (req && req.ip) || (req && req.socket && req.socket.remoteAddress) || null;
  return ip ? String(ip).replace(/^::ffff:/, "").slice(0, 80) : null;
}

function describeDevice(userAgent) {
  const ua = String(userAgent || "");
  let device = "기기 정보 없음";
  if (/Hangukgwan|HGKiosk|wv\)/i.test(ua)) device = "한국관 POS 앱";
  else if (/iPad/i.test(ua)) device = "iPad";
  else if (/iPhone/i.test(ua)) device = "iPhone";
  else if (/Android/i.test(ua)) device = /Mobile/i.test(ua) ? "Android 휴대폰" : "Android 태블릿";
  else if (/Windows/i.test(ua)) device = "Windows PC";
  else if (/Macintosh|Mac OS X/i.test(ua)) device = "Mac";
  else if (/Linux/i.test(ua)) device = "Linux 기기";

  let browser = "";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\//i.test(ua)) browser = "Opera";
  else if (/CriOS|Chrome\//i.test(ua)) browser = "Chrome";
  else if (/FxiOS|Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua)) browser = "Safari";
  return browser ? `${device} · ${browser}` : device;
}

function requestDetails(req) {
  const h = (req && req.headers) || {};
  const userAgent = cleanHeader(h["user-agent"], 500);
  return {
    ip: requestIp(req),
    city: cleanHeader(h["x-vercel-ip-city"]),
    region: cleanHeader(h["x-vercel-ip-country-region"]),
    country: cleanHeader(h["x-vercel-ip-country"]),
    device: describeDevice(userAgent),
  };
}

function sessionExpiry(req) {
  const value = req && req.session && req.session.cookie && req.session.cookie.expires;
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

async function collection() {
  await connectDB();
  return getDb().collection(COLLECTION);
}

async function recordLogin(req, { method = "shared_password", email = null, userId = null, role = null } = {}) {
  const key = sessionKey(req);
  if (!key) return false;
  const now = new Date();
  const sessionRole = role || (req && req.session && req.session.role);
  const row = {
    session_key: key,
    user_id: userId ? String(userId) : null,
    account_email: email ? String(email).trim().toLowerCase().slice(0, 254) : null,
    login_method: String(method || "shared_password").slice(0, 40),
    role: sessionRole === "staff" ? "staff" : "owner",
    logged_in_at: now,
    last_seen_at: now,
    logged_out_at: null,
    expires_at: sessionExpiry(req),
    ...requestDetails(req),
  };
  const col = await collection();
  await col.updateOne({ session_key: key }, { $set: row }, { upsert: true });
  recentTouches.set(key, now.getTime());
  return true;
}

async function touch(req) {
  const key = sessionKey(req);
  if (!key) return false;
  const col = await collection();
  const now = new Date();
  const existing = await col.findOne({ session_key: key });
  if (!existing) {
    // 배포 전에 이미 로그인돼 있던 사장 세션도 첫 신호부터 보이게 한다.
    // 실제 로그인 시각을 모르므로 방법을 existing_session으로 분명히 적는다.
    return recordLogin(req, {
      method: "existing_session",
      userId: req && req.session && req.session.userId,
      role: req && req.session && req.session.role,
    });
  }
  await col.updateOne(
    { session_key: key },
    {
      $set: {
        last_seen_at: now,
        expires_at: sessionExpiry(req),
        role: req && req.session && req.session.role === "staff" ? "staff" : "owner",
      },
    }
  );
  recentTouches.set(key, now.getTime());
  return true;
}

async function touchIfDue(req, intervalMs = 55 * 1000) {
  const key = sessionKey(req);
  if (!key) return false;
  const now = Date.now();
  const last = recentTouches.get(key) || 0;
  if (now - last < intervalMs) return false;

  // 오래 켜 두는 서버 인스턴스에서도 맵이 끝없이 자라지 않게 가끔 청소한다.
  if (recentTouches.size > 1000) {
    const staleBefore = now - 12 * 60 * 60 * 1000;
    for (const [storedKey, touchedAt] of recentTouches) {
      if (touchedAt < staleBefore) recentTouches.delete(storedKey);
    }
  }

  // 동시 요청 두 개가 함께 들어와도 한 번만 쓰도록 먼저 표시한다. 실패하면
  // 지워 다음 관리자 요청에서 다시 시도한다.
  recentTouches.set(key, now);
  try {
    await touch(req);
    return true;
  } catch (e) {
    recentTouches.delete(key);
    throw e;
  }
}

function forgetRecentTouch(req) {
  const key = sessionKey(req);
  if (key) recentTouches.delete(key);
}

async function recordLogout(req) {
  const key = sessionKey(req);
  if (!key) return false;
  const now = new Date();
  const col = await collection();
  const result = await col.updateOne(
    { session_key: key },
    { $set: { last_seen_at: now, logged_out_at: now } }
  );
  recentTouches.delete(key);
  return !!(result && result.matchedCount);
}

function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function listRecent(limit = DEFAULT_LIMIT, now = new Date()) {
  const safeLimit = Math.max(1, Math.min(MAX_LIMIT, Number(limit) || DEFAULT_LIMIT));
  const col = await collection();
  const rows = await col.find({}).sort({ logged_in_at: -1 }).limit(safeLimit).toArray();
  const current = new Date(now).getTime();
  return rows.map((row) => {
    const lastSeen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
    const expires = row.expires_at ? new Date(row.expires_at).getTime() : Infinity;
    const online = !row.logged_out_at && lastSeen >= current - ONLINE_WINDOW_MS && expires > current;
    return {
      id: String(row._id || row.session_key),
      accountEmail: row.account_email || null,
      // 이 기능이 생기기 전에 저장된 행은 모두 사장 로그인뿐이었다.
      role: row.role === "staff" ? "staff" : "owner",
      loginMethod: row.login_method || "shared_password",
      loggedInAt: iso(row.logged_in_at),
      lastSeenAt: iso(row.last_seen_at),
      loggedOutAt: iso(row.logged_out_at),
      expiresAt: iso(row.expires_at),
      isOnline: online,
      ip: row.ip || null,
      city: row.city || null,
      region: row.region || null,
      country: row.country || null,
      device: row.device || "기기 정보 없음",
    };
  });
}

module.exports = {
  COLLECTION,
  ONLINE_WINDOW_MS,
  sessionKey,
  requestDetails,
  describeDevice,
  recordLogin,
  touch,
  touchIfDue,
  forgetRecentTouch,
  recordLogout,
  listRecent,
};
