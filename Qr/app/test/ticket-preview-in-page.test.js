// 빌지 미리보기가 앱 안에서 조용히 죽어 있던 것, 그리고 같은 뿌리의
// 자리 이동 빌지.
//
// 2026-09-19 사장님: "현재 웹에서는 실시간 탭에서 나오는 모든 상태의 인쇄
// 옆에 있는 미리보기가 보이는데 앱으로 apk 받은 것에서는 안 보여."
//
// ── 병 ───────────────────────────────────────────────────────────────
//
// 한국관 POS 앱(태블릿 네이티브 WebView)의 MainActivity.java 는
// onCreateWindow 에서 **언제나 false** 를 돌려준다. 그러면 페이지의
// window.open() 이 null 이 된다.
//
// 그 차단은 원래 영수증 인쇄의 마지막 폴백 한 곳만 겨냥한 것이었다 —
// 거기서는 window.open 이 막히면 「인쇄 실패」가 카드에 뜬다. 조용하지 않다.
// 문제는 그 그물에 **다른 window.open 까지 같이 걸렸다**는 것이다.
//
//   2026-09-16  수기 주문 버튼   ← 이미 한 번 당했다(HangukgwanPrint 로 우회)
//   2026-09-19  빌지 미리보기     ← 사장님이 겪은 것
//   2026-09-19  자리 이동 빌지    ← 아무도 못 보고 있던 것
//
// 미리보기는 `if (!win) return;` 이었다. 버튼은 보이는데 눌러도 아무 일이
// 안 일어났다.
//
// 자리 이동 빌지는 `if (!win) return false;` 였고 **부르는 쪽이 그 값을 아예
// 안 봤다.** 앱에서 프린터가 안 잡히면 자리 이동 빌지가 말없이 안 나갔다.
// 이쪽이 더 무겁다 — 주방은 옛 번호가 찍힌 주문서를 그대로 들고 있다.
//
// ── 이 시험이 재는 것 ────────────────────────────────────────────────
//
// 「모달이 예쁘게 뜨는가」가 아니라 **증상의 원인**을 잰다:
//
//  1) 미리보기가 window.open 을 아예 안 쓰는가 (안 쓰면 앱이 막을 것이 없다)
//  2) 실제로 돌렸을 때 화면에 뭔가 뜨는가 — 함수를 떼어내 진짜 실행한다
//  3) 인쇄 실패가 조용히 넘어가는 자리가 남아 있지 않은가
const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const out = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name}  ${extra}`); }
}

const APP = path.join(__dirname, "..");
const admin = fs.readFileSync(path.join(APP, "public/js/admin.js"), "utf8");
const html = fs.readFileSync(path.join(APP, "public/admin.html"), "utf8");
const css = fs.readFileSync(path.join(APP, "public/css/admin.css"), "utf8");

// `function 이름(` 부터 짝이 맞는 닫는 중괄호까지 떼어낸다. 문자열 안의
// 중괄호까지 세지는 않지만, 여기서 보는 함수들에는 그런 것이 없다.
function fnSource(src, name) {
  const head = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(src);
  if (!head) return null;
  let i = src.indexOf("{", head.index);
  let depth = 0;
  for (let end = i; end < src.length; end++) {
    if (src[end] === "{") depth++;
    else if (src[end] === "}") {
      depth--;
      if (depth === 0) return src.slice(head.index, end + 1);
    }
  }
  return null;
}

// ── 1. 미리보기가 팝업을 안 쓴다 ─────────────────────────────────────
{
  const preview = fnSource(admin, "previewKitchenTicket");
  check("previewKitchenTicket 이 있다", !!preview);
  check(
    "★ 미리보기가 window.open 을 안 쓴다",
    preview && !/window\.open/.test(preview),
    "앱의 onCreateWindow 가 막는 바로 그것이다 — 쓰면 앱에서 또 죽는다"
  );
  check(
    "★ 미리보기에 조용히 끝나는 분기가 없다",
    preview && !/if\s*\(!win\)\s*return\s*;/.test(preview),
    "`if (!win) return;` 이 사장님이 겪은 「눌러도 아무 일이 안 일어남」이었다"
  );

  const open = fnSource(admin, "openTicketPreview");
  check("openTicketPreview 로 갈라놨다", !!open);
  check(
    "iframe 에 담는다",
    open && /srcdoc/.test(open),
    "빌지는 제 글꼴을 가진 완결된 문서라 페이지에 그대로 심으면 스타일이 섞인다"
  );

  const close = fnSource(admin, "closeTicketPreview");
  check("closeTicketPreview 가 있다", !!close);
  check(
    "닫을 때 내용을 비운다",
    close && /srcdoc\s*=\s*""/.test(close),
    "안 비우면 다음에 열 때 앞 주문의 빌지가 잠깐 비친다"
  );
  check("닫기 버튼이 연결돼 있다", /#ticketPreviewClose"\)\.onclick\s*=\s*closeTicketPreview/.test(admin));
}

// ── 2. 떼어내서 진짜 돌려본다 ────────────────────────────────────────
//
// 「window.open 을 안 쓴다」만으로는 부족하다. 안 쓰면서 아무것도 안 할
// 수도 있다. 실제로 불러서 **화면에 뜨는 값이 바뀌는지** 본다.
{
  const frame = { srcdoc: "not-set" };
  const backdrop = { hidden: true, onclick: null };
  const nodes = {
    "#ticketPreviewFrame": frame,
    "#ticketPreviewBackdrop": backdrop,
    "#ticketPreviewClose": { onclick: null },
  };
  const sandbox = {
    $: (sel) => nodes[sel] || null,
    // 앱 안을 흉내낸다: window.open 은 존재하지만 언제나 null 을 준다.
    // 미리보기가 이걸 부르면 그 자리에서 잡는다.
    windowOpenCalls: 0,
    buildDualTicketHtml: () => "<html><body>빌지</body></html>",
    ticketFontSizes: {},
  };
  const src = [
    fnSource(admin, "previewKitchenTicket"),
    fnSource(admin, "openTicketPreview"),
    fnSource(admin, "closeTicketPreview"),
  ].join("\n");
  let ran = false;
  let threw = "";
  try {
    const run = new Function(
      "$", "buildDualTicketHtml", "ticketFontSizes", "window",
      `${src}\n return { previewKitchenTicket, closeTicketPreview };`
    );
    const api = run(
      sandbox.$,
      sandbox.buildDualTicketHtml,
      sandbox.ticketFontSizes,
      { open: () => { sandbox.windowOpenCalls++; return null; } }
    );
    api.previewKitchenTicket({ id: "A1" });
    ran = true;

    check("★ 눌렀을 때 창이 열린다", backdrop.hidden === false, `hidden=${backdrop.hidden}`);
    check("★ 빌지 내용이 실제로 들어간다", /빌지/.test(frame.srcdoc), frame.srcdoc);
    check(
      "★ window.open 을 한 번도 안 불렀다",
      sandbox.windowOpenCalls === 0,
      `${sandbox.windowOpenCalls}번 불렀다 — 앱에서는 이게 null 이라 죽는다`
    );

    api.closeTicketPreview();
    check("닫으면 창이 사라진다", backdrop.hidden === true);
    check("닫으면 내용이 비워진다", frame.srcdoc === "");
  } catch (e) {
    threw = String(e && e.message);
  }
  check("떼어내서 돌릴 수 있다", ran, threw);
}

// ── 3. 마크업과 문구 ─────────────────────────────────────────────────
{
  check("모달이 admin.html 에 있다", /id="ticketPreviewBackdrop"[^>]*class="modal-backdrop"/.test(html));
  check("처음엔 숨어 있다", /id="ticketPreviewBackdrop"[^>]*hidden/.test(html));
  check("iframe 이 있다", /<iframe id="ticketPreviewFrame"/.test(html));
  check("닫기(✕)가 있다", /id="ticketPreviewClose"/.test(html));

  // admin.js 는 이 배선을 **최상위에서** 한다(DOMContentLoaded 가 없다).
  // 마크업이 script 태그보다 아래에 있으면 $() 가 null 을 집어서 닫기가
  // 영영 안 걸린다 — 열리는데 못 닫는 창이 된다.
  const markupAt = html.indexOf('id="ticketPreviewBackdrop"');
  const scriptAt = html.indexOf('src="/js/admin.js"');
  check(
    "★ 마크업이 admin.js 보다 위에 있다",
    markupAt > 0 && scriptAt > 0 && markupAt < scriptAt,
    `마크업 ${markupAt}, script ${scriptAt}`
  );

  for (const key of ["ticketPreviewTitle", "ticketPreviewHint", "moveSlipFailedTitle", "moveSlipFailedTail"]) {
    const hits = admin.split(`${key}:`).length - 1;
    check(`${key} 가 두 언어에 다 있다`, hits === 2, `${hits}군데`);
  }

  check("미리보기 창 CSS 가 있다", /\.modal\.ticket-preview-modal/.test(css));
  check(
    "높이를 dvh 로도 적는다",
    /#ticketPreviewFrame[\s\S]{0,220}height:\s*\d+dvh/.test(css),
    "태블릿 주소창이 접히면 vh 가 실제 화면보다 커져 ✕ 가 밖으로 나간다"
  );
}

// ── 4. 자리 이동 빌지는 조용히 실패하지 않는다 ───────────────────────
{
  const move = fnSource(admin, "printMoveSlip");
  check("printMoveSlip 이 있다", !!move);
  check(
    "★ 더 이상 맨 boolean 을 돌려주지 않는다",
    move && !/\breturn\s+(true|false)\s*;/.test(move),
    "true/false 로는 「꺼둬서 안 나옴」과 「못 나옴」을 구별할 수 없다"
  );
  check(
    "★ window.open 이 막힌 자리가 이유를 남긴다",
    move && /if\s*\(!win\)\s*return\s*\{\s*ok:\s*false,\s*reason:\s*moveSlipFailReason\(\)/.test(move),
    "앱 안에서는 **언제나** 여기로 떨어진다"
  );
  check(
    "사장님이 꺼둔 경우만 말없이 넘어간다",
    move && /enabled\s*===\s*false\)\s*return\s*\{\s*ok:\s*false,\s*reason:\s*null\s*\}/.test(move),
    "이것만 조용해야 한다"
  );

  const reason = fnSource(admin, "moveSlipFailReason");
  check("moveSlipFailReason 이 따로 있다", !!reason);
  check(
    "★ 자동 인쇄 스위치를 이유로 대지 않는다",
    reason && !/autoPrintOn/.test(reason),
    "자리 이동 빌지는 사람이 자리를 옮겨서 나가는 것이라 그 스위치와 무관하다 — 틀린 이유를 대게 된다"
  );

  // 부르는 쪽이 그 값을 실제로 쓰는가. 예전에는 돌려줘도 아무도 안 봤다.
  check(
    "★ 자리 이동이 결과를 받아 화면에 띄운다",
    /const slip = await printMoveSlip\(buildMoveSlipInfo\(/.test(admin) &&
      /slip && !slip\.ok && slip\.reason \? fmtMoveSlipFailed\(slip\.reason\)/.test(admin),
    "받아만 두고 안 쓰면 고친 것이 아니다"
  );
  check(
    "시험 인쇄도 실패를 알린다",
    /slip = await printMoveSlip\(sampleMoveSlipInfo\(\)\)/.test(admin) &&
      /if \(slip && !slip\.ok && slip\.reason\) await showAlert\(/.test(admin),
    "종이를 보려고 누르는 버튼이다"
  );
  check(
    "실패 문구가 지금 무엇을 해야 하는지 말한다",
    /moveSlipFailedTail: "주방에는 옛 자리 번호가/.test(admin),
    "실패 사실만으로는 부족하다 — 주방은 옛 번호를 들고 있다"
  );
}

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
