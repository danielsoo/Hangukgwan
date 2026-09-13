// 잰 것을 쌓아 둔다.
//
// 2026-09-12 사장님: "이 내용들을 로그로 기록할 수 없나? 몽고디비에 같이?
// 그러면 모든 기록들이 모이면서 알기 쉽잖아. 어차피 재는 거 기록하는 거는
// 문제없잖아"
//
// 맞다. 지금까지는 /api/_diag 를 여는 그 순간의 값만 봤다. 그런데 느린 것은
// 「가끔」 느리다 — 한산하다 바빠질 때, 인스턴스가 새로 뜰 때. 그 순간에
// 사장님이 진단 화면을 열고 있을 리가 없다. 쌓아 두면 나중에 볼 수 있다.
//
// ── 기록하느라 느려지면 안 된다 ──────────────────────────────────────
//
// 이게 이 파일의 전부다. 요청마다 몽고에 한 줄씩 쓰면, 줄이려던 왕복을
// 도로 늘리는 셈이다. 그래서 세 가지를 지킨다.
//
//  1. **요청 안에서 쓰지 않는다.** 잰 값은 메모리에 담아만 두고, **다음**
//     요청이 왔을 때 store 를 읽는 것과 **나란히** 내보낸다. 인스턴스가
//     죽으면 담아둔 몇 줄은 사라지는데, 진단 기록이라 그래도 된다.
//  2. **30초씩 모아 한 번에 쓴다.** 예전 코드는 전부 메모리에 담기는 했지만
//     다음 요청에서 바로 내보냈다. 요청이 계속 오면 결국 요청마다 insert가
//     하나씩 붙었고, 연결이 모자란 날에는 그 진단 쓰기가 장애를 더 키웠다.
//  3. **메모리 상한을 둔다.** 못 내보내는 동안에도 오래된 것부터 버리고,
//     몇 줄을 버렸는지는 다음 묶음에 같이 기록한다.
//
// 무한정 쌓이지도 않는다 — created_at 에 14일 TTL 을 걸어 몽고가 알아서
// 지운다. 무료 M0 는 512MB 라 이걸 안 걸면 언젠가 가게가 멈춘다.
const COLLECTION = "request_log";
const KEEP_DAYS = 14;
const SLOW_MS = 400; // 「느리다」의 기준. 남기고 안 남기고가 아니라 요약용이다
const MAX_QUEUE = 300; // 못 내보내는 동안 메모리가 불어나지 않게
const MAX_BATCH = 300; // 한 번에 내보내는 줄 수
const FLUSH_INTERVAL_MS = 30000; // 요청마다 쓰지 않고 이만큼 모아 한 번

let queue = [];
let dropped = 0;
let indexReady = false;
let lastFlushAt = Date.now();

/** /api/orders/123 → /api/orders/:id — 숫자가 낀 주소를 한 줄로 모은다. */
function routeOf(pathname) {
  return String(pathname || "")
    .split("/")
    .map((seg) => (/^\d+$/.test(seg) ? ":id" : seg))
    .join("/")
    .slice(0, 120);
}

// 전부 남긴다.
//
// 2026-09-12 사장님: "모든 이벤트에 속도를 측정할 수 있게 해줘. 분명 대만
// 기준 오늘 아침 영업때는 빨랐는데 저녁 영업때는 갑자기 느려졌어."
//
// 처음에는 빠른 요청을 스무 번에 한 번만 남겼다. 몽고에 쓰는 양을 줄이려는
// 것이었는데, 찾으려는 것이 **「아침과 저녁이 어떻게 다른가」**라면 표본은
// 위험하다. 저녁의 느린 순간이 통째로 빠질 수 있고, 빠져도 빠졌다는 것을
// 알 수가 없다.
//
// 그래도 몽고에 쓰는 횟수는 늘리지 않는다. 줄 수가 아니라 **쓰기 횟수**가
// 비용이기 때문이다 — 담아뒀다가 30초에 한 번의 insertMany 로 몰아
// 내보낸다. 백 줄이든 한 줄이든 쓰기는 한 번이다.
//
// 그래도 못 내보내는 동안 메모리가 불어나면 안 되니 상한을 둔다. 버릴
// 때는 **몇 줄을 버렸는지 같이 기록한다** — 조용히 비면 그게 "한산했다"로
// 읽힌다.
function record(entry) {
  if (queue.length >= MAX_QUEUE) {
    queue.shift(); // 오래된 것부터
    dropped++;
  }
  queue.push(entry);
}

function droppedCount() {
  return dropped;
}

function pending() {
  return queue.length;
}

/** 지금 내보낼 때인가. 가득 찼으면 30초를 기다리지 않는다. */
function shouldFlush(now = Date.now()) {
  return queue.length > 0 && (
    queue.length >= MAX_BATCH || now - lastFlushAt >= FLUSH_INTERVAL_MS
  );
}

/**
 * 담아둔 것을 내보낸다. **부르는 쪽이 다른 읽기와 나란히 돌려야 한다** —
 * 줄줄이 세우면 이 파일이 막으려던 바로 그 일이 된다.
 */
async function flush(db) {
  if (!db || !queue.length) return;
  // 실패해도 바로 다음 요청이 또 쓰기를 시도해 장애를 증폭하지 않게, 시도한
  // 시각 자체를 먼저 남긴다.
  lastFlushAt = Date.now();
  const rows = queue.slice(0, MAX_BATCH);
  queue = queue.slice(MAX_BATCH);
  if (dropped) {
    // 버린 줄이 있었다는 사실 자체가 데이터다 — 그 시각에 요청이 몰렸다는 뜻.
    rows.push({ created_at: new Date(), at: rows[0] && rows[0].at, route: "(dropped)", method: "-", status: 0, ms: 0, dropped });
    dropped = 0;
  }
  try {
    if (!indexReady) {
      indexReady = true;
      // 이미 있으면 아무 일도 안 한다. 연결 하나짜리 풀에서 insert와 동시에
      // 던져 대기열을 만들지 않도록 먼저 끝낸다. 실패해도 기록은 계속된다.
      try {
        await db.collection(COLLECTION)
          .createIndex({ created_at: 1 }, { expireAfterSeconds: KEEP_DAYS * 24 * 60 * 60 });
      } catch (e) {}
    }
    await db.collection(COLLECTION).insertMany(rows, { ordered: false });
  } catch (e) {
    // 기록이 실패해도 가게는 돌아야 한다. 되돌려 넣지도 않는다 — 계속
    // 실패하는 상황이면 그 줄이 영원히 다음 요청에 따라붙게 된다.
    //
    // 다만 **조용히 넘어가지는 않는다.** 2026-09-12 에 이 catch 가 실제로
    // 한 번 삼켰다(테스트용 몽고에 insertMany 가 없었다). 화면에는 그냥
    // "기록이 없습니다"로 보여서, 빠른 것과 구별이 안 됐다. 진단 화면이
    // 마지막 실패 이유를 그대로 보여주게 남겨 둔다.
    lastError = e.message;
  }
}

let lastError = null;
function lastFlushError() {
  return lastError;
}

module.exports = {
  COLLECTION, KEEP_DAYS, SLOW_MS, MAX_QUEUE, MAX_BATCH, FLUSH_INTERVAL_MS,
  routeOf, record, pending, shouldFlush, flush, lastFlushError, droppedCount,
};
