// Vercel entry point — Vercel auto-detects anything under /api as a
// serverless function. This just hands off to the same Express app used
// for local dev / Railway / Render, so there's only one copy of the app's
// logic to maintain.
//
// Keep a bad production environment variable from crashing before Vercel can
// return a useful response.  In particular, connect-mongo creates its client
// while `server.js` is imported, so a missing/malformed MONGODB_URI used to
// become Vercel's opaque FUNCTION_INVOCATION_FAILED page.  The response below
// deliberately exposes only a small category, never the URI or exception
// message.  The app still refuses all work until the configuration is fixed.
const { failedStartupHandler, startupReason } = require("../src/startupError");

try {
  module.exports = require("../server");
} catch (error) {
  const reason = startupReason(error);
  // Do not print error.message here: Mongo parse errors can repeat part of a
  // connection string, which may contain the database password.
  console.error(`Server startup failed [${reason}] (${error && error.name ? error.name : "Error"})`);
  module.exports = failedStartupHandler(error);
}
