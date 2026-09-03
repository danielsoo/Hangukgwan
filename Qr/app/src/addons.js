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

module.exports = { parseAddons };
