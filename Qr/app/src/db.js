// Tiny dependency-free JSON file datastore.
// Chosen instead of a native SQLite binding so the app installs and runs
// on any hosting platform without needing a C++ build toolchain.
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const FILE = path.join(DATA_DIR, "store.json");

function defaultStore() {
  return {
    nextId: { categories: 1, menuItems: 1, tables: 1, orders: 1 },
    categories: [],
    menuItems: [],
    tables: [],
    orders: [],
    settings: {},
  };
}

let store;
if (fs.existsSync(FILE)) {
  try {
    store = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch (e) {
    console.error("Failed to parse store.json — starting from an empty store.", e);
    store = defaultStore();
  }
} else {
  store = defaultStore();
}

// Backfill any keys missing (lets us evolve the schema safely later)
const defaults = defaultStore();
for (const k of Object.keys(defaults)) if (!(k in store)) store[k] = defaults[k];
for (const k of Object.keys(defaults.nextId)) if (!(k in store.nextId)) store.nextId[k] = 1;

function save() {
  fs.writeFileSync(FILE, JSON.stringify(store, null, 2));
}

function nextId(collection) {
  const id = store.nextId[collection]++;
  return id;
}

module.exports = { store, save, nextId };
