const express = require("express");
const { store, save, nextId, findOrders, getDb, connectDB, findDocs, saveDoc } = require("../db");
const { requireOwner } = require("../auth");
const { computeSettlement, taipeiDateString } = require("../settlement");
const { recordStoreSize, sizeWarningLine, SETTING_BYTES } = require("../storeSize");
const { serviceStartedAt } = require("../serviceStart");
const { nowLocal } = require("../time");
const { sendLineMessage, formatSettlementSummary } = require("../line");

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
  const date = (req.body && req.body.date) || taipeiDateString();
  const snapshot = computeSettlement(await ordersInRange(date, date), date);
  // 스냅샷은 자기 컬렉션으로, store 문서는 번호 카운터 때문에 한 번.
  await Promise.all([saveSettlementSnapshot(snapshot), save()]);
  res.json(snapshot);
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

  if (store.settings.line_notify_enabled) {
    const lines = [formatSettlementSummary(snapshot)];
    const warn = sizeWarningLine(store.settings[SETTING_BYTES]);
    if (warn) lines.push("", warn);
    await sendLineMessage(store, lines.join("\n"));
  }

  res.json({ ok: true, date, problem_order_count: snapshot.problem_order_count });
});

module.exports = router;
