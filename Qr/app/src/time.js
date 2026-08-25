// Centralized Taiwan-time helpers. Vercel (and most serverless hosts) run
// the process clock in UTC by default, with no TZ env var set — before this
// module existed, order timestamps were generated from the *host's* local
// time (see the old nowLocal() in orders.js), which silently meant every
// order/kitchen-ticket time shown to customers and staff was actually UTC,
// several hours off from real Taipei wall-clock time. Every timestamp and
// "which business day does this belong to" decision in the app should go
// through here instead of `new Date()` directly, so it's correct regardless
// of what timezone the server process itself happens to be running in.
const TZ = "Asia/Taipei";

function taipeiParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  if (map.hour === "24") map.hour = "00"; // some ICU implementations emit "24:00" for midnight
  return map;
}

// "YYYY-MM-DD HH:MM:SS" in Taipei time — same string format the rest of the
// app already expects for order created_at/updated_at.
function nowLocal(d = new Date()) {
  const p = taipeiParts(d);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

// "YYYY-MM-DD" business-day string in Taipei time.
function taipeiDateString(d = new Date()) {
  const p = taipeiParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

module.exports = { nowLocal, taipeiDateString };
