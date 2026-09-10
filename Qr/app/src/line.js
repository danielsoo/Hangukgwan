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

// 결제수단 이름 — 관리자 화면(public/js/admin.js)이 쓰는 것과 같은 말이어야
// 한다. 화면에서는 "현금"인데 문자에서는 "cash"로 오면 같은 표를 두 가지
// 말로 읽게 된다.
const PAYMENT_METHOD_NAMES = {
  cash: "현금",
  linepay: "LinePay",
  card: "신용카드",
  other: "기타",
  online: "온라인결제",
  unspecified: "미지정",
};

// 할인 종류 이름 — 결산 화면의 discountLabel 과 같은 말이어야 한다.
// 키는 src/discounts.js 의 discountTypeKey 가 만든다.
const DISCOUNT_NAMES = {
  te95: "特約95折",
  vip9: "VIP9折",
  vip95: "特約95折", // 옛 주문에 남아 있는 표기
  vip10: "VIP9折",
  manual: "직접 입력",
  unspecified: "미지정",
};

const nt = (n) => `NT$${Number(n || 0).toLocaleString()}`;
// "2026-09-10" → "9/10", "2026-09-10 21:07:31" → "21:07"
const shortDate = (d) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "");
const clockOf = (ts) => (ts && ts.length >= 16 ? ts.slice(11, 16) : "");

// 사장님 요청(2026-09-10): "오전 정산 오후 정산(하루 정산) 총 하루에 2개
// 있는데 오늘부터 받아볼 수 있나?" — 직원이 관리자 화면에서 「🌅 오전 정산」
// /「🌙 오후 정산」을 누른 그 자리에서 나가는 요약이다.
//
// 위 formatSettlementSummary(밤 크론용, 최소한만)와 달리 결제수단별 금액까지
// 넣는다. 마감에 서랍의 현금을 맞춰보는 것이 이 문자를 보는 이유라서다.
//
// opts:
//   shift    "am"(오전) | "day"(하루)
//   closedAt "YYYY-MM-DD HH:MM:SS" — 정산 버튼을 누른 시각
//   amPart   { revenue, count } — 하루 정산일 때만. 그날 오전 정산까지의 몫.
//   pmPart   { revenue, count } — 하루 정산일 때만. 그 뒤의 몫.
function formatShiftSummary(snapshot, opts = {}) {
  const isAm = opts.shift === "am";
  const clock = clockOf(opts.closedAt);
  const head = `${isAm ? "🌅" : "🌙"} ${shortDate(snapshot.date)} ${isAm ? "오전 정산" : "하루 정산"}${clock ? ` (${clock} 마감)` : ""}`;
  const lines = [head, `매출: ${nt(snapshot.total_revenue)}`];

  // 하루 정산에서는 오전/오후가 각각 얼마였는지 한 줄씩. 오전 정산을 누른
  // 적이 없는 날은 가를 기준이 없으므로 넣지 않는다 — 없는 경계를 지어내는
  // 것보다 안 보여주는 쪽이 낫다.
  if (!isAm && opts.amPart && opts.pmPart) {
    lines.push(`  오전 ${nt(opts.amPart.revenue)} (${opts.amPart.count}건)`);
    lines.push(`  오후 ${nt(opts.pmPart.revenue)} (${opts.pmPart.count}건)`);
  }

  // 어른·아이를 같이 적는다 (2026-09-10 사장님 요청). 문자는 한 줄이
  // 길어지면 폰에서 잘리므로 괄호 안에 짧게만 붙인다.
  const split =
    snapshot.adult_count != null && snapshot.child_count != null && snapshot.child_count > 0
      ? `(어른 ${snapshot.adult_count}·아이 ${snapshot.child_count})`
      : "";
  const guests = snapshot.guest_count ? ` · 손님 ${snapshot.guest_count}명${split}` : "";
  lines.push(`결제: ${snapshot.paid_order_count}건${guests}`);

  const methods = snapshot.payment_method_breakdown || [];
  if (methods.length) {
    lines.push("─ 결제수단");
    for (const m of methods) {
      lines.push(`  ${PAYMENT_METHOD_NAMES[m.method] || m.method} ${nt(m.revenue)} (${m.order_count}건)`);
    }
  }

  // 할인 — 사장님 요청(2026-09-10): "할인한 양이랑 그 중에 vip 카드 중 어떤
  // 거에서 할인, 그냥 직접 할인 등 그것도 결산 페이지랑 보고에 들어갔으면
  // 좋겠어." 종류별로 한 줄씩.
  if (snapshot.discount_total) {
    lines.push(`─ 할인 -${nt(snapshot.discount_total)}`);
    for (const d of snapshot.discount_breakdown || []) {
      lines.push(`  ${DISCOUNT_NAMES[d.discount_type] || d.discount_type} -${nt(d.amount)} (${d.order_count}건)`);
    }
  }

  // VIP 카드가 적자인지 흑자인지 — 판 돈에서 그 카드들이 깎아준 돈을 뺀 것.
  // 카드도 안 팔리고 카드 할인도 없었으면 넣지 않는다.
  const vip = snapshot.vip_card_program;
  if (vip && (vip.cards_sold || vip.card_discount_given)) {
    lines.push("─ VIP 카드");
    const sold = vip.cards_sold ? `판매 ${nt(vip.card_sales_revenue)} (${vip.cards_sold}장)` : "판매 없음";
    lines.push(`  ${sold} · 할인 -${nt(vip.card_discount_given)}`);
    lines.push(`  차액 ${vip.net >= 0 ? "+" : "-"}${nt(Math.abs(vip.net))}`);
  }

  if (snapshot.cancelled_order_count) lines.push(`취소: ${snapshot.cancelled_order_count}건`);

  // 미결제는 맨 아래. 돈이 빠져나간 자리라 눈에 걸려야 한다.
  if (snapshot.problem_order_count > 0) {
    lines.push(`⚠️ 미결제/문제 주문: ${snapshot.problem_order_count}건 (${nt(snapshot.problem_amount)})`);
    const preview = (snapshot.problem_orders || [])
      .slice(0, 5)
      .map((o) => `  - ${o.created_at.slice(11, 16)} ${o.table_number}번 테이블 ${nt(o.total)}`);
    lines.push(...preview);
    if ((snapshot.problem_orders || []).length > 5) lines.push(`  ...외 ${snapshot.problem_orders.length - 5}건`);
  } else {
    lines.push("✅ 미결제 주문 없음");
  }
  return lines.join("\n");
}

module.exports = {
  sendLineMessage,
  replyLine,
  verifyLineSignature,
  formatSettlementSummary,
  formatShiftSummary,
  getLineProfile,
  PAYMENT_METHOD_NAMES,
  DISCOUNT_NAMES,
};
