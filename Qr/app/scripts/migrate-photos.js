// One-time migration: uploads the dish photos that were extracted from
// Menu_with_photo.pdf (living locally at public/uploads/dish-{code}.jpg,
// which is .gitignore'd and never reaches Vercel) into the MongoDB `photos`
// collection, and points each menu item's photo_url at /api/photo/{id}.
//
// Run this ONCE, locally, after MONGODB_URI in your .env points at the same
// Atlas cluster your live site uses:
//
//   node scripts/migrate-photos.js
//
// Safe to re-run — items that already have an /api/photo/ URL are skipped.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { connectDB, store, save, savePhoto } = require("../src/db");

// Codes whose dish photo was extracted and saved as public/uploads/dish-{code}.jpg
const CODES_WITH_PHOTOS = [
  "11", "12", "13", "14", "15", "16", "17", "18", "21", "23", "24", "26", "28",
  "41", "42", "43", "44", "45", "51", "52", "54", "71", "72", "73", "74", "75",
  "76", "77", "78", "79", "80", "81", "82", "83", "98", "99", "100",
];
// Items that reuse a sibling's photo (code -> code whose dish-{code}.jpg to use)
const PHOTO_ALIAS = { "22": "21", "25": "24", "27": "26", "29": "28", "53": "52" };

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is not set in .env — add the same connection string you gave Vercel, then re-run.");
    process.exit(1);
  }

  await connectDB();
  const uploadsDir = path.join(__dirname, "..", "public", "uploads");

  const codeToFile = {};
  for (const code of CODES_WITH_PHOTOS) codeToFile[code] = path.join(uploadsDir, `dish-${code}.jpg`);
  for (const [aliasCode, sourceCode] of Object.entries(PHOTO_ALIAS)) {
    codeToFile[aliasCode] = path.join(uploadsDir, `dish-${sourceCode}.jpg`);
  }

  let uploaded = 0, skipped = 0, missing = 0;
  for (const item of store.menuItems) {
    if (!item.code || !codeToFile[item.code]) continue;
    if (item.photo_url && item.photo_url.startsWith("/api/photo/")) {
      skipped++;
      continue;
    }
    const filePath = codeToFile[item.code];
    if (!fs.existsSync(filePath)) {
      console.warn(`Missing file for code ${item.code}: ${filePath}`);
      missing++;
      continue;
    }
    const buffer = fs.readFileSync(filePath);
    const id = await savePhoto(buffer, "image/jpeg");
    item.photo_url = `/api/photo/${id}`;
    uploaded++;
    console.log(`  ${item.code}  ${item.name_zh} -> ${item.photo_url}`);
  }

  await save();
  console.log(`\nDone. Uploaded ${uploaded}, already migrated ${skipped}, missing files ${missing}.`);
  process.exit(0);
}

run().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
