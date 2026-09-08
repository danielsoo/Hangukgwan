// 관리자 화면의 firebaseConfig 입력칸이 "콘솔에서 복사한 그대로" 를 받는지.
//
// 왜 필요한가: Firebase 콘솔은 이 값을 자바스크립트 객체 리터럴로 보여준다
// (키에 따옴표가 없고, 앞에 `const firebaseConfig =`, 뒤에 `;` 가 붙는다).
// 그런데 이 값을 읽는 쪽은 전부 JSON.parse 를 쓴다. 그래서 화면이 시키는
// 대로 복사해 붙여넣으면 저장이 거부됐다. admin.js 의
// normalizeFirebaseConfig 가 그 간극을 메운다.
//
// admin.js 는 브라우저 전용이라 require 할 수 없어서 함수만 떼어내 돌린다.
// 함수 이름이 바뀌면 여기서 바로 실패하므로 조용히 썩지 않는다.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SRC = fs.readFileSync(path.join(__dirname, "..", "public", "js", "admin.js"), "utf8");
const START = SRC.indexOf("function normalizeFirebaseConfig");
const END = SRC.indexOf("function renderVipConfigStatus");
assert.ok(START >= 0 && END > START, "admin.js 에서 normalizeFirebaseConfig 를 못 찾았습니다");
// eslint-disable-next-line no-eval
const normalizeFirebaseConfig = eval(`(${SRC.slice(START, END).trim()})`);

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const CONSOLE_PASTE = `
// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyABC123",
  authDomain: "hangookgwan-f8cd5.firebaseapp.com",
  projectId: "hangookgwan-f8cd5",
  storageBucket: "hangookgwan-f8cd5.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef"
};`;

// Firebase 콘솔이 실제로 보여주는 화면 전체. 사장님이 이걸 통째로 복사해
// 붙여넣는 게 가장 자연스러운데, 첫 "{" 가 import 문의 것이라 "첫 { 부터
// 마지막 } 까지" 방식으로는 실패했다(2026-09-08에 실제로 실패했다).
const FULL_CONSOLE_SCREEN = `
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyABC123",
  authDomain: "hangookgwan-f8cd5.firebaseapp.com",
  projectId: "hangookgwan-f8cd5",
  storageBucket: "hangookgwan-f8cd5.firebasestorage.app",
  messagingSenderId: "75860363301",
  appId: "1:75860363301:web:abcdef",
  measurementId: "G-ABC123"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
`;

out.push("\n[받아들여야 하는 것]");
for (const [name, input] of [
  ["Firebase 콘솔에서 복사한 그대로", CONSOLE_PASTE],
  ["콘솔 화면 전체 (import 문까지 포함)", FULL_CONSOLE_SCREEN],
  ["중괄호 부분만", `{ apiKey: "A", projectId: "p" }`],
  ["작은따옴표", `{ apiKey: 'A', projectId: 'p' }`],
  ["마지막 쉼표가 남은 경우", `{ "apiKey": "A", "projectId": "p", }`],
  ["이미 올바른 JSON", `{"apiKey":"A","projectId":"p"}`],
]) {
  const r = normalizeFirebaseConfig(input);
  check(name, !!r, String(r));
}

out.push("\n[거부해야 하는 것 — 그대로 두면 브라우저에서 똑같이 실패한다]");
for (const [name, input] of [
  ["apiKey 없음", `{ projectId: "p" }`],
  ["projectId 없음", `{ apiKey: "A" }`],
  ["빈 값", "   "],
  ["설명문을 붙여넣은 경우", "여기에 firebaseConfig 를 붙여넣으세요"],
  ["중괄호가 안 닫힘", `{ apiKey: "A", projectId: "p"`],
]) {
  check(name, normalizeFirebaseConfig(input) === null, String(normalizeFirebaseConfig(input)));
}

out.push("\n[화면 전체를 붙여넣어도 config 만 골라낸다]");
const fromFull = normalizeFirebaseConfig(FULL_CONSOLE_SCREEN);
let fullCfg = null;
try { fullCfg = JSON.parse(fromFull); } catch (e) { /* 아래에서 잡힌다 */ }
check("import 문의 중괄호를 집지 않는다", !!fullCfg, String(fromFull).slice(0, 120));
check("apiKey 가 맞다", fullCfg && fullCfg.apiKey === "AIzaSyABC123", JSON.stringify(fullCfg));
check("projectId 가 맞다", fullCfg && fullCfg.projectId === "hangookgwan-f8cd5", JSON.stringify(fullCfg));
check("measurementId 까지 살아있다", fullCfg && fullCfg.measurementId === "G-ABC123", JSON.stringify(fullCfg));
check("initializeApp 같은 코드가 섞여들지 않는다", fromFull && !/initializeApp|import/.test(fromFull), String(fromFull).slice(0, 200));

out.push("\n[결과가 실제로 쓸 수 있는 값인지]");
const normalized = normalizeFirebaseConfig(CONSOLE_PASTE);
let cfg = null;
try { cfg = JSON.parse(normalized); } catch (e) { /* 아래에서 잡힌다 */ }
check("결과가 JSON.parse 된다 (firebaseClient.ts 가 하는 일)", !!cfg, String(normalized).slice(0, 120));
check("apiKey 보존", cfg && cfg.apiKey === "AIzaSyABC123", JSON.stringify(cfg));
check("projectId 보존", cfg && cfg.projectId === "hangookgwan-f8cd5", JSON.stringify(cfg));
check("authDomain 같은 나머지도 보존", cfg && cfg.authDomain === "hangookgwan-f8cd5.firebaseapp.com", JSON.stringify(cfg));
check("주석이 값으로 새어들지 않음", normalized && !normalized.includes("//"), String(normalized).slice(0, 200));
check("한 번 더 넣어도 그대로 (저장→다시 저장이 안전)", normalizeFirebaseConfig(normalized) === normalized);

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
