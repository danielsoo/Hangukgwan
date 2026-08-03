const express = require("express");
const { store, save, nextId } = require("../db");
const { requireAdmin } = require("../auth");

const router = express.Router();

router.get("/", requireAdmin, (req, res) => {
  res.json([...store.zones].sort((a, b) => a.sort_order - b.sort_order));
});

router.post("/", requireAdmin, async (req, res) => {
  const { name, x, y, width, height } = req.body || {};
  const maxSort = store.zones.reduce((m, z) => Math.max(m, z.sort_order), 0);
  const zone = {
    id: nextId("zones"),
    name: name || `구역 ${store.zones.length + 1}`,
    x: Number(x) || 20,
    y: Number(y) || 20,
    width: Number(width) || 300,
    height: Number(height) || 240,
    sort_order: maxSort + 1,
  };
  store.zones.push(zone);
  await save();
  res.status(201).json(zone);
});

router.patch("/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const zone = store.zones.find((z) => z.id === id);
  if (!zone) return res.status(404).json({ error: "not_found" });
  const { name, x, y, width, height } = req.body || {};
  if (name != null) zone.name = String(name).slice(0, 30);
  if (x != null) zone.x = Math.max(0, Number(x));
  if (y != null) zone.y = Math.max(0, Number(y));
  if (width != null) zone.width = Math.max(60, Number(width));
  if (height != null) zone.height = Math.max(60, Number(height));
  await save();
  res.json(zone);
});

router.delete("/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  store.zones = store.zones.filter((z) => z.id !== id);
  await save();
  res.json({ ok: true });
});

module.exports = router;
