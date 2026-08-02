const express = require("express");
const multer = require("multer");
const { store, save, nextId, savePhoto, deletePhoto } = require("../db");
const { requireAdmin } = require("../auth");

const router = express.Router();

// Photos are kept in MongoDB (see src/db.js) instead of local disk, since
// serverless hosts like Vercel don't have a writable disk that survives
// between requests. multer just needs to hand us the raw buffer.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("invalid_file_type"));
  },
});

function photoIdFromUrl(url) {
  if (!url) return null;
  const m = url.match(/^\/api\/photo\/([a-f0-9]{24})$/);
  return m ? m[1] : null;
}

function categoriesWithItems(onlyAvailable) {
  const cats = [...store.categories].sort((a, b) => a.sort_order - b.sort_order);
  return cats.map((c) => {
    let items = store.menuItems.filter((i) => i.category_id === c.id);
    if (onlyAvailable) items = items.filter((i) => i.available);
    items = items.sort((a, b) => a.sort_order - b.sort_order);
    return { ...c, items };
  });
}

// Public: menu for customers (available items only)
router.get("/", (req, res) => {
  res.json(categoriesWithItems(true));
});

// Admin: full menu including unavailable items
router.get("/admin", requireAdmin, (req, res) => {
  res.json(categoriesWithItems(false));
});

router.get("/admin/categories", requireAdmin, (req, res) => {
  res.json([...store.categories].sort((a, b) => a.sort_order - b.sort_order));
});

router.post("/admin/items", requireAdmin, async (req, res) => {
  const b = req.body || {};
  if (!b.category_id || !b.name_zh || b.price == null) {
    return res.status(400).json({ error: "missing_fields" });
  }
  const maxSort = store.menuItems.reduce((m, i) => Math.max(m, i.sort_order), 0);
  const item = {
    id: nextId("menuItems"),
    category_id: parseInt(b.category_id, 10),
    code: b.code || null,
    name_zh: b.name_zh,
    name_ko: b.name_ko || null,
    name_en: b.name_en || null,
    desc_zh: b.desc_zh || null,
    desc_ko: b.desc_ko || null,
    desc_en: b.desc_en || null,
    price: b.price,
    price_note: b.price_note || null,
    options: b.options || null,
    is_spicy: b.is_spicy ? 1 : 0,
    is_signature: b.is_signature ? 1 : 0,
    photo_url: b.photo_url || null,
    available: b.available === false ? 0 : 1,
    sort_order: maxSort + 1,
  };
  store.menuItems.push(item);
  await save();
  res.status(201).json(item);
});

router.put("/admin/items/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const item = store.menuItems.find((i) => i.id === id);
  if (!item) return res.status(404).json({ error: "not_found" });
  const b = req.body || {};
  const fields = [
    "category_id", "code", "name_zh", "name_ko", "name_en",
    "desc_zh", "desc_ko", "desc_en", "price", "price_note", "options", "sort_order",
  ];
  for (const f of fields) if (b[f] !== undefined) item[f] = b[f];
  if (b.category_id !== undefined) item.category_id = parseInt(b.category_id, 10);
  if (b.is_spicy !== undefined) item.is_spicy = b.is_spicy ? 1 : 0;
  if (b.is_signature !== undefined) item.is_signature = b.is_signature ? 1 : 0;
  if (b.available !== undefined) item.available = b.available ? 1 : 0;
  await save();
  res.json(item);
});

router.delete("/admin/items/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  store.menuItems = store.menuItems.filter((i) => i.id !== id);
  await save();
  res.json({ ok: true });
});

router.post("/admin/items/:id/photo", requireAdmin, upload.single("photo"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const item = store.menuItems.find((i) => i.id === id);
  if (!item) return res.status(404).json({ error: "not_found" });
  if (!req.file) return res.status(400).json({ error: "no_file" });

  const oldPhotoId = photoIdFromUrl(item.photo_url);

  const photoId = await savePhoto(req.file.buffer, req.file.mimetype);
  item.photo_url = `/api/photo/${photoId}`;
  await save();

  if (oldPhotoId) await deletePhoto(oldPhotoId);

  res.json({ photo_url: item.photo_url });
});

// Admin: categories management
router.post("/admin/categories", requireAdmin, async (req, res) => {
  const { key, name_zh, name_ko, name_en } = req.body || {};
  if (!key || !name_zh) return res.status(400).json({ error: "missing_fields" });
  const maxSort = store.categories.reduce((m, c) => Math.max(m, c.sort_order), 0);
  const cat = { id: nextId("categories"), key, name_zh, name_ko: name_ko || "", name_en: name_en || "", sort_order: maxSort + 1 };
  store.categories.push(cat);
  await save();
  res.status(201).json(cat);
});

module.exports = router;
