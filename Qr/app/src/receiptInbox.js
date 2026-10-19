// 영수증 **대기함** — 아빠가 올린 사진이 읽히기를 기다리는 자리.
//
// 2026-10-06 사장님: "아빠가 일단 사진을 올려주면 그걸 내가 다운받아서 여기다가
// 칠거야 그럼 너가 급여처럼 인식해서 확실하거나 확실하지 않는 걸로 나눠서 옆에
// 사진 보여주면서 맞는지 아빠가 오케이 하고 저장하게 하는거지. 그게 또 전체
// 내역에서 볼수 있는 거고."
//
// 길은 이렇다:
//
//   아빠: 사진 올리기            → 대기함에 쌓인다(「읽기 전」)
//   사장님: 받아서 Claude 에게   → 읽은 결과(JSON)를 받는다
//   아빠: 그 결과를 붙여넣기     → 사진을 옆에 두고 확인(「확인 대기」)
//   아빠: 저장                   → 장부에 들어가고 사진은 지운다(「저장됨」)
//
// 왜 사진을 서버에 두는가: 숫자 옆에 **그 종이**가 있어야 맞는지 본다. 급여
// 출근 카드에서 잘라낸 그림을 숫자 밑에 두는 것과 같은 이유다. 다만 출근 카드는
// 기기 안에서만 읽어 사진이 나가지 않는 데 비해, 여기서는 아빠 폰에서 올린
// 사진을 사장님 화면에서 봐야 하므로 서버를 거친다.
//
// **저장하면 사진은 지운다.** 한 달 221장 × 400KB 면 금방 쌓인다. 줄은 남겨서
// 「언제 무엇을 올렸고 저장했나」는 보인다.
const AI = require("./receiptAi");
const HEAD = require("./receiptHeader");

const COLL = "ingredient_inbox";
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;   // 폰 사진을 긴 쪽 1,600점으로 줄이면 400KB쯤
const MAX_THUMB_BYTES = 200 * 1024;
const MAX_PER_UPLOAD = 10;
const MAX_PENDING = 200;                    // 이보다 쌓이면 올리기를 막고 말한다

/** 읽기 전 → 확인 대기 → 저장됨. 되돌아가지 않는다(다시 붙여넣으면 확인 대기). */
const STATUS = { NEW: "new", READ: "read", SAVED: "saved" };

/**
 * 붙여넣은 글에서 JSON 을 꺼낸다.
 *
 * 사장님이 Claude 세션에서 복사해 오시는 것이라 앞뒤에 말이 붙어 있거나
 * ```json 울타리가 있을 수 있다. 영수증 한 장이면 객체 하나, 여러 장이면
 * 배열이나 {receipts:[...]} 로 올 수 있다 — 다 받는다.
 */
function parsePastedList(text) {
  const raw = String(text || "").trim();
  if (!raw) return { ok: false, error: "empty" };
  let body = raw;
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(body);
  if (fence) body = fence[1].trim();
  else {
    // 글 사이에 든 JSON 을 집는다 — 객체든 배열이든 바깥 괄호까지
    const a = body.search(/[[{]/);
    const b = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
    if (a >= 0 && b > a) body = body.slice(a, b + 1);
  }
  let obj;
  try { obj = JSON.parse(body); } catch (e) { return { ok: false, error: "bad_json" }; }
  const list = Array.isArray(obj) ? obj : Array.isArray(obj && obj.receipts) ? obj.receipts : [obj];
  const good = list.filter((x) => x && typeof x === "object" && Array.isArray(x.rows));
  if (!list.length || !list[0] || typeof list[0] !== "object") return { ok: false, error: "bad_shape" };
  if (!good.length) return { ok: false, error: "no_rows" };
  // 줄이 없는 장은 **버리지 않고 센다** — 몇 장이 빠졌는지 화면이 말해야 한다
  return { ok: true, list: good, skipped: list.length - good.length };
}

function parsePasted(text) {
  const got = parsePastedList(text);
  if (!got.ok) return got;
  // 한 장만 받는 자리 — 첫 장을 쓰고 나머지는 몇 장인지만 알려준다
  return { ok: true, receipt: got.list[0], more: got.list.length - 1 + (got.skipped || 0) };
}

/**
 * 줄 자리 — 사진 높이의 비율 [위, 아래]. 벗어난 값은 버린다.
 *
 * 비율로 받는 이유: 사진을 줄여 올려도(긴 쪽 1,600점) 그대로 맞는다.
 */
function cleanBand(v) {
  if (!Array.isArray(v) || (v.length !== 2 && v.length !== 4)) return null;
  const n = v.map(Number);
  // 비율이 아니면 버린다 — 0~1 밖의 값은 점(px)으로 적어 보낸 것이다
  if (n.some((x) => !isFinite(x) || x < 0 || x > 1)) return null;
  const y0 = Math.min(n[0], n[1]), y1 = Math.max(n[0], n[1]);
  if (y1 - y0 < 0.002) return null;     // 너무 얇으면 글자가 안 보인다
  if (v.length === 2) return [y0, y1];
  // 한 사진에 전표가 둘일 때 — 가로도 잘라야 옆 전표가 안 딸려 온다(102번)
  const x0 = Math.min(n[2], n[3]), x1 = Math.max(n[2], n[3]);
  if (x1 - x0 < 0.05) return [y0, y1];
  return [y0, y1, x0, x1];
}

/**
 * 읽은 결과를 **우리 쪽에서 한 번 더 검사한다.**
 *
 * 수량 × 단가 = 금액 이 안 맞는 줄은 고치지 않고 **확실치 않음**으로 넘긴다
 * (receiptAi.checkRows). 업체 이름은 장부에 있는 이름에 맞추고, 못 가리면
 * 비워 둔다(receiptHeader.matchVendor). 날짜는 사장님이 적으신 것이 우선이다.
 */
function normalizeRead(receipt, opts) {
  const o = Object.assign({ vendors: [] }, opts || {});
  const r = receipt || {};
  const checked = AI.checkRows({ rows: r.rows || [], total: r.total, note: r.note }, { known: null });
  const head = HEAD.readHeader(
    { vendor: r.vendor || (r.head && r.head.vendor), date: r.date || (r.head && r.head.date), store: r.store || (r.head && r.head.store) },
    { vendors: o.vendors }
  );
  // 장부에 아직 없는 업체면 **종이에 적힌 이름 그대로** 쓴다.
  //
  // matchVendor 는 모르는 업체를 비워 둔다 — 사진에서 저절로 채울 때는 그게 맞다
  // (남의 업체로 적히면 눈으로는 못 찾는다). 하지만 여기서는 사장님이 표를 보고
  // 저장을 누르시는 자리라, 비워 두면 **새 업체의 첫 영수증을 아예 못 넣는다.**
  // 그래서 이름을 넣되 「장부에 없는 업체」라고 표시한다.
  if (!head.vendor && head.vendor_text) { head.vendor = head.vendor_text; head.vendor_new = true; }

  // 지점은 「main」·「branch3」로 바로 줄 수도 있다 — 그러면 그대로 받는다
  const given = String(r.store || "").trim();
  if (given === "main" || given === "branch3") head.store = given;
  // 날짜가 이미 YYYY-MM-DD 면 그대로
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(r.date || ""))) head.date = r.date;
  // 품목마다 한국어 이름을 받는다 — 사장님 장부의 「비  고」 칸이다
  //
  // **줄 자리(band)도 같이 받는다**(2026-10-17). 읽은 쪽이 「사진 위에서 몇 %
  // ~ 몇 % 줄에서 읽었다」를 적어 보내면, 화면이 그 자리를 그대로 잘라 숫자
  // 밑에 붙인다. 사진에서 표를 다시 찾을 필요가 없어진다 — 사장님 영수증
  // 102장으로 재보니 표를 찾은 것이 54장, 줄 수까지 맞는 것은 7장뿐이었다.
  const rows = checked.rows.map((row, i) => {
    const src = (r.rows || [])[i] || {};
    const out = { ...row, name_ko: String(src.name_ko || src.note || "").normalize("NFC").trim() };
    const band = cleanBand(src.band);
    if (band) out.band = band;
    return out;
  });
  const unsure = rows.filter((x) => !x.sure).length;
  return { head, rows, unsure, total: checked.total, sum: checked.sum, totalOk: checked.totalOk, note: checked.note };
}

/**
 * 한 번에 여러 장 — **어느 줄에 넣을지 짝을 맞춘다.**
 *
 * 2026-10-17 사장님이 고르심: 대기함에 115장이 쌓였는데 줄마다 붙여넣으면
 * 115번이다. JSON 한 묶음을 받아 줄마다 나눠 넣는다.
 *
 * 짝은 이 차례로 찾는다. **짐작해서 아무 줄에나 넣지 않는다** — 엉뚱한 줄에
 * 들어가면 영수증 사진과 숫자가 어긋난 채로 저장되고, 눈으로는 못 찾는다.
 *
 *   1. id        — 그 줄의 번호(있으면 가장 확실하다)
 *   2. file      — 올린 파일 이름 그대로
 *   3. file      — 「001_2026-10-16_」 같은 머리를 떼고 비교(전부 받기 zip 이 붙인다)
 *   4. no        — 그 zip 에서의 차례(001). 그 사이에 올리거나 지운 것이 없을 때만 맞는다
 *
 * 못 찾은 것은 **버리지 않고 돌려준다** — 화면이 「짝을 못 찾은 n장」으로 말한다.
 */
const ZIP_PREFIX = /^\d{3}_\d{4}-\d{2}-\d{2}_/;
const stripZipPrefix = (name) => String(name || "").replace(ZIP_PREFIX, "");

function matchReceipts(list, items) {
  const left = (items || []).filter((x) => x && x.id);
  const byId = new Map(left.map((x) => [String(x.id), x]));
  const byName = new Map();
  const byStripped = new Map();
  for (const x of left) {
    const n = String(x.name || "");
    if (n && !byName.has(n)) byName.set(n, x);
    const st = stripZipPrefix(n);
    if (st && !byStripped.has(st)) byStripped.set(st, x);
  }
  const used = new Set();
  const pairs = [];
  const missed = [];
  for (const r of list || []) {
    const file = String((r && r.file) || (r && r.name) || "");
    const stripped = stripZipPrefix(file);
    let item =
      (r && r.id && byId.get(String(r.id))) ||
      byName.get(file) ||
      byName.get(stripped) ||
      byStripped.get(file) ||
      byStripped.get(stripped) ||
      null;
    // 차례(001_…)로 — 마지막 수단. 그 사이에 바뀐 것이 없을 때만 맞는다.
    if (!item) {
      const m = /^(\d{3})_/.exec(file);
      const at = m ? left[Number(m[1]) - 1] : null;
      if (at && !used.has(at.id)) item = at;
    }
    if (!item || used.has(item.id)) {
      missed.push(file || "(이름 없음)");
      continue;
    }
    used.add(item.id);
    pairs.push({ item, receipt: r });
  }
  return { pairs, missed };
}

/** data:image/...;base64,... 를 바이트로. 너무 크면 안 받는다. */
function decodeImage(dataUrl, max) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) return { error: "bad_image" };
  const bytes = Math.floor((m[2].length * 3) / 4);
  if (bytes > (max || MAX_IMAGE_BYTES)) return { error: "too_big", bytes };
  return { mime: m[1], buffer: Buffer.from(m[2], "base64"), bytes };
}

// 저장한 영수증의 사진을 며칠 들고 있을까 — 그 사이에는 「↶ 되돌리기」로 사진·표째 확인 대기로 돌릴 수 있다
// (2026-10-18 사장님: "영수증 한 번 올리고 확정하고 나면 장부로 넘어가지는데 그거 되돌릴 수 있게 해줘. 사진이랑
// 정보 다 같이"). 예전엔 저장하자마자 지웠다(한 달 221장 × 400KB). 7일이면 잘못 넣은 것은 대개 알아챈다.
const KEEP_SAVED_IMAGE_DAYS = 7;

/**
 * 되돌릴 때 표에 다시 올릴 「읽은 결과」 — **저장한 그대로**(사장님이 고친 값까지) 만든다.
 * 줄 자리(band)는 처음 읽은 결과의 같은 차례 줄에서 가져온다(숫자 밑 사진 띠가 그대로 붙게).
 */
/**
 * 「이 영수증이 장부의 어느 한 장인가」 — 읽은 머리(지점·날짜·업체)로.
 *
 * 2026-10-19 사장님: 전에 이미 저장한 것도 되돌릴 수 있게 해 달라고 하셨다.
 *
 * 되돌리기가 생긴 2026-10-18 **전에** 저장한 줄에는 saved_key 가 없다. 그때는
 * 읽은 머리로 가린다 — 셋이 다 있어야 한다. 사장님이 저장하기 전에 칸을 고치셨으면
 * 다른 장을 가리킬 수 있으므로, 화면이 **몇 줄 얼마를 빼는지 먼저 묻는다.**
 */
function keyFromRead(doc) {
  const h = ((doc || {}).read || {}).head || {};
  const store = String(h.store || "").trim();
  const date = String(h.date || "").trim();
  const vendor = String(h.vendor || "").trim();
  if (!store || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !vendor) return null;
  return { store, date, vendor };
}

function readFromSaved(doc) {
  const d = doc || {};
  const key = d.saved_key || {};
  const old = d.read || {};
  // 옛 줄에는 저장한 표가 없다 — 그때는 **읽은 것 그대로** 다시 연다
  if (!Array.isArray(d.saved_rows)) return old && (old.rows || []).length ? old : null;
  const oldRows = old.rows || [];
  const rows = (d.saved_rows || []).map((r, i) => {
    const out = {
      name: r.name || "", name_ko: r.name_ko || "", unit: r.unit || "",
      qty: r.qty === 0 || r.qty ? r.qty : "", price: r.price === 0 || r.price ? r.price : "",
      amount: r.amount === 0 || r.amount ? r.amount : "", sure: true,
    };
    const band = oldRows[i] && oldRows[i].band;
    if (band) out.band = band;
    return out;
  });
  const sum = rows.reduce((n, r) => n + (Number(r.amount) || 0), 0);
  return {
    head: Object.assign({}, old.head || {}, { store: key.store, date: key.date, vendor: key.vendor }),
    rows, unsure: 0, total: sum, sum, totalOk: true, note: old.note || "",
  };
}

/** 목록에 보낼 모양 — **사진 자체는 안 보낸다**(작은 미리보기만). */
function listItem(doc) {
  const d = doc || {};
  return {
    id: String(d._id),
    name: d.name || "",
    at: d.at || "",
    store: d.store || "",
    status: d.status || STATUS.NEW,
    bytes: d.bytes || 0,
    thumb: d.thumb || "",
    // 목록은 사진을 빼고 읽으므로(projection) 있는지는 따로 적어 둔 값으로 본다
    has_image: d.has_image !== undefined ? !!d.has_image : !!d.image,
    read: d.read ? { head: d.read.head, rows: (d.read.rows || []).length, unsure: d.read.unsure || 0 } : null,
    saved_at: d.saved_at || "",
    saved_lines: d.saved_lines || 0,
    // 저장한 것을 확인 대기로 되돌릴 수 있나(저장할 때 무엇을 덮었는지 적어 둔 것만)
    can_undo: d.status === STATUS.SAVED && (!!d.saved_key || !!keyFromRead(d)),
    // 되돌리기가 생기기 전에 저장한 줄 — 덮기 전 줄은 되살릴 수 없다(안 적어 뒀다)
    undo_old: d.status === STATUS.SAVED && !d.saved_key,
  };
}

module.exports = {
  matchReceipts, stripZipPrefix,
  COLL, STATUS, MAX_IMAGE_BYTES, MAX_THUMB_BYTES, MAX_PER_UPLOAD, MAX_PENDING,
  parsePasted, parsePastedList, normalizeRead, decodeImage, listItem,
  KEEP_SAVED_IMAGE_DAYS, readFromSaved, keyFromRead,
};
