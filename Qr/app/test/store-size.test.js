// 저장 공간이 한도에 가까워지는 것을 시스템이 스스로 알아채는가.
//
// 2026-09-10 사장님: "3-4년 후에 내가 잊으면 큰일이잖아."
//
// 주문을 store 문서 밖으로 뺀 뒤에도 결제기록·정산·예약은 계속 쌓인다.
// 다 합쳐 연 3~4MB. MongoDB 문서 하나는 16MB가 한도라 언젠가는 저장이
// 실패하는데, 그때가 되어도 화면에는 아무 이유도 안 나온다.
//
// 그래서 사람이 기억할 일로 두지 않는다 — 품절을 직원이 잊어버리는 문제와
// 같은 모양이고, 답도 같다. 시스템이 재고, 시스템이 알린다.
const {
  LIMIT_BYTES, WARN_BYTES, URGENT_BYTES, measureBytes, breakdown, levelFor, sizeWarningLine, recordStoreSize,
  SETTING_BYTES, SETTING_CHECKED_AT,
} = require("../src/storeSize");
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

out.push("[언제 알리기 시작하는가]");
// 너무 늦게 알리면 손쓸 시간이 없고, 너무 일찍 알리면 몇 년을 무시하다가
// 정작 필요할 때 못 본 척하게 된다.
check("평소 크기(30KB)에는 아무 말도 안 한다", levelFor(30 * 1024) === "ok");
check("한도의 25%(4MB)부터 알린다", levelFor(WARN_BYTES) === "warn", String(WARN_BYTES));
check("그 직전까지는 조용하다", levelFor(WARN_BYTES - 1) === "ok");
check("한도의 60%(10MB)부터는 급하다고 말한다", levelFor(URGENT_BYTES) === "urgent");
check("경고 지점이 한도보다 한참 아래다", WARN_BYTES < LIMIT_BYTES / 3, `${WARN_BYTES} / ${LIMIT_BYTES}`);
// 연 3~4MB 로 늘어나는 속도에서, 처음 알림을 받고도 몇 년이 남아야 한다.
const YEARLY = 3.5 * 1024 * 1024;
check("처음 알림을 받고도 3년 이상 여유가 있다", (LIMIT_BYTES - WARN_BYTES) / YEARLY >= 3,
  `${((LIMIT_BYTES - WARN_BYTES) / YEARLY).toFixed(1)}년`);

out.push("\n[알리는 말이 무엇을 하라고 하는가]");
// "용량이 큽니다"만으로는 아무도 무엇을 해야 할지 모른다.
check("평소에는 한 줄도 안 붙인다", sizeWarningLine(30 * 1024) === null);
const warnLine = sizeWarningLine(5 * 1024 * 1024);
check("경고에 현재 크기와 한도가 같이 나온다", /5\.0MB \/ 16MB/.test(warnLine), warnLine);
check("경고가 무엇을 하라고 말한다", warnLine.includes("store 문서 분리"), warnLine);
const urgentLine = sizeWarningLine(12 * 1024 * 1024);
check("급할 때는 미루지 말라고 한다", /🚨/.test(urgentLine) && urgentLine.includes("요청"), urgentLine);
check("한도에 닿으면 무슨 일이 생기는지 알려준다",
  warnLine.includes("주문") && urgentLine.includes("주문"), `${warnLine} | ${urgentLine}`);

out.push("\n[크기를 잰다]");
check("빈 것도 잰다", measureBytes({}) > 0);
check("null 이어도 터지지 않는다", measureBytes(null) > 0);
const doc = { _id: "main", menuItems: [{ a: 1 }, { a: 2 }], settings: { x: "y" }, payments: [] };
const parts = breakdown(doc);
check("항목별로 나눠 보여준다", parts.length === 4, JSON.stringify(parts.map((p) => p.key)));
check("큰 것부터 보여준다", parts[0].bytes >= parts[parts.length - 1].bytes);
check("배열은 행 수도 같이 알려준다", parts.find((p) => p.key === "menuItems").rows === 2);
check("배열이 아닌 것은 행 수가 없다", parts.find((p) => p.key === "settings").rows === null);

out.push("\n[재는 게 장사를 막지 않는다]");
// 크기 확인 때문에 마감 정산이 실패하면 본말전도다.
(async () => {
  const store = { settings: {} };
  const broken = await recordStoreSize(store, {
    connectDB: async () => {},
    getDb: () => { throw new Error("DB 안 붙음"); },
    nowLocal: () => "2026-09-10 21:30:00",
  });
  check("DB 를 못 읽어도 던지지 않는다", broken === null);
  check("실패했으면 값을 남기지 않는다", !store.settings[SETTING_BYTES]);

  const ok = await recordStoreSize(store, {
    connectDB: async () => {},
    getDb: () => ({ collection: () => ({ findOne: async () => ({ _id: "main", payments: [1, 2, 3] }) }) }),
    nowLocal: () => "2026-09-10 21:30:00",
  });
  check("성공하면 크기를 설정에 남긴다", store.settings[SETTING_BYTES] > 0, JSON.stringify(store.settings));
  check("언제 쟀는지도 남긴다", store.settings[SETTING_CHECKED_AT] === "2026-09-10 21:30:00");
  check("항목별 내역도 돌려준다", ok.breakdown.some((b) => b.key === "payments"));

  out.push("\n[알림이 실제로 이어져 있는가]");
  // 모듈만 있고 아무도 안 부르면 없는 것과 같다.
  const cron = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "settlements.js"), "utf8");
  check("매일 밤 마감 정산이 크기를 잰다", /recordStoreSize\(/.test(cron));
  check("마감 LINE 메시지에 경고가 붙는다", /sizeWarningLine\(/.test(cron));
  const settings = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "settings.js"), "utf8");
  check("관리자 화면이 읽을 곳이 있다", /router\.get\("\/storage", requireAdmin/.test(settings));
  // 크론이 한 번도 안 돌면 경고 자체가 안 뜬다 — 안전장치가 조용히 죽는다.
  check("크론이 안 돌았으면 여기서라도 잰다", /stale/.test(settings) && /recordStoreSize\(/.test(settings));
  const admin = fs.readFileSync(path.join(__dirname, "..", "public", "js", "admin.js"), "utf8");
  check("관리자 화면에 띠를 그린다", /renderStorageBanner/.test(admin));
  check("로그인하면 그 띠를 확인한다", /renderStorageBanner\(\);/.test(admin));
  check("평소에는 띠가 안 보인다", /level !== "warn" && info\.level !== "urgent"/.test(admin));
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "admin.html"), "utf8");
  check("띠가 화면 맨 위에 있다", /id="storageBanner"/.test(html));
  for (const key of ["storageWarnTitle", "storageUrgentTitle", "storageWarnSub", "storageUrgentSub"]) {
    check(`${key} 가 한국어/중국어 둘 다 있다`, (admin.match(new RegExp(`${key}:`, "g")) || []).length >= 2);
  }

  console.log(out.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
