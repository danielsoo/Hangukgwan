const express = require("express");
const multer = require("multer");
const { store, save, refreshAndSave, nextId, savePhoto, deletePhoto } = require("../db");
const { requireAdmin, requirePermission } = require("../auth");
const { withAvailability, today } = require("../availability");
const { broadcastOnWrite } = require("../realtime");
const canEditMenu = requirePermission("menuEdit");

const router = express.Router();

// 여기서 나가는 모든 쓰기를 다른 기기에 바로 알린다 (src/realtime.js).
// 라우트마다 한 줄씩 넣으면 다음에 새 라우트를 넣는 사람이 빠뜨리고, 그
// 한 자리만 조용히 「새로고침해야 보이는」 곳이 된다.
router.use(broadcastOnWrite("menu"));

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
    // 품절 기간(src/availability.js)을 여기서 한 번 계산해 available 에
    // 담아 내보낸다. 그러면 손님 화면·관리자 화면·주문 검사까지 전부
    // 같은 판단을 보게 된다 — 화면마다 따로 계산하면 반드시 어긋난다.
    let items = store.menuItems
      .filter((i) => i.category_id === c.id)
      .map((i) => withAvailability(i, store.settings));
    if (onlyAvailable) items = items.filter((i) => i.available);
    items = items.sort((a, b) => a.sort_order - b.sort_order);
    return { ...c, items };
  });
}

// 화면이 보내온 품절 설정을 저장 형태로 옮긴다. 화면은 네 가지 중 하나를
// 고르고(판매 중 / 오늘만 / 기간 / 계속), 여기서 available 과 날짜 두 개로
// 편다. 규칙을 서버가 정해야 관리자 화면과 나중에 생길 다른 경로가
// 어긋나지 않는다.
function applySoldOut(item, mode, from, until) {
  const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
  if (mode === "on_sale") {
    item.available = 1;
    item.soldout_from = null;
    item.soldout_until = null;
    return true;
  }
  if (mode === "today") {
    item.available = 1;
    item.soldout_from = today();
    item.soldout_until = today();
    return true;
  }
  if (mode === "range") {
    const f = date(from);
    const u = date(until);
    // 둘 다 비어 있으면 기간이 아니다 — 실수로 "영원히 품절"이 되어버리는
    // 대신 거절한다.
    if (!f && !u) return false;
    if (f && u && u < f) return false;
    item.available = 1;
    item.soldout_from = f;
    item.soldout_until = u;
    return true;
  }
  if (mode === "always") {
    item.available = 0;
    item.soldout_from = null;
    item.soldout_until = null;
    return true;
  }
  return false;
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

router.post("/admin/items", canEditMenu, async (req, res) => {
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
    original_price: b.original_price || null,
    options: b.options || null,
    mix_options: b.mix_options ? 1 : 0,
    spice_options: b.spice_options || null,
    // 부대찌개(部隊鍋) 같은 품목의 포장 전용 옵션(不煮外帶/煮熟外帶 — 조리
    // 여부) — spice_options와 같은 comma-separated 단일 선택 라디오
    // 형식이지만, 손님 화면에서는 이 품목을 포장(外帶)으로 담을 때만
    // 보인다(order.html #itemTakeoutOptions, order.js openItemSheet()
    // 참고). 사장님 메모(2026-09-07) 기반.
    takeout_options: b.takeout_options || null,
    // Multi-select paid (or free) extras a customer can add to this dish —
    // e.g. "볶음밥 추가:80,사리면 추가:50" or a free swap like
    // "飯換冬粉:0". Format: comma-separated "Name:Price" pairs, parsed by
    // parseAddons() below and rendered as checkboxes (unlike options/
    // spice_options, which are single-choice radios) — see order.js
    // #itemAddonsList and the price recompute in this file / orders.js.
    addons: b.addons || null,
    min_first_order_qty: b.min_first_order_qty || null,
    allergens: Array.isArray(b.allergens) ? b.allergens : [],
    is_spicy: b.is_spicy ? 1 : 0,
    is_signature: b.is_signature ? 1 : 0,
    photo_url: b.photo_url || null,
    available: b.available === false ? 0 : 1,
    soldout_from: null,
    soldout_until: null,
    sort_order: maxSort + 1,
  };
  store.menuItems.push(item);
  await save();
  res.status(201).json(item);
});

router.put("/admin/items/:id", canEditMenu, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const b = req.body || {};
  const fields = [
    "category_id", "code", "name_zh", "name_ko", "name_en",
    "desc_zh", "desc_ko", "desc_en", "price", "price_note", "original_price", "options",
    "spice_options", "takeout_options", "addons", "min_first_order_qty", "sort_order",
  ];
  // Re-fetches the latest data right before writing (see refreshAndSave() in
  // src/db.js) instead of mutating the `item` this request loaded at the
  // top — narrows the window for another concurrent save (an incoming
  // order, another admin edit) to overwrite this change or get overwritten
  // by it.
  let updated = null;
  await refreshAndSave((s) => {
    const item = s.menuItems.find((i) => i.id === id);
    if (!item) return;
    for (const f of fields) if (b[f] !== undefined) item[f] = b[f];
    if (b.category_id !== undefined) item.category_id = parseInt(b.category_id, 10);
    if (b.allergens !== undefined) item.allergens = Array.isArray(b.allergens) ? b.allergens : [];
    if (b.mix_options !== undefined) item.mix_options = b.mix_options ? 1 : 0;
    if (b.is_spicy !== undefined) item.is_spicy = b.is_spicy ? 1 : 0;
    if (b.is_signature !== undefined) item.is_signature = b.is_signature ? 1 : 0;
    if (b.available !== undefined) item.available = b.available ? 1 : 0;
    // 수정 폼도 품절 기간을 같이 보낸다(소재 화면: openItemModal).
    if (b.soldoutMode !== undefined) applySoldOut(item, b.soldoutMode, b.soldoutFrom, b.soldoutUntil);
    updated = item;
  });
  if (!updated) return res.status(404).json({ error: "not_found" });
  res.json(updated);
});

// 메뉴 관리 표의 품절 배지를 눌렀을 때 오는 곳.
//
// 사장님(2026-09-09): "직원들이 다음날 잊어버릴까봐" — 잊어버리지 않게
// 하려면 찍는 것 자체가 쉬워야 한다. 수정 폼을 열고 스무 개 칸을 지나
// 저장하는 대신, 표에서 배지 한 번 누르고 「오늘만」 한 번 누르면 끝나게
// 한다. 저장되는 내용은 수정 폼에서 하는 것과 완전히 같다(applySoldOut).
router.patch("/admin/items/:id/soldout", canEditMenu, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const b = req.body || {};
  let updated = null;
  let bad = false;
  await refreshAndSave((s) => {
    const item = s.menuItems.find((i) => i.id === id);
    if (!item) return;
    if (!applySoldOut(item, b.mode, b.from, b.until)) {
      bad = true;
      return;
    }
    updated = item;
  });
  if (bad) return res.status(400).json({ error: "invalid_soldout" });
  if (!updated) return res.status(404).json({ error: "not_found" });
  res.json(withAvailability(updated, store.settings));
});

// 사장님 피드백(2026-09-06): "메뉴 순서를 바꾸고 싶어. 코드 정렬로
// 되어있지 않은 거 같거든" — 관리자 메뉴 관리 화면의 위/아래 화살표
// 버튼(public/js/admin.js의 renderMenuAdmin)이 호출하는 엔드포인트. 같은
// 카테고리 안에서 sort_order 기준 바로 위/아래에 있는 아이템과 sort_order
// 값을 맞바꾼다 — sort_order는 카테고리 구분 없이 전역으로 매겨지는
// 값이지만(POST /admin/items의 maxSort 참고), 실제로 의미가 있는 건 같은
// category_id를 가진 아이템들 사이의 상대적인 순서뿐이라 이걸로 충분하다.
// 이미 맨 위/맨 아래인데 더 이동하려 하면 조용히 아무 것도 하지 않는다
// (프론트에서 이미 그 방향 버튼을 disabled 처리하지만, 방어적으로 한 번 더
// 확인).
router.patch("/admin/items/:id/move", canEditMenu, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const direction = req.body && req.body.direction;
  if (direction !== "up" && direction !== "down") {
    return res.status(400).json({ error: "invalid_direction" });
  }
  let found = false;
  await refreshAndSave((s) => {
    const item = s.menuItems.find((i) => i.id === id);
    if (!item) return;
    found = true;
    const siblings = s.menuItems
      .filter((i) => i.category_id === item.category_id)
      .sort((a, b) => a.sort_order - b.sort_order);
    const idx = siblings.findIndex((i) => i.id === id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;
    const other = siblings[swapIdx];
    const tmp = item.sort_order;
    item.sort_order = other.sort_order;
    other.sort_order = tmp;
  });
  if (!found) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

router.delete("/admin/items/:id", canEditMenu, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  store.menuItems = store.menuItems.filter((i) => i.id !== id);
  await save();
  res.json({ ok: true });
});

router.post("/admin/items/:id/photo", canEditMenu, upload.single("photo"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = store.menuItems.find((i) => i.id === id);
  if (!existing) return res.status(404).json({ error: "not_found" });
  if (!req.file) return res.status(400).json({ error: "no_file" });

  const oldPhotoId = photoIdFromUrl(existing.photo_url);

  // savePhoto()'s Mongo round-trip is the slow part of this request — often
  // a real stretch of wall-clock time — so the `store` snapshot from the
  // top of the request (and the `existing` item pulled from it above) can
  // go stale by the time we're ready to write. Re-fetch right before saving
  // (see refreshAndSave() in src/db.js) instead of writing through the
  // stale `existing` reference, so a concurrent order/edit saved in the
  // meantime doesn't get silently clobbered — or silently clobber this.
  const photoId = await savePhoto(req.file.buffer, req.file.mimetype);
  let newPhotoUrl = null;
  await refreshAndSave((s) => {
    const item = s.menuItems.find((i) => i.id === id);
    if (!item) return;
    item.photo_url = `/api/photo/${photoId}`;
    newPhotoUrl = item.photo_url;
  });
  if (!newPhotoUrl) return res.status(404).json({ error: "not_found" });

  if (oldPhotoId) await deletePhoto(oldPhotoId);

  res.json({ photo_url: newPhotoUrl });
});

// Admin: categories management
router.post("/admin/categories", canEditMenu, async (req, res) => {
  const { key, name_zh, name_ko, name_en } = req.body || {};
  if (!key || !name_zh) return res.status(400).json({ error: "missing_fields" });
  const maxSort = store.categories.reduce((m, c) => Math.max(m, c.sort_order), 0);
  const cat = { id: nextId("categories"), key, name_zh, name_ko: name_ko || "", name_en: name_en || "", sort_order: maxSort + 1 };
  store.categories.push(cat);
  await save();
  res.status(201).json(cat);
});

module.exports = router;
