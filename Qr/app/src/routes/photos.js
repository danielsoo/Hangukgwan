const express = require("express");
const { getPhoto } = require("../db");

const router = express.Router();

// Serves photos stored in MongoDB (see src/db.js) — used for both menu item
// photos and the store cover photo. Public, no auth needed: these are just
// menu photos, not sensitive.
router.get("/:id", async (req, res) => {
  const photo = await getPhoto(req.params.id);
  if (!photo || !photo.data) return res.status(404).end();
  const buffer = Buffer.isBuffer(photo.data) ? photo.data : Buffer.from(photo.data.buffer || photo.data);
  res.set("Content-Type", photo.contentType || "image/jpeg");
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.send(buffer);
});

module.exports = router;
