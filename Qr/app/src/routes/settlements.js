const express = require("express");
const { store, save, nextId, findOrders, getDb, connectDB, findDocs, saveDoc } = require("../db");
const { requireOwner, requireAdmin } = require("../auth");
const { computeSettlement, taipeiDateString } = require("../settlement");
const { recordStoreSize, sizeWarningLine, SETTING_BYTES } = require("../storeSize");
const { serviceStartedAt } = require("../serviceStart");
const { nowLocal } = require("../time");
const { sendLineMessage, formatSettlementSummary, formatShiftSummary } = require("../line");
const testMode = require("../testMode");

const router = express.Router();

// 마감 스냅샷도 자기 컬렉션에 산다(src/db.js) — 하루에 한 줄씩 영원히
// 쌓이는 것이라 store 문서에 두면 계속 커진다. 같은 날짜를 다시 닫으면
// 새로 만들지 않고 덮어쓴다.
async function saveSettlementSnapshot(snapshot) {
  const [existing] = await findDocs("daily_settlements", { date: snapshot.date });
  const row = existing
    ? { ...existing, ...snapshot }
    : { id: nextId("daily_settlements"), ...snapshot };
  await saveDoc("daily_settlements", row);
  return row;
}

// Settlement shows real revenue numbers, so — like 주문 취소 — it's treated
// as sensitive business data and kept owner-only rather than gated behind a
// staff-permission toggle.

// Live view for a single date or a date range (defaults to today, Taipei
// time). Always computed fresh from current orders — this is what the 결산
// tab shows when opened, so the owner never has to press a button to "do"
// the settlement. Accepts either ?date=YYYY-MM-DD (single day) or
// ?start=YYYY-MM-DD&end=YYYY-MM-DD (inclusive range, e.g. "이번 주").
router.get("/", requireOwner, async (req, res) => {
  const today = taipeiDateString();
  const start = req.query.start || req.query.date || today;
  const end = req.query.end || req.query.date || start;
  // 메모리의 store.orders 는 최근 며칠치뿐이다(src/db.js) — 지난 달 결산을
  // 뽑으려면 그 날짜 범위를 직접 질의해야 한다. created_at 이 "YYYY-MM-DD
  // HH:MM:SS" 라 문자열 범위로 그대로 걸린다(끝날짜는 그 날 23:59:59까지).
  const orders = await ordersInRange(start, end);
  res.json(computeSettlement(orders, start, end));
});

// 결산이 볼 주문을 날짜 범위로 가져온다. 인덱스는 created_at 에 걸려 있다
// (src/migrations/2026-09-10-orders-collection.js).
function ordersInRange(start, end) {
  // 영업 시작 전(=테스트) 주문은 매출에 넣지 않는다. 사장님(2026-09-10):
  // "9월 8일 저녁부터 실제로 시행... 그 전까지는 전부 테스트였고."
  // 시작 시각이 범위 안에 걸치면 그 시각부터 센다(그날 낮의 테스트와 그날
  // 저녁의 첫 손님을 갈라야 한다).
  const from = `${start} 00:00:00`;
  const started = serviceStartedAt(store);
  return findOrders({
    // 테스터 모드로 넣은 주문은 매출이 아니다(src/testMode.js). 테스트
    // 기기에서 결산을 열더라도 여기서는 뺀다 — 장부는 한 가지 숫자만
    // 말해야 하고, 그 숫자가 보는 기기에 따라 달라지면 그건 장부가 아니다.
    test_session: { $exists: false },
    created_at: { $gte: started && started > from ? started : from, $lte: `${end} 23:59:59` },
  });
}

// Permanent nightly snapshots (written by the cron job below, or manually
// via POST /close) — kept in case orders are later edited/pruned and the
// live numbers for an old date would otherwise drift from what actually
// closed that night.
router.get("/history", requireOwner, async (req, res) => {
  const list = await findDocs("daily_settlements", {}, { sort: { date: -1 }, limit: 90 });
  res.json(list);
});

// Manually snapshot a given date (defaults to today) into permanent history.
// Safe to call more than once for the same date — replaces any existing
// snapshot for that date rather than duplicating it.
router.post("/close", requireOwner, async (req, res) => {
  // 테스터 모드에서는 마감을 하지 않는다(src/testMode.js).
  //
  // 마감은 테스트로 눌러볼 수 있는 종류의 버튼이 아니다. 그날 장부를 확정해
  // 영구 기록으로 박고, 직원들 LINE 으로 마감 알림까지 나간다. 영업 중에
  // 눌리면 장부가 어긋나고 직원들이 마감인 줄 안다.
  //
  // 결산 **화면**은 테스트 기기에서도 그대로 볼 수 있다 — 막는 것은
  // 확정하는 이 한 번뿐이다.
  if (testMode.isTest(req, store)) {
    return res.status(403).json({ error: "test_mode_no_close" });
  }
  const date = (req.body && req.body.date) || taipeiDateString();
  const snapshot = computeSettlement(await ordersInRange(date, date), date);
  // 스냅샷은 자기 컬렉션으로, store 문서는 번호 카운터 때문에 한 번.
  await Promise.all([saveSettlementSnapshot(snapshot), save()]);
  res.json(snapshot);
});

// 한 주문이 실제로 결제된 시각. 부분 결제(품목별)로 나눠 낸 라운드는
// 마지막 품목이 결제된 때를 그 주문의 결제 시각으로 본다 — 그 전에는 아직
// 받을 돈이 남아 있었다. 옛 주문이나 한 번에 결제된 주문은 updated_at.
function paidAtOf(order) {
  const stamps = (order.items || []).map((it) => it.paid_at).filter(Boolean);
  if (stamps.length) return stamps.sort().pop();
  return order.updated_at || order.created_at;
}

// 사장님 요청(2026-09-10): "현재 line 으로 결산 보내주는 기능이 있기는 한데
// 한 번도 사용한 적은 없어... 이제 오전 정산 오후 정산(하루 정산) 총 하루에
// 2개 있는데 오늘부터 받아볼 수 있나?"
//
// 관리자 화면 주문판의 「🌅 오전 정산」/「🌙 오후 정산」 버튼이 여기로 온다.
// 밤 크론(아래 cron-close)과 달리 **직원이 실제로 정산한 그 순간** 나가므로,
// 문자의 숫자와 그때 서랍에 있는 돈이 같은 시점을 가리킨다.
//
// requireOwner 가 아니라 requireAdmin 인 이유: 정산 버튼은 직원도 누른다
// (public/admin.html 의 settle-quick-btn 은 owner-only 가 아니다). 예전에는
// 이 버튼이 owner 전용인 POST /close 를 불러서, 직원이 누르면 마감 스냅샷이
// 조용히 실패했다. 매출 숫자 자체는 응답으로 돌려주되, 그건 이미 그 화면의
// 결제완료 칼럼에서 직원이 보고 있는 값이라 새로 새는 정보가 없다.
router.post("/shift-close", requireAdmin, async (req, res) => {
  // 마감은 테스트로 눌러볼 수 있는 버튼이 아니다 — 위 POST /close 와 같은
  // 이유. 여기는 LINE 문자까지 나가므로 더더욱.
  if (testMode.isTest(req, store)) {
    return res.status(403).json({ error: "test_mode_no_close" });
  }
  const shift = req.body && req.body.shift === "am" ? "am" : "day";
  const date = taipeiDateString();
  const closedAt = nowLocal();
  const orders = await ordersInRange(date, date);
  const snapshot = computeSettlement(orders, date);

  // 오전 정산이 누른 시각을 그날 스냅샷에 남긴다. 하루 정산이 오전/오후를
  // 가르는 기준이 이것이다 — 영업시간표를 보고 "오전은 14시까지" 라고
  // 짐작하는 것보다, 실제로 정산을 누른 시각이 정확하다(14시 20분에 눌렀으면
  // 14시 10분 결제는 오전 몫이다).
  const [prev] = await findDocs("daily_settlements", { date });
  const amClosedAt = shift === "am" ? closedAt : (prev && prev.am_closed_at) || null;
  await saveSettlementSnapshot({ ...snapshot, am_closed_at: amClosedAt, last_shift_closed_at: closedAt });
  await save();

  // 하루 정산이면 오전 몫과 오후 몫을 갈라 한 줄씩 보여준다. 오전 정산을
  // 누른 적 없는 날은 가를 기준이 없으므로 통짜로 둔다.
  let amPart = null;
  let pmPart = null;
  if (shift === "day" && amClosedAt) {
    const paid = orders.filter((o) => o.status === "paid");
    const amPaid = paid.filter((o) => paidAtOf(o) <= amClosedAt);
    const amRevenue = amPaid.reduce((sum, o) => sum + (o.total || 0), 0);
    amPart = { revenue: amRevenue, count: amPaid.length };
    // 오후는 빼서 구한다 — 따로 더하면 반올림이나 경계 판정이 어긋났을 때
    // 오전+오후가 하루 매출과 안 맞는 문자가 나간다.
    pmPart = { revenue: snapshot.total_revenue - amRevenue, count: paid.length - amPaid.length };
  }

  let line = { sent: false, error: "disabled" };
  if (store.settings.line_notify_enabled) {
    const lines = [formatShiftSummary(snapshot, { shift, closedAt, amPart, pmPart })];
    const warn = sizeWarningLine(store.settings[SETTING_BYTES]);
    if (warn) lines.push("", warn);
    const result = await sendLineMessage(store, lines.join("\n"));
    line = result.ok ? { sent: true } : { sent: false, error: result.error };
  }

  res.json({
    ok: true,
    shift,
    date,
    closed_at: closedAt,
    total_revenue: snapshot.total_revenue,
    paid_order_count: snapshot.paid_order_count,
    problem_order_count: snapshot.problem_order_count,
    am_part: amPart,
    pm_part: pmPart,
    line,
  });
});

// Sends a one-off test message using whatever LINE settings are currently
// saved, so the owner can confirm the channel access token actually works
// right after entering it, instead of waiting until the next cron run.
router.post("/line-test", requireOwner, async (req, res) => {
  const result = await sendLineMessage(store, "✅ 한국관 어드민 LINE 알림 테스트입니다. 이 메시지가 보이면 마감 자동 알림이 정상적으로 연결된 거예요!");
  if (!result.ok) return res.status(400).json(result);
  res.json({ ok: true });
});

// Hit once a day by Vercel Cron (see vercel.json) shortly after closing time
// to snapshot *today's* business day automatically — this is the "영업
// 시간이 끝나면 자동으로 결산" part. Vercel signs cron requests with an
// `Authorization: Bearer $CRON_SECRET` header when CRON_SECRET is set as an
// env var; there's no browser session on a cron request, so this can't use
// requireOwner/requireAdmin like the routes above.
router.get("/cron-close", async (req, res) => {
  if (process.env.CRON_SECRET) {
    const header = req.get("authorization") || "";
    if (header !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }
  const date = taipeiDateString();
  const snapshot = computeSettlement(await ordersInRange(date, date), date);
  await saveSettlementSnapshot(snapshot);

  // 사장님(2026-09-10): "3-4년 후에 내가 잊으면 큰일이잖아."
  // 매일 밤 여기서 store 문서 크기를 재둔다. 기준을 넘으면 관리자 화면에
  // 띠가 뜨고 아래 마감 메시지에도 한 줄이 붙는다 — 사람이 달력에 적어두고
  // 기억할 일이 아니다(src/storeSize.js).
  await recordStoreSize(store, { getDb, connectDB, nowLocal });
  await save();

  // 2026-09-10부터 마감 문자는 직원이 정산 버튼을 누를 때 나간다(위
  // shift-close). 이 크론은 예비다 — 그날 정산을 누른 적이 있으면 같은
  // 내용을 한 번 더 보내지 않는다. 사장님이 받기로 한 건 하루에 두 통
  // (오전·하루)이지 세 통이 아니다.
  const [todaySnapshot] = await findDocs("daily_settlements", { date });
  const alreadyClosedByHand = !!(todaySnapshot && todaySnapshot.last_shift_closed_at);
  if (store.settings.line_notify_enabled && !alreadyClosedByHand) {
    const lines = [formatSettlementSummary(snapshot)];
    const warn = sizeWarningLine(store.settings[SETTING_BYTES]);
    if (warn) lines.push("", warn);
    await sendLineMessage(store, lines.join("\n"));
  }

  res.json({ ok: true, date, problem_order_count: snapshot.problem_order_count, line_skipped: alreadyClosedByHand });
});

module.exports = router;
