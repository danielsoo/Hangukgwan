const express = require("express");
const QRCode = require("qrcode");
const { store, save, nextId } = require("../db");
const { requireAdmin } = require("../auth");

const router = express.Router();

router.get("/", requireAdmin, (req, res) => {
  res.json([...store.tables].sort((a, b) => a.sort_order - b.sort_order));
});

router.post("/", requireAdmin, async (req, res) => {
  const { number, label } = req.body || {};
  if (!number) return res.status(400).json({ error: "number_required" });
  if (store.tables.some((t) => t.number === String(number))) {
    return res.status(400).json({ error: "table_exists" });
  }
  const maxSort = store.tables.reduce((m, t) => Math.max(m, t.sort_order), 0);
  const table = { id: nextId("tables"), number: String(number), label: label || null, sort_order: maxSort + 1 };
  store.tables.push(table);
  await save();
  res.status(201).json(table);
});

// Public: customer sets the headcount for the table they're ordering from.
// Asked once per fresh page load (see public/js/order.js) and kept on the
// table itself, since until payment everyone ordering from that table is
// treated as the same party.
router.put("/:tableNumber/party-size", async (req, res) => {
  const size = parseInt((req.body || {}).partySize, 10);
  if (!size || size < 1 || size > 50) return res.status(400).json({ error: "invalid_party_size" });
  const table = store.tables.find((t) => t.number === String(req.params.tableNumber));
  if (!table) return res.status(404).json({ error: "table_not_found" });
  table.party_size = size;
  table.party_size_updated_at = new Date().toISOString();
  await save();
  res.json({ party_size: table.party_size });
});

router.delete("/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  store.tables = store.tables.filter((t) => t.id !== id);
  await save();
  res.json({ ok: true });
});

// Printable sheet of QR codes, one per table, pointing at this server's
// own host — so it always works regardless of what domain the app ends
// up deployed on. Open this page and use the browser's Print > Save as PDF.
router.get("/qr-sheet", requireAdmin, async (req, res) => {
  const tables = [...store.tables].sort((a, b) => a.sort_order - b.sort_order);
  const baseUrl = `${req.protocol}://${req.get("host")}`;

  const cards = await Promise.all(
    tables.map(async (t) => {
      const url = `${baseUrl}/t/${encodeURIComponent(t.number)}`;
      const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 300 });
      return `
        <div class="card">
          <div class="table-no">桌號 ${t.label || t.number}</div>
          <img src="${dataUrl}" alt="QR ${t.number}" />
          <div class="url">${url}</div>
        </div>`;
    })
  );

  res.send(`<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8" />
<title>QR Code 桌牌列印</title>
<style>
  body { font-family: 'Noto Sans TC', Arial, sans-serif; margin: 0; padding: 24px; background:#fff; }
  .toolbar { margin-bottom: 16px; }
  button { padding: 10px 18px; font-size: 14px; cursor: pointer; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .card {
    border: 2px dashed #999; border-radius: 12px; padding: 16px; text-align: center;
    page-break-inside: avoid; display:flex; flex-direction:column; align-items:center; gap:8px;
  }
  .table-no { font-size: 20px; font-weight: 700; }
  .card img { width: 200px; height: 200px; }
  .url { font-size: 10px; color: #666; word-break: break-all; }
  @media print {
    .toolbar { display: none; }
    .grid { grid-template-columns: repeat(2, 1fr); }
  }
</style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">列印 / Print all QR codes</button></div>
  <div class="grid">${cards.join("")}</div>
</body>
</html>`);
});

module.exports = router;
