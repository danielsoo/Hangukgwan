const express = require("express");
const multer = require("multer");
const { store, save, savePhoto, deletePhoto, getPhoto } = require("../db");
const { requireAdmin, requirePermission, requireOwner } = require("../auth");
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
];

function publicSettings() {
  const map = {};
  for (const k of PUBLIC_KEYS) if (store.settings[k] != null) map[k] = store.settings[k];
  return map;
}

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

// Staff permission toggles — only the owner can view/change these (staff
// obviously shouldn't be able to grant permissions to themselves).
const STAFF_PERMISSION_KEYS = ["menuEdit", "tableEdit", "settingsEdit", "orderCancel"];

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

module.exports = router;
