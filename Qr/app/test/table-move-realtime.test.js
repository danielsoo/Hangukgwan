// 자리 이동을 손님 폰이 「언제」 알게 되는가.
//
// 2026-09-10 사장님: "자리 이동을 하면 그 즉시 그 자리는 빈 자리로 새 손님을
// 받을 준비가 되어있어야 해. 그리고 60초마다 갱신하는 게 아니라 그 이벤트가
// 발생하면 그걸 인지하고 작동하는 방식으로 하면 되는 거 아니야?"
//
// 처음 만들 때는 폰이 1분마다 물어보게 했고, 안내는 옛 자리에 3시간 붙어
// 있었다. 둘 다 같은 값을 다르게 틀리게 만든다 — 안내가 늦게 오고, 늦게
// 사라진다. 그 사이에 손님은 옛 자리로 주문을 한 번 더 넣을 수 있고, 그
// 자리에 새로 앉은 손님은 남의 안내를 볼 수 있다.
//
// 이 파일은 그 두 가지가 되돌아오지 않는지만 잰다.
const fs = require("fs");
const path = require("path");
const { channelForTable } = require("../src/realtime");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const orderJs = read("public", "js", "order.js");
const ordersJs = read("src", "routes", "orders.js");
const tablesJs = read("src", "routes", "tables.js");

out.push("[자리마다 자기 채널을 쓴다]");
// 모두가 듣는 채널에 실으면 매장 안 모든 손님 폰이 남의 자리 이동과 주문
// 번호까지 받는다. 쓸 데도 없고 보낼 이유도 없다.
check("보통 번호는 그대로 읽힌다", channelForTable("7") === "table-7", channelForTable("7"));
check("자리마다 다른 채널", channelForTable("7") !== channelForTable("8"));
// Pusher 채널 이름에 쓸 수 있는 글자: a-z A-Z 0-9 _ - = @ , . ;
const OK = /^[A-Za-z0-9_\-=@,.;]+$/;
for (const n of ["7", "A1", "안쪽 1", "테라스-2", "3 번", "table/9", "①"]) {
  check(`「${n}」 도 Pusher 가 받는 이름이 된다`, OK.test(channelForTable(n)), channelForTable(n));
}
check("이상한 번호끼리도 안 겹친다", channelForTable("안쪽 1") !== channelForTable("안쪽 2"));
check("빈 번호에도 던지지 않는다", OK.test(channelForTable("")) || channelForTable("") === "table-x", channelForTable(""));

out.push("\n[이동하는 순간 그 자리로 밀어준다]");
check("이동 라우트가 그 자리 채널로 보낸다", /broadcastTableMoved\(from, \{/.test(ordersJs),
  "POST /move 가 push 를 안 한다 — 폰은 다시 물어볼 때까지 모른다");
check("보내는 내용이 화면이 쓰는 것과 같다",
  /broadcastTableMoved\(from, \{[\s\S]{0,200}?to,[\s\S]{0,200}?order_ids:[\s\S]{0,200}?seating:/.test(ordersJs));
check("서버가 채널 이름을 내려준다", /realtime_channel: channelForTable\(table\.number\)/.test(tablesJs));
check("손님 화면은 채널 이름을 스스로 만들지 않는다",
  !/["'`]table-\$\{/.test(orderJs), "브라우저가 규칙을 따로 갖고 있으면 한쪽만 고쳐졌을 때 어긋난다");
check("손님 화면이 그 채널을 구독한다", /subscribe\(realtimeChannelName\)/.test(orderJs));
check("moved 를 받으면 바로 안내를 띄운다", /channel\.bind\("moved", \(payload\) => checkMovedTable\(payload\)\)/.test(orderJs));

out.push("\n[붙어 있는 동안에는 물어보지 않는다]");
// 사장님이 없애라고 한 것이 이 부분이다. 연결이 살아 있는 동안 1분마다
// 서버를 두드리는 건 push 를 붙여놓고 폴링을 그대로 두는 것과 같다.
check("연결돼 있으면 주기적으로 묻지 않는다",
  /if \(!realtimeTableConnected\) refreshTableState\(\);/.test(orderJs),
  "여전히 무조건 1분마다 묻는다");
// 다만 폰이 잠겨 있는 동안 온 이벤트는 놓친다 — 다시 켤 때 한 번은 확인해야
// 한다. 이건 주기가 아니라 「그 순간」이라 사장님 말과 어긋나지 않는다.
check("폰을 다시 켤 때는 한 번 확인한다",
  /visibilitychange[\s\S]{0,400}?refreshTableState\(\);/.test(orderJs));
check("연결이 끊기면 다시 묻는 쪽으로 돌아간다",
  /"disconnected"[\s\S]{0,120}?realtimeTableConnected = false/.test(orderJs));
// Pusher 를 아직 설정하지 않은 매장에서도 화면은 그대로 돌아가야 한다.
check("설정이 없으면 구독을 시도하지 않는다",
  /if \(!cfg \|\| !cfg\.enabled \|\| !cfg\.key \|\| !cfg\.cluster\) return;/.test(orderJs));
check("pusher 스크립트는 필요할 때만 받아온다",
  !/js\.pusher\.com/.test(read("public", "order.html")) && /js\.pusher\.com/.test(orderJs),
  "손님 화면에 무조건 얹혀 있다");

out.push("\n[안내는 즉시 사라진다]");
// "그 즉시 그 자리는 빈 자리로." 안내가 자리에 붙어 있는 시간만큼 그 자리는
// 아직 뭔가 남은 자리다.
check("확인을 누르면 서버에도 알린다", /moved-ack/.test(orderJs));
check("서버에 지우는 길이 있다", /router\.post\("\/:tableNumber\/moved-ack"/.test(tablesJs));
check("옮겨간 자리가 맞을 때만 지운다", /moved_to_mismatch/.test(tablesJs),
  "지나가던 요청 하나가 남의 안내를 없앨 수 있다");
check("새 손님이 앉아도 지운다", /delete table\.moved_to;/.test(tablesJs));
check("확인을 누르면 폰에서도 옛 자리 주문 번호를 지운다",
  /localStorage\.removeItem\(`hgk_orders_\$\{tableNumber\}`\)/.test(orderJs),
  "뒤로 가기 한 번이면 이미 확인한 안내가 다시 뜬다");

// 마지막 그물의 길이. 위의 세 경로가 모두 실패한 경우 — 폰이 잠겨 있어
// push 도 못 받고 확인도 못 눌렀고, 그 자리에 새로 앉은 사람도 없는 경우 —
// 에만 쓰인다. 한 끼 식사만큼 길 이유가 없다.
{
  const m = tablesJs.match(/const MOVED_NOTICE_MS = ([^;]+);/);
  check("마지막 그물 값이 있다", !!m);
  const ms = m ? Function(`return ${m[1]}`)() : 0;
  check("한 시간을 넘기지 않는다", ms > 0 && ms <= 60 * 60 * 1000, `${ms}ms`);
  check("바로 사라지지도 않는다(폰이 잠겨 있었을 수 있다)", ms >= 5 * 60 * 1000, `${ms}ms`);
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
