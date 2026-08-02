// Vercel entry point — Vercel auto-detects anything under /api as a
// serverless function. This just hands off to the same Express app used
// for local dev / Railway / Render, so there's only one copy of the app's
// logic to maintain.
module.exports = require("../server");
