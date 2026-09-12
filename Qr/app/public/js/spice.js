// 맵기 「기본」이 무엇인지 — 한 곳에서만 정한다.
//
// 사장님(2026-09-12): "기본을 지우고 기본(중라)로 고쳤거든. 일부러 그렇게
// 고쳤는데 기본이 앞에 또 나왔어."
//
// 손님 화면은 맵기 목록에 「基本」이 없으면 맨 앞에 끼워 넣는다. 안 그러면
// 첫 칸이 小辣 가 되어, 아무것도 안 고른 손님에게 매운 것이 나가기 때문이다
// (2026-09-10 에 실제로 그랬다). 그런데 그 검사가 **글자가 똑같은지**를
// 봤다. 사장님이 「基本」을 「基本(中辣)」로 고치자 「똑같지 않다」가 되어
// 基本 을 또 끼워 넣었고, 목록에 기본이 두 줄이 됐다.
//
// 고친 규칙: **「基本」으로 시작하면 그게 기본 칸이다.** 사장님이 괄호를
// 붙여 무엇이 기본인지 설명해 두는 것은 이름을 바꾼 것이 아니라 같은 칸에
// 설명을 더한 것이다.
//
// 이 규칙이 필요한 곳이 세 군데다 — 손님 화면(목록과 기본 선택),
// 관리자 화면의 빌지 미리보기, 그리고 실제 인쇄(escpos.js). 셋이 서로
// 다르게 판단하면 화면에는 안 매운 것으로 보이는데 주방에는 매운 것으로
// 나가는 식의 어긋남이 생긴다. 그래서 파일 하나에 두고 세 화면이 같이 쓴다.
(function () {
  var BASIC = "基本";

  // 「基本」이거나 「基本(中辣)」처럼 基本 으로 시작하는 칸.
  function isBasic(value) {
    return String(value == null ? "" : value).trim().indexOf(BASIC) === 0;
  }

  // 화면에 늘어놓을 맵기 목록. 기본 칸이 없으면 맨 앞에 만들어 넣는다.
  function optionsOf(spiceOptions) {
    var parts = String(spiceOptions || "")
      .split(",")
      .map(function (x) { return x.trim(); })
      .filter(Boolean);
    if (!parts.length) return [];
    return parts.some(isBasic) ? parts : [BASIC].concat(parts);
  }

  // 아무것도 안 고른 손님에게 나갈 값. 사장님이 고쳐 둔 이름 그대로
  // 돌려준다 — 「基本(中辣)」로 골라두고 「基本」으로 저장하면, 주문에는
  // 사장님이 지운 이름이 남는다.
  function defaultOf(spiceOptions) {
    var list = optionsOf(spiceOptions);
    if (!list.length) return null;
    for (var i = 0; i < list.length; i++) {
      if (isBasic(list[i])) return list[i];
    }
    return list[0];
  }

  window.HG_SPICE = { BASIC: BASIC, isBasic: isBasic, optionsOf: optionsOf, defaultOf: defaultOf };
})();
