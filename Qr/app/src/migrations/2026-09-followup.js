// Follow-up one-time data migration for issues found *after*
// 2026-09-feedback.js had already shipped (its own file-level comment says
// not to keep editing a migration once it's live — add a new one instead,
// same as a real schema migration tool). Everything here was noticed while
// reviewing the official PDF menu / a later round of UI feedback.
//
// Idempotent and self-guarding, same pattern as 2026-09-feedback.js: safe to
// call on every server boot, no-ops after its first successful run.
const MIGRATION_FLAG = "migration_2026_09_followup_applied";

async function applyFollowup202609(store, { save }) {
  if (store.settings && store.settings[MIGRATION_FLAG]) return;

  // ---- 1. 냉면/비빔냉면(28/29) 이름에서 🐄 이모지 제거 ----
  // 2026-09-feedback.js's ICON_APPEND step baked a 🐄 (COW) emoji straight
  // onto these two items' name_zh/name_ko/name_en so every place that shows
  // the item name (menu list, item detail sheet, kitchen ticket, admin
  // lists...) got a cow indicator for free. Turned out to be the wrong fix:
  // 🐄 renders as a side-view dairy cow on most platforms — the exact same
  // "옆 모습" complaint that came up for 牛/豬 (see cow-face.png) — and baking
  // any icon into the stored name string means it shows up as raw text
  // everywhere that string is used, including a printed kitchen ticket where
  // an emoji can print as a box or blank. This strips it back out; the menu
  // list row (public/js/order.js, BEEF_BROTH_ICON_CODES) now shows the same
  // cropped-from-the-PDF cow-face.png icon next to the name instead, the
  // same way 牛/豬 already do — a rendered image, not text in the name.
  for (const code of ["28", "29"]) {
    const item = store.menuItems.find((m) => m.code === code);
    if (!item) continue;
    for (const field of ["name_zh", "name_ko", "name_en"]) {
      if (item[field]) item[field] = item[field].replace(/\s*🐄\s*$/u, "");
    }
  }

  // ---- 2. 해물파전/야채전/김치전(77/78/79) 소개 문구 추가 ----
  // Transcribed verbatim from the official PDF menu (2026-04-28) — the app
  // had no desc_zh for these three items even though the printed menu does.
  const DESC_ZH = {
    77: "魷魚、蝦仁等營養海鮮豐富添加的海鮮煎餅，韓國人習慣下雨天搭配瑪格麗(韓國米酒)吃",
    78: "獨家手做泡菜、金針菇等蔬菜做的營養泡菜煎餅，泡菜的酸味並不是壞掉的！每個泡菜都有自己的發酵度",
    79: "不只有素食者可以吃！大陸妹和紅蘿蔔的健康材料脆脆的口感，健康美味的一餐！",
  };
  for (const [code, desc] of Object.entries(DESC_ZH)) {
    const item = store.menuItems.find((m) => m.code === code);
    if (item && !item.desc_zh) item.desc_zh = desc;
  }

  store.settings[MIGRATION_FLAG] = true;
  await save();
  console.log("Applied 2026-09 follow-up migration.");
}

module.exports = { applyFollowup202609 };
