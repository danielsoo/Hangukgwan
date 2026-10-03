// 출근 카드 사진 → 표 (src/payrollVision.js).
//
// 2026-10-03 사장님: "사진 넣으면 자동으로 넣는 걸 넣어줘." 진짜 Claude 는 부르지
// 않는다 — 가짜 클라이언트로 「무엇을 보내는가」와 「받은 답을 어떻게 다듬는가」를 잰다.
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = {
  id: require.resolve("mongodb"), filename: require.resolve("mongodb"),
  loaded: true, exports: fake, paths: [],
};
process.env.MONGODB_URI = "mongodb://fake/test";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "payroll-vision";
process.env.ADMIN_PASSWORD = "ownerpass123";
delete process.env.ANTHROPIC_API_KEY;

const V = require("../src/payrollVision");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

// 사장님이 보내신 ★ 카드(劉芷芸 115년 6월)를 모델이 읽었다고 치고.
const STAR_ANSWER = {
  name: "劉芷芸", roc_year: 115, month: 6, star: true,
  days: [
    { day: 6, am_in: "09:11", am_out: "14:02", pm_in: "16:10", pm_out: "21:00", ot_in: null, ot_out: null },
    { day: 12, am_in: "9:04", am_out: "14:00", pm_in: "16:11", pm_out: "21:08", ot_in: null, ot_out: null },
    { day: 19, am_in: "09:00", am_out: "14:07", pm_in: "16:07", pm_out: "21:06", ot_in: null, ot_out: null },
    { day: 25, am_in: "09:11", am_out: "14:00", pm_in: "16:14", pm_out: "20:58", ot_in: null, ot_out: null },
    { day: 40, am_in: "09:00", am_out: null, pm_in: null, pm_out: null, ot_in: null, ot_out: null },
    { day: 7, am_in: "25:99", am_out: null, pm_in: null, pm_out: null, ot_in: null, ot_out: null },
  ],
  unclear: [{ day: 19, slot: "pm_out", note: "smudged" }],
};
function fakeClient(answer, { stop = "end_turn", throws = null } = {}) {
  const calls = [];
  return {
    calls,
    beta: { messages: { create: async (req) => {
      calls.push(req);
      if (throws) throw throws;
      return { stop_reason: stop, content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(answer) }] };
    } } },
  };
}

(async () => {
  out.push("[키가 없으면]");
  let r = await V.readCard(Buffer.from("x"), "image/jpeg");
  check("★ 키가 없으면 읽지 않고 이유를 말한다", !r.ok && r.error === "no_vision_key", JSON.stringify(r));
  check("상태도 「키 없음」", V.hasKey() === false, "");

  out.push("\n[보내는 것]");
  const c = fakeClient(STAR_ANSWER);
  r = await V.readCard(Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg", c);
  const req = c.calls[0];
  check("★ 모델 claude-opus-5-5", req.model === "claude-opus-5-5", req.model);
  check("★ 사진을 base64 그림으로 보낸다", req.messages[0].content[0].type === "image" && req.messages[0].content[0].source.type === "base64" && req.messages[0].content[0].source.data === "/9j/", JSON.stringify(req.messages[0].content[0].source).slice(0, 80));
  check("★ 구조화 출력(json_schema)으로 표 모양만 받는다", req.output_config.format.type === "json_schema" && req.output_config.format.schema.additionalProperties === false, "");
  check("거절되면 서버가 다른 모델로 — fallbacks default", req.fallbacks === "default" && req.betas.includes("server-side-fallback-2026-07-01"), "");
  check("지시문: 날짜 접두는 버리고, 손글씨 고침을 따르고, 사장님 메모는 무시", /ignore that prefix/.test(V.PROMPT) && /handwritten time/.test(V.PROMPT) && /21 \+ 4/.test(V.PROMPT) && /star/.test(V.PROMPT), "");

  out.push("\n[받은 답 다듬기]");
  check("읽었다", r.ok, JSON.stringify(r));
  const card = r.card;
  check("★ 민국 115년 6월 → 2026-06", card.year === 2026 && card.month === 6, `${card.year}-${card.month}`);
  check("★ 별 카드", card.star === true, "");
  check("이름", card.name === "劉芷芸", "");
  check("★ 4일을 읽었다(이상한 날짜 40일·이상한 시각은 버린다)", Object.keys(card.days).sort().join(",") === "12,19,25,6", Object.keys(card.days).join(","));
  check("9:04 → 09:04", card.days["12"].am_in === "09:04", "");
  check("빈 칸(null)은 넣지 않는다", !("ot_in" in card.days["6"]), JSON.stringify(card.days["6"]));
  check("★ 확실치 않은 칸을 같이 준다", card.unclear.length === 1 && card.unclear[0].slot === "pm_out" && card.unclear[0].day === 19, JSON.stringify(card.unclear));

  out.push("\n[못 읽었을 때]");
  r = await V.readCard(Buffer.from("x"), "image/jpeg", fakeClient(null, { stop: "refusal" }));
  check("거절 → 이유", !r.ok && r.error === "vision_refused", JSON.stringify(r));
  r = await V.readCard(Buffer.from("x"), "image/jpeg", { beta: { messages: { create: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }) } } });
  check("JSON 이 아니면 → 이유", !r.ok && r.error === "vision_unreadable", JSON.stringify(r));
  r = await V.readCard(Buffer.from("x"), "application/pdf", fakeClient(STAR_ANSWER));
  check("그림이 아니면 → 이유", !r.ok && r.error === "bad_image", "");
  const Anthropic = require("@anthropic-ai/sdk").default;
  r = await V.readCard(Buffer.from("x"), "image/jpeg", fakeClient(null, { throws: new Error("socket hang up") }));
  check("연결 실패 → 이유", !r.ok && r.error === "vision_unreachable", JSON.stringify(r));
  check("SDK 의 오류 종류로 가른다(글자 비교 안 함)", typeof Anthropic.AuthenticationError === "function" && typeof Anthropic.RateLimitError === "function", "");

  out.push("\n[서버 — 사진은 저장하지 않는다]");
  const request = require("supertest");
  const app = require("../server");
  await request(app).get("/api/menu");
  const boss = request.agent(app);
  await boss.post("/api/auth/login").send({ password: "ownerpass123" });
  let res = await boss.get("/api/payroll/status");
  check("상태: 키 없음", res.body.vision === false, JSON.stringify(res.body.vision));
  res = await boss.post("/api/payroll/read-card").attach("photo", Buffer.from([0xff, 0xd8, 0xff, 0xe0]), { filename: "c.jpg", contentType: "image/jpeg" });
  check("★ 키 없으면 503 + 이유", res.status === 503 && res.body.error === "no_vision_key", `${res.status} ${JSON.stringify(res.body)}`);
  const fc = fakeClient(STAR_ANSWER);
  V.setClientForTest(fc);
  res = await boss.post("/api/payroll/read-card").attach("photo", Buffer.from([0xff, 0xd8, 0xff, 0xe0]), { filename: "c.jpg", contentType: "image/jpeg" });
  check("★ 읽은 표를 돌려준다", res.status === 200 && res.body.ok && res.body.card.star && Object.keys(res.body.card.days).length === 4, JSON.stringify(res.body).slice(0, 200));
  const { getDb } = require("../src/db");
  const cards = await getDb().collection("payroll_cards").find({}).toArray();
  check("★★ 읽기만 하고 저장하지 않는다", cards.length === 0, String(cards.length));
  const anon = await request(app).post("/api/payroll/read-card").attach("photo", Buffer.from([0xff, 0xd8]), { filename: "c.jpg", contentType: "image/jpeg" });
  check("★ 로그인 안 하면 못 쓴다(남의 사진을 우리 키로 못 읽힌다)", anon.status === 401 || anon.status === 403, String(anon.status));
  check("로그인 안 한 요청은 모델을 부르지 않았다", fc.calls.length === 1, String(fc.calls.length));
  V.setClientForTest(null);

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
