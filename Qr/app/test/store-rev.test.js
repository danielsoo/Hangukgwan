// store 문서를 바꾸는 길은 전부 판 번호를 올리는가.
//
// 2026-09-14. 매 요청이 store 문서 37KB 를 통째로 다시 받고 있었다. 운영에서
// 재보니 그 문서를 꺼내는 데는 9ms, 37KB 를 실어 보내는 데는 394ms 였다.
// 그래서 요청마다 "바뀌었나"만 묻고(판 번호 한 칸, 9ms) 바뀌었을 때만
// 통째로 받도록 바꿨다.
//
// 이 구조에는 조용한 실패 하나가 붙어 있다. **판 번호를 안 올리고 문서를
// 고치면 그 변경이 다른 기기 화면에 영영 안 나타난다.** 메뉴를 고쳤는데
// 손님 화면이 그대로인 것보다 나쁜 것은 없고, 오류도 안 난다. 그래서
// 사람이 기억하는 대신 여기서 센다.
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const ROOT = path.join(__dirname, "..");
const DB_JS = path.join(ROOT, "src", "db.js");

function jsFiles(dir) {
  const found = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) found.push(...jsFiles(full));
    else if (name.endsWith(".js")) found.push(full);
  }
  return found;
}

(async () => {
  out.push("[store 문서를 직접 고치는 곳이 없다]");

  // 읽기(findOne/aggregate)는 상관없다. 바꾸는 것만 본다.
  const WRITES = ["updateOne", "updateMany", "replaceOne", "insertOne", "deleteOne", "deleteMany", "bulkWrite", "findOneAndUpdate"];
  const offenders = [];
  for (const file of [...jsFiles(path.join(ROOT, "src")), path.join(ROOT, "server.js")]) {
    const text = fs.readFileSync(file, "utf8");
    text.split("\n").forEach((line, i) => {
      if (!/collection\(\s*"store"\s*\)/.test(line)) return;
      if (!WRITES.some((w) => line.includes(`.${w}(`))) return;
      // db.js 안의 storeWrite/save 본체가 바로 그 「거쳐 가는 문」이다.
      if (file === DB_JS) return;
      offenders.push(`${path.relative(ROOT, file)}:${i + 1}`);
    });
  }
  check(
    "★ src/db.js 밖에서 store 문서를 직접 쓰지 않는다",
    offenders.length === 0,
    offenders.length ? `직접 쓰는 곳: ${offenders.join(", ")} — storeWrite() 를 쓰세요` : ""
  );

  // db.js 안에서도 문은 셋뿐이어야 한다: storeWrite, save(replaceOne),
  // 그리고 문서가 아예 없을 때의 insertOne.
  const dbLines = fs.readFileSync(DB_JS, "utf8").split("\n");
  const inDb = [];
  dbLines.forEach((line, i) => {
    if (!/collection\(\s*"store"\s*\)/.test(line)) return;
    if (!WRITES.some((w) => line.includes(`.${w}(`))) return;
    inDb.push(i + 1);
  });
  check("db.js 안의 쓰기 자리가 셋뿐이다 (storeWrite · save · 최초 insert)", inDb.length === 3, `찾은 줄: ${inDb.join(", ")}`);

  out.push("\n[판 번호가 실제로 올라간다]");
  const db = require("../src/db");
  check("storeWrite 를 밖에서 쓸 수 있다", typeof db.storeWrite === "function");
  check("판 번호 필드 이름이 정해져 있다", db.STORE_REV === "rev");
  const a = db.newRev();
  const b = db.newRev();
  check("★ 판 번호는 부를 때마다 다르다", !!a && !!b && a !== b, `${a} / ${b}`);

  out.push("\n[판 번호를 처음 달아주는 마이그레이션이 등록돼 있다]");
  const { applyStoreRev20260914, MIGRATION_FLAG } = require("../src/migrations/2026-09-14-store-rev");
  check("마이그레이션이 있다", typeof applyStoreRev20260914 === "function");
  const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  check("★ server.js 가 그것을 부른다", server.includes("applyStoreRev20260914(store"));

  // 이미 돈 가게에서는 아무 일도 안 한다.
  let wrote = 0;
  const store = { settings: { [MIGRATION_FLAG]: "2026-09-14T00:00:00.000Z" } };
  await applyStoreRev20260914(store, { storeWrite: async () => wrote++, saveFields: async () => wrote++ });
  check("두 번 돌아도 다시 쓰지 않는다", wrote === 0, `쓰기 ${wrote}회`);

  // 아직 안 돈 가게에서는 한 번 쓴다.
  wrote = 0;
  const fresh = { settings: {} };
  await applyStoreRev20260914(fresh, { storeWrite: async () => wrote++, saveFields: async () => wrote++ });
  check("★ 처음에는 한 번 쓴다", wrote === 1, `쓰기 ${wrote}회`);
  check("표를 남긴다", !!fresh.settings[MIGRATION_FLAG]);

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
