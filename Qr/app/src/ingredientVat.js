// 영수증 부가세(營業稅 5%) — 업체마다 붙이는 방법이 다르다 (2026-10-21).
//
// 사장님: "영수증의 부가세 첨부 방법이 업체들마다 다른데, 대만의 부가세는 5%래.
//   1. 합계금액의 5%를 넣는 업체  2. 각 항목마다 5%를 넣는 업체
//   3. 월말에 한꺼번에 5% 청구하는 업체  4. 부가세가 아예 없는 업체
// … 저장이 된 상태 후에, 부가세 부분을 아래와 같은 항목을 만들고, 체크해서 정확한 금액이 산정될 수 있도록
//   -부가세 이미 포함 (위 1,2항)  -부가세 포함(해야함) (위 3항) / 미포함(필요없음) (위 4항)"
//
// 영수증 한 장 = (지점, 날짜, 업체)다. 그 한 장마다 셋 중 하나를 고른다:
//
//   included  이미 포함 — 종이 금액에 5% 가 들어 있다(1·2항). 장부 금액 그대로.
//   add       더해야 함 — 월말에 따로 청구된다(3항). 장부에 「營業稅 5%」 줄을 하나 더 넣는다.
//   none      필요 없음 — 부가세가 없다(4항). 장부 금액 그대로.
//
// **5% 를 줄로 넣는 이유.** 장부의 모든 합계(한눈에 보기 · 업체별 · 달별 · 월/연 결산의 식자재)는 DB 가 줄의
// amount 를 더해서 낸다(src/ingredients.js summaryPipelines — 16만 줄이라 화면이 더하지 않는다). 부가세를
// 줄 밖의 칸에 두면 그 합계 여섯 군데를 다 고쳐야 하고, 하나라도 빠지면 그 화면만 5% 가 모자란다. 줄로
// 넣으면 어디서 세든 같은 돈이고, 엑셀로 받아도 그 줄이 그대로 나간다.
//
// 그 줄은 `vat: true` 로 표시한다 — 품목 목록(무엇을 샀나)·단가 추이에는 안 끼운다. 영수증을 다시 저장하거나
// 되돌리면 그 영수증의 줄이 통째로 갈리므로, 그때마다 sync() 가 5% 줄을 다시 맞춘다(금액이 바뀌면 5% 도
// 따라 바뀐다).
//
// 업체마다 방법이 정해져 있어서 「이 업체는 늘 이렇게」를 기억한다(kind "vendor"). 그 업체의 다음 영수증은
// 저장할 때 그 값으로 시작한다. 지난 영수증에 거꾸로 붙이지는 않는다 — 2007년부터 수천 장에 갑자기 5% 가
// 생기면 지난 결산 숫자가 조용히 바뀐다.

const COLL = "ingredient_vat";
const RATE = 0.05;
const MODES = ["included", "add", "none"];
const VAT_NAME = "營業稅 5%";
const VAT_NAME_KO = "부가세 5%";

const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const receiptId = (k) => `r|${k.store}|${k.date}|${k.vendor}`;
const vendorId = (vendor) => `v|${vendor}`;
const vatRowId = (k) => `${k.store}|${k.date}|${k.vendor}|vat`;

/** 이 영수증 줄들(5% 줄 빼고)에 붙을 부가세. 금액 합 × 5%, 소수 둘째 자리까지 — 월말 청구서와 몇 전 안 갈린다. */
function vatOf(rows) {
  const base = (rows || []).filter((r) => !r.vat).reduce((a, r) => a + (Number(r.amount) || 0), 0);
  return base > 0 ? round2(base * RATE) : 0;
}

/** 장부에 넣을 「營業稅 5%」 줄. */
function vatRow(k, amount) {
  return {
    _id: vatRowId(k),
    store: k.store,
    date: k.date,
    month: String(k.date).slice(0, 7),
    vendor: k.vendor,
    name: VAT_NAME,
    name_ko: VAT_NAME_KO,
    qty: 1,
    unit: "",
    price: amount,
    amount,
    vat: true,
  };
}

const validMode = (m) => (MODES.includes(m) ? m : null);

/** 이 영수증에 고른 방법, 없으면 업체 기억값. { mode, from: "receipt"|"vendor"|null } */
async function modeFor(vc, k) {
  const r = await vc.findOne({ _id: receiptId(k) });
  if (r && validMode(r.mode)) return { mode: r.mode, from: "receipt" };
  const v = await vc.findOne({ _id: vendorId(k.vendor) });
  if (v && validMode(v.mode)) return { mode: v.mode, from: "vendor" };
  return { mode: null, from: null };
}

/** 이 영수증의 방법을 적는다. remember 면 그 업체의 다음 영수증도 이 값으로 시작한다. */
async function setMode(vc, k, mode, remember) {
  const m = validMode(mode);
  const at = new Date().toISOString();
  if (!m) {
    await vc.deleteOne({ _id: receiptId(k) });
  } else {
    await vc.replaceOne(
      { _id: receiptId(k) },
      { _id: receiptId(k), kind: "receipt", store: k.store, date: k.date, vendor: k.vendor, mode: m, at },
      { upsert: true }
    );
  }
  if (remember && m) {
    await vc.replaceOne({ _id: vendorId(k.vendor) }, { _id: vendorId(k.vendor), kind: "vendor", vendor: k.vendor, mode: m, at }, { upsert: true });
  }
  return m;
}

/**
 * 장부의 그 영수증에 5% 줄을 맞춘다. 고른 방법이 「더해야 함」이면 넣고(금액은 지금 줄로 다시 셈), 아니면 뺀다.
 * 돌려주는 것: 넣은 부가세 금액(없으면 0).
 */
async function sync(c, vc, k) {
  await c.deleteMany({ store: k.store, date: k.date, vendor: k.vendor, vat: true });
  const r = await vc.findOne({ _id: receiptId(k) });
  if (!r || r.mode !== "add") return 0;
  const rows = await c.find({ store: k.store, date: k.date, vendor: k.vendor }, { projection: { amount: 1, vat: 1 } }).toArray();
  const amount = vatOf(rows);
  if (amount > 0) {
    const row = vatRow(k, amount);
    await c.replaceOne({ _id: row._id }, row, { upsert: true });
  }
  return amount;
}

/**
 * 저장하는 순간의 방법을 정한다 — 화면이 보낸 값 > 이 영수증에 이미 고른 값 > 업체 기억값.
 * 처음 저장하는 영수증이 업체 기억값을 받으면 그 영수증의 값으로 적어 둔다(나중에 업체 값을 바꿔도 이 영수증은
 * 안 움직인다).
 */
async function decideOnSave(vc, k, wanted, remember) {
  const w = validMode(wanted);
  if (w) return setMode(vc, k, w, remember);
  const got = await modeFor(vc, k);
  if (got.from === "vendor") await setMode(vc, k, got.mode, false);
  return got.mode;
}

module.exports = { COLL, RATE, MODES, VAT_NAME, VAT_NAME_KO, receiptId, vendorId, vatRowId, vatOf, vatRow, modeFor, setMode, sync, decideOnSave };
