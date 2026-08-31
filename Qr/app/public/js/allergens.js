// Shared meat-type / allergen tag definitions, used by both the admin panel
// (public/js/admin.js) and the customer ordering page (public/js/order.js).
// This project has no bundler, so this is just a plain <script> include that
// defines a global ALLERGENS array — include it before admin.js / order.js.
//
// Meat/protein tags come first (useful for religious/dietary restrictions
// like halal or vegetarian, not just allergies), then common allergens
// (roughly Taiwan's expanded food-allergen labeling categories, plus a few
// common international ones).
window.ALLERGENS = [
  { id: "pork", icon: "🐷", zh: "豬肉", ko: "돼지고기", en: "Pork" },
  { id: "beef", icon: "🐄", zh: "牛肉", ko: "소고기", en: "Beef" },
  { id: "chicken", icon: "🐔", zh: "雞肉", ko: "닭고기", en: "Chicken" },
  { id: "dairy", icon: "🥛", zh: "奶類", ko: "우유", en: "Dairy" },
  { id: "egg", icon: "🥚", zh: "蛋類", ko: "계란", en: "Egg" },
  { id: "peanut", icon: "🥜", zh: "花生", ko: "땅콩", en: "Peanut" },
  { id: "treenut", icon: "🌰", zh: "堅果類", ko: "견과류", en: "Tree Nuts" },
  { id: "shellfish", icon: "🦐", zh: "甲殼類", ko: "갑각류", en: "Shellfish" },
  { id: "fish", icon: "🐟", zh: "魚類", ko: "생선", en: "Fish" },
  { id: "gluten", icon: "🌾", zh: "麩質穀物(小麥)", ko: "밀(글루텐)", en: "Gluten/Wheat" },
  { id: "soy", icon: "🌱", zh: "大豆", ko: "대두", en: "Soy" },
  { id: "sesame", icon: "⚫", zh: "芝麻", ko: "참깨", en: "Sesame" },
];
