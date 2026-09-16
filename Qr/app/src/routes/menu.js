const express = require("express");
const multer = require("multer");
const { store, save, refreshAndSave, nextId, savePhoto, deletePhoto } = require("../db");
const { requireAdmin, requirePermission } = require("../auth");
const { withAvailability, today } = require("../availability");
const { broadcastOnWrite } = require("../realtime");
const { DELETED_AT, activeItems, deletedItems, isDeleted } = require("../menuItems");
const { reserveId } = require("../db");
const { isDiscountExcludedCategory, isDiscountExcludedMenuItem } = require("../discounts");
const { nowLocal } = require("../time");
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
    // 휴지통에 있는 것은 어디에도 안 보인다 — 손님 화면도, 메뉴 관리 표도.
    // 번호만 살려둔 것이지 메뉴로 살아 있는 게 아니다(src/menuItems.js).
    let items = activeItems(store.menuItems)
      .filter((i) => i.category_id === c.id)
      .map((i) => withAvailability(i, store.settings));
    if (onlyAvailable) items = items.filter((i) => i.available);
    items = items.sort((a, b) => a.sort_order - b.sort_order);
    // 할인 제외 여부는 **서버가 답을 내서** 내보낸다. 화면이 키 목록을
    // 받아 다시 판단하던 것을 그만둔다 — 같은 규칙을 두 군데서 적으면
    // 화면에 뜬 금액과 실제로 받는 금액이 언젠가 갈린다. 여기서 늘
    // true/false 로 못 박아 보내면 화면은 그대로 쓰기만 하면 된다.
    // 메뉴 한 줄의 할인 제외도 **서버가 답을 내서** 보낸다(2026-09-16
    // 사장님: "모든 주문마다 할인 적용 온 오프 할 수 있게"). 화면은
    // discount_excluded 를 그대로 믿고 쓰면 되고, 수정 폼이 「분류 따름 /
    // 적용 / 제외」 셋 중 무엇인지 보여줄 수 있게 메뉴 자신이 들고 있는
    // 날것(discount_excluded_own)도 같이 보낸다.
    const catExcluded = isDiscountExcludedCategory(c);
    items = items.map((i) => ({
      ...i,
      discount_excluded: isDiscountExcludedMenuItem(i, c),
      discount_excluded_own: i.discount_excluded === undefined ? null : i.discount_excluded,
    }));
    return { ...c, discount_excluded: catExcluded, items };
  });
}

/**
 * 메뉴 한 줄이 성립하는가.
 *
 * 2026-09-15 사장님: "메뉴가 삭제되거나 수정되거나 업데이트 될 때 문제가
 * 생기지 않게 보안장치를 넣자는 거야."
 *
 * 여기서 막는 것은 전부 **조용히 망가지는** 것들이다. 화면이 실수를 그대로
 * 보내고 서버가 그대로 받으면, 사장님은 저장됐다고 믿고 넘어간다.
 *
 *   · 이름이 비면 손님 화면에 빈 줄이 뜬다
 *   · 가격이 숫자가 아니면 그 뒤의 모든 금액 계산이 NaN 이 된다
 *   · 없는 분류로 저장하면 어느 분류에도 안 걸려 **목록에서 사라진다**
 *     (categoriesWithItems 가 분류별로 그린다). 지운 것도 아닌데 없어진다.
 *
 * 고칠 값만 보내는 수정(PUT)도 있으므로, 보내온 칸만 본다.
 *
 * 0원은 막지 않는다. 서비스로 주는 메뉴가 있을 수 있다 — 대신 화면이 한 번
 * 물어본다(admin.js). 음수는 막는다. 그건 실수 말고는 없다.
 */
function validateItemFields(b, cats, { requireAll } = {}) {
  const has = (k) => b[k] !== undefined;
  const wantName = requireAll || has("name_zh");
  if (wantName && !String(b.name_zh == null ? "" : b.name_zh).trim()) {
    return "name_required";
  }
  if (requireAll || has("price")) {
    const price = Number(b.price);
    if (!Number.isFinite(price) || price < 0) return "invalid_price";
  }
  for (const k of ["original_price", "min_first_order_qty"]) {
    if (!has(k) || b[k] == null || b[k] === "") continue;
    const v = Number(b[k]);
    if (!Number.isFinite(v) || v < 0) return "invalid_" + k;
  }
  // 수정에서 분류가 빈 값/null 로 오는 것은 **거절하지 않는다.** 화면에서
  // 고른 것이 풀렸을 뿐일 수 있고(2026-09-14 「저절로 밥류로 바뀜」 건),
  // 그때는 아래 PUT 이 지금 분류를 그대로 둔다. 여기서 400 을 내면 멀쩡한
  // 수정까지 막힌다. 진짜 값이 왔는데 그런 분류가 없을 때만 막는다.
  const catSent = requireAll || (has("category_id") && b.category_id !== null && b.category_id !== "");
  if (catSent) {
    const cid = parseInt(b.category_id, 10);
    if (!Number.isFinite(cid) || !cats.some((c) => c.id === cid)) return "invalid_category";
  }
  return null;
}

/**
 * 메뉴 코드(77번 같은)가 다른 메뉴와 겹치는가.
 *
 * 겹치면 주방 빌지에 **똑같이 「77」로 찍히는 서로 다른 메뉴**가 생긴다.
 * 손님 화면 검색도 둘 다 걸린다. 지웠다 다시 넣을 때 정확히 이렇게 된다.
 *
 * 이미 그 코드를 쓰고 있던 메뉴가 자기 자신이면 통과시킨다 — 안 그러면
 * 예전에 만들어진 중복 때문에 **상관없는 수정까지 막힌다.** 새로 겹치게
 * 만드는 것만 막는다.
 *
 * 휴지통에 있는 것과는 안 겹친 것으로 친다. 되살릴 때 다시 본다.
 */
function codeConflict(items, code, selfId) {
  const want = String(code == null ? "" : code).trim();
  if (!want) return null;
  return activeItems(items).find((m) => m.id !== selfId && String(m.code || "").trim() === want) || null;
}

/**
 * 휴지통에 **같은 메뉴**가 있는가.
 *
 * 2026-09-15 사장님: "만약에 지웠다가 같은 메뉴를 넣으면 어떻게 돼? 제대로
 * 인식 돼?" — 안 된다. 새로 넣으면 새 번호를 받고, 결산은 메뉴를 번호로
 * 묶으므로(src/settlement.js) **같은 메뉴가 두 줄로 갈라진다.** 「육개장
 * 25개」와 「육개장 15개」가 따로 뜨고 합쳐지지 않는다.
 *
 * 되살리면 번호가 그대로라 그 일이 없다. 그래서 새로 넣기 전에 휴지통을
 * 먼저 본다 — 막는 게 아니라 **물어본다.** 진짜로 다른 메뉴인데 이름만
 * 같을 수도 있으므로(force_new), 고르는 것은 사장님이다.
 *
 * 코드가 같거나 이름이 같으면 같은 메뉴로 본다. 코드가 제일 확실하다.
 */
function trashedTwin(items, b) {
  const norm = (v) => String(v == null ? "" : v).trim().toLowerCase();
  const code = norm(b.code);
  const zh = norm(b.name_zh);
  const ko = norm(b.name_ko);
  return (
    deletedItems(items).find((m) => {
      if (code && norm(m.code) === code) return true;
      if (zh && norm(m.name_zh) === zh) return true;
      if (ko && norm(m.name_ko) === ko) return true;
      return false;
    }) || null
  );
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

/**
 * 메뉴 한 줄의 「할인 적용」 설정을 저장할 값으로 바꾼다.
 *
 * 화면의 <select> 는 "" / "0" / "1" 세 값을 보낸다. 셋을 각각
 * null(분류 따름) / false(할인함) / true(할인 안 함) 로 못 박는다 —
 * ""를 false 로 접어버리면 「분류 따름」과 「분류가 제외여도 할인함」이
 * 같은 값이 돼서, 사장님이 고른 것을 되돌려 보여줄 수 없다.
 */
function normalizeDiscountExcluded(v) {
  if (v === undefined || v === null || v === "") return null;
  if (v === "0" || v === 0 || v === false || v === "false") return false;
  return true;
}

// Admin: full menu including unavailable items
router.get("/admin", requireAdmin, (req, res) => {
  res.json(categoriesWithItems(false));
});

router.get("/admin/categories", requireAdmin, (req, res) => {
  res.json(
    [...store.categories]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((c) => ({ ...c, discount_excluded: isDiscountExcludedCategory(c) }))
  );
});

/**
 * 이 분류를 할인에서 뺄지 말지.
 *
 * 2026-09-16 사장님: "그리고 할인은 기타, 음료 는 모두 적용 안돼."
 * 같은 요청이 두 번째다(2026-09-14 에도 있었다). 그때는 코드에 키 목록을
 * 적는 것으로 끝냈는데, key 는 화면에 안 보이고 사장님이 고칠 수도 없다.
 * 「기타」로 보이는 분류의 key 가 other 가 아니면 조용히 할인이 걸렸고,
 * 어디가 잘못됐는지 알 길이 없었다.
 *
 * 이제 메뉴 관리에서 분류마다 켜고 끈다. 보이고, 고칠 수 있다.
 */
router.patch("/admin/categories/:id", canEditMenu, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const want = !!(req.body || {}).discount_excluded;
  let updated = null;
  await refreshAndSave((st) => {
    const cat = (st.categories || []).find((c) => c.id === id);
    if (!cat) return;
    cat.discount_excluded = want;
    updated = cat;
  });
  if (!updated) return res.status(404).json({ error: "not_found" });
  res.json({ ...updated, discount_excluded: isDiscountExcludedCategory(updated) });
});

router.post("/admin/items", canEditMenu, async (req, res) => {
  const b = req.body || {};
  if (!b.category_id || !b.name_zh || b.price == null) {
    return res.status(400).json({ error: "missing_fields" });
  }
  const bad = validateItemFields(b, store.categories || [], { requireAll: true });
  if (bad) return res.status(400).json({ error: bad });
  const clash = codeConflict(store.menuItems, b.code, null);
  if (clash) {
    return res.status(409).json({ error: "code_taken", code: String(b.code).trim(), itemId: clash.id, name_zh: clash.name_zh, name_ko: clash.name_ko });
  }
  // 휴지통에 같은 메뉴가 있으면 새로 만들기 전에 한 번 물어본다(위
  // trashedTwin 참고). force_new 가 오면 사장님이 이미 고른 것이다.
  if (!b.force_new) {
    const twin = trashedTwin(store.menuItems, b);
    if (twin) {
      return res.status(409).json({
        error: "trash_match",
        itemId: twin.id,
        code: twin.code || null,
        name_zh: twin.name_zh,
        name_ko: twin.name_ko,
        deleted_at: twin[DELETED_AT],
      });
    }
  }
  const maxSort = store.menuItems.reduce((m, i) => Math.max(m, i.sort_order), 0);
  // 번호는 데이터베이스가 준다.
  //
  // 예전에는 nextId() — 메모리에서 ++ 하고 문서를 쓰는 방식이었다. 인스턴스가
  // 둘이면 **같은 번호를 두 번 줄 수 있다.** 주문 번호가 실제로 그래서 겹쳤고
  // (2026-09-10), 그때 reserveId 로 바꿨다. 메뉴만 옛 방식으로 남아 있었다.
  // 번호가 겹치면 결산이 두 메뉴를 한 줄로 합친다 — 조용히.
  //
  // floor 를 같이 준다: 이 카운터를 처음 쓰는 가게에서도 이미 있는 번호를
  // 다시 내주지 않는다.
  const maxId = store.menuItems.reduce((m, i) => Math.max(m, i.id || 0), 0);
  const item = {
    id: await reserveId("menuItems", maxId + 1),
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
    // null 이면 분류를 따른다(위 normalizeDiscountExcluded).
    discount_excluded: normalizeDiscountExcluded(b.discount_excluded),
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
  // category_id 는 여기 없다. 아래에서 숫자일 때만 덮어쓴다 — 화면에서 고른
  // 것이 풀려 빈 값이 오면 지금 분류를 지우는 게 아니라 그대로 둬야 한다.
  const fields = [
    "code", "name_zh", "name_ko", "name_en",
    "desc_zh", "desc_ko", "desc_en", "price", "price_note", "original_price", "options",
    "spice_options", "takeout_options", "addons", "min_first_order_qty", "sort_order",
  ];
  // Re-fetches the latest data right before writing (see refreshAndSave() in
  // src/db.js) instead of mutating the `item` this request loaded at the
  // top — narrows the window for another concurrent save (an incoming
  // order, another admin edit) to overwrite this change or get overwritten
  // by it.
  const bad = validateItemFields(b, store.categories || []);
  if (bad) return res.status(400).json({ error: bad });
  const clash = codeConflict(store.menuItems, b.code, id);
  if (clash) {
    return res.status(409).json({ error: "code_taken", code: String(b.code).trim(), itemId: clash.id, name_zh: clash.name_zh, name_ko: clash.name_ko });
  }

  let updated = null;
  let gone = false;
  await refreshAndSave((s) => {
    const item = s.menuItems.find((i) => i.id === id);
    if (!item) return;
    // 휴지통에 있는 것은 고칠 수 없다. 먼저 되살려야 한다 — 안 그러면 안
    // 보이는 메뉴를 고치고 저장됐다고 믿는다.
    if (isDeleted(item)) {
      gone = true;
      return;
    }
    for (const f of fields) if (b[f] !== undefined) item[f] = b[f];
    // 2026-09-14 사장님: "메뉴관리에서 메뉴수정하면 항목이 저절로 밥류로
    // 바뀌어 저장됨." 진짜 원인은 화면 쪽이었지만(populateCategorySelect),
    // 분류가 통째로 날아가는 것은 데이터가 망가지는 일이라 여기서도 막는다.
    // 숫자가 아닌 것이 오면 **안 바꾼다.**
    if (b.category_id !== undefined) {
      const catId = parseInt(b.category_id, 10);
      if (Number.isFinite(catId)) item.category_id = catId;
    }
    if (b.allergens !== undefined) item.allergens = Array.isArray(b.allergens) ? b.allergens : [];
    if (b.discount_excluded !== undefined) item.discount_excluded = normalizeDiscountExcluded(b.discount_excluded);
    if (b.mix_options !== undefined) item.mix_options = b.mix_options ? 1 : 0;
    if (b.is_spicy !== undefined) item.is_spicy = b.is_spicy ? 1 : 0;
    if (b.is_signature !== undefined) item.is_signature = b.is_signature ? 1 : 0;
    if (b.available !== undefined) item.available = b.available ? 1 : 0;
    // 수정 폼도 품절 기간을 같이 보낸다(소재 화면: openItemModal).
    if (b.soldoutMode !== undefined) applySoldOut(item, b.soldoutMode, b.soldoutFrom, b.soldoutUntil);
    updated = item;
  });
  if (gone) return res.status(409).json({ error: "item_in_trash" });
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

/**
 * 지우기 = 휴지통으로 보내기.
 *
 * 2026-09-15 사장님: "삭제는 휴지통을 하나 만들어서 복원 버튼을 만들어줬으면
 * 좋겠어."
 *
 * 예전에는 배열에서 빼고 store 문서를 **통째로** 다시 썼다(save()). 두 가지가
 * 나빴다.
 *
 *  1. 다시 읽지 않고 썼다. 이 인스턴스가 들고 있던 낡은 사본이 통째로 나가서,
 *     그 사이 다른 태블릿이 고친 인원수·품절이 되살아날 수 있었다 —
 *     2026-09-10 인원수 사고와 똑같은 모양이다. 이제 refreshAndSave 로
 *     저장 직전에 다시 읽는다(수정·이동 라우트는 이미 그렇게 하고 있었다).
 *  2. 번호가 사라졌다. 다시 등록하면 새 번호를 받아 결산이 갈라진다
 *     (src/menuItems.js 첫머리).
 */
router.delete("/admin/items/:id", canEditMenu, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  let found = false;
  await refreshAndSave((s) => {
    const item = s.menuItems.find((i) => i.id === id);
    if (!item) return;
    found = true;
    item[DELETED_AT] = nowLocal();
  });
  if (!found) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

/** 휴지통에 무엇이 있나. 버린 순서대로. */
router.get("/admin/trash", requireAdmin, (req, res) => {
  res.json(
    deletedItems(store.menuItems).map((m) => ({
      id: m.id,
      code: m.code,
      name_zh: m.name_zh,
      name_ko: m.name_ko,
      name_en: m.name_en,
      price: m.price,
      category_id: m.category_id,
      deleted_at: m[DELETED_AT],
    }))
  );
});

/**
 * 되살리기. 번호가 그대로라 결산도 그대로 이어진다.
 *
 * 분류가 그 사이 없어졌으면 되살려도 목록에 안 보인다(분류별로 그리므로).
 * 그래서 그 경우는 첫 분류로 옮겨 놓는다 — 안 보이는 채로 「복원됐다」고
 * 하면 사장님은 사라진 줄 안다.
 */
router.post("/admin/items/:id/restore", canEditMenu, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  // 되살리기 전에 코드를 본다.
  //
  // 버린 것은 코드가 안 겹친 것으로 치므로(codeConflict), 버린 사이에 같은
  // 코드로 새 메뉴가 들어와 있을 수 있다. 그대로 되살리면 **같은 「77」을
  // 쓰는 메뉴가 두 개 동시에 살아난다** — 주방 빌지에 똑같이 77 로 찍히는
  // 서로 다른 메뉴가 생긴다. 여기서 막고 어느 메뉴가 쓰는지 알려준다.
  const target = (store.menuItems || []).find((i) => i.id === id);
  if (target) {
    const clash = codeConflict(store.menuItems, target.code, id);
    if (clash) {
      return res.status(409).json({
        error: "code_taken",
        code: String(target.code).trim(),
        itemId: clash.id,
        name_zh: clash.name_zh,
        name_ko: clash.name_ko,
      });
    }
  }
  let restored = null;
  await refreshAndSave((s) => {
    const item = s.menuItems.find((i) => i.id === id);
    if (!item) return;
    delete item[DELETED_AT];
    const cats = s.categories || [];
    if (!cats.some((c) => c.id === item.category_id) && cats.length) {
      item.category_id = [...cats].sort((a, b) => a.sort_order - b.sort_order)[0].id;
    }
    restored = item;
  });
  if (!restored) return res.status(404).json({ error: "not_found" });
  res.json(withAvailability(restored, store.settings));
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
