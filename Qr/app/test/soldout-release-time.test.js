// 품절이 언제 풀리는가 — 그 시각을 사장님이 정하고, 화면이 그 시각을 말한다.
//
// 사장님(2026-09-11): "이거 품절 10일까지였는데 오늘 11일인데 안 풀렸어.
// 저 시간은 대만 기준으로 지정해줘야 해. 혹시 미국 시간으로 한 거 같기도
// 하고 아니면 코드 문제인 건가."
//
// ── 무슨 일이었나 ───────────────────────────────────────────────────
//
// 시간대는 멀쩡했다(src/time.js 가 Intl 로 Asia/Taipei 를 못박아 쓴다).
// 안 풀린 게 아니라 **아직 그 시각이 안 된 것**이었다 — 규칙이 자정이 아니라
// 「다음 날 영업 시작(11:00)」이라, 11일 아침 11시 전에는 품절이 맞다.
//
// 동작은 맞는데 화면이 그 말을 안 했다. 배지에는 「9/10 ~ 9/10」만 있으니
// 11일 아침엔 당연히 풀렸어야 한다고 읽힌다.
//
// ── 이 파일이 지키는 세 가지 ────────────────────────────────────────
//
//   1. 해제 시각을 사장님이 고를 수 있다. 안 고르면 예전 그대로(영업 시작).
//   2. 서버가 **언제 풀리는지**를 같이 내려보낸다. 화면은 그걸 적기만 한다 —
//      규칙을 화면에도 적어두면 언젠가 한쪽만 고쳐진다.
//   3. 이상한 값을 저장해서 조용히 예전 시각으로 돌아가는 일이 없다.
const fs = require("fs");
const path = require("path");
const {
  openingTime, releaseTime, hhmm, soldOutWindow, isAvailableNow, withAvailability, DEFAULT_OPENING,
} = require("../src/availability");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

// 실제 가게 설정 그대로. 영업 시작 11:00.
const S = { store_hours: "11:00-13:35, 16:30-20:35" };
const withRelease = (t) => Object.assign({}, S, { soldout_release_time: t });
// 사장님이 실제로 걸어두셨던 그 품절: 9/10 하루짜리.
const KIMBAP = { available: 1, soldout_from: "2026-09-10", soldout_until: "2026-09-10" };
const shows = (settings, now) => (isAvailableNow(KIMBAP, settings, now) ? "판매" : "품절");

out.push("[1] 고른 값이 없으면 예전 그대로 — 영업 시작");
{
  check("영업 시작을 그대로 쓴다", releaseTime(S) === "11:00", releaseTime(S));
  check("설정이 아예 없으면 기본값", releaseTime({}) === DEFAULT_OPENING, releaseTime({}));
  check("영업시간과 같은 값이다", releaseTime(S) === openingTime(S), "");
  // ★ 배포만으로 동작이 바뀌면 안 된다. 이미 이렇게 돌던 가게다.
  check("★ 9/11 10:00 — 아직 품절", shows(S, "2026-09-11 10:00:00") === "품절", "");
  check("★ 9/11 11:00 — 풀린다", shows(S, "2026-09-11 11:00:00") === "판매", "");
}

out.push("\n[2] ★★ 사장님이 시각을 고르면 그 시각에 풀린다");
{
  const midnight = withRelease("00:00");
  check("자정으로 고르면 자정", releaseTime(midnight) === "00:00", releaseTime(midnight));
  check("9/10 23:59 — 아직 품절", shows(midnight, "2026-09-10 23:59:59") === "품절", "");
  check("★ 9/11 00:00 — 풀린다", shows(midnight, "2026-09-11 00:00:00") === "판매", "");
  check("★ 9/11 10:00 — 이미 풀려 있다", shows(midnight, "2026-09-11 10:00:00") === "판매", "");

  const dawn = withRelease("06:00");
  check("새벽 6시로도 된다", shows(dawn, "2026-09-11 05:59:59") === "품절" && shows(dawn, "2026-09-11 06:00:00") === "판매", "");

  const late = withRelease("17:00");
  check("저녁으로 미룰 수도 있다", shows(late, "2026-09-11 12:00:00") === "품절" && shows(late, "2026-09-11 17:00:00") === "판매", "");
}

out.push("\n[3] 이상한 값은 안 받는다 (조용히 예전 시각으로 돌아가되, 저장은 막는다)");
{
  check('"25:00" 은 값이 아니다', hhmm("25:00") === null, String(hhmm("25:00")));
  check('"11:70" 도 아니다', hhmm("11:70") === null, String(hhmm("11:70")));
  check('"아침" 도 아니다', hhmm("아침") === null, String(hhmm("아침")));
  check('빈 칸도 아니다', hhmm("") === null, String(hhmm("")));
  check('"9:30" 은 "09:30" 으로', hhmm("9:30") === "09:30", String(hhmm("9:30")));
  check("이상한 값이 들어 있으면 영업 시작으로", releaseTime(withRelease("25:00")) === "11:00", "");
}

out.push("\n[4] ★★ 서버가 「언제 풀리는지」를 같이 내려보낸다");
{
  // 화면은 이 값을 적기만 한다. 규칙 계산은 서버 한 곳뿐이다.
  const v = withAvailability(KIMBAP, S, "2026-09-11 10:00:00");
  check("★ 풀리는 시각이 들어 있다", v.soldout_release_at === "2026-09-11 11:00:00", String(v.soldout_release_at));
  check("그때는 아직 품절이다", v.available === 0, String(v.available));

  const v2 = withAvailability(KIMBAP, withRelease("00:00"), "2026-09-10 22:00:00");
  check("★ 고른 시각이 반영된다", v2.soldout_release_at === "2026-09-11 00:00:00", String(v2.soldout_release_at));

  // 「계속 품절」은 풀릴 일이 없다. 없는 시각을 지어내지 않는다.
  const always = { available: 0, soldout_from: null, soldout_until: null };
  check("★ 계속 품절에는 시각이 없다", withAvailability(always, S).soldout_release_at === null, String(withAvailability(always, S).soldout_release_at));
  const onSale = { available: 1, soldout_from: null, soldout_until: null };
  check("판매 중에도 없다", withAvailability(onSale, S).soldout_release_at === null, "");

  // 끝 날짜 없이 시작만 정한 품절도 풀릴 시각이 없다.
  const openEnded = { available: 1, soldout_from: "2026-09-10", soldout_until: null };
  check("끝 날짜가 없으면 시각도 없다", withAvailability(openEnded, S).soldout_release_at === null, "");
}

out.push("\n[5] 창(window) 자체가 고른 시각을 쓴다");
{
  check("기본", soldOutWindow(KIMBAP, S).until === "2026-09-11 11:00:00", String(soldOutWindow(KIMBAP, S).until));
  check("고른 값", soldOutWindow(KIMBAP, withRelease("03:30")).until === "2026-09-11 03:30:00", "");
  check("시작은 그 날 0시 그대로", soldOutWindow(KIMBAP, S).from === "2026-09-10 00:00:00", "");
}

out.push("\n[6] 설정 저장 — 형식을 서버가 막는다");
{
  const src = fs.readFileSync(path.join(__dirname, "../src/routes/settings.js"), "utf8");
  check("저장할 수 있는 값이다", /"soldout_release_time"/.test(src), "");
  check("★ 형식을 확인하고 넣는다", /hhmm\(releaseRaw\)/.test(src), "");
  check("★ 아무 값이나 그냥 안 넣는다", /if \(key === "soldout_release_time"\) continue;/.test(src), "");
  check("★ 비우면 지운다 (영업 시작을 따른다는 뜻)", /delete store\.settings\.soldout_release_time/.test(src), "");
  // 빈 칸과 틀린 값은 다르다. 틀린 값을 빈 칸처럼 다루면 고른 시각이 조용히
  // 사라진다 — 저장했다고 믿은 채로.
  check("★ 틀린 값은 거절한다 (지우지 않는다)", /status\(400\)[\s\S]{0,60}bad_soldout_release_time/.test(src), "");
  check("★ 저장하기 전에 막는다", src.indexOf("bad_soldout_release_time") < src.indexOf("for (const key of PUBLIC_KEYS)"), "");
}

out.push("\n[7] 화면 배선");
{
  const js = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../public/admin.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../public/css/admin.css"), "utf8");

  check("설정에 칸이 있다", /id="s_soldout_release_time"/.test(html), "");
  check("★ 그 카드에 저장 버튼이 있다", /id="saveSoldOutReleaseBtn"/.test(html) && /#saveSoldOutReleaseBtn/.test(js), "");
  check("설정을 열 때 채운다", /\$\("#s_soldout_release_time"\)\.value = s\.soldout_release_time/.test(js), "");
  check("★ 비워서 저장하면 비운 채로 간다", /soldout_release_time: \$\("#s_soldout_release_time"\)\.value\.trim\(\)/.test(js), "");
  check("지금 몇 시에 풀리는지 말해준다", /renderSoldOutReleaseNote/.test(js) && /id="soldOutReleaseEffective"/.test(html), "");

  check("★ 배지가 풀리는 시각을 적는다", /soldOutReleaseNote\(item\)/.test(js), "");
  // ★ 화면이 규칙을 다시 계산하면 안 된다 — 서버가 보낸 값을 쓴다.
  check("★ 서버가 보낸 값을 그대로 쓴다", /item\.soldout_release_at/.test(js), "");
  check("배지 줄에 모양이 있다", /\.soldout-release/.test(css), "");

  check("★ 그 시각에 스스로 다시 불러온다", /function scheduleSoldOutRefresh\(\)/.test(js), "");
  check("메뉴를 불러올 때마다 알람을 다시 건다", /loadMenu\(\)[\s\S]{0,400}scheduleSoldOutRefresh\(\);/.test(js), "");
  check("이미 팔리는 것은 건너뛴다", /if \(item\.available\) continue;/.test(js), "");

  check("두 언어 모두 있다", (js.match(/soldOutReleasesAt:/g) || []).length === 2, "");
  check("설정 문구도 두 언어", (js.match(/labelSoldOutReleaseTime:/g) || []).length === 2, "");
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
