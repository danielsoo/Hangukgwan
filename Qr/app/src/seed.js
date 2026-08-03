// Seeds the datastore with the 韓國館 (Hangukgwan) menu, tables, and admin
// account. Safe to run multiple times — it only inserts data the first time
// (when the categories list is empty).
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { store, save, nextId, connectDB } = require("./db");

const CATEGORIES = [
  { key: "rice", name_zh: "飯類", name_ko: "밥류", name_en: "Rice Dishes", sort_order: 1 },
  { key: "noodle", name_zh: "麵類", name_ko: "면류", name_en: "Noodles", sort_order: 2 },
  { key: "hotpot", name_zh: "鍋類", name_ko: "찌개류", name_en: "Hot Pots & Soups", sort_order: 3 },
  { key: "bbq", name_zh: "烤肉類", name_ko: "구이류", name_en: "Korean BBQ", sort_order: 4 },
  { key: "other", name_zh: "其他", name_ko: "기타", name_en: "Other Dishes", sort_order: 5 },
  { key: "drink", name_zh: "飲料", name_ko: "음료", name_en: "Drinks", sort_order: 6 },
];

// price_note holds any extra label to show under the price (e.g. "2人份")
// options: comma separated choice list shown to the customer as radio buttons
const ITEMS = {
  rice: [
    { code: "11", name_zh: "石鍋拌飯", name_ko: "돌솥비빔밥", name_en: "Stone Pot Bibimbap", price: 230, options: "牛,豬", is_signature: 1 },
    { code: "12", name_zh: "韓式拌飯", name_ko: "비빔밥(돼지)", name_en: "Bibimbap (Pork)", price: 210 },
    { code: "13", name_zh: "辣炒肉飯", name_ko: "제육덮밥", name_en: "Spicy Pork Rice Bowl", price: 240, is_spicy: 1 },
    { code: "14", name_zh: "魷魚燴飯", name_ko: "오징어덮밥", name_en: "Squid Rice Bowl", price: 250 },
    { code: "15", name_zh: "韓式烤肉飯", name_ko: "뚝배기 불고기", name_en: "Bulgogi Rice Bowl", price: 240, options: "牛,豬" },
    { code: "16", name_zh: "泡菜炒飯", name_ko: "김치볶음밥", name_en: "Kimchi Fried Rice", price: 230, is_spicy: 1 },
    { code: "17", name_zh: "蛋包飯", name_ko: "오므라이스", name_en: "Omurice (Rice Omelette)", price: 210, options: "鮪魚,蝦仁" },
    { code: "18", name_zh: "冬粉蓋飯", name_ko: "잡채덮밥", name_en: "Japchae Rice Bowl", price: 230, is_spicy: 1 },
  ],
  noodle: [
    { code: "21", name_zh: "辛拉麵(泡麵)", name_ko: "신라면", name_en: "Shin Ramyun", price: 180 },
    { code: "22", name_zh: "辛拉麵套餐", name_ko: "신라면 김밥세트", name_en: "Shin Ramyun + Kimbap Set", price: 280 },
    { code: "23", name_zh: "大滷麵", name_ko: "우동면", name_en: "Seafood Udon (not spicy)", price: 230, desc_zh: "海鮮麵不辣", desc_ko: "맵지 않아요", desc_en: "Not spicy" },
    { code: "24", name_zh: "韓式炸醬麵", name_ko: "짜장면", name_en: "Korean Black Bean Noodles", price: 230 },
    { code: "25", name_zh: "韓式炸醬飯", name_ko: "짜장밥", name_en: "Korean Black Bean Rice", price: 230 },
    { code: "26", name_zh: "韓式海鮮麵", name_ko: "짬뽕", name_en: "Spicy Seafood Noodle Soup", price: 230, is_spicy: 1 },
    { code: "27", name_zh: "韓式海鮮飯", name_ko: "짬뽕밥", name_en: "Spicy Seafood Rice", price: 230, is_spicy: 1 },
    { code: "28", name_zh: "韓式水冷麵", name_ko: "냉면", name_en: "Cold Noodle Soup", price: 230 },
    { code: "29", name_zh: "韓式拌麵", name_ko: "비빔냉면", name_en: "Spicy Cold Mixed Noodles", price: 230, is_spicy: 1 },
  ],
  hotpot: [
    { code: "41", name_zh: "泡菜火鍋", name_ko: "김치찌개", name_en: "Kimchi Stew", price: 230, is_spicy: 1 },
    { code: "42", name_zh: "海鮮豆腐鍋", name_ko: "순두부찌개", name_en: "Seafood Soft Tofu Stew", price: 240, is_spicy: 1 },
    { code: "43", name_zh: "韓式味噌鍋", name_ko: "된장찌개", name_en: "Soybean Paste Stew", price: 230 },
    { code: "44", name_zh: "人蔘雞", name_ko: "삼계탕", name_en: "Ginseng Chicken Soup", price: 400 },
    { code: "45", name_zh: "牛骨湯飯", name_ko: "사골곰탕", name_en: "Beef Bone Soup with Rice", price: 240 },
  ],
  bbq: [
    { code: "51", name_zh: "銅盤烤肉", name_ko: "동판불고기", name_en: "Korean BBQ Bulgogi", price: 500, price_note: "2人份 / for 2", options: "牛,豬" },
    { code: "52", name_zh: "辣炒雞排", name_ko: "닭갈비", name_en: "Spicy Stir-fried Chicken", price: 600, price_note: "2人份 / for 2", is_spicy: 1 },
    { code: "53", name_zh: "雞排拌飯(加飯)", name_ko: "볶음밥 추가", name_en: "Fried Rice Add-on (for 辣炒雞排)", price: 80 },
    { code: "54", name_zh: "生烤五花肉", name_ko: "삼겹살", name_en: "Grilled Pork Belly", price: 620, price_note: "2人份 / for 2" },
  ],
  other: [
    { code: "71", name_zh: "部隊鍋", name_ko: "부대찌개", name_en: "Army Stew", price: 600, is_spicy: 1, is_signature: 1 },
    { code: "72", name_zh: "青椒牛肉片", name_ko: "소고기 볶음", name_en: "Beef with Green Pepper", price: 380 },
    { code: "73", name_zh: "辣炒魷魚", name_ko: "오징어볶음", name_en: "Spicy Stir-fried Squid", price: 400, is_spicy: 1 },
    { code: "74", name_zh: "辣炒年糕", name_ko: "떡볶이", name_en: "Spicy Rice Cakes (Tteokbokki)", price: 380, is_spicy: 1 },
    { code: "75", name_zh: "起司辣炒年糕", name_ko: "치즈떡볶이", name_en: "Cheese Tteokbokki", price: 420, is_spicy: 1 },
    { code: "76", name_zh: "辣炒肉片", name_ko: "제육볶음", name_en: "Spicy Stir-fried Pork", price: 360, is_spicy: 1 },
    { code: "77", name_zh: "海鮮煎餅", name_ko: "해물파전", name_en: "Seafood Pancake", price: 240, is_signature: 1 },
    { code: "78", name_zh: "泡菜煎餅", name_ko: "김치전", name_en: "Kimchi Pancake", price: 230, is_spicy: 1 },
    { code: "79", name_zh: "蔬菜煎餅", name_ko: "야채전", name_en: "Vegetable Pancake", price: 210 },
    { code: "80", name_zh: "泡菜豆腐", name_ko: "두부김치", name_en: "Tofu with Kimchi", price: 300, is_spicy: 1 },
    { code: "81", name_zh: "韓式冬粉", name_ko: "잡채", name_en: "Japchae (Glass Noodles)", price: 300 },
    { code: "82", name_zh: "韓式紫菜捲", name_ko: "김밥", name_en: "Korean Seaweed Rice Roll (Kimbap)", price: 150 },
    { code: "83", name_zh: "涼拌雪螺", name_ko: "골뱅이무침", name_en: "Spicy Whelk Salad", price: 540, is_spicy: 1 },
  ],
  drink: [
    { code: "91", name_zh: "韓國飲料", name_ko: "한국 음료수", name_en: "Korean Soft Drink", price: 50 },
    { code: "92", name_zh: "台灣飲料", name_ko: "대만 음료수", name_en: "Taiwanese Soft Drink", price: 30 },
    { code: "93", name_zh: "泡麵(加點用)", name_ko: "사리면", name_en: "Extra Ramen Noodles (add-on)", price: 50 },
    { code: "94", name_zh: "白飯", name_ko: "공기밥", name_en: "Steamed Rice", price: 20 },
    { code: "95", name_zh: "韓國燒酒", name_ko: "소주", name_en: "Korean Soju", price: 300 },
    { code: "96", name_zh: "台灣啤酒", name_ko: "대만맥주", name_en: "Taiwan Beer", price: 100 },
    { code: "97", name_zh: "海尼根", name_ko: "하이네켄", name_en: "Heineken", price: 130 },
    { code: "98", name_zh: "Pororo兒童飲料(蘋果)", name_ko: "뽀로로 음료(사과)", name_en: "Pororo Kids Drink (Apple)", price: 50 },
    { code: "99", name_zh: "Pororo兒童飲料(草莓)", name_ko: "뽀로로 음료(딸기)", name_en: "Pororo Kids Drink (Strawberry)", price: 50 },
    { code: "100", name_zh: "Pororo兒童飲料(牛奶)", name_ko: "뽀로로 음료(밀크)", name_en: "Pororo Kids Drink (Milk)", price: 50 },
  ],
};

// Codes for items whose dish photo was extracted from Menu_with_photo.pdf and
// saved to public/uploads/dish-{code}.jpg. Used to auto-fill photo_url on
// first seed (fresh installs). Existing installs are patched separately.
const CODES_WITH_PHOTOS = [
  "11", "12", "13", "14", "15", "16", "17", "18", "21", "23", "24", "26", "28",
  "41", "42", "43", "44", "45", "51", "52", "54", "71", "72", "73", "74", "75",
  "76", "77", "78", "79", "80", "81", "82", "83", "98", "99", "100",
];
// Items that share the same menu photo as a sibling variant (e.g. 辛拉麵套餐
// uses the same photo as 辛拉麵) — code -> code whose dish-{code}.jpg to reuse.
const PHOTO_ALIAS = { "22": "21", "25": "24", "27": "26", "29": "28", "53": "52" };

async function run() {
  await connectDB();

  if (store.categories.length === 0) {
    const catIds = {};
    for (const c of CATEGORIES) {
      const id = nextId("categories");
      catIds[c.key] = id;
      store.categories.push({ id, ...c });
    }

    let sort = 0;
    for (const key of Object.keys(ITEMS)) {
      for (const item of ITEMS[key]) {
        sort += 1;
        const id = nextId("menuItems");
        store.menuItems.push({
          id,
          category_id: catIds[key],
          code: item.code || null,
          name_zh: item.name_zh,
          name_ko: item.name_ko || null,
          name_en: item.name_en || null,
          desc_zh: item.desc_zh || null,
          desc_ko: item.desc_ko || null,
          desc_en: item.desc_en || null,
          price: item.price,
          price_note: item.price_note || null,
          options: item.options || null,
          is_spicy: item.is_spicy ? 1 : 0,
          is_signature: item.is_signature ? 1 : 0,
          photo_url: CODES_WITH_PHOTOS.includes(item.code)
            ? `/uploads/dish-${item.code}.jpg`
            : PHOTO_ALIAS[item.code]
            ? `/uploads/dish-${PHOTO_ALIAS[item.code]}.jpg`
            : null,
          available: 1,
          sort_order: sort,
        });
      }
    }
    console.log("Seeded categories + menu items.");
  }

  if (store.tables.length === 0) {
    const DEFAULT_TABLE_COUNT = parseInt(process.env.DEFAULT_TABLE_COUNT || "40", 10);
    // Skip any table number containing the digit 4 (死 homophone — avoided
    // in Taiwan the way many buildings skip the 4th/14th/24th floor).
    let n = 0;
    let created = 0;
    while (created < DEFAULT_TABLE_COUNT) {
      n++;
      if (String(n).includes("4")) continue;
      const id = nextId("tables");
      store.tables.push({ id, number: String(n), label: null, sort_order: n });
      created++;
    }
    console.log(`Seeded ${DEFAULT_TABLE_COUNT} tables (skipping numbers containing "4").`);
  }

  // Floor plan: 4 default zones (owner can rename/resize/move them from
  // Admin > 테이블 / QR 코드 > 배치도 보기), arranged 2x2 to start.
  if (store.zones.length === 0) {
    const defaultZones = [
      { name: "구역 1", x: 20, y: 20, width: 340, height: 260 },
      { name: "구역 2", x: 380, y: 20, width: 340, height: 260 },
      { name: "구역 3", x: 20, y: 300, width: 340, height: 260 },
      { name: "구역 4", x: 380, y: 300, width: 340, height: 260 },
    ];
    defaultZones.forEach((z, i) => {
      store.zones.push({ id: nextId("zones"), sort_order: i + 1, ...z });
    });
    console.log("Seeded 4 default floor-plan zones.");
  }

  // Backfill floor-plan position/size for any table that doesn't have one
  // yet (existing installs from before this feature) so every table shows
  // up somewhere sensible on first load of the 배치도 view.
  if (store.tables.some((t) => t.x == null)) {
    const perRow = 8;
    let i = 0;
    for (const t of store.tables) {
      if (t.x == null) {
        t.x = 20 + (i % perRow) * 90;
        t.y = 20 + Math.floor(i / perRow) * 90;
        t.width = 70;
        t.height = 70;
      }
      i++;
    }
    console.log("Backfilled floor-plan positions for existing tables.");
  }

  if (!store.settings.admin_password_hash) {
    const pw = process.env.ADMIN_PASSWORD || "changeme123";
    store.settings.admin_password_hash = bcrypt.hashSync(pw, 10);
    console.log("Seeded admin password from ADMIN_PASSWORD env (change it in Admin > Settings).");
  }

  const storeDefaults = {
    store_name_zh: process.env.STORE_NAME_ZH || "韓國館",
    store_name_ko: process.env.STORE_NAME_KO || "한국관",
    store_name_en: process.env.STORE_NAME_EN || "Hangukgwan Korean Restaurant",
    store_phone: process.env.STORE_PHONE || "03-656-7994",
    store_address_zh: process.env.STORE_ADDRESS_ZH || "新竹縣竹北市縣政九路135巷32號",
    store_address_ko: process.env.STORE_ADDRESS_KO || "",
    store_address_en: process.env.STORE_ADDRESS_EN || "",
    store_hours: process.env.STORE_HOURS || "11:00-14:00, 17:00-21:00",
    store_min_spend: process.env.STORE_MIN_SPEND || "200",
    store_notice: process.env.STORE_NOTICE || "",
    store_cover_photo: "",
    // Location-based order guard: empty until the owner taps "Set current
    // location" from the store, standing at the restaurant. Until set, no
    // location check is enforced (fully backward compatible).
    store_lat: "",
    store_lng: "",
    order_radius_m: "200",
  };
  for (const [k, v] of Object.entries(storeDefaults)) {
    if (!(k in store.settings)) store.settings[k] = v;
  }

  await save();
}

module.exports = run;
