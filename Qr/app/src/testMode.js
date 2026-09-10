// 테스터 모드 — 진짜 가게를 건드리지 않고 뭐든 해보는 자리.
//
// 2026-09-10 사장님: "테스터 모드를 키면 매장 시간, 품절 이런 거 대부분의
// 것들 전부 무시한 채로 뭐든 만들 수 있게 해줘. 그리고 테스터 모드 종료를
// 하면 그 모드동안 만들었던 거 전부 원래대로 삭제하고 되돌려주는 기능."
//
// ── 이 파일에서 제일 중요한 것 ─────────────────────────────────────────
//
// **테스트는 기기 단위다. 가게 단위가 아니다.**
//
// 사장님이 테스터 모드를 켜둔 사이에도 진짜 손님은 벽에 붙은 QR 을 찍고
// 주문한다. 그것까지 테스트로 잡히면 「종료」 버튼 한 번에 받을 돈이
// 사라진다. 그래서 켜는 것은 "가게"가 아니라 **그 기기**다.
//
//   · 사장님이 관리자 화면에서 켠다 → 그 브라우저만 테스트 기기가 된다
//   · 손님 폰처럼 시험하고 싶으면 그 폰이 참여 링크를 한 번 열어야 한다
//   · 아무것도 안 한 손님 폰은 평소 그대로다 — 그 주문은 진짜로 남는다
//
// 표시는 세션에 둔다(req.session.testSessionId). 쿠키 값이 아니라 서버가
// 들고 있는 것이라 손님이 흉내낼 수 없고, 관리자 화면과 손님 화면이 같은
// 장치를 쓴다.
//
// ── 지금 켜져 있는지는 store 문서가 안다 ───────────────────────────────
//
// 활성 세션 id 는 store.settings 에 둔다. store 는 어차피 요청마다 읽으므로
// 추가 왕복이 없다(왕복 하나가 얼마나 비싼지는
// claude/2026-09-10-mongo-region.md). 그리고 종료하면 그 값이 사라지므로,
// 참여해 있던 모든 기기가 그 즉시 평소 상태로 돌아온다 — 기기마다 찾아다니며
// 끌 필요가 없다.
//
// 되돌리기에 쓸 스냅샷처럼 덩치가 있는 것은 store 문서에 넣지 않는다. 매
// 요청 같이 딸려오게 되기 때문이다. 그건 test_sessions 컬렉션에 따로 두고
// 시작할 때와 끝낼 때만 읽는다.
const crypto = require("crypto");

const COLLECTION = "test_sessions";
const SETTING_KEY = "test_session";

/** 지금 가게에 열려 있는 테스트 세션. 없으면 null. */
function active(store) {
  const s = store && store.settings && store.settings[SETTING_KEY];
  return s && s.id ? s : null;
}

/**
 * 이 요청이 테스트 기기에서 왔는가. 왔으면 그 세션 id, 아니면 null.
 *
 * 세션에 id 가 남아 있어도 그 세션이 이미 끝났으면 null 이다 — 그래서
 * 「종료」 한 번으로 참여했던 기기 전부가 같이 풀린다.
 */
function currentId(req, store) {
  const id = req && req.session && req.session.testSessionId;
  if (!id) return null;
  const cur = active(store);
  return cur && cur.id === id ? id : null;
}

/** 이 요청이 테스트 기기에서 왔는가. */
function isTest(req, store) {
  return currentId(req, store) != null;
}

/**
 * 주문·결제 같은 기록에 붙일 태그. 테스트가 아니면 아무 것도 안 붙인다
 * (진짜 기록에 쓸데없는 필드가 생기지 않게 — 필드가 없다 = 진짜다).
 */
function tag(req, store) {
  const id = currentId(req, store);
  return id ? { test_session: id } : {};
}

/** 이 기록이 테스트 것인가. */
function isTestRow(row) {
  return !!(row && row.test_session);
}

/**
 * 목록에서 무엇을 보여줄지.
 *
 * · 평소 기기 — 진짜만. 테스트 주문이 실시간 주문판에 섞이면 직원이 없는
 *   음식을 만든다.
 * · 테스트 기기 — 둘 다. 테스트하는 동안에도 진짜 손님은 오고, 그 주문을
 *   못 보면 장사를 못 한다. 대신 테스트 것은 화면에 표가 난다.
 */
function visibleTo(req, store) {
  const id = currentId(req, store);
  return id ? () => true : (row) => !isTestRow(row);
}

function newId() {
  return "ts_" + crypto.randomBytes(9).toString("hex");
}

function newToken() {
  return crypto.randomBytes(24).toString("base64url");
}

/**
 * 테스터 모드를 켠다. 이미 켜져 있으면 그것을 그대로 돌려준다 — 두 번
 * 눌렀다고 앞의 것이 미아가 되면 그때 만든 주문을 지울 방법이 없어진다.
 */
async function start(db, store, { save, by }) {
  const existing = active(store);
  if (existing) return existing;

  const session = {
    id: newId(),
    token: newToken(),
    started_at: new Date().toISOString(),
    started_by: by || null,
  };
  // 되돌릴 때 쓸 스냅샷. 배치도(tables/zones)는 사장님 판단으로 제외한다 —
  // 자리 배치는 한번 잡아두면 잘 안 바꾸고, 테스트 중에 고쳤다면 그건
  // 대개 진짜로 고치고 싶었던 것이다.
  await db.collection(COLLECTION).insertOne({
    _id: session.id,
    ...session,
    ended_at: null,
    settings_before: snapshotSettings(store),
    menu_before: snapshotMenu(store),
  });

  store.settings[SETTING_KEY] = session;
  await save();
  return session;
}

// 스냅샷에서 빼는 것: 테스트 세션 자체(자기를 담을 수 없다)와 비밀값,
// 그리고 **지금 어느 기기가 빌지를 뽑고 있는가**(print_device).
//
// 2026-09-10 사장님이 여기에 걸릴 뻔했다. 테스터 모드를 켠 뒤에 인쇄 담당을
// 가게 태블릿으로 옮겼는데, 종료하면 설정이 「켜기 전」으로 되돌아가면서
// 담당도 같이 되돌아간다 — 프린터에 닿지도 못하는 기기로. 그러면 그 순간부터
// 자동 인쇄가 조용히 멈추고, 아무도 이유를 모른다.
//
// print_device 는 「가게를 어떻게 운영하는가」가 아니라 「지금 어느 기기가
// 켜져 있는가」다. 테스트로 만든 값이 아니므로 되돌릴 대상도 아니다.
const SNAPSHOT_SKIP = new Set([SETTING_KEY, "print_device"]);

function snapshotSettings(store) {
  const out = {};
  for (const [k, v] of Object.entries(store.settings || {})) {
    if (SNAPSHOT_SKIP.has(k)) continue;
    out[k] = v;
  }
  return JSON.parse(JSON.stringify(out));
}

function snapshotMenu(store) {
  return JSON.parse(
    JSON.stringify({
      categories: store.categories || [],
      menuItems: store.menuItems || [],
    })
  );
}

// ── 종료 ──────────────────────────────────────────────────────────────
//
// 사장님이 고른 것은 "숨기기"가 아니라 **완전 삭제**다. 9/8 때와 다른
// 판단인데, 그때는 이미 쌓인 몇 달치를 다루는 얘기였고 이건 방금 몇 분간
// 만든 것이라 그럴 만하다(claude/2026-09-10-mongo-region.md 옆의 판단들).
//
// 지운 것은 되돌릴 수 없으므로, 지우기 전에 **무엇이 사라지는지 먼저
// 보여준다**(previewEnd). 특히 설정과 메뉴는 "테스트가 바꾼 것"과 "그
// 사이 다른 직원이 진짜로 바꾼 것"을 자동으로는 가를 수 없다. 목록을 눈으로
// 보고 확인을 누르는 것이 그 둘을 가르는 유일하게 정직한 방법이다.

// 태그가 붙는 컬렉션들. vipCards 는 store 문서 안의 배열이라 따로 다룬다.
const TAGGED_COLLECTIONS = ["orders", "payments", "daily_settlements", "reservations"];

async function countTagged(db, id) {
  const out = {};
  for (const name of TAGGED_COLLECTIONS) {
    out[name] = await db.collection(name).countDocuments({ test_session: id });
  }
  return out;
}

/** 스냅샷과 지금을 견줘 무엇이 달라졌는지. 되돌리기 전에 보여줄 목록. */
function settingsDiff(store, before) {
  const now = snapshotSettings(store);
  const keys = new Set([...Object.keys(now), ...Object.keys(before || {})]);
  const changed = [];
  for (const k of keys) {
    const a = JSON.stringify(before ? before[k] : undefined);
    const b = JSON.stringify(now[k]);
    if (a !== b) changed.push(k);
  }
  return changed.sort();
}

function menuDiff(store, before) {
  const beforeItems = new Map((before && before.menuItems ? before.menuItems : []).map((m) => [m.id, m]));
  const nowItems = new Map((store.menuItems || []).map((m) => [m.id, m]));
  const added = [];
  const removed = [];
  const modified = [];
  for (const [id, m] of nowItems) {
    if (!beforeItems.has(id)) added.push({ id, name: m.name_ko || m.name_zh || String(id) });
    else if (JSON.stringify(beforeItems.get(id)) !== JSON.stringify(m))
      modified.push({ id, name: m.name_ko || m.name_zh || String(id) });
  }
  for (const [id, m] of beforeItems) {
    if (!nowItems.has(id)) removed.push({ id, name: m.name_ko || m.name_zh || String(id) });
  }
  const catsChanged =
    JSON.stringify((before && before.categories) || []) !== JSON.stringify(store.categories || []);
  return { added, removed, modified, catsChanged };
}

/** 사진: 지금은 쓰이는데 스냅샷에는 없던 것 = 테스트 중에 올린 것. */
function orphanPhotoIds(store, before) {
  const ids = (list) =>
    new Set(
      (list || [])
        .map((m) => m && m.photo_url)
        .filter((u) => typeof u === "string" && u.startsWith("/api/photo/"))
        .map((u) => u.slice("/api/photo/".length))
    );
  const then = ids(before && before.menuItems);
  const now = ids(store.menuItems);
  return [...now].filter((id) => !then.has(id));
}

/** 종료하면 무엇이 사라지는지. 아무것도 바꾸지 않는다. */
async function previewEnd(db, store) {
  const cur = active(store);
  if (!cur) return null;
  const doc = await db.collection(COLLECTION).findOne({ _id: cur.id });
  const before = doc || {};
  return {
    session: cur,
    rows: await countTagged(db, cur.id),
    vipCards: (store.vipCards || []).filter(isTestRow).length,
    settings: settingsDiff(store, before.settings_before),
    menu: menuDiff(store, before.menu_before),
    photos: orphanPhotoIds(store, before.menu_before).length,
  };
}

/**
 * 테스터 모드를 끄고 되돌린다.
 *
 * revertSettings / revertMenu 를 false 로 주면 그 부분은 손대지 않는다 —
 * 미리보기를 보고 "이건 진짜로 바꾼 거라 두고 싶다"고 할 때를 위해서다.
 * 태그가 붙은 기록(주문·결제·정산·예약)은 언제나 지운다. 그건 테스트
 * 기기가 만든 것이 확실하다.
 */
async function end(db, store, { save, deletePhoto }, opts = {}) {
  const cur = active(store);
  if (!cur) return null;
  const revertSettings = opts.revertSettings !== false;
  const revertMenu = opts.revertMenu !== false;

  const doc = (await db.collection(COLLECTION).findOne({ _id: cur.id })) || {};
  const deleted = {};
  for (const name of TAGGED_COLLECTIONS) {
    const r = await db.collection(name).deleteMany({ test_session: cur.id });
    deleted[name] = r.deletedCount || 0;
  }

  // 메모리에 들고 있는 것들도 같이 턴다. 다음 요청의 refreshStore 가
  // 어차피 다시 읽지만, 이 요청의 응답도 맞아야 한다.
  deleted.vipCards = (store.vipCards || []).filter(isTestRow).length;
  store.vipCards = (store.vipCards || []).filter((c) => !isTestRow(c));
  store.orders = (store.orders || []).filter((o) => !isTestRow(o));

  let photosDeleted = 0;
  if (revertMenu) {
    for (const id of orphanPhotoIds(store, doc.menu_before)) {
      try {
        await deletePhoto(id);
        photosDeleted++;
      } catch (e) {
        // 사진 하나 못 지운다고 종료가 실패하면 안 된다. 남으면 고아
        // 사진이 하나 생길 뿐이고, 그건 조용한 손해가 아니다.
        console.error("[testMode] 사진 삭제 실패:", id, e.message);
      }
    }
    if (doc.menu_before) {
      store.categories = JSON.parse(JSON.stringify(doc.menu_before.categories || []));
      store.menuItems = JSON.parse(JSON.stringify(doc.menu_before.menuItems || []));
    }
  }

  if (revertSettings && doc.settings_before) {
    for (const k of Object.keys(store.settings)) {
      if (SNAPSHOT_SKIP.has(k)) continue;
      if (!(k in doc.settings_before)) delete store.settings[k];
    }
    for (const [k, v] of Object.entries(doc.settings_before)) {
      store.settings[k] = JSON.parse(JSON.stringify(v));
    }
  }

  // 이건 무엇을 되돌리든 항상 지운다. 남아 있으면 참여했던 기기들이
  // 계속 테스트 기기로 남는다.
  delete store.settings[SETTING_KEY];
  await save();

  await db
    .collection(COLLECTION)
    .updateOne(
      { _id: cur.id },
      { $set: { ended_at: new Date().toISOString(), deleted, photos_deleted: photosDeleted, reverted: { settings: revertSettings, menu: revertMenu } } }
    );

  return { session: cur, deleted, photosDeleted };
}

module.exports = {
  TAGGED_COLLECTIONS,
  previewEnd,
  end,
  settingsDiff,
  menuDiff,
  orphanPhotoIds,
  COLLECTION,
  SETTING_KEY,
  active,
  currentId,
  isTest,
  tag,
  isTestRow,
  visibleTo,
  start,
  snapshotSettings,
  snapshotMenu,
  newId,
  newToken,
};
