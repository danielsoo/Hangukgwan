// One-time data migration for the 2026-09 손님 피드백 (QR코드 주문 요청사항.pdf).
//
// src/seed.js only ever inserts data on a completely fresh install (its
// checks are `if (store.categories.length === 0)` etc.) — it has no effect
// on this restaurant's already-seeded, already-live database. Menu items
// touched here (new drinks, addons, name tweaks) need a real one-time write
// against the live store, which is what this file does.
//
// Idempotent and self-guarding, same pattern as seed.js / getOrCreateCounterTable()
// in src/routes/tables.js: safe to call on every server boot (it's called
// from server.js right after seed(), same per-process-once gate) — after the
// first successful run it just checks the flag below and returns
// immediately. If a past migration needs correcting, don't edit this file
// after it's shipped — add a new migration file/flag instead, the same way a
// real schema migration tool would, so re-running the app doesn't silently
// redo (or skip) work.
const MIGRATION_FLAG = "migration_2026_09_feedback_applied";

// Product photos for the new drink items — only ever read as base64 bytes
// via require(), never touched on local disk at runtime. public/uploads/ is
// gitignored (see .gitignore) and Vercel has no writable/persistent disk
// between requests anyway (see the file-level comment in src/db.js), so
// photos for items created here go through the same MongoDB photos
// collection + /api/photo/:id route that admin-panel photo uploads already
// use (src/routes/menu.js's POST .../photo), instead of the
// /uploads/dish-N.jpg static-file convention seed.js's older items use.
const KELLY = require("./assets/kelly");
const PEAR = require("./assets/pear");
const BONGBONG = require("./assets/bongbong");
const PORORO_APPLE = require("./assets/pororoApple");
const PORORO_ZERO_STRAWBERRY = require("./assets/pororoZeroStrawberry");
const PORORO_ZERO_MILK = require("./assets/pororoZeroMilk");

async function applyFeedback202609(store, { save, nextId, savePhoto }) {
  if (store.settings && store.settings[MIGRATION_FLAG]) return;

  const drinkCategory = store.categories.find((c) => c.name_zh === "飲料" || c.key === "drink");
  if (!drinkCategory) return; // menu not seeded yet — nothing to migrate onto; will retry next boot

  // ---- 1. 냉면/비빔냉면 옆에 소그림, 된장찌개/잡채 옆에 고추그림 (items 9/10) ----
  // Idempotent by checking the emoji isn't already there, in case this ever
  // runs twice against data that was hand-edited in between.
  const ICON_APPEND = {
    28: " 🐄", // 냉면
    29: " 🐄", // 비빔냉면
    43: " 🌶️", // 된장찌개
    81: " 🌶️", // 잡채
  };
  for (const [code, icon] of Object.entries(ICON_APPEND)) {
    const item = store.menuItems.find((m) => m.code === code);
    if (item && item.name_zh && !item.name_zh.includes(icon.trim())) {
      item.name_zh = `${item.name_zh}${icon}`;
      if (item.name_ko && !item.name_ko.includes(icon.trim())) item.name_ko = `${item.name_ko}${icon}`;
      if (item.name_en && !item.name_en.includes(icon.trim())) item.name_en = `${item.name_en}${icon}`;
    }
  }

  // ---- 2. 사리면/볶음밥/밥→당면 교체 addons (items 13/14/15) ----
  const ADDONS = {
    15: "飯換冬粉(免費):0",
    42: "飯換冬粉(免費):0",
    45: "飯換冬粉(免費):0",
    52: "加點炒飯:80,加點泡麵:50",
    71: "加點泡麵:50",
    74: "加點泡麵:50",
    75: "加點泡麵:50",
  };
  for (const [code, addons] of Object.entries(ADDONS)) {
    const item = store.menuItems.find((m) => m.code === code);
    if (item && !item.addons) item.addons = addons;
  }

  // ---- 3. 뽀로로 3종 명확화 + 신규 음료 3종 (items 11/12) ----
  // Renames 99/100 to their real ZERO variant if they already exist (created
  // by an earlier seed()); creates any of 98-103 that are still missing —
  // covers both "seed() ran before this feedback existed" and "seed() never
  // ran with these codes at all" in one pass.
  async function upsertDrink(code, fields, photoAsset) {
    let item = store.menuItems.find((m) => m.code === code);
    if (item) {
      for (const [k, v] of Object.entries(fields)) if (!item[k]) item[k] = v;
      return;
    }
    let photo_url = null;
    if (photoAsset) {
      const photoId = await savePhoto(Buffer.from(photoAsset.base64, "base64"), photoAsset.mime);
      photo_url = `/api/photo/${photoId}`;
    }
    const maxSort = store.menuItems.reduce((m, i) => Math.max(m, i.sort_order), 0);
    item = {
      id: nextId("menuItems"),
      category_id: drinkCategory.id,
      code,
      name_zh: fields.name_zh,
      name_ko: fields.name_ko || null,
      name_en: fields.name_en || null,
      desc_zh: null,
      desc_ko: null,
      desc_en: null,
      price: fields.price,
      price_note: null,
      original_price: null,
      options: null,
      spice_options: null,
      addons: null,
      mix_options: 0,
      min_first_order_qty: null,
      allergens: [],
      is_spicy: 0,
      is_signature: 0,
      photo_url,
      available: 1,
      sort_order: maxSort + 1,
    };
    store.menuItems.push(item);
  }

  await upsertDrink(
    "98",
    { name_zh: "Pororo兒童飲料(蘋果)", name_ko: "뽀로로 음료(사과)", name_en: "Pororo Kids Drink (Apple)", price: 50 },
    PORORO_APPLE
  );
  await upsertDrink(
    "99",
    { name_zh: "Pororo ZERO兒童飲料(草莓)", name_ko: "뽀로로 제로 음료(딸기)", name_en: "Pororo ZERO Kids Drink (Strawberry)", price: 50 },
    PORORO_ZERO_STRAWBERRY
  );
  await upsertDrink(
    "100",
    { name_zh: "Pororo ZERO兒童飲料(牛奶)", name_ko: "뽀로로 제로 음료(밀크)", name_en: "Pororo ZERO Kids Drink (Milk)", price: 50 },
    PORORO_ZERO_MILK
  );
  await upsertDrink("101", { name_zh: "Bong Bong 葡萄汁", name_ko: "포도봉봉", name_en: "Bong Bong Grape Juice", price: 50 }, BONGBONG);
  await upsertDrink("102", { name_zh: "水梨果肉飲料", name_ko: "갈아만든 배", name_en: "Blended Pear Drink", price: 50 }, PEAR);
  await upsertDrink(
    "103",
    { name_zh: "Kelly 啤酒", name_ko: "Kelly 맥주", name_en: "Kelly Danish Premium All Malt Beer", price: 130 },
    KELLY
  );
  // Existing 99/100 rows get their name corrected even if they already had a
  // photo/other fields set — the `!item[k]` skip in upsertDrink only guards
  // fields that are still empty, and name_zh/name_ko/name_en are never empty
  // on an existing row, so do the rename as an explicit second pass.
  const renameIfPlain = (code, fields) => {
    const item = store.menuItems.find((m) => m.code === code);
    if (item && item.name_zh && !item.name_zh.includes("ZERO")) {
      item.name_zh = fields.name_zh;
      item.name_ko = fields.name_ko;
      item.name_en = fields.name_en;
    }
  };
  renameIfPlain("99", { name_zh: "Pororo ZERO兒童飲料(草莓)", name_ko: "뽀로로 제로 음료(딸기)", name_en: "Pororo ZERO Kids Drink (Strawberry)" });
  renameIfPlain("100", { name_zh: "Pororo ZERO兒童飲料(牛奶)", name_ko: "뽀로로 제로 음료(밀크)", name_en: "Pororo ZERO Kids Drink (Milk)" });

  store.settings[MIGRATION_FLAG] = true;
  await save();
  console.log("Applied 2026-09 feedback migration.");
}

module.exports = { applyFeedback202609 };
