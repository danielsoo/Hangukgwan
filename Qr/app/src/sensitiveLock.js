// 급여·결산 잠금 — 로그인 비밀번호와 다른 비밀번호를 그 탭에 들어갈 때마다 묻는다.
//
// 2026-10-04 사장님: "사장 탭에 급여와 결산이 직원들이나 다른 사람한테 엑세스가 될까봐 걱정이
// 된대 그래서 그 탭 들어갈 때마다 비밀번호 치게 해줘. 비밀번호 설정에서 한 번 저장하게 해줘.
// 로그인 비번이랑 결산 급여 비번은 다르게"
//
// · 비밀번호는 store.settings.sensitive_pin_hash(bcrypt) 하나 — 사장님이 설정 > 계정에서 정한다.
//   정하기 전에는 잠그지 않는다(예전처럼 열린다).
// · 풀림은 **세션에** 탭마다 남는다(sensitiveUnlock.{payroll|settlement} = 만료 시각). 화면은 탭을
//   떠날 때 다시 잠그고, 들어올 때마다 묻는다. 탭에 그대로 둔 채 자리를 떠도 15분 동안 아무 요청이
//   없으면 저절로 잠긴다(요청이 오면 15분을 다시 센다).
// · 화면만 막으면 주소로 직접 부르면 그만이라 **서버가** 막는다 — 잠긴 동안 그 길은 423.
//   401 이 아니라 423 인 이유: 화면은 401 을 「로그인이 풀렸다」로 보고 로그인 화면으로 보낸다.
// · 다섯 번 틀리면 5분 동안 그 세션은 더 못 친다.
const bcrypt = require("bcryptjs");
const { store, saveFields } = require("./db");

// 2026-10-04: 식자재(매입 금액)도 같은 자리다 — 사장님: "사장님만 보이게."
const AREAS = ["payroll", "settlement", "ingredients"];
const TTL_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const BLOCK_MS = 5 * 60 * 1000;
const MIN_LEN = 4;

const pinSet = () => !!(store.settings && store.settings.sensitive_pin_hash);

function isUnlocked(req, area, now = Date.now()) {
  if (!pinSet()) return true;
  const u = req.session && req.session.sensitiveUnlock;
  return !!(u && u[area] && u[area] > now);
}

function requireUnlocked(area) {
  return (req, res, next) => {
    const now = Date.now();
    if (!isUnlocked(req, area, now)) return res.status(423).json({ error: "locked", area });
    if (pinSet()) req.session.sensitiveUnlock[area] = now + TTL_MS; // 쓰는 동안은 안 잠긴다
    next();
  };
}

/** 비밀번호를 맞히면 그 탭을 푼다. { ok } | { error, status, retryAfter } */
function unlock(req, area, pin, now = Date.now()) {
  if (!AREAS.includes(area)) return { status: 400, error: "bad_area" };
  if (!pinSet()) return { ok: true };
  const s = req.session;
  if (s.pinBlockedUntil && s.pinBlockedUntil > now) return { status: 429, error: "too_many", retryAfter: Math.ceil((s.pinBlockedUntil - now) / 1000) };
  if (!pin || !bcrypt.compareSync(String(pin), store.settings.sensitive_pin_hash)) {
    s.pinFails = (s.pinFails || 0) + 1;
    if (s.pinFails >= MAX_FAILS) {
      s.pinFails = 0;
      s.pinBlockedUntil = now + BLOCK_MS;
      return { status: 429, error: "too_many", retryAfter: Math.ceil(BLOCK_MS / 1000) };
    }
    return { status: 401, error: "wrong_pin", left: MAX_FAILS - s.pinFails };
  }
  s.pinFails = 0;
  s.sensitiveUnlock = s.sensitiveUnlock || {};
  s.sensitiveUnlock[area] = now + TTL_MS;
  return { ok: true };
}

function lock(req, area) {
  const u = req.session && req.session.sensitiveUnlock;
  if (!u) return;
  if (area) delete u[area];
  else for (const a of AREAS) delete u[a];
}

/** 이 글자가 급여·결산 비밀번호와 같은가 — 로그인 비밀번호를 바꿀 때 막는 데 쓴다. */
function sameAsPin(password) {
  return pinSet() && !!password && bcrypt.compareSync(String(password), store.settings.sensitive_pin_hash);
}

/** 사장님이 정한다 — 로그인(사장·직원) 비밀번호와 같으면 안 받는다. */
async function setPin(pin) {
  const p = String(pin || "");
  if (p.length < MIN_LEN) return { status: 400, error: "too_short", min: MIN_LEN };
  const st = store.settings;
  if ((st.admin_password_hash && bcrypt.compareSync(p, st.admin_password_hash)) || (st.staff_password_hash && bcrypt.compareSync(p, st.staff_password_hash))) {
    return { status: 400, error: "same_as_login" };
  }
  const hash = bcrypt.hashSync(p, 10);
  st.sensitive_pin_hash = hash;
  await saveFields({ "settings.sensitive_pin_hash": hash });
  return { ok: true };
}

module.exports = { AREAS, TTL_MS, MAX_FAILS, MIN_LEN, pinSet, isUnlocked, requireUnlocked, unlock, lock, sameAsPin, setPin };
