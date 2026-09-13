// 마지막으로 나가는 사람이 세션도 함께 끝내는가.
//
// 사장님(2026-09-14): "그냥 마지막 남은 1인이 끄면 세션도 함께 종료하는
// 시스템으로 하면 되잖아. 그러면 혼자 켰다 꺼도 되고 여러명이 참여해도
// 괜찮고." / "마지막으로 나가는 사람한테 알려주면 되잖냐."
//
// 그러려면 서버가 인원을 알아야 한다. 지금까지는 참여 여부가 각 기기의
// 로그인 세션 안에만 있어서 서버는 몇 대가 들어 있는지 몰랐다. 그래서 9/13
// 저녁에 켠 세션이 하루 넘게 떠 있었다 — 참여했던 기기들의 로그인 세션이
// 12시간 뒤 만료되면서 조용히 다 빠져나갔는데, 세션 자체는 남았다.
const fs = require("fs");
const path = require("path");
const testMode = require("../src/testMode");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

// 아주 작은 가짜 몽고 — 이 시험이 보는 것은 두 컬렉션뿐이다.
function fakeDb(sessionDoc, liveSids) {
  const live = new Set(liveSids);
  return {
    collection(name) {
      if (name === testMode.COLLECTION) {
        return {
          async findOne() { return sessionDoc; },
          async updateOne(filter, update) {
            sessionDoc.devices = sessionDoc.devices || [];
            if (update.$addToSet && update.$addToSet.devices) {
              if (!sessionDoc.devices.includes(update.$addToSet.devices)) sessionDoc.devices.push(update.$addToSet.devices);
            }
            if (update.$pull && update.$pull.devices) {
              sessionDoc.devices = sessionDoc.devices.filter((d) => d !== update.$pull.devices);
            }
          },
        };
      }
      return {
        async countDocuments(filter) {
          const ids = (filter && filter._id && filter._id.$in) || [];
          return ids.filter((id) => live.has(id)).length;
        },
      };
    },
  };
}

(async () => {
  const cur = { id: "ts_1" };

  out.push("[참여하면 늘고, 나가면 준다]");
  const doc = { _id: "ts_1", devices: [] };
  const db = fakeDb(doc, ["a", "b"]);
  check("처음에는 0명", (await testMode.countJoined(db, cur)) === 0);
  await testMode.joinDevice(db, "ts_1", "a");
  check("한 명 참여 → 1명", (await testMode.countJoined(db, cur)) === 1, JSON.stringify(doc.devices));
  await testMode.joinDevice(db, "ts_1", "b");
  check("두 명 참여 → 2명", (await testMode.countJoined(db, cur)) === 2, JSON.stringify(doc.devices));
  await testMode.joinDevice(db, "ts_1", "b");
  check("★ 같은 기기가 두 번 참여해도 1로 센다", (await testMode.countJoined(db, cur)) === 2, JSON.stringify(doc.devices));
  await testMode.leaveDevice(db, "ts_1", "a");
  check("한 명 나감 → 1명", (await testMode.countJoined(db, cur)) === 1, JSON.stringify(doc.devices));

  out.push("\n[로그인 세션이 만료되면 저절로 빠진다]");
  // 하트비트를 따로 쓰지 않는 이유가 이것이다. 로그인 세션이 사라지면
  // sessions 컬렉션에서도 사라지므로 인원이 저절로 맞는다.
  const doc2 = { _id: "ts_1", devices: ["a", "b", "c"] };
  check("★ 살아 있는 것만 센다", (await testMode.countJoined(fakeDb(doc2, ["b"]), cur)) === 1);
  check("★ 전부 만료되면 0명 — 이것이 9/13 의 그 상태다", (await testMode.countJoined(fakeDb(doc2, []), cur)) === 0);

  out.push("\n[못 셌을 때는 0 이라고 하지 않는다]");
  // 0 은 「아무도 없다」는 뜻이고 화면이 그걸 보고 안내를 바꾼다. 못 센 것을
  // 0 으로 뭉개면 멀쩡히 여럿이 쓰는 중에 엉뚱한 안내가 뜬다.
  const broken = { collection() { return { async findOne() { throw new Error("down"); } }; } };
  check("★ 실패하면 null", (await testMode.countJoined(broken, cur)) === null);
  check("db 가 없으면 null", (await testMode.countJoined(null, cur)) === null);
  check("세션이 없으면 null", (await testMode.countJoined(db, null)) === null);

  out.push("\n[화면이 마지막 사람에게 알려준다]");
  const ADMIN = fs.readFileSync(path.join(__dirname, "..", "public", "js", "admin.js"), "utf8");
  check("★ 나가기가 lastOne 을 보고 갈라진다", /testModeState\.lastOne\)\s*return endTestMode\(\{ fromLeave: true \}\)/.test(ADMIN));
  check("★ 그때도 확인 창을 띄운다 (몰래 지우지 않는다)", /fromLeave[\s\S]{0,400}마지막 참여자입니다/.test(ADMIN));
  check("나가고 종료할지 묻는다", ADMIN.includes("나가고 종료할까요?"));

  out.push("\n[아무도 없으면 띠가 그렇게 말한다]");
  check("★ joined === 0 일 때만 그 문구", /const nobody = !st\.thisDevice && st\.joined === 0;/.test(ADMIN),
    "joined 가 null(못 셈)일 때도 뜨면 멀쩡한 세션에 엉뚱한 안내가 뜬다");
  for (const lang of ["ko", "zh"]) {
    const start = ADMIN.indexOf(`\n    ${lang}: {`);
    const nextZh = ADMIN.indexOf("\n    zh: {", start + 1);
    const block = ADMIN.slice(start, nextZh === -1 ? ADMIN.length : nextZh);
    check(`${lang} 사전에 testBannerNobody 가 있다`, /(^|[\s{,])testBannerNobody\s*:/m.test(block));
  }

  out.push("\n[로그아웃하면 자리를 비운다]");
  const AUTH = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "auth.js"), "utf8");
  check("★ 로그아웃이 leaveDevice 를 부른다", /logout[\s\S]{0,900}leaveDevice\(/.test(AUTH),
    "이게 없어서 유령 세션이 남았다");
  check("자리를 못 비워도 로그아웃은 된다", /leaveDevice\([\s\S]{0,200}catch/.test(AUTH));

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
