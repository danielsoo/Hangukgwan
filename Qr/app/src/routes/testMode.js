// 테스터 모드 켜고 끄기. 배경과 규칙은 src/testMode.js 주석에.
const express = require("express");
const { store, save, getDb, connectDB, deletePhoto } = require("../db");
const { requireAdmin, requireOwner } = require("../auth");
const testMode = require("../testMode");

const router = express.Router();

async function stateFor(req) {
  const cur = testMode.active(store);
  if (!cur) return { active: false, thisDevice: false, joined: 0, lastOne: false };
  const thisDevice = testMode.isTest(req, store);
  // 지금 몇 대가 참여 중인가. 「나가기」가 이 값을 보고 갈라진다
  // (src/testMode.js countJoined 주석).
  let joined = null;
  try {
    await connectDB();
    joined = await testMode.countJoined(getDb(), cur);
  } catch (e) {
    joined = null; // 못 셌다. 0 으로 뭉개지 않는다.
  }
  return {
    active: true,
    // 이 기기가 참여 중인가. 켜져 있어도 참여하지 않은 기기는 평소 그대로다.
    thisDevice,
    // 참여 중인 기기 수. null 이면 못 센 것이다.
    joined,
    // 내가 나가면 아무도 안 남는가. 못 셌으면 함부로 true 로 두지 않는다 —
    // 이 값이 곧 「나가면 지워집니다」 안내를 띄우는 조건이다.
    lastOne: !!thisDevice && joined !== null && joined <= 1,
    startedAt: cur.started_at,
    startedBy: cur.started_by || null,
    // 손님 폰을 참여시킬 링크. 토큰이 들어 있으므로 관리자에게만 준다.
    joinPath: `/api/test-mode/join?token=${encodeURIComponent(cur.token)}`,
  };
}

// 화면이 "지금 테스트 중인가"를 물어보는 곳. 직원도 볼 수 있어야 한다 —
// 사장님이 켜둔 줄 모르고 테스트 주문을 진짜로 착각하면 안 되니까.
router.get("/", requireAdmin, async (req, res) => res.json(await stateFor(req)));

// 켜기. 켠 기기는 바로 참여한다(켜자마자 쓸 수 있어야 하니까).
router.post("/start", requireOwner, async (req, res) => {
  await connectDB();
  const session = await testMode.start(getDb(), store, {
    save,
    by: (req.session && (req.session.userId || req.session.role)) || null,
  });
  req.session.testSessionId = session.id;
  // 켠 사람이 첫 참여자다.
  await testMode.joinDevice(getDb(), session.id, req.sessionID);
  res.json(await stateFor(req));
});

// 이 기기도 참여시킨다. 다른 직원 태블릿을 같이 넣을 때.
router.post("/join", requireAdmin, async (req, res) => {
  const cur = testMode.active(store);
  if (!cur) return res.status(400).json({ error: "test_mode_not_active" });
  req.session.testSessionId = cur.id;
  await connectDB();
  await testMode.joinDevice(getDb(), cur.id, req.sessionID);
  res.json(await stateFor(req));
});

// 손님 폰용. 링크를 한 번 열면 그 폰이 테스트 기기가 되고, 원하는 주소로
// 보내준다. 토큰을 아는 사람만 — 벽에 붙은 QR 로는 들어올 수 없다.
router.get("/join", async (req, res) => {
  const cur = testMode.active(store);
  const token = String(req.query.token || "");
  if (!cur || !token || token !== cur.token) {
    return res.status(403).send("테스터 모드가 켜져 있지 않거나 링크가 만료됐습니다.");
  }
  req.session.testSessionId = cur.id;
  try {
    await connectDB();
    await testMode.joinDevice(getDb(), cur.id, req.sessionID);
  } catch (e) {
    // 인원 세기에 실패해도 참여 자체는 된다.
  }
  // 열린 리디렉트 방지 — 우리 주소 안에서만 움직인다.
  const to = String(req.query.to || "/admin");
  const safe = /^\/[^/\\]/.test(to) ? to : "/admin";
  res.redirect(safe);
});

// 이 기기만 빠진다. 테스터 모드 자체는 그대로 — 지우지 않는다.
//
// 「마지막 한 명이면 같이 끝난다」는 화면이 맡는다. 여기서 몰래 끝내지
// 않는다 — 무엇이 지워지는지 보여주고 사람이 누르는 것이 규칙이다
// (2026-09-14 사장님: 삭제는 사람이).
router.post("/leave", requireAdmin, async (req, res) => {
  const id = req.session.testSessionId;
  delete req.session.testSessionId;
  if (id) {
    try {
      await connectDB();
      await testMode.leaveDevice(getDb(), id, req.sessionID);
    } catch (e) {}
  }
  res.json(await stateFor(req));
});

// 끄기 전에 무엇이 사라지는지. 지우는 것은 되돌릴 수 없으므로 반드시
// 이걸 보여주고 확인을 받는다.
router.get("/preview-end", requireOwner, async (req, res) => {
  await connectDB();
  const preview = await testMode.previewEnd(getDb(), store);
  if (!preview) return res.status(400).json({ error: "test_mode_not_active" });
  res.json(preview);
});

// 끄기 + 삭제 + 되돌리기.
router.post("/end", requireOwner, async (req, res) => {
  await connectDB();
  const body = req.body || {};
  const result = await testMode.end(
    getDb(),
    store,
    { save, deletePhoto },
    { revertSettings: body.revertSettings !== false, revertMenu: body.revertMenu !== false }
  );
  if (!result) return res.status(400).json({ error: "test_mode_not_active" });
  delete req.session.testSessionId;
  res.json({ ok: true, ...result });
});

module.exports = router;
