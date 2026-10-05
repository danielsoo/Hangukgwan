// 영수증 사진을 **Claude 에게 읽힌다.**
//
// 2026-10-05 사장님: "그냥 클로드나 지피티 api 사용하면 어때? 많은 토큰을
// 사용하는 게 아니면 api 사용하려고."
//
// 기기 안에서 읽는 길(public/js/receipt-ocr.js)을 오래 밀어 봤지만 한 줄이
// 통째로 맞는 비율이 **22%** 에서 멈췄다. 쪼개기에서 53.6% 를 잃는데 그걸
// 없애는 두 가지가 다 실패했다(Qr/app/tools/README.md).
//
// ── 얼마나 드는가
//
// 사장님 영수증은 한 달 **221장**(하루 7.4장)이다. 사진 한 장을 긴 쪽
// 1,568점으로 줄이면 약 1,800토큰, 답이 350토큰쯤이다.
//
//   큰 모델   한 달 약 $2.5 (1년 $30)
//   중간 모델 한 달 약 $0.8
//
// ── 무엇을 조심하는가
//
// - **사진이 기기 밖으로 나간다.** 급여 출근 카드는 그대로 기기 안에서
//   읽는다(직원 개인 기록이다). 영수증만 내보낸다.
// - 키는 **Vercel 환경변수**(`ANTHROPIC_API_KEY`)에만 둔다. 저장소에도,
//   관리자 설정 화면에도 넣지 않는다 — Firebase 키와 같은 규칙이다.
// - **한 달에 몇 번까지**를 막아 둔다(`AI_MONTHLY_CAP`). 어디선가 되풀이해
//   부르면 조용히 돈이 나간다.
// - 키가 없거나 실패하면 **기기 안에서 읽는 길로 내려간다.** 화면이 멈추지
//   않는다.
const crypto = require("crypto");

const API = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-5-5";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** 그 사진을 전에 읽었는지 가리는 열쇠. 같은 사진을 두 번 돈 내고 읽지 않는다. */
function imageKey(base64) {
  return crypto.createHash("sha256").update(String(base64 || "")).digest("hex").slice(0, 32);
}

/**
 * data: 머리를 떼고 바이트 수를 센다.
 * @returns {{media: string, data: string, bytes: number}|null}
 */
function splitDataUrl(url) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(url || ""));
  if (!m) return null;
  return { media: m[1], data: m[2], bytes: Math.floor((m[2].length * 3) / 4) };
}

/**
 * 무엇을 어떻게 읽어 달라고 할 것인가.
 *
 * 요점 셋:
 *  - **그 업체에서 보통 사는 품목 목록을 같이 준다.** 그러면 품명이 사장님
 *    장부와 같은 글자로 돌아와서 그대로 저장할 수 있다. 토큰은 몇십 개뿐이다.
 *  - **수량 × 단가 = 금액** 을 지키라고 한다. 사장님 장부 154,563줄에서
 *    99.2% 가 이 셈을 지킨다.
 *  - **확실치 않으면 확실치 않다고** 하게 한다. 틀린 값을 표시 없이 넣는
 *    것이 제일 나쁘다.
 */
function buildPrompt(opts) {
  const o = opts || {};
  const items = (o.items || []).slice(0, 60);
  const lines = [
    "대만 식자재 가게의 매입 전표(估價單·送貨單·銷貨單) 사진입니다. 대부분 손으로 썼습니다.",
    "품목 줄을 그대로 읽어 JSON 으로만 답하세요. 설명하지 마세요.",
    "",
    "{\"rows\":[{\"name\":\"品名\",\"qty\":수량,\"unit\":\"단위\",\"price\":단가,\"amount\":금액,\"sure\":true}],\"total\":인쇄된合計또는null,\"note\":\"\"}",
    "",
    "규칙:",
    "- name 은 전표에 적힌 **중국어 그대로**. 번역하지 마세요.",
    "- qty 는 숫자입니다. 「半斤」은 0.5, 「斤半」은 1.5 입니다.",
    "- unit 은 斤·包·把·箱 처럼 적힌 단위. 없으면 \"\".",
    "- price·amount 는 숫자만(쉼표 없이).",
    "- **qty × price = amount** 가 맞아야 합니다. 안 맞으면 전표를 다시 보고,",
    "  그래도 안 맞으면 그 줄의 sure 를 false 로 하세요.",
    "- 글씨가 흐리거나 확신이 없으면 **sure 를 false**. 지어내지 마세요.",
    "- 합계·소계·세금 줄은 rows 에 넣지 말고 total 에 넣으세요.",
    "- 빈 줄, 줄 번호만 있는 줄은 넣지 마세요.",
  ];
  if (o.pieces > 1) {
    lines.push(`- 사진 ${o.pieces}장은 **같은 전표의 위쪽과 아래쪽**입니다. 가운데가 조금 겹칩니다 —`);
    lines.push("  겹친 줄을 두 번 넣지 마세요.");
  }
  if (o.vendor) lines.push(`- 이 전표는 「${o.vendor}」 것입니다.`);
  if (o.date) lines.push(`- 날짜는 ${o.date} 로 알고 있습니다.`);
  if (items.length) {
    lines.push("", `이 업체에서 자주 사는 품목입니다. 같은 것이면 **이 글자 그대로** 쓰세요:`);
    lines.push(items.join(" · "));
  }
  return lines.join("\n");
}

/** 답에서 JSON 만 꺼낸다. 모델이 앞뒤에 말을 붙여도 견딘다. */
function parseAnswer(text) {
  const s = String(text || "");
  let body = s.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(body);
  if (fence) body = fence[1].trim();
  else {
    const a = body.indexOf("{");
    const b = body.lastIndexOf("}");
    if (a >= 0 && b > a) body = body.slice(a, b + 1);
  }
  let obj;
  try { obj = JSON.parse(body); } catch (e) { return null; }
  if (!obj || !Array.isArray(obj.rows)) return null;
  return obj;
}

const num = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v == null ? "" : v).replace(/[,\s]/g, "");
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/**
 * 돌아온 줄들을 **우리 쪽에서 한 번 더 검사한다.**
 *
 * 모델이 셈을 지키라고 해도 가끔 어긋난다. 어긋난 줄은 고치지 않고
 * **확실치 않음**으로 넘긴다 — 화면이 노란 줄로 보여 주고 사장님이 정한다.
 */
/**
 * 종이에 **단가가 아예 안 적힌** 줄을 장부로 메운다.
 *
 * 阿麵製麵 전표는 품명과 수량만 적고 단가·금액을 안 쓴다 — 사장님이 외워서
 * 적으신다(拉麵은 늘 120). 읽어서는 나올 수가 없다. 2026-10-05 눈가림 시험
 * 40줄 중 2줄이 이것이었다.
 *
 * 그 업체·그 품목의 단가가 **늘 같았을 때만** 메운다. 값이 들쭉날쭉한 품목을
 * 메우면 틀린 금액이 조용히 들어간다. 메운 줄은 **sure 를 false** 로 둬서
 * 화면이 노란 줄로 보여 준다.
 */
function fillFromLedger(rows, known) {
  if (!known || !known.length) return rows;
  const by = new Map();
  for (const k of known) {
    const name = String(k.name || "").normalize("NFC").trim();
    if (name) by.set(name, k);
  }
  for (const r of rows) {
    if (r.price !== "" || !r.name) continue;
    const k = by.get(r.name);
    // last_price 만 있고 늘 같았는지 모르면 메우지 않는다
    if (!k || k.last_price == null || k.steady === false) continue;
    r.price = k.last_price;
    r.filled = true;
    r.sure = false;
    if (r.amount === "" && r.qty !== "") r.amount = Math.round(Number(r.qty) * k.last_price * 100) / 100;
  }
  return rows;
}

function checkRows(obj, opts) {
  const o = Object.assign({ maxRows: 60, known: null }, opts || {});
  const rows = [];
  for (const r of (obj.rows || []).slice(0, o.maxRows)) {
    const qty = num(r && r.qty);
    const price = num(r && r.price);
    const amount = num(r && r.amount);
    const name = String((r && r.name) || "").normalize("NFC").trim();
    const unit = String((r && r.unit) || "").normalize("NFC").trim();
    const warn = [];
    if (!name) warn.push("name");
    if (qty == null || !(qty > 0)) warn.push("qty");
    if (price == null || !(price > 0)) warn.push("price");
    if (amount == null || !(amount > 0)) warn.push("amount");
    if (qty != null && price != null && amount != null) {
      // 반올림 한 자리까지는 봐준다 — 0.82근 × 100 = 82 같은 줄이 있다
      if (Math.abs(qty * price - amount) > Math.max(1, amount * 0.02)) warn.push("math");
    }
    rows.push({
      name, unit,
      qty: qty == null ? "" : qty,
      price: price == null ? "" : price,
      amount: amount == null ? "" : amount,
      // 모델이 아니라고 했거나 우리 검사에 걸리면 확실치 않다
      sure: r && r.sure !== false && warn.length === 0,
      warn,
    });
  }
  fillFromLedger(rows, o.known);
  const total = num(obj.total);
  // 인쇄된 合計가 있으면 더해 본다 — 영수증 한 장을 통째로 검사한다
  let sum = 0, haveAll = rows.length > 0;
  for (const r of rows) { if (r.amount === "") haveAll = false; else sum += Number(r.amount); }
  const totalOk = total != null && haveAll
    ? Math.abs(sum - total) <= Math.max(1, total * 0.02)
    : null;
  return { rows, total, sum: haveAll ? sum : null, totalOk, note: String(obj.note || "").slice(0, 200) };
}

/**
 * 사진 한 장을 읽는다.
 *
 * @param image data:image/jpeg;base64,... (화면에서 긴 쪽 1,568점으로 줄여 보낸다)
 * @returns {{ok, rows, total, totalOk, usage, cached}|{ok:false, error}}
 */
async function readReceipt(image, opts) {
  // 한 장이든 여러 장이든 받는다. 줄이 많은 전표는 화면이 위아래로 갈라
  // 보내므로(cropsForAi), 두 조각을 **한 번에** 물어본다 — 따로 물으면
  // 겹친 줄이 두 번 들어온다.
  const list = Array.isArray(image) ? image : [image];
  const o = Object.assign({
    key: process.env.ANTHROPIC_API_KEY,
    model: process.env.AI_MODEL || DEFAULT_MODEL,
    timeoutMs: 60000,
    fetch: global.fetch,
  }, opts || {});
  if (!o.key) return { ok: false, error: "no_key" };
  const imgs = list.map(splitDataUrl);
  if (!imgs.length || imgs.some((x) => !x)) return { ok: false, error: "bad_image" };
  const bytes = imgs.reduce((a, x) => a + x.bytes, 0);
  if (bytes > MAX_IMAGE_BYTES) return { ok: false, error: "too_big" };

  const content = imgs.map((x) => ({ type: "image", source: { type: "base64", media_type: x.media, data: x.data } }));
  content.push({ type: "text", text: buildPrompt(Object.assign({ pieces: imgs.length }, o)) });
  const body = { model: o.model, max_tokens: 2000, messages: [{ role: "user", content }] };
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), o.timeoutMs) : null;
  let res;
  try {
    res = await o.fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": o.key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
    });
  } catch (e) {
    return { ok: false, error: "network", detail: String((e && e.message) || e).slice(0, 200) };
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, error: `api_${res.status}`, detail: detail.slice(0, 300) };
  }
  const data = await res.json().catch(() => null);
  const text = data && Array.isArray(data.content)
    ? data.content.filter((c) => c.type === "text").map((c) => c.text).join("")
    : "";
  const parsed = parseAnswer(text);
  if (!parsed) return { ok: false, error: "bad_answer", detail: text.slice(0, 200) };
  const checked = checkRows(parsed, { known: o.known });
  return {
    ok: true,
    ...checked,
    usage: data && data.usage ? { in: data.usage.input_tokens, out: data.usage.output_tokens } : null,
    model: o.model,
  };
}

module.exports = {
  readReceipt, buildPrompt, parseAnswer, checkRows, fillFromLedger, splitDataUrl, imageKey,
  API, DEFAULT_MODEL, MAX_IMAGE_BYTES,
};
