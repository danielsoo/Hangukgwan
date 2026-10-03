// 출근 카드 사진을 읽는다 (2026-10-03).
//
// 사장님: "사진 넣으면 자동으로 넣는 걸 넣어줘." 카드 사진을 Claude(Anthropic API)에
// 보내 표를 JSON 으로 받는다. 카드는 출근 기계가 찍은 도트 숫자에 작게 옆으로 누운
// 날짜 접두가 붙어 있어 일반 OCR 로는 섞인다 — 그림을 읽는 모델이 필요하다.
//
// ── 지키는 것
//   · 사진에는 직원 이름과 근태가 들어 있다. 사장님이 알고 고르신 일이다(2026-10-03:
//     바깥 AI 로 보낸다는 것을 듣고 "넣어줘"). 사진은 저장하지 않는다 — 읽고 버린다.
//   · 읽은 값은 **바로 저장하지 않는다.** 화면의 표에 채워 넣을 뿐이고, 사장님이 보고
//     「카드 저장」을 눌러야 들어간다. 잘못 읽은 칸은 거기서 고친다.
//   · 키는 Vercel 환경변수 ANTHROPIC_API_KEY 에만 둔다(CLAUDE.md 「비밀값」). 없으면
//     읽지 않고 이유를 돌려준다 — 표에 직접 넣는 길은 그대로 열려 있다.

const MODEL = "claude-opus-5-5";
const MEDIA = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const SLOTS = ["am_in", "am_out", "pm_in", "pm_out", "ot_in", "ot_out"];

const TIME = { anyOf: [{ type: "string" }, { type: "null" }] };
// 답의 모양 — 구조화 출력(output_config.format)으로 이 모양만 받는다.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "roc_year", "month", "star", "days", "unclear"],
  properties: {
    name: { anyOf: [{ type: "string" }, { type: "null" }] },
    roc_year: { anyOf: [{ type: "integer" }, { type: "null" }] },
    month: { anyOf: [{ type: "integer" }, { type: "null" }] },
    star: { type: "boolean" },
    days: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["day", ...SLOTS],
        properties: { day: { type: "integer" }, ...Object.fromEntries(SLOTS.map((s) => [s, TIME])) },
      },
    },
    unclear: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["day", "slot", "note"],
        properties: { day: { type: "integer" }, slot: { type: "string" }, note: { type: "string" } },
      },
    },
  },
};

const PROMPT = `This photo shows a Taiwanese paper time card (考勤卡) punched by a time clock.
The card may show one side or both sides: the blue side holds days 1-15, the orange side days 16-31.
Each row is a day (日期). Columns, left to right:
上午 上班 (am_in), 上午 下班 (am_out), 下午 上班 (pm_in), 下午 下班 (pm_out), 加班 上班 (ot_in), 加班 下班 (ot_out).
Each punched cell has a tiny rotated day number printed before the time (for example "28" then "09:02") - ignore that prefix and keep only the HH:MM time.
If a punched time is crossed out or overwritten by a handwritten time, use the handwritten time.
Ignore notes the owner wrote in red or in the margins (like "0.5", "1", "21 + 4") - they are not punches.
A red star (★ or ✡) drawn near "NO." means this is the star card; set star to true.
Read the handwritten name (姓名) and the year and month (for example "115年 6月份" means roc_year 115, month 6).
Only list days that have at least one time, using 24-hour HH:MM and null for empty cells.
List any cell you are not sure about in unclear, with the day, the slot name, and a short note.`;

function hasKey() {
  return !!(process.env.ANTHROPIC_API_KEY || injected);
}

let clientInstance = null;
let injected = null; // 시험용 가짜(setClientForTest)
function defaultClient() {
  if (!clientInstance) {
    const Anthropic = require("@anthropic-ai/sdk").default;
    clientInstance = new Anthropic(); // ANTHROPIC_API_KEY 를 환경에서 읽는다
  }
  return clientInstance;
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
/** 모델의 답을 표에 넣을 모양으로. 이상한 값은 버린다. */
function normalize(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {
    name: typeof raw.name === "string" ? raw.name.trim().slice(0, 30) || null : null,
    star: !!raw.star,
    year: null,
    month: null,
    days: {},
    unclear: [],
  };
  const roc = Number(raw.roc_year);
  if (Number.isFinite(roc) && roc > 90 && roc < 200) out.year = roc + 1911;
  else if (Number.isFinite(roc) && roc > 2000 && roc < 2200) out.year = roc;
  const m = Number(raw.month);
  if (m >= 1 && m <= 12) out.month = m;
  for (const d of Array.isArray(raw.days) ? raw.days : []) {
    const day = Number(d && d.day);
    if (!(day >= 1 && day <= 31)) continue;
    const row = {};
    for (const s of SLOTS) {
      const t = TIME_RE.exec(String((d && d[s]) || "").trim());
      if (t) row[s] = `${t[1].padStart(2, "0")}:${t[2]}`;
    }
    if (Object.keys(row).length) out.days[String(day)] = { ...(out.days[String(day)] || {}), ...row };
  }
  for (const u of Array.isArray(raw.unclear) ? raw.unclear.slice(0, 60) : []) {
    const day = Number(u && u.day);
    if (day >= 1 && day <= 31) out.unclear.push({ day, slot: SLOTS.includes(u.slot) ? u.slot : null, note: String(u.note || "").slice(0, 80) });
  }
  return out;
}

/**
 * buffer: 사진 바이트. 돌려주는 값: { ok, card? , error? }.
 * client 는 시험에서 가짜를 넣는다.
 */
async function readCard(buffer, mediaType, client = null) {
  client = client || injected;
  if (!client && !hasKey()) return { ok: false, error: "no_vision_key" };
  if (!MEDIA.includes(mediaType) || !buffer || !buffer.length) return { ok: false, error: "bad_image" };
  const api = client || defaultClient();
  let response;
  try {
    response = await api.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // 거절되면 서버가 알아서 다른 모델로 다시 돌린다(분류는 서버가 고른다).
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: Buffer.from(buffer).toString("base64") } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });
  } catch (e) {
    const Anthropic = safeSdk();
    if (Anthropic && e instanceof Anthropic.AuthenticationError) return { ok: false, error: "vision_key_rejected" };
    if (Anthropic && e instanceof Anthropic.RateLimitError) return { ok: false, error: "vision_busy" };
    if (Anthropic && e instanceof Anthropic.BadRequestError) return { ok: false, error: "vision_bad_request", detail: String(e.message || "").slice(0, 200) };
    if (Anthropic && e instanceof Anthropic.APIError) return { ok: false, error: "vision_failed", status: e.status };
    return { ok: false, error: "vision_unreachable" };
  }
  if (!response || response.stop_reason === "refusal") return { ok: false, error: "vision_refused" };
  if (response.stop_reason === "max_tokens") return { ok: false, error: "vision_unreadable" };
  const text = (response.content || []).filter((b) => b && b.type === "text").map((b) => b.text).join("");
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    parsed = null;
  }
  const card = normalize(parsed);
  if (!card) return { ok: false, error: "vision_unreadable" };
  return { ok: true, card };
}

function safeSdk() {
  try {
    return require("@anthropic-ai/sdk").default;
  } catch (e) {
    return null;
  }
}

function setClientForTest(c) {
  injected = c;
}

module.exports = { readCard, hasKey, setClientForTest, normalize, PROMPT, SCHEMA, MODEL };
