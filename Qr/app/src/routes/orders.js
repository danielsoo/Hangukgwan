const express = require("express");
const { store, save, nextId } = require("../db");
const { requireAdmin } = require("../auth");

function nowLocal() {
  // "YYYY-MM-DD HH:MM:SS" in server local time
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

module.exports = function (io) {
  const router = express.Router();

  // Customer: place a new order
  router.post("/", (req, res) => {
    const { tableNumber, items, note } = req.body || {};
    if (!tableNumber || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "invalid_order" });
    }

    const validated = [];
    let total = 0;
    for (const it of items) {
      const mi = store.menuItems.find((m) => m.id === parseInt(it.itemId, 10) && m.available);
      if (!mi) continue;
      const qty = Math.max(1, Math.min(20, parseInt(it.qty, 10) || 1));
      total += mi.price * qty;
      validated.push({
        item_id: mi.id,
        name_zh: mi.name_zh,
        name_ko: mi.name_ko,
        name_en: mi.name_en,
        qty,
        unit_price: mi.price,
        option_choice: it.option || null,
        note: (it.note || "").slice(0, 200),
      });
    }
    if (validated.length === 0) return res.status(400).json({ error: "no_valid_items" });

    const order = {
      id: nextId("orders"),
      table_number: String(tableNumber),
      status: "new",
      total,
      note: (note || "").slice(0, 300),
      created_at: nowLocal(),
      updated_at: nowLocal(),
      items: validated,
    };
    store.orders.push(order);
    save();

    io.emit("new_order", order);
    res.status(201).json(order);
  });

  // Customer: check status of their own order
  router.get("/:id", (req, res) => {
    const id = parseInt(req.params.id, 10);
    const order = store.orders.find((o) => o.id === id);
    if (!order) return res.status(404).json({ error: "not_found" });
    res.json(order);
  });

  // Admin: list orders, optional ?status= and ?date=YYYY-MM-DD
  router.get("/", requireAdmin, (req, res) => {
    let list = [...store.orders];
    if (req.query.status) list = list.filter((o) => o.status === req.query.status);
    if (req.query.date) list = list.filter((o) => o.created_at.slice(0, 10) === req.query.date);
    list.sort((a, b) => b.id - a.id);
    res.json(list.slice(0, 500));
  });

  // Admin: update order status
  router.patch("/:id", requireAdmin, (req, res) => {
    const { status } = req.body || {};
    const valid = ["new", "preparing", "served", "paid", "cancelled"];
    if (!valid.includes(status)) return res.status(400).json({ error: "invalid_status" });
    const id = parseInt(req.params.id, 10);
    const order = store.orders.find((o) => o.id === id);
    if (!order) return res.status(404).json({ error: "not_found" });
    order.status = status;
    order.updated_at = nowLocal();
    save();
    io.emit("order_updated", order);
    res.json(order);
  });

  return router;
};
