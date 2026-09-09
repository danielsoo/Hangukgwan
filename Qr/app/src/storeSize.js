// store 문서가 얼마나 커졌는지 스스로 지켜본다.
//
// 2026-09-10 사장님: "3-4년 후에 내가 잊으면 큰일이잖아."
//
// 맞는 걱정이다. 주문을 밖으로 뺀 뒤에도 payments / daily_settlements /
// reservations 는 계속 쌓이고, 다 합쳐 연 3~4MB쯤 늘어난다. MongoDB 문서
// 하나는 16MB가 한도라 4년쯤 뒤에는 저장 자체가 실패한다 — 그때가 되면
// 주문이 안 들어가고, 원인은 화면 어디에도 안 나온다.
//
// 그러니 사람이 기억할 일로 두지 않는다. 품절을 직원이 다음 날 잊어버리는
// 문제와 똑같은 모양이고, 답도 똑같다 — 시스템이 알려준다.
//
// 매일 밤 마감 정산이 돌 때(src/routes/settlements.js 의 cron-close) 크기를
// 재서 설정에 남긴다. 기준을 넘으면 관리자 화면 맨 위에 띠가 뜨고, 마감
// 정산 LINE 메시지에도 한 줄이 붙는다. 넉넉한 여유를 두고 알리므로,
// 알림을 본 뒤에 몇 달을 더 두고 천천히 옮겨도 된다.
const LIMIT_BYTES = 16 * 1024 * 1024; // MongoDB 문서 한 개의 한도

// 알리기 시작하는 지점. 한도의 25%다. 연 3~4MB로 늘어나는 속도라면 여기서
// 한도까지 3년쯤 남는다 — "급하다"가 아니라 "슬슬 준비하자"는 신호다.
const WARN_BYTES = 4 * 1024 * 1024;
// 여기부터는 미루면 안 된다. 한도의 60%.
const URGENT_BYTES = 10 * 1024 * 1024;

const SETTING_BYTES = "store_doc_bytes";
const SETTING_CHECKED_AT = "store_doc_checked_at";

/** 문서 한 개의 바이트 수. BSON 이 아니라 JSON 기준이라 정확한 값은 아니고,
 *  크기 흐름을 보기 위한 어림값이다 — 기준을 한도의 25%로 낮게 잡은 이유다. */
function measureBytes(doc) {
  return Buffer.byteLength(JSON.stringify(doc || {}));
}

/** 어느 항목이 얼마나 차지하는지 — 무엇부터 빼야 하는지 알려면 필요하다. */
function breakdown(doc) {
  return Object.entries(doc || {})
    .map(([key, value]) => ({
      key,
      bytes: measureBytes(value),
      rows: Array.isArray(value) ? value.length : null,
    }))
    .sort((a, b) => b.bytes - a.bytes);
}

function levelFor(bytes) {
  if (bytes >= URGENT_BYTES) return "urgent";
  if (bytes >= WARN_BYTES) return "warn";
  return "ok";
}

/**
 * 지금 크기를 재서 store.settings 에 남긴다. 관리자 화면과 LINE 메시지가
 * 이 값을 읽는다. 실패해도 마감 정산을 막지 않는다 — 크기 확인 때문에
 * 정산이 안 되는 건 본말전도다.
 */
async function recordStoreSize(store, { getDb, connectDB, nowLocal }) {
  try {
    await connectDB();
    const doc = await getDb().collection("store").findOne({ _id: "main" });
    const bytes = measureBytes(doc);
    store.settings[SETTING_BYTES] = bytes;
    store.settings[SETTING_CHECKED_AT] = nowLocal();
    return { bytes, level: levelFor(bytes), breakdown: breakdown(doc) };
  } catch (e) {
    console.warn("store 문서 크기 확인 실패:", e.message);
    return null;
  }
}

/** 마감 정산 LINE 메시지에 붙일 한 줄. 기준 아래면 아무 말도 하지 않는다. */
function sizeWarningLine(bytes) {
  const level = levelFor(bytes || 0);
  if (level === "ok") return null;
  const mb = (bytes / 1024 / 1024).toFixed(1);
  // 크기만 알려주면 아무도 무엇을 해야 할지 모른다. 무엇을, 왜, 안 하면
  // 어떻게 되는지를 한 줄 안에 담는다.
  if (level === "urgent") {
    return `🚨 데이터 저장 공간 ${mb}MB / 16MB — 한도에 닿으면 주문이 저장되지 않습니다. 개발자에게 "store 문서 분리"를 지금 요청하세요.`;
  }
  return `ℹ️ 데이터 저장 공간 ${mb}MB / 16MB — 한도에 닿으면 주문이 저장되지 않습니다. 아직 여유는 있으니, 슬슬 개발자에게 "store 문서 분리"를 이야기해 두세요.`;
}

module.exports = {
  LIMIT_BYTES, WARN_BYTES, URGENT_BYTES, SETTING_BYTES, SETTING_CHECKED_AT,
  measureBytes, breakdown, levelFor, recordStoreSize, sizeWarningLine,
};
