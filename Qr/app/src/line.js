const crypto = require("crypto");

// LINE Messaging API — sends the nightly closing summary (and manual test
// messages) to specific people only (the owner/parents), not everyone who
// happens to friend the Official Account. This uses the Push API with each
// person's userId, captured automatically the moment they friend the OA
// (see src/routes/lineWebhook.js's "follow" event handler) — no manual
// userId lookup needed on the owner's end.
async function sendLinePushToOne(token, userId, text) {
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to: userId, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `line_api_${res.status}`, detail };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: "network_error", detail: e.message };
  }
}

// Pushes to every owner-approved target (see line_targets — populated by
// the owner approving specific people by name in Admin, not blindly
// auto-registering anyone who friends the account). Returns ok:true only
// if at least one send succeeded.
async function sendLineMessage(store, text) {
  const token = store.settings.line_channel_access_token;
  const targets = store.settings.line_targets || [];
  if (!token) return { ok: false, error: "not_configured" };
  if (targets.length === 0) return { ok: false, error: "no_targets" };

  const results = await Promise.all(targets.map((t) => sendLinePushToOne(token, t.userId, text)));
  const anyOk = results.some((r) => r.ok);
  return anyOk ? { ok: true } : { ok: false, error: results[0]?.error || "unknown", detail: results[0]?.detail };
}

// Looks up a follower's display name/photo so the owner can recognize who's
// asking to be registered by name, instead of a meaningless opaque userId.
// (LINE's API has no way to look someone up by their personal @ID or phone
// number — a userId, and this profile info, only becomes available once
// they've actually interacted with the Official Account, e.g. by friending
// it — which is exactly the "follow" event this is called from.)
async function getLineProfile(token, userId) {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json(); // { userId, displayName, pictureUrl, statusMessage }
  } catch {
    return null;
  }
}

// Replies to whoever just friended the bot, using the one-time replyToken
// from the webhook event (free — doesn't count against push/broadcast
// quota) — simple confirmation so they know the connection worked.
async function replyLine(token, replyToken, text) {
  try {
    await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
    });
  } catch (e) {
    // Best-effort only — a failed confirmation reply shouldn't break the
    // webhook response LINE is waiting on.
  }
}

// Verifies the X-Line-Signature header LINE sends with every webhook
// request: HMAC-SHA256 of the raw request body, base64-encoded, using the
// channel secret. Must be computed over the exact raw bytes (not a
// re-serialized JSON.stringify(req.body), which can differ byte-for-byte).
function verifyLineSignature(channelSecret, rawBody, signatureHeader) {
  if (!channelSecret || !rawBody || !signatureHeader) return false;
  const expected = crypto.createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false; // length mismatch etc. — definitely not equal
  }
}

// Builds the Korean-language closing summary text from a computeSettlement()
// result — shared by the manual "지금 요약 보내기" test flow and the
// automatic nightly cron-close.
function formatSettlementSummary(snapshot) {
  const lines = [
    `📊 ${snapshot.date || `${snapshot.start_date} ~ ${snapshot.end_date}`} 마감 정산`,
    `매출: NT$${Number(snapshot.total_revenue || 0).toLocaleString()}`,
    `결제 완료: ${snapshot.paid_order_count}건`,
    `취소: ${snapshot.cancelled_order_count}건`,
  ];
  if (snapshot.problem_order_count > 0) {
    lines.push(`⚠️ 미결제/문제 주문: ${snapshot.problem_order_count}건`);
    const preview = snapshot.problem_orders.slice(0, 5).map((o) => `  - ${o.created_at.slice(11, 16)} ${o.table_number}번 테이블 NT$${o.total}`);
    lines.push(...preview);
    if (snapshot.problem_orders.length > 5) lines.push(`  ...외 ${snapshot.problem_orders.length - 5}건`);
  } else {
    lines.push("✅ 미결제 주문 없음");
  }
  return lines.join("\n");
}

module.exports = { sendLineMessage, replyLine, verifyLineSignature, formatSettlementSummary, getLineProfile };
