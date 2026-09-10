// 결산 매출을 오전과 오후로 가른다.
//
// 사장님(2026-09-10): "결산 매출에 오전 매출 오후 매출을 따로 나눴으면
// 좋겠어... 좌우를 나눠서 좌는 오전 매출 우는 오후 매출로 해서 똑같은
// 것들을, 손님 수 1인당 평균, 이미 있는 기능들을 같이 넣어주고 볼 수 있게
// 해줘. 그리고 합산은 합산이라는 걸 누가봐도 알 수 있게."
//
// ── 이 파일이 지키는 단 하나 ──────────────────────────────────────────
//
//   **오전 + 오후 = 합산.** 못 가른 날이 있으면 그 사실을 말한다.
//
// 두 칸을 더했는데 위의 큰 숫자와 안 맞으면, 사장님은 그날 저녁 내내 어디서
// 새는지 찾게 된다. 맞출 수 없는 날이 있으면 조용히 넘기지 말고 얼마가
// 어느 쪽에도 안 들어갔는지 적어야 한다.
const fs = require("fs");
const path = require("path");
const { computeSettlement, halfBoundaryFor } = require("../src/settlement");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}
const D = "2026-09-10";
let seq = 0;
const paid = (table, at, total, size = 2, kids = 0, date = D) => ({
  id: ++seq, table_number: table, status: "paid",
  created_at: `${date} ${at}`, updated_at: `${date} ${at}`,
  total, party_size: size, party_adults: size - kids, party_children: kids, items: [],
});
const EVENING = { amClosedAt: {}, eveningStartsAt: "16:30" };

out.push("[1] 경계를 고르는 순서");
{
  check("오전 정산을 눌렀으면 그 시각", halfBoundaryFor(D, { amClosedAt: { [D]: `${D} 14:20:11` }, eveningStartsAt: "16:30" }) === `${D} 14:20:11`, "");
  check("안 눌렀으면 저녁 영업 시작", halfBoundaryFor(D, EVENING) === `${D} 16:30:00`, "");
  check("★ 둘 다 없으면 가르지 않는다", halfBoundaryFor(D, {}) === null, "");
}

out.push("\n[2] ★★ 오전 + 오후 = 합산");
{
  const s = computeSettlement([paid("7", "12:00:00", 1000, 2), paid("8", "13:20:00", 500, 3, 1), paid("9", "18:00:00", 2000, 4)], D, D, EVENING);
  const h = s.half_split;
  check("★ 두 몫의 합이 총 매출과 같다", h.am.revenue + h.pm.revenue === s.total_revenue, `${h.am.revenue}+${h.pm.revenue} vs ${s.total_revenue}`);
  check("오전 1500", h.am.revenue === 1500, String(h.am.revenue));
  check("오후 2000", h.pm.revenue === 2000, String(h.pm.revenue));
  check("★ 못 가른 날이 없다", h.unsplit_dates.length === 0 && h.unsplit_revenue === 0, JSON.stringify(h.unsplit_dates));
}

out.push("\n[3] 두 칸에 같은 것들이 들어간다");
{
  const s = computeSettlement([paid("7", "12:00:00", 1000, 2), paid("8", "13:20:00", 500, 3, 1), paid("9", "18:00:00", 2000, 4)], D, D, EVENING);
  const h = s.half_split;
  for (const [name, part] of [["오전", h.am], ["오후", h.pm]]) {
    check(`${name}: 매출·결제건수·손님·어른아이·1인당·주문당이 다 있다`,
      ["revenue", "paid_order_count", "guest_count", "adult_count", "child_count", "avg_per_guest", "avg_per_order"].every((k) => typeof part[k] === "number"),
      JSON.stringify(part));
    check(`${name}: 어른+아이 = 손님 수`, part.adult_count + part.child_count === part.guest_count, JSON.stringify(part));
  }
  check("오전 1인당 = 1500/5", h.am.avg_per_guest === 300, String(h.am.avg_per_guest));
  check("오후 주문당 = 2000/1", h.pm.avg_per_order === 2000, String(h.pm.avg_per_order));
}

out.push("\n[4] 경계에 딱 걸린 결제는 오전 몫");
{
  // 14:20 에 정산을 눌렀으면 14:20:00 결제는 그 서랍에 들어 있다.
  const opts = { amClosedAt: { [D]: `${D} 14:20:00` } };
  const s = computeSettlement([paid("7", "14:20:00", 700), paid("8", "14:20:01", 300)], D, D, opts);
  check("★ 같은 시각은 오전", s.half_split.am.revenue === 700, String(s.half_split.am.revenue));
  check("1초 뒤는 오후", s.half_split.pm.revenue === 300, String(s.half_split.pm.revenue));
}

out.push("\n[5] 못 가른 날은 숨기지 않고 적는다");
{
  const s = computeSettlement([paid("7", "12:00:00", 1000)], D, D, {});
  const h = s.half_split;
  check("★ 어느 쪽에도 안 넣는다", h.am.revenue === 0 && h.pm.revenue === 0, "");
  check("★ 그 날짜를 알려준다", h.unsplit_dates.length === 1 && h.unsplit_dates[0] === D, JSON.stringify(h.unsplit_dates));
  check("★ 얼마인지도 알려준다", h.unsplit_revenue === 1000, String(h.unsplit_revenue));
  check("합산에는 그대로 들어 있다", s.total_revenue === 1000, String(s.total_revenue));
}

out.push("\n[6] 여러 날을 한 번에 보면 경계를 단정하지 않는다");
{
  const opts = { amClosedAt: { [D]: `${D} 14:20:00`, "2026-09-11": "2026-09-11 15:05:00" } };
  const s = computeSettlement([paid("7", "12:00:00", 100), paid("7", "12:00:00", 100, 2, 0, "2026-09-11")], D, "2026-09-11", opts);
  check("★ 날마다 다르면 시각을 안 적는다", s.half_split.boundary_label === null, String(s.half_split.boundary_label));

  const one = computeSettlement([paid("7", "12:00:00", 100)], D, D, opts);
  check("하루만 보면 그 시각을 적는다", one.half_split.boundary_label === "14:20", String(one.half_split.boundary_label));
}

out.push("\n[7] 화면이 합산과 두 칸을 색으로 가른다");
{
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "admin.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "public", "css", "admin.css"), "utf8");
  const js = fs.readFileSync(path.join(__dirname, "..", "public", "js", "admin.js"), "utf8");
  check("좌우 두 칸이 있다", /id="settlementHalves"/.test(html) && /stl-half-am/.test(html) && /stl-half-pm/.test(html), "");
  check("★ 두 칸의 크기가 같다", /\.stl-halves\s*\{[^}]*grid-template-columns:\s*1fr 1fr/.test(css), "");
  check("★ 오전과 오후의 색이 다르다", /\.stl-half-am\s*\{[^}]*#e08a1e/.test(css) && /\.stl-half-pm\s*\{[^}]*#6a4fb3/.test(css), "");
  check("★ 합산에 「합산」 표가 붙는다", /settlementTotalBadge/.test(html) && /settlementTotalBadge: "합산"/.test(js), "");
  check("좁은 화면에서는 위아래로 쌓인다", /@media \(max-width: 640px\)[\s\S]{0,200}\.stl-halves \{ grid-template-columns: 1fr; \}/.test(css), "");
  check("못 가른 날을 화면이 말한다", /settlementHalvesGap/.test(js) && /id="settlementHalvesNote"/.test(html), "");
  check("가를 수 없으면 두 칸을 통째로 감춘다", /box\.hidden = !usable;/.test(js), "");
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
