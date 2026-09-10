// 이 주문이 점심 장사 것인가 저녁 장사 것인가.
//
// 사장님(2026-09-10): "오전 오후를 정산으로 가르는 거 같은데 그거 말고도
// 시간으로도 가를 수 있잖아. 주문이 들어온 시간을 몽고디비에 오전인지
// 오후인지 같이 저장하면 되는 거 아니야?"
//
// 맞다. 그리고 그게 더 튼튼하다.
//
// 정산 버튼을 눌렀는지에 기대면, 안 누른 날은 그날 매출을 영영 못 가른다.
// 주문이 들어오는 순간에 표를 달아 두면 그런 날이 없다. 나중에 몇 번을
// 다시 계산해도 같은 답이 나오고, 영업시간을 바꿔도 옛 주문의 표는 그대로다.
//
// ── 기준은 하나만 둔다 ────────────────────────────────────────────────
//
// 이 한 시각이 세 곳에서 같이 쓰인다. 따로 정하면 반드시 어긋난다.
//
//   · 주문에 다는 표 (아래 serviceOf)
//   · 오전 정산을 안 눌렀을 때 대신 눌러주는 시각 (routes/settlements.js)
//   · 결산에서 오전/오후를 가르는 경계 (settlement.js)
//
// 값은 **저녁 영업 시작 5분 전**이다. 그 순간에는 점심 장사가 확실히 끝나
// 있고 저녁 손님은 아직 안 들어왔다 — 어느 쪽에 넣어야 할지 헷갈리는 것이
// 없는 유일한 틈이다(사장님: "그렇게 하면 섞일 염려가 전혀 없을 것 같아").
const { rangesForDate, orderHours } = require("./openHours");

const LEAD_MIN = 5;

/**
 * 그날 오전과 오후를 가르는 시각 "HH:MM". 가를 수 없으면 null.
 *
 * 한 타임만 하는 날은 null 이다. 하루를 통으로 여는 가게에서 억지로 반을
 * 가르면 그 숫자가 무엇을 뜻하는지 아무도 모른다.
 */
function serviceCutHm(settings, dateStr) {
  const ranges = rangesForDate(orderHours(settings), dateStr) || [];
  if (ranges.length < 2) return null;
  const start = ranges[ranges.length - 1].start;
  if (!start) return null;
  const [h, m] = String(start).split(":").map((x) => parseInt(x, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const total = h * 60 + m - LEAD_MIN;
  if (total < 0) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** 같은 시각을 "YYYY-MM-DD HH:MM:SS" 로. 가를 수 없으면 null. */
function serviceCutAt(settings, dateStr) {
  const hm = serviceCutHm(settings, dateStr);
  return hm ? `${dateStr} ${hm}:00` : null;
}

/**
 * 이 시각의 주문은 어느 장사 것인가. "am" | "pm", 가를 수 없으면 null.
 *
 * @param localTs "YYYY-MM-DD HH:MM:SS" (타이베이 시각, src/time.js nowLocal)
 */
function serviceOf(settings, localTs) {
  const ts = String(localTs || "");
  const date = ts.slice(0, 10);
  if (date.length !== 10) return null;
  const cut = serviceCutAt(settings, date);
  if (!cut) return null;
  return ts < cut ? "am" : "pm";
}

module.exports = { serviceOf, serviceCutAt, serviceCutHm, LEAD_MIN };
