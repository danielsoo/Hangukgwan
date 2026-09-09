const express = require("express");
const multer = require("multer");
const { store, save, savePhoto, deletePhoto, getPhoto, getDb, connectDB } = require("../db");
const { requireAdmin, requirePermission, requireOwner } = require("../auth");
const { SETTING_BYTES, SETTING_CHECKED_AT, LIMIT_BYTES, levelFor, recordStoreSize } = require("../storeSize");
const { SETTING_KEY: SERVICE_START_KEY, normalize: normalizeServiceStart, serviceStartedAt } = require("../serviceStart");
const { nowLocal } = require("../time");
const { buildQrSvg, getLogoDataUri } = require("../qr");
const canEditSettings = requirePermission("settingsEdit");

const router = express.Router();
const PUBLIC_KEYS = [
  "store_name_zh",
  "store_name_ko",
  "store_name_en",
  "store_phone",
  "store_address_zh",
  "store_address_ko",
  "store_address_en",
  "store_hours",
  "store_min_spend",
  "store_notice",
  "store_cover_photo",
  "store_logo",
  "store_lat",
  "store_lng",
  "order_radius_m",
  // The Firebase web app config snippet (apiKey/authDomain/projectId/etc.)
  // Admin > 설정 > 회원(VIP) 로그인 설정 lets the owner paste in, straight
  // from their Firebase Console. Not a secret — Firebase's own docs note
  // this config only identifies which project a client belongs to; the
  // actual trust boundary is server-side ID-token verification (see
  // src/firebaseAdmin.js), which needs a separate, genuinely secret service
  // account key set as the FIREBASE_SERVICE_ACCOUNT env var instead — never
  // stored here, never sent to the customer page.
  "firebase_web_config",
];

function publicSettings() {
  const map = {};
  for (const k of PUBLIC_KEYS) if (store.settings[k] != null) map[k] = store.settings[k];
  // Whether the customer-facing "온라인 결제" button should show at all —
  // see /payment routes below and public/js/order.js.
  map.online_payment_enabled = !!store.settings.online_payment_enabled;
  // Header logo mode (order.html store-avatar, and this settings page's own
  // live preview) — see public/js/season.js. "auto" (default) picks the
  // season from today's date; it can also be forced to one specific season
  // regardless of the real month, or turned "off" entirely.
  map.taegeuk_season_mode = store.settings.taegeukSeasonMode || "auto";
  // 실시간 주문 알림 (Pusher Channels) — 2026-09-07 성능 개선 작업, 자세한
  // 배경은 src/realtime.js 참고. key/cluster는 공개해도 안전한 값이다
  // (Pusher 공식 문서 기준 app key는 공개 식별자이고, 비밀로 지켜야 하는
  // 건 secret뿐 — secret은 서버 쪽 src/realtime.js에만 있고 여기엔 절대
  // 포함하지 않는다). PUSHER_KEY/PUSHER_CLUSTER 둘 다 설정된 경우에만
  // admin.js가 폴링 대신 이 채널을 구독하고, 미설정 시엔 enabled:false로
  // 내려가서 기존 폴링 방식 그대로 동작한다.
  map.realtime = {
    enabled: !!(process.env.PUSHER_KEY && process.env.PUSHER_CLUSTER),
    key: process.env.PUSHER_KEY || null,
    cluster: process.env.PUSHER_CLUSTER || null,
  };
  return map;
}

const TAEGEUK_SEASON_MODES = ["auto", "off", "spring", "summer", "autumn", "winter"];

function photoIdFromUrl(url) {
  if (!url) return null;
  const m = url.match(/^\/api\/photo\/([a-f0-9]{24})$/);
  return m ? m[1] : null;
}

router.get("/", (req, res) => {
  res.json(publicSettings());
});

router.put("/", canEditSettings, async (req, res) => {
  const b = req.body || {};
  for (const key of PUBLIC_KEYS) {
    if (key === "store_cover_photo" || key === "store_logo") continue; // set only via the photo upload routes
    if (b[key] != null) store.settings[key] = String(b[key]);
  }
  if (TAEGEUK_SEASON_MODES.includes(b.taegeuk_season_mode)) store.settings.taegeukSeasonMode = b.taegeuk_season_mode;
  await save();
  res.json(publicSettings());
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("invalid_file_type"));
  },
});

router.post("/cover-photo", canEditSettings, upload.single("photo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "no_file" });
  const oldPhotoId = photoIdFromUrl(store.settings.store_cover_photo);

  const photoId = await savePhoto(req.file.buffer, req.file.mimetype);
  store.settings.store_cover_photo = `/api/photo/${photoId}`;
  await save();

  if (oldPhotoId) await deletePhoto(oldPhotoId);

  res.json({ store_cover_photo: store.settings.store_cover_photo });
});

// Small square-ish logo, used as the center overlay on printed QR codes
// (Admin > 테이블 / QR 코드 > 전체 QR 코드 인쇄).
router.post("/logo", canEditSettings, upload.single("photo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "no_file" });
  const oldPhotoId = photoIdFromUrl(store.settings.store_logo);

  const photoId = await savePhoto(req.file.buffer, req.file.mimetype);
  store.settings.store_logo = `/api/photo/${photoId}`;
  await save();

  if (oldPhotoId) await deletePhoto(oldPhotoId);

  res.json({ store_logo: store.settings.store_logo });
});

// Live preview for the settings page: a real sample QR code (same
// generator, same errorCorrectionLevel/logo-overlay as the actual printed
// sheet) so the owner can see exactly how the uploaded logo will look
// stamped into a real QR code, instead of just the raw uploaded image.
router.get("/logo-preview", requireAdmin, async (req, res) => {
  const logoDataUri = await getLogoDataUri(store, getPhoto);
  const sampleTable = store.tables[0];
  const sampleNumber = sampleTable ? sampleTable.number : "1";
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const svg = await buildQrSvg(`${baseUrl}/t/${encodeURIComponent(sampleNumber)}`, logoDataUri);
  res.set("Content-Type", "image/svg+xml");
  res.set("Cache-Control", "no-store");
  res.send(svg);
});

// 영업 시작 시각 — 이 시각 전 주문은 테스트로 보고 결산·통계·주문 목록에서
// 뺀다(지우지는 않는다, src/serviceStart.js). 매출 숫자가 달라지는 설정이라
// 사장님만 바꿀 수 있다.
router.get("/service-start", requireOwner, (req, res) => {
  res.json({ service_started_at: serviceStartedAt(store) });
});

router.put("/service-start", requireOwner, async (req, res) => {
  const raw = (req.body || {}).service_started_at;
  // 빈 값으로 저장하면 "설정 안 함"이 되어 예전처럼 전부 다시 보인다 —
  // 잘못 잡았을 때 되돌리는 길이다.
  if (raw == null || String(raw).trim() === "") {
    delete store.settings[SERVICE_START_KEY];
    await save();
    return res.json({ service_started_at: null });
  }
  const normalized = normalizeServiceStart(raw);
  if (!normalized) return res.status(400).json({ error: "invalid_datetime" });
  store.settings[SERVICE_START_KEY] = normalized;
  await save();
  res.json({ service_started_at: normalized });
});

// 데이터 저장 공간 상태 — 관리자 화면 맨 위의 띠가 읽는다.
//
// 사장님(2026-09-10): "3-4년 후에 내가 잊으면 큰일이잖아."
// 크기는 매일 밤 마감 정산이 재서 설정에 남긴다(src/storeSize.js). 여기서는
// 그 값을 읽어 지금 어떤 상태인지만 알려준다 — 화면을 열 때마다 재면
// 요청마다 문서를 한 번 더 읽는 셈이라, 이 기능이 막으려는 바로 그 짓을
// 하게 된다.
router.get("/storage", requireAdmin, async (req, res) => {
  // 크론이 한 번도 안 돌았거나(배포 설정이 빠졌거나, 계속 실패했거나) 값이
  // 오래됐으면 여기서 한 번 재둔다. 이 경고가 필요한 시점은 몇 년 뒤인데,
  // 그때 "크론이 조용히 안 돌고 있었다"로 경고 자체가 없으면 안전장치가
  // 없는 것과 같다. 일주일에 한 번꼴이라 비용은 무시할 만하다.
  const STALE_MS = 7 * 24 * 60 * 60 * 1000;
  const checkedAt = store.settings[SETTING_CHECKED_AT];
  const checkedMs = checkedAt ? Date.parse(String(checkedAt).replace(" ", "T")) : NaN;
  const stale = !checkedAt || Number.isNaN(checkedMs) || Date.now() - checkedMs > STALE_MS;
  if (stale) {
    const measured = await recordStoreSize(store, { getDb, connectDB, nowLocal });
    if (measured) await save();
  }
  const bytes = store.settings[SETTING_BYTES] || null;
  res.json({
    bytes,
    limit_bytes: LIMIT_BYTES,
    level: bytes ? levelFor(bytes) : "unknown",
    checked_at: store.settings[SETTING_CHECKED_AT] || null,
  });
});

// Staff permission toggles — only the owner can view/change these (staff
// obviously shouldn't be able to grant permissions to themselves). New
// toggle-able features should be added here going forward: the owner always
// has them on, and separately decides whether to switch each one on for
// staff too.
const STAFF_PERMISSION_KEYS = ["menuEdit", "tableEdit", "settingsEdit", "orderCancel", "orderEdit", "reservationManage"];

router.get("/staff-permissions", requireOwner, (req, res) => {
  const perms = store.settings.staff_permissions || {};
  const out = {};
  for (const k of STAFF_PERMISSION_KEYS) out[k] = !!perms[k];
  res.json(out);
});

router.put("/staff-permissions", requireOwner, async (req, res) => {
  const b = req.body || {};
  store.settings.staff_permissions = store.settings.staff_permissions || {};
  for (const k of STAFF_PERMISSION_KEYS) {
    if (typeof b[k] === "boolean") store.settings.staff_permissions[k] = b[k];
  }
  await save();
  const out = {};
  for (const k of STAFF_PERMISSION_KEYS) out[k] = !!store.settings.staff_permissions[k];
  res.json(out);
});

// LINE closing-summary settings — owner-only. The channel access token and
// channel secret are never sent back to the browser once saved (same idea
// as a password field): GET only reports whether each is currently set.
//
// Friending the Official Account does NOT by itself start sending someone
// the closing summary — LINE has no way to look a person up by their
// personal @ID or phone number, so instead each new follower shows up in
// `line_pending_followers` with their LINE display name + photo (fetched
// via the Profile API in src/routes/lineWebhook.js), and the owner
// approves specific people by name into `line_targets`, which is what
// sendLineMessage() actually sends to.
function lineStatus() {
  return {
    enabled: !!store.settings.line_notify_enabled,
    hasToken: !!store.settings.line_channel_access_token,
    hasSecret: !!store.settings.line_channel_secret,
    targets: (store.settings.line_targets || []).map((t) => ({ userId: t.userId, displayName: t.displayName, pictureUrl: t.pictureUrl })),
    pending: (store.settings.line_pending_followers || []).map((p) => ({ userId: p.userId, displayName: p.displayName, pictureUrl: p.pictureUrl })),
  };
}

router.get("/line", requireOwner, (req, res) => {
  res.json(lineStatus());
});

// Reveals the actual saved token/secret (owner-only, requires an explicit
// click in the UI) — useful for checking a paste didn't pick up stray
// whitespace, e.g. when a webhook signature mismatch is happening.
router.get("/line/reveal", requireOwner, (req, res) => {
  res.json({
    token: store.settings.line_channel_access_token || "",
    secret: store.settings.line_channel_secret || "",
  });
});

router.put("/line", requireOwner, async (req, res) => {
  const b = req.body || {};
  if (typeof b.enabled === "boolean") store.settings.line_notify_enabled = b.enabled;
  if (typeof b.token === "string" && b.token.trim()) store.settings.line_channel_access_token = b.token.trim();
  if (typeof b.secret === "string" && b.secret.trim()) store.settings.line_channel_secret = b.secret.trim();
  await save();
  res.json(lineStatus());
});

// Moves a pending follower (identified by name/photo) into the approved
// target list — this is the actual "register this specific person" action.
router.post("/line/approve", requireOwner, async (req, res) => {
  const userId = (req.body || {}).userId;
  store.settings.line_pending_followers = store.settings.line_pending_followers || [];
  store.settings.line_targets = store.settings.line_targets || [];
  const pending = store.settings.line_pending_followers.find((p) => p.userId === userId);
  if (!pending) return res.status(404).json({ error: "not_found" });

  store.settings.line_pending_followers = store.settings.line_pending_followers.filter((p) => p.userId !== userId);
  if (!store.settings.line_targets.some((t) => t.userId === userId)) {
    store.settings.line_targets.push({ ...pending, approved_at: new Date().toISOString() });
  }
  await save();
  res.json(lineStatus());
});

// Dismisses a pending follower without registering them (they stay
// friended, just never receive anything).
router.post("/line/reject", requireOwner, async (req, res) => {
  const userId = (req.body || {}).userId;
  store.settings.line_pending_followers = (store.settings.line_pending_followers || []).filter((p) => p.userId !== userId);
  await save();
  res.json(lineStatus());
});

// Revokes one specific already-approved person (e.g. added by mistake, or
// should no longer receive it) without affecting anyone else.
router.delete("/line/targets/:userId", requireOwner, async (req, res) => {
  store.settings.line_targets = (store.settings.line_targets || []).filter((t) => t.userId !== req.params.userId);
  await save();
  res.json(lineStatus());
});

// Online payment (ECPay) on/off toggle — owner-only, same pattern as the
// LINE closing-summary settings above. The actual ECPay merchant
// credentials live in server environment variables (never in the DB or
// sent to the browser) — see src/ecpay.js — so all this toggle controls is
// whether the customer-facing "온라인 결제" button appears at all.
function paymentStatus() {
  const { credentials } = require("../ecpay");
  return {
    enabled: !!store.settings.online_payment_enabled,
    // Lets the admin UI show a "테스트 모드" hint until real ECPay merchant
    // credentials have been added to the server's environment variables.
    isTestMode: credentials().isTest,
  };
}

router.get("/payment", requireOwner, (req, res) => {
  res.json(paymentStatus());
});

router.put("/payment", requireOwner, async (req, res) => {
  const b = req.body || {};
  if (typeof b.enabled === "boolean") store.settings.online_payment_enabled = b.enabled;
  await save();
  res.json(paymentStatus());
});

// Direct ESC/POS kitchen-printer setting (QZ Tray) — owner-only, same
// pattern as the payment/LINE toggles above. Just a flag + a printer name
// string; QZ Tray itself (a separate program running on whichever computer
// opens the admin panel) is what actually talks to the printer — see
// public/js/qz-tray.js / public/js/escpos.js / admin.js's printKitchenTicket.
function escposStatus() {
  return {
    enabled: !!store.settings.escpos_enabled,
    printerName: store.settings.escpos_printer_name || "",
    // RawBT (Android-only, see public/js/admin.js tryPrintViaRawBt) has no
    // printer address of its own to store here — the target printer
    // (Bluetooth/USB/Network) is configured inside the RawBT app itself on
    // the tablet. This is just the on/off switch, same shape as the QZ
    // Tray "enabled" flag above.
    rawbtEnabled: !!store.settings.rawbt_enabled,
  };
}

// GET is requireAdmin (not requireOwner) on purpose: a staff session also
// needs to read this (printKitchenTicket() in admin.js checks it before
// every print, for staff logins too) — only *changing* the setting is
// owner-only, via PUT below.
router.get("/escpos", requireAdmin, (req, res) => {
  res.json(escposStatus());
});

router.put("/escpos", requireOwner, async (req, res) => {
  const b = req.body || {};
  if (typeof b.enabled === "boolean") store.settings.escpos_enabled = b.enabled;
  if (typeof b.printerName === "string") store.settings.escpos_printer_name = b.printerName.trim().slice(0, 100);
  if (typeof b.rawbtEnabled === "boolean") store.settings.rawbt_enabled = b.rawbtEnabled;
  await save();
  res.json(escposStatus());
});

// Kitchen-ticket font sizes (per component, in px) — owner-editable, same
// GET-is-requireAdmin/PUT-is-requireOwner split as /escpos above: every
// login that can print a ticket (staff included) needs to read this so
// their printout matches what the owner configured, but only the owner can
// change it. See buildTicketHtml()'s DEFAULT_TICKET_FONT_SIZES in
// admin.js for what each key controls and its fallback value.
const TICKET_FONT_KEYS = [
  "storeName",
  "tableNo",
  "orderTypeBadge",
  "time",
  "itemName",
  "itemDetail",
  "itemTakeout",
  // 사장님 피드백(2026-09-08): "크기, 두께 전부 설정할 수 있잖아 영수증.
  // 거기에 금액 버전도 설정할 수 있게 해줘" — 결제용(금액) 사본에서만
  // 찍히는 └ NT$ 줄 전용 크기·굵기. admin.js
  // DEFAULT_TICKET_FONT_SIZES/TICKET_FONT_INPUT_IDS에도 같은 이름으로
  // 추가돼 있다.
  "itemPrice",
  "total",
  "orderNote",
  "printTime",
];

// 사장님 피드백(2026-09-06): "설정에 주방으로 가는 명세서 출력하는 거
// 글자 크기 조절할 수 있게 했는데 그 부분들 전부 글자 굵기 조절하는것도
// 추가해줘" — 위 TICKET_FONT_KEYS와 정확히 같은 항목들에 대해 굵기도
// 같은 방식(같은 GET/PUT, 같은 settings.ticket_font_sizes 객체 안에 함께
// 저장)으로 조절 가능하게 함. 키 이름은 "<항목>Weight" 규칙으로 붙여서
// 하나의 평평한(flat) 객체 안에 크기·굵기가 나란히 들어가게 함 —
// admin.js의 DEFAULT_TICKET_FONT_SIZES/TICKET_FONT_INPUT_IDS도 동일한
// 규칙을 씀.
const TICKET_WEIGHT_KEYS = TICKET_FONT_KEYS.map((k) => `${k}Weight`);

function ticketFontSizesStatus() {
  const saved = store.settings.ticket_font_sizes || {};
  const out = {};
  for (const k of [...TICKET_FONT_KEYS, ...TICKET_WEIGHT_KEYS]) if (typeof saved[k] === "number") out[k] = saved[k];
  return out;
}

router.get("/ticket-print", requireAdmin, (req, res) => {
  res.json(ticketFontSizesStatus());
});

router.put("/ticket-print", requireOwner, async (req, res) => {
  const b = req.body || {};
  store.settings.ticket_font_sizes = store.settings.ticket_font_sizes || {};
  for (const k of TICKET_FONT_KEYS) {
    const v = Number(b[k]);
    // Sane bounds so a typo (or a stray huge/negative number) can't produce
    // an unreadable or paper-wasting ticket — 8px..40px covers everything
    // from "tiny footer note" to "shout it across the kitchen".
    if (Number.isFinite(v)) store.settings.ticket_font_sizes[k] = Math.max(8, Math.min(40, Math.round(v)));
  }
  for (const k of TICKET_WEIGHT_KEYS) {
    const v = Number(b[k]);
    // 사장님 피드백(2026-09-06): "굵기도 사이즈 크기처럼 숫자로 정할 수
    // 있게 해줄래?" — admin.js 쪽 입력을 3단계 <select>에서 100~900 사이
    // 숫자를 직접 입력하는 <input type=number>로 바꿨다. CSS font-weight는
    // 원래 100 단위로만 의미가 있고, ticket의 Google Fonts 스타일시트도
    // 100/200/.../900 9개 고정 굵기만 로드해두므로(admin.js buildTicketHtml
    // 상단 링크 참고), 100~900 범위로 clamp하고 가장 가까운 100 단위로
    // 반올림해서 항상 실제로 로드된 굵기 중 하나가 되게 한다.
    if (Number.isFinite(v)) store.settings.ticket_font_sizes[k] = Math.max(100, Math.min(900, Math.round(v / 100) * 100));
  }
  await save();
  res.json(ticketFontSizesStatus());
});

module.exports = router;
