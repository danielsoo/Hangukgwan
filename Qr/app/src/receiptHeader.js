// 영수증 **머리**를 읽는다 — 어느 가게에서, 언제, 어느 지점이 받았나.
//
// 2026-10-05 사장님: "아빠가 파일 이름에 저런 정보를 안 넣으면 넌 그걸 인식
// 못해?"
//
// 재봤다. 영수증 12장을 **파일 이름을 안 보고** 사진만으로 읽으니
// 업체 10/12 · 날짜 8/12 · 지점 12/12 였다. 못 맞힌 자리가 어떤 것인지가
// 중요하다 — 넷 중 둘은 읽기가 틀린 게 아니었다:
//
//  - 종이에는 「思皓興業有限公司」라고 찍혀 있는데 사장님 장부는
//    「思皓企業社」다. 阿麵製麵廠 ↔ 阿麵製麵 도 같다. **이름 표기 차이**다.
//  - 종이 날짜가 4/29 인데 장부는 5/1 인 것이 있었다(그 전표에
//    「5/1休1天,請提早備貨」가 찍혀 있다). **종이 날짜와 장부 날짜가 늘 같지는
//    않다** — 이건 고칠 수 없고, 읽은 값을 보여 드리고 사장님이 정하신다.
//  - 글자 하나를 틀린 것(溝通 ↔ 萬通)은 업체 목록에 맞춰보면 저절로 바로잡힌다.
//
// 그래서 이 파일이 하는 일은 **읽은 글자를 장부의 이름에 맞추는 것**이다.
// 지어내지 않는다 — 가깝지 않으면 못 가렸다고 말한다.
const { canonicalVendor, normName } = require("./ingredients");

/** 가게 종류를 가리키는 꼬리말. 「思皓企業社」의 社, 「阿麵製麵廠」의 廠. */
const TAIL = /(股份有限公司|有限公司|企業社|實業社|企業行|食品行|菓菜行|果菜行|水産行|水產行|商行|興業社|企業|實業|興業|國際|開發|公司|商店|工廠|農場|行|社|廠|號)$/;

/** 우리 가게 이름. 전표의 「客戶」 칸이지 파는 쪽이 아니다. */
const OURS = /韓國館|韓食館|韓國食堂|한국관/;

/** 꼬리말을 뗀 **알맹이**. 「思皓企業社」 → 「思皓企業」 → 「思皓」. */
function coreName(s) {
  let v = normName(s).replace(/[\s()（）·.,:：、]/g, "");
  for (let i = 0; i < 3; i++) {
    const cut = v.replace(TAIL, "");
    if (cut === v || cut.length < 2) break;
    v = cut;
  }
  return v;
}

/** 두 글자열이 같은 차례로 공유하는 글자 수. */
function lcsLen(a, b) {
  if (!a || !b) return 0;
  const prev = new Array(b.length + 1).fill(0);
  const cur = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = 0;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

const dice = (a, b) => (a && b ? (2 * lcsLen(a, b)) / (a.length + b.length) : 0);

/**
 * 읽은 상호를 **장부에 있는 이름**으로 맞춘다.
 *
 * 받는 기준이 둘이다. 하나만으로는 안 된다:
 *
 *  - 첫 글자가 같고 알맹이가 반쯤 겹치면 받는다
 *    (思皓興業有限公司 → 思皓企業社).
 *  - 첫 글자가 달라도 **거의 같으면** 받는다. 글자 하나를 잘못 읽은 것이다
 *    (溝通水産食品行 → 萬通水産食品行).
 *
 * 첫 글자 기준이 없으면 **丸邱菓菜行이 房信菓菜行으로 간다**(꼬리 세 글자가
 * 같아서 0.6 이 나온다). 장부에 없는 업체의 전표를 남의 것으로 적는 쪽이
 * 「못 가렸다」보다 훨씬 나쁘다.
 */
function matchVendor(text, names, opts) {
  const o = Object.assign({ near: 0.85, head: 0.5, margin: 0.1 }, opts || {});
  const raw = normName(text).replace(/[\s()（）]/g, "");
  if (!raw || raw.length < 2) return null;
  if (OURS.test(raw)) return null;              // 우리 가게다. 파는 쪽이 아니다
  // 같은 회사의 다른 상호(龍國興業社 → 龍江興南北商行)는 글자가 안 닮았다.
  // 적어 둔 것이 있으면 그게 먼저다.
  const canon = canonicalVendor(raw);
  for (const n of names || []) {
    if (canonicalVendor(n) === canon) return { vendor: canon, score: 1, sure: true, second: null };
  }
  const core = coreName(raw);
  const scored = [];
  for (const n of names || []) {
    const name = canonicalVendor(n);
    if (!name) continue;
    const c = coreName(name);
    const s = Math.max(dice(raw, normName(name)), dice(core, c));
    const headSame = core[0] && c[0] && core[0] === c[0];
    const ok = s >= o.near || (headSame && s >= o.head);
    scored.push({ name, score: Math.round(s * 1000) / 1000, ok });
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || !best.ok) return null;
  const second = scored.find((x) => x.name !== best.name);
  return {
    vendor: best.name,
    score: best.score,
    // 2등이 바짝 붙어 있으면 「맞다」고 하지 않는다 — 화면이 묻는다
    sure: !second || best.score - second.score >= o.margin,
    second: second ? second.name : null,
  };
}

/** 민국 113년 → 2024. 두 자리 24 → 2024. 네 자리는 그대로. */
function toYear(y) {
  const n = Number(y);
  if (!Number.isFinite(n)) return null;
  if (n < 100) return 2000 + n;         // 「24.05.27」 — 思皓 전표가 이렇게 찍는다
  if (n <= 200) return n + 1911;        // 민국
  return n;
}

const pad2 = (n) => String(n).padStart(2, "0");

/**
 * 전표에 적힌 날짜. 「113年5月29日」 · 「112/07/27」 · 「24.05.27」 · 「2023.06.26」.
 *
 * 한 장에 날짜가 여럿일 수 있다(思皓 전표는 銷貨日期와 列印日期가 다르다).
 * **앞에 붙은 말**로 고른다 — 列印(찍은 날)보다 銷貨·單據·出貨(물건이 온 날)가
 * 먼저다.
 */
function parseDate(text, opts) {
  const o = Object.assign({ min: "2010-01-01", max: null }, opts || {});
  const s = normName(text);
  if (!s) return null;
  const max = o.max || new Date(Date.now() + 366 * 86400000).toISOString().slice(0, 10);
  const re = /(\d{2,4})\s*[年./\-]\s*(\d{1,2})\s*[月./\-]\s*(\d{1,2})\s*日?/g;
  const found = [];
  let m;
  while ((m = re.exec(s))) {
    const y = toYear(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (!y || !(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) continue;
    const iso = `${y}-${pad2(mo)}-${pad2(d)}`;
    if (iso < o.min || iso > max) continue;
    const before = s.slice(Math.max(0, m.index - 10), m.index);
    let rank = 0;
    if (/列印|製表|印表/.test(before)) rank -= 2;      // 가게가 종이를 찍은 날
    if (/銷貨|單據|出貨|交易|訂貨|日期/.test(before)) rank += 2;
    found.push({ iso, rank, at: m.index });
  }
  if (!found.length) return null;
  found.sort((a, b) => b.rank - a.rank || a.at - b.at);
  return found[0].iso;
}

/**
 * 어느 지점이 받았나. 「台元三店」 도장이 찍혀 있거나 받는 이가 「台元」이면
 * 2호점(branch3), 「竹北區」·「縣政」이면 본점이다.
 *
 * 台元을 먼저 본다 — 2호점 주소가 「竹北市台元科技園區…」라 둘 다 들어 있다.
 */
function storeFromText(text) {
  const s = normName(text);
  if (!s) return null;
  if (/台元|臺元|三店|2호점|branch3/i.test(s)) return "branch3";
  // 본점은 竹北 縣政9路다. 2호점 주소에도 竹北이 들어 있지만 위에서 걸렀다.
  if (/竹北|縣政|總店|본점|main/i.test(s)) return "main";
  return null;
}

/**
 * 읽어 온 머리를 장부 말로 바꾼다.
 *
 * 못 가린 자리는 **비워 둔다.** 짐작해서 넣으면 엉뚱한 업체의 지출이 되고,
 * 눈으로는 멀쩡해 보인다(2026-10-04 龍 글자 때와 같은 종류의 잘못이다).
 */
function readHeader(raw, opts) {
  const o = Object.assign({ vendors: [] }, opts || {});
  const r = raw || {};
  const vendorText = normName(r.vendor);
  const hit = vendorText ? matchVendor(vendorText, o.vendors) : null;
  const date = parseDate(r.date || "") || parseDate(r.date_text || "");
  const store = storeFromText(r.store || r.store_text || "");
  return {
    vendor: hit ? hit.vendor : "",
    vendor_text: vendorText,
    vendor_sure: hit ? hit.sure : false,
    vendor_score: hit ? hit.score : 0,
    date: date || "",
    date_text: normName(r.date || ""),
    store: store || "",
    store_text: normName(r.store || r.store_text || ""),
  };
}

module.exports = { readHeader, matchVendor, parseDate, storeFromText, coreName, lcsLen, dice, toYear, TAIL };
