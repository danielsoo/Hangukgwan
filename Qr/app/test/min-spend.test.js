// 1인당 최소 주문 금액(低消) — 얼마가 필요하고, 지금 얼마인가.
//
// 사장님(2026-09-11): "1인 1메뉴였었는데 그거 제외해주고 최소 주문금액
// 인당 200 대만 달러로 해줘. 주문금액이 인원수보다 적을때 나오는 안내문구를
// 이거로 바꿔주세요 — 大人及13歲以上兒童，每人低消200元；13歲以下免低消。"
//
// ── 이 파일이 지키는 네 가지 ────────────────────────────────────────
//
//   1. 금액으로 센다. 메뉴를 몇 개 담았는지는 이제 상관없다 — 비싼 것
//      한 그릇으로 두 명 低消를 넘길 수 있고, 싼 것 세 개로는 못 넘긴다.
//   2. **어른만 센다.** 13세 이하는 免低消다.
//   3. **이미 시킨 라운드를 같이 센다.** 결제한 라운드까지. 低消는 한
//      라운드가 아니라 앉아 있는 동안 전체에 걸리는 규칙이라, 두 번째
//      라운드에서 음료 하나를 시킬 때마다 「모자랍니다」가 뜨면 안 된다.
//   4. 계산은 **서버 한 곳**에서만 한다. 손님 폰과 계산대가 다른 금액을
//      말하면 안 된다 — 돈 이야기라 그게 제일 나쁘다.
const fs = require("fs");
const path = require("path");
const { perPerson, payingCount, requiredFor, spentSoFar, shortfall } = require("../src/minSpend");
const { ordersOfSeating } = require("../src/partySize");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const S = { store_min_spend: "200" };
const table = (over) => Object.assign({ number: "7", party_size: 0, party_adults: null, party_children: 0 }, over);

out.push("[1] 1인당 금액은 설정에서 읽는다");
{
  check("200", perPerson(S) === 200, String(perPerson(S)));
  check("설정이 비면 0 (안내 안 함)", perPerson({}) === 0, String(perPerson({})));
  check("빈 문자열도 0", perPerson({ store_min_spend: "" }) === 0, "");
  check("말이 안 되면 0", perPerson({ store_min_spend: "없음" }) === 0, "");
  check("0 이면 0", perPerson({ store_min_spend: "0" }) === 0, "");
}

out.push("\n[2] ★★ 어른만 센다 — 13세 이하는 免低消");
{
  const family = table({ party_size: 4, party_adults: 2, party_children: 2 });
  check("★ 어른 2명 → 400", requiredFor(S, family) === 400, String(requiredFor(S, family)));
  check("세는 인원도 2", payingCount(family) === 2, String(payingCount(family)));

  const allKids = table({ party_size: 3, party_adults: 0, party_children: 3 });
  check("★ 어른이 없으면 低消도 없다", requiredFor(S, allKids) === 0, String(requiredFor(S, allKids)));

  const adultsOnly = table({ party_size: 3, party_adults: 3, party_children: 0 });
  check("어른 3명 → 600", requiredFor(S, adultsOnly) === 600, String(requiredFor(S, adultsOnly)));
}

out.push("\n[3] 옛 손님 — 어른·아이 구분이 없던 때");
{
  // 구분이 생기기 전(2026-09-10 이전)에 앉은 손님은 party_adults 가 없다.
  // 0으로 보면 그 자리만 低消가 통째로 사라진다.
  const legacy = table({ party_size: 3, party_adults: null });
  check("★ 전부 어른으로 본다 → 600", requiredFor(S, legacy) === 600, String(requiredFor(S, legacy)));
}

out.push("\n[4] 안 묻거나 포장이면 안내하지 않는다");
{
  check("인원을 아직 안 물었으면 0", requiredFor(S, table({ party_size: 0 })) === 0, "");
  // 포장 카운터는 QR 을 모두가 같이 쓴다 — 이 자리의 인원도, 이 자리가 쓴
  // 돈도 남의 것이 섞인다.
  check("★ 포장 카운터는 0", requiredFor(S, table({ party_size: 2, party_adults: 2, is_counter: true })) === 0, "");
  check("설정이 비었으면 0", requiredFor({}, table({ party_size: 2, party_adults: 2 })) === 0, "");
  check("자리가 없으면 0", requiredFor(S, null) === 0, "");
}

out.push("\n[5] ★★ 이미 시킨 금액 — 결제한 라운드도 센다");
{
  // 먼저 계산하고 더 시키는 손님이 그때마다 처음부터 다시 低消를 채워야
  // 한다면 그건 규칙이 아니라 벌이다.
  const orders = [
    { total: 150, status: "paid" },
    { total: 120, status: "pending" },
    { total: 999, status: "cancelled" },
  ];
  check("★ 결제한 것도 센다", spentSoFar(orders) === 270, String(spentSoFar(orders)));
  check("★ 취소한 것은 뺀다", !String(spentSoFar(orders)).includes("999"), "");
  check("빈 목록은 0", spentSoFar([]) === 0, "");
  check("없어도 0", spentSoFar(null) === 0, "");
}

out.push("\n[6] 모자란 금액");
{
  check("400 중 150 → 250 부족", shortfall(400, 150) === 250, String(shortfall(400, 150)));
  check("★ 다 채웠으면 0 (음수가 아니다)", shortfall(400, 500) === 0, String(shortfall(400, 500)));
  check("딱 맞으면 0", shortfall(400, 400) === 0, "");
}

out.push("\n[7] ★★ 이 착석의 주문만 — 낮 손님 것이 딸려오지 않는다");
{
  const t = { number: "7", party_size: 2, party_adults: 2, party_size_updated_at: "2026-09-11T09:00:00.000Z" };
  const store = {
    orders: [
      { table_number: "7", created_at: "2026-09-11 12:00:00", total: 100, status: "paid" },   // 낮 손님
      { table_number: "7", created_at: "2026-09-11 18:10:00", total: 200, status: "paid" },   // 지금 손님
      { table_number: "7", created_at: "2026-09-11 18:40:00", total: 150, status: "pending" },
      { table_number: "7", created_at: "2026-09-11 18:50:00", total: 999, status: "cancelled" },
      { table_number: "9", created_at: "2026-09-11 18:20:00", total: 500, status: "paid" },   // 옆 자리
      { table_number: "7", created_at: "2026-09-11 18:30:00", total: 777, status: "paid", test_session: "t1" },
    ],
  };
  const mine = ordersOfSeating(store, t);
  const spent = spentSoFar(mine);
  // 앉은 시각(09:00Z = 대만 17:00)보다 뒤의 것만.
  check("★ 지금 손님 것만 센다 (200+150)", spent === 350, `${spent} / ${JSON.stringify(mine.map((o) => o.total))}`);
  check("★ 옆 자리는 안 센다", !mine.some((o) => o.table_number === "9"), "");
  check("★ 취소는 안 센다", !mine.some((o) => o.status === "cancelled"), "");
  check("★ 테스트 주문은 안 센다", !mine.some((o) => o.test_session), "");

  // 앉은 시각을 모르는 자리는 안 받은 것만 — 확실하지 않을 때 남의 주문을
  // 끌어오는 것보다 덜 보여주는 편이 낫다.
  const noSeat = ordersOfSeating(store, { number: "7" });
  check("앉은 시각을 모르면 미결제만", noSeat.every((o) => o.status !== "paid"), JSON.stringify(noSeat.map((o) => o.status)));
}

out.push("\n[8] 화면 배선 — 옛 규칙은 남아 있지 않다");
{
  const js = fs.readFileSync(path.join(__dirname, "../public/js/order.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../public/order.html"), "utf8");
  const i18n = fs.readFileSync(path.join(__dirname, "../public/js/i18n.js"), "utf8");
  const tables = fs.readFileSync(path.join(__dirname, "../src/routes/tables.js"), "utf8");

  check("★ 메뉴 개수로 세지 않는다 (1인 1메뉴 없앰)", !/cartCount\(\) < /.test(js), "");
  check("★ 서버가 준 금액을 쓴다", /d\.min_spend_required/.test(js), "");
  check("★ 화면이 다시 계산하지 않는다", !/store_min_spend/.test(js) || !/\* *payingCount/.test(js), "");
  check("서버가 내려보낸다", /min_spend_required: minSpend\.requiredFor/.test(tables), "");
  check("이미 쓴 금액도 내려보낸다", /min_spend_spent: minSpend\.spentSoFar/.test(tables), "");
  check("주문 직전에 다시 물어본다", /async function refreshMinSpend\(\)/.test(js), "");

  // 사장님이 주신 문구 그대로여야 한다.
  check("★ 사장님 문구 그대로", /大人及13歲以上兒童，每人低消\$\{n\}元；13歲以下免低消。/.test(js), "");
  check("금액이 설정에서 온다 (200을 박아두지 않았다)", !/低消200元/.test(js), "");
  check("세 언어 모두 있다", /MIN_SPEND_NOTICE[\s\S]{0,400}en:/.test(js), "");
  check("모자란 금액도 적어준다", /MIN_SPEND_SHORTFALL/.test(js) && /id="partyWarningAmount"/.test(html), "");

  // 안내문이 「13세 이상」이라고 하는데 인원 칸이 그냥 「아이」면, 15살을
  // 아이 칸에 넣으시고 세는 것과 말하는 것이 어긋난다.
  check("★ 인원 칸에 나이가 적혀 있다 (zh)", /13歲以上/.test(i18n) && /13歲以下/.test(i18n), "");
  check("★ 인원 칸에 나이가 적혀 있다 (ko)", /13세 이상/.test(i18n) && /13세 이하/.test(i18n), "");
  check("★ 인원 칸에 나이가 적혀 있다 (en)", /Adults \(13\+\)/.test(i18n), "");

  // 막지 않는다 — 확인을 누르면 그대로 주문된다.
  check("★ 확인을 누르면 그대로 주문된다", /showPartyWarningModal\(have, minSpendRequired, \(\) => submitOrderFlow\(true\)\)/.test(js), "");
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
