// 설정 카드는 **자기 안에서** 저장할 수 있어야 한다.
//
// 사장님(2026-09-11): "전체적으로 설정에서 변경하고 저장하는 부분들이 각
// 부분에 있어야 할 것 같아. 먼저 저장이 없는 애들부터 분류후에 저장 버튼을
// 넣고 저장되게 하는 기능 넣어주면 될 것 같아."
//
// ── 무슨 일이 있었나 ────────────────────────────────────────────────
//
// 「위치 기반 주문 제한」 카드에는 허용 반경과 위치 확인 스위치가 있는데,
// 저장은 「매장 정보」 카드의 버튼이 하고 있었다. 그 카드는 다른 분류에
// 있어서 화면에 보이지도 않는다 — 고쳐놓고 저장할 길이 없었다.
// 「품절 자동 해제 시각」도 만들 때 같은 실수를 할 뻔했다.
//
// ── 이 파일이 지키는 두 가지 ────────────────────────────────────────
//
//   1. **고칠 수 있으면 그 자리에서 저장 버튼을 누른다.** 2026-09-11 사장님:
//      "누르는 즉시 저장되는 카드 — 이것도 그냥 저장 누르게 만들어줘."
//      즉시 저장하던 네 카드(글자 크기·알림음·로고·직원 권한)도 이제
//      저장 버튼을 가진다. 설정은 전부 같은 방식으로 움직여야 한다.
//   2. **한 카드의 저장이 남의 칸을 건드리지 않는다.** 예전에는 매장 정보를
//      저장하면 안 건드린 위치 반경·계절 설정까지 화면 값으로 덮어썼다.
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const html = fs.readFileSync(path.join(__dirname, "../public/admin.html"), "utf8");
const js = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");

// ── 설정 영역을 카드 단위로 자른다 ──────────────────────────────────
const start = html.indexOf('<div id="settings-cat-display"');
const after = html.slice(start + 50);
const endRel = after.search(/<section id="tab-|<div id="tab-|<\/main>/);
const seg = html.slice(start, start + 50 + (endRel === -1 ? after.length : endRel));

const marks = [];
const re = /<div id="settings-cat-([a-z]+)"|<div class="settings-card([^"]*)"/g;
let m;
while ((m = re.exec(seg))) marks.push({ at: m.index, cat: m[1], card: m[2] });
marks.push({ at: seg.length, cat: null, card: null });

const cards = [];
let cat = null;
for (let i = 0; i < marks.length - 1; i++) {
  if (marks[i].cat) { cat = marks[i].cat; continue; }
  const body = seg.slice(marks[i].at, marks[i + 1].at);
  const h3 = /<h3[^>]*>([\s\S]*?)<\/h3>/.exec(body);
  cards.push({
    cat,
    title: (h3 ? h3[1].replace(/<[^>]+>/g, "") : "(제목 없음)").trim(),
    inputs: [...body.matchAll(/<(?:input|select|textarea)[^>]*id="([^"]+)"/g)].map((x) => x[1]),
    buttons: [...body.matchAll(/<button[^>]*id="([^"]+)"/g)].map((x) => x[1]),
    instant: /class="[^"]*settings-instant/.test(body),
  });
}

out.push(`[설정 카드 ${cards.length}개를 찾았다]`);
check("카드가 실제로 여러 개 잡힌다", cards.length >= 15, String(cards.length));

out.push("\n[1] ★★ 고칠 수 있으면 그 자리에서 저장할 수 있다");
{
  // 입력 칸이 있는데 카드 안에 버튼이 하나도 없으면 고쳐놓고 저장할 길이 없다.
  const stranded = cards.filter((c) => c.inputs.length > 0 && c.buttons.length === 0);
  check(
    "★ 저장할 길이 없는 카드가 하나도 없다",
    stranded.length === 0,
    stranded.map((c) => `[${c.cat}] ${c.title}`).join(" / ")
  );

  // ★★ 예전에 「즉시 저장」이던 네 카드. 이제 전부 저장 버튼을 가진다.
  const mustHaveSave = [
    ["글자 크기", "uiFontScaleResetBtn", "saveUiFontScaleBtn"],
    ["알림음", "alarmVolume", "saveAlarmBtn"],
    ["매장 로고", "logoPhotoInput", "saveLogoBtn"],
    ["직원 권한", "perm_menuEdit", "saveStaffPermsBtn"],
  ];
  for (const [name, marker, saveBtn] of mustHaveSave) {
    const c = cards.find((x) => x.inputs.includes(marker) || x.buttons.includes(marker));
    check(`★ ${name} 카드에 저장 버튼`, !!c && c.buttons.includes(saveBtn), c ? JSON.stringify(c.buttons) : "카드를 못 찾음");
    check(`${name} — 저장 안 됨 표시도 있다`, !!c && new RegExp(`id="${saveBtn}Dirty"`).test(html), "");
  }
  // 「바로 저장돼요」 문구는 이제 없다 — 전부 버튼으로 바뀌었다.
  check("★ 즉시저장 문구가 남아 있지 않다", !/settings-instant/.test(html) && !/settingsInstant/.test(js), "");

  // 위치 카드는 이 일이 실제로 났던 자리다. 이름을 박아 둔다.
  const loc = cards.find((c) => c.inputs.includes("s_order_radius_m"));
  check("★ 위치 카드에 저장 버튼이 있다", !!loc && loc.buttons.includes("saveLocationSettingsBtn"),
    loc ? JSON.stringify(loc.buttons) : "카드를 못 찾음");
  const soldout = cards.find((c) => c.inputs.includes("s_soldout_release_time"));
  check("품절 해제 카드에도 있다", !!soldout && soldout.buttons.includes("saveSoldOutReleaseBtn"), "");
  // 값을 넣었다가 되돌릴 길도 그 자리에 있어야 한다 — time/date 칸은 브라우저
  // 기본 기능만으로는 다시 비우기가 어렵다(2026-09-11 사장님).
  check("★ 되돌릴 버튼도 그 카드에", !!soldout && soldout.buttons.includes("soldOutReleaseResetBtn"), "");
  check("품절 날짜 칸에도 비우기가 있다",
    ["soldOutFromClearBtn", "soldOutUntilClearBtn", "soldOutModalFromClearBtn", "soldOutModalUntilClearBtn"]
      .every((id) => new RegExp(`id="${id}"`).test(html) && js.includes(`#${id}`)), "");
}

out.push("\n[2] 저장 버튼이 없는 카드는 버튼 자체가 그 동작인 카드뿐이다");
{
  // 비밀번호 「변경」과 테스터 모드 「켜기」는 누르는 것이 곧 저장이다.
  // 그 밖에 저장 버튼 없는 카드가 새로 생기면 여기서 걸린다.
  const noSave = cards.filter((c) => !c.buttons.some((b) => /[Ss]ave/.test(b)));
  const allowed = new Set(["testModeStartBtn", "changePwBtn", "changeOwnerPwBtn"]);
  for (const c of noSave) {
    check(`[${c.cat}] ${c.title} — 누르는 것이 곧 저장인 카드`,
      c.buttons.some((b) => allowed.has(b)), JSON.stringify(c.buttons));
  }
  check("저장 안 됨 문구가 두 언어 모두 있다", (js.match(/settingsUnsaved:/g) || []).length === 2, "");
  check("로고 안내 문구도 두 언어", (js.match(/logoPicked:/g) || []).length === 2, "");
}

out.push("\n[3] ★★ 한 카드의 저장이 남의 칸을 건드리지 않는다");
{
  // 어느 칸이 어느 카드에 있는지.
  const cardOf = new Map();
  cards.forEach((c, i) => c.inputs.forEach((id) => cardOf.set(id, i)));

  // 저장 버튼의 onclick 안에서 읽는 $("#...") 들을 모은다.
  // 괄호를 세어 그 핸들러의 몸통만 정확히 잘라낸다.
  //
  // 「다음 핸들러 전까지」로 대충 자르면 뒤에 붙은 loadX() 같은 함수까지
  // 딸려 들어와서, 멀쩡한 저장 버튼이 남의 칸을 만지는 것처럼 보인다.
  // 처음에 그렇게 만들었다가 네 개가 거짓으로 실패했다.
  const handlerOf = (btnId) => {
    const at = js.indexOf(`$("#${btnId}").onclick`);
    if (at === -1) return null;
    const open = js.indexOf("{", at);
    if (open === -1) return null;
    let depth = 0;
    for (let i = open; i < js.length; i++) {
      const ch = js[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return js.slice(at, i + 1);
      }
    }
    return js.slice(at);
  };

  const saveButtons = cards.flatMap((c, i) =>
    c.buttons.filter((b) => /[Ss]ave/.test(b)).map((b) => ({ btn: b, card: i, title: c.title, cat: c.cat }))
  );
  check("저장 버튼을 여러 개 찾았다", saveButtons.length >= 8, String(saveButtons.length));

  for (const { btn, card, title } of saveButtons) {
    const body = handlerOf(btn);
    if (!body) continue; // 핸들러를 못 찾으면 여기서 판단하지 않는다
    const touched = [...body.matchAll(/\$\("#([A-Za-z0-9_]+)"\)/g)].map((x) => x[1]);
    // 다른 카드에 있는 **입력 칸**을 읽었는가. (메시지 칸·버튼은 상관없다)
    const foreign = touched.filter((id) => cardOf.has(id) && cardOf.get(id) !== card);
    check(`★ ${title} 저장은 자기 칸만`, foreign.length === 0, `남의 칸: ${[...new Set(foreign)].join(", ")}`);
  }
}

out.push("\n[4] 매장 정보 저장에서 빠진 것들");
{
  // 이 셋은 각자 자기 카드가 저장한다. 여기서 같이 보내면 안 건드린 값을
  // 화면 값으로 덮어쓴다.
  const at = js.indexOf('$("#saveSettingsBtn").onclick');
  const body = js.slice(at, js.indexOf("\n  $(\"#", at + 10));
  check("★ 위치 반경을 안 보낸다", !/order_radius_m/.test(body), "");
  check("★ 위치 스위치를 안 보낸다", !/location_check_enabled/.test(body), "");
  check("★ 계절 설정을 안 보낸다", !/taegeuk_season_mode/.test(body), "");
  check("★ 품절 해제 시각을 안 보낸다", !/soldout_release_time/.test(body), "");
  // 자기 칸은 그대로 보낸다.
  check("매장 이름은 보낸다", /store_name_zh/.test(body), "");
  check("1인당 최소 금액도 보낸다 (이 카드 안에 있다)", /store_min_spend/.test(body), "");
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
