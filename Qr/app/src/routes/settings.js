const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { store, save } = require("../db");
const { requireAdmin } = require("../auth");

const router = express.Router();
const PUBLIC_KEYS = [
  "store_name_zh",
  "store_name_ko",
  "store_name_en",
  "store_phone",
  "store_address_zh",
  "store_hours",
  "store_min_spend",
  "store_notice",
  "store_cover_photo",
];

function publicSettings() {
  const map = {};
  for (const k of PUBLIC_KEYS) if (store.settings[k] != null) map[k] = store.settings[k];
  return map;
}

router.get("/", (req, res) => {
  res.json(publicSettings());
});

router.put("/", requireAdmin, (req, res) => {
  const b = req.body || {};
  for (const key of PUBLIC_KEYS) {
    if (key === "store_cover_photo") continue; // set only via the photo upload route
    if (b[key] != null) store.settings[key] = String(b[key]);
  }
  save();
  res.json(publicSettings());
});

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "..", "..", "public", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `cover-${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("invalid_file_type"));
  },
});

router.post("/cover-photo", requireAdmin, upload.single("photo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "no_file" });
  const old = store.settings.store_cover_photo;
  if (old && old.startsWith("/uploads/")) {
    fs.unlink(path.join(UPLOAD_DIR, path.basename(old)), () => {});
  }
  store.settings.store_cover_photo = `/uploads/${req.file.filename}`;
  save();
  res.json({ store_cover_photo: store.settings.store_cover_photo });
});

module.exports = router;
