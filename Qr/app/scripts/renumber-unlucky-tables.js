// One-time migration: renames any existing table whose number contains the
// digit "4" (avoided in Taiwan — homophone for 死/death) to the next free
// number that doesn't. Run this ONCE, locally, the same way as
// migrate-photos.js (needs MONGODB_URI in .env pointing at the live cluster):
//
//   node scripts/renumber-unlucky-tables.js
//
// After running this, reprint the QR sheet from Admin > 테이블 / QR 코드,
// since the renumbered tables now point at different URLs.
require("dotenv").config();
const { connectDB, store, save } = require("../src/db");

function isLucky(n) {
  return !String(n).includes("4");
}

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is not set in .env — add the same connection string you gave Vercel, then re-run.");
    process.exit(1);
  }

  await connectDB();

  const usedNumbers = new Set(
    store.tables.map((t) => parseInt(t.number, 10)).filter((n) => !Number.isNaN(n))
  );
  const unlucky = store.tables
    .filter((t) => String(t.number).includes("4"))
    .sort((a, b) => parseInt(a.number, 10) - parseInt(b.number, 10));

  if (unlucky.length === 0) {
    console.log("No unlucky (4-containing) table numbers found — nothing to do.");
    process.exit(0);
  }

  let candidate = Math.max(0, ...usedNumbers);
  unlucky.forEach((t) => {
    const oldNumber = t.number;
    usedNumbers.delete(parseInt(oldNumber, 10));
    do {
      candidate++;
    } while (!isLucky(candidate) || usedNumbers.has(candidate));
    usedNumbers.add(candidate);
    t.number = String(candidate);
    t.sort_order = candidate;
    console.log(`  ${oldNumber}  ->  ${candidate}`);
  });

  await save();
  console.log(`\nDone. Renamed ${unlucky.length} table(s). Reprint the QR sheet from Admin > 테이블 / QR 코드.`);
  process.exit(0);
}

run().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
