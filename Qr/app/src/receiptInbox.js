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
function parsePasted(text) {
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
  const first = list[0];
  if (!first || typeof first !== "object") return { ok: false, error: "bad_shape" };
  if (!Array.isArray(first.rows)) return { ok: false, error: "no_rows" };
  return { ok: true, receipt: first, more: list.length - 1 };
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
  const rows = checked.rows.map((row, i) => {
    const src = (r.rows || [])[i] || {};
    return { ...row, name_ko: String(src.name_ko || src.note || "").normalize("NFC").trim() };
  });
  const unsure = rows.filter((x) => !x.sure).length;
  return { head, rows, unsure, total: checked.total, sum: checked.sum, totalOk: checked.totalOk, note: checked.note };
}

/** data:image/...;base64,... 를 바이트로. 너무 크면 안 받는다. */
function decodeImage(dataUrl, max) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) return { error: "bad_image" };
  const bytes = Math.floor((m[2].length * 3) / 4);
  if (bytes > (max || MAX_IMAGE_BYTES)) return { error: "too_big", bytes };
  return { mime: m[1], buffer: Buffer.from(m[2], "base64"), bytes };
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
  };
}

module.exports = {
  COLL, STATUS, MAX_IMAGE_BYTES, MAX_THUMB_BYTES, MAX_PER_UPLOAD, MAX_PENDING,
  parsePasted, normalizeRead, decodeImage, listItem,
};
