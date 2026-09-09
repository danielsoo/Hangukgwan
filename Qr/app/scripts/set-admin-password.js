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

  // --yes 없이 부르면, 지금 그 DB 의 비밀번호가 어떤 상태인지 먼저 알려준다.
  // "왜 안 되지"를 짐작하지 않고 눈으로 보게 하려는 것이다 — 이미 맞는데
  // 다른 이유로 못 들어가는 경우(주소를 잘못 열었거나)와, 정말 비밀번호가
  // 다른 경우는 해야 할 일이 전혀 다르다.
  if (!confirmed) {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
    try {
      await client.connect();
      const doc = await client.db(dbName).collection("store")
        .findOne({ _id: "main" }, { projection: { settings: 1, menuItems: 1 } });
      if (!doc) {
        console.log("  이 데이터베이스에는 아직 데이터가 없습니다.");
        console.log("  서버를 한 번 띄우면(npm start) 메뉴와 비밀번호가 만들어집니다.");
      } else {
        const hash = doc.settings && doc.settings[key];
        console.log(`  지금 상태 : 메뉴 ${(doc.menuItems || []).length}개 · ${who} 비밀번호 ${hash ? "있음" : "없음"}`);
        if (hash) {
          const same = bcrypt.compareSync(password, hash);
          console.log(`             .env 의 ${envName} 로 로그인 ${same ? "됩니다 ✓" : "안 됩니다 ✗"}`);
          if (!same && bcrypt.compareSync("changeme123", hash)) {
            console.log("             (지금은 기본값 changeme123 입니다 — 처음 만들 때 .env 에 그 줄이 없었던 것)");
          }
          if (same) {
            console.log("");
            console.log("  비밀번호는 이미 맞습니다. 주소를 확인해보세요 —");
            console.log(`    관리자   http://localhost:${process.env.PORT || 3000}/admin`);
            console.log("    홈페이지(다른 포트)의 「로그인」은 손님 계정이라 이 비밀번호가 아닙니다.");
          }
        }
      }
    } catch (e) {
      console.log("  (지금 상태는 확인하지 못했습니다:", e.message + ")");
    } finally {
      await client.close().catch(() => {});
    }
    console.log("");
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
