// 갑자기 잘 팔리거나 갑자기 안 팔리는 메뉴를 찾는다.
//
// 2026-09-30 사장님: "메뉴가 갑자기 안 팔리거나 갑자기 잘팔리거나 이런 걸
// 꾸준히 체크하면서 보여줬으면 좋겠는데 가능한가?"
//
// 결산 탭을 열 때마다 다시 잰다(GET /api/settlements/item-movers). 기준은
// 하나다 — **어제까지 7일** 판 수를 **그 전 4주의 주 평균**과 견준다. 요일이
// 한 바퀴 다 들어가므로 월요일 휴무·주말 손님 차이가 양쪽에 똑같이 걸린다.
// 오늘은 넣지 않는다(장사 중이라 반쯤 센 날이다).
//
// **개수를 그대로 견주지 않는다 — 손님 수로 나눈다.** 2026-09-30 사장님: "전체적인
// 개수를 비교하면 안되고 집계 날짜와 인원수 수량과 비례해서 해야돼." 손님이 많았던
// 주에는 모든 메뉴가 「늘었다」로 보이고, 휴무가 낀 주에는 모두 「줄었다」로 보인다.
// 그래서 「손님 100명당 몇 개」로 바꿔 견준다. 손님 수는 결산과 같은 규칙으로 센다
// (한 팀은 한 번, 포장 한 건은 한 명 — src/routes/settlements.js item-movers).
// 날 수는 손님 수 안에 이미 들어 있다(문 닫은 날은 손님 0명).
//
// 숫자가 작을 때 흔들리는 것은 걸러낸다: 「이번 주 손님 수로 평소대로라면 팔렸을
// 수」와 5개는 차이가 나야 「달라졌다」고 본다.
// 서비스 시작일(serviceStartedAt) 전의 날은 기준에서 뺀다 — 그 전은 시험 주문이다.

const RECENT_DAYS = 7;
const BASE_DAYS = 28;
const MIN_DIFF = 5; // 「평소대로라면」과 이만큼은 차이가 나야 한다
const UP_RATIO = 1.5; // 평소의 1.5배 이상
const DOWN_RATIO = 0.5; // 평소의 절반 이하
const NEW_HIT_MIN = 8; // 평소 거의 없던 메뉴가 한 주에 이만큼 → 새로 뜬 메뉴
const LIMIT = 12;

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * orders: 기준 시작일 ~ 어제 사이의 주문(결제 안 된 것도 섞여 올 수 있다).
 * today: "YYYY-MM-DD". firstDay: 셀 수 있는 첫날(서비스 시작일), 없으면 null.
 * menuItems: 이름과 품절 여부를 보려고.
 */
function computeItemMovers(
  orders,
  { today, firstDay = null, menuItems = [], isSoldOut = () => false, recentGuests = 0, baseGuests = 0, weekGuests = null } = {}
) {
  const end = addDays(today, -1);
  const recentStart = addDays(end, -(RECENT_DAYS - 1));
  const baseEnd = addDays(recentStart, -1);
  const baseStart = addDays(baseEnd, -(BASE_DAYS - 1));
  const from = firstDay && firstDay > baseStart ? firstDay : baseStart;
  // 기준 기간 중 실제로 셀 수 있는 날 수(서비스 시작 뒤).
  let baseDays = 0;
  for (let d = from; d <= baseEnd; d = addDays(d, 1)) baseDays++;

  // 5주 흐름(작은 선) — 기준 4주 + 최근 1주, 7일씩.
  const weekStarts = [0, 1, 2, 3, 4].map((k) => addDays(baseStart, k * 7));
  const weekOf = (d) => {
    for (let k = 4; k >= 0; k--) if (d >= weekStarts[k]) return k;
    return -1;
  };

  const byItem = new Map();
  for (const o of orders || []) {
    if (!o || o.status !== "paid") continue;
    const d = String(o.created_at || "").slice(0, 10);
    if (d < from || d > end) continue;
    for (const it of o.items || []) {
      const qty = Number(it && it.qty) || 0;
      if (qty <= 0) continue;
      const key = String(it.item_id != null ? it.item_id : it.name_ko || it.name_zh || "");
      if (!key) continue;
      const row =
        byItem.get(key) ||
        { item_id: key, name_ko: it.name_ko || null, name_zh: it.name_zh || null, recent: 0, baseTotal: 0, weeks: [0, 0, 0, 0, 0] };
      if (d >= recentStart) row.recent += qty;
      else row.baseTotal += qty;
      const w = weekOf(d);
      if (w >= 0) row.weeks[w] += qty;
      byItem.set(key, row);
    }
  }

  const window = {
    recent_start: recentStart,
    recent_end: end,
    base_start: from,
    base_end: baseEnd,
    base_days: baseDays,
    recent_guests: recentGuests,
    base_guests: baseGuests,
  };
  // 기준이 한 주도 안 되거나 손님 수를 모르면 견줄 것이 없다 — 억지로 말하지 않는다.
  if (baseDays < 7 || !(recentGuests > 0) || !(baseGuests > 0)) return { ...window, insufficient: true, up: [], down: [] };

  const menuById = new Map((menuItems || []).map((m) => [String(m.id), m]));
  const up = [];
  const down = [];
  const r1 = (v) => Math.round(v * 10) / 10;
  for (const row of byItem.values()) {
    const recent = row.recent;
    // 손님 100명당 몇 개 — 최근 7일과 기준 기간 각각.
    const recentPer100 = (recent / recentGuests) * 100;
    const basePer100 = (row.baseTotal / baseGuests) * 100;
    // 「이번 주 손님 수로 평소대로라면 팔렸을 수」 — 작은 숫자 흔들림을 거르는 데 쓴다.
    const expected = (basePer100 * recentGuests) / 100;
    const m = menuById.get(row.item_id);
    const out = {
      item_id: row.item_id,
      name_ko: (m && m.name_ko) || row.name_ko,
      name_zh: (m && m.name_zh) || row.name_zh,
      recent,
      expected: r1(expected),
      recent_per100: r1(recentPer100),
      base_per100: r1(basePer100),
      change_pct: basePer100 > 0 ? Math.round(((recentPer100 - basePer100) / basePer100) * 100) : null,
      weeks: row.weeks,
      // 작은 선도 손님 수로 나눈다 — 손님 많았던 주가 봉우리로 보이지 않게.
      weeks_per100: Array.isArray(weekGuests)
        ? row.weeks.map((q, k) => (weekGuests[k] > 0 ? r1((q / weekGuests[k]) * 100) : null))
        : null,
      sold_out: m ? !!isSoldOut(m) : false,
    };
    if (expected < 1 && recent >= NEW_HIT_MIN) up.push({ ...out, kind: "new" });
    else if (expected >= 1 && recent >= expected * UP_RATIO && recent - expected >= MIN_DIFF) up.push({ ...out, kind: "up" });
    else if (expected >= MIN_DIFF && recent <= expected * DOWN_RATIO && expected - recent >= MIN_DIFF)
      down.push({ ...out, kind: recent === 0 ? "stopped" : "down" });
  }
  // 기준 기간에 팔렸는데 최근 7일 주문에 아예 없는 메뉴도 위에서 잡힌다(recent 0).
  up.sort((a, b) => b.recent - b.expected - (a.recent - a.expected));
  down.sort((a, b) => b.expected - b.recent - (a.expected - a.recent));
  return { ...window, insufficient: false, up: up.slice(0, LIMIT), down: down.slice(0, LIMIT) };
}

/** 작은 선의 5주 — [시작, 끝] 날짜 쌍. 라우트가 주마다 손님 수를 세는 데 쓴다. */
function weekRanges(today) {
  const end = addDays(today, -1);
  const baseStart = addDays(end, -(RECENT_DAYS + BASE_DAYS - 1));
  return [0, 1, 2, 3, 4].map((k) => [addDays(baseStart, k * 7), addDays(baseStart, k * 7 + 6)]);
}

module.exports = { computeItemMovers, weekRanges, RECENT_DAYS, BASE_DAYS, MIN_DIFF, addDays };
