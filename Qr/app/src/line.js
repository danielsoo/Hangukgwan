// LINE Messaging API — sends the nightly closing summary (and manual test
// messages) as a broadcast, so the owner gets it as a normal LINE chat
// message without needing to open the admin dashboard. Broadcast (not push)
// is used deliberately: it only requires a channel access token, not a
// specific recipient user ID — for a personal-use Official Account where
// only the owner (and maybe family) has added it as a friend, that's exactly
// the audience we want, with much simpler setup (no user-ID lookup/webhook
// needed).
async function sendLineBroadcast(store, text) {
  const token = store.settings.line_channel_access_token;
  if (!token) return { ok: false, error: "not_configured" };

  try {
    const res = await fetch("https://api.line.me/v2/bot/message/broadcast", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ messages: [{ type: "text", text: text.slice(0, 4900) }] }),
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

module.exports = { sendLineBroadcast, formatSettlementSummary };
