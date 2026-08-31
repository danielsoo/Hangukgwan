// One-time migration: the griddle (불판) items — 동판불고기(51), 닭갈비(52),
// 삼겹살(54) — used to be priced per 2 servings (charged as if qty=1 meant
// "2인분"). This splits that back into a real per-1-serving price and marks
// each item with min_first_order_qty so the app enforces the "first order
// needs >= 2 servings" rule itself (qty stepper starts at 2, server
// re-checks it — see src/routes/orders.js) instead of baking it into price.
// 동판불고기 additionally gets mix_options so customers can pick beef and
// pork independently (e.g. 1 of each) instead of only one radio choice.
//
// Safe to run more than once — an item already carrying min_first_order_qty
// is skipped, so prices never get halved twice.
//
// Run this ONCE, locally, the same way as migrate-photos.js /
// renumber-unlucky-tables.js (needs MONGODB_URI in .env pointing at the live
// cluster):
//
//   node scripts/split-grill-pricing.js
require("dotenv").config();
const { refreshStore, store, save } = require("../src/db");

// code -> { divisor, min_first_order_qty, mix_options, price_note }
const GRILL_ITEMS = {
  "51": { divisor: 2, min_first_order_qty: 2, mix_options: true, price_note: "首次低消2份(可混搭牛豬) / min 2 on 1st order, mix ok" },
  "52": { divisor: 2, min_first_order_qty: 2, mix_options: false, price_note: "首次點餐低消2份 / min 2 on 1st order" },
  "54": { divisor: 2, min_first_order_qty: 2, mix_options: false, price_note: "首次點餐低消2份 / min 2 on 1st order" },
};

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is not set in .env — add the same connection string you gave Vercel, then re-run.");
    process.exit(1);
  }

  await refreshStore();

  let changed = 0;
  let skipped = 0;
  for (const [code, cfg] of Object.entries(GRILL_ITEMS)) {
    const item = store.menuItems.find((i) => i.code === code);
    if (!item) {
      console.log(`  code ${code}: not found, skipping`);
      continue;
    }
    if (item.min_first_order_qty) {
      console.log(`  code ${code} (${item.name_zh}): already migrated (min_first_order_qty=${item.min_first_order_qty}), skipping`);
      skipped++;
      continue;
    }
    const oldPrice = item.price;
    item.price = Math.round(item.price / cfg.divisor);
    item.price_note = cfg.price_note;
    item.min_first_order_qty = cfg.min_first_order_qty;
    item.mix_options = cfg.mix_options ? 1 : 0;
    console.log(`  code ${code} (${item.name_zh}): price ${oldPrice} -> ${item.price}, min_first_order_qty=${item.min_first_order_qty}, mix_options=${item.mix_options}`);
    changed++;
  }

  if (changed === 0) {
    console.log(`\nNothing to change (${skipped} item(s) already migrated).`);
    process.exit(0);
  }

  await save();
  console.log(`\nDone. Updated ${changed} item(s).`);
  process.exit(0);
}

run().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
