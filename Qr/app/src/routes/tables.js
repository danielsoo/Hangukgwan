const express = require("express");
const { store, save, refreshAndSave, patchArrayItem, nextId, getPhoto } = require("../db");
const { requireAdmin, requirePermission } = require("../auth");
const { buildQrSvg, getLogoDataUri } = require("../qr");
const canEditTables = requirePermission("tableEdit");

const router = express.Router();

router.get("/", requireAdmin, (req, res) => {
  res.json([...store.tables].sort((a, b) => a.sort_order - b.sort_order));
});

router.post("/", canEditTables, async (req, res) => {
  const { number, label } = req.body || {};
  if (!number) return res.status(400).json({ error: "number_required" });
  if (String(number).includes("4")) return res.status(400).json({ error: "unlucky_number" });
  // refreshAndSave (not save()) re-fetches right before creating — narrows
  // the window for a table added from a second admin tab/device at nearly
  // the same moment to race with this one (same "lost update" class of bug
  // fixed for the floor-plan drag/resize PATCHes above).
  let table = null;
  let dupe = false;
  await refreshAndSave((s) => {
    if (s.tables.some((t) => t.number === String(number))) {
      dupe = true;
      return;
    }
    const maxSort = s.tables.reduce((m, t) => Math.max(m, t.sort_order), 0);
    // zone_id starts unset — the table won't appear on the 배치도 floor plan
    // until the owner explicitly adds it into a zone from that view.
    table = {
      id: nextId("tables"),
      number: String(number),
      label: label || null,
      sort_order: maxSort + 1,
      zone_id: null,
      x: 10,
      y: 10,
      width: 70,
      height: 70,
    };
    s.tables.push(table);
  });
  if (dupe) return res.status(400).json({ error: "table_exists" });
  res.status(201).json(table);
});

// Admin: move/resize a table within its zone on the floor-plan canvas (or
// assign/unassign it to a zone, or rename its label). x/y are relative to
// the zone the table belongs to, not the overall canvas.
router.patch("/:id", canEditTables, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const table = store.tables.find((t) => t.id === id);
  if (!table) return res.status(404).json({ error: "not_found" });
  const { x, y, width, height, label, zoneId } = req.body || {};
  // Collects only the fields this call actually changes, then writes them
  // with a targeted per-item DB update (see patchArrayItem() in src/db.js)
  // instead of save()'s full-document replace. The 배치도 floor plan fires
  // one of these PATCHes per drag/resize, often several in quick
  // succession while rearranging tables — a full-document save() can race
  // with another one in flight and silently overwrite it with stale data,
  // which is what caused rearranged tables to randomly "revert".
  const updates = {};
  if (zoneId !== undefined) {
    if (zoneId === null) {
      table.zone_id = null;
      updates.zone_id = null;
    } else {
      const zone = store.zones.find((z) => z.id === parseInt(zoneId, 10));
      if (!zone) return res.status(400).json({ error: "zone_not_found" });
      table.zone_id = zone.id;
      updates.zone_id = zone.id;
      if (table.x == null) {
        table.x = 10;
        updates.x = 10;
      }
      if (table.y == null || table.y < 34) {
        table.y = 34; // stay clear of the zone's header strip
        updates.y = 34;
      }
    }
  }
  if (x != null) {
    table.x = Math.max(0, Number(x));
    updates.x = table.x;
  }
  // Stay clear of the zone's header strip (label / + 테이블 / ✕ buttons).
  if (y != null) {
    table.y = table.zone_id != null ? Math.max(34, Number(y)) : Math.max(0, Number(y));
    updates.y = table.y;
  }
  if (width != null) {
    table.width = Math.max(40, Number(width));
    updates.width = table.width;
  }
  if (height != null) {
    table.height = Math.max(40, Number(height));
    updates.height = table.height;
  }
  if (label != null) {
    table.label = String(label).slice(0, 20) || null;
    updates.label = table.label;
  }
  if (Object.keys(updates).length) await patchArrayItem("tables", id, updates);
  res.json(table);
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

// Public: lets the customer page check whether this table already has a
// party size registered — so a page refresh (or re-scanning the QR code
// mid-visit) doesn't ask again for the same party. Only exposes the one
// field (not the rest of the table record).
router.get("/:tableNumber/party-size", (req, res) => {
  const table = store.tables.find((t) => t.number === String(req.params.tableNumber));
  if (!table) return res.status(404).json({ error: "table_not_found" });
  res.json({ party_size: table.party_size || null });
});

// Clears the registered party size — called once a table is fully settled
// (admin's "전체 결제 완료" and the online-payment callback both call this),
// so the *next* party that scans this table's QR code is asked fresh
// instead of silently inheriting the previous party's headcount.
router.delete("/:tableNumber/party-size", async (req, res) => {
  const table = store.tables.find((t) => t.number === String(req.params.tableNumber));
  if (!table) return res.status(404).json({ error: "table_not_found" });
  table.party_size = null;
  table.party_size_updated_at = null;
  await save();
  res.json({ ok: true });
});

router.delete("/:id", canEditTables, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await refreshAndSave((s) => {
    s.tables = s.tables.filter((t) => t.id !== id);
  });
  res.json({ ok: true });
});

// Printable sheet of QR codes, one per table, pointing at this server's
// own host — so it always works regardless of what domain the app ends
// up deployed on. Open this page and use the browser's Print > Save as PDF.
router.get("/qr-sheet", requireAdmin, async (req, res) => {
  const tables = [...store.tables].sort((a, b) => a.sort_order - b.sort_order);
  const baseUrl = `${req.protocol}://${req.get("host")}`;

  // Load the store logo once (if the owner uploaded one from Admin >
  // 설정), to stamp into the center of every QR code below.
  const logoDataUri = await getLogoDataUri(store, getPhoto);

  const cards = await Promise.all(
    tables.map(async (t) => {
      const url = `${baseUrl}/t/${encodeURIComponent(t.number)}`;
      const svg = await buildQrSvg(url, logoDataUri);
      return `
        <div class="card">
          <div class="qr-wrap">
            <div class="table-no-badge">${t.label || t.number}</div>
            ${svg}
          </div>
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
  .qr-wrap { position: relative; width: 200px; height: 200px; }
  .qr-wrap svg { width: 200px; height: 200px; display: block; }
  .table-no-badge {
    position: absolute; top: -10px; left: -10px; min-width: 30px; height: 30px; padding: 0 6px;
    border-radius: 999px; background: #b5232c; color: #fff; font-size: 15px; font-weight: 800;
    display: flex; align-items: center; justify-content: center; border: 2px solid #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,0.3); z-index: 2;
  }
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
