// 패드 프로필 (2026-09-29).
//
// 사장님: "패드 프로필을 만들어줘. 여러명이 한 프로필 들어가도 되니까. 그냥
// 해당 프로필의 ip 와 프린터기 그것 때문에 있으면 좋겠다고 느낀 거야 / 그리고
// 얼마나 많은 터치 이벤트가 있는지도 프로필 별로 알 수도 있을 것 같고."
//
// 프로필은 **계정이 아니다.** 「이 패드는 주방이다」를 한 번 고르면 그 패드가
// 어느 프린터로 찍고, 새 주문을 자동으로 찍는지가 따라온다. 여러 패드가 같은
// 프로필을 골라도 된다. 고른 값은 패드(localStorage)에 남는다.
//
// 터치 수는 프로필마다 하루 단위로 센다. 패드가 1분마다 모아 보내고 서버는
// 따로 둔 컬렉션(pad_touches)에 $inc 로 더한다 — store 문서를 쓰지 않는다.

const MAX_PROFILES = 10;
const COLLECTION = "pad_touches";
// 프로필을 고르지 않은 기기(사장님 폰 등)의 터치도 버리지 않는다.
const NO_PROFILE = "none";
// 1분에 이보다 많이 누를 수는 없다 — 잘못된 값이 통계를 망치지 않게.
const MAX_TOUCHES_PER_POST = 5000;
const SUMMARY_DAYS = 7;
// 어느 패드가 어느 프로필을 쓰는지 — 패드가 1분마다 알린다(pad_devices).
// 「프로필을 만들었는데 패드가 알아먹었나?」를 설정 화면에서 보려고 한다.
const DEVICES_COLLECTION = "pad_devices";
const DEVICE_KINDS = ["app", "tablet", "phone", "pc"];
const TARGET_RE = /^[0-9A-Za-z.\-]{1,253}:\d{1,5}$/;
// 이만큼 소식이 없으면 목록에서 뺀다(버린 폰·다시 깐 앱).
const DEVICE_KEEP_MS = 7 * 86400000;

function profilesOf(settings) {
  return Array.isArray(settings && settings.pad_profiles) ? settings.pad_profiles : [];
}

function cleanProfiles(list, printers = []) {
  if (!Array.isArray(list)) return null;
  const printerIds = new Set((printers || []).map((p) => p && p.id));
  const out = [];
  const seen = new Set();
  for (const p of list.slice(0, MAX_PROFILES)) {
    if (!p || typeof p !== "object") continue;
    const name = String(p.name == null ? "" : p.name).trim().slice(0, 20);
    if (!name) return null;
    let id = String(p.id || "").trim().slice(0, 32);
    if (!/^[0-9A-Za-z_-]+$/.test(id) || id === NO_PROFILE || seen.has(id)) id = `pp${Date.now().toString(36)}${out.length}`;
    seen.add(id);
    const printerId = String(p.printerId || "");
    out.push({
      id,
      name,
      // 목록에 없는 프린터를 가리키면 「프린터는 그대로」로 둔다.
      printerId: printerIds.has(printerId) ? printerId : null,
      autoPrint: !!p.autoPrint,
    });
  }
  return out;
}

function dayOf(localNow) {
  return String(localNow || "").slice(0, 10);
}

// "YYYY-MM-DD" 에서 n 일 전. 날짜 글자만 다루므로 시간대가 끼지 않는다.
function daysBack(day, n) {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(t)) return [];
  const out = [];
  for (let i = 0; i < n; i++) out.push(new Date(t - i * 86400000).toISOString().slice(0, 10));
  return out;
}

async function addTouches(getDb, connectDB, settings, profileId, count, localNow) {
  const pid = String(profileId == null ? "" : profileId) || NO_PROFILE;
  if (pid !== NO_PROFILE && !profilesOf(settings).some((p) => p.id === pid)) {
    // 지워진 프로필을 아직 들고 있는 패드 — 「프로필 없음」으로 센다.
    return addTouches(getDb, connectDB, settings, NO_PROFILE, count, localNow);
  }
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n < 1) return null;
  const day = dayOf(localNow);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  await connectDB();
  await getDb()
    .collection(COLLECTION)
    .updateOne(
      { _id: `${day}|${pid}` },
      { $inc: { count: Math.min(n, MAX_TOUCHES_PER_POST) }, $set: { day, profile: pid } },
      { upsert: true }
    );
  return true;
}

async function touchSummary(getDb, connectDB, localNow) {
  const today = dayOf(localNow);
  const days = daysBack(today, SUMMARY_DAYS);
  await connectDB();
  const docs = await getDb().collection(COLLECTION).find({ day: { $in: days } }).toArray();
  const by = {};
  for (const d of docs) {
    const row = (by[d.profile] = by[d.profile] || { profile: d.profile, today: 0, week: 0 });
    const c = Number(d.count) || 0;
    row.week += c;
    if (d.day === today) row.today += c;
  }
  return { today, days, rows: Object.values(by) };
}

function localMs(s) {
  const t = new Date(String(s || "").replace(" ", "T")).getTime();
  return Number.isFinite(t) ? t : NaN;
}

async function markSeen(getDb, connectDB, settings, body, localNow) {
  const b = body || {};
  const deviceId = String(b.deviceId == null ? "" : b.deviceId).trim();
  if (!/^[0-9A-Za-z_-]{1,64}$/.test(deviceId)) return null;
  let profile = String(b.profileId == null ? "" : b.profileId) || NO_PROFILE;
  if (profile !== NO_PROFILE && !profilesOf(settings).some((p) => p.id === profile)) profile = NO_PROFILE;
  const kind = DEVICE_KINDS.includes(b.kind) ? b.kind : "pc";
  const printer = typeof b.printer === "string" && TARGET_RE.test(b.printer) ? b.printer : null;
  await connectDB();
  await getDb()
    .collection(DEVICES_COLLECTION)
    .updateOne(
      { _id: deviceId },
      { $set: { profile, kind, printer, canSetPrinter: !!b.canSetPrinter, autoPrint: !!b.autoPrint, last_seen: localNow } },
      { upsert: true }
    );
  return true;
}

async function listDevices(getDb, connectDB, localNow) {
  await connectDB();
  const now = localMs(localNow);
  const docs = await getDb().collection(DEVICES_COLLECTION).find({}).toArray();
  return docs
    .map((d) => ({
      id: String(d._id),
      profile: d.profile || NO_PROFILE,
      kind: d.kind || "pc",
      printer: d.printer || null,
      canSetPrinter: !!d.canSetPrinter,
      autoPrint: !!d.autoPrint,
      last_seen: d.last_seen || null,
      ago_ms: Number.isFinite(now) && Number.isFinite(localMs(d.last_seen)) ? Math.max(0, now - localMs(d.last_seen)) : null,
    }))
    .filter((d) => d.ago_ms == null || d.ago_ms < DEVICE_KEEP_MS)
    .sort((a, c) => (a.ago_ms ?? 1e15) - (c.ago_ms ?? 1e15));
}

module.exports = {
  MAX_PROFILES, COLLECTION, NO_PROFILE, MAX_TOUCHES_PER_POST, SUMMARY_DAYS, DEVICES_COLLECTION, DEVICE_KEEP_MS,
  profilesOf, cleanProfiles, daysBack, addTouches, touchSummary, markSeen, listDevices,
};
