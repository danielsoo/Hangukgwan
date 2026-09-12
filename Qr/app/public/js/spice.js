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
// 맵기를 두고 묻는 질문이 둘이라 함수도 둘이다.
//
//   isBasic          — 이 칸이 **기본 자리**인가 (목록 맨 앞, 처음 골라지는 값)
//   isSilentOnTicket — 이 값이 **빌지에 안 적어도 되는** 것인가
//
// 두 답이 다를 수 있다. 「基本(中辣)」는 기본 자리이면서, 빌지에는 적힌다 —
// 사장님이 적으라고 써 넣은 글자이기 때문이다.
//
// 쓰는 곳이 세 군데다 — 손님 화면(목록과 기본 선택), 관리자 화면의 빌지
// 미리보기, 실제 인쇄(escpos.js). 셋이 서로 다르게 판단하면 화면에는 안
// 매운 것으로 보이는데 주방에는 매운 것으로 나가는 어긋남이 생긴다.
// 그래서 파일 하나에 두고 세 화면이 같이 쓴다.
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

  // 빌지에 안 적어도 되는 값.
  //
  // 사장님(2026-09-12): "맵기 옵션에 있던 기본을 버리고 基本(中辣) 이거를
  // 추가했으니까 基本(中辣) 이게 뜨는 게 맞지."
  //
  // 맞다. 안 적던 것은 **딱 「基本」 한 가지**다 — 「평소대로」라는 뜻이라
  // 주방에 새로 알려줄 말이 없기 때문이다. 사장님이 그 칸을 지우고
  // 「基本(中辣)」를 넣었다면, 그건 적으라고 넣은 글자다. 사장님이 써 둔
  // 것은 그대로 종이에 나간다.
  //
  // 그래서 isBasic 과 일부러 다르다. isBasic 은 「이 칸이 기본 자리인가」
  // (목록 맨 앞·처음 골라지는 값)를 묻는 것이고, 이쪽은 「주방에 적을
  // 말이 있는가」를 묻는다. 두 질문의 답이 다를 수 있다.
  function isSilentOnTicket(value) {
    return String(value == null ? "" : value).trim() === BASIC;
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

  window.HG_SPICE = { BASIC: BASIC, isBasic: isBasic, isSilentOnTicket: isSilentOnTicket, optionsOf: optionsOf, defaultOf: defaultOf };
})();
