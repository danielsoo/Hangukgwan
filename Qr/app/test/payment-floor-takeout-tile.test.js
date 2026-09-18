// 결제탭 배치도에서 포장 타일이 남의 자리 위에 겹쳐 그려지던 것.
//
// 2026-09-18 사장님(결제탭 스크린샷 두 장과 함께): "2번째 화면처럼 식사중에
// 추가주문으로 포장을 했는데, 1번화면의 결제창에서 테이블이 화면이 이렇게
// 보이는거 왜 그러는거야"
//
// 6번 자리가 식사 중(海鮮豆腐鍋 등)인데 추가로 포장(韓式紫菜捲)을 시켰다.
// 결제탭에서는 그 포장 주문을 **따로 누를 수 있는 타일**로 떼어 놓는다
// (2026-09-05 사장님: "저기 저 박스 누르면 나오게 해달라는 말이야").
//
// ── 원인 ─────────────────────────────────────────────────────────────
//
// 그 타일을 놓는 규칙이 하나뿐이었다: **그 테이블 바로 오른쪽**
// (x + 너비 + 틈). 거기에 이미 다른 자리가 있어도 상관하지 않았다. 배치도는
// 자리가 촘촘하니 바로 오른쪽은 거의 언제나 남의 자리다 — 사장님 화면에서는
// 8번 위에 겹쳐 그려졌다.
//
// 게다가 자리를 하나씩 돌면서 그 자리에서 바로 그렸기 때문에, 아직 안 그린
// 옆 자리는 알 수도 없었다.
//
// ── 고친 뒤 ──────────────────────────────────────────────────────────
//
// 자리를 먼저 다 정하고 나서 그린다. 포장 타일은 빈 칸을 찾아 놓는다 —
// 같은 줄 오른쪽 → 같은 줄 왼쪽 → 아랫줄 → 윗줄, 구역이 꽉 찼으면 구역
// 아래. 겹쳐 그리느니 삐져나가는 편이 낫다.
//
// 이 시험은 그 자리 찾는 규칙(findFreeTileSpot)을 파일에서 떼어내 실제로
// 돌려보고, **놓인 자리가 다른 것과 겹치는지** 직접 잰다.
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const src = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
const a = src.indexOf("  function findFreeTileSpot(occupied, opts) {");
const b = src.indexOf("\n  function renderPaymentFloorPlan() {");
check("자리 찾는 규칙을 찾았다", a > 0 && b > a, `${a}, ${b}`);
// eslint-disable-next-line no-new-func
const findFreeTileSpot = new Function(`${src.slice(a, b)}\n return findFreeTileSpot;`)();

const GAP = 8;
const SIZE = 70;
const HEADER = 34;
const hits = (x, y, r, w = SIZE, h = SIZE) =>
  x < r.left + r.width && x + w > r.left && y < r.top + r.height && y + h > r.top;

/** 한 줄에 자리 넷이 나란히 — 사장님 화면의 「전면」 구역과 같은 모양. */
function rowOfFour() {
  return [0, 1, 2, 3].map((i) => ({ left: 10 + i * (SIZE + GAP), top: 100, width: SIZE, height: SIZE }));
}

out.push("[사장님 화면 그대로 — 줄 가운데 자리가 포장을 시켰다]");
{
  const occupied = rowOfFour();
  const me = occupied[1]; // 6번 자리라고 치자
  const spot = findFreeTileSpot(occupied, {
    zoneW: 760, zoneH: 560, preferLeft: me.left + SIZE + GAP, top: me.top,
    w: SIZE, h: SIZE, gap: GAP, minTop: HEADER,
  });
  check(
    "★ 어떤 자리와도 안 겹친다",
    !occupied.some((r) => hits(spot.left, spot.top, r)),
    `${JSON.stringify(spot)} vs ${JSON.stringify(occupied)}`
  );
  check("★ 옛 방식이 놓던 자리(바로 오른쪽)가 아니다", spot.left !== me.left + SIZE + GAP, JSON.stringify(spot));
  check("같은 줄에 남는다 — 눈이 따라가기 쉽게", spot.top === me.top, JSON.stringify(spot));
  check("줄 오른쪽 끝 빈 칸으로 간다", spot.left === 10 + 4 * (SIZE + GAP), JSON.stringify(spot));
}

out.push("[바로 오른쪽이 비어 있으면 거기 그대로]");
{
  const occupied = [{ left: 10, top: 100, width: SIZE, height: SIZE }];
  const spot = findFreeTileSpot(occupied, {
    zoneW: 760, zoneH: 560, preferLeft: 10 + SIZE + GAP, top: 100,
    w: SIZE, h: SIZE, gap: GAP, minTop: HEADER,
  });
  check("★ 붙여 놓는다", spot.left === 10 + SIZE + GAP && spot.top === 100, JSON.stringify(spot));
}

out.push("[줄이 꽉 찼으면 다른 줄로]");
{
  // 한 줄을 구역 폭 끝까지 채운다.
  const zoneW = 10 + 4 * (SIZE + GAP);
  const occupied = rowOfFour();
  const spot = findFreeTileSpot(occupied, {
    zoneW, zoneH: 560, preferLeft: 10 + 2 * (SIZE + GAP), top: 100,
    w: SIZE, h: SIZE, gap: GAP, minTop: HEADER,
  });
  check("★ 안 겹친다", !occupied.some((r) => hits(spot.left, spot.top, r)), JSON.stringify(spot));
  check("★ 줄을 바꾼다", spot.top !== 100, JSON.stringify(spot));
  check("구역 안에 있다", spot.left >= 0 && spot.left + SIZE <= zoneW && spot.top + SIZE <= 560, JSON.stringify(spot));
}

out.push("[구역이 통째로 꽉 찼으면 아래로 — 겹치느니 삐져나간다]");
{
  const zoneW = 10 + 2 * (SIZE + GAP);
  const zoneH = 100 + 2 * (SIZE + GAP);
  const occupied = [];
  for (let y = HEADER; y + SIZE <= zoneH; y += SIZE + GAP) {
    for (let x = 0; x + SIZE <= zoneW; x += SIZE + GAP) occupied.push({ left: x, top: y, width: SIZE, height: SIZE });
  }
  const spot = findFreeTileSpot(occupied, {
    zoneW, zoneH, preferLeft: 10, top: HEADER, w: SIZE, h: SIZE, gap: GAP, minTop: HEADER,
  });
  check("★ 그래도 안 겹친다", !occupied.some((r) => hits(spot.left, spot.top, r)), JSON.stringify(spot));
  check("★ 구역 아래로 내려간다", spot.top >= zoneH, `${JSON.stringify(spot)} / 구역 높이 ${zoneH}`);
}

out.push("[한 자리가 포장을 여러 건 시켜도 서로 안 겹친다]");
{
  const occupied = rowOfFour();
  const me = occupied[1];
  let preferLeft = me.left + SIZE + GAP;
  const placed = [];
  for (let i = 0; i < 4; i++) {
    const spot = findFreeTileSpot(occupied, {
      zoneW: 760, zoneH: 560, preferLeft, top: me.top, w: SIZE, h: SIZE, gap: GAP, minTop: HEADER,
    });
    check(
      `★ ${i + 1}번째 포장 타일이 안 겹친다`,
      !occupied.some((r) => hits(spot.left, spot.top, r)),
      `${JSON.stringify(spot)}`
    );
    occupied.push({ left: spot.left, top: spot.top, width: SIZE, height: SIZE });
    placed.push(spot);
    preferLeft = spot.left + SIZE + GAP;
  }
  const keys = new Set(placed.map((s) => `${s.left},${s.top}`));
  check("★ 네 장이 서로 다른 자리에 놓인다", keys.size === 4, JSON.stringify(placed));
}

out.push("[구역 머리글을 덮지 않는다]");
{
  const occupied = [{ left: 10, top: HEADER, width: SIZE, height: SIZE }];
  const spot = findFreeTileSpot(occupied, {
    zoneW: 200, zoneH: 560, preferLeft: 10 + SIZE + GAP, top: HEADER,
    w: SIZE, h: SIZE, gap: GAP, minTop: HEADER,
  });
  check("★ 머리글 위로 안 올라간다", spot.top >= HEADER, JSON.stringify(spot));
}

out.push("[그리는 쪽이 이 규칙을 쓴다]");
check(
  "★ 포장 타일이 빈 자리를 찾아 놓인다",
  /const spot = findFreeTileSpot\(occupied, \{/.test(src),
  "규칙만 만들고 안 쓰면 화면은 그대로다"
);
check(
  "★ 놓은 자리를 「찬 자리」에 더한다",
  /occupied\.push\(\{ left: spot\.left, top: spot\.top/.test(src),
  "안 더하면 두 번째 포장 타일이 첫 번째 위에 겹친다"
);
check(
  "★ 자리를 먼저 다 정하고 나서 그린다",
  src.indexOf("const occupied = plans") < src.indexOf("plans.forEach((p) => {"),
  "하나씩 돌며 그리면 아직 안 그린 옆 자리를 모른다"
);
check(
  "★ 옛 방식(무조건 바로 오른쪽)이 사라졌다",
  !/nextLeft \+= w \+ gap;/.test(src),
  "그 한 줄이 남의 자리 위에 겹쳐 그리던 원인이었다"
);

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
