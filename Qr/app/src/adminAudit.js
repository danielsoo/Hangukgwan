// 관리자 변경 감사 기록.
//
// 속도 진단용 request_log(14일)와 분리한다. 여기는 사람이 실제로 바꾸려 한
// 작업만 MongoDB에 남기며, 사장 화면에서 「누가·어디서·어떤 기기로·무엇을」
// 했는지 확인하는 장부다. 이 장부는 자동 삭제하지 않는다.
//
// 요청 본문은 절대 받거나 저장하지 않는다. 비밀번호·손님 연락처·금액 입력이
// 섞일 수 있기 때문이다. 작업 분류, 가린 주소, 안전한 대상 이름만 기록한다.
const ownerActivity = require("./ownerActivity");

const COLLECTION = "admin_audit_log";
const MAX_BATCH = 300;
let queue = [];
let flushing = null;

function clean(value, max) {
  if (value === null || value === undefined || value === "") return null;
  return String(value).replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

function rowFromRequest(req, meta = {}) {
  const session = (req && req.session) || {};
  const role = session.role === "staff" ? "staff" : "owner";
  const place = ownerActivity.requestDetails(req);
  return {
    created_at: meta.createdAt instanceof Date ? meta.createdAt : new Date(),
    action: clean(meta.action, 60),
    target: clean(meta.target, 180),
    method: clean(meta.method || (req && req.method), 12),
    route: clean(meta.route, 160),
    status: Number(meta.status) || 0,
    succeeded: Number(meta.status) >= 200 && Number(meta.status) < 400,
    actor_role: role,
    actor_user_id: clean(session.userId, 80),
    actor_email: clean(session.accountEmail, 254),
    actor_name: clean(session.accountName, 100),
    actor_session_key: ownerActivity.sessionKey(req),
    ip: clean(place.ip, 80),
    city: clean(place.city, 120),
    region: clean(place.region, 120),
    country: clean(place.country, 20),
    device: clean(place.device, 160),
  };
}

function record(req, meta) {
  const row = rowFromRequest(req, meta);
  if (!row.action) return false;
  queue.push(row);
  return true;
}

function pending() {
  return queue.length;
}

// 변경 요청 자체에 MongoDB 왕복을 하나 더 붙이지 않는다. 다음 API 요청이
// store를 읽을 때 그 읽기와 나란히 묶어서 저장한다. 실패하면 감사 줄은
// 버리지 않고 맨 앞으로 되돌려 다음 요청에서 다시 시도한다.
async function flush(db) {
  if (flushing) return flushing;
  if (!db || !queue.length) return 0;
  const rows = queue.splice(0, MAX_BATCH);
  flushing = db.collection(COLLECTION).insertMany(rows, { ordered: false })
    .then(() => rows.length)
    .catch((e) => {
      queue = rows.concat(queue);
      throw e;
    })
    .finally(() => {
      flushing = null;
    });
  return flushing;
}

module.exports = { COLLECTION, MAX_BATCH, rowFromRequest, record, pending, flush };
