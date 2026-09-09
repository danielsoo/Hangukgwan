#!/usr/bin/env node
// 관리자 비밀번호를 .env 의 ADMIN_PASSWORD 로 다시 맞춘다.
//
// 2026-09-10 사장님: "같은 비밀번호인데 로컬 3002에서는 비밀번호가 틀렸다고
// 못 들어가고 있어."
//
// 왜 그런가:
//   src/seed.js 는 비밀번호를 "아직 없을 때만" 만든다
//   (if (!store.settings.admin_password_hash)). 한 번 만들어진 뒤에는
//   .env 의 ADMIN_PASSWORD 를 바꿔도 아무 일도 일어나지 않는다.
//   일부러 그렇게 돼 있다 — 안 그러면 환경변수 한 줄이 사장님이 관리자
//   화면에서 직접 정한 비밀번호를 조용히 덮어써 버린다.
//
//   그래서 "예전에 한 번 만들어진 로컬 DB" 는 그때의 비밀번호를 그대로
//   들고 있고, 지금 .env 에 뭘 적어두든 안 먹는다.
//
// 이 스크립트는 그걸 사람이 직접, 한 번, 명시적으로 덮어쓰는 길이다.
// 실수로 운영 데이터베이스를 건드리지 않도록 어느 DB 를 고칠 것인지 먼저
// 보여주고, --yes 를 붙였을 때만 실제로 쓴다.
//
//   node scripts/set-admin-password.js          → 어디를 고칠지 보여주기만
//   node scripts/set-admin-password.js --yes    → 사장 비밀번호 바꾸기
//   node scripts/set-admin-password.js --yes --staff  → 직원 비밀번호
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { MongoClient } = require("mongodb");

const args = process.argv.slice(2);
const confirmed = args.includes("--yes");
const staff = args.includes("--staff");
const key = staff ? "staff_password_hash" : "admin_password_hash";
const envName = staff ? "STAFF_PASSWORD" : "ADMIN_PASSWORD";
const who = staff ? "직원" : "사장";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "hangukgwan";
const password = process.env[envName];

function hostOf(u) {
  // 비밀번호가 섞여 있는 문자열이라, 사람에게 보여줄 때는 호스트만 뽑는다.
  const m = /@([^/?]+)/.exec(u || "") || /mongodb(?:\+srv)?:\/\/([^/?]+)/.exec(u || "");
  return m ? m[1] : "(알 수 없음)";
}

(async () => {
  if (!uri) {
    console.error("MONGODB_URI 가 없습니다. .env 를 확인해주세요.");
    process.exit(1);
  }
  if (!password) {
    console.error(`${envName} 이 .env 에 없습니다. 먼저 그 줄을 채워주세요.`);
    process.exit(1);
  }

  console.log("");
  console.log(`  고칠 곳 : ${hostOf(uri)} / ${dbName}`);
  console.log(`  바꿀 것 : ${who} 비밀번호 (${key})`);
  console.log(`  쓸 값   : .env 의 ${envName} (${password.length}자)`);
  console.log("");

  if (!confirmed) {
    console.log("  아직 아무것도 바꾸지 않았습니다.");
    console.log("  위 DB 가 맞으면 --yes 를 붙여 다시 실행해주세요:");
    console.log(`    node scripts/set-admin-password.js --yes${staff ? " --staff" : ""}`);
    console.log("");
    console.log("  ※ 운영 데이터베이스 이름이 보이면 멈추세요. 로컬은 보통");
    console.log("    MONGODB_DB 가 따로 잡혀 있습니다.");
    console.log("");
    process.exit(0);
  }

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const col = client.db(dbName).collection("store");
    const doc = await col.findOne({ _id: "main" }, { projection: { settings: 1 } });
    if (!doc) {
      console.error(`  ${dbName} 에 데이터가 없습니다. 서버를 한 번 띄워서 초기 설정을 만든 뒤 다시 실행해주세요.`);
      process.exit(1);
    }
    const had = !!(doc.settings && doc.settings[key]);
    await col.updateOne({ _id: "main" }, { $set: { [`settings.${key}`]: bcrypt.hashSync(password, 10) } });
    console.log(`  ✓ ${who} 비밀번호를 .env 의 ${envName} 값으로 ${had ? "바꿨습니다" : "새로 넣었습니다"}.`);
    console.log("");
  } finally {
    await client.close();
  }
})().catch((e) => {
  console.error("  실패:", e.message);
  process.exit(1);
});
