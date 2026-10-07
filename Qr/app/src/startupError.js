// Converts an import-time server failure into a safe, actionable response.
// Never include the original error message in the HTTP body: MongoDB URI
// errors may contain credentials or other private deployment configuration.
function startupReason(error) {
  const name = String((error && error.name) || "");
  const message = String((error && error.message) || error || "");

  if (/MONGODB_URI is not set/i.test(message)) return "database_url_missing";
  if (
    name === "MongoParseError" ||
    /invalid (scheme|connection string|uri|url)/i.test(message) ||
    /mongodb:\/\/.*mongodb\+srv:\/\//i.test(message) ||
    /must (begin|start) with ["']?mongodb/i.test(message) ||
    /credentials?.*url.?encoded/i.test(message)
  ) {
    return "database_url_invalid";
  }
  return "server_start_failed";
}

function failedStartupHandler(error) {
  const reason = startupReason(error);
  return function startupFailed(req, res) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "server_not_ready", reason }));
  };
}

module.exports = { startupReason, failedStartupHandler };
