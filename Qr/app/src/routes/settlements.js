const express = require("express");
const { activeItems } = require("../menuItems");
const { store, save, nextId, findOrders, getDb, connectDB, findDocs, saveDoc, saveOrders, saveFields } = require("../db");
const { requireOwner, requireAdmin, requireTodayForStaff } = require("../auth");
const { computeSettlement, taipeiDateString, paidAtOf, halfOf, netTotalOf } = require("../settlement");
const { serviceCutAt, serviceCutHm, LEAD_MIN } = require("../servicePeriod");
const { nextOpenAt } = require("../openHours");
// 「아직 받을 돈이 남은 주문」의 목록은 한 곳에서만 정한다(src/orderStatus.js).
const { OPEN: OPEN_STATUSES } = require("../orderStatus");
const { recordStoreSize, sizeWarningLine, SETTING_BYTES } = require("../storeSize");
const { serviceStartedAt } = require("../serviceStart");
const { clearIdleSeats } = require("../partySize");
const { nowLocal } = require("../time");
// formatSettlementSummary 는 이제 안 쓴다 — 밤 크론이 쓰던 간략한 서식이었는데,
// 2026-09-22 부터 크론도 버튼과 같은 formatShiftSummary 를 쓴다(cron-close).
const { sendLineMessage, formatShiftSummary, formatCloseHeldNotice } = require("../line");
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
/**
 * LINE 마감 문자가 실제로 나갔는지 그날 칸에 적어둔다.
 *
 * 2026-09-15 사장님: "15일 저녁 장사 마치고 보니까 정산이 되어있는 거 같은데
 * line으로는 안오네?" — 그때 남은 기록이 **하나도 없었다.** 갔는지 안 갔는지
 * 알 길이 없어 코드를 거꾸로 읽어야 했다.
 *
 * 문자가 안 나가는 길은 여럿이다(알림 토글이 꺼짐, 받는 사람이 없음, 토큰
 * 만료, LINE 쪽 오류, 아래 크론의 건너뛰기). 어느 쪽이었는지는 나중에
 * 알아낼 수 없으므로 그 자리에서 적는다.
 *
 * 오전과 하루를 따로 적는다. 한 칸에 몰아 적으면 저녁 것이 아침 것을 덮어
 * "오전 문자는 갔는가"를 다시 알 수 없게 된다.
 */
async function recordLineSend(date, shift, result, testId) {
  // 2026-09-16 부터 셋이다 — 오전·오후·하루(아래 shift-close).
  const p = shift === "am" ? "line_am" : shift === "pm" ? "line_pm" : "line_day";
  try {
    await saveSettlementSnapshot(
      {
        date,
        [`${p}_at`]: nowLocal(),
        [`${p}_ok`]: !!(result && result.ok),
        [`${p}_error`]: (result && result.error) || null,
      },
      testId
    );
  } catch (e) {
    // 기록이 실패해도 마감 자체는 끝난 것이다.
    console.warn("LINE 발송 기록 실패:", e && e.message);
  }
}

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
  //
  // 2026-09-12 사장님: "결산 탭 들어가는 거 ... 너무 오래 걸려."
  // 이 화면이 필요로 하는 질의는 셋인데(주문 범위, 오전 정산 시각, 전체
  // 기간 시작일) 서로 아무 관계가 없다. 줄줄이 기다릴 이유가 없어서
  // 나란히 보낸다. 왕복 셋이 하나가 된다.
  const shiftQ = req.query.shift === "am" || req.query.shift === "pm" ? req.query.shift : null;
  const [orders, opts, allTimeStart] = await Promise.all([
    ordersInRange(start, end, req),
    halfOpts(start, end, req),
    // 직원에게는 어차피 오늘뿐이라 계산하지 않는다.
    isOwner ? allTimeStartDate(req) : Promise.resolve(null),
  ]);
  // 「오전만 보기」 / 「오후만 보기」. 없으면 하루 전체(합산)다.
  //
  // 화면에서 거르지 않고 여기서 거른다 — 결제수단, 분류별, 시간대, 테이블별,
  // 차트가 전부 이 한 번의 거르기를 따라간다. 화면에서 조각조각 거르면 어느
  // 하나를 빠뜨리고, 그 칸만 조용히 하루치를 보여준다.
  const shift = shiftQ;
  res.json(
    Object.assign(computeSettlement(orders, start, end, { ...opts, shift, menu: menuForSettlement() }), {
      // 하루만 볼 때는 그날 LINE 마감 문자가 나갔는지도 같이 준다.
      // 안 나갔으면 왜인지까지 — 사장님이 「정산은 됐는데 문자는 안 왔다」를
      // 다음부터는 그 화면에서 바로 본다(2026-09-15).
      line_status: start === end ? (opts.lineByDate || {})[start] || { am: null, pm: null, day: null } : null,
      // 「전체 기간」 버튼이 시작일로 쓸 날짜 (아래 allTimeStartDate).
      // 직원에게는 어차피 오늘뿐이라 계산하지 않는다.
      all_time_start: allTimeStart,
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
  // 휴지통에 있는 메뉴는 「안 팔린 메뉴」 목록에 안 낀다. 판 적이 있는
  // 메뉴는 주문 쪽에서 집계되므로 지웠다고 기록이 사라지지는 않는다.
  return activeItems(store.menuItems)
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
  // 그날 문자가 나갔는지도 같이 담아 온다. 이 질의는 어차피 돌고 있으므로
  // 왕복이 늘지 않는다 — 결산 탭이 느리다는 말을 들은 적이 있다(2026-09-12).
  const lineByDate = {};
  for (const d of snaps || []) {
    if (!d || !d.date) continue;
    if (d.am_closed_at) amClosedAt[d.date] = d.am_closed_at;
    lineByDate[d.date] = {
      am: d.line_am_at ? { at: d.line_am_at, ok: !!d.line_am_ok, error: d.line_am_error || null } : null,
      pm: d.line_pm_at ? { at: d.line_pm_at, ok: !!d.line_pm_ok, error: d.line_pm_error || null } : null,
      day: d.line_day_at ? { at: d.line_day_at, ok: !!d.line_day_ok, error: d.line_day_error || null } : null,
    };
  }
  // 포장 카운터 자리 번호. pickup_number 가 생기기 전의 옛 카운터 주문을
  // 「한 테이블」로 묶지 않으려고 쓴다(src/settlement.js isCounterOrderOf).
  const counterTables = (store.tables || []).filter((t) => t && t.is_counter).map((t) => String(t.number));
  return { amClosedAt, eveningStartsAt: eveningStartHm(), lineByDate, counterTables };
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
  const testId = testMode.currentId(req, store);
  const shift = req.body && req.body.shift === "am" ? "am" : "day";
  res.json(await performShiftClose({ shift, testId, req }));
});

/**
 * 마감 한 번.
 *
 * 「🌅 오전 정산」·「🌙 오후 정산」 버튼(위 shift-close)과 밤 23:00 자동 저녁
 * 마감(아래 cron-close)이 **같은 이 함수**를 부른다. 2026-09-22 이전에는
 * 자동 쪽이 밤 크론 안에 따로 적혀 있었고, 그래서 버튼만 두 통(오후·하루)을
 * 보내고 크론은 하루 한 통만 보냈다 — 사장님이 「저녁 정산이 안 온다」고 하신
 * 것이 이것이다. 마감 규칙을 두 군데 적으면 반드시 갈린다.
 *
 * auto=true 면 문자 끝에 「버튼을 안 눌러 자동으로 마감했다」를 한 줄 붙이고
 * 스냅샷에 day_closed_auto 를 남긴다 — 자동 오전 마감이 하는 것과 같다.
 */
async function performShiftClose({
  shift,
  testId,
  req,
  auto = false,
  // 미결제가 남은 채로 「다음 영업 5분 전」이 되어 그대로 닫는 경우.
  // 문자에 그렇다고 적는다 — 안 적으면 사장님은 받은 돈으로 읽으신다.
  forced = false,
  // 보통은 오늘이다. 마감을 미뤘던 **지난 날**을 닫을 때만 그 날짜가 온다
  // (아래 maybePendingDayClose).
  date = taipeiDateString(),
}) {
  // 테스터 모드에서도 정산이 된다. 숫자와 화면은 진짜와 똑같이 돌아가되
  // 두 가지가 다르다(아래):
  //   · 스냅샷이 테스트 세션 것으로 따로 찍히고, 끄면 같이 사라진다
  //   · **LINE 문자는 안 나간다** — 직원 폰으로 가는 것이라 시험으로
  //     보낼 수 없다. 직원이 마감인 줄 알고 움직인다.
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
  // day_closed_at 은 **하루 정산을 눌렀을 때만** 찍힌다.
  //
  // 밤 크론이 "오늘은 사람이 마감했으니 문자를 건너뛴다"를 판단하는 근거가
  // 이것이다. 예전에는 last_shift_closed_at(오전이든 하루든 눌리면 찍힘)을
  // 봤는데, **오전 정산만 누르고 저녁에 안 누른 날**이면 크론이 그날 결산은
  // 만들면서 문자는 건너뛰었다. 사장님 눈에는 「정산은 되어 있는데 LINE 은
  // 안 온 날」로 보인다. 2026-09-15 이 그랬다.
  await saveSettlementSnapshot(
    {
      ...snapshot,
      am_closed_at: amClosedAt,
      last_shift_closed_at: closedAt,
      ...(shift === "day" ? { day_closed_at: closedAt, day_closed_auto: !!auto } : {}),
    },
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
  let pmSnapshot = null;
  if (shift === "day" && amClosedAt) {
    // ★ 가르는 일을 손으로 하지 않는다.
    //
    // computeSettlement 는 이미 「오전만 / 오후만」을 낼 줄 안다(opts.shift —
    // 결산 탭의 「오전만 보기」가 쓰는 바로 그것). 그걸 쓰면 결제수단·할인·
    // VIP 카드·취소·미결제가 **전부 따라온다.**
    //
    // 2026-09-16 사장님: "오후는 왜이렇게 보고가 빈약해. 오전처럼 자세하게
    // 나와야지." 처음엔 여기서 주문 목록을 직접 걸러 넘겼는데, 그러면 이
    // 함수가 아는 것의 일부만 쓰는 꼴이었다. 한 곳에서 가르게 두면 문자도
    // 화면도 같은 답을 본다.
    const halfArgs = await halfOpts(date, date, req);
    pmSnapshot = computeSettlement(orders, date, date, { ...halfArgs, shift: "pm" });
    // 하루 문자의 「오전 / 오후」 두 줄도 **같은 가름**을 쓴다. 예전에는
    // 여기만 「오전 정산을 누른 시각」으로 따로 갈랐는데, 그러면 오후 문자와
    // 하루 문자의 오후 숫자가 서로 다를 수 있다 — 사장님이 두 문자를
    // 대조하다 멈춘다.
    const half = snapshot.half_split || {};
    amPart = { revenue: (half.am && half.am.revenue) || 0, count: (half.am && half.am.paid_order_count) || 0 };
    pmPart = { revenue: (half.pm && half.pm.revenue) || 0, count: (half.pm && half.pm.paid_order_count) || 0 };
  }

  // 자동으로 마감했으면 그렇다고 적는다. 안 적으면 사장님은 누가 눌렀다고
  // 생각하신다 — 자동 오전 마감이 이미 같은 줄을 붙이고 있다.
  const autoNote = !auto
    ? null
    : forced
    ? // 받을 돈이 남은 채로 닫았다. 이 한 줄이 없으면 매출 숫자를 「다 받은
      // 돈」으로 읽게 된다 — 미결제 금액만큼 장부가 부풀어 보인다.
      `※ 미결제가 남은 채로 다음 영업 5분 전이 되어 ${String(closedAt).slice(11, 16)} 에 그대로 마감했습니다. 미결제 건은 위 ⚠️ 줄을 봐 주세요.`
    : `※ ${shift === "day" ? "오후" : "오전"} 정산 버튼을 누르지 않아 ${String(closedAt).slice(11, 16)} 에 자동으로 마감했습니다.`;

  let line = { sent: false, error: "disabled" };
  // 저녁 마감의 첫 문자(오후 것만). 오전 정산을 누른 적 없는 날은 가를
  // 기준이 없어서 안 나간다 — 없는 경계를 지어내는 것보다 낫다.
  let linePm = null;
  if (testId) {
    // 테스트에서는 여기까지 다 돌고 문자만 안 보낸다. 화면에는 "테스트라
    // 안 보냈다"고 그대로 알려준다 — 조용히 안 보내면 LINE 이 고장난 줄 안다.
    line = { sent: false, error: "test_mode" };
  } else if (store.settings.line_notify_enabled) {
    // 저녁 마감에는 **오후 것만** 담은 문자를 먼저 보내고, 그 다음 하루
    // 전체를 보낸다(2026-09-16 사장님). 가게 크기 경고는 마지막 문자에만
    // 붙인다 — 같은 경고가 두 번 오면 그냥 소음이다.
    if (pmSnapshot) {
      const pmLines = [formatShiftSummary(pmSnapshot, { shift: "pm", closedAt })];
      if (autoNote) pmLines.push("", autoNote);
      const pmResult = await sendLineMessage(store, pmLines.join("\n"));
      linePm = pmResult.ok ? { sent: true } : { sent: false, error: pmResult.error };
      await recordLineSend(date, "pm", { ok: linePm.sent, error: linePm.error }, testId);
    }
    const lines = [formatShiftSummary(snapshot, { shift, closedAt, amPart, pmPart })];
    // 자동으로 마감했다는 것은 **첫 문자에만** 적는다. 같은 안내가 두 통에
    // 다 있으면 소음이 되고, 정작 붙여야 할 가게 크기 경고와 섞인다.
    const warn = sizeWarningLine(store.settings[SETTING_BYTES]);
    if (!pmSnapshot && autoNote) lines.push("", autoNote);
    if (warn) lines.push("", warn);
    const result = await sendLineMessage(store, lines.join("\n"));
    line = result.ok ? { sent: true } : { sent: false, error: result.error };
  }
  if (!testId) await recordLineSend(date, shift, { ok: line.sent, error: line.error }, testId);

  return {
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
    // 저녁 마감의 첫 문자(오후 것만). 안 보낸 날은 null.
    line_pm: linePm,
  };
}


// ───────── 받을 돈이 남았으면 자동 마감을 미룬다 ─────────
//
// 2026-09-22 사장님: "자동으로 할 때 그런 상황이 생기면 무시하고 진행하지
// 말고 라인으로 문자를 보내줘 그리고 대기 시켜주고 그러다 다음 영업 시간
// 5분전까지도 안되면 그때는 그냥 강제로 해줘."
//
// 마감은 「여기까지 받았다」를 못 박는 일이다. 받을 돈이 남았는데 그대로
// 박으면 그 돈은 장부에서 조용히 사라진다. 사람이 누를 때는 화면이 묻는다
// ("미결제 N건을 전부 결제완료로 처리할까요?"). 자동은 물을 사람이 없으므로
// 멈추고 사람을 부른다.
//
// 그렇다고 영영 기다리지는 않는다. 다음 장사가 시작되면 어제 돈과 오늘 돈이
// 한 판에 섞인다 — 그 전에 끊어야 한다. 「다음 영업 5분 전」은 이 저장소가
// 이미 쓰는 경계다(src/servicePeriod.js LEAD_MIN, 자동 오전 마감도 같은 규칙).
// 사장님이 2026-09-10 에 오전 건으로 같은 말씀을 하셨다: "만약 그 다음
// 영업시간 5분전까지 정산이 안 눌려 있으면 눌러줘."
const PENDING_DATE = "pending_day_close_date";
const PENDING_FORCE_AT = "pending_day_close_force_at";

/**
 * 아직 받을 돈이 남은 주문들. { count, amount, rows }
 *
 * 결산의 problem_order_count 를 쓰지 않는 이유: 그건 **2시간 이상 묵은 것만**
 * 센다(src/settlement.js STALE_OPEN_ORDER_MS). 화면에 「문제 주문」으로
 * 띄우기 위한 기준이라 그게 맞다. 하지만 마감을 미룰지는 「받을 돈이 하나라도
 * 남았나」로 봐야 한다 — 22시에 들어온 미결제도 받을 돈이다.
 */
function unpaidOf(orders) {
  const rows = (orders || []).filter((o) => OPEN_STATUSES.includes(o.status));
  return {
    count: rows.length,
    amount: rows.reduce((sum, o) => sum + (o.total || 0), 0),
    rows: rows.map((o) => ({
      label: o.table_number ? `${o.table_number}번` : `#${o.id}`,
      total: o.total || 0,
    })),
  };
}

/** 그 시각 다음의 「영업 시작 5분 전」. 영업시간이 없으면 null. */
function pendingForceAt(fromLocalTs) {
  const next = nextOpenAt(store.settings, fromLocalTs); // "YYYY-MM-DD HH:MM"
  if (!next || next.length < 16) return null;
  const date = next.slice(0, 10);
  const [h, m] = next.slice(11, 16).split(":").map((x) => parseInt(x, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const total = h * 60 + m - LEAD_MIN;
  // 00:05 이전에 여는 가게는 없지만, 음수가 되면 시각이 엉키므로 바닥을 깐다.
  const safe = total < 0 ? 0 : total;
  const pad = (n) => String(n).padStart(2, "0");
  return `${date} ${pad(Math.floor(safe / 60))}:${pad(safe % 60)}:00`;
}

/** 미루기로 한 것을 적어둔다. store 문서를 통째로 쓰지 않는다(CLAUDE.md). */
async function markDayClosePending(date, forceAt) {
  store.settings[PENDING_DATE] = date;
  store.settings[PENDING_FORCE_AT] = forceAt || null;
  await saveFields({
    [`settings.${PENDING_DATE}`]: date,
    [`settings.${PENDING_FORCE_AT}`]: forceAt || null,
  });
}

async function clearDayClosePending() {
  delete store.settings[PENDING_DATE];
  delete store.settings[PENDING_FORCE_AT];
  await saveFields({ [`settings.${PENDING_DATE}`]: null, [`settings.${PENDING_FORCE_AT}`]: null });
}

let pendingClosePromise = null;

/**
 * 미뤄둔 마감이 있으면 들여다본다. 주문판이 부르는 자리에 붙어 있다
 * (src/routes/orders.js GET / — 자동 오전 마감과 같은 자리).
 *
 * 세 갈래다:
 *   · 사람이 그 사이에 눌렀다        → 표만 걷는다
 *   · 미결제가 다 정리됐다            → 그 자리에서 마감한다 (기다릴 이유가 없다)
 *   · 다음 영업 5분 전이 지났다       → 남아 있어도 그대로 마감한다
 *
 * 그 외에는 아무것도 하지 않는다. 표가 없으면 DB 도 안 건드린다 — 주문판이
 * 4초마다 부르는 자리라 값싸야 한다.
 */
async function maybePendingDayClose(req) {
  if (pendingClosePromise) return pendingClosePromise;
  pendingClosePromise = runPendingDayClose(req);
  try {
    return await pendingClosePromise;
  } finally {
    pendingClosePromise = null;
  }
}

async function runPendingDayClose(req) {
  try {
    if (testMode.currentId(req, store)) return;
    const date = store.settings && store.settings[PENDING_DATE];
    if (!date) return;

    await connectDB();
    const [snap] = await findDocs("daily_settlements", { date, test_session: { $exists: false } });
    // 그 사이에 직원이 「🌙 오후 정산」을 눌렀으면 할 일이 없다.
    if (snap && snap.day_closed_at) return clearDayClosePending();

    const orders = await ordersInRange(date, date, req);
    const unpaid = unpaidOf(orders);
    const forceAt = store.settings[PENDING_FORCE_AT];
    const due = !!forceAt && nowLocal() >= forceAt;
    if (unpaid.count > 0 && !due) return; // 계속 기다린다

    await performShiftClose({
      shift: "day",
      testId: null,
      req,
      auto: true,
      forced: unpaid.count > 0,
      date,
    });
    await clearDayClosePending();
  } catch (e) {
    // 여기서 실패해도 주문판은 그대로 돌아야 한다. 표는 남으므로 다음 요청이
    // 다시 시도한다.
    console.warn("미뤄둔 마감 처리 실패:", e && e.message);
  }
}

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
      // 값까지 맞춰 본다. 예전에는 「있냐 없냐」만 봐서, 테스터 모드로 결산을
      // 눌렀을 때 테스트 테이블 주문까지 같이 마감돼 버렸다. 그 자리는
      // 어느 결산에도 안 들어가야 한다(2026-09-16 사장님: "결산이나 실제
      // 영수증은 발급 안되게해줘").
      (o.test_session || null) === (testId || null) &&
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
let autoAmClosePromise = null; // 4초 폴링이 느린 확인 작업을 겹쳐 만들지 않게
const AUTO_AM_DONE_SETTING = "auto_am_close_done_for";

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
  // Atlas가 느려 한 번의 확인이 4초를 넘으면 다음 폴링이 들어온다. 예전에는
  // 응답을 기다리지 않는 대신 같은 DB 작업이 계속 겹쳐, 연결 하나짜리 풀의
  // 뒤 요청들까지 막았다. 이 인스턴스 안에서는 진행 중인 한 작업을 같이 쓴다.
  if (autoAmClosePromise) return autoAmClosePromise;
  autoAmClosePromise = runAutoAmClose(req);
  try {
    return await autoAmClosePromise;
  } finally {
    autoAmClosePromise = null;
  }
}

async function runAutoAmClose(req) {
  try {
    // 테스터 모드 기기의 요청으로는 진짜 정산을 돌리지 않는다.
    if (testMode.currentId(req, store)) return;
    const date = taipeiDateString();
    if (autoAmCloseDoneFor === date) return;
    // Vercel 인스턴스의 메모리는 서로 다르다. 한 인스턴스가 오늘 확인을
    // 끝냈다는 표를 작은 store 문서에 남겨, 이후 생긴 인스턴스들이
    // daily_settlements를 다시 읽지 않게 한다.
    if (store.settings && store.settings[AUTO_AM_DONE_SETTING] === date) {
      autoAmCloseDoneFor = date;
      return;
    }
    const cut = autoAmCutFor(date);
    if (!cut) return;
    if (nowLocal() < cut) return;

    await connectDB();
    const col = getDb().collection("daily_settlements");
    // 이미 눌렸으면(직접이든 자동이든) 오늘은 더 볼 일이 없다.
    const [existing] = await findDocs("daily_settlements", { date, test_session: { $exists: false } });
    if (existing && existing.am_closed_at) {
      autoAmCloseDoneFor = date;
      store.settings[AUTO_AM_DONE_SETTING] = date;
      await saveFields({ [`settings.${AUTO_AM_DONE_SETTING}`]: date });
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

    let amLine = { ok: false, error: "disabled" };
    if (store.settings.line_notify_enabled) {
      const lines = [
        formatShiftSummary(snapshot, { shift: "am", closedAt: cut, amPart: null, pmPart: null }),
        "",
        `※ 오전 정산 버튼을 누르지 않아 ${cut.slice(11, 16)} 에 자동으로 마감했습니다.`,
      ];
      amLine = await sendLineMessage(store, lines.join("\n"));
    }
    await recordLineSend(date, "am", amLine, null);

    // 실제 스냅샷·주문 표시·LINE까지 끝난 뒤에만 완료 표를 남긴다. 중간에
    // 실패했는데 먼저 표를 세우면 다음 인스턴스가 이어서 끝낼 수 없게 된다.
    store.settings[AUTO_AM_DONE_SETTING] = date;
    await saveFields({ [`settings.${AUTO_AM_DONE_SETTING}`]: date });
  } catch (e) {
    // 여기서 실패해도 주문판은 그대로 돌아야 한다.
    console.warn("자동 오전 정산 실패:", e && e.message);
  }
}

// Sends a one-off test message using whatever LINE settings are currently
// saved, so the owner can confirm the channel access token actually works
// right after entering it, instead of waiting until the next cron run.
/**
 * 지난 날짜의 마감 문자를 다시 보낸다.
 *
 * 2026-09-15 사장님이 저녁 마감 문자를 한 통 못 받았다(위 day_closed_at 건).
 * 숫자는 결산 탭에 그대로 있었지만 **문자를 다시 받을 길이 없었다.** 크론은
 * 그날 하루치고, 정산 버튼은 오늘 것만 누른다.
 *
 * 「마감 알림 사용」 토글은 보지 않는다. 그 토글은 **자동으로** 나가는 것을
 * 켜고 끄는 것이고, 이건 사장님이 그 자리에서 직접 누른 것이다. 토큰과 받는
 * 사람이 없으면 sendLineMessage 가 그 이유를 돌려준다.
 *
 * 보낼 때 「다시 보낸 것」이라고 적는다. 안 적으면 지난 날짜 숫자가 오늘
 * 마감으로 읽힌다 — 문자에는 앞뒤 맥락이 없다.
 */
router.post("/resend-line", requireOwner, async (req, res) => {
  const date = String((req.body && req.body.date) || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "bad_date" });
  // 테스터 모드에서는 안 보낸다. 직원 폰으로 가는 것이라 시험으로 보낼 수 없다.
  if (testMode.currentId(req, store)) return res.status(409).json({ error: "test_mode" });

  const opts = await halfOpts(date, date, req);
  const orders = await ordersInRange(date, date, req);
  const snapshot = computeSettlement(orders, date, date, opts);
  const amClosedAt = (opts.amClosedAt || {})[date] || null;

  // 오전/오후 가르기는 그날 마감 때와 같은 방법으로 한다(위 shift-close) —
  // computeSettlement 의 half_split. 여기서 따로 갈라 적으면 다시 보낸 문자와
  // 원래 문자의 숫자가 달라진다.
  let amPart = null;
  let pmPart = null;
  if (amClosedAt) {
    const half = snapshot.half_split || {};
    amPart = { revenue: (half.am && half.am.revenue) || 0, count: (half.am && half.am.paid_order_count) || 0 };
    pmPart = { revenue: (half.pm && half.pm.revenue) || 0, count: (half.pm && half.pm.paid_order_count) || 0 };
  }

  const [snap] = await findDocs("daily_settlements", { date, test_session: { $exists: false } });
  const closedAt = (snap && (snap.day_closed_at || snap.last_shift_closed_at)) || `${date} 23:59:59`;
  const text = [
    formatShiftSummary(snapshot, { shift: "day", closedAt, amPart, pmPart }),
    "",
    `※ ${nowLocal().slice(0, 16)} 에 다시 보낸 것입니다.`,
  ].join("\n");

  const result = await sendLineMessage(store, text);
  await recordLineSend(date, "day", result, null);
  if (!result.ok) return res.status(502).json({ error: result.error, detail: result.detail || null });
  res.json({ ok: true, date });
});

router.post("/line-test", requireOwner, async (req, res) => {
  const result = await sendLineMessage(store, "✅ 한국관 어드민 LINE 알림 테스트입니다. 이 메시지가 보이면 마감 자동 알림이 정상적으로 연결된 거예요!");
  if (!result.ok) return res.status(400).json(result);
  res.json({ ok: true });
});

// 자동 저녁 마감. 매일 밤 23:00(타이베이)에 Vercel Cron 이 부른다
// (vercel.json — UTC 로 적으므로 "0 15 * * *").
//
// ── 2026-09-22 사장님: "오늘 또 저녁 정산이 라인으로 연락이 안왔어"
//
// 오전은 자동이 있었다(runAutoAmClose). 저녁은 없었다 — 「🌙 오후 정산」
// 버튼을 눌러야만 마감이 되고 문자가 나갔다. 이 크론은 그 자리를 메우는
// 예비였지만, **하루 요약 한 통만** 보냈다. 버튼이 보내는 두 통 중
// 「오후 정산」 문자는 크론에 아예 없었다.
//
// 그래서 버튼을 안 누른 날은 오후 정산 문자가 어느 경로로도 안 나갔다.
// 사장님이 "또"라고 하신 이유다.
//
// 이제 크론은 **버튼과 같은 함수**(performShiftClose)를 부른다. 스냅샷·
// 정산 표시·빈자리 정리·문자 두 통이 전부 버튼 누른 것과 같다. 마감 규칙이
// 한 곳에만 있으므로 다시 갈릴 자리가 없다.
//
// 시각은 사장님이 정하셨다(2026-09-22): "자동 저녁 정산은 23:00 으로 해줘.
// 그 전에 직접 누르면 몰라도." 영업시간에서 끌어내지 않고 못을 박는다 —
// 오전과 달리 저녁에는 「장사가 확실히 끝난 틈」이 없어서, 사장님이 아는
// 시각 하나로 두는 편이 예측 가능하다.
//
// Vercel 은 CRON_SECRET 이 있으면 `Authorization: Bearer ...` 를 붙인다.
// 크론 요청에는 브라우저 세션이 없어서 requireOwner/requireAdmin 을 못 쓴다.
router.get("/cron-close", async (req, res) => {
  if (process.env.CRON_SECRET) {
    const header = req.get("authorization") || "";
    if (header !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }
  const date = taipeiDateString();

  // 사장님(2026-09-10): "3-4년 후에 내가 잊으면 큰일이잖아."
  // 매일 밤 여기서 store 문서 크기를 재둔다. 기준을 넘으면 관리자 화면에
  // 띠가 뜨고 마감 메시지에도 한 줄이 붙는다 — 사람이 달력에 적어두고
  // 기억할 일이 아니다(src/storeSize.js). 마감을 건너뛰는 날에도 잰다.
  await recordStoreSize(store, { getDb, connectDB, nowLocal });
  await save();

  // 미뤄둔 지난 마감이 남아 있으면 먼저 본다. 보통은 주문판 폴링이 처리하지만
  // (maybePendingDayClose), 그날 태블릿을 한 번도 안 켰으면 부를 사람이 없다.
  await maybePendingDayClose(req);

  // 직원이 「🌙 오후 정산」을 이미 눌렀으면 아무것도 하지 않는다. 사장님:
  // "그 전에 직접 누르면 몰라도."
  //
  // 건너뛸 때는 **아무것도 적지 않는다.** 건너뛴다는 것은 버튼이 이미
  // 마감했다는 뜻이고, 그때 「보냄」이 적혔다. 여기서 덮어쓰면 문자가 나간
  // 날이 「안 감」으로 바뀐다.
  const [todaySnapshot] = await findDocs("daily_settlements", { date });
  if (todaySnapshot && todaySnapshot.day_closed_at) {
    return res.json({ ok: true, date, skipped: "closed_by_hand" });
  }

  // 받을 돈이 남아 있으면 **마감하지 않는다.** 알리고 기다린다.
  //
  // 2026-09-22 사장님: "자동으로 할 때 그런 상황이 생기면 무시하고 진행하지
  // 말고 라인으로 문자를 보내줘 그리고 대기 시켜주고."
  //
  // 사람이 누를 때는 화면이 묻고 나서 결제완료로 바꾼다. 자동은 물을 사람이
  // 없는데, 받지도 않은 돈을 받은 것으로 적을 수는 없다.
  const orders = await ordersInRange(date, date, req);
  const unpaid = unpaidOf(orders);
  if (unpaid.count > 0) {
    const forceAt = pendingForceAt(nowLocal());
    await markDayClosePending(date, forceAt);
    let held = { ok: false, error: "disabled" };
    if (store.settings.line_notify_enabled) {
      held = await sendLineMessage(store, formatCloseHeldNotice(date, unpaid, { at: nowLocal(), forceAt }));
    }
    // 미뤘다는 것도 그날 칸에 적는다. 마감 문자 기록(line_day_*)과 섞지
    // 않는다 — 하루 문자는 아직 안 나갔고, 「보냄」으로 적히면 거짓이 된다.
    const snapshot = computeSettlement(orders, date, date, await halfOpts(date, date, req));
    await saveSettlementSnapshot({
      ...snapshot,
      close_held_at: nowLocal(),
      close_held_force_at: forceAt,
      close_held_unpaid_count: unpaid.count,
      close_held_line_ok: !!held.ok,
      close_held_line_error: held.error || null,
    });
    return res.json({
      ok: true,
      date,
      held: true,
      unpaid_count: unpaid.count,
      unpaid_amount: unpaid.amount,
      force_at: forceAt,
      line: held.ok ? { sent: true } : { sent: false, error: held.error },
    });
  }

  const result = await performShiftClose({ shift: "day", testId: null, req, auto: true });
  res.json({
    ok: true,
    date,
    auto: true,
    problem_order_count: result.problem_order_count,
    line: result.line,
    line_pm: result.line_pm,
  });
});

module.exports = router;
module.exports.maybeAutoCloseAm = maybeAutoCloseAm;
module.exports.autoAmCutFor = autoAmCutFor;
module.exports.AUTO_AM_DONE_SETTING = AUTO_AM_DONE_SETTING;
// 미뤄둔 저녁 마감을 들여다보는 것. 자동 오전 마감과 **같은 자리**에 붙는다
// (src/routes/orders.js GET /) — 그 시각에 가게 태블릿이 그 주소를 4초마다
// 부르고 있다.
module.exports.maybePendingDayClose = maybePendingDayClose;
module.exports.PENDING_DATE = PENDING_DATE;
module.exports.PENDING_FORCE_AT = PENDING_FORCE_AT;
// 주문 목록도 결산과 **같은 기준**으로 갈라야 한다 (src/routes/orders.js
// GET /history). 위의 오전 매출과 아래 오전 목록이 다른 규칙으로 갈리면
// 둘 중 어느 쪽이 맞는지 알 방법이 없다.
module.exports.halfOpts = halfOpts;
