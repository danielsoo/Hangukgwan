// 안 팔린 메뉴가 무엇인지 보이는가 — 전체 메뉴를 한 줄로 이어서.
//
// 사장님(2026-09-11): "판매항목과 수량 보는 것만큼 판매되지 않은 항목도
// 보였으면 좋겠어. 전혀 판매되지 않는 항목이 뭔지도 알 수 있도록."
// 그리고 곧이어: "전체 메뉴를 막대그래프로 좌에서 우로 뻗는 그 그래프로
// 해서 팔린 횟수를 적어서 **스크롤 내리면 안 팔리는 애들이 보일 수 있게**
// 하는 게 좋을 것 같아."
//
// 그래서 안 팔린 것만 따로 세지 않는다. 메뉴 전체를 많이 팔린 순으로 주고,
// 안 팔린 것은 자연히 맨 아래에 모이게 한다. 두 목록을 오가며 머릿속으로
// 맞춰볼 필요가 없어진다.
//
// ── 함정 둘 ─────────────────────────────────────────────────────────
//   1. **이름으로 맞추면 안 된다.** 메뉴 이름을 고친 날, 그 메뉴가 갑자기
//      「한 번도 안 팔린」 것이 된다. 팔린 기록에는 옛 이름이 박혀 있다.
//   2. **모르는 것과 0 은 다르다.** 메뉴를 못 보는 자리(저장된 마감
//      스냅샷 등)에서 「전부 0개」라고 하면 없는 사실을 지어내는 것이다.
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
  items: [{ item_id: itemId, name_ko: itemName, name_zh: itemName, qty: opts.qty || 1, unit_price: 300, category_key: null }],
});

const row = (r, name) => (r.menu_breakdown || []).find((m) => m.name_ko === name);
const names = (r) => (r.menu_breakdown || []).map((m) => m.name_ko);
const zeros = (r) => (r.menu_breakdown || []).filter((m) => m.qty === 0).map((m) => m.name_ko);

(async () => {
  out.push("[1] 메뉴가 통째로, 많이 팔린 순으로 온다");
  let r = computeSettlement(
    [order(1, "김치찌개", { qty: 5 }), order(3, "삼겹살", { qty: 2 })],
    D, D, { menu: MENU }
  );
  check("메뉴 다섯 개가 전부 있다", (r.menu_breakdown || []).length === 5, JSON.stringify(names(r)));
  check("★ 많이 팔린 순", names(r).slice(0, 2).join(",") === "김치찌개,삼겹살", JSON.stringify(names(r)));
  check("★ 안 팔린 것은 뒤로 모인다", zeros(r).join(",") === "된장찌개,갈비,콜라", JSON.stringify(names(r)));
  check("수량이 실려 온다", row(r, "김치찌개").qty === 5 && row(r, "삼겹살").qty === 2,
    JSON.stringify([row(r, "김치찌개").qty, row(r, "삼겹살").qty]));
  check("안 팔린 것은 0", row(r, "콜라").qty === 0, String(row(r, "콜라").qty));
  check("메뉴 전체 개수도 같이 온다", r.menu_item_count === 5, String(r.menu_item_count));

  out.push("\n[1-1] 같은 수량끼리는 메뉴판 순서를 지킨다");
  // 안 그러면 0 이 잔뜩 모인 아래쪽이 볼 때마다 뒤죽박죽으로 바뀐다.
  check("★ 0 끼리는 메뉴판 순서", zeros(r).join(",") === "된장찌개,갈비,콜라", JSON.stringify(zeros(r)));

  out.push("\n[2] ★ 이름이 아니라 id 로 맞춘다");
  r = computeSettlement([order(1, "김치찌개")], D, D, {
    menu: MENU.map((m) => (m.id === 1 ? { ...m, name_ko: "김치찌개(2인)" } : m)),
  });
  check("★ 이름을 고쳐도 팔린 것으로 센다", row(r, "김치찌개(2인)").qty === 1, JSON.stringify(names(r)));

  out.push("\n[3] ★ 모르는 것과 0 은 다르다");
  r = computeSettlement([order(1, "김치찌개")], D, D, {});
  check("★ 메뉴를 안 넘기면 null (전부 0 이 아니다)", r.menu_breakdown === null, JSON.stringify(r.menu_breakdown));
  check("★ 개수도 null", r.menu_item_count === null, String(r.menu_item_count));
  r = computeSettlement([], D, D, { menu: MENU });
  check("하나도 안 팔린 날은 전부 0", zeros(r).length === 5, JSON.stringify(zeros(r)));
  r = computeSettlement(MENU.map((m) => order(m.id, m.name_ko)), D, D, { menu: MENU });
  check("전부 팔린 날은 0 이 없다", zeros(r).length === 0, JSON.stringify(zeros(r)));

  out.push("\n[4] 팔린 것의 뜻은 결산과 같다");
  r = computeSettlement([order(1, "김치찌개", { status: "cancelled" })], D, D, { menu: MENU });
  check("★ 취소된 주문은 팔린 것이 아니다", row(r, "김치찌개").qty === 0, String(row(r, "김치찌개").qty));
  r = computeSettlement([order(1, "김치찌개", { status: "new" })], D, D, { menu: MENU });
  check("★ 아직 결제 안 된 주문도 팔린 것이 아니다", row(r, "김치찌개").qty === 0, String(row(r, "김치찌개").qty));

  out.push("\n[5] 오전만 보기면 오전 기준이다");
  const both = [order(1, "김치찌개", { half: "am", at: "11:30:00" }), order(3, "삼겹살", { half: "pm", at: "18:30:00" })];
  r = computeSettlement(both, D, D, { menu: MENU, shift: "am" });
  check("★ 오후에만 팔린 것은 오전 화면에서 0", row(r, "삼겹살").qty === 0, String(row(r, "삼겹살").qty));
  check("오전에 팔린 것은 센다", row(r, "김치찌개").qty === 1, String(row(r, "김치찌개").qty));

  out.push("\n[6] 품절은 「안 팔린」 것이 아니라 「못 판」 것이다");
  r = computeSettlement([], D, D, { menu: MENU });
  check("★ 품절 여부가 같이 온다", row(r, "갈비").available === false, JSON.stringify(row(r, "갈비")));
  check("팔 수 있었던 것은 available true", row(r, "김치찌개").available === true, JSON.stringify(row(r, "김치찌개")));

  out.push("\n[7] 메뉴는 결산 화면에만 넘긴다");
  const routeSrc = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "settlements.js"), "utf8");
  check("결산 조회가 메뉴를 넘긴다", /menu: menuForSettlement\(\)/.test(routeSrc));
  // 마감 스냅샷은 그날의 장부다. 매일 메뉴 50줄을 같이 적어 넣으면 하루치가
  // 통째로 커지고, 「그날의 메뉴」가 아니라 「저장을 누른 시점의 메뉴」가 박힌다.
  const withMenu = (routeSrc.match(/computeSettlement\([^)]*\)/g) || []).filter((c) => c.includes("menu:"));
  check("★ 스냅샷에는 안 넘긴다 (메뉴를 넘기는 곳은 한 군데뿐)", withMenu.length === 1,
    `${withMenu.length}곳: ${JSON.stringify(withMenu)}`);
  check("화면에 쓰는 값만 골라 넘긴다", /category_key: \(catById\.get\(m\.category_id\) \|\| \{\}\)\.key/.test(routeSrc));

  out.push("\n[8] 화면이 그 값을 그린다");
  const adminJs = fs.readFileSync(path.join(__dirname, "..", "public", "js", "admin.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "admin.html"), "utf8");
  check("전체 메뉴 탭과 칸이 있다", /data-pane="allMenu"/.test(html) && /id="settlementAllMenu"/.test(html));
  check("결산을 그릴 때 같이 그린다", /renderAllMenuBars\(data\)/.test(adminJs));
  check("★ null 이면 아무것도 안 그린다", /if \(!Array\.isArray\(rows\)\) \{[\s\S]{0,140}?wrap\.innerHTML = "";/.test(adminJs));
  check("★ 막대 옆에 붙는 숫자는 수량이다", /stl-menu-qty">\$\{m\.qty\}/.test(adminJs));
  // 여기 퍼센트를 붙이면 막대(1등 대비)와 숫자(전체 대비)가 다른 자를 쓰게
  // 된다 — 2026-09-11 에 결산의 다른 막대에서 바로 그것을 고쳤다.
  check("★ 퍼센트는 안 붙인다 (막대는 1등 대비다)", !/stl-menu-pct/.test(adminJs) && !/stl-menu-qty">[^<]*%/.test(adminJs));
  check("한 개도 안 나간 줄은 표가 난다", /is-zero/.test(adminJs) && /stl-menu-row\.is-zero/.test(fs.readFileSync(path.join(__dirname, "..", "public", "css", "admin.css"), "utf8")));
  check("품절은 따로 표시한다", /stl-menu-soldout/.test(adminJs));
  check("높이를 못 박고 그 안에서 굴린다", /\.stl-allmenu \{[^}]*max-height/.test(fs.readFileSync(path.join(__dirname, "..", "public", "css", "admin.css"), "utf8")));
  for (const key of ["settlementAllMenuTitle", "settlementAllMenuHead", "settlementAllMenuAllSold"]) {
    check(`두 언어 모두 있다 — ${key}`, (adminJs.match(new RegExp(`${key}:`, "g")) || []).length === 2);
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
