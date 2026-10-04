// 급여·결산 잠금(src/sensitiveLock.js) — 시계를 넘겨 15분 자동 잠금과, 쓰는 동안 늘어나는 것을 잰다.
// 2026-10-04 사장님: "그 탭 들어갈 때마다 비밀번호 치게 해줘 … 로그인 비번이랑 결산 급여 비번은 다르게"
const fake = require("./fake-mongo");
require.cache[require.resolve("mongodb")] = { id: require.resolve("mongodb"), filename: require.resolve("mongodb"), loaded: true, exports: fake, paths: [] };
process.env.MONGODB_URI = "mongodb://fake/test";
const bcrypt = require("bcryptjs");
const { store } = require("../src/db");
const L = require("../src/sensitiveLock");

let pass = 0, fail = 0;
const out = [];
const check = (n, c, x = "") => { if (c) { pass++; out.push(`  ok   ${n}`); } else { fail++; out.push(`  FAIL ${n}  ${x}`); } };

store.settings = store.settings || {};
delete store.settings.sensitive_pin_hash;
const req = { session: {} };
check("정하기 전엔 열려 있다", L.isUnlocked(req, "payroll"), "");
store.settings.sensitive_pin_hash = bcrypt.hashSync("2468", 4);
check("정하면 잠긴다", !L.isUnlocked(req, "payroll"), "");
const t0 = 1_000_000;
check("틀리면 못 푼다", L.unlock(req, "payroll", "0000", t0).error === "wrong_pin", "");
check("맞으면 푼다", L.unlock(req, "payroll", "2468", t0).ok, "");
check("급여만 풀리고 결산은 그대로", L.isUnlocked(req, "payroll", t0 + 1) && !L.isUnlocked(req, "settlement", t0 + 1), "");
check("★★ 14분 59초 뒤에도 열려 있다", L.isUnlocked(req, "payroll", t0 + L.TTL_MS - 1000), "");
check("★★ 15분 넘게 아무것도 안 하면 잠긴다", !L.isUnlocked(req, "payroll", t0 + L.TTL_MS + 1), "");
// 쓰는 동안은 늘어난다 — 요청이 오면 그때부터 15분
L.unlock(req, "settlement", "2468", t0);
const realNow = Date.now;
Date.now = () => t0 + 10 * 60 * 1000;
let nexted = false;
L.requireUnlocked("settlement")(req, { status: () => ({ json: () => {} }) }, () => (nexted = true));
Date.now = realNow;
check("★ 10분에 한 번 쓰면 그때부터 다시 15분 — 20분에도 열려 있다", nexted && L.isUnlocked(req, "settlement", t0 + 20 * 60 * 1000), "");
L.lock(req, "settlement");
check("잠그면 바로 잠긴다", !L.isUnlocked(req, "settlement", t0 + 1), "");
const r2 = { session: {} };
for (let i = 0; i < 4; i++) L.unlock(r2, "payroll", "x", t0);
const fifth = L.unlock(r2, "payroll", "x", t0);
check("★ 다섯 번째 틀리면 5분 막힌다", fifth.status === 429 && fifth.retryAfter === 300, JSON.stringify(fifth));
check("막힌 동안은 맞아도 안 된다", L.unlock(r2, "payroll", "2468", t0 + 1000).status === 429, "");
check("5분 지나면 다시 된다", L.unlock(r2, "payroll", "2468", t0 + 5 * 60 * 1000 + 1).ok, "");
check("모르는 탭 이름은 안 받는다", L.unlock(req, "menu", "2468", t0).status === 400, "");
check("로그인 비밀번호로 바꾸려는 것을 알아본다", L.sameAsPin("2468") && !L.sameAsPin("2469"), "");
delete store.settings.sensitive_pin_hash;
console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
