// 식자재 매입 — 「무엇을 · 얼마에 · 몇 개 샀나」.
//
// 2026-10-04 사장님: "그냥 뭘 얼마에 몇개 샀다는 걸 바라는거야."
// 메뉴 원가(어느 재료가 어느 메뉴에 들어가나)는 **아직 안 한다.**
//
// ── 처음부터 2만 줄이 있다
//
// 사장님이 2025-01 부터 엑셀로 적어 오셨다(「한국관 식자재 자료 - 2025부터」,
// 總店 11,528줄 + 台元三店 9,349줄, NT$1,476만). 그래서 이 기능은 「이제부터
// 쌓는」 것이 아니라 **이미 있는 것을 가져오는** 것으로 시작한다. 가져오고
// 나면 첫날부터 21개월 치 단가 추이가 보인다.
//
// 엑셀 칸이 곧 이 모양이다:
//   날짜 | 내용(중국어) | 수량 | 단위 | 단가 | 금액 | 업체명 | 비고(한국어) | 월
//
// 비고가 2만 줄 전부 채워져 있어서(100%) 중국어→한국어 이름표가 이미 완성돼
// 있다. 따로 만들지 않는다.
const PURCHASES = "ingredient_purchases";

// 지점.
//
// 엑셀이 두 벌이고 시트 이름이 서로 다르다:
//   「… 2025부터」  韓國館總店 / 韓國館台元三店
//   「… -2025」     한국관본점 / 한국관2호점
// 2025년 줄이 두 파일에서 100% 일치하는 것으로 **2호점 = 台元三店** 임을
// 확인했다(2026-10-05).
//
// opened: 그 지점의 기록이 **실제로 따로 적히기 시작한** 날.
//
// 2호점 시트는 2019-11 까지 본점 시트를 통째로 복사해 둔 것이다 — 줄 수도
// 금액도 글자 하나까지 같다(2007~2019-11, 69,793줄 · NT$33,864,883).
// 2019-12 부터 따로 적히기 시작한다(그 달 겹침 5%).
//
// 사장님(2026-10-05): "2호점은 2019년 11월부터인가 시작했으니까." 가게는
// 11월에 여셨을 수 있지만 **11월 줄은 아직 복사본**이라, 장부 기준은
// 12월이다. 그 앞을 넣으면 없던 지출 3천만 원이 생긴다.
const STORES = [
  { key: "main", name_zh: "韓國館總店", name_ko: "본점", opened: null },
  { key: "branch3", name_zh: "韓國館台元三店", name_ko: "2호점(台元三店)", opened: "2019-12-01" },
];
const storeByKey = (k) => STORES.find((s) => s.key === k) || null;

/**
 * 엑셀 시트 이름 → 지점. 두 파일의 이름이 다르므로 둘 다 받는다.
 * 모르는 시트는 null — 짐작해서 넣지 않는다(엉뚱한 지점에 쌓인다).
 */
function storeOfSheetName(name) {
  const s = normName(name);
  if (!s) return null;
  if (s.includes("總店") || s.includes("본점")) return "main";
  if (s.includes("台元") || s.includes("2호점") || s.includes("２호점")) return "branch3";
  return null;
}

// 같은 회사인데 종이에 찍힌 상호가 다른 것.
//
// 2026-10-04 사장님: "龍江興南北商行 / 龍國興業社 이 2 회사는 같은 회사이고,
// 엑셀 기록파일에는 龍江興南北商行 회사명으로만 식재료를 기록했어요."
//
// 기록은 한 이름으로 모은다 — 둘로 갈라지면 그 업체의 지출도 단가 추이도
// 반씩 나뉜다. 나중에 사진에서 상호를 읽을 때 저 이름이 나와도 여기서 받는다.
// (사장님: 학습할 때는 별개로 봐도 무방 — 글자 모양은 다르니까.)
const VENDOR_ALIASES = { 龍國興業社: "龍江興南北商行" };

/**
 * 이름을 **한 모양으로 못 박는다.**
 *
 * 2026-10-04: 가져오기를 맞춰보다 龍江興南北商行 의 지출이 NT$0 으로 나왔다.
 * 엑셀의 「龍」이 U+F9C4(호환 한자)이고 내가 적은 「龍」은 U+9F8D 이라 글자가
 * 같아 보이는데 다른 글자였다. 한국어 입력기로 한자를 치면 이 모양이 나온다.
 *
 * 업체 20곳 중 1곳, **품목 477가지 중 47가지**가 그랬다. 그대로 두면 같은
 * 품목이 둘로 갈라져 지출도 단가 추이도 반씩 나뉘고, 눈으로는 절대 못 찾는다
 * (글자가 똑같이 보인다).
 *
 * NFC 로 맞춘다 — 호환 한자를 제 글자로 되돌리면서, NFKC 와 달리 전각·반각
 * 같은 것까지 건드리지는 않는다. 품목 이름에 「21*20」 같은 규격이 들어 있어서
 * 그쪽을 함부로 바꾸면 안 된다.
 */
function normName(v) {
  return String(v == null ? "" : v)
    .normalize("NFC")
    .trim();
}

function canonicalVendor(v) {
  const name = normName(v);
  return VENDOR_ALIASES[name] || name;
}

/**
 * 엑셀 일련번호 → "YYYY-MM-DD".
 *
 * 엑셀은 1900-01-01 을 1 로 세는데 1900 년을 윤년으로 잘못 아는 버그가 있어서
 * 기준을 1899-12-30 으로 잡는다(모든 엑셀이 같은 버그를 공유하므로 이게 맞다).
 * 범위를 벗어난 값은 날짜가 아니다 — 머리글·합계 줄이 섞여 들어온다.
 */
function excelDate(n) {
  const d = Number(n);
  if (!Number.isFinite(d) || d < 20000 || d > 80000) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.round(d) * 86400000;
  const iso = new Date(ms).toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

/** "2026-09-17" 또는 엑셀 일련번호 둘 다 받는다. */
function anyDate(v) {
  const s = String(v == null ? "" : v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return excelDate(s);
}

const num = (v) => {
  // "1,200" 처럼 쉼표가 들어오기도 한다.
  const n = Number(String(v == null ? "" : v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

/**
 * 한 줄을 저장할 모양으로 바꾼다. 쓸 수 없는 줄이면 null.
 *
 * 날짜와 품목 이름이 **둘 다** 있어야 한 줄이다. 엑셀에는 머리글, 빈 줄,
 * 합계 줄, 메모 줄이 섞여 있는데 그것들은 둘 중 하나가 없다.
 */
function normalizeRow(raw, storeKey) {
  const store = storeByKey(storeKey);
  if (!raw || !store) return null;
  const date = anyDate(raw.date);
  const name = normName(raw.name);
  if (!date || !name) return null;
  // 그 지점이 따로 적히기 전의 줄은 **버린다.** 2호점 시트의 2019-11 이전은
  // 본점 시트의 복사본이라, 넣으면 없던 지출 NT$33,864,883 이 생긴다
  // (위 STORES 주석). 눈으로는 멀쩡한 줄이라 나중에 절대 못 찾는다.
  if (store.opened && date < store.opened) return null;
  const qty = num(raw.qty);
  const price = num(raw.price);
  const amountRaw = num(raw.amount);
  // 금액이 비어 있으면 수량 × 단가로 채운다. 엑셀 2만 줄 중 계산이 안 맞는
  // 줄은 각 시트에 하나씩뿐이라(2026-10-04 확인) **적힌 금액을 그대로 믿는다**
  // — 고쳐 쓰면 사장님 장부와 합계가 달라진다.
  const amount = amountRaw || Math.round(qty * price * 100) / 100;
  return {
    store: storeKey,
    date,
    month: date.slice(0, 7),
    vendor: canonicalVendor(raw.vendor),
    name,
    name_ko: normName(raw.note),
    qty,
    unit: normName(raw.unit),
    price,
    amount,
  };
}

/**
 * 되풀이해 가져와도 같은 줄이 두 번 쌓이지 않게 하는 열쇠.
 *
 * (지점, 날짜, 업체) 안에서 몇 번째 줄인가로 짓는다. 같은 날 같은 업체에서
 * 같은 품목을 두 번 적는 일이 실제로 있어서(단가가 다르거나 나눠 받거나)
 * 이름으로는 가를 수 없다.
 *
 * 가져오기는 **그 날짜를 통째로 지우고 다시 넣는다**(replaceDates). 그래서
 * 엑셀에서 줄을 지우거나 고친 뒤 다시 가져와도 옛 줄이 남지 않는다.
 */
function purchaseId(row, seq) {
  return `${row.store}|${row.date}|${row.vendor}|${seq}`;
}

/** 줄 목록에 번호를 매긴다. (지점·날짜·업체)마다 0부터. */
function withIds(rows) {
  const seen = new Map();
  return rows.map((r) => {
    const k = `${r.store}|${r.date}|${r.vendor}`;
    const seq = seen.get(k) || 0;
    seen.set(k, seq + 1);
    return { _id: purchaseId(r, seq), ...r };
  });
}

/** 이 줄들이 덮는 (지점, 날짜) 짝. 가져오기 전에 그 날짜를 비우는 데 쓴다. */
function datesCovered(rows) {
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.store)) out.set(r.store, new Set());
    out.get(r.store).add(r.date);
  }
  return [...out.entries()].map(([store, dates]) => ({ store, dates: [...dates].sort() }));
}

/**
 * 집계 — 업체별·품목별·달별.
 *
 * 돈은 소수점이 생기지 않게 더한 뒤 반올림한다. 斤 단위 단가에 0.5 수량이
 * 곱해지는 줄이 있어서 중간 값에는 소수가 나온다.
 */
/**
 * 집계를 **데이터베이스가 하게** 한다.
 *
 * 2026-10-06 사장님: "이것도 전체 데이터를 읽으려고 하지마 각 날짜와 업체마다
 * 고유 아이디를 주면 그것만 찾으면 되잖아 전처럼 서버 터져"
 *
 * 그 전에는 `find(where).toArray()` 로 **줄을 다 받아** 화면 쪽에서 더했다.
 * 사장님 장부는 16만 줄(2007년부터)이라, 「전체 기간」을 한 번 누르면 그걸
 * 통째로 메모리에 올린다 — Vercel 한 인스턴스가 감당할 양이 아니다.
 * (2026-09-10 에 store 문서를 통째로 쓰다 점심에 터진 것과 같은 종류다.)
 *
 * 이제 묶는 일은 DB 가 하고, 돌아오는 것은 **업체 20줄 · 품목 200줄 · 달 수십
 * 줄**뿐이다. 묶음마다 파이프라인을 따로 두는 이유는 $facet 보다 읽기 쉽고,
 * 시험용 가짜 몽고에서도 같은 길을 지나가기 때문이다.
 */
function summaryPipelines(where, opts) {
  const o = Object.assign({ items: 200 }, opts || {});
  const m = [{ $match: where }];
  return {
    totals: m.concat([{ $group: { _id: null, total: { $sum: "$amount" }, lines: { $sum: 1 }, first: { $min: "$date" }, last: { $max: "$date" } } }]),
    days: m.concat([{ $group: { _id: "$date" } }, { $count: "n" }]),
    stores: m.concat([{ $group: { _id: "$store", amount: { $sum: "$amount" }, lines: { $sum: 1 } } }, { $sort: { amount: -1 } }]),
    vendors: m.concat([{ $group: { _id: "$vendor", amount: { $sum: "$amount" }, lines: { $sum: 1 }, last_date: { $max: "$date" } } }, { $sort: { amount: -1 } }]),
    items: m.concat([
      { $group: { _id: "$name", amount: { $sum: "$amount" }, qty: { $sum: "$qty" }, lines: { $sum: 1 }, name_ko: { $max: "$name_ko" }, unit: { $max: "$unit" } } },
      { $sort: { amount: -1 } },
      { $limit: o.items },
    ]),
    months: m.concat([{ $group: { _id: "$month", amount: { $sum: "$amount" } } }, { $sort: { _id: 1 } }]),
  };
}

/** 파이프라인이 돌려준 것을 화면이 아는 모양으로. summarize() 와 같은 모양이어야 한다. */
function shapeSummary(parts) {
  const round = (x) => Math.round((x || 0) * 100) / 100;
  const t = (parts.totals || [])[0] || {};
  return {
    total: round(t.total),
    lines: t.lines || 0,
    days: ((parts.days || [])[0] || {}).n || 0,
    first: t.first || "",
    last: t.last || "",
    stores: (parts.stores || []).map((s) => ({ store: s._id, amount: round(s.amount), lines: s.lines })),
    vendors: (parts.vendors || []).map((v) => ({ vendor: v._id, amount: round(v.amount), lines: v.lines, last_date: v.last_date || "" })),
    items: (parts.items || []).map((i) => ({ name: i._id, name_ko: i.name_ko || "", unit: i.unit || "", amount: round(i.amount), qty: round(i.qty), lines: i.lines })),
    months: (parts.months || []).map((m) => ({ month: m._id, amount: round(m.amount) })),
  };
}

function summarize(rows) {
  const byVendor = new Map();
  const byItem = new Map();
  const byMonth = new Map();
  const byStore = new Map();
  const days = new Set();
  let total = 0;
  let first = "", last = "";
  for (const r of rows || []) {
    total += r.amount || 0;
    // 「한눈에 보기」가 쓰는 것들 — 하루 평균을 내려면 **산 날 수**가 있어야
    // 하고(줄 수가 아니다), 업체 줄에는 마지막으로 산 날이 있어야 한다.
    if (r.date) {
      days.add(r.date);
      if (!first || r.date < first) first = r.date;
      if (!last || r.date > last) last = r.date;
    }
    const v = byVendor.get(r.vendor) || { vendor: r.vendor, amount: 0, lines: 0, last_date: "" };
    v.amount += r.amount || 0;
    v.lines += 1;
    if (r.date > v.last_date) v.last_date = r.date;
    byVendor.set(r.vendor, v);

    const st = byStore.get(r.store) || { store: r.store, amount: 0, lines: 0 };
    st.amount += r.amount || 0;
    st.lines += 1;
    byStore.set(r.store, st);

    const it = byItem.get(r.name) || { name: r.name, name_ko: r.name_ko, unit: r.unit, amount: 0, qty: 0, lines: 0 };
    it.amount += r.amount || 0;
    it.qty += r.qty || 0;
    it.lines += 1;
    // 한국어 이름이 빈 줄도 있을 수 있다 — 채워진 것을 쓴다.
    if (!it.name_ko && r.name_ko) it.name_ko = r.name_ko;
    byItem.set(r.name, it);

    const m = byMonth.get(r.month) || { month: r.month, amount: 0 };
    m.amount += r.amount || 0;
    byMonth.set(r.month, m);
  }
  const round = (x) => Math.round(x * 100) / 100;
  return {
    total: round(total),
    lines: (rows || []).length,
    days: days.size,
    first,
    last,
    stores: [...byStore.values()].map((s) => ({ ...s, amount: round(s.amount) })).sort((a, b) => b.amount - a.amount),
    vendors: [...byVendor.values()].map((v) => ({ ...v, amount: round(v.amount) })).sort((a, b) => b.amount - a.amount),
    items: [...byItem.values()].map((i) => ({ ...i, amount: round(i.amount), qty: round(i.qty) })).sort((a, b) => b.amount - a.amount),
    months: [...byMonth.values()].map((m) => ({ ...m, amount: round(m.amount) })).sort((a, b) => a.month.localeCompare(b.month)),
  };
}

/**
 * 한 품목의 단가가 언제 얼마였나.
 *
 * 같은 날 같은 단가로 여러 줄이 있으면 한 점으로 묶는다 — 그래프가 같은
 * 자리에 점을 겹쳐 찍으면 「많이 샀다」로 잘못 읽힌다.
 */
function priceHistory(rows) {
  const seen = new Map();
  for (const r of rows || []) {
    const k = `${r.date}|${r.price}|${r.vendor}`;
    if (seen.has(k)) {
      seen.get(k).qty += r.qty || 0;
      continue;
    }
    seen.set(k, { date: r.date, price: r.price, vendor: r.vendor, unit: r.unit, qty: r.qty || 0 });
  }
  return [...seen.values()].sort((a, b) => a.date.localeCompare(b.date) || a.price - b.price);
}

/**
 * 그 업체에서 **보통 사는 것** — 입력 화면이 고르게 할 목록.
 *
 * 2026-10-04 사장님: "지금은 계속 종이를 보면서 엑셀에 기입하고 하는 과정이
 * 너무 귀찮아서."
 *
 * 그래서 이 목록이 이 기능의 핵심이다. 2만 줄을 재보니:
 *   · 영수증 한 장이 보통 2줄
 *   · 그 업체가 그 달에 사는 품목이 보통 4가지
 * 그러니 「2줄짜리 종이를 4개 중에서 고르기」가 된다 — 치는 것보다 훨씬 빠르다.
 *
 * ── 지난 단가는 **채워 넣는 값이 아니라 견주는 값**이다
 *
 * 사장님: "근데 그러다가 메뉴가 추가되거나 가격이 달라지거나 그러면 안되잖아."
 *
 * 맞다. 단가가 지난번과 같은 비율이 84.3% 였다 — **여섯 번에 한 번은 바뀐다.**
 * 지난 값을 그냥 넣으면 여섯 장에 한 장은 틀린 금액이 들어간다. 돈 기록에서
 * 그건 안 된다.
 *
 * 그래서 last_price 는 **먼저 채우되 반드시 사장님이 보고 넘어가게** 하고,
 * 종이에 적힌 값이 다르면 그 값이 맞다. 화면은 「지난번 25였어요」를 옆에
 * 보여주기만 한다. 목록에 없는 새 품목도 그냥 적을 수 있어야 한다 — 이
 * 목록은 **가두는 울타리가 아니라 지름길**이다.
 */
function buildCatalog(rows, opts) {
  const recentFrom = (opts && opts.recentFrom) || "";
  const byName = new Map();
  for (const r of rows || []) {
    const it = byName.get(r.name) || {
      name: r.name,
      name_ko: r.name_ko,
      unit: r.unit,
      last_price: r.price,
      last_date: r.date,
      count: 0,
      recent: 0,
    };
    it.count += 1;
    if (recentFrom && r.date >= recentFrom) it.recent += 1;
    // 제일 최근 줄의 단위·단가를 쓴다. 단위가 바뀐 품목이 있다(斤 → Kg).
    if (r.date >= it.last_date) {
      it.last_date = r.date;
      it.last_price = r.price;
      if (r.unit) it.unit = r.unit;
    }
    if (!it.name_ko && r.name_ko) it.name_ko = r.name_ko;
    byName.set(r.name, it);
  }
  // 최근에 산 것이 위로. 같으면 자주 산 것이 위로 — 손이 먼저 가는 순서다.
  return [...byName.values()].sort((a, b) => b.recent - a.recent || b.count - a.count || b.last_date.localeCompare(a.last_date));
}

/**
 * 한 줄이 그럴듯한가. **막지는 않고 말만 한다.**
 *
 * 새 품목도 오르는 가격도 정상이다. 다만 조용히 지나가면 안 되는 것 둘:
 *   · 산수가 안 맞는다 → 셋 중 하나를 잘못 봤다(종이 안에서 닫히는 검사다)
 *   · 단가가 지난번과 다르다 → 올랐을 수도, 잘못 봤을 수도. 사장님이 정한다
 */
function lineWarnings(line, known) {
  const warn = [];
  const qty = Number(line.qty) || 0;
  const price = Number(line.price) || 0;
  const amount = Number(line.amount) || 0;
  if (qty && price && amount && Math.abs(qty * price - amount) >= 0.5) {
    warn.push({ kind: "math", expected: Math.round(qty * price * 100) / 100 });
  }
  if (known && known.last_price != null && price && price !== known.last_price) {
    warn.push({ kind: "price_changed", last: known.last_price, last_date: known.last_date });
  }
  if (known === null) warn.push({ kind: "new_item" });
  return warn;
}

module.exports = {
  PURCHASES,
  summaryPipelines,
  shapeSummary,
  buildCatalog,
  lineWarnings,
  STORES,
  storeByKey,
  storeOfSheetName,
  VENDOR_ALIASES,
  normName,
  canonicalVendor,
  excelDate,
  anyDate,
  normalizeRow,
  purchaseId,
  withIds,
  datesCovered,
  summarize,
  priceHistory,
};
