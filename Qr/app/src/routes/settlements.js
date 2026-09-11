const express = require("express");
const { store, save, nextId, findOrders, getDb, connectDB, findDocs, saveDoc, saveOrders } = require("../db");
const { requireOwner, requireAdmin, requireTodayForStaff } = require("../auth");
const { computeSettlement, taipeiDateString, paidAtOf, halfOf } = require("../settlement");
const { serviceCutAt, serviceCutHm } = require("../servicePeriod");
const { recordStoreSize, sizeWarningLine, SETTING_BYTES } = require("../storeSize");
const { serviceStartedAt } = require("../serviceStart");
const { clearIdleSeats } = require("../partySize");
const { nowLocal } = require("../time");
const { sendLineMessage, formatSettlementSummary, formatShiftSummary } = require("../line");
const testMode = require("../testMode");

const router = express.Router();

// 마감 스냅샷도 자기 컬렉션에 산다(src/db.js) — 하루에 한 줄씩 영원히
// 쌓이는 것이라 store 문서에 두면 계속 커진다. 같은 날짜를 다시 닫으면
// 새로 만들지 않고 덮어쓴다.
// testId 가 있으면 그 테스트 세션의 스냅샷으로 따로 저장한다.
//
// 같은 날짜라도 진짜 마감과 테스트 마감은 **다른 줄**이어야 한다. 한 줄을
// 나눠 쓰면 테스터 모드를 끄면서 그 줄을 지울 때 그날의 진짜 마감까지 같이
// 사라진다. 장부에서 하루가 통째로 없어지는 것이라 되돌릴 방법이 없다.
async function saveSettlementSnapshot(snapshot, testId) {
  const key = testId
    ? { date: snapshot.date, test_session: testId }
    : { date: snapshot.date, test_session: { $exists: false } };
  const [existing] = await findDocs("daily_settlements", key);
  const row = existing
    ? { ...existing, ...snapshot }
    : { id: nextId("daily_settlements"), ...snapshot, ...(testId ? { test_session: testId } : {}) };
  await saveDoc("daily_settlements", row);
  return row;
}

// Settlement shows real revenue numbers, so it's treated as sensitive
// business data: 직원은 오늘 하루만, 지난 기록(/history)과 마감 저장(/close)은
// 사장님만. 역할로 가르고 staff-permission 스위치로는 열지 않는다.

// Live view for a single date or a date range (defaults to today, Taipei
// time). Always computed fresh from current orders — this is what the 결산
// tab shows when opened, so the owner never has to press a button to "do"
// the settlement. Accepts either ?date=YYYY-MM-DD (single day) or
// ?start=YYYY-MM-DD&end=YYYY-MM-DD (inclusive range, e.g. "이번 주").
/**
 * 결산 — 직원도 볼 수 있다. 다만 **오늘 하루만**.
 *
 * 사장님(2026-09-11): "결산은 현재 사장만 볼 수 있는데 직원이 볼 수 있는 건
 * 결산탭에서 해당 하루만 볼 수 있게 해주고 지난 정산 추이처럼 전 데이터를
 * 읽어오는 건 직원은 못 보게 해줘."
 *
 * 직원이 지난 날짜를 물어보면 **거절한다**(requireTodayForStaff, src/auth.js).
 * 처음에는 조용히 오늘로 바꿔치기했는데, 그러면 어제 날짜를 쳐 넣은 사람에게
 * 「어제 화면인 척하는 오늘 숫자」가 돌아간다 — 그걸 어제 매출로 읽으면
 * 조용히 틀린 숫자를 믿게 된다. 사장님(2026-09-11): "직원 로그인으로는 쳐도
 * 안나오게 해줘. 직원은 오늘 것만 알면 되지 전체적으로는 몰라야돼."
 *
 * 화면에서 날짜 칸을 감추는 것만으로는 막은 것이 아니다 — 주소창에
 * ?start=2026-08-01&end=2026-09-11 을 쳐 넣으면 그만이다. 막는 자리는 서버
 * 한 곳이어야 한다.
 *
 * 지난 정산 기록(/history)과 기록 저장(/close)은 아래에서 사장님 전용 그대로다.
 */
router.get("/", requireAdmin, requireTodayForStaff, async (req, res) => {
  const today = taipeiDateString();
  const isOwner = !!(req.session && req.session.role === "owner");
  const start = isOwner ? req.query.start || req.query.date || today : today;
  const end = isOwner ? req.query.end || req.query.date || start : today;
  // 메모리의 store.orders 는 최근 며칠치뿐이다(src/db.js) — 지난 달 결산을
  // 뽑으려면 그 날짜 범위를 직접 질의해야 한다. created_at 이 "YYYY-MM-DD
  // HH:MM:SS" 라 문자열 범위로 그대로 걸린다(끝날짜는 그 날 23:59:59까지).
  const orders = await ordersInRange(start, end, req);
  // 「오전만 보기」 / 「오후만 보기」. 없으면 하루 전체(합산)다.
  //
  // 화면에서 거르지 않고 여기서 거른다 — 결제수단, 분류별, 시간대, 테이블별,
  // 차트가 전부 이 한 번의 거르기를 따라간다. 화면에서 조각조각 거르면 어느
  // 하나를 빠뜨리고, 그 칸만 조용히 하루치를 보여준다.
  const shift = req.query.shift === "am" || req.query.shift === "pm" ? req.query.shift : null;
  const opts = await halfOpts(start, end, req);
  res.json(
    Object.assign(computeSettlement(orders, start, end, { ...opts, shift, menu: menuForSettlement() }), {
      // 「전체 기간」 버튼이 시작일로 쓸 날짜 (아래 allTimeStartDate).
      // 직원에게는 어차피 오늘뿐이라 계산하지 않는다.
      all_time_start: isOwner ? await allTimeStartDate(req) : null,
      // 화면이 「오늘 것만 보입니다」를 띄우는 데 쓴다. 화면을 믿고 막는 게
      // 아니라, 이미 막아놓고 그 사실을 알려주는 것뿐이다.
      today_only: !isOwner,
    })
  );
});

/**
 * 오전/오후를 가르는 데 필요한 것들 (src/settlement.js halfBoundaryFor).
 *
 * 날짜마다 「그날 오전 정산을 누른 시각」을 모아 넘긴다. 안 누른 날을 위해
 * 저녁 영업이 시작하는 시각도 같이 넘긴다 — 이 가게는 점심·저녁 두 타임이라
 * 그 사이 공백이 자연스러운 경계다.
 */
/**
 * 「전체 기간」의 시작일.
 *
 * 사장님(2026-09-11): "기간을 전체로도 선택할 수 있게 해줘."
 *
 * 「전체」가 어디서부터인지는 화면이 알 수 없다. 그래서 서버가 정해서
 * 내려준다 — **영업 시작일**이다(src/serviceStart.js). 그 전 주문은 어떤
 * 기간을 골라도 매출에서 빠지므로, 더 앞으로 잡아봐야 0 만 늘어난다.
 *
 * 영업 시작을 아직 안 정했으면 가장 오래된 주문 날짜로 잡는다. 이때만
 * 질의가 한 번 더 나간다 — 정해져 있는 평소에는 store 안의 값 하나를
 * 읽는 것이 전부다.
 */
async function allTimeStartDate(req) {
  const started = serviceStartedAt(store);
  if (started) return started.slice(0, 10);
  const testId = testMode.currentId(req, store);
  const [first] = await findOrders(
    { test_session: testId ? testId : { $exists: false } },
    { sort: { created_at: 1 }, limit: 1 }
  );
  return first && first.created_at ? String(first.created_at).slice(0, 10) : taipeiDateString();
}

/**
 * 「안 팔린 메뉴」를 세려면 지금 메뉴판에 무엇이 있는지를 알아야 한다
 * (src/settlement.js 의 unsoldItems 주석).
 *
 * 마감 스냅샷(POST /close, 밤 크론)에는 안 넘긴다. 스냅샷은 그날의 장부라
 * 작고 변하지 않아야 하는데, 여기에 메뉴 40~50줄을 매일 같이 적어 넣으면
 * 하루치가 통째로 커지고, 게다가 「그날의 메뉴」가 아니라 「저장을 누른
 * 시점의 메뉴」가 박힌다. 안 팔린 메뉴는 지금 화면에서 보는 것으로 족하다.
 *
 * 화면에 그대로 쓰일 값만 골라 넘긴다 — 여기서 안 거르면 사진 URL 과 옵션
 * 정의까지 따라가서, 결산을 열 때마다 안 쓰는 수백 KB 가 오간다.
 */
function menuForSettlement() {
  const catById = new Map((store.categories || []).map((c) => [c.id, c]));
  const orderOf = (m) => {
    const c = catById.get(m.category_id);
    return [(c && c.sort_order) || 999, m.sort_order || 0, m.id];
  };
  return [...(store.menuItems || [])]
    .sort((a, b) => {
      const x = orderOf(a);
      const y = orderOf(b);
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    })
    .map((m) => ({
      id: m.id,
      code: m.code || null,
      name_ko: m.name_ko,
      name_zh: m.name_zh,
      name_en: m.name_en,
      price: m.price,
      category_key: (catById.get(m.category_id) || {}).key || null,
      // 품절이면 「안 팔린」 것이 아니라 **못 판** 것이다. 화면에서 그렇게
      // 갈라 보여줘야 사장님이 메뉴를 뺄지 말지를 제대로 판단한다.
      available: m.available !== 0,
    }));
}

async function halfOpts(start, end, req) {
  const testId = testMode.currentId(req, store);
  const snaps = await findDocs("daily_settlements", {
    date: { $gte: start, $lte: end },
    ...(testId ? { test_session: testId } : { test_session: { $exists: false } }),
  });
  const amClosedAt = {};
  for (const d of snaps || []) if (d && d.date && d.am_closed_at) amClosedAt[d.date] = d.am_closed_at;
  return { amClosedAt, eveningStartsAt: eveningStartHm() };
}

/**
 * 결산이 옛 주문(「오전/오후」 표가 없는 것)을 가를 때 쓸 시각 "HH:MM".
 * 주문에 표를 박는 것과 같은 기준을 쓴다 — src/servicePeriod.js 한 곳이다.
 */
function eveningStartHm() {
  return serviceCutHm(store.settings, taipeiDateString());
}

// 결산이 볼 주문을 날짜 범위로 가져온다. 인덱스는 created_at 에 걸려 있다
// (src/migrations/2026-09-10-orders-collection.js).
function ordersInRange(start, end, req) {
  // 영업 시작 전(=테스트) 주문은 매출에 넣지 않는다. 사장님(2026-09-10):
  // "9월 8일 저녁부터 실제로 시행... 그 전까지는 전부 테스트였고."
  // 시작 시각이 범위 안에 걸치면 그 시각부터 센다(그날 낮의 테스트와 그날
  // 저녁의 첫 손님을 갈라야 한다).
  const from = `${start} 00:00:00`;
  const started = serviceStartedAt(store);
  // 테스터 모드(src/testMode.js): 테스트 기기는 **테스트 주문만** 본다.
  //
  // 주문판과는 규칙이 다르다. 주문판에서는 테스트 기기도 진짜 주문을 같이
  // 본다 — 테스트하는 동안에도 손님은 오고 그 주문을 놓치면 안 되니까.
  // 결산은 반대다. 진짜 매출과 테스트 금액이 한 숫자로 섞이면 그 숫자는
  // 아무 뜻이 없고, 사장님이 그걸 진짜 매출로 볼 위험이 생긴다. 테스트
  // 기기의 결산은 방금 넣어본 테스트 주문만의 깨끗한 모래상자다.
  //
  // 평소 기기는 언제나 진짜만 본다. 그건 어떤 경우에도 안 바뀐다.
  const testId = testMode.currentId(req, store);
  return findOrders({
    test_session: testId ? testId : { $exists: false },
    created_at: { $gte: started && started > from ? started : from, $lte: `${end} 23:59:59` },
  });
}

/**
 * 메뉴 하나가 날마다 몇 개씩 팔렸나.
 *
 * 사장님(2026-09-11): "각 메뉴가 결산 날에 따라 팔리는 추이를 그래프로
 * 라인차트를 각 메뉴별로 선택하면 볼 수 있게 하면 좋을 것 같은데?"
 *
 * 결산 응답에 끼워 넣지 않고 **따로 받아온다.** 51가지 × 30일이면 1,500줄인데,
 * 결산 화면을 열 때마다 그걸 같이 보내면 정작 매일 보는 숫자들이 그만큼
 * 늦게 뜬다. 한 가지를 골랐을 때만 그 한 줄을 가져오는 편이 싸다.
 *
 * **날짜를 빠짐없이 채워 보낸다.** 안 팔린 날을 빼고 보내면 선이 그 구간을
 * 건너뛰어서, 「그날은 0개」가 「그날은 없던 날」처럼 그려진다. 추이를 보는
 * 이유가 바로 안 팔린 구간을 찾는 것인데 그게 안 보이면 소용이 없다.
 *
 * requireOwner — 여러 날에 걸친 것이라 직원에게는 애초에 열 수 없는 화면이다
 * (src/auth.js requireTodayForStaff 와 같은 이유).
 */
router.get("/item-trend", requireOwner, async (req, res) => {
  const q = req.query || {};
  const valid = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");
  const today = taipeiDateString();
  const start = valid(q.start) ? q.start : today;
  const end = valid(q.end) && q.end >= start ? q.end : start;
  const itemId = String(q.item_id == null ? "" : q.item_id);
  if (!itemId) return res.status(400).json({ error: "item_id_required" });
  // 너무 긴 범위는 막는다 — 선이 촘촘해져서 읽지도 못하고, 몽고만 오래 돈다.
  if (dayCount(start, end) > 400) return res.status(400).json({ error: "range_too_long" });

  const orders = await ordersInRange(start, end, req);
  const shift = q.shift === "am" || q.shift === "pm" ? q.shift : null;
  const opts = shift ? await halfOpts(start, end, req) : null;
  const byDate = new Map();
  for (const o of orders) {
    if (o.status !== "paid") continue;
    if (shift && halfOf(o, opts) !== shift) continue;
    for (const it of o.items || []) {
      if (String(it.item_id) !== itemId) continue;
      const d = String(o.created_at).slice(0, 10);
      const prev = byDate.get(d) || { qty: 0, subtotal: 0 };
      prev.qty += it.qty;
      prev.subtotal += it.unit_price * it.qty;
      byDate.set(d, prev);
    }
  }
  const points = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const hit = byDate.get(d) || { qty: 0, subtotal: 0 };
    points.push({ date: d, qty: hit.qty, subtotal: hit.subtotal });
  }
  const item = (store.menuItems || []).find((m) => String(m.id) === itemId) || null;
  res.json({
    item_id: itemId,
    name_ko: item ? item.name_ko : null,
    name_zh: item ? item.name_zh : null,
    start_date: start,
    end_date: end,
    total_qty: points.reduce((s, p) => s + p.qty, 0),
    points,
  });
});

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dayCount(start, end) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
}

// Permanent nightly snapshots (written by the cron job below, or manually
// via POST /close) — kept in case orders are later edited/pruned and the
// live numbers for an old date would otherwise drift from what actually
// closed that night.
router.get("/history", requireOwner, async (req, res) => {
  // 결산과 같은 규칙(위 ordersInRange 주석) — 테스트 기기는 테스트 마감만,
  // 평소 기기는 진짜 마감만. 한 화면에 섞이면 어느 줄이 진짜 장부인지
  // 알 수 없게 된다.
  const testId = testMode.currentId(req, store);
  const list = await findDocs(
    "daily_settlements",
    { test_session: testId ? testId : { $exists: false } },
    { sort: { date: -1 }, limit: 90 }
  );
  res.json(list);
});

// Manually snapshot a given date (defaults to today) into permanent history.
// Safe to call more than once for the same date — replaces any existing
// snapshot for that date rather than duplicating it.
router.post("/close", requireOwner, async (req, res) => {
  // 테스터 모드에서도 마감이 된다(2026-09-10 사장님: "결산이랑 주문까지
  // 구현되게 해줘"). 다만 찍히는 것은 **테스트 세션의 스냅샷**이다 —
  // 그날의 진짜 마감과는 다른 줄이고, 테스터 모드를 끄면 같이 사라진다.
  // 진짜 장부는 손대지 않는다.
  const testId = testMode.currentId(req, store);
  const date = (req.body && req.body.date) || taipeiDateString();
  const snapshot = computeSettlement(await ordersInRange(date, date, req), date);
  // 스냅샷은 자기 컬렉션으로, store 문서는 번호 카운터 때문에 한 번.
  await Promise.all([saveSettlementSnapshot(snapshot, testId), save()]);
  res.json({ ...snapshot, ...(testId ? { test_session: testId } : {}) });
});

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
  // 테스터 모드에서도 정산이 된다. 숫자와 화면은 진짜와 똑같이 돌아가되
  // 두 가지가 다르다(아래):
  //   · 스냅샷이 테스트 세션 것으로 따로 찍히고, 끄면 같이 사라진다
  //   · **LINE 문자는 안 나간다** — 직원 폰으로 가는 것이라 시험으로
  //     보낼 수 없다. 직원이 마감인 줄 알고 움직인다.
  const testId = testMode.currentId(req, store);
  const shift = req.body && req.body.shift === "am" ? "am" : "day";
  const date = taipeiDateString();
  const closedAt = nowLocal();
  const orders = await ordersInRange(date, date, req);
  const snapshot = computeSettlement(orders, date, date, await halfOpts(date, date, req));

  // 오전 정산이 누른 시각을 그날 스냅샷에 남긴다. 하루 정산이 오전/오후를
  // 가르는 기준이 이것이다 — 영업시간표를 보고 "오전은 14시까지" 라고
  // 짐작하는 것보다, 실제로 정산을 누른 시각이 정확하다(14시 20분에 눌렀으면
  // 14시 10분 결제는 오전 몫이다).
  const [prev] = await findDocs(
    "daily_settlements",
    testId ? { date, test_session: testId } : { date, test_session: { $exists: false } }
  );
  const amClosedAt = shift === "am" ? closedAt : (prev && prev.am_closed_at) || null;
  await saveSettlementSnapshot(
    { ...snapshot, am_closed_at: amClosedAt, last_shift_closed_at: closedAt },
    testId
  );
  await save();

  // 정산한 것은 결제완료 칸에서 내려간다.
  //
  // 사장님(2026-09-10): "정산 누르면 결제완료 애들 없어지게 해줘."
  //
  // 정산은 「여기까지 끊는다」는 뜻이다. 끊은 뒤에도 그대로 남아 있으면
  // 다음 장사에서 들어온 결제와 섞여, 어디까지가 정산한 몫인지 화면만
  // 보고는 가릴 수 없다. 오전 정산 뒤 오후 결제가 그 위에 쌓이면 특히
  // 그렇다.
  //
  // **지우는 것이 아니다.** 표시만 달아 두고 줄은 그대로 남긴다 — 결산
  // 스냅샷도 이전 주문 탭도 매출 집계(ordersInRange)도 이 줄들을 계속
  // 읽는다. 화면의 결제완료 칸만 이 표시를 보고 내린다.
  //
  // 이미 정산된 것은 다시 건드리지 않는다. 오후 정산이 오전 몫의 시각까지
  // 덮어쓰면 「언제 끊었는가」가 사라진다.
  const justSettled = await markSettled(date, closedAt, shift, testId);

  // 장사가 끝났으니 남은 인원수를 비운다(src/partySize.js clearIdleSeats).
  // 주문 없이 인원수만 찍힌 자리는 결제할 것이 없어서 스스로 비워지지
  // 않는다 — 매일 쌓여서 다음 장사 때 빈 자리가 손님 있는 자리로 보인다.
  // 테스터 모드에서는 하지 않는다. 진짜 자리의 인원수를 시험으로 지울 수는
  // 없다(LINE 문자를 안 보내는 것과 같은 이유).
  const clearedSeats = testId ? [] : await clearIdleSeats(store);

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
  if (testId) {
    // 테스트에서는 여기까지 다 돌고 문자만 안 보낸다. 화면에는 "테스트라
    // 안 보냈다"고 그대로 알려준다 — 조용히 안 보내면 LINE 이 고장난 줄 안다.
    line = { sent: false, error: "test_mode" };
  } else if (store.settings.line_notify_enabled) {
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
    // 몇 자리의 인원수를 비웠는가 — 화면이 그 자리에서 알려준다.
    cleared_seats: clearedSeats.length,
    // 결제완료 칸에서 몇 건이 내려갔는가 — 화면이 그 자리에서 알려준다.
    settled_orders: justSettled.length,
    line,
  });
});

/**
 * 정산한 것을 결제완료 칸에서 내린다 (claude/... 「정산하면 결제완료 칸이
 * 비게」). 지우는 것이 아니라 표시만 단다 — 결산도 이전 주문도 이 줄들을
 * 계속 읽는다.
 *
 * 그 정산이 덮는 것까지만 내린다(closedAt 이전에 결제된 것). 오전 정산이
 * 저녁 결제까지 내려버리면 저녁 직원이 방금 받은 돈을 화면에서 못 찾는다.
 */
async function markSettled(date, closedAt, shift, testId) {
  const rows = (store.orders || []).filter(
    (o) =>
      o.status === "paid" &&
      !o.settled_at &&
      String(o.created_at || "").slice(0, 10) === date &&
      !!o.test_session === !!testId &&
      paidAtOf(o) <= closedAt
  );
  if (!rows.length) return rows;
  rows.forEach((o) => {
    o.settled_at = closedAt;
    o.settled_shift = shift;
  });
  // 주문마다 그 줄만 쓴다 — store 문서를 통째로 쓰면 같은 순간 들어온
  // 주문이 지워진다(CLAUDE.md 「store 문서를 통째로 쓰지 않는다」).
  await saveOrders(rows);
  return rows;
}

// ── 오전 정산을 안 눌렀으면 대신 눌러준다 ────────────────────────────
//
// 사장님(2026-09-10): "일단 기본은 직접 정산을 누르는 걸로 지정할건데 만약
// 그 다음 영업시간 5분전까지 정산이 안 눌려 있으면 눌러줘. 그렇게 하면
// 섞일 염려가 전혀 없을 것 같아."
//
// 오전과 오후를 가르는 기준이 「오전 정산을 누른 시각」이다. 그걸 안 누른
// 날은 가를 기준이 없어서 그날 매출이 통째로 「못 가른 날」이 된다
// (src/settlement.js halfBoundaryFor). 저녁 손님이 들어오기 시작하면 그
// 뒤로는 영영 못 가른다 — 점심 매출과 저녁 매출이 한 덩어리가 된다.
//
// 그래서 **저녁 영업 5분 전**까지 안 눌렀으면 그 시각으로 대신 누른다.
// 5분 전인 이유: 그 순간에는 점심 장사가 확실히 끝나 있고 저녁 손님은
// 아직 안 들어왔다. 어느 쪽에 넣어야 할지 헷갈리는 결제가 없는 유일한 틈이다.
//
// 눌린 시각은 「지금」이 아니라 **그 5분 전 시각**으로 적는다. 요청이
// 16:27 에 들어와서 그때 돌았더라도 경계는 16:25 다 — 그래야 같은 날을
// 몇 번을 다시 계산해도 같은 답이 나온다.
let autoAmCloseDoneFor = null; // "YYYY-MM-DD" — 이 프로세스에서 이미 확인한 날

/**
 * 오늘 자동 정산이 걸리는 시각 "YYYY-MM-DD HH:MM:SS". 가를 수 없으면 null.
 *
 * 주문에 「오전/오후」 표를 박을 때 쓰는 것과 **같은 시각**이다
 * (src/servicePeriod.js). 따로 정하면 반드시 어긋난다 — 16:24:59 에 들어온
 * 주문이 「오전」으로 찍혔는데 정산 경계는 16:20 이면, 그 주문은 오전 표를
 * 달고 오후 서랍에 들어간다.
 */
function autoAmCutFor(dateStr) {
  return serviceCutAt(store.settings, dateStr);
}

/**
 * 요청이 올 때마다 값싸게 한 번 본다. 돌 때가 아니면 DB 도 안 건드린다.
 *
 * 크론을 따로 두지 않은 이유: 자동 정산 시각은 영업시간 설정에서 나오므로
 * 사장님이 영업시간을 바꾸면 같이 움직여야 한다. 고정 크론은 그걸 못 따라간다.
 * 그 시각에 가게 태블릿은 주문판을 4초마다 새로 읽고 있으니, 요청이 없어서
 * 못 도는 일은 사실상 없다.
 */
async function maybeAutoCloseAm(req) {
  try {
    // 테스터 모드 기기의 요청으로는 진짜 정산을 돌리지 않는다.
    if (testMode.currentId(req, store)) return;
    const date = taipeiDateString();
    if (autoAmCloseDoneFor === date) return;
    const cut = autoAmCutFor(date);
    if (!cut) return;
    if (nowLocal() < cut) return;

    await connectDB();
    const col = getDb().collection("daily_settlements");
    // 이미 눌렸으면(직접이든 자동이든) 오늘은 더 볼 일이 없다.
    const [existing] = await findDocs("daily_settlements", { date, test_session: { $exists: false } });
    if (existing && existing.am_closed_at) {
      autoAmCloseDoneFor = date;
      return;
    }

    // 인스턴스가 여러 개라 같은 순간에 둘이 여기 올 수 있다. 시각을 먼저
    // **조건부로** 박고, 실제로 박은 쪽만 나머지를 한다 — 안 그러면 LINE
    // 문자가 두 통 간다. 사장님이 받기로 한 건 하루 두 통이다.
    const claim = await col.updateOne(
      { date, test_session: { $exists: false }, am_closed_at: { $in: [null, undefined] } },
      { $set: { am_closed_at: cut, am_closed_auto: true } },
      { upsert: false }
    );
    if (!claim || !claim.modifiedCount) {
      // 아직 그날 스냅샷 자체가 없으면 만들면서 박는다.
      if (existing) {
        autoAmCloseDoneFor = date;
        return; // 다른 인스턴스가 방금 박았다
      }
      await saveSettlementSnapshot({ date, am_closed_at: cut, am_closed_auto: true });
    }
    autoAmCloseDoneFor = date;

    // 이제 그 경계로 그날을 다시 계산해 스냅샷을 채운다.
    const orders = await ordersInRange(date, date, req);
    const snapshot = computeSettlement(orders, date, date, {
      amClosedAt: { [date]: cut },
      eveningStartsAt: eveningStartHm(),
    });
    await saveSettlementSnapshot({ ...snapshot, am_closed_at: cut, am_closed_auto: true });

    // 오전 몫을 정산된 것으로 내린다 — 직접 누른 것과 같은 처리다.
    await markSettled(date, cut, "am", null);

    if (store.settings.line_notify_enabled) {
      const lines = [
        formatShiftSummary(snapshot, { shift: "am", closedAt: cut, amPart: null, pmPart: null }),
        "",
        `※ 오전 정산 버튼을 누르지 않아 ${cut.slice(11, 16)} 에 자동으로 마감했습니다.`,
      ];
      await sendLineMessage(store, lines.join("\n"));
    }
  } catch (e) {
    // 여기서 실패해도 주문판은 그대로 돌아야 한다.
    console.warn("자동 오전 정산 실패:", e && e.message);
  }
}

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
module.exports.maybeAutoCloseAm = maybeAutoCloseAm;
module.exports.autoAmCutFor = autoAmCutFor;
// 주문 목록도 결산과 **같은 기준**으로 갈라야 한다 (src/routes/orders.js
// GET /history). 위의 오전 매출과 아래 오전 목록이 다른 규칙으로 갈리면
// 둘 중 어느 쪽이 맞는지 알 방법이 없다.
module.exports.halfOpts = halfOpts;
