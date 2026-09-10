// 이미 쌓인 주문에도 「점심 장사/저녁 장사」 표를 채워 넣는다.
//
// 사장님(2026-09-10): "이전 주문도 백필로 너가 채워줄 수 있지 않아?"
//
// 표를 박기 시작한 것은 오늘부터라, 그 전 주문에는 칸이 없다. 그러면 결산의
// 오전/오후가 옛 날짜에서 비어 버린다 — 사장님이 「오전 오후가 사라졌네」로
// 보신 것이 그 상태다.
//
// ── 처음에는 안 하려고 했다 ───────────────────────────────────────────
//
// 그때 영업시간이 지금과 같았다는 보장이 없어서, 지금 기준으로 소급해 박으면
// 없던 사실을 만들어내는 것이라고 봤다. 사장님이 채워달라고 하셔서 채우되,
// **날짜별 영업시간을 그대로 본다**(rangesForDate 는 그날의 요일 설정과 특정
// 날짜 예외까지 본다). 지금 시각 하나로 전부 밀어버리지 않는다.
//
// 그래도 못 가르는 날은 그냥 둔다. 한 타임만 연 날은 경계가 없고, 없는 것은
// 「모른다」이지 「오전」이 아니다.
//
// ── 이미 박혀 있는 표는 건드리지 않는다 ──────────────────────────────
//
// 오늘 저녁부터 들어오는 주문은 그 순간의 시각으로 박힌다. 그게 가장 정확한
// 값이라 나중에 덮어쓸 이유가 없다.
const { rangesForDate, orderHours } = require("../openHours");

const MIGRATION_FLAG = "migration_2026_09_10_service_period_backfill_applied";
const LEAD_MIN = 5; // src/servicePeriod.js 와 같은 값 — 그 파일이 기준이다

/** 그날의 경계 "YYYY-MM-DD HH:MM:SS". 가를 수 없으면 null. */
function cutFor(settings, dateStr) {
  const ranges = rangesForDate(orderHours(settings), dateStr) || [];
  if (ranges.length < 2) return null;
  const start = ranges[ranges.length - 1].start;
  if (!start) return null;
  const [h, m] = String(start).split(":").map((x) => parseInt(x, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const total = h * 60 + m - LEAD_MIN;
  if (total < 0) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${dateStr} ${pad(Math.floor(total / 60))}:${pad(total % 60)}:00`;
}

async function applyServicePeriodBackfill20260910(store, { getDb, connectDB, save }) {
  if (store.settings && store.settings[MIGRATION_FLAG]) return;

  await connectDB();
  const col = getDb().collection("orders");
  const rows = await col
    .find({ service_period: { $exists: false } }, { projection: { _id: 1, created_at: 1 } })
    .toArray();

  // 날짜별 경계는 한 번만 구한다. 주문 수천 건에 같은 계산을 반복할 이유가 없다.
  const cutByDate = new Map();
  const writes = [];
  let skipped = 0;
  for (const row of rows || []) {
    const date = String(row.created_at || "").slice(0, 10);
    if (date.length !== 10) {
      skipped += 1;
      continue;
    }
    if (!cutByDate.has(date)) cutByDate.set(date, cutFor(store.settings, date));
    const cut = cutByDate.get(date);
    if (!cut) {
      skipped += 1; // 그날은 가를 기준이 없다
      continue;
    }
    writes.push({
      updateOne: {
        filter: { _id: row._id },
        update: { $set: { service_period: String(row.created_at) < cut ? "am" : "pm" } },
      },
    });
  }

  // 한 번에 다 보내지 않는다. 몇 천 건이 한 요청에 들어가면 시간 제한에 걸린다.
  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < writes.length; i += CHUNK) {
    const part = writes.slice(i, i + CHUNK);
    if (!part.length) continue;
    await col.bulkWrite(part, { ordered: false });
    written += part.length;
  }

  store.settings[MIGRATION_FLAG] = new Date().toISOString();
  await save();
  console.log(
    `[migration] 오전/오후 표 백필: ${written}건 채움, ${skipped}건 건너뜀(가를 기준 없음), 날짜 ${cutByDate.size}일`
  );
}

module.exports = { applyServicePeriodBackfill20260910, cutFor };
