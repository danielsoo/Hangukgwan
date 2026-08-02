// backend/routes/geocode.js
const express = require('express');
const axios = require('axios');
const router = express.Router();

// 예: GET /api/geocode?address=서울
router.get('/', async (req, res) => {
  const address = req.query.address;
  if (!address) return res.status(400).json({ error: 'address query parameter is required' });

  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY not set in env' });

    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
    const { data } = await axios.get(url);

    if (data.status === 'OK' && data.results && data.results.length > 0) {
      const { lat, lng } = data.results[0].geometry.location;
      return res.json({ lat, lng, raw: data.results[0] });
    } else {
      return res.status(400).json({ error: 'geocoding failed', details: data });
    }
  } catch (err) {
    console.error('geocode error', err.message || err);
    res.status(500).json({ error: err.message || 'unknown error' });
  }
});

module.exports = router;
