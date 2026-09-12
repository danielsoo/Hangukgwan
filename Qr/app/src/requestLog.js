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
// 도로 늘리는 셈이다. 그래서 두 가지를 지킨다.
//
//  1. **요청 안에서 쓰지 않는다.** 잰 값은 메모리에 담아만 두고, **다음**
//     요청이 올 때 store 를 읽는 것과 **나란히** 내보낸다. 나란히 가므로
//     그 요청이 더 기다리는 시간은 사실상 0 이다. 인스턴스가 죽으면 담아둔
//     몇 줄은 사라지는데, 진단 기록이라 그래도 된다.
//  2. **전부 쓰지 않는다.** 느린 요청과 콜드 스타트는 반드시 쓰고, 나머지는
//     스무 번에 한 번만 쓴다. 빠른 요청은 이미 답을 알고 있어서 다 적을
//     이유가 없다. 다만 「평소엔 얼마나 빠른가」를 알아야 느린 것이 얼마나
//     드문지 말할 수 있으므로, 표본은 남긴다.
//
// 무한정 쌓이지도 않는다 — created_at 에 14일 TTL 을 걸어 몽고가 알아서
// 지운다. 무료 M0 는 512MB 라 이걸 안 걸면 언젠가 가게가 멈춘다.
const COLLECTION = "request_log";
const KEEP_DAYS = 14;
const SLOW_MS = 400; // 이보다 느린 요청은 무조건 남긴다
const SAMPLE_EVERY = 20; // 빠른 요청은 스무 번에 한 번
const MAX_QUEUE = 50; // 못 내보내는 동안 메모리가 불어나지 않게

let queue = [];
let seen = 0;
let indexReady = false;

/** /api/orders/123 → /api/orders/:id — 숫자가 낀 주소를 한 줄로 모은다. */
function routeOf(pathname) {
  return String(pathname || "")
    .split("/")
    .map((seg) => (/^\d+$/.test(seg) ? ":id" : seg))
    .join("/")
    .slice(0, 120);
}

/**
 * 이 요청을 남길 것인가.
 *
 * 느린 것과 콜드 스타트는 그 자체가 찾던 답이라 무조건 남긴다. 나머지는
 * 표본만 — "평소에는 이만큼 빠르다"를 말할 수 있을 정도면 된다.
 */
function shouldKeep(entry) {
  if (entry.ms >= SLOW_MS) return true;
  if (entry.cold) return true;
  if (entry.status >= 400) return true;
  return seen % SAMPLE_EVERY === 0;
}

function record(entry) {
  seen++;
  if (!shouldKeep(entry)) return;
  if (queue.length >= MAX_QUEUE) queue.shift(); // 오래된 것부터 버린다
  queue.push(entry);
}

function pending() {
  return queue.length;
}

/**
 * 담아둔 것을 내보낸다. **부르는 쪽이 다른 읽기와 나란히 돌려야 한다** —
 * 줄줄이 세우면 이 파일이 막으려던 바로 그 일이 된다.
 */
async function flush(db) {
  if (!db || !queue.length) return;
  const rows = queue;
  queue = [];
  try {
    if (!indexReady) {
      indexReady = true;
      // 이미 있으면 아무 일도 안 한다. 실패해도 기록은 계속된다.
      db.collection(COLLECTION)
        .createIndex({ created_at: 1 }, { expireAfterSeconds: KEEP_DAYS * 24 * 60 * 60 })
        .catch(() => {});
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

module.exports = { COLLECTION, KEEP_DAYS, SLOW_MS, SAMPLE_EVERY, routeOf, record, pending, flush, lastFlushError };
