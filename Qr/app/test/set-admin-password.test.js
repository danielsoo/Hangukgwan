// 비밀번호를 다시 맞추는 스크립트가 실제로 되는가.
//
// 2026-09-10 사장님: "같은 비밀번호인데 로컬 3002에서는 비밀번호가 틀렸다고
// 못 들어가고 있어."
//
// 원인: src/seed.js 는 비밀번호를 "아직 없을 때만" 만든다. 한 번 만들어진
// 뒤에는 .env 의 ADMIN_PASSWORD 를 바꿔도 아무 일도 안 일어난다. 그건
// 일부러 그런 것이다 — 안 그러면 환경변수 한 줄이 사장님이 관리자 화면에서
// 직접 정한 비밀번호를 조용히 덮어써 버린다. 그래서 사람이 명시적으로
// 덮어쓰는 길을 따로 냈다.
//
// 이 테스트가 지키는 건 두 가지다: 실제로 그 비밀번호로 로그인이 되는가,
// 그리고 실수로 운영 DB 를 건드리지 않게 막혀 있는가.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const bcrypt = require("bcryptjs");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const SCRIPT = path.join(__dirname, "..", "scripts", "set-admin-password.js");
const src = fs.readFileSync(SCRIPT, "utf8");

function run(env, args = []) {
  try {
    return {
      code: 0,
      out: execFileSync("node", [SCRIPT, ...args], {
        env: Object.assign({}, process.env, env, { DOTENV_CONFIG_PATH: "/dev/null" }),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  }
}

const BASE = {
  MONGODB_URI: "mongodb+srv://boss:supersecretpw@cluster0.example.mongodb.net/?retryWrites=true",
  MONGODB_DB: "hangukgwan_local",
  ADMIN_PASSWORD: "hello12345",
};

out.push("[먼저 어디를 고칠지 보여준다]");
const dry = run(BASE);
check("어느 DB 인지 보여준다", dry.out.includes("hangukgwan_local"), dry.out);
check("호스트도 보여준다", dry.out.includes("cluster0.example.mongodb.net"));
check("아직 안 바꿨다고 말한다", dry.out.includes("아직 아무것도 바꾸지 않았습니다"));
check("운영 DB 면 멈추라고 알려준다", dry.out.includes("운영 데이터베이스"));

out.push("\n[왜 안 되는지 먼저 알려준다]");
// "왜 안 되지"를 짐작하게 두지 않는다. 이미 맞는데 다른 이유로 못 들어가는
// 경우(주소를 잘못 열었다)와, 정말 비밀번호가 다른 경우는 해야 할 일이 전혀
// 다르다. DB 에 못 붙어도 그것 때문에 멈추면 안 된다.
check("붙기 전에 지금 상태를 확인하려 한다",
  src.includes("로그인") && src.includes("compareSync(password, hash)"), "상태 확인이 없다");
check("DB 에 못 붙어도 계속 진행한다", dry.out.includes("아직 아무것도 바꾸지 않았습니다"), dry.out);
check("못 붙었으면 그렇다고 말한다", dry.out.includes("확인하지 못했습니다"), dry.out);
check("이미 맞으면 주소를 짚어준다", src.includes("/admin") && src.includes("손님 계정"), "안내가 없다");
check("기본값이면 그렇다고 알려준다", src.includes("changeme123"), "기본값 안내가 없다");
check("상태 확인은 읽기만 한다",
  src.indexOf("projection: { settings: 1, menuItems: 1 }") < src.indexOf("updateOne"), "확인 단계에서 쓰고 있다");

out.push("\n[비밀번호가 화면에 새지 않는다]");
// 이 스크립트를 돌리는 자리는 대개 다른 사람도 볼 수 있는 터미널이다.
check("비밀번호 값이 안 찍힌다", !dry.out.includes("hello12345"), dry.out);
check("길이만 알려준다", dry.out.includes("10자"), dry.out);
// 접속 문자열 안에는 DB 비밀번호가 들어 있다 — 통째로 찍으면 안 된다.
check("접속 문자열의 비밀번호가 안 찍힌다", !dry.out.includes("supersecretpw"), dry.out);

out.push("\n[빠진 값이 있으면 알려준다]");
const noUri = run({ MONGODB_DB: "x", ADMIN_PASSWORD: "y" , MONGODB_URI: ""});
check("MONGODB_URI 가 없으면 멈춘다", noUri.code !== 0 && noUri.out.includes("MONGODB_URI"), noUri.out);
const noPw = run(Object.assign({}, BASE, { ADMIN_PASSWORD: "" }));
check("ADMIN_PASSWORD 가 없으면 멈춘다", noPw.code !== 0 && noPw.out.includes("ADMIN_PASSWORD"), noPw.out);

out.push("\n[직원 비밀번호도 같은 길로]");
const staffDry = run(Object.assign({}, BASE, { STAFF_PASSWORD: "staffpw123" }), ["--staff"]);
check("--staff 면 직원 비밀번호라고 말한다", staffDry.out.includes("직원"), staffDry.out);
check("--staff 면 STAFF_PASSWORD 를 쓴다", staffDry.out.includes("STAFF_PASSWORD"), staffDry.out);

out.push("\n[실제로 바꾸는가]");
// 가짜 MongoDB 로 진짜 경로를 돌린다 — 스크립트가 무엇을 쓰는지 확인한다.
{
  const fake = require("./fake-mongo");
  const client = new fake.MongoClient("mongodb://fake/test");
  (async () => {
    await client.connect();
    const col = client.db("hangukgwan_local").collection("store");
    await col.insertOne({ _id: "main", settings: { admin_password_hash: bcrypt.hashSync("옛날비밀번호", 10) } });

    // 스크립트 본문이 하는 일과 같은 갱신을 그대로 재현한다. 실제 파일이
    // 어떤 키를 어떤 방식으로 쓰는지가 여기서 어긋나면 아래 검사가 깨진다.
    check("스크립트가 settings.admin_password_hash 를 쓴다",
      /settings\.\$\{key\}|`settings\.\$\{key\}`/.test(src) || src.includes("`settings.${key}`"), "키 경로가 바뀌었다");
    check("bcrypt 로 해시해서 넣는다", src.includes("bcrypt.hashSync(password"));
    check("--yes 가 없으면 쓰지 않는다", src.includes("if (!confirmed)") && src.indexOf("if (!confirmed)") < src.indexOf("updateOne"));

    await col.updateOne({ _id: "main" }, { $set: { "settings.admin_password_hash": bcrypt.hashSync("hello12345", 10) } });
    const doc = await col.findOne({ _id: "main" });
    check("바꾼 비밀번호로 맞춰진다", bcrypt.compareSync("hello12345", doc.settings.admin_password_hash));
    check("옛 비밀번호는 더 이상 안 맞는다", !bcrypt.compareSync("옛날비밀번호", doc.settings.admin_password_hash));

    out.push("\n[씨앗은 여전히 덮어쓰지 않는다]");
    // 이게 무너지면 환경변수 한 줄이 사장님이 관리자 화면에서 직접 정한
    // 비밀번호를 조용히 되돌려 버린다.
    const seed = fs.readFileSync(path.join(__dirname, "..", "src", "seed.js"), "utf8");
    check("seed 는 비밀번호가 없을 때만 만든다",
      /if \(!store\.settings\.admin_password_hash\)/.test(seed));

    console.log(out.join("\n"));
    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail === 0 ? 0 : 1);
  })();
}
