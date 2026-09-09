// 테이블에 등록된 인원수를 언제 지우는가.
//
// 2026-09-09 사장님: "구분 할 수 있어. 결제를 완료했다고 직원이 누르지 않는
// 한 한번이라도 주문한 손님은 계속 같은 손님으로 취급할거야."
//
// 그래서 지우는 경우는 딱 둘이다 — 직원이 「결제 완료」를 눌렀을 때, 그리고
// 직원이 「손님 나감」을 눌렀을 때. 시간이 지났다고 알아서 지우지 않는다.
//
// 특히 주문 취소로는 지우지 않는다. 예전 규칙("살아 있는 주문이 하나도
// 없으면 지운다")에서는 주방에 재료가 떨어져 마지막 한 접시를 취소하는
// 순간, 앉아 계신 손님이 나간 것으로 처리돼 인원수를 다시 묻게 됐다.
const { hasUnpaidOrder, clearPartySizeIfSettled } = require("../src/partySize");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

function storeWith(orders, tableOver) {
  return {
    orders,
    tables: [Object.assign({ id: 1, number: "7", party_size: 4, party_size_updated_at: "2026-09-09T10:00:00Z" }, tableOver)],
  };
}

out.push("[안 받은 돈이 남아 있는가]");
check("신규 주문은 안 받은 돈이다", hasUnpaidOrder(storeWith([{ table_number: "7", status: "new" }]), "7"));
check("조리 중도 안 받은 돈이다", hasUnpaidOrder(storeWith([{ table_number: "7", status: "preparing" }]), "7"));
check("서빙 완료도 안 받은 돈이다", hasUnpaidOrder(storeWith([{ table_number: "7", status: "served" }]), "7"));
check("결제 완료는 셈에서 뺀다", !hasUnpaidOrder(storeWith([{ table_number: "7", status: "paid" }]), "7"));
check("취소도 셈에서 뺀다", !hasUnpaidOrder(storeWith([{ table_number: "7", status: "cancelled" }]), "7"));
check("옆 테이블 주문은 이 테이블 것이 아니다", !hasUnpaidOrder(storeWith([{ table_number: "8", status: "new" }]), "7"));
check("테이블 번호가 숫자로 들어와도 같은 테이블로 본다", hasUnpaidOrder(storeWith([{ table_number: 7, status: "new" }]), "7"));

out.push("\n[결제 완료 — 다 받았을 때만 지운다]");
const s1 = storeWith([{ table_number: "7", status: "paid" }]);
check("전부 결제됐으면 지운다", clearPartySizeIfSettled(s1, "7") === true && s1.tables[0].party_size === null);
const s2 = storeWith([{ table_number: "7", status: "paid" }, { table_number: "7", status: "new" }]);
check("한 라운드만 결제했으면 그대로 둔다(손님이 아직 앉아 있다)",
  clearPartySizeIfSettled(s2, "7") === false && s2.tables[0].party_size === 4);
const s3 = storeWith([{ table_number: "7", status: "paid" }, { table_number: "7", status: "cancelled" }]);
check("취소된 주문은 결제를 막지 않는다", clearPartySizeIfSettled(s3, "7") === true && s3.tables[0].party_size === null);
check("지울 인원수가 없으면 false", clearPartySizeIfSettled(storeWith([], { party_size: null }), "7") === false);
check("없는 테이블이면 false", clearPartySizeIfSettled(storeWith([]), "99") === false);
const s4 = storeWith([{ table_number: "7", status: "paid" }]);
clearPartySizeIfSettled(s4, "7");
check("지울 때 등록 시각도 같이 비운다", s4.tables[0].party_size_updated_at === null);

out.push("\n[취소로는 절대 지우지 않는다]");
// 이 모듈은 취소 경로에서 아예 불리지 않는다(src/routes/orders.js). 그래도
// 실수로 불렸을 때 어떻게 되는지가 아니라, "취소만 남은 테이블"이 결제된
// 테이블과 구별되지 않는다는 점이 중요하다 — 그래서 부르는 쪽이 결제일
// 때만 부르도록 되어 있고, 그 조건을 아래 소스 검사로 지킨다.
const fs = require("fs");
const path = require("path");
const ordersSrc = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "orders.js"), "utf8");
check("주문 상태 변경에서 결제일 때만 인원수를 정리한다",
  /status === "paid" && clearPartySizeIfSettled\(/.test(ordersSrc));
check("예전의 \"살아 있는 주문이 없으면 지운다\" 규칙이 남아 있지 않다",
  !/party_size = null/.test(ordersSrc), "orders.js 안에서 직접 지우는 코드가 남아 있다");

// 자리 이동에서도 인원수를 라우트가 직접 만지지 않는다. 여기서 비우는 건
// "손님이 나갔다" 가 아니라 "그 손님이 저쪽 자리로 갔다" 이고, 그래서
// 저쪽에 그대로 옮겨 붙어야 한다 — 옮긴 자리에서 다시 물어보면 안 된다.
// 규칙이 이 파일 밖으로 새면 위의 "결제했을 때만 비운다" 가 조용히 무너진다.
check("자리 이동도 partySize.js 를 거친다", /movePartySize\(/.test(ordersSrc));
{
  const { movePartySize } = require("../src/partySize");
  const s2 = { tables: [
    { number: "5", party_size: 3 },
    { number: "8", party_size: null },
    { number: "9", party_size: 2 },
  ] };
  check("빈 자리로 옮기면 그대로 따라간다",
    movePartySize(s2, "5", "8") && s2.tables[1].party_size === 3 && !s2.tables[0].party_size);
  s2.tables[0].party_size = 4;
  check("손님이 있는 자리로 합치면 더해진다",
    movePartySize(s2, "5", "9") && s2.tables[2].party_size === 6, String(s2.tables[2].party_size));
  check("인원수가 없으면 아무것도 안 한다", movePartySize(s2, "5", "8") === false);
}
const paymentsSrc = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "payments.js"), "utf8");
check("온라인 결제도 같은 규칙을 쓴다", /clearPartySizeIfSettled\(/.test(paymentsSrc));
check("온라인 결제 쪽에도 직접 지우는 코드가 없다", !/party_size = null/.test(paymentsSrc));

out.push("\n[시간으로는 지우지 않는다]");
// 사장님: "결제를 완료했다고 직원이 누르지 않는 한 ... 계속 같은 손님".
// 자동 만료를 다시 넣으면 오래 드시는 손님의 인원수가 식사 중에 사라진다.
const partySrc = fs.readFileSync(path.join(__dirname, "..", "src", "partySize.js"), "utf8");
check("만료 시간 상수가 없다", !/STALE|EXPIR|60 \* 60 \* 1000/.test(partySrc), "시간 기반 만료가 다시 들어왔다");
const tablesSrc = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "tables.js"), "utf8");
check("인원수를 물어볼지 정하는 GET 은 아무것도 지우지 않는다",
  /router\.get\("\/:tableNumber\/party-size", \(req, res\) => \{/.test(tablesSrc));

out.push("\n[직원이 직접 비우는 길]");
// 결제 없이 손님이 나간 테이블(인원수만 찍고 안 시켰거나, 주문이 전부
// 취소된 경우)을 정리하는 유일한 길이다.
check("비우기 라우트는 직원 전용이다",
  /router\.delete\("\/:tableNumber\/party-size", requireAdmin,/.test(tablesSrc),
  "손님도 남의 테이블 인원수를 지울 수 있다");
const adminSrc = fs.readFileSync(path.join(__dirname, "..", "public", "js", "admin.js"), "utf8");
check("결제 화면에 「손님 나감」 버튼이 있다", /clearPartySizeBtn/.test(adminSrc));
check("누르면 DELETE 를 보낸다", /party-size`, \{ method: "DELETE" \}/.test(adminSrc));
check("누르기 전에 한 번 확인한다", /showConfirm\(T\("clearPartySizeConfirm"\)\)/.test(adminSrc));
// 결제할 돈이 남아 있으면 눌러야 하는 건 「결제 완료」이지 이 버튼이 아니다.
check("안 받은 돈이 있으면 버튼을 내놓지 않는다",
  /showClearParty = !!\(table && !table\.is_counter && table\.party_size && unpaidOrders\.length === 0\)/.test(adminSrc));
check("포장 카운터에는 안 나온다(인원수를 안 쓴다)", /!table\.is_counter && table\.party_size/.test(adminSrc));
// 직원이 비워야 하는 숫자는 화면에 보여야 한다 — 안 보이면 비울 생각을
// 할 수가 없다. 주문이 없어도 배지와 제목에 인원수가 나온다.
check("주문이 없어도 제목에 인원수를 보여준다",
  /const partyText = table && table\.party_size \? /.test(adminSrc));
check("배치도 타일도 주문 없이 인원수만 있어도 배지를 보여준다",
  !/party_size && unpaid\.length > 0/.test(adminSrc) && !/party_size && bundledOrders\.length > 0/.test(adminSrc),
  "아직 \"주문이 있을 때만\" 조건이 남아 있다");
for (const key of ["clearPartySizeBtn", "clearPartySizeConfirm", "clearPartySizeDone", "clearPartySizeFailed"]) {
  const uses = (adminSrc.match(new RegExp(`${key}:`, "g")) || []).length;
  check(`${key} 가 한국어/중국어 둘 다 있다`, uses >= 2, `${uses}개`);
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
