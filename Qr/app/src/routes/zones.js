const express = require("express");
const { store, save, refreshAndSave, patchArrayItem, nextId } = require("../db");
const { requireAdmin, requirePermission } = require("../auth");
const canEditTables = requirePermission("tableEdit");

const router = express.Router();

router.get("/", requireAdmin, (req, res) => {
  res.json([...store.zones].sort((a, b) => a.sort_order - b.sort_order));
});

router.post("/", canEditTables, async (req, res) => {
  const { name, x, y, width, height } = req.body || {};
  // refreshAndSave (not save()) re-fetches right before creating — same
  // reasoning as tables.js's POST: narrows the window for a zone added from
  // a second admin tab/device at nearly the same moment to race with this
  // one and lose an update.
  let zone = null;
  await refreshAndSave((s) => {
    const maxSort = s.zones.reduce((m, z) => Math.max(m, z.sort_order), 0);
    zone = {
      id: nextId("zones"),
      name: name || `구역 ${s.zones.length + 1}`,
      x: Number(x) || 20,
      y: Number(y) || 20,
      width: Number(width) || 300,
      height: Number(height) || 240,
      sort_order: maxSort + 1,
    };
    s.zones.push(zone);
  });
  res.status(201).json(zone);
});

router.patch("/:id", canEditTables, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const zone = store.zones.find((z) => z.id === id);
  if (!zone) return res.status(404).json({ error: "not_found" });
  const { name, x, y, width, height } = req.body || {};
  // Targeted per-item update (see patchArrayItem() in src/db.js) instead of
  // save()'s full-document replace — same reasoning as tables.js's PATCH:
  // dragging/resizing zones on the 배치도 floor plan fires many of these in
  // quick succession, and two overlapping full-document saves can race and
  // silently undo each other.
  const updates = {};
  if (name != null) {
    zone.name = String(name).slice(0, 30);
    updates.name = zone.name;
  }
  if (x != null) {
    zone.x = Math.max(0, Number(x));
    updates.x = zone.x;
  }
  if (y != null) {
    zone.y = Math.max(0, Number(y));
    updates.y = zone.y;
  }
  if (width != null) {
    zone.width = Math.max(60, Number(width));
    updates.width = zone.width;
  }
  if (height != null) {
    zone.height = Math.max(60, Number(height));
    updates.height = zone.height;
  }
  if (Object.keys(updates).length) await patchArrayItem("zones", id, updates);
  res.json(zone);
});

router.delete("/:id", canEditTables, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await refreshAndSave((s) => {
    s.zones = s.zones.filter((z) => z.id !== id);
  });
  res.json({ ok: true });
});

module.exports = router;
