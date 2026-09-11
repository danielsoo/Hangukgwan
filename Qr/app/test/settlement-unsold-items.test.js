// 안 팔린 메뉴가 무엇인지 보이는가.
//
// 사장님(2026-09-11): "판매항목과 수량 보는 것만큼 판매되지 않은 항목도
// 보였으면 좋겠어. 전혀 판매되지 않는 항목이 뭔지도 알 수 있도록."
//
// ── 왜 이게 어려운 질문인가 ─────────────────────────────────────────
//
// 품목별 판매 현황은 **팔린 것만** 담는다. 안 팔린 메뉴는 목록에서 그냥
// 사라지고, 없는 줄은 눈에 안 띈다. 그래서 빠진 쪽을 따로 세어야 하는데,
// 여기에 두 가지 함정이 있다.
//
//   1. **이름으로 맞추면 안 된다.** 메뉴 이름을 고친 날, 그 메뉴가 갑자기
//      「한 번도 안 팔린」 것이 된다. 팔린 기록에는 옛 이름이 박혀 있기
//      때문이다. id 로 맞춘다.
//   2. **모르는 것과 0 은 다르다.** 메뉴를 못 보는 자리(저장된 마감
//      스냅샷 등)에서 「안 팔린 메뉴 0개」라고 하면 없는 사실을 지어내는
//      것이다. 그럴 때는 null 이어야 하고, 화면은 그 칸을 안 그린다.
const { computeSettlement } = require("../src/settlement");
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const D = "2026-09-09";
const MENU = [
  { id: 1, name_ko: "김치찌개", name_zh: "泡菜鍋", price: 300, category_key: "hotpot", available: true },
  { id: 2, name_ko: "된장찌개", name_zh: "大醬湯", price: 300, category_key: "hotpot", available: true },
  { id: 3, name_ko: "삼겹살", name_zh: "五花肉", price: 500, category_key: "bbq", available: true },
  { id: 4, name_ko: "갈비", name_zh: "排骨", price: 600, category_key: "bbq", available: false }, // 품절
  { id: 5, name_ko: "콜라", name_zh: "可樂", price: 50, category_key: "drink", available: true },
];

let seq = 0;
const order = (itemId, itemName, opts = {}) => ({
  id: ++seq,
  table_number: String((seq % 5) + 1),
  status: opts.status || "paid",
  created_at: `${D} ${opts.at || "12:00:00"}`,
  updated_at: `${D} ${opts.at || "12:30:00"}`,
  paid_at: `${D} ${opts.at || "12:30:00"}`,
  total: 300,
  payment_method: "cash",
  party_size: 2, party_adults: 2, party_children: 0,
  order_type: "dine_in",
  ...(opts.half ? { service_period: opts.half } : {}),
  items: [{ item_id: itemId, name_ko: itemName, name_zh: itemName, qty: 1, unit_price: 300, category_key: null }],
});

const names = (list) => (list || []).map((m) => m.name_ko);

(async () => {
  out.push("[1] 안 팔린 것만 골라낸다");
  let r = computeSettlement([order(1, "김치찌개"), order(3, "삼겹살")], D, D, { menu: MENU });
  check("팔린 둘은 빠진다", !names(r.unsold_items).includes("김치찌개") && !names(r.unsold_items).includes("삼겹살"),
    JSON.stringify(names(r.unsold_items)));
  check("안 팔린 셋이 남는다", names(r.unsold_items).join(",") === "된장찌개,갈비,콜라", JSON.stringify(names(r.unsold_items)));
  check("메뉴 전체 개수도 같이 온다", r.menu_item_count === 5, String(r.menu_item_count));
  check("팔린 표에는 팔린 것만", r.item_breakdown.length === 2, JSON.stringify(r.item_breakdown.map((i) => i.name_ko)));

  out.push("\n[2] ★ 이름이 아니라 id 로 맞춘다");
  // 사장님이 「김치찌개」를 「김치찌개(2인)」으로 고쳐도, 어제 팔린 기록에는
  // 옛 이름이 박혀 있다. 이름으로 맞추면 그 메뉴가 갑자기 안 팔린 것이 된다.
  r = computeSettlement([order(1, "김치찌개")], D, D, {
    menu: MENU.map((m) => (m.id === 1 ? { ...m, name_ko: "김치찌개(2인)" } : m)),
  });
  check("★ 이름을 고쳐도 팔린 것으로 센다", !names(r.unsold_items).some((n) => n.startsWith("김치찌개")),
    JSON.stringify(names(r.unsold_items)));

  out.push("\n[3] ★ 모르는 것과 0 은 다르다");
  r = computeSettlement([order(1, "김치찌개")], D, D, {});
  check("★ 메뉴를 안 넘기면 null (0 이 아니다)", r.unsold_items === null, JSON.stringify(r.unsold_items));
  check("★ 개수도 null", r.menu_item_count === null, String(r.menu_item_count));
  r = computeSettlement([], D, D, { menu: MENU });
  check("하나도 안 팔린 날은 전부 나온다", (r.unsold_items || []).length === 5, String((r.unsold_items || []).length));
  r = computeSettlement(MENU.map((m) => order(m.id, m.name_ko)), D, D, { menu: MENU });
  check("전부 팔린 날은 빈 목록 (null 아님)", Array.isArray(r.unsold_items) && r.unsold_items.length === 0,
    JSON.stringify(r.unsold_items));

  out.push("\n[4] 팔린 것의 뜻은 결산과 같다");
  // 취소된 주문은 매출에 안 들어간다. 그런데 「팔렸다」로 세면, 취소만 한
  // 번 있었던 메뉴가 잘 나가는 메뉴처럼 목록에서 사라진다.
  r = computeSettlement([order(1, "김치찌개", { status: "cancelled" })], D, D, { menu: MENU });
  check("★ 취소된 주문은 팔린 것이 아니다", names(r.unsold_items).includes("김치찌개"), JSON.stringify(names(r.unsold_items)));
  r = computeSettlement([order(1, "김치찌개", { status: "new" })], D, D, { menu: MENU });
  check("★ 아직 결제 안 된 주문도 팔린 것이 아니다", names(r.unsold_items).includes("김치찌개"),
    JSON.stringify(names(r.unsold_items)));

  out.push("\n[5] 오전만 보기면 오전 기준이다");
  // 위 큰 숫자가 오전 것인데 이 목록만 하루치면, 둘을 나란히 두고 읽다가
  // 오전에 안 팔린 메뉴를 놓친다.
  const both = [order(1, "김치찌개", { half: "am", at: "11:30:00" }), order(3, "삼겹살", { half: "pm", at: "18:30:00" })];
  r = computeSettlement(both, D, D, { menu: MENU, shift: "am" });
  check("★ 오후에만 팔린 것은 오전 화면에서 안 팔린 것", names(r.unsold_items).includes("삼겹살"),
    JSON.stringify(names(r.unsold_items)));
  check("오전에 팔린 것은 빠진다", !names(r.unsold_items).includes("김치찌개"), JSON.stringify(names(r.unsold_items)));

  out.push("\n[6] 품절은 「안 팔린」 것이 아니라 「못 판」 것이다");
  r = computeSettlement([], D, D, { menu: MENU });
  const galbi = (r.unsold_items || []).find((m) => m.name_ko === "갈비");
  check("★ 품절 여부가 같이 온다", galbi && galbi.available === false, JSON.stringify(galbi));
  const kimchi = (r.unsold_items || []).find((m) => m.name_ko === "김치찌개");
  check("팔 수 있었던 것은 available true", kimchi && kimchi.available === true, JSON.stringify(kimchi));
  check("분류도 같이 온다 (분류별로 묶어 보여준다)", galbi && galbi.category_key === "bbq", JSON.stringify(galbi));

  out.push("\n[7] 메뉴는 결산 화면에만 넘긴다");
  const routeSrc = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "settlements.js"), "utf8");
  check("결산 조회가 메뉴를 넘긴다", /computeSettlement\(orders, start, end, \{ \.\.\.opts, shift, menu: menuForSettlement\(\) \}\)/.test(routeSrc));
  // 마감 스냅샷은 그날의 장부다. 매일 메뉴 40~50줄을 같이 적어 넣으면 하루치가
  // 통째로 커지고, 게다가 「그날의 메뉴」가 아니라 「저장을 누른 시점의
  // 메뉴」가 박힌다.
  const snapshotCalls = routeSrc.match(/computeSettlement\([^)]*\)/g) || [];
  const withMenu = snapshotCalls.filter((c) => c.includes("menu:"));
  check("★ 스냅샷에는 안 넘긴다 (메뉴를 넘기는 곳은 한 군데뿐)", withMenu.length === 1,
    `${withMenu.length}곳: ${JSON.stringify(withMenu)}`);
  // 화면에 쓰는 값만 넘긴다 — 안 거르면 사진 URL 과 옵션 정의까지 따라간다.
  check("넘기는 값을 골라낸다", /category_key: \(catById\.get\(m\.category_id\) \|\| \{\}\)\.key/.test(routeSrc));
  check("사진·옵션은 안 넘긴다", !/photo_url/.test(routeSrc.slice(routeSrc.indexOf("function menuForSettlement"), routeSrc.indexOf("async function halfOpts"))));

  out.push("\n[8] 화면이 그 값을 그린다");
  const adminJs = fs.readFileSync(path.join(__dirname, "..", "public", "js", "admin.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "admin.html"), "utf8");
  check("칸이 있다", /id="settlementUnsold"/.test(html) && /id="settlementUnsoldList"/.test(html));
  check("팔린 표 바로 아래에 그린다", /renderSettlementItems\(data\.item_breakdown[\s\S]{0,200}?renderUnsoldItems\(data\)/.test(adminJs));
  check("★ null 이면 칸을 아예 안 그린다", /if \(!Array\.isArray\(list\)\) \{\s*\n\s*box\.hidden = true;/.test(adminJs));
  check("기본은 접혀 있다 (화면이 다시 길어지지 않게)", /let unsoldExpanded = false;/.test(adminJs));
  check("접혀 있어도 개수는 보인다", /settlementUnsoldTitle/.test(adminJs) && /\{n\}/.test(adminJs));
  check("품절은 따로 표시한다", /settlementUnsoldSoldout/.test(adminJs) && /is-soldout/.test(adminJs));
  for (const key of ["settlementUnsoldTitle", "settlementUnsoldShow", "settlementUnsoldHide", "settlementUnsoldNone", "settlementUnsoldSoldout", "settlementUnsoldOf"]) {
    check(`두 언어 모두 있다 — ${key}`, (adminJs.match(new RegExp(`${key}:`, "g")) || []).length === 2);
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
