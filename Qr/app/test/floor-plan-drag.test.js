// 배치도에서 테이블을 **실제로 끌어본다.**
//
// 2026-09-17 사장님: "지금 테이블이 이동이 1픽셀씩 되고 있어."
//
// ── 무슨 일이 있었나 ─────────────────────────────────────────────────
//
// 자리끼리 겹치면 안 되므로, 끄는 도중에 겹치는 자리가 나오면 「마지막으로
// 안 겹치던 자리」에 붙들어 뒀다. 옆 테이블에 부딪치면 멈추라는 뜻이었다.
//
// 그런데 자리는 격자로 촘촘히 놓인다. 옆 것과 거의 붙어 있으니 **끌기
// 시작하자마자** 닿고, 한 번 붙들리면 그 다음에 계산되는 자리도 계속
// 옆 것과 겹치므로 영영 안 풀린다. 화면에서는 테이블이 몇 픽셀 가다 그대로
// 서 버린 것처럼 보인다 — 사장님이 본 「1픽셀씩」이 그것이다. 게다가 옆
// 테이블 **너머로는 아예 옮길 수가 없었다.**
//
// ── 어떻게 고쳤나 ────────────────────────────────────────────────────
//
// 끄는 동안에는 커서를 그냥 따라간다. 겹치는 동안에는 테두리로 알려주고,
// 손을 뗄 때 그 자리가 여전히 겹쳐 있으면 그때 지나온 자리 중 마지막으로
// 비어 있던 곳에 놓는다. 겹친 채로 저장되는 일은 예전과 똑같이 없다.
//
// ── 이 시험이 하는 일 ────────────────────────────────────────────────
//
// 글자를 맞춰보지 않는다. admin.js 에서 makeDraggable 을 떼어내 가짜 화면에
// 붙이고 **마우스를 실제로 끌어서** 테이블이 어디로 가는지 본다.
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
const a = src.indexOf("  function makeDraggable(el, opts) {");
const b = src.indexOf("\n  function makeResizable(el, opts) {");
check("makeDraggable 을 찾았다", a > 0 && b > a, `${a}, ${b}`);
const code = src.slice(a, b);

/**
 * 가짜 화면에 테이블 하나를 놓고 마우스를 끈다.
 * path 는 커서가 지나가는 자리들. 돌려주는 것은 「손을 뗐을 때 저장된 자리」와
 * 끄는 동안의 자취.
 */
function drag({ zoneW = 600, zoneH = 400, start = [20, 60], size = [70, 70], siblings = [], steps = 24, dx = 5, dy = 0 }) {
  const parent = {
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    clientWidth: zoneW, clientHeight: zoneH, scrollLeft: 0, scrollTop: 0,
    appendChild() {}, removeChild() {},
  };
  const classes = new Set();
  const el = {
    style: { left: start[0] + "px", top: start[1] + "px" },
    parentElement: parent,
    _handlers: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
    },
    addEventListener(t, fn) { (this._handlers[t] = this._handlers[t] || []).push(fn); },
    getBoundingClientRect() {
      return { left: parseFloat(this.style.left), top: parseFloat(this.style.top), width: size[0], height: size[1] };
    },
  };
  const docHandlers = {};
  global.document = {
    createElement: () => ({ style: {}, className: "", remove() {} }),
    addEventListener(t, fn) { (docHandlers[t] = docHandlers[t] || []).push(fn); },
    removeEventListener(t, fn) { docHandlers[t] = (docHandlers[t] || []).filter((f) => f !== fn); },
  };
  let ended = null;
  // eslint-disable-next-line no-new-func
  const makeDraggable = new Function(`${code}\n return makeDraggable;`)();
  makeDraggable(el, {
    bounded: true, minY: 34, snapEnabled: true,
    getSnapSiblings: () => siblings,
    onEnd: (x, y) => { ended = [x, y]; },
    onClick: () => {},
  });

  el._handlers.mousedown[0]({
    clientX: 100, clientY: 100, target: { closest: () => null }, preventDefault() {}, stopPropagation() {},
  });
  const trail = [];
  const blockedSeen = [];
  for (let i = 1; i <= steps; i++) {
    (docHandlers.mousemove || []).forEach((fn) => fn({ clientX: 100 + i * dx, clientY: 100 + i * dy }));
    trail.push([parseFloat(el.style.left), parseFloat(el.style.top)]);
    blockedSeen.push(classes.has("table-block-blocked"));
  }
  (docHandlers.mouseup || []).forEach((fn) => fn());
  return { ended, trail, blockedSeen, classes };
}

const overlaps = (x, y, s, w = 70, h = 70) =>
  x < s.left + s.width && x + w > s.left && y < s.top + s.height && y + h > s.top;

out.push("[옆에 아무것도 없으면 그냥 따라온다]");
{
  const r = drag({});
  check("★ 끈 만큼 간다", r.ended[0] === 140, `${JSON.stringify(r.ended)} (20 + 120)`);
  check("자취가 끊기지 않는다", r.trail[5][0] > r.trail[2][0], JSON.stringify(r.trail.slice(0, 8)));
}

out.push("\n[옆 테이블에 막혀 서 버리지 않는다 — 이번에 고친 것]");
{
  // 자리 셋이 나란히 놓인 줄. 고치기 전에는 여기서 20 → 40 으로 가고 끝이었다.
  const siblings = [
    { left: 110, top: 60, width: 70, height: 70 },
    { left: 200, top: 60, width: 70, height: 70 },
  ];
  const r = drag({ siblings });
  const far = Math.max(...r.trail.map((p) => p[0]));
  check("★ 끄는 동안 옆 테이블을 지나간다", far > 110, `가장 멀리 간 곳 ${far} (옛 코드는 40에서 멈췄다)`);
  check("★ 자취가 계속 움직인다", new Set(r.trail.map((p) => p[0])).size > 5, JSON.stringify(r.trail.slice(0, 10)));
}
{
  // 이웃 너머 빈 자리까지 끌면 거기에 놓인다.
  const r = drag({ siblings: [{ left: 110, top: 60, width: 70, height: 70 }], steps: 50 });
  check("★ 이웃 너머에 놓을 수 있다", r.ended[0] >= 180, `${JSON.stringify(r.ended)}`);
}

out.push("\n[그래도 겹친 채로 저장되지는 않는다]");
{
  const sib = { left: 110, top: 60, width: 70, height: 70 };
  const r = drag({ siblings: [sib] }); // 이웃 위에서 손을 뗀다
  check("★ 저장되는 자리는 겹치지 않는다", !overlaps(r.ended[0], r.ended[1], sib), `${JSON.stringify(r.ended)}`);
  check("★ 부딪친 그 자리에 놓인다", r.ended[0] + 70 <= sib.left, `${r.ended[0]} + 70 <= ${sib.left}`);
  check("★ 끝나면 표시를 지운다", !r.classes.has("table-block-blocked"), [...r.classes].join(","));
}
{
  const r = drag({ siblings: [{ left: 110, top: 60, width: 70, height: 70 }] });
  check("★ 겹치는 동안에는 눈에 보이게 알려준다", r.blockedSeen.some(Boolean), "왜 거기 안 놓이는지 알 수 있어야 한다");
}

out.push("\n[구역 밖으로는 못 나간다 — 예전 규칙 그대로]");
{
  const r = drag({ steps: 200, dx: 5 });
  check("오른쪽 끝에서 멈춘다", r.ended[0] === 600 - 70, `${JSON.stringify(r.ended)}`);
}
{
  const r = drag({ start: [20, 60], steps: 40, dx: 0, dy: -5 });
  check("구역 머리글 밑으로는 안 올라간다", r.ended[1] === 34, `${JSON.stringify(r.ended)}`);
}

out.push("\n[코드에 옛 방식이 남아 있지 않다]");
check(
  "★ 끄는 도중에 자리를 되돌리지 않는다",
  !/if \(overlapsAny\) \{\s*newX = lastValidX;/.test(src),
  "그 한 줄이 「1픽셀씩」의 원인이었다"
);
check("겹침 판정을 한 곳에서 한다", /function overlapsSibling\(x, y\)/.test(src), "끌 때와 놓을 때가 같은 규칙이어야 한다");
check("표시할 자리(css)가 있다", fs.readFileSync(path.join(__dirname, "../public/css/admin.css"), "utf8").includes(".table-block-blocked"), "");

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
