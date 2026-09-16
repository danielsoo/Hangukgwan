// Shared parser for a menu item's `addons` field — a comma-separated list of
// "Name:Price" pairs (e.g. "볶음밥 추가:80,사리면 추가:50", or a free swap like
// "飯換冬粉:0"). Unlike `options`/`spice_options` (single-choice radios,
// parsed inline wherever they're used), addons are multi-select — a customer
// can pick any number of them — so both the customer order page
// (public/js/order.js) and the order-placing/editing routes
// (src/routes/orders.js) need the exact same parsing to agree on price.
function parseAddons(addonsStr) {
  if (!addonsStr) return [];
  return addonsStr
    .split(",")
    .map((pair) => {
      const [name, priceStr] = pair.split(":");
      const trimmedName = (name || "").trim();
      const price = parseInt((priceStr || "0").trim(), 10);
      return trimmedName ? { name: trimmedName, price: Number.isNaN(price) ? 0 : price } : null;
    })
    .filter(Boolean);
}

/**
 * 「하나만 고르는 옵션」(options) 도 같은 모양으로 읽는다.
 *
 * 2026-09-16 사장님: "크기 같은 옵션은 옵션마다 금액이 추가가 되어야 하는데
 * 이게 또 중복이 되면 안되거든? 당연히? 그래서 하나만 고르는 옵션으로
 * 들어가야 하는데 그건 가격이 안 바뀐대."
 *
 * 그동안 둘 중 하나만 고를 수 있었다.
 *   · 하나만 고르는 옵션(options) — 하나만 골라지는데 값이 안 붙는다
 *   · 여러 개 고르는 옵션(addons) — 값이 붙는데 **여러 개 골라진다**
 * 크기(S/M/L/XL)는 둘 다 필요하다. addons 로 넣으면 손님이 M 과 L 을 같이
 * 고를 수 있다.
 *
 * 그래서 options 에도 「이름:금액」을 허용한다. 금액을 안 적으면 0 이라,
 * 지금까지 쓰던 "牛,豬" 같은 값은 **한 글자도 안 고쳐도 그대로 돈다.**
 * 읽는 규칙이 addons 와 같아야 두 화면이 같은 값을 본다.
 */
const parseOptions = parseAddons;

/** 고른 옵션 하나의 값. 없거나 못 찾으면 0 — 지어내지 않는다. */
function optionPriceOf(optionsStr, chosenName) {
  if (!chosenName) return 0;
  const found = parseOptions(optionsStr).find((o) => o.name === String(chosenName).trim());
  return found ? found.price : 0;
}

module.exports = { parseAddons, parseOptions, optionPriceOf };
