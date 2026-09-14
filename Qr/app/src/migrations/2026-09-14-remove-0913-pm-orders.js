// 9/13 오후 주문 20건을 장부에서 뺀다 (2026-09-14).
//
// 사장님(2026-09-14): "어제 (9/13 오후) 결제 및 미결제, 토탈 20건에 대한
// 자료를 삭제해줘." → 이어서 "그냥 13일 오후 전부를 없애줘."
//
// 그래서 결제 20건만이 아니라 **오후 24건 전부**다(취소 4건 포함).
//
// 실제 매출 기록을 지우는 일이라 지우기 전에 확인한 값들을 여기 남긴다.
// 나중에 "이게 왜 없지"가 되었을 때 이 파일이 답이 되어야 한다.
//
//     9/13 오전   결제 43건  35,335   취소 5건   ← 그대로 둔다
//     9/13 오후   결제 20건  17,145   취소 4건   ← 24건 전부 뺀다
//     9/14        0건
//
//     대상 24건 전부: 날짜 2026-09-13 / service_period "pm"
//     상태는 paid 20 + cancelled 4, 생성 시각 17:01 ~ 17:58
//
// 오전 구분이 안 붙은 주문이 하루에 하나 있었는데(578번, 11:37, 300원)
// 시각이 오전이라 손대지 않는다. 「오후」는 service_period 가 정한다.
//
// ★ 지우지 않고 **옮긴다.**
//
// 사장님은 영구 삭제를 고르셨고, 화면·결산·주문 목록 어디에서도 이 20건은
// 완전히 사라진다. 다만 orders 컬렉션에서 곧바로 없애는 대신 보관함
// 컬렉션으로 옮긴다. 지우는 쪽이 더 "깨끗해" 보이지만, 실제 매출 기록은
// 한 번 없어지면 되돌릴 방법이 없다. 옮겨두면 계산에서는 똑같이 빠지고,
// 나중에 필요할 때만 꺼낼 수 있다. 값은 0 이고 얻는 것은 크다.
//
// 진짜로 흔적까지 없애고 싶으시면 그때 보관함을 드롭하면 된다:
//     db.orders_removed_2026_09_14.drop()
// 표 이름에 v2 가 붙은 이유 (2026-09-14):
//
// 처음 올린 판은 결제 20건만 지웠다. 그것이 먼저 배포되면서 마이그레이션이
// 한 번 돌았고 「했음」 표가 찍혔다. 그 뒤 사장님이 "그냥 13일 오후 전부를
// 없애줘" 하셔서 취소 4건을 목록에 더했는데, **표가 이미 있어서 다시 돌지
// 않았다.** 운영에서 확인하니 pm/paid 0건, pm/cancelled 4건이 남아 있었다.
//
// 마이그레이션은 「무엇을 할지」가 바뀌면 표도 새로 달아야 한다. 같은 표로
// 내용만 고치면 이미 돈 데이터베이스에는 영영 안 닿는다.
//
// 다시 돌아도 안전하다. 이미 옮긴 20건은 orders 에 없으므로 찾히지 않고,
// 남은 4건만 조건을 확인하고 옮긴다.
const MIGRATION_FLAG = "migration_2026_09_14_remove_0913_pm_applied_v2";
const ARCHIVE = "orders_removed_2026_09_14";

// 지울 것을 번호로 못 박는다. "9/13 오후를 전부"처럼 조건으로 쓰면, 나중에
// 누가 이 파일을 다시 돌렸을 때 그때의 9/13 오후를 지운다. 번호는 안 변한다.
const ORDER_IDS = [
  613, 614, 615, 616, 617, 618, 619, 620, 621, 622,
  623, 624, 625, 627, 628, 629, 630, 631, 632, 633,
  634, 635, 636, 637,
];

// 번호만 믿지 않는다. 아래가 전부 맞는 것만 옮긴다. 번호가 겹치는 사고가
// 이 가게에 실제로 있었다(2026-09-10, 9번 테이블). 엉뚱한 주문이 같은
// 번호를 달고 있으면 그건 손대면 안 되는 남의 매출이다.
//
// 상태를 끝난 것 둘로 한정하는 이유: 그날 오후는 실제로 paid 20 + cancelled
// 4 뿐이었다. 혹시 안 끝난 주문(new/preparing/served)이 그 번호에 앉아
// 있다면 그건 **아직 받을 돈**이므로 조용히 지우면 안 된다.
const REMOVABLE = new Set(["paid", "cancelled"]);

function isTarget(o) {
  return (
    o &&
    String(o.created_at || "").slice(0, 10) === "2026-09-13" &&
    o.service_period === "pm" &&
    REMOVABLE.has(o.status)
  );
}

async function applyRemove0913Pm20260914(store, { getDb, connectDB, saveFields }) {
  if (store.settings && store.settings[MIGRATION_FLAG]) return;

  await connectDB();
  const db = getDb();
  const orders = db.collection("orders");

  const found = await orders.find({ _id: { $in: ORDER_IDS } }).toArray();
  const targets = found.filter(isTarget);
  const skipped = found.filter((o) => !isTarget(o));

  if (skipped.length) {
    // 조용히 넘어가지 않는다. 지우려던 번호에 다른 주문이 앉아 있다는 뜻이다.
    console.warn(
      `[0913pm] 조건이 안 맞아 건너뜀 ${skipped.length}건:`,
      skipped.map((o) => `${o._id}(${o.created_at} ${o.service_period} ${o.status})`).join(", ")
    );
  }

  if (targets.length) {
    // 옮기는 순서가 중요하다 — 먼저 보관함에 넣고, 들어간 것을 세어 확인한
    // 뒤에 원래 자리에서 지운다. 반대로 하면 중간에 끊겼을 때 아무 데도 안
    // 남는다. 같은 것이 양쪽에 잠깐 있는 건 괜찮다.
    await db.collection(ARCHIVE).bulkWrite(
      targets.map((o) => ({
        replaceOne: {
          filter: { _id: o._id },
          replacement: { ...o, removed_at: new Date().toISOString(), removed_reason: "9/13 오후 전부 정리 (사장님 요청)" },
          upsert: true,
        },
      }))
    );
    const archived = await db.collection(ARCHIVE).countDocuments({ _id: { $in: targets.map((o) => o._id) } });
    if (archived < targets.length) {
      console.warn(`[0913pm] 보관 중단: ${archived}/${targets.length} 만 들어감. 원본은 그대로 둡니다.`);
      return; // 표도 안 남긴다 — 다음에 다시 시도한다
    }
    const r = await orders.deleteMany({ _id: { $in: targets.map((o) => o._id) } });
    const sum = targets.reduce((s, o) => s + (o.total || 0), 0);
    console.log(`[0913pm] ${r.deletedCount}건 (합계 ${sum}) 을 ${ARCHIVE} 로 옮기고 orders 에서 뺐습니다.`);
  } else {
    console.log("[0913pm] 옮길 것이 없습니다 (이미 정리됐거나 조건 불일치).");
  }

  const appliedAt = new Date().toISOString();
  store.settings = store.settings || {};
  store.settings[MIGRATION_FLAG] = appliedAt;
  await saveFields({ [`settings.${MIGRATION_FLAG}`]: appliedAt });
}

module.exports = { applyRemove0913Pm20260914, MIGRATION_FLAG, ARCHIVE, ORDER_IDS, isTarget, REMOVABLE };
