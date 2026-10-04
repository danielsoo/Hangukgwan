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

// 지점. 엑셀 시트 이름이 그대로 두 지점이다.
const STORES = [
  { key: "main", name_zh: "韓國館總店", name_ko: "본점" },
  { key: "branch3", name_zh: "韓國館台元三店", name_ko: "台元三店" },
];
const storeByKey = (k) => STORES.find((s) => s.key === k) || null;

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
  if (!raw || !storeByKey(storeKey)) return null;
  const date = anyDate(raw.date);
  const name = normName(raw.name);
  if (!date || !name) return null;
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
function summarize(rows) {
  const byVendor = new Map();
  const byItem = new Map();
  const byMonth = new Map();
  let total = 0;
  for (const r of rows || []) {
    total += r.amount || 0;
    const v = byVendor.get(r.vendor) || { vendor: r.vendor, amount: 0, lines: 0 };
    v.amount += r.amount || 0;
    v.lines += 1;
    byVendor.set(r.vendor, v);

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

module.exports = {
  PURCHASES,
  STORES,
  storeByKey,
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
