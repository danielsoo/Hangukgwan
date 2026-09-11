(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // Korean taegeuk (태극) mark — uses the exact reference image supplied
  // (public/images/taegeuk.png), not a hand-drawn SVG, since a hand-drawn
  // version kept coming out at a slightly wrong rotation angle.
  const TAEGEUK_ICON_INLINE = '<img src="/images/taegeuk.png" alt="" style="width:1em;height:1em;vertical-align:-0.12em;margin-right:3px;" />';
  let categories = [];
  let orders = [];
  let tables = [];
  let zones = [];
  let editingItemId = null;
  let editingItemPhotoUrl = null;
  let selectedPhotoFile = null;
  // Both toggles used to be plain in-memory booleans that silently reset
  // to their unchecked-in-HTML defaults (soundOn: on, autoPrintOn: off)
  // every time this page reloads — including the tablet's Chrome
  // reclaiming a backgrounded tab, a network hiccup forcing a reload, or
  // staff clearing the browser cache after a JS update (see the 1-hour
  // static-asset cache comment on express.static in server.js). That
  // silently turned "신규 주문 자동 인쇄" back off with no visual cue beyond
  // the checkbox itself, which nobody thinks to re-check after a routine
  // reload — 2026-09-06 field report: "자동 인쇄는 여전히 안돼. 수동으로
  // 자꾸 눌러야 돼" right after doing exactly that kind of reload. Persisting
  // both to localStorage (scoped to this browser/device, which is exactly
  // right — it's a per-tablet preference, not something to sync from the
  // server) makes the setting survive reloads the same way a real toggle
  // should.
  function readStoredToggle(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v === "1";
    } catch (e) {
      return fallback;
    }
  }
  function writeStoredToggle(key, value) {
    try {
      localStorage.setItem(key, value ? "1" : "0");
    } catch (e) {
      /* ignore (private browsing / storage disabled) */
    }
  }
  let soundOn = readStoredToggle("hg_admin_soundOn", true);
  let autoPrintOn = readStoredToggle("hg_admin_autoPrintOn", false);

  // ── 이 기기가 이미 처리한 주문 ──────────────────────────────────────
  //
  // 2026-09-10 사장님(장사 중): "지금까지 4건 주문됐거든. 3건은 주문시
  // 2장씩. 9번테이블 1건은 아예 안나왔어 ㅋㅋ 강제 인쇄했지." — 화면에는
  // 떴는데 빌지만 안 나왔고, 인쇄 실패 표시도 없었다.
  //
  // 원인은 「새 주문」의 뜻이었다. 예전 코드는 화면을 켠 뒤 목록이 바뀐
  // 것만 새 주문으로 봤고(메모리에만 있는 목록), 페이지를 켠 첫 번째
  // 응답은 통째로 건너뛰었다(isFirstLoad) — 이미 밀린 주문을 몰아 찍지
  // 않으려던 것이다. 그런데 그 두 가지가 겹치면 주문 하나가 조용히 샌다:
  // 손님이 주문한 그 순간 태블릿이 새로고침 중이었으면(배포, 앱 재시작,
  // 네트워크가 끊겼다 붙는 것 — 전부 장사 중에 실제로 일어난다) 그
  // 주문은 「켤 때 이미 있던 주문」으로 분류돼 영영 안 찍힌다. 화면에는
  // 멀쩡히 떠 있으니 아무도 모른다. 정확히 9번 테이블에서 일어난 일이다.
  //
  // 그래서 「새로 온 주문」이 아니라 「이 기기가 아직 판단하지 않은 주문」
  // 으로 기준을 바꾼다. 판단한 주문 번호를 기기에 남겨두면, 새로고침을
  // 몇 번 하든 그 기억이 남아서 빠지는 주문이 없다.
  //
  // 「판단했다」는 「찍었다」가 아니다. 자동 인쇄가 꺼져 있어서 안 찍은
  // 것도 판단이다 — 안 그러면 나중에 자동 인쇄를 켜는 순간 그동안 쌓인
  // 신규 주문이 한꺼번에 쏟아진다.
  // 알림 빌지(자리 이동 · 품목 추가·취소)를 이미 뽑았는지 기억한다.
  //
  // 주문 원장(DECIDED_KEY)과 따로 두는 이유: 한 주문이 여러 번 옮겨지고
  // 여러 번 고쳐질 수 있다. 주문 번호 하나로는 「어느 변경까지 찍었는가」를
  // 담을 수 없어서, 키에 그 변경이 일어난 시각을 붙인다.
  const NOTICE_KEY = "hg_admin_printedNotices";
  const NOTICE_KEEP = 300;
  let noticeStorageOk = true;
  function readNoticeKeys() {
    try {
      const raw = localStorage.getItem(NOTICE_KEY);
      if (raw === null) return null; // 이 기기에서 처음
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr.filter((v) => typeof v === "string") : []);
    } catch (e) {
      noticeStorageOk = false;
      return null;
    }
  }
  function writeNoticeKeys() {
    if (!noticeStorageOk) return;
    try {
      const arr = [...printedNoticeKeys].slice(-NOTICE_KEEP);
      printedNoticeKeys = new Set(arr);
      localStorage.setItem(NOTICE_KEY, JSON.stringify(arr));
    } catch (e) {
      noticeStorageOk = false;
    }
  }
  let printedNoticeKeys = readNoticeKeys();

  const DECIDED_KEY = "hg_admin_decidedOrderIds";
  const DECIDED_KEEP = 300; // 주문 번호는 계속 커진다 — 최근 것만 들고 있으면 된다
  let decidedStorageOk = true;
  function readDecidedIds() {
    try {
      const raw = localStorage.getItem(DECIDED_KEY);
      if (raw === null) return null; // 이 기기에서 처음 켠 것
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr.filter((n) => typeof n === "number") : []);
    } catch (e) {
      // 저장이 막혀 있는 기기(시크릿 모드 등). 예전처럼 메모리로만 돈다 —
      // 새로고침 때마다 잊어버리지만, 안 찍히는 것보다는 낫다.
      decidedStorageOk = false;
      return null;
    }
  }
  function writeDecidedIds() {
    if (!decidedStorageOk) return;
    try {
      const arr = [...decidedOrderIds].sort((a, b) => a - b).slice(-DECIDED_KEEP);
      decidedOrderIds = new Set(arr);
      localStorage.setItem(DECIDED_KEY, JSON.stringify(arr));
    } catch (e) {
      decidedStorageOk = false;
    }
  }
  let decidedOrderIds = readDecidedIds();
  let storeSettings = {};
  let pollTimer = null;
  // 실시간 주문 알림(Pusher) 연결 상태 — startPolling()이 폴링 주기를
  // 정할 때 이 값을 본다. Pusher 설정이 안 된 매장에서는 계속 false로
  // 남아서 기존 2초 폴링 그대로 동작한다.
  let realtimeEnabled = false;
  // 인원수·테이블·메뉴를 가끔 다시 불러오는 안전망 타이머 (startPolling 참고)
  let dataTimer = null;
  let pusherClient = null;

  // 자기가 일으킨 변경을 자기가 다시 받아오지 않게 한다.
  //
  // 버튼 한 번에 이 기기가 요청을 세 번 보내고 있었다 — PATCH 하나, 그
  // 뒤의 loadOrders() 하나, 그리고 서버가 쏜 Pusher "changed" 를 자기도
  // 받아서 loadOrders() 를 또 하나. 마지막 것은 방금 가져온 것과 똑같은
  // 목록을 다시 받는 순수한 낭비다.
  //
  // /api 로 나가는 모든 요청에 이 브라우저의 Pusher 소켓 번호를 붙이면,
  // 서버가 그 소켓만 빼고 알림을 쏜다(src/realtime.js). 다른 기기들은
  // 지금까지와 똑같이 받는다.
  //
  // fetch 호출부가 서른 곳 가까이라 한 곳씩 고치는 대신 여기서 감싼다.
  // Pusher 가 아직 연결되기 전이거나 미설정 매장이면 소켓 번호가 없고,
  // 그때는 손대지 않은 fetch 가 그대로 나간다(= 예전 동작).
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    let sid = null;
    try {
      sid = pusherClient && pusherClient.connection && pusherClient.connection.socket_id;
    } catch (e) {
      sid = null;
    }
    if (!sid) return nativeFetch(input, init);
    const url = typeof input === "string" ? input : (input && input.url) || "";
    // 같은 출처의 /api 요청만. Pusher 자신의 통신이나 외부 주소는 건드리지
    // 않는다.
    if (!url.startsWith("/api/")) return nativeFetch(input, init);
    try {
      const opts = Object.assign({}, init);
      const headers = new Headers((init && init.headers) || (typeof input === "object" && input && input.headers) || undefined);
      headers.set("X-Socket-Id", sid);
      opts.headers = headers;
      return nativeFetch(input, opts);
    } catch (e) {
      // 헤더를 못 붙이는 상황이 있더라도 요청 자체는 나가야 한다.
      return nativeFetch(input, init);
    }
  };
  let openTableNumber = null;
  // 포장 카운터는 서로 무관한 손님 주문이 여러 건 동시에 쌓일 수 있어서,
  // 결제탭에서 그 중 특정 주문 하나를 눌러 들어갔을 때는 그 주문 하나로만
  // 화면을 좁혀야 한다 (item 22 후속: 결제탭 포장 타일 여러 개로 분리).
  // openTableLabel/openFocusOrderId는 4초 폴링(loadOrders)이나 언어 전환이
  // 이 모달을 다시 그릴 때도 지금 보고 있던 좁혀진 화면 그대로 유지하기
  // 위한 기억 용도 — openTableDetail() 호출마다 최신 값으로 갱신된다.
  let openTableLabel = null;
  let openFocusOrderId = null;
  // Orders whose most recent auto-print attempt is known to have failed
  // (see printKitchenTicket() / markPrintFailed() below) — surfaced as a
  // banner plus a badge on the order's card, since a printer that silently
  // fails is otherwise indistinguishable from "no new order came in" to
  // kitchen staff who only glance at the paper ticket.
  let printFailedOrderIds = new Set();
  // 합산 결제 (pay several tables together, for one group split across
  // tables) — see renderTables()/updateMergePayBar() and the
  // #mergePayModeBtn handler below. Holds table *numbers* (strings), since
  // that's what activeOrdersForTable() keys on.
  let mergePayMode = false;
  let mergePaySelected = new Set();
  // 사장님 피드백(2026-09-07): "지금 엑스로 바로 테이블을 삭제할 수 있는데
  // 편집 기능을 만들어서 그거 눌러야 삭제 되게 해줘. 그냥은 못하게" — 목록
  // 보기에서 ✕ 버튼이 항상 떠 있어서 실수로 테이블을 지우기 쉬웠다.
  // "편집" 버튼(#tableEditModeBtn)을 눌러 편집 모드를 켜야만 ✕ 버튼이
  // 나타나고 눌리게 하고, 평소(꺼짐)에는 카드를 눌러도 그냥 상세 화면만
  // 열리게 한다 — 위 mergePayMode와 같은 토글 패턴.
  let tableEditMode = false;
  // Order cards/blocks with more than this many item lines render collapsed
  // (see renderCollapsibleItemLines() below) so a table's big order doesn't
  // force the whole 신규/조리중 column into a long scroll — most cards end
  // up roughly the same height, with a 펼치기/접기 toggle for the rest.
  // Expansion state is kept here (by order id) rather than as a per-render
  // local, since renderOrders()/openTableDetail() rebuild this markup from
  // scratch on every 4-second poll and a click's "expanded" choice needs to
  // survive that.
  const ORDER_ITEMS_COLLAPSE_THRESHOLD = 4;
  let expandedOrderIds = new Set();
  // Drag-to-reorder state for the order queue columns (see renderOrderCard()
  // and the .col-body drag handlers below) — which order id is currently
  // being dragged, and which column body it started in, so a drop is only
  // honored as a same-column reorder and never as a sneaky status change.
  let draggingOrderId = null;
  let dragSourceColumnBody = null;
  // 테이블 상세 modal: which sub-view is showing — 진행중 (still-open orders)
  // or 완료 내역 (already-paid ones for this table). Kept separate so a
  // brand-new order placed right after a previous round was paid off shows
  // up cleanly in 진행중 instead of getting visually mixed in with the
  // just-settled one in the same scrolling list. Reset to "active" every
  // time a (possibly different) table is opened.
  let tableDetailView = "active";
  // 포장 카운터처럼 서로 무관한 손님 주문이 여러 건 한 화면에 뜰 때, 사장님
  // 피드백(2026-09-05): "이 엑스하는 창 같은 걸 따로따로 다 만들어달라는
  // 거였어... 그러면 완전 다른 거라고 인식하기 편하고" — 카드 하나하나를
  // 그 자체로 닫을 수 있는 독립된 창처럼 보이게 해달라는 요청. 각 주문
  // 카드마다 자기만의 ✕ 버튼을 달아서, 누르면 그 주문의 결제 상태와는
  // 무관하게 이 화면에서만 그 카드를 잠깐 치워둘 수 있게 한다(다른 카드에
  // 영향 없음, 모달을 다시 열면 초기화됨 — 아래 openTableDetail의
  // tableDetailView 리셋과 같은 조건에서 함께 리셋).
  let dismissedOrderIds = new Set();
  // 사장님 피드백(2026-09-05): "外帶 에 있는 거 제외하고 다른 테이블
  // 전체들은 부분 결제를 허용해줘. 체크체크 해서 그것만 결제완료 할 수
  // 있게. 나눠서 계산할 수도 있고 그래서 그래" → 곧이어 "선택이 주문별이
  // 아니라 메뉴별이야" — 진짜 테이블(카운터 제외)에서 미결제 품목 중
  // 일부만 체크해서 선택한 품목만 결제 완료 처리할 수 있게 한다(예: 한
  // 라운드의 일부 메뉴만, 혹은 여러 라운드에 걸쳐 몇 개씩만). 체크된
  // 품목을 "주문id:품목인덱스" 문자열 키로 담는 Set —
  // dismissedOrderIds와 같은 조건(테이블/포커스 전환)에서 함께 리셋된다.
  // buildOrderRoundParts/collectSelectedItemsByOrder(아래)가 직접
  // 참조한다.
  let selectedPayItemKeys = new Set();
  // 사장님 피드백(2026-09-06): "vip 카드를 소지중이면 세일을 해주거든...
  // 特約 95折(5% 할인)/VIP 9折(10% 할인) 중 하나만 적용, 현금만" — 결제
  // 시점에 직원이 물리적 카드를 보고 눌러주는 할인(주문 시 자동 적용되는
  // Firebase 회원 시스템의 할인과는 완전히 별개). 명확화 답변에 따라
  // 진짜 테이블은 "테이블 전체 단위"로 딱 하나만 고르므로(결제도 테이블
  // 전체가 한 곳 — 아래 footerPayBtn — 에서만 이뤄진다) 테이블당 값 하나면
  // 충분하고, 포장 카운터는 라운드(주문)마다 결제가 서로 무관하므로 주문
  // id별로 따로 관리한다. 둘 다 테이블/포커스 전환 시 함께 리셋된다
  // (dismissedOrderIds/selectedPayItemKeys와 동일 조건).
  let tableVipDiscountType = null; // "te95" | "vip9" | null
  let counterVipDiscountTypeByOrderId = new Map();
  // 사장님 요청(2026-09-07): "vip 할인 옆에 결제자 재량으로 특정 금액/퍼센트
  // 할인 (직접 입력)이 가능하도록 넣어줘" — 特約95折/VIP9折와 나란히 놓이는
  // 세 번째 버튼. 定率표가 없으므로 실제 값(금액인지 퍼센트인지 + 그 수치)을
  // 따로 들고 있어야 해서 별도 상태로 둔다 — 위 두 값과 마찬가지로 테이블은
  // 전체 단위 하나, 포장 카운터는 주문id별로.
  //
  // 사장님 요청(2026-09-10): "vip 할인 2개랑 직접 치는 걸 중복으로 할 수
  // 있게 해줘... vip 할인을 했더니 2원의 잔돈이 있어서 재량으로 2원을
  // 깎아주려고" — 예전에는 이 값이 있으면 위 tableVipDiscountType이
  // "manual"이 되면서 特約95折/VIP9折가 밀려났다(한 칸을 셋이서 나눠 씀).
  // 이제 완전히 독립이다: 特約95折/VIP9折 중 하나 + 재량 할인을 동시에
  // 걸 수 있고, VIP 할인을 먼저 적용한 뒤 남은 금액에서 재량 할인을 뺀다
  // (계산 순서는 src/routes/orders.js의 computeDiscountAmount가 최종 결정).
  let tableManualDiscountValue = null; // { mode: "amount" | "percent", value: number } | null
  let counterManualDiscountValueByOrderId = new Map();

  // 남이 입력한 글자를 innerHTML 안에 넣기 전에 반드시 통과시킨다.
  //
  // 이 대시보드는 지금까지 거의 전부 사장님·직원이 직접 입력한 값만
  // 보여줬지만, 홈페이지 회원가입이 생기면서 처음으로 "모르는 사람이
  // 정한 문자열"(계정 이름·이메일)이 관리자 화면에 그려지게 됐다.
  // 그대로 innerHTML에 넣으면 손님이 이름을 <img onerror=...> 같은 걸로
  // 지어두는 것만으로 사장님 관리자 세션에서 스크립트가 실행된다.
  /**
   * 자리를 화면에 어떻게 부를 것인가.
   *
   * 2026-09-10 사장님: "테이블 0은 대체 뭐야. 포장으로 해야지."
   *
   * 「外帶」라는 이름이 붙은 0번 테이블이 포장 카운터 행세를 하고 있었다.
   * 목록에도, 수기 주문 고르는 창에도, QR 인쇄물에도 `라벨 있으면 라벨,
   * 없으면 번호` 로만 적어서 **번호 0 이 어디에도 안 보였다.** 그래서
   * 카운터 카드와 겉보기가 똑같았고, 포장 손님이 몇 달을 그 자리로
   * 들어왔는데 아무도 못 알아챘다.
   *
   * 라벨을 붙였으면 번호를 같이 보여준다. 포장 카운터만 예외다 — 그건
   * 자리가 아니라 번호를 가진 적이 없다(src/routes/tables.js 의
   * getOrCreateCounterTable).
   */
  function tableDisplayName(t) {
    if (!t || !t.label) return (t && t.number) || "";
    if (t.is_counter) return t.label;
    return `${t.label} ${t.number}`;
  }
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ---------- In-app confirm/alert ----------
  // Replaces every native window.confirm()/alert() on this page. A
  // browser-native popup freezes the whole tab behind an OS-styled box that
  // looks nothing like the rest of the admin UI; these do the same
  // yes/no-or-acknowledge job with a modal styled like every other dialog
  // here. Both are Promise-based so call sites just `await` them.
  function showConfirm(message) {
    return new Promise((resolve) => {
      $("#appDialogMessage").textContent = message;
      $("#appDialogCancel").hidden = false;
      $("#appDialogBackdrop").hidden = false;
      const finish = (result) => {
        $("#appDialogBackdrop").hidden = true;
        $("#appDialogOk").onclick = null;
        $("#appDialogCancel").onclick = null;
        resolve(result);
      };
      $("#appDialogOk").onclick = () => finish(true);
      $("#appDialogCancel").onclick = () => finish(false);
    });
  }
  function showAlert(message) {
    return new Promise((resolve) => {
      $("#appDialogMessage").textContent = message;
      $("#appDialogCancel").hidden = true;
      $("#appDialogBackdrop").hidden = false;
      $("#appDialogOk").onclick = () => {
        $("#appDialogBackdrop").hidden = true;
        $("#appDialogOk").onclick = null;
        resolve();
      };
    });
  }

  // 사장님 요청(2026-09-06): "결제완료할 때 결제 종류로는 현금, LinePay,
  // 신용카드로 할 수 있게 해줘. 그래서 vip 할인 적용 누르면 현금을
  // 제외하고는 회색으로 불 꺼진 것 처럼 만들고 버튼도 안 누르게 해줘." —
  // "결제 완료" 클릭 한 번으로 뜨는 팝업. discountActive가 true면
  // LinePay/신용카드 버튼을 disabled + 흐리게 처리해서 현금만 고를 수
  // 있게 한다. summaryText는 팝업 위에 보여줄 한 줄 안내(합계/할인/실수령
  // 액, 아래 fmtPaymentSummary 참고) — 이 팝업이 곧 확인 단계를 겸하므로
  // showConfirm을 따로 거치지 않는다. 취소를 누르면 null을 돌려준다.
  function showPaymentMethodPopup(summaryText, discountActive) {
    return new Promise((resolve) => {
      const backdrop = $("#paymentMethodBackdrop");
      $("#paymentMethodSummary").textContent = summaryText || "";
      const hint = $("#paymentMethodHint");
      hint.hidden = !discountActive;
      hint.textContent = discountActive ? T("paymentMethodCashOnlyHint") : "";
      const btns = $("#paymentMethodBtns").querySelectorAll("[data-payment-method]");
      const finish = (result) => {
        backdrop.hidden = true;
        btns.forEach((b) => (b.onclick = null));
        $("#paymentMethodCancel").onclick = null;
        resolve(result);
      };
      btns.forEach((btn) => {
        const method = btn.dataset.paymentMethod;
        const locked = discountActive && method !== "cash";
        btn.disabled = locked;
        btn.style.opacity = locked ? "0.4" : "1";
        btn.style.cursor = locked ? "not-allowed" : "pointer";
        btn.onclick = locked ? null : () => finish(method);
      });
      $("#paymentMethodCancel").onclick = () => finish(null);
      backdrop.hidden = false;
    });
  }

  // ---------- Admin-panel-wide font size (this browser only) ----------
  // A personal display preference, not a shared setting — stored in this
  // browser's localStorage (never sent to the server), so adjusting it can
  // never affect anyone else's screen or another device. Separate from the
  // kitchen-ticket font sizes further down, which ARE shared/server-side —
  // a printed ticket is a real document everyone who prints it needs to
  // see rendered the same way, unlike this screen-only preference.
  const UI_FONT_SCALE_KEY = "hangukgwan_admin_ui_font_scale";
  const UI_FONT_SCALE_MIN = 0.8;
  // 사장님 피드백 (2026-09-05): "전체 웹사이트가 글씨랑 그런 게 작다고 지적이
  // 왔어... 최대 110까지 밖에 안된다고 더 늘려달래" — 기존 상한(1.6 = 160%)으로도
  // 부족하다는 뜻이라 큰 폭으로 상향. 화면 전용(로컬 저장) 개인 설정이라 다른
  // 사람 화면에는 영향 없음.
  const UI_FONT_SCALE_MAX = 3;
  const UI_FONT_SCALE_STEP = 0.1;

  function getUiFontScale() {
    let v = parseFloat(localStorage.getItem(UI_FONT_SCALE_KEY));
    if (!Number.isFinite(v)) v = 1;
    return Math.min(UI_FONT_SCALE_MAX, Math.max(UI_FONT_SCALE_MIN, v));
  }
  // 저장 버튼이 있는 카드에서 「아직 저장 안 했다」를 말해준다.
  //
  // 사장님(2026-09-11): "누르는 즉시 저장되는 카드 — 이것도 그냥 저장 누르게
  // 만들어줘." 눌러야 저장되게 바꾸면 **안 누르고 나가서 잃을 수 있다.**
  // 즉시 저장은 그 위험이 없던 대신 저장한 티가 안 났다. 둘 다 챙기려면,
  // 아직 안 눌렀다는 것이 그 자리에 보여야 한다.
  function markSettingDirty(btnId, dirty) {
    const el = $(`#${btnId}Dirty`);
    if (el) el.hidden = !dirty;
    const btn = $(`#${btnId}`);
    if (btn) btn.classList.toggle("is-dirty", !!dirty);
  }
  function flashSettingSaved(msgId, btnId) {
    if (btnId) markSettingDirty(btnId, false);
    const msg = $(`#${msgId}`);
    if (!msg) return;
    msg.hidden = false;
    setTimeout(() => (msg.hidden = true), 2000);
  }

  function applyUiFontScale(v) {
    document.body.style.zoom = v;
    const label = $("#uiFontScaleValue");
    if (label) label.textContent = Math.round(v * 100) + "%";
  }
  // 고른 크기는 바로 화면에 보여주되, **저장은 버튼을 눌러야** 한다.
  // 크기는 눈으로 보고 고르는 것이라 미리보기를 없애면 고를 수가 없다.
  let uiFontScaleDraft = getUiFontScale();
  function previewUiFontScale(v) {
    v = Math.round(v * 10) / 10;
    v = Math.min(UI_FONT_SCALE_MAX, Math.max(UI_FONT_SCALE_MIN, v));
    uiFontScaleDraft = v;
    applyUiFontScale(v);
    markSettingDirty("saveUiFontScaleBtn", v !== getUiFontScale());
  }
  applyUiFontScale(getUiFontScale());
  if ($("#uiFontScaleDecBtn")) {
    $("#uiFontScaleDecBtn").onclick = () => previewUiFontScale(uiFontScaleDraft - UI_FONT_SCALE_STEP);
    $("#uiFontScaleIncBtn").onclick = () => previewUiFontScale(uiFontScaleDraft + UI_FONT_SCALE_STEP);
    $("#uiFontScaleResetBtn").onclick = () => previewUiFontScale(1);
  }
  if ($("#saveUiFontScaleBtn")) {
    $("#saveUiFontScaleBtn").onclick = () => {
      try {
        localStorage.setItem(UI_FONT_SCALE_KEY, String(uiFontScaleDraft));
      } catch (e) {
        // 사생활 보호 모드 등으로 저장이 막혀도 이번 화면에는 그대로 적용돼
        // 있다 — 다음에 열 때만 잊힌다.
      }
      flashSettingSaved("uiFontScaleMsg", "saveUiFontScaleBtn");
    };
  }

  // ---------- Role / permissions ----------
  // "owner" (사장) always has every permission; "staff" (직원) only has
  // whatever the owner has switched on below. Populated from /api/auth/me
  // after login — the server enforces the same boundaries independently
  // (see requirePermission in src/auth.js), this is just for the UI.
  let currentRole = "owner";
  let staffPermissions = { menuEdit: true, tableEdit: true, settingsEdit: true, orderCancel: true, orderEdit: true, reservationManage: true };
  const canMenuEdit = () => currentRole === "owner" || staffPermissions.menuEdit;
  const canTableEdit = () => currentRole === "owner" || staffPermissions.tableEdit;
  const canSettingsEdit = () => currentRole === "owner" || staffPermissions.settingsEdit;
  const canCancelOrder = () => currentRole === "owner" || staffPermissions.orderCancel;
  const canEditOrder = () => currentRole === "owner" || staffPermissions.orderEdit;
  const canManageReservations = () => currentRole === "owner" || staffPermissions.reservationManage;

  // ---------- Admin UI language (Korean / Traditional Chinese) ----------
  // Unlike the customer order page (which always resets to Chinese on a
  // fresh scan), this is a staff tool — whichever language a staff member
  // picks should stick around the next time they open it, so it's saved
  // in localStorage instead of resetting.
  let adminLang = localStorage.getItem("hgk_admin_lang") || "ko";

  const ADMIN_I18N = {
    ko: {
      appDialogOk: "확인",
      appDialogCancel: "취소",
      pageTitle: "한국관 관리자 페이지",
      loginTitle: "관리자 로그인",
      loginSubtitle: "직원·사장 전용 화면입니다",
      loginBackHome: "← 홈으로",
      loginPasswordPlaceholder: "관리자 비밀번호",
      loginBtn: "로그인",
      loginError: "비밀번호가 올바르지 않습니다. 다시 시도해주세요",
      loginErrorAutofill: "브라우저가 저장해둔 비밀번호가 채워져 있었습니다. 칸을 비웠으니 직접 입력해주세요",
      brand: `${TAEGEUK_ICON_INLINE} 한국관 관리자`,
      tabOrders: "실시간 주문",
      tabPayment: "결제",
      tabMenu: "메뉴 관리",
      tabTables: "테이블 / QR 코드",
      tabSettings: "설정",
      settleAmBtn: "🌅 오전 정산",
      settlePmBtn: "🌙 오후 정산",
      logoutBtn: "로그아웃",
      soundToggleLabel: "🔔 신규 주문 알림음",
      autoPrintToggleLabel: "🖨️ 신규 주문 자동 인쇄",
      // 인쇄를 맡은 기기 — 2026-09-10 사장님: "하나에 고정으로 되거나
      // 다른 곳에서 못 키게 막아줘."
      printDeviceHere: "🖨️ 이 기기에서 인쇄합니다",
      printDeviceElsewhere: "🖨️ 지금은 {name}에서 인쇄해요",
      printDeviceUnknown: "다른 기기",
      printDeviceTakeoverConfirm: "지금은 {name}에서 빌지를 뽑고 있어요.\n인쇄를 이 기기로 옮길까요?\n(옮기면 그쪽 자동 인쇄는 꺼집니다)",
      printDeviceKindPos: "주방 POS 앱",
      printDeviceKindTablet: "태블릿",
      printDeviceKindPhone: "폰",
      printDeviceKindPc: "PC",
      toggleSavedMsg: "✔ 저장됨",
      refreshBtn: "새로고침",
      refreshingBtn: "⏳ 새로고침 중...",
      refreshedBtn: "✅ 완료",
      refreshFailedBtn: "⚠️ 실패",
      statusNew: "신규 주문",
      statusPreparing: "조리 중",
      statusServed: "서빙 완료",
      statusPaid: "결제 완료",
      statusCancelled: "취소됨",
      nextNew: "조리 시작",
      nextPreparing: "서빙 완료로 변경",
      nextServed: "결제 완료로 변경",
      cancelBtn: "취소",
      orderEditBtn: "✏️ 수정",
      printBtn: "🖨️ 인쇄",
      previewBtn: "👁️ 미리보기",
      confirmCancelOrder: "이 주문을 취소하시겠습니까?",
      collapseItemsBtn: "접기 ▲",
      dragHandleTitle: "드래그해서 순서/단계 변경",
      orderStatusChangeFailed: "상태 변경에 실패했습니다. 다시 시도해 주세요.",
      tableDetailTabActive: "현재 주문",
      tableDetailTabPaid: "이전 주문",
      tableDetailNoPaidHistory: "아직 결제 완료된 주문이 없습니다.",
      allOrderCardsDismissed: "모든 주문 카드를 치웠습니다.",
      restoreDismissedBtn: "다시 보기",
      dismissOrderCardBtn: "이 카드 치우기",
      orderEditModalTitle: "주문 수정",
      orderEditAddBtn: "+ 추가",
      orderEditAddHint: "동판불고기처럼 섞어 담는 메뉴는 여기서 새로 추가할 수 없어요 — 새 메뉴로 추가하려면 수기 주문을 이용해주세요.",
      orderEditCancel: "취소",
      orderEditSave: "저장",
      orderEditSaved: "수정 내용이 저장되었습니다.",
      orderEditEmptyError: "주문에는 최소 1개 이상의 항목이 있어야 합니다.",
      orderEditNotEditable: "결제되었거나 취소된 주문은 수정할 수 없습니다.",
      tableLabel: "테이블",
      orderCardTakeoutBadge: "포장",
      orderCardDeliveryBadge: "배달",
      orderCardMixedBadge: "혼합",
      printFailedCardMsg: "⚠️ 인쇄 실패 — 주방에 전달됐는지 확인, 아래 인쇄 버튼으로 재시도",
      orderCardLocUnverified: "📍 위치 미확인",
      settlementAmTitle: "🌅 오전",
      settlementPmTitle: "🌙 오후",
      settlementTotalBadge: "합산",
      settlementHalfOrders: "결제",
      settlementHalfOrdersUnit: "건",
      settlementAmUntil: "{t} 까지",
      settlementPmFrom: "{t} 부터",
      settlementHalvesGap: "⚠ 오전 정산을 누르지 않은 날이 {n}일 있어 그 날의 매출 {amt} 은 오전·오후 어느 쪽에도 들어가지 않았습니다. 위의 합산에는 들어 있습니다.",
      settlementHalvesNone: "오전·오후를 가를 수 없는 기간이에요 ({amt}). 주문에 장사 구분이 찍히기 전이거나, 영업시간이 한 타임뿐인 날입니다. 위의 합산은 정확합니다.",
      settlementShiftHint: "눌러서 이 시간대만 보기",
      settlementShiftHintActive: "눌러서 합산으로 돌아가기",
      settlementViewingAm: "🌅 오전만",
      settlementViewingPm: "🌙 오후만",
      settlementViewAll: "합산 보기",
      settlementShiftNote: "아래 내용이 전부 이 시간대의 것입니다.",
      settlementChartUnavailable: "그래프를 그리지 못했어요 (chart 파일을 못 불러왔습니다). 숫자는 위쪽 표와 아래 목록에 그대로 있습니다.",
      settingsSoldOutReleaseTitle: "품절 자동 해제 시각",
      settingsSoldOutReleaseHint: "「9/10까지 품절」처럼 끝 날짜를 정해두면, 그 다음 날 이 시각에 자동으로 다시 팔립니다. 비워두면 영업 시작 시각을 씁니다. 자정(00:00)으로 두면 날짜가 바뀌는 순간 풀립니다 — 밤늦게까지 장사하는 날에는 주방에 없는 메뉴가 주문될 수 있으니 조심하세요.",
      labelSoldOutReleaseTime: "해제 시각 (비우면 영업 시작)",
      settingsUnsaved: "● 저장 안 된 변경이 있어요 — 아래 「설정 저장」을 눌러주세요",
      resetToDefaultBtn: "기본값",
      clearBtn: "비우기",
      logoPicked: "고른 파일: {name} — 「설정 저장」을 눌러야 올라갑니다",
      logoNonePicked: "올릴 파일을 먼저 골라주세요",
      soldOutReleaseFollowsHours: "지금은 영업 시작 시각({t})을 따릅니다.",
      soldOutReleaseFixed: "매일 {t}에 풀립니다.",
      soldOutReleasesAt: "{d} {t} 풀림",
      labelLocationCheckEnabled: "위치 확인 사용",
      locationOffHint: "꺼져 있습니다. 손님 폰에 위치를 묻지 않고, 어디서 주문하든 접수됩니다.",
      printFailReasonApp: "앱이 프린터에 연결하지 못했어요",
      printFailReasonOff: "자동 인쇄가 꺼져 있어요",
      printFailReasonElsewhere: "이 기기는 인쇄 담당이 아니에요",
      printFailReasonNoPrinter: "프린터를 찾지 못했어요",
      takeoutCounterShort: "포장",
      memoLabel: "메모",
      orderMemoLabel: "주문 메모",
      totalLabel: "합계",
      subtotalLabel: "소계",
      addItemBtn: "+ 메뉴 추가",
      codeTh: "코드",
      nameTh: "이름",
      priceTh: "가격",
      statusTh: "상태",
      orderTh: "순서",
      moveItemUpTitle: "위로 이동",
      moveItemDownTitle: "아래로 이동",
      photoMissing: "사진<br>없음",
      photoMissingTitle: "사진을 추가해주세요",
      labelServiceStart: "영업 시작 시각 (이 시각 전 주문은 테스트로 보고 결산·주문 목록에서 제외돼요)",
      serviceStartHint: "비워두면 예전처럼 전부 다시 보여요. 지워지는 건 없어요.",
      storageWarnTitle: "데이터 저장 공간이 %s / 16MB 까지 찼어요.",
      storageWarnSub: "아직 여유는 있지만, 개발자에게 \"store 문서 분리\"를 이야기해 두세요. 한도에 닿으면 주문 저장이 안 됩니다.",
      storageUrgentTitle: "데이터 저장 공간이 %s / 16MB 입니다. 곧 한도예요.",
      storageUrgentSub: "미루지 마시고 개발자에게 \"store 문서 분리\"를 요청하세요. 한도에 닿으면 주문이 저장되지 않습니다.",
      storageCheckedAt: "매일 마감 정산 때 확인해요. 마지막 확인: %s",
      settlementGuests: "손님 수",
      settlementAvgPerGuest: "1인당 평균",
      settlementAvgPerOrder: "주문당 평균",
      settlementDiscountTotal: "할인해준 금액",
      settlementGrossRevenuePrefix: "할인 전",
      settlementShare: "비중",
      settlementOrderTypeTitle: "매장 / 포장",
      settlementOrderTypeName: "구분",
      settlementOrderTypeDineIn: "매장",
      settlementOrderTypeTakeout: "포장",
      settlementOrderTypeMixed: "섞임",
      settlementCategoryTitle: "분류별 매출",
      settlementCategoryName: "분류",
      settlementCategoryNone: "분류 없음",
      settlementDiscountTitle: "할인 내역",
      settlementDiscountHint: "매출에서 이미 빠진 금액이에요. 얼마를 깎아드렸는지 보여줍니다.",
      settlementDiscountKind: "종류",
      settlementDiscountAmount: "할인액",
      settlementVipCardTitle: "VIP 카드 손익",
      settlementVipCardSales: "카드 판매",
      settlementVipCardDiscount: "카드 할인",
      settlementVipCardNet: "차액",
      settlementVipCardNote: "오늘 판 카드값과 오늘 나간 카드 할인입니다. 같은 카드가 아니고 카드는 1년을 쓰니, 진짜 손익은 기간을 넓혀서 보세요.",
      settlementDiscountManual: "직접 입력",
      settlementTableTitle: "테이블별 매출",
      settlementTableName: "테이블",
      settlementMoneyInTitle: "💰 돈이 어떻게 들어왔나",
      settlementSoldTitle: "🍚 무엇이 팔렸나",
      settlementWhenWhereTitle: "⏰ 언제, 어디서",
      settlementReconcileOk: "✓ 결제수단 총합이 위 매출과 정확히 일치해요. 이 숫자로 서랍을 맞추시면 됩니다.",
      settlementNoData: "이 기간에는 기록이 없어요.",
      settlementCountSuffix: "건",
      settlementQtySuffix: "개",
      settlementItemsExpand: "전체 보기",
      settlementItemsCollapse: "접기",
      settlementOrdersTitle: "📋 지난 주문 불러오기",
      settlementOrdersSearchPlaceholder: "메뉴 이름, 손님 이름, 픽업 번호로 찾기",
      settlementOrdersTablePlaceholder: "테이블 번호",
      settlementOrdersAllStatus: "전체 상태",
      settlementOrdersSearchBtn: "찾기",
      settlementOrdersLoading: "불러오는 중…",
      settlementOrdersFailed: "주문을 불러오지 못했어요. 다시 시도해주세요.",
      settlementOrdersNone: "이 조건에 맞는 주문이 없어요.",
      settlementOrdersTruncated: " (가장 최근 것부터 보여드려요. 더 보시려면 날짜를 좁혀주세요)",
      settlementOrdersPickupSuffix: "번",
      settlementOrdersPaidWith: "결제:",
      settlementOrdersPaidAt: "결제 시각:",
      settlementOrdersStatus: "상태:",
      onSale: "판매 중",
      soldOut: "품절",
      soldOutToday: "오늘만 품절",
      soldOutRange: "기간 품절",
      soldOutAlways: "계속 품절",
      soldOutTitle: "품절 설정",
      itemSoldOutLabel: "품절",
      soldOutModeOnSale: "판매 중",
      soldOutModeToday: "오늘만 품절 (내일 영업 시작에 자동으로 풀려요)",
      soldOutModeRange: "기간 지정",
      soldOutModeAlways: "계속 품절 (직접 풀 때까지)",
      soldOutFromLabel: "시작일 (비우면 오늘부터)",
      soldOutUntilLabel: "종료일 (비우면 직접 풀 때까지)",
      soldOutRangeInvalid: "종료일이 시작일보다 빠릅니다.",
      soldOutRangeEmpty: "시작일이나 종료일 중 하나는 넣어주세요.",
      soldOutSaveFailed: "품절 설정을 저장하지 못했습니다. 다시 시도해주세요.",
      itemModalAddTitle: "메뉴 추가",
      itemModalEditTitle: "메뉴 수정",
      alertMenuNameRequired: "메뉴 이름을 입력하세요",
      confirmDeleteItem: "이 메뉴를 삭제하시겠습니까? 되돌릴 수 없습니다.",
      newTableNumberPlaceholder: "테이블 번호 (예: 12)",
      newTableLabelPlaceholder: "표시 이름 (선택사항)",
      addTableBtn: "+ 테이블 추가",
      printQrBtn: "🖨️ 전체 QR 코드 인쇄",
      viewListBtn: "📋 목록 보기",
      viewFloorBtn: "🗺️ 배치도 보기",
      addZoneBtn: "+ 구역 추가",
      saveFloorPlanBtn: "💾 배치도 저장",
      floorPlanSavedMsg: "배치도가 저장되었습니다",
      floorPlanHint: "구역과 테이블을 드래그해서 움직이고, 오른쪽 아래 모서리를 드래그해서 크기를 조절하세요. 구역 이름을 클릭하면 수정할 수 있어요. 자리를 옮긴 뒤에는 \"배치도 저장\"을 눌러서 저장됐는지 확인하세요.",
      paymentFloorHint: "좌석을 터치하면 바로 결제 화면이 열립니다. 배치는 \"테이블 / QR 코드\" 탭의 배치도 보기에서 조정할 수 있어요.",
      alertTableNumberRequired: "테이블 번호를 입력하세요",
      alertUnluckyNumber: "숫자 '4'가 들어간 테이블 번호는 사용할 수 없습니다 (대만에서 불길한 숫자로 여겨져 제외됩니다).",
      alertTableExists: "이미 존재하는 테이블 번호입니다",
      alertFloorPlanSaveFailed: "배치 저장에 실패했어요. 방금 옮긴 자리가 원래대로 되돌아갑니다 — 다시 시도해주세요.",
      tableEmptyBadge: "비어있음",
      counterSectionTitle: "📦 포장 카운터 QR",
      counterSectionHint: "테이블이 아닌, 카운터 포장 전용 주문 QR 코드예요. 손님이 자리 없이 바로 포장 주문할 수 있어요.",
      counterCreateBtn: "포장 카운터 QR 만들기",
      counterQrBtn: "🖨️ 포장 QR 코드 보기/인쇄",
      tableDelTitle: "삭제",
      tableDelUnpaidMsg: "이 자리에 아직 결제되지 않은 주문이 있어요. 결제를 마친 뒤에 지울 수 있어요.",
      tableDelSeatedMsg: "이 자리에 손님이 앉아 계신 걸로 되어 있어요. 「손님 나감」으로 먼저 비운 뒤에 지울 수 있어요.",
      tableDelCounterMsg: "포장 카운터는 지울 수 없어요. 포장 주문이 들어오는 길목이라 지우면 포장 QR이 전부 멈춰요.",
      tableDelFailedMsg: "자리를 지우지 못했어요. 잠시 후 다시 시도해주세요.",
      noOrdersYetAdmin: "아직 주문이 없습니다.",
      unpaidTotalLabel: "현재 미결제 합계:",
      clearPartySizeBtn: "👥 손님 나감 (인원수 비우기)",
      moveTableBtn: "🔀 자리 이동",
      moveSlipTitle: "자리 이동 빌지",
      moveSlipHint: "손님 자리를 옮기면 한 장 나오는 종이예요. 주방과 홀에는 이미 옛 번호가 찍힌 주문서가 나가 있어서, 화면에서만 바뀌면 종이를 들고 다니는 사람은 그 사실을 몰라요. 붙여두거나 옛 주문서 위에 얹어두는 용도라 「5 → 8」 한 줄이 제일 크게 나갑니다.",
      moveSlipEnableLabel: "자리 이동 빌지 인쇄",
      moveSlipShowOrdersLabel: "옮긴 주문 목록 넣기",
      moveSlipTestBtn: "🖨️ 테스트 인쇄",
      moveSlipSampleItemA: "돌솥비빔밥",
      moveSlipSampleItemB: "김치찌개",
      msStoreName: "상호명 (헤더)",
      msTitle: "제목 (자리 이동)",
      msTables: "자리 번호 (5 → 8)",
      msInfo: "시각 · 인원",
      msOrders: "옮긴 주문 목록",
      msFooter: "하단 안내 (새 자리 QR)",
      moveTableModalTitle: "자리 이동 — 옮길 자리 선택",
      moveTableOccupied: "손님 있음",
      moveTableNoTargets: "옮길 수 있는 자리가 없습니다",
      moveTableFailed: "자리 이동에 실패했습니다. 다시 시도해주세요",
      clearPartySizeConfirm: "이 테이블의 등록된 인원수를 비울까요? 다음 손님에게 인원수를 다시 물어봅니다.",
      clearPartySizeDone: "인원수를 비웠습니다.",
      clearPartySizeFailed: "인원수를 비우지 못했습니다. 다시 시도해주세요.",
      unpaidTotalLabel2: "미결제 합계:",
      paySelectedBtn: "결제 완료",
      paySelectedFailedMsg: "일부 품목은 결제 완료 처리에 실패했어요. 화면을 새로고침해서 다시 확인해주세요.",
      itemPaidBadge: "결제완료",
      selectRoundAllLabel: "이 주문 전체 선택",
      selectAllItemsLabel: "전체 선택",
      paymentMethodModalTitle: "결제 방식 선택",
      paymentMethodCash: "현금",
      paymentMethodLinepay: "LinePay",
      paymentMethodCard: "신용카드",
      paymentMethodOther: "기타",
      paymentMethodCashOnlyHint: "선택한 할인은 현금 결제에만 적용돼요.",
      manualDiscountModalTitle: "직접 할인 입력",
      manualDiscountModalHint: "할인 방식을 고르고 값을 입력하세요.",
      manualDiscountModeAmount: "금액 (NT$)",
      manualDiscountModePercent: "퍼센트 (%)",
      manualDiscountErrorMsg: "숫자를 다시 확인해주세요 (퍼센트는 100 이하로 입력)",
      manualDiscountClearBtn: "할인 해제",
      tableEditModeBtn: "✏️ 편집",
      tableEditModeHint: "편집 모드예요. 테이블 카드의 ✕를 누르면 삭제할 수 있어요. 다시 \"편집\"을 누르면 꺼집니다.",
      mergePayModeBtn: "🧾 합산 결제",
      mergePayHint: "합산 결제할 테이블을 모두 선택하세요 (미결제 테이블만 선택 가능).",
      mergePayCancelBtn: "취소",
      mergePayConfirmBtn: "합산 결제 완료",
      manualOrderBtn: "📝 수기 주문",
      manualOrderModalTitle: "수기 주문 — 테이블 선택",
      manualOrderHint: "테이블을 선택하면 손님 주문 화면이 새 탭에서 열려요. 거기서 그대로 메뉴를 담아 주문을 넣으면 평소처럼 신규 주문에 뜨고 빌지도 나갑니다.",
      zoneAddBtnTitle: "테이블 추가",
      zoneAddBtnLabel: "+ 테이블",
      zoneDelTitle: "구역 삭제",
      tableUnassignTitle: "구역에서 빼기",
      promptZoneName: "구역 이름",
      addTableToZoneModalTitle: "테이블 추가",
      addTableToZoneHint: "추가할 테이블을 모두 선택하세요 (여러 개 선택 가능).",
      addTableToZoneEmpty: "배치할 수 있는 테이블이 없습니다.<br/>위에서 새 테이블을 먼저 추가해주세요.",
      addTableToZoneCancel: "취소",
      addTableToZoneConfirm: "확인",
      settingsCatDisplay: "화면 · 소리",
      settingsCatDisplaySub: "글자 크기 · 알림음",
      settingsCatStore: "매장 정보",
      settingsCatStoreSub: "사진 · 로고 · 공지 · 상호/주소",
      settingsCatOrder: "주문 규칙",
      settingsCatOrderSub: "주문 시간 · 품절 해제 · 위치 제한",
      settingsCatAccount: "계정",
      settingsCatAccountSub: "비밀번호 · 직원 권한",
      settingsCatNotify: "알림",
      settingsCatNotifySub: "마감 LINE 알림",
      settingsCatPayment: "결제",
      settingsCatPaymentSub: "온라인 결제 (ECPay)",
      settingsCatVipSub: "구글 로그인 설정",
      settingsCatPrint: "인쇄",
      settingsCatPrintSub: "주방 프린터 · 빌지 글자",
      settingsSearchPlaceholder: "설정 찾기 — 프린터, 비밀번호, 영업시간 …",
      settingsSearchEmpty: "찾는 설정이 없습니다",
      orderHoursUnavailable: "이 화면을 아직 못 불러왔습니다",
      orderHoursUnavailableSub: "서버를 다시 띄운 뒤 새로고침해주세요",
      livePreviewLabel: "미리보기 (손님 화면)",
      tabSettlement: "결산",
      settlementStartLabel: "시작일",
      settlementEndLabel: "종료일",
      settlementTodayBtn: "오늘",
      settlementWeekBtn: "최근 7일",
      settlementMonthBtn: "최근 30일",
      settlementCsvBtn: "⬇️ CSV 다운로드",
      settlementCloseBtn: "📌 이 날짜 정산 기록 저장",
      settlementCloseRangeHint: "하루를 선택했을 때만 저장할 수 있어요 (시작일 = 종료일).",
      settlementTodayOnlyNote: "오늘 하루만 보여요",
      settlementSavedMsg: "✔ 저장됨",
      settlementRevenue: "매출 (결제 완료)",
      settlementPaidCount: "결제 완료 주문",
      settlementProblemCount: "⚠️ 미결제/문제 주문",
      settlementCancelledCount: "취소된 주문",
      settlementProblemTitle: "⚠️ 결제되지 않은 주문",
      settlementProblemHint: "아래 주문들은 선택한 기간 기준 아직 결제 완료 처리가 안 되어 있어요. 언제 주문했고 무엇을 시켰는지 확인해서 놓친 결제가 있는지 확인해주세요.",
      settlementItemsTitle: "품목별 판매 현황",
      settlementItemName: "메뉴",
      settlementItemQty: "수량",
      settlementItemSubtotal: "소계",
      settlementPaymentMethodTitle: "결제수단별 집계",
      settlementPaymentMethodName: "결제수단",
      settlementPaymentMethodCount: "건수",
      settlementPaymentMethodRevenue: "매출",
      settlementPaymentMethodTotalLabel: "총합",
      paymentMethodOnline: "온라인결제",
      paymentMethodUnspecified: "미지정",
      settlementTrendTitle: "매출 추이 (선택한 기간)",
      settlementTurnover: "평균 테이블 회전 시간",
      settlementTurnoverMinutes: "분",
      settlementTurnoverNoData: "–",
      settlementHourlyTitle: "시간대별 방문 & 인기 메뉴",
      settlementHourlyHint: "막대에 마우스를 올리면 그 시간대에 잘 팔린 메뉴를 볼 수 있어요.",
      settlementHourlyOrders: "주문 수",
      settlementHourlyTopItems: "인기 메뉴",
      settlementHistoryTitle: "지난 정산 기록 추이",
      settlementHistoryHint: "매일 마감 시간 이후 자동으로 저장되는 기록입니다 (수동 저장도 가능). 왼쪽에서 날짜를 골라 들어가 보세요.",
      settlementHistoryEmpty: "아직 저장된 정산 기록이 없습니다.",
      settlementHistoryProblem: "미결제",
      settingsCoverTitle: "손님 화면 상단 사진",
      settingsCoverHint: "주문 페이지 맨 위에 표시되는 매장 대표 사진입니다.",
      seasonalTaegeukLabel: "헤더 로고 계절 설정",
      seasonOptAuto: "자동 (오늘 날짜 기준)",
      seasonOptSpring: "봄 (벚꽃)",
      seasonOptSummer: "여름 (파라솔)",
      seasonOptAutumn: "가을 (낙엽)",
      seasonOptWinter: "겨울 (눈)",
      seasonOptOff: "끄기 (기본 태극 무늬)",
      saveSeasonBtn: "계절 설정 저장",
      settingsLogoTitle: "매장 로고 (QR 코드 중앙에 표시)",
      settingsLogoHint: "정사각형에 가까운 이미지를 권장합니다. 인쇄용 QR 코드 정중앙에 작게 들어갑니다.",
      settingsNoticeTitle: "공지 배너",
      settingsNoticeHint: "손님 주문 페이지 상단에 표시할 안내 문구입니다 (비워두면 표시되지 않습니다).",
      noticeLabel: "공지 문구",
      saveNoticeBtn: "공지 저장",
      noticePreviewEmpty: "공지 문구를 입력하면 여기에 표시됩니다.",
      settingsInfoTitle: "매장 정보",
      labelNameZh: "상호명 (중국어)",
      labelNameKo: "상호명 (한국어)",
      labelPhone: "전화번호",
      labelAddressZh: "주소 (중국어)",
      labelAddressKo: "주소 (한국어, 선택사항)",
      addressKoPlaceholder: "비워두면 중국어 주소로 표시됩니다",
      labelHours: "영업시간",
      labelMinSpend: "1인당 최소 주문 금액 (NT$)",
      saveSettingsBtn: "설정 저장",
      savedMsg: "저장되었습니다",
      settingsOrderHoursTitle: "주문 받는 시간",
      settingsOrderHoursHint: "이 시간 밖에서는 손님이 QR 코드로 주문할 수 없습니다. 메뉴는 그대로 보이고 주문 버튼만 잠깁니다. 직원·사장님은 로그인한 상태면 언제든 주문할 수 있습니다 — 전화 주문이나 마감 후 정리 주문을 대신 넣을 수 있어요.",
      orderHoursEnabledLabel: "영업시간 밖 주문 막기",
      orderHoursAddRange: "+ 시간대 추가",
      orderHoursRemoveRange: "삭제",
      orderHoursBaseLabel: "기본 시간 (요일별로 따로 정하지 않은 날)",
      orderHoursByDayLabel: "요일별",
      orderHoursByDateLabel: "특정 날짜 (태풍 · 임시 휴무 등)",
      orderHoursDateDefault: "평소대로",
      orderHoursDateClosed: "이 날 휴무",
      orderHoursDateCustom: "이 날만 시간 지정",
      orderHoursMarkClosed: "휴",
      orderHoursMarkCustom: "시",
      orderHoursNoteLabel: "이유 (선택 · 적으면 손님에게도 보여요)",
      orderHoursNotePlaceholder: "예: 태풍 휴무",
      orderHoursNotePlaceholderHours: "예: 태풍으로 저녁만 영업",
      orderHoursDayDefault: "기본과 같음",
      orderHoursDayCustom: "직접 지정",
      orderHoursDayClosed: "휴무",
      orderHoursTodayLabel: "오늘",
      orderHoursTodayHoliday: "오늘은 휴무",
      orderHoursOff: "지금은 아무것도 막지 않습니다",
      orderHoursOffSub: "위 스위치를 켜면 영업시간 밖 주문이 막힙니다",
      orderHoursOpenNow: "지금 주문 받는 중",
      orderHoursClosedNow: "지금 주문 안 받는 중",
      orderHoursNextOpen: "다시 받는 시각",
      orderHoursToday: "오늘",
      orderHoursTomorrow: "내일",
      daySun: "일",
      dayMon: "월",
      dayTue: "화",
      dayWed: "수",
      dayThu: "목",
      dayFri: "금",
      daySat: "토",
      settingsLocationTitle: "위치 기반 주문 제한",
      settingsLocationHint: "매장 위치를 설정하면, 설정한 반경 밖에서는 주문이 접수되지 않습니다. QR 코드를 사진으로 찍어 다른 곳에서 사용하는 것을 막기 위한 기능입니다. <strong>매장 안에 계실 때</strong> 아래 버튼을 눌러주세요.",
      captureLocationBtn: "📍 지금 위치를 매장 위치로 저장",
      labelRadius: "허용 반경 (미터)",
      locationNotSet: "아직 매장 위치가 설정되지 않았습니다 (위치 제한 꺼짐)",
      locationNoBrowserSupport: "이 브라우저는 위치 정보를 지원하지 않습니다.",
      locationChecking: "위치 확인 중…",
      locationSaved: "매장 위치가 저장되었습니다.",
      locationFailed: "위치 확인 실패: 브라우저 위치 권한을 허용해주세요.",
      settingsPwTitle: "비밀번호 변경",
      ownerPwTitle: "사장 비밀번호 변경",
      labelPwCurrent: "현재 비밀번호",
      labelPwNew: "새 비밀번호 (6자 이상)",
      changePwBtn: "비밀번호 변경",
      pwChanged: "비밀번호가 변경되었습니다",
      pwChangeFailed: "변경 실패. 현재 비밀번호가 맞는지 확인하세요 (새 비밀번호는 6자 이상)",
      uploadFailed: "업로드 실패. 다시 시도해주세요",
      logoUpdated: "로고가 업데이트되었습니다",
      coverUpdated: "사진이 업데이트되었습니다",
      chipEntryPlaceholder: "입력하고 Enter",
      chipAddonNamePlaceholder: "이름 (예: 볶음밥 추가)",
      chipAddonPricePlaceholder: "가격",
      chipAddBtn: "추가",
      chipFreeAddon: "(무료)",
      itemOptionsSingleTitle: "하나만 고르는 옵션",
      itemOptionsSingleHint: "손님이 이 중에서 하나만 골라요. 가격은 안 바뀌어요.",
      itemOptionsMultiTitle: "여러 개 고를 수 있는 옵션",
      itemOptionsMultiHint: "손님이 원하는 만큼 골라요. 고른 만큼 가격이 올라가요. 값이 없으면 0을 넣으세요.",
      itemPaneBasic: "기본",
      itemPaneBasicSub: "분류 · 코드 · 이름",
      itemPanePrice: "가격",
      itemPanePriceSub: "가격 · 정가 · 최소 수량",
      itemPaneOptions: "옵션",
      itemPaneOptionsSub: "고기 · 맵기 · 추가",
      itemPaneDisplay: "손님 화면",
      itemPaneDisplaySub: "배지 · 알러지 · 사진",
      itemPaneSoldOut: "품절",
      itemPaneSoldOutSub: "판매 중 · 기간",
      itemCategoryLabel: "카테고리",
      itemCodeLabel: "코드 (선택사항)",
      itemNameZh: "이름 (중국어)",
      itemNameKo: "이름 (한국어)",
      itemDescZh: "설명 (중국어)",
      itemDescKo: "설명 (한국어)",
      itemPriceLabel: "가격 (NT$)",
      itemPriceNoteLabel: "가격 비고",
      itemPriceNotePlaceholder: "예: 2인분",
      itemOriginalPriceLabel: "정가 (할인 전 가격, 없으면 비워두세요)",
      itemOptionsLabel: "옵션 (예: 소고기, 돼지고기)",
      itemOptionsPlaceholder: "옵션이 없으면 비워두세요",
      itemSpiceOptionsLabel: "맵기 옵션 (예: 안 맵게, 보통, 맵게)",
      itemSpiceOptionsPlaceholder: "맵기 옵션이 없으면 비워두세요",
      itemTakeoutOptionsLabel: "포장 전용 옵션 (예: 不煮外帶, 煮熟外帶)",
      itemTakeoutOptionsPlaceholder: "포장 전용 옵션이 없으면 비워두세요",
      itemAddonsLabel: "추가 옵션",
      itemAddonsPlaceholder: "추가 옵션이 없으면 비워두세요",
      itemMinFirstOrderQtyLabel: "최초 주문 최소 수량 (없으면 비워두세요)",
      itemMixOptionsLabel: "옵션별 개별 수량(+/-) 허용",
      itemAllergensLabel: "알러지 / 육류 표시 (손님 화면에 표시돼요)",
      itemSpicyLabel: "매운맛 🌶",
      itemSignatureLabel: "대표 메뉴 ★",
      itemAvailableLabel: "판매 중",
      itemPhotoLabel: "사진",
      deleteItemBtn: "메뉴 삭제",
      saveBtn: "저장",
      staffPermTitle: "직원 권한 관리",
      staffPermHint: "직원 계정으로 로그인하면 아래에서 켠 항목만 추가/삭제/변경할 수 있어요. 주문 확인, 상태 변경(조리 시작/서빙/결제 완료), 인쇄는 항상 가능합니다.",
      permMenuEdit: "메뉴 추가/수정/삭제",
      permTableEdit: "테이블/배치도 추가·삭제·편집",
      permSettingsEdit: "매장 설정 변경",
      permOrderCancel: "주문 취소",
      permOrderEdit: "주문 내용 수정 (메뉴/수량/옵션)",
      permReservationManage: "예약 추가/수정/삭제",
      tabReservations: "예약",
      reservationDateFilterLabel: "날짜",
      reservationShowAllBtn: "전체 보기",
      addReservationBtn: "+ 예약 추가",
      reservationEmpty: "예약이 없습니다.",
      reservationNoTable: "테이블 미배정",
      reservationAddTitle: "예약 추가",
      reservationEditTitle: "예약 수정",
      reservationNameLabel: "예약자 이름",
      reservationPhoneLabel: "전화번호",
      reservationDateLabel: "날짜",
      reservationTimeLabel: "시간",
      reservationPartyLabel: "인원",
      reservationTableLabel: "테이블 (선택사항)",
      reservationTablePlaceholder: "비워두면 미배정",
      reservationNoteLabel: "메모",
      deleteReservationBtn: "예약 삭제",
      cancelReservationBtn: "예약 취소 처리",
      reservationDeleteConfirm: "이 예약을 삭제하시겠습니까?",
      lineSettingsTitle: "마감 자동 알림 (LINE)",
      lineSettingsHint: "직원이 「🌅 오전 정산」/「🌙 오후 정산」을 누를 때, 그 시점의 매출·결제수단별 금액·미결제를 아래 등록된 사람에게만 개별로 보내요 (친구 추가한 모두에게 보내는 게 아니에요). 하루에 두 통. 정산 버튼을 아무도 안 누른 날은 밤 마감 시각에 한 번 보내요.",
      lineEnableLabel: "마감 알림 사용",
      lineTokenLabel: "채널 액세스 토큰",
      lineTokenPlaceholder: "저장된 토큰이 있으면 비워두면 유지됩니다",
      saveLineSettingsBtn: "저장",
      testLineBtn: "📩 지금 테스트 메시지 보내기",
      lineTokenSetStatus: "✔ 토큰이 저장되어 있습니다",
      lineTokenNotSetStatus: "토큰이 아직 저장되지 않았습니다",
      lineRevealBtn: "보기",
      lineHideBtn: "숨기기",
      lineSecretLabel: "채널 시크릿 (Webhook 인증용)",
      lineSecretPlaceholder: "저장된 값이 있으면 비워두면 유지됩니다",
      lineSecretSetStatus: "✔ 채널 시크릿이 저장되어 있습니다",
      lineSecretNotSetStatus: "채널 시크릿이 아직 저장되지 않았습니다",
      linePendingHint: "누군가 이 공식계정을 친구 추가하면 여기 대기 목록에 이름/사진과 함께 나타나요. 본인이 맞는지 확인하고 승인해야 실제로 알림을 받기 시작해요.",
      linePendingTitle: "승인 대기 중",
      lineApprovedTitle: "알림 받는 사람",
      linePendingEmpty: "대기 중인 사람이 없습니다.",
      lineApprovedEmpty: "아직 등록된 사람이 없습니다.",
      lineApproveBtn: "승인",
      lineRejectBtn: "거절",
      lineRemoveBtn: "삭제",
      lineRemoveConfirm: "이 사람에게 더 이상 알림을 보내지 않을까요?",
      lineSavedMsg: "저장되었습니다",
      lineTestSending: "전송 중...",
      lineTestSuccess: "✔ 테스트 메시지를 보냈어요. LINE 앱을 확인해보세요.",
      lineTestFailed: "전송 실패 — 등록된 사람이 없거나 토큰을 확인해주세요.",
      paymentSettingsTitle: "온라인 결제 (ECPay)",
      paymentSettingsHint: "손님이 테이블 미결제 합계를 직접 신용카드/LINE Pay/JKOPay 등으로 결제할 수 있게 해요. 꺼두면 지금처럼 직원이 결제 완료를 눌러야 해요.",
      paymentEnableLabel: "온라인 결제 사용",
      paymentTestModeStatus: "⚠ 테스트 모드 — ECPay 정식 가맹점 정보가 아직 설정되지 않아 실제 결제는 되지 않습니다 (서버 환경변수에 ECPAY_MERCHANT_ID 등을 추가하면 실결제로 전환돼요).",
      paymentLiveModeStatus: "✔ 실결제 모드 — ECPay 정식 가맹점 정보로 연결되어 있습니다.",
      paymentSavedMsg: "저장되었습니다",
      tabVip: "회원(VIP)",
      tabAccounts: "계정",
      accountsTabHint:
        "홈페이지에서 가입한 계정 목록이에요. 손님으로 가입한 사람을 직원이나 사장으로 바꾸면, 그 사람이 홈페이지에 로그인했을 때 \"관리자 페이지\" 버튼이 생기고 관리자 화면에 들어올 수 있어요. 등급을 내리면 그 사람의 접근 권한도 바로 사라져요 — 다시 로그인할 때까지 기다릴 필요 없어요.",
      accountSearchPlaceholder: "이름 또는 이메일로 검색",
      accountsRefreshBtn: "새로고침",
      accountsLoading: "불러오는 중…",
      accountsLoadError: "계정 목록을 불러오지 못했어요.",
      accountsEmpty: "아직 홈페이지에서 가입한 계정이 없어요.",
      accountsNoMatch: "검색 결과가 없어요.",
      accountRoleCustomer: "손님",
      accountRoleStaff: "직원",
      accountRoleOwner: "사장",
      accountMethodPassword: "비밀번호",
      accountMethodGoogle: "구글",
      accountRoleConfirm: "{name} 님의 등급을 \"{role}\"(으)로 바꿀까요?",
      accountErrSelfDemote: "본인 계정은 스스로 내릴 수 없어요. 다른 사장 계정으로 바꿔주세요.",
      accountErrLastOwner: "마지막 사장 계정이라 내릴 수 없어요. 먼저 다른 사람을 사장으로 지정해 주세요.",
      accountErrGeneric: "등급을 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.",
      vipTabHint:
        "여기서는 이미 발급한 실물 VIP 카드의 번호를 등록해서 \"손님이 온라인에서 등록할 수 있는 상태\"로 만들어요. 카드 자체를 새로 발급하는 기능이 아니라, 발급된 카드번호를 시스템에 알려주는 화면이에요. 손님은 주문 페이지에서 구글로 로그인한 뒤 이 카드번호를 입력해서 본인 계정에 연결해요. 유효기간은 발급일로부터 1년입니다.",
      vipCardNumberPlaceholder: "카드번호 (예: V0001)",
      vipDiscountPlaceholder: "할인율 (%)",
      vipNotePlaceholder: "메모 (선택, 예: 홍길동에게 발급)",
      vipAddCardBtn: "+ 카드 등록",
      vipNoCards: "등록된 VIP 카드가 없습니다.",
      vipStatusActive: "✔ 등록됨 · 유효",
      vipStatusExpired: "등록됨 · 기간 만료",
      vipStatusUnclaimed: "미등록 (대기 중)",
      vipDiscountLabel: "할인율",
      vipIssueDateLabel: "발급일",
      vipExpiryDateLabel: "만료일",
      vipNoteLabelShort: "메모",
      vipEditBtn: "수정",
      vipUnlinkBtn: "등록 해제",
      vipDeleteBtn: "삭제",
      vipUnlinkConfirm: "이 카드의 온라인 등록을 해제할까요? 손님은 다시 카드번호로 등록해야 해요.",
      vipDeleteConfirm: "이 카드를 삭제하시겠습니까?",
      vipCannotDeleteClaimed: "이미 손님이 등록한 카드는 삭제할 수 없어요. 먼저 '등록 해제'를 눌러주세요.",
      vipAddInvalid: "카드번호, 발급일, 할인율(1~100)을 모두 올바르게 입력해주세요.",
      vipEditInvalid: "발급일과 할인율(1~100)을 올바르게 입력해주세요.",
      vipCardNumberTaken: "이미 등록된 카드번호입니다.",
      settingsCatVip: "회원(VIP)",
      vipSettingsTitle: "회원(VIP) 구글 로그인 설정 (Firebase)",
      vipSettingsHint:
        "손님이 주문 페이지에서 구글로 로그인해 VIP 카드를 등록하려면 Firebase 프로젝트가 필요해요. 1) Firebase 콘솔(console.firebase.google.com)에서 새 프로젝트를 만들고, 2) Authentication에서 \"Google\" 로그인 방법을 켜고, 3) 웹 앱을 추가한 뒤 나오는 firebaseConfig 코드를 통째로 복사해서 아래에 붙여넣으세요. 추가로 4) 프로젝트 설정 > 서비스 계정에서 \"새 비공개 키 생성\"으로 받은 JSON 파일 내용은 여기가 아니라 배포 서버(Vercel)의 환경변수 FIREBASE_SERVICE_ACCOUNT에 등록해야 해요 (보안 정보라 이 화면에는 넣지 않아요).",
      vipConfigLabel: "firebaseConfig (JSON)",
      vipConfigPlaceholder: '{"apiKey": "...", "authDomain": "...", "projectId": "...", ...}',
      vipConfigNotSet: "아직 설정되지 않았습니다 — 손님은 구글 로그인을 사용할 수 없어요.",
      vipConfigSet: "✔ 설정되어 있습니다.",
      vipConfigInvalid: "⚠ 형식이 올바르지 않아요 (apiKey, projectId가 포함된 JSON이어야 해요).",
      // VIP 카드 판매 — 사장님(2026-09-10): "vip카드 구매도 현금으로만
      // 구매가능. 버튼필요 - VIP卡販售 /300원."
      vipSaleTitle: "VIP 카드 판매 (VIP卡販售)",
      vipSaleHint:
        "결제 화면 맨 아래에 「VIP卡販售」 버튼이 생겨요. 직원이 그 버튼을 누르면 여기서 정한 금액이 현금 판매로 바로 기록됩니다. 카드번호는 그때 같이 넣어도 되고, 나중에 회원(VIP) 탭에서 넣어도 돼요.",
      vipSalePriceLabel: "카드 판매가 (NT$)",
      vipSaleDiscountLabel: "판매하면서 등록할 때 붙는 할인율 (%)",
      vipSaleDiscountHint: "카드마다 다르게 주고 싶으면, 등록된 뒤 회원(VIP) 탭에서 그 카드만 고치면 돼요.",
      vipSellBtn: "💳 VIP卡販售",
      vipSellPendingBtn: "💳 VIP 카드 빼기",
      vipSellPendingNote: "카드값은 현금으로 따로 받습니다",
      vipSellFailedAfterPay: "밥값 결제는 끝났는데 VIP 카드가 팔리지 않았어요.\n손님께 카드를 드리기 전에 VIP 탭에서 다시 판매해 주세요.",
      vipSellTitle: "VIP卡販售",
      vipSellCashOnly: "현금으로만 판매합니다.",
      vipSellCardNumberLabel: "카드번호 (선택 — 나중에 회원(VIP) 탭에서 넣어도 돼요)",
      vipSellConfirmBtn: "현금으로 판매",
      vipSellDone: "VIP 카드를 판매했어요 (현금)",
      vipSellDoneWithCard: "VIP 카드를 판매하고 카드번호도 등록했어요 (현금)",
      vipSellFailed: "판매를 기록하지 못했어요. 다시 시도해주세요.",
      vipCardSaleItemName: "VIP 카드 판매",
      settlementCategoryVipCard: "VIP 카드 판매",
      vipConfigInvalidJson: "JSON 형식이 올바르지 않아요. Firebase 콘솔에서 복사한 내용을 다시 확인해주세요.",
      vipSettingsSavedMsg: "저장되었습니다",
      escposSettingsTitle: "주방 프린터 직접 인쇄 (ESC/POS · QZ Tray)",
      escposSettingsHint:
        "켜두면 확인창 없이 영수증 프린터로 바로 인쇄돼요 (커팅 자동 포함). 이 컴퓨터에 <strong>QZ Tray</strong> 프로그램이 설치되어 실행 중이어야 하고, 프린터 이름은 QZ Tray가 인식한 이름 그대로 입력해야 해요. 꺼두거나 QZ Tray 연결이 안 되면 지금처럼 브라우저 인쇄(미리보기 인쇄)로 자동 전환돼요.",
      escposEnableLabel: "ESC/POS 자동 인쇄 사용",
      escposPrinterNameLabel: "프린터 이름 (QZ Tray 기준)",
      escposPrinterNamePlaceholder: "예: XINYE N160II",
      escposSavedMsg: "저장되었습니다",
      escposNoPrinterName: "먼저 프린터 이름을 입력해주세요",
      escposConnecting: "QZ Tray에 연결 중...",
      testEscposBtn: "🖨️ 테스트 인쇄",
      escposTestSuccess: "✔ 테스트 인쇄를 보냈어요. 프린터를 확인해보세요.",
      escposTestFailed: "✘ 인쇄 실패 — QZ Tray가 실행 중인지, 프린터 이름이 맞는지 확인해주세요.",
      rawbtSettingsTitle: "주방 프린터 직접 인쇄 (RawBT · 안드로이드 태블릿)",
      rawbtSettingsHint:
        "안드로이드 태블릿에서 관리자 페이지를 열어둘 때 쓰는 방식이에요. QZ Tray는 안드로이드에 설치할 수 없어서, 대신 태블릿에 <strong>RawBT</strong> 앱을 설치하고 프린터를 등록해두면 이 태블릿에서는 확인창 없이 바로 인쇄돼요. 프린터를 블루투스로 페어링했든, LAN 케이블로 연결해서 네트워크(IP)로 등록했든 상관없이 — 그 설정은 전부 RawBT 앱 안에서 하는 것이고, 여기서는 그냥 이 방식을 켜기만 하면 돼요. 켜져 있어도 QZ Tray 연결이 먼저 시도되고, 그게 실패해야만(즉 QZ Tray가 없는 안드로이드에서는 항상) 이 방식으로 자동 전환돼요.",
      rawbtEnableLabel: "RawBT 자동 인쇄 사용",
      rawbtSavedMsg: "저장되었습니다",
      testRawbtBtn: "🖨️ RawBT 테스트 인쇄",
      rawbtTestSent: "RawBT로 테스트 인쇄를 보냈어요. 확인창 없이 조용히 인쇄됐는지 프린터를 확인해보세요 (이 기기에 RawBT 앱이 설치·설정되어 있어야 해요).",
      rawbtTestFailed: "✘ RawBT로 보내는 데 실패했어요 — 이 기기에 RawBT 앱이 설치되어 있는지 확인해주세요.",
      alarmTitle: "🔔 주문 알림음",
      alarmHint: "새 주문이 들어올 때 나는 소리예요. 이 컴퓨터/태블릿에서만 적용되고 다른 사람 화면에는 영향이 없어요.",
      alarmStopBtn: "🔕 알림 끄기",
      alarmPreviewStopBtn: "■ 정지",
      alarmToneShortLabel: "짧은 알림음",
      alarmRepeatLabel: "짧은 알림음을 몇 번 울릴까요?",
      alarmRepeat1: "한 번",
      alarmRepeat2: "두 번",
      alarmRepeat3: "세 번",
      alarmRepeat5: "다섯 번",
      alarmToneLongLabel: "긴 벨소리",
      alarmToneLongHint: "긴 벨소리는 그 곡 자체가 3~4초라서 반복하지 않고 한 번만 울려요. 그래서 같은 소리가 여러 번 울리는 것처럼 들리지 않아요. 울리는 동안 「실시간 주문」 화면 위쪽의 「🔕 알림 끄기」로 바로 멈출 수 있어요.",
      alarmToneMusicbox: "오르골",
      alarmToneChimeLong: "차임벨",
      alarmToneMarimba: "마림바",
      alarmToneGayageum: "가야금",
      alarmToneDigital: "디지털",
      alarmToneSirenLong: "긴 사이렌",
      alarmToneBeep: "기본 삐",
      alarmToneDing: "딩동",
      alarmToneBell: "종소리",
      alarmToneChime: "차임 (도미솔)",
      alarmToneTriple: "세 번 울림",
      alarmToneAlarm: "자명종",
      alarmToneSiren: "사이렌",
      alarmToneArcade: "코인 (게임기)",
      alarmVolumeLabel: "음량",
      alarmVolNormalMark: "100% 기본",
      alarmVolMaxMark: "1000% 최대",
      alarmPreviewBtn: "▶ 미리듣기",
      alarmResetBtn: "기본값",
      alarmSavedMsg: "✔ 저장됨",
      alarmDeviceHint: "기기 자체 볼륨이 꺼져 있으면 여기서 아무리 올려도 소리가 안 나요. 태블릿/컴퓨터 볼륨도 함께 올려주세요.",
      alarmLoudWarn: "⚠️ 200%부터는 기기 스피커 한계를 넘어 증폭합니다. 소리가 거칠게 들릴 수 있어요.",
      uiFontScaleTitle: "화면 글자 크기",
      uiFontScaleHint: "이 관리자 화면 전체의 글자 크기를 조절해요. 이 컴퓨터/브라우저에서만 적용되고 다른 사람 화면에는 영향이 없어요.",
      uiFontScaleResetBtn: "기본값",
      ticketFontSizesTitle: "빌지(주방 티켓) 글자 크기·굵기",
      ticketFontSizesHint:
        "항목별로 글자 크기와 굵기를 따로 조절할 수 있어요. 오른쪽 미리보기는 실제 인쇄 크기 그대로예요. 브라우저 인쇄(미리보기 인쇄)에만 적용되고, ESC/POS 직접 인쇄에는 적용되지 않아요 — 프린터 자체 글꼴이라 이렇게 세밀하게 조절할 수 없어요.",
      tfsStoreName: "상호명 (헤더)",
      tfsTableNo: "테이블 번호",
      tfsOrderTypeBadge: "주문유형 (매장/포장) 배지",
      tfsTime: "주문 시간",
      tfsItemName: "메뉴 이름",
      tfsItemDetail: "세부사항 (└ 소/맵기)",
      tfsItemTakeout: "메뉴별 포장 표시 (└ 포장)",
      tfsItemPrice: "결제용(금액) 표시 (└ NT$)",
      tfsTotal: "합계",
      tfsOrderNote: "결제용 하단 안내 문구 (※...)",
      tfsPrintTime: "인쇄 시간",
      tfsSizeColLabel: "크기",
      tfsWeightColLabel: "굵기",
      tfsPreviewKitchenBtn: "주방용",
      tfsPreviewPriceBtn: "결제용(금액)",
      ticketFontSavedMsg: "저장되었습니다",
      ticketFontResetBtn: "기본값으로",
      staffPasswordLabel: "직원 로그인 비밀번호 재설정 (6자 이상)",
      staffPasswordIsSet: "직원 비밀번호가 설정되어 있습니다.",
      staffPasswordNotSet: "아직 정해지지 않았습니다 — 정하기 전까지 직원은 로그인할 수 없어요.",
      staffPasswordSaveBtn: "직원 비밀번호 저장",
      staffPermSaved: "저장되었습니다",
      staffPasswordSaved: "직원 비밀번호가 변경되었습니다",
      staffPasswordTooShort: "6자 이상 입력하세요",
      staffPasswordFailed: "저장 실패. 다시 시도해주세요",
      loginAsStaffBadge: "직원 계정으로 로그인함",
      loginAsOwnerBadge: "사장 계정으로 로그인함",
      permissionDeniedMsg: "이 작업은 사장님의 허락이 필요해요. 사장님께 문의해주세요.",
    },
    zh: {
      appDialogOk: "確定",
      appDialogCancel: "取消",
      pageTitle: "韓國館 管理後台",
      loginTitle: "管理員登入",
      loginSubtitle: "員工與負責人專用畫面",
      loginBackHome: "← 回首頁",
      loginPasswordPlaceholder: "管理員密碼",
      loginBtn: "登入",
      loginError: "密碼錯誤，請重新輸入",
      loginErrorAutofill: "瀏覽器自動填入了已儲存的舊密碼。已清空，請直接輸入",
      brand: `${TAEGEUK_ICON_INLINE} 韓國館 管理後台`,
      tabOrders: "即時訂單",
      tabPayment: "結帳",
      tabMenu: "菜單管理",
      tabTables: "桌號 / QR Code",
      tabSettings: "設定",
      settleAmBtn: "🌅 上午結算",
      settlePmBtn: "🌙 下午結算",
      logoutBtn: "登出",
      soundToggleLabel: "🔔 新訂單提示音",
      autoPrintToggleLabel: "🖨️ 新訂單自動列印",
      printDeviceHere: "🖨️ 由這台裝置列印",
      printDeviceElsewhere: "🖨️ 目前由{name}列印",
      printDeviceUnknown: "其他裝置",
      printDeviceTakeoverConfirm: "目前是由{name}印單。\n要把列印改成這台裝置嗎？\n（改過來之後，那台的自動列印會關閉）",
      printDeviceKindPos: "廚房 POS App",
      printDeviceKindTablet: "平板",
      printDeviceKindPhone: "手機",
      printDeviceKindPc: "電腦",
      toggleSavedMsg: "✔ 已儲存",
      refreshBtn: "重新整理",
      refreshingBtn: "⏳ 重新整理中...",
      refreshedBtn: "✅ 完成",
      refreshFailedBtn: "⚠️ 失敗",
      statusNew: "新訂單",
      statusPreparing: "製作中",
      statusServed: "已出餐",
      statusPaid: "已結帳",
      statusCancelled: "已取消",
      nextNew: "開始製作",
      nextPreparing: "標記為已出餐",
      nextServed: "標記為已結帳",
      cancelBtn: "取消",
      orderEditBtn: "✏️ 修改",
      printBtn: "🖨️ 列印",
      previewBtn: "👁️ 預覽",
      confirmCancelOrder: "確定要取消這筆訂單嗎？",
      collapseItemsBtn: "收合 ▲",
      dragHandleTitle: "拖曳以調整順序/階段",
      orderStatusChangeFailed: "狀態變更失敗，請再試一次。",
      tableDetailTabActive: "目前訂單",
      tableDetailTabPaid: "先前訂單",
      tableDetailNoPaidHistory: "目前還沒有已結帳的訂單。",
      allOrderCardsDismissed: "已隱藏所有訂單卡片。",
      restoreDismissedBtn: "重新顯示",
      dismissOrderCardBtn: "隱藏這張卡片",
      orderEditModalTitle: "修改訂單",
      orderEditAddBtn: "+ 新增",
      orderEditAddHint: "像銅盤烤肉這種可混搭的餐點，無法在這裡新增——如需新增請改用手動點餐。",
      orderEditCancel: "取消",
      orderEditSave: "儲存",
      orderEditSaved: "修改內容已儲存。",
      orderEditEmptyError: "訂單至少要保留一項餐點。",
      orderEditNotEditable: "已結帳或已取消的訂單無法修改。",
      tableLabel: "桌號",
      orderCardTakeoutBadge: "外帶",
      orderCardDeliveryBadge: "外送",
      orderCardMixedBadge: "混合",
      printFailedCardMsg: "⚠️ 列印失敗 — 請確認廚房是否收到，或用下方列印按鈕重試",
      orderCardLocUnverified: "📍 位置未確認",
      settlementAmTitle: "🌅 上午",
      settlementPmTitle: "🌙 下午",
      settlementTotalBadge: "合計",
      settlementHalfOrders: "結帳",
      settlementHalfOrdersUnit: "筆",
      settlementAmUntil: "至 {t}",
      settlementPmFrom: "{t} 起",
      settlementHalvesGap: "⚠ 有 {n} 天沒有按上午結算，那幾天的 {amt} 沒有分到上午或下午。上方合計仍包含這筆金額。",
      settlementHalvesNone: "這段期間無法分上午／下午（{amt}）。可能是訂單尚未標記時段，或當天只有一個營業時段。上方合計仍然正確。",
      settlementShiftHint: "點一下只看這個時段",
      settlementShiftHintActive: "點一下回到合計",
      settlementViewingAm: "🌅 只看上午",
      settlementViewingPm: "🌙 只看下午",
      settlementViewAll: "看合計",
      settlementShiftNote: "以下內容全部只包含這個時段。",
      settlementChartUnavailable: "圖表無法顯示（chart 檔案載入失敗）。數字仍在上方統計與下方清單中。",
      settingsSoldOutReleaseTitle: "售完自動恢復時間",
      settingsSoldOutReleaseHint: "設定了結束日期（例如「售完至 9/10」）時，隔天的這個時間會自動恢復販售。留空則使用開始營業時間。設為 00:00 表示跨日就恢復 — 營業到深夜時，可能會賣出廚房已經沒有的餐點，請留意。",
      labelSoldOutReleaseTime: "恢復時間（留空＝開始營業時間）",
      settingsUnsaved: "● 有尚未儲存的變更 — 請按下方的「儲存設定」",
      resetToDefaultBtn: "預設值",
      clearBtn: "清除",
      logoPicked: "已選擇：{name} — 按「儲存設定」才會上傳",
      logoNonePicked: "請先選擇要上傳的檔案",
      soldOutReleaseFollowsHours: "目前依照開始營業時間（{t}）。",
      soldOutReleaseFixed: "每天 {t} 恢復。",
      soldOutReleasesAt: "{d} {t} 恢復",
      labelLocationCheckEnabled: "啟用位置確認",
      locationOffHint: "目前關閉。不會向客人要求定位，任何地點都能下單。",
      printFailReasonApp: "APP 無法連線到出單機",
      printFailReasonOff: "自動列印已關閉",
      printFailReasonElsewhere: "這台裝置不是列印裝置",
      printFailReasonNoPrinter: "找不到出單機",
      takeoutCounterShort: "外帶",
      memoLabel: "備註",
      orderMemoLabel: "訂單備註",
      totalLabel: "合計",
      subtotalLabel: "小計",
      addItemBtn: "+ 新增菜品",
      codeTh: "代號",
      nameTh: "名稱",
      priceTh: "價格",
      statusTh: "狀態",
      orderTh: "順序",
      moveItemUpTitle: "上移",
      moveItemDownTitle: "下移",
      photoMissing: "尚無<br>照片",
      photoMissingTitle: "請新增照片",
      labelServiceStart: "開始營業時間（此時間之前的訂單視為測試，不列入結帳與訂單列表）",
      serviceStartHint: "留空即恢復顯示全部。不會刪除任何資料。",
      storageWarnTitle: "資料儲存空間已用 %s / 16MB。",
      storageWarnSub: "目前還有餘裕，但請先跟開發者提「store 文件拆分」。到達上限後訂單將無法儲存。",
      storageUrgentTitle: "資料儲存空間已用 %s / 16MB，即將到達上限。",
      storageUrgentSub: "請盡快聯繫開發者處理「store 文件拆分」。到達上限後訂單將無法儲存。",
      storageCheckedAt: "每日結帳時自動檢查。最後檢查：%s",
      settlementGuests: "來客數",
      settlementAvgPerGuest: "每位平均",
      settlementAvgPerOrder: "每筆平均",
      settlementDiscountTotal: "折扣金額",
      settlementGrossRevenuePrefix: "折扣前",
      settlementShare: "占比",
      settlementOrderTypeTitle: "內用 / 外帶",
      settlementOrderTypeName: "類型",
      settlementOrderTypeDineIn: "內用",
      settlementOrderTypeTakeout: "外帶",
      settlementOrderTypeMixed: "混合",
      settlementCategoryTitle: "分類營收",
      settlementCategoryName: "分類",
      settlementCategoryNone: "未分類",
      settlementDiscountTitle: "折扣明細",
      settlementDiscountHint: "已從營收中扣除的金額，顯示總共折讓了多少。",
      settlementDiscountKind: "類型",
      settlementDiscountAmount: "折扣額",
      settlementVipCardTitle: "VIP卡損益",
      settlementVipCardSales: "卡片販售",
      settlementVipCardDiscount: "卡片折扣",
      settlementVipCardNet: "差額",
      settlementVipCardNote: "這是今天賣出的卡片金額，與今天使用卡片折抵的金額。兩者不是同一張卡，且卡片可用一年，真正的損益請把期間拉長來看。",
      settlementDiscountManual: "自行輸入",
      settlementTableTitle: "各桌營收",
      settlementTableName: "桌號",
      settlementMoneyInTitle: "💰 收入來源",
      settlementSoldTitle: "🍚 賣了什麼",
      settlementWhenWhereTitle: "⏰ 何時、哪一桌",
      settlementReconcileOk: "✓ 各結帳方式的總和與上方營收完全一致，可以直接對帳。",
      settlementNoData: "這段期間沒有記錄。",
      settlementCountSuffix: "筆",
      settlementQtySuffix: "份",
      settlementItemsExpand: "顯示全部",
      settlementItemsCollapse: "收合",
      settlementOrdersTitle: "📋 查詢過往訂單",
      settlementOrdersSearchPlaceholder: "以菜名、客人姓名或取餐號搜尋",
      settlementOrdersTablePlaceholder: "桌號",
      settlementOrdersAllStatus: "全部狀態",
      settlementOrdersSearchBtn: "搜尋",
      settlementOrdersLoading: "載入中…",
      settlementOrdersFailed: "訂單載入失敗，請再試一次。",
      settlementOrdersNone: "沒有符合條件的訂單。",
      settlementOrdersTruncated: "（僅顯示最新的部分，若要看更多請縮小日期範圍）",
      settlementOrdersPickupSuffix: "號",
      settlementOrdersPaidWith: "結帳方式：",
      settlementOrdersPaidAt: "結帳時間：",
      settlementOrdersStatus: "狀態：",
      onSale: "供應中",
      soldOut: "已售完",
      soldOutToday: "今日售完",
      soldOutRange: "期間售完",
      soldOutAlways: "持續售完",
      soldOutTitle: "售完設定",
      itemSoldOutLabel: "售完",
      soldOutModeOnSale: "供應中",
      soldOutModeToday: "只有今天售完（明天開店時自動恢復）",
      soldOutModeRange: "指定期間",
      soldOutModeAlways: "持續售完（到手動恢復為止）",
      soldOutFromLabel: "開始日期（留空表示從今天起）",
      soldOutUntilLabel: "結束日期（留空表示到手動恢復為止）",
      soldOutRangeInvalid: "結束日期早於開始日期。",
      soldOutRangeEmpty: "請至少填寫開始或結束日期其中一個。",
      soldOutSaveFailed: "售完設定儲存失敗，請再試一次。",
      itemModalAddTitle: "新增菜品",
      itemModalEditTitle: "編輯菜品",
      alertMenuNameRequired: "請輸入菜品名稱",
      confirmDeleteItem: "確定要刪除這個菜品嗎？此操作無法復原。",
      newTableNumberPlaceholder: "桌號（例如：12）",
      newTableLabelPlaceholder: "顯示名稱（選填）",
      addTableBtn: "+ 新增桌號",
      printQrBtn: "🖨️ 列印全部 QR Code",
      viewListBtn: "📋 清單檢視",
      viewFloorBtn: "🗺️ 平面圖檢視",
      addZoneBtn: "+ 新增區域",
      saveFloorPlanBtn: "💾 儲存版面",
      floorPlanSavedMsg: "版面已儲存",
      floorPlanHint: "拖曳區域和桌號即可移動位置，拖曳右下角可調整大小。點擊區域名稱可以修改名稱。移動位置後請按「儲存版面」確認已儲存。",
      paymentFloorHint: "點擊座位即可直接開啟結帳畫面。版面配置請到「桌號 / QR Code」頁籤的版面配置檢視調整。",
      alertTableNumberRequired: "請輸入桌號",
      alertUnluckyNumber: "桌號不能包含數字「4」（在台灣被視為不吉利的數字）。",
      alertTableExists: "此桌號已經存在",
      alertFloorPlanSaveFailed: "版面儲存失敗，剛剛移動的位置會還原——請再試一次。",
      tableEmptyBadge: "空桌",
      counterSectionTitle: "📦 外帶櫃檯 QR Code",
      counterSectionHint: "不是桌號，是專門給櫃檯外帶點餐用的 QR Code，客人不需要坐下就能直接點外帶。",
      counterCreateBtn: "建立外帶櫃檯 QR Code",
      counterQrBtn: "🖨️ 查看/列印外帶 QR Code",
      tableDelTitle: "刪除",
      tableDelUnpaidMsg: "這桌還有尚未結帳的訂單，結完帳後才能刪除。",
      tableDelSeatedMsg: "這桌目前記錄為有客人入座，請先用「客人離開」清空後再刪除。",
      tableDelCounterMsg: "外帶櫃檯無法刪除。那是外帶訂單的入口，刪掉的話所有外帶 QR 都會失效。",
      tableDelFailedMsg: "刪除失敗，請稍後再試一次。",
      noOrdersYetAdmin: "目前尚無訂單。",
      unpaidTotalLabel: "目前未結帳金額：",
      clearPartySizeBtn: "👥 客人已離開（清除人數）",
      moveTableBtn: "🔀 換桌",
      moveSlipTitle: "換桌單",
      moveSlipHint: "換桌時會印出一張。廚房與外場已經拿到印著舊桌號的訂單，只改畫面的話拿著紙的人不會知道。這張紙是用來貼著或壓在舊訂單上的，所以「5 → 8」那一行印得最大。",
      moveSlipEnableLabel: "列印換桌單",
      moveSlipShowOrdersLabel: "附上移動的訂單清單",
      moveSlipTestBtn: "🖨️ 測試列印",
      moveSlipSampleItemA: "石鍋拌飯",
      moveSlipSampleItemB: "泡菜火鍋",
      msStoreName: "店名（表頭）",
      msTitle: "標題（換桌）",
      msTables: "桌號（5 → 8）",
      msInfo: "時間 · 人數",
      msOrders: "移動的訂單清單",
      msFooter: "下方提醒（新桌號 QR）",
      moveTableModalTitle: "換桌 — 選擇要移到的桌號",
      moveTableOccupied: "有客人",
      moveTableNoTargets: "沒有可以移動的桌號",
      moveTableFailed: "換桌失敗，請再試一次",
      clearPartySizeConfirm: "要清除這桌已登記的人數嗎？下一位客人會重新被詢問人數。",
      clearPartySizeDone: "已清除人數。",
      clearPartySizeFailed: "清除人數失敗，請再試一次。",
      unpaidTotalLabel2: "未結帳金額：",
      paySelectedBtn: "結帳完成",
      paySelectedFailedMsg: "部分品項結帳失敗，請重新整理後再確認一次。",
      itemPaidBadge: "已結帳",
      selectRoundAllLabel: "全選此筆訂單",
      selectAllItemsLabel: "全選",
      paymentMethodModalTitle: "選擇付款方式",
      paymentMethodCash: "現金",
      paymentMethodLinepay: "LinePay",
      paymentMethodCard: "信用卡",
      paymentMethodOther: "其他",
      paymentMethodCashOnlyHint: "所選折扣僅適用於現金付款。",
      manualDiscountModalTitle: "輸入自訂折扣",
      manualDiscountModalHint: "請選擇折扣方式並輸入數值。",
      manualDiscountModeAmount: "金額 (NT$)",
      manualDiscountModePercent: "百分比 (%)",
      manualDiscountErrorMsg: "請重新確認輸入的數字（百分比請輸入 100 以下）",
      manualDiscountClearBtn: "取消折扣",
      tableEditModeBtn: "✏️ 編輯",
      tableEditModeHint: "目前是編輯模式。點桌號卡片上的 ✕ 即可刪除。再按一次「編輯」即可關閉。",
      mergePayModeBtn: "🧾 合併結帳",
      mergePayHint: "請選擇要合併結帳的桌號（僅能選擇有未結帳訂單的桌號）。",
      mergePayCancelBtn: "取消",
      mergePayConfirmBtn: "確定合併結帳",
      manualOrderBtn: "📝 手動點餐",
      manualOrderModalTitle: "手動點餐 — 選擇桌號",
      manualOrderHint: "選擇桌號後，會在新分頁開啟顧客點餐畫面。直接在那裡選餐送出，就會跟平常一樣出現在新訂單並自動出單。",
      zoneAddBtnTitle: "新增桌號",
      zoneAddBtnLabel: "+ 桌號",
      zoneDelTitle: "刪除區域",
      tableUnassignTitle: "移出此區域",
      promptZoneName: "區域名稱",
      addTableToZoneModalTitle: "新增桌號",
      addTableToZoneHint: "請選擇要加入的桌號（可多選）。",
      addTableToZoneEmpty: "沒有可配置的桌號。<br/>請先在上方新增桌號。",
      addTableToZoneCancel: "取消",
      addTableToZoneConfirm: "確定",
      settingsCatDisplay: "顯示 · 聲音",
      settingsCatDisplaySub: "字級 · 提示音",
      settingsCatStore: "店家資訊",
      settingsCatStoreSub: "照片 · Logo · 公告 · 店名/地址",
      settingsCatOrder: "點餐規則",
      settingsCatOrderSub: "可點餐時間 · 售完恢復 · 位置限制",
      settingsCatAccount: "帳號",
      settingsCatAccountSub: "密碼 · 店員權限",
      settingsCatNotify: "通知",
      settingsCatNotifySub: "打烊 LINE 通知",
      settingsCatPayment: "付款",
      settingsCatPaymentSub: "線上付款 (ECPay)",
      settingsCatVipSub: "Google 登入設定",
      settingsCatPrint: "列印",
      settingsCatPrintSub: "廚房印表機 · 出單字級",
      settingsSearchPlaceholder: "搜尋設定 — 印表機、密碼、營業時間 …",
      settingsSearchEmpty: "找不到相符的設定",
      orderHoursUnavailable: "尚未載入這個設定",
      orderHoursUnavailableSub: "請重新啟動伺服器後重新整理",
      livePreviewLabel: "預覽（顧客畫面）",
      tabSettlement: "結算",
      settlementStartLabel: "開始日期",
      settlementEndLabel: "結束日期",
      settlementTodayBtn: "今天",
      settlementWeekBtn: "最近 7 天",
      settlementMonthBtn: "最近 30 天",
      settlementCsvBtn: "⬇️ 下載 CSV",
      settlementCloseBtn: "📌 儲存這天的結算紀錄",
      settlementCloseRangeHint: "只有選擇單一天（開始日期＝結束日期）時才能儲存。",
      settlementTodayOnlyNote: "僅顯示今日",
      settlementSavedMsg: "✔ 已儲存",
      settlementRevenue: "營業額（已結帳）",
      settlementPaidCount: "已結帳訂單",
      settlementProblemCount: "⚠️ 未結帳/異常訂單",
      settlementCancelledCount: "已取消訂單",
      settlementProblemTitle: "⚠️ 尚未結帳的訂單",
      settlementProblemHint: "以下訂單在選定的期間內目前尚未標記為已結帳。請確認下單時間與內容，避免漏收款項。",
      settlementItemsTitle: "品項銷售明細",
      settlementItemName: "品項",
      settlementItemQty: "數量",
      settlementItemSubtotal: "小計",
      settlementPaymentMethodTitle: "付款方式統計",
      settlementPaymentMethodName: "付款方式",
      settlementPaymentMethodCount: "筆數",
      settlementPaymentMethodRevenue: "營業額",
      settlementPaymentMethodTotalLabel: "總計",
      paymentMethodOnline: "線上付款",
      paymentMethodUnspecified: "未指定",
      settlementTrendTitle: "營業額趨勢（選定期間）",
      settlementTurnover: "平均翻桌時間",
      settlementTurnoverMinutes: "分鐘",
      settlementTurnoverNoData: "–",
      settlementHourlyTitle: "時段來客數 & 熱門品項",
      settlementHourlyHint: "將滑鼠移到長條上，可以看到該時段熱賣的品項。",
      settlementHourlyOrders: "訂單數",
      settlementHourlyTopItems: "熱門品項",
      settlementHistoryTitle: "過往結算趨勢",
      settlementHistoryHint: "每天打烊時間後會自動儲存紀錄（也可以手動儲存）。從左側選擇日期即可查看。",
      settlementHistoryEmpty: "尚無已儲存的結算紀錄。",
      settlementHistoryProblem: "未結帳",
      settingsCoverTitle: "顧客畫面頂部照片",
      settingsCoverHint: "顯示在點餐頁面最上方的店家代表照片。",
      seasonalTaegeukLabel: "頁首標誌季節設定",
      seasonOptAuto: "自動（依今天日期）",
      seasonOptSpring: "春（櫻花）",
      seasonOptSummer: "夏（陽傘）",
      seasonOptAutumn: "秋（落葉）",
      seasonOptWinter: "冬（雪）",
      seasonOptOff: "關閉（原始太極圖案）",
      saveSeasonBtn: "儲存季節設定",
      settingsLogoTitle: "店家標誌（顯示於 QR Code 中央）",
      settingsLogoHint: "建議使用接近正方形的圖片，會小尺寸置中顯示在列印用 QR Code 上。",
      settingsNoticeTitle: "公告橫幅",
      settingsNoticeHint: "顯示在顧客點餐頁面上方的公告文字（留空則不顯示）。",
      noticeLabel: "公告文字",
      saveNoticeBtn: "儲存公告",
      noticePreviewEmpty: "輸入公告文字後會顯示在這裡。",
      settingsInfoTitle: "店家資訊",
      labelNameZh: "店名（中文）",
      labelNameKo: "店名（韓文）",
      labelPhone: "電話號碼",
      labelAddressZh: "地址（中文）",
      labelAddressKo: "地址（韓文，選填）",
      addressKoPlaceholder: "留空則顯示中文地址",
      labelHours: "營業時間",
      labelMinSpend: "每人低消金額（NT$）",
      saveSettingsBtn: "儲存設定",
      savedMsg: "已儲存",
      settingsOrderHoursTitle: "可點餐時間",
      settingsOrderHoursHint: "在此時間之外，客人無法用 QR 點餐。菜單照常顯示，只有點餐按鈕會鎖住。店員與老闆登入後隨時都能點餐。",
      orderHoursEnabledLabel: "非營業時間停止接單",
      orderHoursAddRange: "+ 新增時段",
      orderHoursRemoveRange: "刪除",
      orderHoursBaseLabel: "預設時間（未另外設定的星期）",
      orderHoursByDayLabel: "各星期設定",
      orderHoursByDateLabel: "特定日期（颱風 · 臨時公休等）",
      orderHoursDateDefault: "照常",
      orderHoursDateClosed: "當日公休",
      orderHoursDateCustom: "當日另訂時間",
      orderHoursMarkClosed: "休",
      orderHoursMarkCustom: "時",
      orderHoursNoteLabel: "原因（選填 · 填了顧客也看得到）",
      orderHoursNotePlaceholder: "例：颱風公休",
      orderHoursNotePlaceholderHours: "例：颱風影響，僅晚間營業",
      orderHoursDayDefault: "同預設",
      orderHoursDayCustom: "自訂",
      orderHoursDayClosed: "公休",
      orderHoursTodayLabel: "今天",
      orderHoursTodayHoliday: "今天公休",
      orderHoursOff: "目前沒有任何限制",
      orderHoursOffSub: "開啟上方開關後，非營業時間將無法點餐",
      orderHoursOpenNow: "目前開放點餐",
      orderHoursClosedNow: "目前停止接單",
      orderHoursNextOpen: "下次開放",
      orderHoursToday: "今天",
      orderHoursTomorrow: "明天",
      daySun: "日",
      dayMon: "一",
      dayTue: "二",
      dayWed: "三",
      dayThu: "四",
      dayFri: "五",
      daySat: "六",
      settingsLocationTitle: "位置限制點餐",
      settingsLocationHint: "設定店家位置後，超出範圍就無法送出訂單。此功能可防止有人拍下 QR Code 在別處使用。<strong>請在店內時</strong>按下方按鈕。",
      captureLocationBtn: "📍 將目前位置設為店家位置",
      labelRadius: "允許範圍（公尺）",
      locationNotSet: "尚未設定店家位置（位置限制已關閉）",
      locationNoBrowserSupport: "此瀏覽器不支援定位功能。",
      locationChecking: "正在確認位置…",
      locationSaved: "店家位置已儲存。",
      locationFailed: "定位失敗：請允許瀏覽器的位置權限。",
      settingsPwTitle: "變更密碼",
      ownerPwTitle: "變更老闆密碼",
      labelPwCurrent: "目前密碼",
      labelPwNew: "新密碼（至少 6 碼）",
      changePwBtn: "變更密碼",
      pwChanged: "密碼已變更",
      pwChangeFailed: "變更失敗，請確認目前密碼是否正確（新密碼需至少 6 碼）",
      uploadFailed: "上傳失敗，請再試一次",
      logoUpdated: "標誌已更新",
      coverUpdated: "照片已更新",
      chipEntryPlaceholder: "輸入後按 Enter",
      chipAddonNamePlaceholder: "名稱 (例: 加點炒飯)",
      chipAddonPricePlaceholder: "價格",
      chipAddBtn: "新增",
      chipFreeAddon: "(免費)",
      itemOptionsSingleTitle: "只能選一個的選項",
      itemOptionsSingleHint: "顧客只會從中選一個，價格不會變。",
      itemOptionsMultiTitle: "可以複選的選項",
      itemOptionsMultiHint: "顧客可以選任意多個，選越多價格越高。免費的話請填 0。",
      itemPaneBasic: "基本",
      itemPaneBasicSub: "分類 · 編號 · 名稱",
      itemPanePrice: "價格",
      itemPanePriceSub: "價格 · 原價 · 最低份數",
      itemPaneOptions: "選項",
      itemPaneOptionsSub: "肉類 · 辣度 · 加點",
      itemPaneDisplay: "顧客畫面",
      itemPaneDisplaySub: "標記 · 過敏原 · 照片",
      itemPaneSoldOut: "售完",
      itemPaneSoldOutSub: "販售中 · 期間",
      itemCategoryLabel: "分類",
      itemCodeLabel: "代號（選填）",
      itemNameZh: "名稱（中文）",
      itemNameKo: "名稱（韓文）",
      itemDescZh: "說明（中文）",
      itemDescKo: "說明（韓文）",
      itemPriceLabel: "價格（NT$）",
      itemPriceNoteLabel: "價格備註",
      itemPriceNotePlaceholder: "例如：2人份",
      itemOriginalPriceLabel: "原價（折扣前價格，不需要請留空）",
      itemOptionsLabel: "選項（用逗號分隔，例如：牛肉,豬肉）",
      itemOptionsPlaceholder: "沒有選項請留空",
      itemSpiceOptionsLabel: "辣度選項（用逗號分隔，例如：不辣,普通,辣）",
      itemSpiceOptionsPlaceholder: "沒有辣度選項請留空",
      itemTakeoutOptionsLabel: "外帶專用選項（用逗號分隔，例如：不煮外帶,煮熟外帶）",
      itemTakeoutOptionsPlaceholder: "沒有外帶專用選項請留空",
      itemAddonsLabel: "加點選項（名稱:價格，用逗號分隔，例如：加點炒飯:80,加點泡麵:50）",
      itemAddonsPlaceholder: "沒有加點選項請留空",
      itemMinFirstOrderQtyLabel: "首次點餐最低數量（不需要請留空）",
      itemMixOptionsLabel: "允許各選項獨立增減數量(+/-)",
      itemAllergensLabel: "過敏原 / 肉類標示（會顯示在顧客畫面）",
      itemSpicyLabel: "辣 🌶",
      itemSignatureLabel: "招牌菜 ★",
      itemAvailableLabel: "供應中",
      itemPhotoLabel: "照片",
      deleteItemBtn: "刪除菜品",
      saveBtn: "儲存",
      staffPermTitle: "員工權限管理",
      staffPermHint: "以員工帳號登入時，只能執行下方開啟的項目（新增/刪除/修改）。確認訂單、變更狀態（開始製作/出餐/結帳）、列印永遠都可以操作。",
      permMenuEdit: "新增/修改/刪除菜品",
      permTableEdit: "新增・刪除・編輯桌號/平面圖",
      permSettingsEdit: "變更店家設定",
      permOrderCancel: "取消訂單",
      permOrderEdit: "修改訂單內容（餐點/數量/選項）",
      permReservationManage: "新增/修改/刪除訂位",
      tabReservations: "訂位",
      reservationDateFilterLabel: "日期",
      reservationShowAllBtn: "顯示全部",
      addReservationBtn: "+ 新增訂位",
      reservationEmpty: "目前沒有訂位。",
      reservationNoTable: "尚未指定桌號",
      reservationAddTitle: "新增訂位",
      reservationEditTitle: "編輯訂位",
      reservationNameLabel: "訂位姓名",
      reservationPhoneLabel: "電話號碼",
      reservationDateLabel: "日期",
      reservationTimeLabel: "時間",
      reservationPartyLabel: "人數",
      reservationTableLabel: "桌號（選填）",
      reservationTablePlaceholder: "留空表示尚未指定",
      reservationNoteLabel: "備註",
      deleteReservationBtn: "刪除訂位",
      cancelReservationBtn: "標記為取消",
      reservationDeleteConfirm: "確定要刪除這筆訂位嗎？",
      lineSettingsTitle: "打烊自動通知（LINE）",
      lineSettingsHint: "當店員按下「🌅 上午結算」/「🌙 下午結算」時，會把當下的營業額、各付款方式金額與未結帳摘要，只個別傳送給下方已註冊的人（不是傳送給所有加好友的人）。一天兩則。若當天沒有人按結算按鈕，則會在打烊時間傳送一次。",
      lineEnableLabel: "啟用打烊通知",
      lineTokenLabel: "頻道存取權杖",
      lineTokenPlaceholder: "若已儲存權杖，留空即可保留原本設定",
      saveLineSettingsBtn: "儲存",
      testLineBtn: "📩 立即傳送測試訊息",
      lineTokenSetStatus: "✔ 已儲存權杖",
      lineTokenNotSetStatus: "尚未儲存權杖",
      lineRevealBtn: "顯示",
      lineHideBtn: "隱藏",
      lineSecretLabel: "頻道密鑰（Webhook 驗證用）",
      lineSecretPlaceholder: "若已儲存密鑰，留空即可保留原本設定",
      lineSecretSetStatus: "✔ 已儲存頻道密鑰",
      lineSecretNotSetStatus: "尚未儲存頻道密鑰",
      linePendingHint: "只要有人將這個官方帳號加為好友，就會出現在下方待審核名單，附上姓名/照片。請確認是本人後再核准，核准後才會真正開始收到通知。",
      linePendingTitle: "待審核",
      lineApprovedTitle: "接收通知的人",
      linePendingEmpty: "目前沒有待審核的人。",
      lineApprovedEmpty: "尚未有人被核准接收通知。",
      lineApproveBtn: "核准",
      lineRejectBtn: "拒絕",
      lineRemoveBtn: "移除",
      lineRemoveConfirm: "確定不再傳送通知給這個人嗎？",
      lineSavedMsg: "已儲存",
      lineTestSending: "傳送中...",
      lineTestSuccess: "✔ 已傳送測試訊息，請確認 LINE App。",
      lineTestFailed: "傳送失敗 — 請確認尚未有註冊的接收者，或檢查權杖設定。",
      paymentSettingsTitle: "線上付款（綠界 ECPay）",
      paymentSettingsHint: "讓顧客可以直接用信用卡/LINE Pay/JKOPay 等方式付清該桌的未結帳金額。關閉時維持現況，需要店員按下「結帳完成」。",
      paymentEnableLabel: "啟用線上付款",
      paymentTestModeStatus: "⚠ 測試模式 — 尚未設定綠界正式特店資訊，不會產生真實扣款（在伺服器環境變數加入 ECPAY_MERCHANT_ID 等即可切換為正式付款）。",
      paymentLiveModeStatus: "✔ 正式付款模式 — 已連接綠界正式特店資訊。",
      paymentSavedMsg: "已儲存",
      tabVip: "會員(VIP)",
      tabAccounts: "帳號",
      accountsTabHint:
        "這裡是從官網註冊的帳號。把顧客改成員工或負責人後，那個人在官網登入時就會看到「管理後台」按鈕，並且可以進入管理畫面。降級後權限也會立刻收回，不用等他重新登入。",
      accountSearchPlaceholder: "以姓名或信箱搜尋",
      accountsRefreshBtn: "重新整理",
      accountsLoading: "載入中…",
      accountsLoadError: "無法載入帳號清單。",
      accountsEmpty: "目前還沒有從官網註冊的帳號。",
      accountsNoMatch: "沒有符合的結果。",
      accountRoleCustomer: "顧客",
      accountRoleStaff: "員工",
      accountRoleOwner: "負責人",
      accountMethodPassword: "密碼",
      accountMethodGoogle: "Google",
      accountRoleConfirm: "要將 {name} 的身分改為「{role}」嗎？",
      accountErrSelfDemote: "無法降低自己的權限，請改用其他負責人帳號操作。",
      accountErrLastOwner: "這是最後一個負責人帳號，請先指定其他人為負責人。",
      accountErrGeneric: "無法變更身分，請稍後再試。",
      vipTabHint:
        "這裡是把已經印製好的實體 VIP 卡卡號登記進系統，讓「顧客可以在線上註冊」。這不是發行新卡片的功能，只是把已發出的卡號告訴系統。顧客會在點餐頁面用 Google 登入後輸入這個卡號，連結到自己的帳號。有效期限是從發卡日起算 1 年。",
      vipCardNumberPlaceholder: "卡號（例：V0001）",
      vipDiscountPlaceholder: "折扣率 (%)",
      vipNotePlaceholder: "備註（選填，例：發給某某人）",
      vipAddCardBtn: "+ 新增卡片",
      vipNoCards: "目前沒有登記的 VIP 卡。",
      vipStatusActive: "✔ 已註冊 · 有效",
      vipStatusExpired: "已註冊 · 已過期",
      vipStatusUnclaimed: "未註冊（等待中）",
      vipDiscountLabel: "折扣率",
      vipIssueDateLabel: "發卡日",
      vipExpiryDateLabel: "到期日",
      vipNoteLabelShort: "備註",
      vipEditBtn: "編輯",
      vipUnlinkBtn: "解除註冊",
      vipDeleteBtn: "刪除",
      vipUnlinkConfirm: "要解除這張卡片的線上註冊嗎？顧客需要重新用卡號註冊。",
      vipDeleteConfirm: "確定要刪除這張卡片嗎？",
      vipCannotDeleteClaimed: "顧客已經註冊的卡片無法刪除，請先按「解除註冊」。",
      vipAddInvalid: "請正確輸入卡號、發卡日與折扣率（1~100）。",
      vipEditInvalid: "請正確輸入發卡日與折扣率（1~100）。",
      vipCardNumberTaken: "這個卡號已經登記過了。",
      settingsCatVip: "會員(VIP)",
      vipSettingsTitle: "會員(VIP) Google 登入設定（Firebase）",
      vipSettingsHint:
        "要讓顧客在點餐頁面用 Google 登入並註冊 VIP 卡，需要一個 Firebase 專案。1) 到 Firebase 主控台（console.firebase.google.com）建立新專案，2) 在 Authentication 開啟「Google」登入方式，3) 新增網頁應用程式後，把出現的 firebaseConfig 程式碼整段複製貼到下面。另外 4) 在專案設定 > 服務帳戶用「產生新的私密金鑰」取得的 JSON 檔內容，不要貼在這裡，要設定到部署伺服器（Vercel）的環境變數 FIREBASE_SERVICE_ACCOUNT（這是機密資訊，這個畫面不會儲存）。",
      vipConfigLabel: "firebaseConfig (JSON)",
      vipConfigPlaceholder: '{"apiKey": "...", "authDomain": "...", "projectId": "...", ...}',
      vipConfigNotSet: "尚未設定 — 顧客目前無法使用 Google 登入。",
      vipConfigSet: "✔ 已設定。",
      vipConfigInvalid: "⚠ 格式不正確（必須是包含 apiKey、projectId 的 JSON）。",
      vipSaleTitle: "VIP卡販售",
      vipSaleHint:
        "結帳畫面最下方會出現「VIP卡販售」按鈕。店員按下後，會直接以這裡設定的金額記錄為現金銷售。卡號可以當場輸入，也可以之後在會員(VIP)分頁補登。",
      vipSalePriceLabel: "卡片售價 (NT$)",
      vipSaleDiscountLabel: "販售時一併登記的折扣率 (%)",
      vipSaleDiscountHint: "想給某張卡不同折扣的話，登記後到會員(VIP)分頁單獨修改那張卡即可。",
      vipSellBtn: "💳 VIP卡販售",
      vipSellPendingBtn: "💳 取消 VIP卡",
      vipSellPendingNote: "卡費一律以現金收取",
      vipSellFailedAfterPay: "餐點已結帳，但 VIP 卡沒有售出。\n請先到 VIP 分頁重新販售，再把卡交給客人。",
      vipSellTitle: "VIP卡販售",
      vipSellCashOnly: "僅接受現金。",
      vipSellCardNumberLabel: "卡號（選填 — 也可以之後在會員(VIP)分頁補登）",
      vipSellConfirmBtn: "以現金販售",
      vipSellDone: "已售出 VIP 卡（現金）",
      vipSellDoneWithCard: "已售出 VIP 卡並登記卡號（現金）",
      vipSellFailed: "沒能記錄這筆販售，請再試一次。",
      vipCardSaleItemName: "VIP卡販售",
      settlementCategoryVipCard: "VIP卡販售",
      vipConfigInvalidJson: "JSON 格式不正確，請重新確認從 Firebase 主控台複製的內容。",
      vipSettingsSavedMsg: "已儲存",
      escposSettingsTitle: "廚房出單機直接列印（ESC/POS · QZ Tray）",
      escposSettingsHint:
        "開啟後會直接送到出單機列印，不會跳出確認視窗（自動切紙）。這台電腦需要安裝並執行 <strong>QZ Tray</strong> 程式，且印表機名稱要和 QZ Tray 顯示的名稱完全一致。關閉或 QZ Tray 未連線時，會自動改回目前的瀏覽器列印（預覽列印）方式。",
      escposEnableLabel: "啟用 ESC/POS 直接列印",
      escposPrinterNameLabel: "印表機名稱（依 QZ Tray 顯示）",
      escposPrinterNamePlaceholder: "例如：XINYE N160II",
      escposSavedMsg: "已儲存",
      escposNoPrinterName: "請先輸入印表機名稱",
      escposConnecting: "正在連線 QZ Tray...",
      testEscposBtn: "🖨️ 測試列印",
      escposTestSuccess: "✔ 已送出測試列印，請確認印表機。",
      escposTestFailed: "✘ 列印失敗 — 請確認 QZ Tray 是否執行中，以及印表機名稱是否正確。",
      rawbtSettingsTitle: "廚房出單機直接列印（RawBT · Android 平板）",
      rawbtSettingsHint:
        "在 Android 平板上開啟管理後台時使用的方式。QZ Tray 無法安裝在 Android 上，因此改為在平板上安裝 <strong>RawBT</strong> App 並在裡面設定好印表機，這台平板就能不跳出確認視窗直接列印。不管印表機是用藍牙配對，還是用 LAN 網路線連上路由器、以網路（IP）方式在 RawBT 裡設定，都在 RawBT App 內完成，這裡只需要開啟這個選項即可。開啟後仍會先嘗試 QZ Tray，只有失敗時（在沒有 QZ Tray 的 Android 上一定會失敗）才會自動改用這個方式。",
      rawbtEnableLabel: "啟用 RawBT 直接列印",
      rawbtSavedMsg: "已儲存",
      testRawbtBtn: "🖨️ RawBT 測試列印",
      rawbtTestSent: "已透過 RawBT 送出測試列印，請確認印表機是否已不跳確認視窗直接列印（此裝置需已安裝並設定好 RawBT App）。",
      rawbtTestFailed: "✘ 傳送給 RawBT 失敗 — 請確認這台裝置是否已安裝 RawBT App。",
      alarmTitle: "🔔 新訂單提示音",
      alarmHint: "新訂單進來時發出的聲音。只影響這台電腦/平板，不會影響其他人的畫面。",
      alarmStopBtn: "🔕 停止提示音",
      alarmPreviewStopBtn: "■ 停止",
      alarmToneShortLabel: "短提示音",
      alarmRepeatLabel: "短提示音要響幾次？",
      alarmRepeat1: "1 次",
      alarmRepeat2: "2 次",
      alarmRepeat3: "3 次",
      alarmRepeat5: "5 次",
      alarmToneLongLabel: "長鈴聲",
      alarmToneLongHint: "長鈴聲本身就是一段 3~4 秒的旋律，不會重複，只響一次，所以不會像同一個聲音重複響那樣被誤認成多筆訂單。響鈴期間可用「即時訂單」畫面上方的「🔕 停止提示音」立即停止。",
      alarmToneMusicbox: "音樂盒",
      alarmToneChimeLong: "門鈴鐘聲",
      alarmToneMarimba: "馬林巴",
      alarmToneGayageum: "伽倻琴",
      alarmToneDigital: "數位鈴聲",
      alarmToneSirenLong: "長警報聲",
      alarmToneBeep: "基本嗶聲",
      alarmToneDing: "叮咚",
      alarmToneBell: "鐘聲",
      alarmToneChime: "上行三音",
      alarmToneTriple: "連響三聲",
      alarmToneAlarm: "鬧鐘",
      alarmToneSiren: "警報聲",
      alarmToneArcade: "投幣音",
      alarmVolumeLabel: "音量",
      alarmVolNormalMark: "100% 預設",
      alarmVolMaxMark: "1000% 最大",
      alarmPreviewBtn: "▶ 試聽",
      alarmResetBtn: "預設值",
      alarmSavedMsg: "✔ 已儲存",
      alarmDeviceHint: "如果裝置本身的音量是關閉的，在這裡調再大也不會有聲音。請一併調高平板/電腦的音量。",
      alarmLoudWarn: "⚠️ 超過 200% 會超出裝置喇叭的極限進行放大，聲音可能會變得粗糙。",
      uiFontScaleTitle: "畫面文字大小",
      uiFontScaleHint: "調整整個管理後台畫面的文字大小。只影響這台電腦/瀏覽器，不會影響其他人的畫面。",
      uiFontScaleResetBtn: "預設值",
      ticketFontSizesTitle: "廚房出單文字大小・粗細",
      ticketFontSizesHint:
        "可以個別調整每個項目的文字大小與粗細，右邊的預覽是實際列印大小。只影響瀏覽器列印（預覽列印），不影響 ESC/POS 直接列印 — 因為印表機本身的字型無法這樣細部調整。",
      tfsStoreName: "店名（標題）",
      tfsTableNo: "桌號",
      tfsOrderTypeBadge: "訂單類型（內用/外帶）標籤",
      tfsTime: "點餐時間",
      tfsItemName: "菜品名稱",
      tfsItemDetail: "細項（└ 肉類/辣度）",
      tfsItemTakeout: "單品外帶標示（└ 外帶）",
      tfsItemPrice: "結帳單金額顯示（└ NT$）",
      tfsTotal: "合計",
      tfsOrderNote: "結帳單下方提示文字（※...）",
      tfsPrintTime: "列印時間",
      tfsSizeColLabel: "大小",
      tfsWeightColLabel: "粗細",
      tfsPreviewKitchenBtn: "廚房用",
      tfsPreviewPriceBtn: "結帳用（金額）",
      ticketFontSavedMsg: "已儲存",
      ticketFontResetBtn: "恢復預設值",
      staffPasswordLabel: "重設員工登入密碼（至少 6 碼）",
      staffPasswordIsSet: "已設定員工密碼。",
      staffPasswordNotSet: "尚未設定 — 設定前員工無法登入。",
      staffPasswordSaveBtn: "儲存員工密碼",
      staffPermSaved: "已儲存",
      staffPasswordSaved: "員工密碼已變更",
      staffPasswordTooShort: "請輸入至少 6 碼",
      staffPasswordFailed: "儲存失敗，請再試一次",
      loginAsStaffBadge: "以員工帳號登入",
      loginAsOwnerBadge: "以老闆帳號登入",
      permissionDeniedMsg: "這項操作需要老闆的授權，請洽詢老闆。",
    },
  };
  const T = (key) => (ADMIN_I18N[adminLang] && ADMIN_I18N[adminLang][key]) || ADMIN_I18N.ko[key] || key;
  // Menu item/category names are stored bilingually per-record already
  // (name_ko/name_zh) — show whichever matches the current admin language.
  const itemName = (item) => (adminLang === "zh" ? item.name_zh || item.name_ko : item.name_ko || item.name_zh);
  const catName = (cat) => (adminLang === "zh" ? cat.name_zh || cat.name_ko : cat.name_ko || cat.name_zh);
  // A few messages interpolate a count/name in a spot whose word order
  // differs between Korean and Chinese, so these are built directly per
  // language rather than through the flat T() dictionary above.
  const fmtOrderCount = (n, total) => (adminLang === "zh" ? `${n} 筆訂單 · NT$${total}` : `주문 ${n}건 · NT$${total}`);

  /**
   * 인원수를 어른(大)/아이(小)까지 적는다 — 2026-09-10 사장님: "인원수 물을 때
   * 어른(大), 아이(小) 묻기".
   *
   * 大/小 는 두 언어에서 똑같이 쓴다. 메뉴판과 빌지에 찍히는 글자가 그거라서,
   * 관리자 화면에서만 「어른/아이」로 부르면 홀에서 말이 어긋난다.
   *
   * 아이가 없으면 총원만 적는다. 「4인 (大4·小0)」 은 읽는 사람에게 아무것도
   * 더 알려주지 않으면서 자리 배지만 길어지게 한다.
   * 구분이 생기기 전에 앉은 손님(party_adults 가 없음)도 총원만 적는다 —
   * 그때는 어른/아이를 물어본 적이 없으므로 「大4」 는 사실이 아니다.
   */
  /** 자리 이동 빌지의 인원 줄 — escpos.js 의 같은 자리와 모양을 맞춘다. */
  function moveSlipPartyText(info) {
    if (!info || !info.partySize) return "";
    // 좌석번호 옆 표기와 같은 「(어른-아이)」 를 쓴다(2026-09-10 "자리도 통일").
    // 여기는 「인원 / 人數」 라는 이름표가 앞에 있으므로 총원을 먼저 적는다.
    if (info.partyAdults == null) return String(info.partySize);
    return `${info.partySize} (${info.partyAdults}-${info.partyChildren || 0})`;
  }

  /**
   * 좌석번호 옆에 붙는 인원 — 「(3-2)」 는 어른 3, 아이 2 라는 뜻이다.
   *
   * 2026-09-10 사장님: "주문서 및 화면의 좌석번호 옆에 괄호넣고 인원수 나오게;
   * 좌석번호 (3-2) 3명어른2명아이 뜻임".
   *
   * 아이가 0명이어도 (3-0) 으로 적는다. 자리가 늘 두 칸이어야 앞의 숫자를
   * 어른으로 읽는다 — 어떤 표는 (3), 어떤 표는 (3-2) 이면 3이 총원인지
   * 어른인지 볼 때마다 헷갈리고, 그 헷갈림은 주방에서 밥 공기 수로 나온다.
   *
   * 어른/아이를 물어본 적이 없는 손님(party_adults 가 없음 — 구분이 생기기
   * 전에 앉은 손님)은 총원만 「(4)」. 그때 「(4-0)」 이라고 적으면 아이가 없다고
   * 말하는 셈인데, 우리는 물어본 적이 없다.
   *
   * 같은 규칙이 escpos.js 에도 있다(브라우저용 순수 함수라 이 파일을 못
   * 부른다). test/party-tag.test.js 가 둘이 글자 하나까지 같은지 잰다.
   */
  function partyTag(o) {
    if (!o || !o.party_size) return "";
    if (o.party_adults == null) return ` (${o.party_size})`;
    return ` (${o.party_adults}-${o.party_children || 0})`;
  }

  /**
   * 좌석번호가 바로 옆(또는 바로 위)에 있는 자리 — 「(3-2)」 만 적는다.
   * 자리 칩, 배치도 타일처럼 숫자 밑에 붙는 곳이 여기다.
   *
   * 2026-09-10 사장님: "자리도 통일시켜줘" — 주문서·주문 카드가 (3-2) 인데
   * 자리 배지만 「👥3+1」, 「👥5인 (大3·小1)」 이면 같은 사실을 세 가지로
   * 적는 셈이고, 홀에서 부르는 말이 사람마다 달라진다.
   */
  function fmtPartySeat(o) {
    return partyTag(o).trim();
  }

  /**
   * 좌석번호가 옆에 없는 자리(결산 주문 상세의 「현금 · … · …」 줄) —
   * 숫자는 같고 사람 표시만 앞에 붙인다. 거기서 「(3-2)」 만 있으면 무엇의
   * 3인지 알 수 없다.
   */
  function fmtPartyDetail(o) {
    const tag = fmtPartySeat(o);
    return tag ? `👥 ${tag}` : "";
  }

  // ---------- 품절 기간 표시 ----------
  // 사장님(2026-09-09): "당일 품절이라서 다음날 자동으로 품절 풀어지게...
  // 품절 기간을 정할 수 있게도 하자."
  //
  // 표에서 「품절」만 보이면 이게 오늘까지인지 계속인지 알 수 없어서, 결국
  // 하나씩 열어봐야 한다. 배지 옆에 언제까지인지 같이 적는다.
  const md = (d) => {
    const [, m, day] = String(d).split("-");
    return adminLang === "zh" ? `${parseInt(m, 10)}/${parseInt(day, 10)}` : `${parseInt(m, 10)}월 ${parseInt(day, 10)}일`;
  };
  const todayStr = () => {
    // 대만 기준 오늘 — 서버(src/time.js)와 같은 기준이어야 「오늘만」이
    // 화면과 서버에서 같은 날을 가리킨다.
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return p;
  };
  /** 저장된 상태에서 네 가지 모드 중 무엇인지 되짚는다. */
  function soldOutModeOf(item) {
    if (!item.available_stored) return "always";
    if (item.soldout_from || item.soldout_until) {
      const t = todayStr();
      if (item.soldout_from === t && item.soldout_until === t) return "today";
      return "range";
    }
    return "on_sale";
  }
  /** 배지에 적을 짧은 설명. 판매 중이면 빈 문자열. */
  // 설정 화면 밑줄 — 지금 몇 시에 풀리는지 말로 적어준다. 칸이 비어 있으면
  // 「영업 시작을 따른다」는 뜻인데, 그게 몇 시인지는 다른 카드에 있어서
  // 여기서 한 번 더 말해주지 않으면 알 수가 없다.
  function renderSoldOutReleaseNote(s) {
    const el = $("#soldOutReleaseEffective");
    if (!el) return;
    const picked = (s && s.soldout_release_time) || "";
    if (picked) {
      el.textContent = T("soldOutReleaseFixed").replace("{t}", picked);
      return;
    }
    // 영업 시작 시각은 「영업시간」 문구에서 읽는다 — 서버의
    // src/availability.js openingTime() 과 같은 규칙이다.
    const m = /(\d{1,2}):(\d{2})/.exec((s && s.store_hours) || "");
    const t = m ? `${String(parseInt(m[1], 10)).padStart(2, "0")}:${m[2]}` : "11:00";
    el.textContent = T("soldOutReleaseFollowsHours").replace("{t}", t);
  }

  // 이 카드만 저장한다. PUT /api/settings 는 보낸 칸만 바꾸므로, 다른 설정을
  // 건드리지 않는다.
  // 시각을 한 번 넣으면 <input type="time"> 은 다시 비우기가 어렵다 — 가게
  // 태블릿에서는 방법이 아예 없다시피 하다 (2026-09-11 사장님: "시간 넣었다가
  // 변경하려고 할 때 방법이 없어서"). 비우는 것이 곧 기본값(영업 시작)이다.
  const soldOutReleaseResetBtn = $("#soldOutReleaseResetBtn");
  if (soldOutReleaseResetBtn) {
    soldOutReleaseResetBtn.onclick = () => {
      $("#s_soldout_release_time").value = "";
      // 비우는 것만으로는 아직 저장이 아니다. 눌러야 한다는 것을 말해준다.
      markSettingDirty("saveSoldOutReleaseBtn", true);
    };
  }
  const soldOutReleaseInput = $("#s_soldout_release_time");
  if (soldOutReleaseInput) {
    soldOutReleaseInput.onchange = () => markSettingDirty("saveSoldOutReleaseBtn", true);
  }

  const saveSoldOutReleaseBtn = $("#saveSoldOutReleaseBtn");
  if (saveSoldOutReleaseBtn) {
    saveSoldOutReleaseBtn.onclick = async () => {
      const value = $("#s_soldout_release_time").value.trim();
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // 빈 문자열도 보낸다 — 「비웠다」가 「영업 시작을 따른다」는 뜻이다.
        body: JSON.stringify({ soldout_release_time: value }),
      });
      const s = await res.json().catch(() => null);
      if (s) {
        // 서버가 이상한 값을 거른다. 거기서 돌아온 값으로 칸을 다시 맞춘다 —
        // 안 그러면 안 저장된 값이 칸에 남아 저장된 것처럼 보인다.
        $("#s_soldout_release_time").value = s.soldout_release_time || "";
        renderSoldOutReleaseNote(s);
      }
      // 품절 배지의 「언제 풀림」도 이 시각을 쓴다. 같이 새로 불러온다.
      await loadMenu().catch(() => {});
      flashSettingSaved("soldOutReleaseMsg", "saveSoldOutReleaseBtn");
    };
  }

  // 「9/11 11:00 풀림」. 서버가 계산해 보낸 시각(soldout_release_at)을 그대로
  // 적는다 — 규칙을 화면에도 적어두면 언젠가 한쪽만 고쳐진다.
  //
  // 2026-09-11 사장님: "이거 품절 10일까지였는데 오늘 11일인데 안 풀렸어."
  // 배지가 「9/10 ~ 9/10」만 보여주니 11일 아침엔 당연히 풀렸어야 한다고
  // 읽힌다. 실제로는 그날 영업 시작에 풀리는데, 그 말이 어디에도 없었다.
  function soldOutReleaseNote(item) {
    const at = item && item.soldout_release_at;
    if (!at || typeof at !== "string" || at.length < 16) return "";
    return T("soldOutReleasesAt").replace("{d}", md(at.slice(0, 10))).replace("{t}", at.slice(11, 16));
  }

  function soldOutNote(item) {
    const mode = soldOutModeOf(item);
    if (mode === "on_sale") return "";
    if (mode === "always") return T("soldOutAlways");
    if (mode === "today") return T("soldOutToday");
    if (item.soldout_from && item.soldout_until) return `${md(item.soldout_from)} ~ ${md(item.soldout_until)}`;
    if (item.soldout_until) return adminLang === "zh" ? `售完至 ${md(item.soldout_until)}` : `${md(item.soldout_until)}까지`;
    return adminLang === "zh" ? `${md(item.soldout_from)} 起` : `${md(item.soldout_from)}부터`;
  }

  // 메뉴 수정 폼 안의 품절 선택 상태. 폼은 한 번에 하나만 열리므로
  // 모듈 하나짜리 값으로 충분하다.
  let itemFormSoldOutMode = "on_sale";
  function paintItemFormSoldOut() {
    // 날짜도 한 번 넣으면 다시 비우기가 어렵다 — 시각과 같은 문제다.
  // 「비우면 오늘부터 / 비우면 직접 풀 때까지」가 각 칸의 기본값이다.
  [
    ["#soldOutFromClearBtn", "#f_soldout_from"],
    ["#soldOutUntilClearBtn", "#f_soldout_until"],
    ["#soldOutModalFromClearBtn", "#soldOutFrom"],
    ["#soldOutModalUntilClearBtn", "#soldOutUntil"],
  ].forEach(([btnSel, inputSel]) => {
    const btn = $(btnSel);
    if (btn) btn.onclick = () => { const el = $(inputSel); if (el) el.value = ""; };
  });

  document.querySelectorAll("#f_soldout_modes .soldout-mode").forEach((b) => {
      b.classList.toggle("on", b.dataset.mode === itemFormSoldOutMode);
    });
    $("#f_soldout_range").hidden = itemFormSoldOutMode !== "range";
  }
  document.querySelectorAll("#f_soldout_modes .soldout-mode").forEach((b) => {
    b.onclick = () => {
      itemFormSoldOutMode = b.dataset.mode;
      if (itemFormSoldOutMode === "range" && !$("#f_soldout_from").value && !$("#f_soldout_until").value) {
        $("#f_soldout_from").value = todayStr();
      }
      paintItemFormSoldOut();
    };
  });

  // 품절 설정 팝업. 배지를 누르면 열리고, 네 가지 중 하나를 고른 뒤 확인을
  // 누르면 서버가 available 과 날짜 두 개로 편다(src/routes/menu.js의
  // applySoldOut) — 화면과 서버가 각자 규칙을 갖지 않도록.
  function openSoldOutModal(item) {
    const backdrop = $("#soldOutBackdrop");
    const rangeFields = $("#soldOutRangeFields");
    const errorEl = $("#soldOutError");
    const fromEl = $("#soldOutFrom");
    const untilEl = $("#soldOutUntil");
    let mode = soldOutModeOf(item);

    $("#soldOutItemName").textContent = `${item.code ? item.code + " " : ""}${itemName(item)}`;
    fromEl.value = item.soldout_from || "";
    untilEl.value = item.soldout_until || "";
    errorEl.hidden = true;

    const paint = () => {
      backdrop.querySelectorAll(".soldout-mode").forEach((b) => {
        b.classList.toggle("on", b.dataset.mode === mode);
      });
      rangeFields.hidden = mode !== "range";
      errorEl.hidden = true;
    };
    backdrop.querySelectorAll(".soldout-mode").forEach((b) => {
      b.onclick = () => {
        mode = b.dataset.mode;
        // 「기간 지정」으로 옮겨왔는데 칸이 비어 있으면 오늘을 넣어둔다 —
        // 빈 칸 두 개를 마주하는 것보다 고칠 것이 있는 편이 빠르다.
        if (mode === "range" && !fromEl.value && !untilEl.value) fromEl.value = todayStr();
        paint();
      };
    });
    paint();

    const close = () => {
      backdrop.hidden = true;
      $("#soldOutCancel").onclick = null;
      $("#soldOutSave").onclick = null;
    };
    $("#soldOutCancel").onclick = close;
    $("#soldOutSave").onclick = async () => {
      const from = mode === "range" ? fromEl.value || null : null;
      const until = mode === "range" ? untilEl.value || null : null;
      if (mode === "range") {
        if (!from && !until) {
          errorEl.textContent = T("soldOutRangeEmpty");
          errorEl.hidden = false;
          return;
        }
        if (from && until && until < from) {
          errorEl.textContent = T("soldOutRangeInvalid");
          errorEl.hidden = false;
          return;
        }
      }
      $("#soldOutSave").disabled = true;
      try {
        const res = await fetch(`/api/menu/admin/items/${item.id}/soldout`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, from, until }),
        });
        if (!res.ok) throw new Error("failed");
        close();
        await loadMenu();
      } catch (e) {
        errorEl.textContent = T("soldOutSaveFailed");
        errorEl.hidden = false;
      } finally {
        $("#soldOutSave").disabled = false;
      }
    };
    backdrop.hidden = false;
  }
  // spice_options (and an order line's saved spice_choice) are stored as raw
  // Chinese text — same convention as options ("牛,豬") — which reads fine on
  // the kitchen ticket (always Chinese, see buildTicketHtml's file comment)
  // but looked wrong to the owner in the 주문 수정 modal, a Korean-language
  // screen (2026-09 피드백). This only relabels the *display* text for a
  // known set of values; the underlying value saved/matched against the menu
  // item's spice_options is always left untouched. Any spice text an admin
  // types into 메뉴 관리 that isn't in this map just shows as-is in both
  // languages, so nothing can "disappear" from an unrecognized value.
  const SPICE_LABELS = {
    "基本": "기본", "不辣": "안 맵게", "小辣": "약간 맵게",
    "中辣": "중간 맵게", "大辣": "많이 맵게", "辣": "맵게",
  };
  const spiceLabel = (raw) => (adminLang === "ko" && SPICE_LABELS[raw]) || raw;
  // Same relabel-only-the-display pattern as SPICE_LABELS above, for the
  // option_choice values used across the menu (options: "牛,豬" for
  // meat-choice dishes, "鮪魚,蝦仁" for 오므라이스) — the owner pointed out
  // the admin dashboard was still showing raw Chinese option text even with
  // 한국어 selected, e.g. an order card reading "x1(牛)" (2026-09 피드백:
  // "언어가 한국어나 중국어로 세팅되면 모든 보이는 언어가 다 그걸로
  // 적용되어야 해"). Same fallback as spiceLabel: an option value not in
  // this map (or 中文 mode) just shows as-is.
  const OPTION_LABELS = { "牛": "소", "豬": "돼지", "鮪魚": "참치", "蝦仁": "새우" };
  // 牛/豬 (beef/pork) face icons — see optionLabel()/optionIconHtml() in
  // order.js for the full rationale. Two different helpers, deliberately:
  // optionIconHtml() (the cropped PDF image) is only for an at-a-glance
  // badge next to a dish's NAME; optionLabel() (plain text, now localized
  // via OPTION_LABELS same as spiceLabel) is for the actual option
  // pills/badges/order-card text a staff member picks from or reads as the
  // recorded choice — the owner asked those stay text, not images, since a
  // control you're actively selecting needs to read unambiguously ("사진은
  // 간단히 확인하라고 있는거고 선택해서 하는 건 확실하게 글로 해야 돼").
  const OPTION_ICONS = { "牛": "cow-face.png", "豬": "pig-face.png" };
  const optionIconHtml = (raw) =>
    OPTION_ICONS[raw] ? `<img class="option-icon" src="/images/${OPTION_ICONS[raw]}" alt="${raw}">` : "";
  const optionLabel = (raw) => (adminLang === "ko" && OPTION_LABELS[raw]) || raw;
  // 냉면/비빔냉면(28/29) — see BEEF_BROTH_ICON_CODES in order.js for the
  // full rationale (originally a 🐄 baked into the name, pulled back out by
  // the 2026-09-followup migration for rendering as a side-view dairy cow).
  const BEEF_BROTH_ICON_CODES = ["28", "29"];
  // Same 牛/豬 (+ 냉면/비빔냉면) icon(s) shown next to a dish's name anywhere
  // admin displays it standalone (order-edit item rows, the add-item picker
  // panel) — matches the customer order page's menu list/item sheet, so a
  // dish's meat-choice is visible wherever its name shows, not just inside
  // its own option picker (2026-09 피드백: "메뉴에 표시되는 동물 사진에
  // 넣어달라는 거였어").
  const meatIconsHtml = (mi) => {
    if (!mi) return "";
    const icons = (mi.options || "")
      .split(",")
      .map((o) => o.trim())
      .filter((o) => OPTION_ICONS[o])
      .map((o) => optionIconHtml(o));
    if (BEEF_BROTH_ICON_CODES.includes(mi.code)) icons.push(optionIconHtml("牛"));
    return icons.length ? `<span class="item-meat-icons">${icons.join("")}</span>` : "";
  };
  // 포장 카운터 orders carry their own pickup_number/customer_name (assigned
  // server-side in src/routes/orders.js) instead of a table number — this is
  // what staff actually call out at pickup, so every place that would
  // otherwise show "테이블 COUNTER" shows this instead. Falls back to the
  // counter's generic label for an order placed before this feature existed
  // (no pickup_number/customer_name stored on it yet).
  function isCounterOrder(o) {
    return tables.some((t) => t.is_counter && t.number === o.table_number);
  }
  function fmtCounterOrderTag(o) {
    if (o.pickup_number && o.customer_name) {
      return adminLang === "zh" ? `📦 ${o.pickup_number}號 · ${o.customer_name}` : `📦 ${o.pickup_number}번 · ${o.customer_name}`;
    }
    const counterTable = tables.find((t) => t.is_counter);
    return (counterTable && counterTable.label) || T("counterSectionTitle");
  }
  // 결제탭에서 "완전 포장"(order_type === "takeout") 주문 타일에 붙이는
  // 태그 — 포장 카운터 주문은 기존 픽업번호·이름 태그를 그대로 쓰고, 진짜
  // 테이블에서 통째로 포장으로 주문한 경우(픽업번호가 없음)는 그 테이블의
  // 다른 주문과 구분되도록 "📦 포장" 배지만 보여준다.
  function fmtTakeoutTileTag(t, o) {
    if (t && t.is_counter) return fmtCounterOrderTag(o);
    return `📦 ${T("orderCardTakeoutBadge")}`;
  }
  const fmtPrintFailBanner = (n, places, reasons) => {
    const where = (places || []).join(", ");
    const why = (reasons || []).length ? (adminLang === "zh" ? `｜原因：${reasons.join(" / ")}` : `｜원인: ${reasons.join(" / ")}`) : "";
    return adminLang === "zh"
      ? `⚠️ ${n} 張出單沒印出來 — ${where}${why}。請確認廚房收到，或按該筆訂單的「列印」重新送出。`
      : `⚠️ 빌지 ${n}건이 안 나갔어요 — ${where}${why}. 주방에 전달됐는지 확인하거나, 그 주문의 "인쇄" 버튼으로 다시 보내주세요.`;
  };
  const fmtPrintFailCard = (place, id, reason) => {
    const why = reason ? (adminLang === "zh" ? `（${reason}）` : ` (${reason})`) : "";
    return adminLang === "zh"
      ? `⚠️ ${place} #${id} 列印失敗${why} — 請確認廚房是否收到，或用下方列印按鈕重試`
      : `⚠️ ${place} #${id} 인쇄 실패${why} — 주방에 전달됐는지 확인, 아래 인쇄 버튼으로 재시도`;
  };
  const fmtConfirmDeleteTable = (n) => (adminLang === "zh" ? `確定要刪除桌號 ${n} 嗎？` : `테이블 ${n}을(를) 삭제하시겠습니까?`);
  // 사장님 피드백(2026-09-05): "부분 결제를 허용해줘. 체크체크 해서
  // 그것만 결제완료 할 수 있게" → "선택이 주문별이 아니라 메뉴별이야" —
  // 메뉴 품목 일부만(또는 "전체 선택"으로 전부) 체크해서 결제할 때
  // 확인 문구. "체크한 품목 n개"라고 명시한다 — 2026-09-06 피드백으로
  // 이제 이 문구 하나가 부분/전체 결제 모두를 대신한다(전체 결제
  // 완료라는 별도 문구는 없앰).
  const fmtConfirmPaySelected = (label, n, total) =>
    adminLang === "zh"
      ? `確定要將桌號 ${label} 勾選的 ${n} 項品項（合計 NT$${total}）標記為已結帳嗎？（其餘品項不受影響）`
      : `테이블 ${label}에서 체크한 품목 ${n}개(합계 NT$${total})만 결제 완료로 처리하시겠습니까? (나머지는 그대로 유지됩니다)`;
  // 特約95折/VIP9折 — 사장님이 직접 부른 명칭 그대로(한자/영문 혼용)라
  // 관리자 언어(ko/zh)와 무관하게 항상 같은 문구로 보여준다. 서버 쪽
  // src/routes/orders.js의 VIP_DISCOUNT_RATES와 정확히 같은 값이어야 한다.
  const VIP_DISCOUNT_LABELS = { te95: "特約95折", vip9: "VIP9折" };
  const VIP_DISCOUNT_RATES_CLIENT = { te95: 0.95, vip9: 0.9 };
  // "할인은 현금만"은 特約95折/VIP9折 물리 카드 프로그램 고유 규칙이다 —
  // 직접 입력(재량) 할인은 결제수단 제한이 없다(위 payment-discount-rules
  // 참고, src/routes/orders.js의 discountRequiresCash와 동일 조건).
  const discountRequiresCashOnly = (discountType) => discountType === "te95" || discountType === "vip9";
  // 결제자 재량 할인("직접 입력") 버튼에 지금 값을 보여주기 위한 라벨 —
  // 값이 없으면 안내 문구, 있으면 "직접 10%"/"직접 NT$100" 형태.
  function fmtManualDiscountLabel(manualValue) {
    if (!manualValue) return adminLang === "zh" ? "自訂折扣" : "직접 입력";
    return manualValue.mode === "percent"
      ? adminLang === "zh"
        ? `自訂 ${manualValue.value}%`
        : `직접 ${manualValue.value}%`
      : adminLang === "zh"
      ? `自訂 NT$${manualValue.value}`
      : `직접 NT$${manualValue.value}`;
  }
  // 결제 방식 팝업(showPaymentMethodPopup)에 보여줄 한 줄 요약 — 실제
  // 반영 금액은 항상 서버가 다시 계산해서 저장하므로(아래
  // discountEligibleClientTotal 주석 참고) 이건 미리보기용. manualValue는
  // manualValue는 재량 할인이 걸려 있을 때만 쓰이며, 特約95折/VIP9折와 달리
  // 음료·주류를 제외하지 않으므로 그 문구를 붙이지 않는다(위
  // src/routes/orders.js의 fullEligibleTotal 참고).
  //
  // 사장님 요청(2026-09-10)으로 特約95折/VIP9折와 직접 입력을 같이 걸 수
  // 있게 되면서, 둘 다 걸렸을 때는 화살표를 한 칸 더 이어 붙여 어느 쪽이
  // 얼마를 깎았는지 순서대로 보여준다 — "VIP 할인 뒤 잔돈 2원을 재량으로
  // 뗀다"는 게 원래 목적이라, 직원이 팝업에서 그 2원이 실제로 빠졌는지
  // 눈으로 확인할 수 있어야 한다. breakdown은 computeCombinedDiscountClient
  // 의 결과({ vipAmount, manualAmount, total }).
  function fmtPaymentSummary(total, discountType, manualValue, breakdown) {
    const zh = adminLang === "zh";
    const head = zh ? `本次結帳合計 NT$${total}` : `이번 결제 합계 NT$${total}`;
    if (!discountType && !manualValue) return head;
    const steps = [];
    if (discountType && breakdown.vipAmount) {
      const label = VIP_DISCOUNT_LABELS[discountType] || "";
      steps.push(
        zh
          ? `${label}折扣 -NT$${breakdown.vipAmount}（飲料、酒類不適用）`
          : `${label} 할인 -NT$${breakdown.vipAmount} (음료·주류 제외)`
      );
    }
    if (manualValue && breakdown.manualAmount) {
      const label = fmtManualDiscountLabel(manualValue);
      steps.push(zh ? `${label}折扣 -NT$${breakdown.manualAmount}` : `${label} 할인 -NT$${breakdown.manualAmount}`);
    }
    const payable = total - breakdown.total;
    const tail = zh ? `實收 NT$${payable}` : `실수령 NT$${payable}`;
    return [head, ...steps, tail].join(" → ");
  }
  // 밥값과 VIP 카드값을 갈라 보여준다. 고르는 결제수단은 밥값 것이고
  // 카드값은 언제나 현금이다 — 그 사실을 고르기 전에 읽어야 한다.
  function fmtPaymentVipCardPart(foodPayable, cardAmount) {
    const zh = adminLang === "zh";
    const sum = foodPayable + cardAmount;
    return zh
      ? `\n\n＋ VIP卡 NT$${cardAmount}（一律現金）\n= 向客人收 NT$${sum}\n下面選的付款方式只套用在餐點 NT$${foodPayable}`
      : `\n\n＋ VIP 카드 NT$${cardAmount} (무조건 현금)\n= 손님께 받을 돈 NT$${sum}\n아래에서 고르는 결제수단은 밥값 NT$${foodPayable}에만 적용됩니다`;
  }
  // 금액 한 줄 표기. **모듈 자리에 둔다.**
  //
  // 2026-09-10: 이게 renderSettlement 안의 지역 함수였다. 결산 화면의
  // 오전/오후 칸은 그 바깥에 있어서 「nt is not defined」로 죽었고, 그 뒤의
  // 렌더가 통째로 멈췄다 — 사장님 화면에서 1인당 평균부터 아래가 전부 0 으로
  // 보인 이유가 이것이다. 여러 곳에서 쓰는 도우미는 쓰는 곳들이 다 보이는
  // 자리에 있어야 한다.
  const nt = (v) => `NT$${Number(v || 0).toLocaleString()}`;

  // 지금 어느 시간대만 보고 있나. null 이면 하루 전체(합산)다.
  //
  // 사장님(2026-09-10): "오전, 오후 정산을 클릭해서 해당 내용을 볼 수
  // 있으면 좋겠어. 현재는 Total 내용만 보여지는데, Shift 별로 클릭하면 해당
  // Shift만 볼 수 있으면 더 디테일할거야."
  //
  // 거르는 일은 **서버가 한다**(GET /api/settlements?shift=am). 화면에서
  // 거르면 결제수단·분류별·시간대·테이블별·차트를 하나하나 걸러야 하고,
  // 언젠가 하나를 빠뜨린다 — 빠뜨린 그 칸만 조용히 하루치를 보여준다.
  let settlementShift = null;

  // 같은 칸을 다시 누르면 합산으로 돌아온다. 「돌아가는 길」이 누르던 그
  // 자리에 있어야 헤매지 않는다 — 위의 「합산 보기」 버튼은 그걸 못 찾은
  // 분을 위한 두 번째 길이다.
  function toggleSettlementShift(which) {
    settlementShift = settlementShift === which ? null : which;
    loadSettlement($("#settlementStartDate").value, $("#settlementEndDate").value);
  }

  // 오전 / 오후 (2026-09-10 사장님 요청). 위의 큰 숫자가 합산이고 이 두 칸이
  // 그것을 가른 것이다 — 색으로 갈라 두고(css .stl-half-am/.stl-half-pm),
  // 합산에는 「합산」 표를 붙인다.
  function renderSettlementHalves(data) {
    // 이 칸 하나 때문에 결산 화면 전체가 멈추면 안 된다.
    //
    // 2026-09-10 사장님: "근데 지금 데이터가 싹다 날라간 것 같은데?" —
    // 매출·손님 수는 멀쩡히 떠 있는데 그 아래가 전부 0 이었다. 데이터가
    // 사라진 게 아니라 여기서 예외가 나서 **그 뒤의 렌더가 통째로 멈춘**
    // 것이었다. 1인당 평균도, 결제수단도, 분류별 매출도 전부 그 뒤에 있다.
    //
    // 곁가지 하나가 본체를 끌고 내려가지 않게 통째로 감싼다. 여기서 무슨
    // 일이 나든 나머지는 그려져야 한다.
    try {
      renderSettlementHalvesInner(data);
    } catch (e) {
      console.warn("오전/오후 칸을 그리지 못했습니다:", e);
      const box = $("#settlementHalves");
      if (box) box.hidden = true;
      const badge = $("#settlementTotalBadge");
      if (badge) badge.hidden = true;
    }
  }

  function renderSettlementHalvesInner(data) {
    const box = $("#settlementHalves");
    if (!box) return;
    const half = data && data.half_split;
    const badge = $("#settlementTotalBadge");
    // 가를 기준이 아예 없으면(오전 정산도 안 눌렀고 영업시간도 한 타임뿐)
    // 두 칸을 통째로 감춘다. 0 만 적힌 칸을 보여주면 그날 오전 매출이
    // 정말 0 인 줄 안다.
    // 옛 날짜의 저장된 정산 기록에는 이 칸이 아예 없다(그때는 없던 기능이다).
    // 한 쪽만 있는 경우도 없다고 본다 — 반쪽짜리를 그리면 그게 더 헷갈린다.
    const am = half && half.am;
    const pm = half && half.pm;
    const usable = !!am && !!pm && ((am.paid_order_count || 0) > 0 || (pm.paid_order_count || 0) > 0);
    box.hidden = !usable;
    if (badge) badge.hidden = !usable;
    const noteEl = $("#settlementHalvesNote");
    if (noteEl) noteEl.hidden = true;

    // 가를 수 없을 때 아무 말도 안 하면, 사장님은 「오전 오후가 사라졌네」로
    // 보게 된다(2026-09-10 실제로 그랬다). 칸은 감추되 왜 없는지는 적는다.
    if (!usable) {
      // 가를 수 없으면 「오전만 보기」도 없다. 상태만 남겨두면 다음 날짜로
      // 옮겼을 때 아무것도 없는 화면이 뜬다.
      settlementShift = null;
      box.classList.remove("has-shift");
      const un = ((half && half.unsplit_dates) || []).length;
      if (un > 0 && noteEl) {
        noteEl.textContent = T("settlementHalvesNone").replace("{amt}", nt((half && half.unsplit_revenue) || 0));
        noteEl.hidden = false;
      }
      return;
    }

    const put = (id, text) => {
      const el = $(id);
      if (el) el.textContent = text;
    };
    const fill = (side, part) => {
      const g = Number(part.guest_count || 0);
      const kids = Number(part.child_count || 0);
      put(`#settlement${side}Revenue`, nt(part.revenue || 0));
      put(`#settlement${side}Orders`, `${Number(part.paid_order_count || 0).toLocaleString()}${T("settlementHalfOrdersUnit")}`);
      put(`#settlement${side}Guests`, kids > 0 ? `${g} (${fmtGuestSplit(Number(part.adult_count || 0), kids)})` : String(g));
      put(`#settlement${side}PerGuest`, nt(part.avg_per_guest || 0));
      put(`#settlement${side}PerOrder`, nt(part.avg_per_order || 0));
    };
    fill("Am", am);
    fill("Pm", pm);

    // 지금 고른 칸을 눈에 남긴다. 고른 표시가 약하면 아래 숫자가 왜
    // 작아졌는지 모른 채로 보게 된다.
    const active = data && data.shift === "am" ? "am" : data && data.shift === "pm" ? "pm" : null;
    box.classList.toggle("has-shift", !!active);
    const markBox = (side, key) => {
      const el = $(`#settlement${side}Box`);
      if (!el) return;
      const on = active === key;
      el.classList.toggle("is-active", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
      const cta = $(`#settlement${side}Cta`);
      if (cta) cta.textContent = on ? T("settlementShiftHintActive") : T("settlementShiftHint");
    };
    markBox("Am", "am");
    markBox("Pm", "pm");

    // 어디서 갈랐는지 적어 둔다. 안 적으면 「내 기억보다 오전이 적은데」가
    // 됐을 때 확인할 방법이 없다.
    const cut = (half && half.boundary_label) || "";
    const amRange = $("#settlementAmRange");
    const pmRange = $("#settlementPmRange");
    if (amRange) amRange.textContent = cut ? T("settlementAmUntil").replace("{t}", cut) : "";
    if (pmRange) pmRange.textContent = cut ? T("settlementPmFrom").replace("{t}", cut) : "";

    // 경계를 못 정한 날이 섞여 있으면 두 칸의 합이 위 합산과 다르다.
    // 조용히 두면 사장님이 더하다가 안 맞는 것을 발견하게 된다.
    const un = ((half && half.unsplit_dates) || []).length;
    if (un > 0 && noteEl) {
      const note = noteEl;
      note.textContent = T("settlementHalvesGap")
        .replace("{n}", String(un))
        .replace("{amt}", nt(half.unsplit_revenue || 0));
      note.hidden = false;
    }
  }

  // 큰 숫자 옆의 표. 「합산」이거나 「🌅 오전만」이거나 「🌙 오후만」이다.
  //
  // 걸러놓은 화면에서 이 표가 없으면, 사장님은 그 숫자를 하루 매출로 읽는다.
  // 그건 화면이 거짓말을 하는 것이다.
  function renderSettlementShiftBadge(data) {
    const shift = data && (data.shift === "am" || data.shift === "pm") ? data.shift : null;
    const total = $("#settlementTotalBadge");
    const badge = $("#settlementShiftBadge");
    const reset = $("#settlementShiftReset");
    const note = $("#settlementShiftNote");
    const halvesUsable = !!(data && data.half_split && data.half_split.am && data.half_split.pm);
    if (total) total.hidden = !halvesUsable || !!shift;
    if (badge) {
      badge.hidden = !shift;
      badge.className = `stl-shift-badge ${shift || ""}`.trim();
      badge.textContent = shift === "am" ? T("settlementViewingAm") : shift === "pm" ? T("settlementViewingPm") : "";
    }
    if (reset) reset.hidden = !shift;
    if (note) {
      note.hidden = !shift;
      note.textContent = shift ? T("settlementShiftNote") : "";
    }
  }

  const fmtGuestSplit = (adults, children) =>
    adminLang === "zh" ? `大人 ${adults} · 小孩 ${children}` : `어른 ${adults} · 아이 ${children}`;
  const fmtExpandItemsBtn = (n) => (adminLang === "zh" ? `展開 ▾ (還有 ${n} 項)` : `펼치기 ▾ (${n}개 더)`);
  const fmtMergePaySummary = (tableCount, orderCount, total) =>
    adminLang === "zh"
      ? `已選 ${tableCount} 桌 · ${orderCount} 筆訂單 · 合計 NT$${total}`
      : `${tableCount}개 테이블 선택 · 주문 ${orderCount}건 · 합계 NT$${total}`;
  const fmtConfirmMergePay = (tableCount, orderCount) =>
    adminLang === "zh"
      ? `確定要將這 ${tableCount} 桌、共 ${orderCount} 筆未結帳訂單合併標記為已結帳嗎？`
      : `이 ${tableCount}개 테이블의 미결제 주문 ${orderCount}건을 합산 결제 완료로 처리하시겠습니까?`;
  const fmtConfirmUnassignTable = (n) =>
    adminLang === "zh" ? `確定要將桌號 ${n} 移出此區域嗎？（桌號本身不會被刪除）` : `테이블 ${n}을(를) 이 구역에서 뺄까요? (테이블 자체는 삭제되지 않습니다)`;
  const fmtConfirmDeleteZone = (name) =>
    adminLang === "zh" ? `確定要刪除「${name}」這個區域嗎？（區域內的桌號不會被刪除，只會取消配置）` : `"${name}" 구역을 삭제하시겠습니까? (구역 안 테이블은 삭제되지 않고 배치만 풀립니다)`;
  const fmtMoveTableHint = (from) =>
    adminLang === "zh"
      ? `「${from}」這組客人的訂單會整組移過去，包含已經結帳的那幾輪 — 同一組客人。移動後會列印一張換桌單，並請提醒客人改掃新桌號的 QR code。`
      : `"${from}" 손님의 주문이 통째로 옮겨갑니다 — 이미 결제한 라운드까지, 같은 손님이니까요. 옮기면 자리 이동 빌지가 한 장 나오고, 손님은 새 자리의 QR 코드로 주문하시면 됩니다.`;
  const fmtConfirmMove = (from, to) =>
    adminLang === "zh" ? `將「${from}」的客人移到「${to}」嗎？` : `"${from}" 손님을 "${to}"으로 옮길까요?`;
  const fmtConfirmMoveMerge = (from, to) =>
    adminLang === "zh"
      ? `「${to}」已經有客人。兩桌會合併為一桌（人數相加）。要繼續嗎？`
      : `"${to}"에는 이미 손님이 있습니다. 두 자리가 한 테이블로 합쳐집니다(인원수는 더해집니다). 계속할까요?`;
  // 옮긴 뒤 한 번 더 짚어준다. 손님 폰에는 아직 옛 자리 화면이 떠 있어서,
  // 거기서 그대로 시키면 옛 자리로 들어간다.
  const fmtMovedDone = (to, moved, paid) =>
    adminLang === "zh"
      ? `已移到「${to}」（${moved} 筆${paid ? `，含已結帳 ${paid} 筆` : ""}）。請提醒客人改掃新桌號的 QR code。`
      : `"${to}"으로 옮겼습니다 (주문 ${moved}건${paid ? `, 결제 완료 ${paid}건 포함` : ""}). 손님께 새 자리의 QR 코드로 주문해달라고 알려주세요.`;
  const fmtMovedFrom = (from) => (adminLang === "zh" ? `← ${from} 移入` : `← ${from}에서`);
  const fmtOhCalTitle = (y, m) => (adminLang === "zh" ? `${y} 年 ${m} 月` : `${y}년 ${m}월`);
  const fmtDefaultZoneName = (n) => (adminLang === "zh" ? `區域 ${n}` : `구역 ${n}`);
  const fmtAddTableToZoneTitle = (name) => (adminLang === "zh" ? `新增桌號到「${name}」` : `"${name}"에 테이블 추가`);
  const fmtLocationSetStatus = (lat, lng) =>
    adminLang === "zh"
      ? `已設定店家位置（${lat}, ${lng}）— 超出此範圍將無法送出訂單。`
      : `매장 위치 설정됨 (${lat}, ${lng}) — 이 반경 밖에서는 주문이 차단됩니다.`;

  function applyAdminI18n() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.innerHTML = T(el.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.placeholder = T(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll(".admin-lang-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.adminLang === adminLang);
    });
    renderLocationStatus();
    if (storeSettings && storeSettings.store_name_zh !== undefined) renderMiniHeroPreview(storeSettings);
  }

  document.querySelectorAll(".admin-lang-btn").forEach((b) => {
    b.onclick = () => {
      adminLang = b.dataset.adminLang;
      localStorage.setItem("hgk_admin_lang", adminLang);
      applyAdminI18n();
      // Re-render everything that has its own JS-generated (non data-i18n)
      // text, so the language change takes effect immediately everywhere.
      renderOrders();
      renderTables();
      renderMenuAdmin();
      populateCategorySelect();
      if ($("#dashboard") && !$("#dashboard").hidden && !$("#floorPlanWrap").hidden) renderFloorPlan();
      if (openTableNumber) openTableDetail(openTableNumber, openTableLabel, openFocusOrderId);
      if (!$("#tab-settlement").hidden) loadSettlement($("#settlementStartDate").value, $("#settlementEndDate").value);
      if (!$("#tab-reservations").hidden) renderReservations();
      // 설정 화면 — 「주문 받는 시간」 카드와 찾기 결과도 JS 가 글자를 만든다.
      refreshOrderHoursI18n();
      updateMoveSlipPreview();
      if ($("#settingsSearch")) renderSettingsSearch($("#settingsSearch").value);
    };
  });

  // ---------- Auth ----------
  async function checkAuth() {
    const res = await fetch("/api/auth/me");
    const data = await res.json();
    if (data.isAdmin) {
      currentRole = data.role || "owner";
      staffPermissions = data.permissions || staffPermissions;
      renderStaffPasswordStatus(data.staffPasswordSet !== false);
      showDashboard();
    } else {
      showLogin();
    }
  }

  function showLogin() {
    $("#loginScreen").hidden = false;
    $("#dashboard").hidden = true;
  }

  // Hides/disables controls a staff session isn't allowed to use. The real
  // security boundary is server-side (requirePermission middleware) — this
  // is just so staff aren't shown buttons that would 403 if pressed.
  function applyRoleUI() {
    document.body.classList.toggle("role-staff", currentRole !== "owner");
    document.body.classList.toggle("perm-no-menuEdit", !canMenuEdit());
    document.body.classList.toggle("perm-no-tableEdit", !canTableEdit());
    document.body.classList.toggle("perm-no-settingsEdit", !canSettingsEdit());
    document.body.classList.toggle("perm-no-orderCancel", !canCancelOrder());
    document.body.classList.toggle("perm-no-orderEdit", !canEditOrder());
    document.body.classList.toggle("perm-no-reservationManage", !canManageReservations());
    // Staff can never see an owner-only settings category (알림/결제/인쇄)
    // — if one of those was left selected, bounce back to 화면.
    if (currentRole !== "owner") {
      const activeNav = $(".settings-nav-btn.active");
      if (activeNav && activeNav.classList.contains("owner-only")) {
        selectSettingsCategory("display");
      }
      // 사장님 전용 탭(회원·계정)이 열린 채로 직원이 로그인하면, 탭 버튼은
      // CSS 로 숨어도 **열려 있던 내용은 그대로 남는다.** 로그아웃이 화면을
      // 새로 열어주지만(위 logoutBtn), 세션이 다른 창에서 바뀌는 길도 있다 —
      // 여기서 한 번 더 되돌린다.
      const activeTab = $(".admin-tabs button.active");
      if (activeTab && OWNER_ONLY_TABS.has(activeTab.dataset.tab)) {
        activeTab.classList.remove("active");
        const ordersBtn = $('.admin-tabs button[data-tab="orders"]');
        if (ordersBtn) ordersBtn.classList.add("active");
        $$(".tab-panel").forEach((p) => (p.hidden = true));
        $("#tab-orders").hidden = false;
      }
    }
  }

  async function showDashboard() {
    $("#loginScreen").hidden = true;
    $("#dashboard").hidden = false;
    applyRoleUI();
    // 화면에 남아 있는 결산 숫자는 **이 사람의 것이 아니다.** 로그인/로그아웃이
    // 둘 다 화면을 새로 열므로 여기까지 올 일은 없지만, 오면 반드시 비운다 —
    // 「올 일이 없다」에 기대서 안 지우면, 언젠가 오는 길이 생겼을 때 조용히
    // 새어 나간다 (2026-09-11).
    blankSettlement();
    if (!$("#tab-settlement").hidden) loadSettlement();
    // loadVipSaleSettings 는 직원도 부른다 — 판매가는 결제창 버튼에 찍히는
    // 값이라 사장님만 보는 정보가 아니다(설정 카드 자체는 owner-only).
    await Promise.all([
      loadOrders(),
      loadMenu(),
      loadTables(),
      loadSettings(),
      loadTicketFontSizes(),
      loadMoveSlipSettings(),
      loadVipSaleSettings(),
      loadTestMode(),
    ]);
    // loadOrders() and loadTables() run concurrently above, so the order
    // queue's very first render can land before `tables` is populated —
    // harmless before this feature, but renderOrderCard now looks up
    // is_counter on `tables` to label 포장 카운터 orders, so re-render once
    // both are guaranteed to be in.
    renderOrders();
    // 저장 공간 경고는 로그인할 때 한 번만 본다 — 값이 하루에 한 번 갱신되는
    // 것이라 폴링에 얹을 이유가 없다.
    renderStorageBanner();
    if (currentRole === "owner") {
      loadStaffPermissions();
      loadLineSettings();
      loadPaymentSettings();
      loadEscposSettings();
    }
    await syncPrintDevice();
    // 다른 기기가 인쇄를 가져갔는지 가끔 본다. 자주 볼 이유는 없다 —
    // 사람이 토글을 누를 때나 바뀌는 값이다.
    setInterval(async () => {
      await refreshPrintDevice();
      renderPrintDeviceNote();
    }, 60000);
    startPolling();
  }

  $("#loginBtn").onclick = doLogin;
  $("#loginPassword").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLogin();
  });

  // 이 칸은 autocomplete="current-password" 라서 브라우저가 저장해둔 값을
  // 알아서 채워 넣는다. 평소에는 편한데, 저장된 값이 낡았으면 화면은
  // "비밀번호가 올바르지 않습니다" 만 반복하고 사람은 맞는 비밀번호를
  // 들고도 영영 못 들어간다 — 누를 때마다 같은 값이 다시 가기 때문이다.
  //
  // 2026-09-10 사장님이 로컬에서 막힌 게 정확히 이거였다. 서버도 DB 도
  // 멀쩡했고(스크립트로 확인), 화면이 예전에 저장된 값을 계속 보내고 있었다.
  //
  // beforeinput 은 사람이 치거나 붙여넣을 때만 오고, 브라우저 자동완성으로는
  // 오지 않는다. 그래서 이 값이 "사람이 넣은 것" 인지 구분할 수 있다.
  let typedIntoPassword = false;
  $("#loginPassword").addEventListener("beforeinput", () => {
    typedIntoPassword = true;
  });

  async function doLogin() {
    const password = $("#loginPassword").value;
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      $("#loginError").hidden = true;
      $("#loginPassword").value = "";
      typedIntoPassword = false;
      // 로그인도 **화면을 새로 열고 시작한다.**
      //
      // 사장님(2026-09-11): "그냥 앞 사람이 하던 말던 아예 막으면 안돼?"
      //
      // 로그아웃 쪽만 새로 열면, 로그아웃을 안 거치고 사람이 바뀌는 길이
      // 남는다 — 세션이 만료돼 로그인 화면으로 떨어졌을 때, 다른 창에서
      // 먼저 로그아웃했을 때, 새로고침이 중간에 끊겼을 때. 그 길로 들어온
      // 사람은 앞사람의 화면을 그대로 물려받는다.
      //
      // 들어오는 문과 나가는 문을 **둘 다** 새 화면으로 만들면, 앞사람이
      // 무엇을 하고 나갔든 물려받을 것이 없다. 지우는 코드를 늘려서 막는
      // 것보다 물려받을 수 없게 만드는 편이 빠뜨릴 구석이 없다.
      location.reload();
      return;
    } else {
      // 실패한 값은 남겨두지 않는다. 남겨두면 다음 클릭도 같은 값이다.
      const autofilled = !typedIntoPassword;
      $("#loginPassword").value = "";
      typedIntoPassword = false;
      $("#loginPassword").focus();
      $("#loginError").textContent = T(autofilled ? "loginErrorAutofill" : "loginError");
      $("#loginError").hidden = false;
    }
  }

  $("#logoutBtn").onclick = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    stopPolling();
    // 화면을 **통째로 새로 연다.** showLogin() 만 부르면 앞사람이 보던 것이
    // DOM 에 그대로 남고, 다음 사람이 로그인하면 그 화면을 그대로 물려받는다.
    //
    // 사장님(2026-09-11): "사장이 날짜 설정하는대로 같이 보는 거 같은데?
    // 지금 보면 1주일 치잖아." 서버는 직원에게 오늘 것만 내주고 있었는데,
    // 화면에는 사장님이 조금 전까지 보던 일주일치 매출이 남아 있었다 —
    // 직원이 로그인해도 아무것도 다시 불러오지 않으니 그 숫자가 그대로
    // 앉아 있었던 것이다. 새어 나간 곳은 API 가 아니라 화면이다.
    //
    // 결산만 지우는 것으로는 모자란다. 회원(VIP)·계정·이전 주문도 같은
    // 자리에 남는다. 통째로 새로 여는 것이 빠뜨릴 구석이 없다.
    location.reload();
  };

  // ---------- Tabs ----------
  // 결산은 직원도 연다 — 다만 「오늘 하루」만이다 (사장님 2026-09-11:
  // "직원이 볼 수 있는 건 결산탭에서 해당 하루만 볼 수 있게 해주고 지난
  // 정산 추이처럼 전 데이터를 읽어오는 건 직원은 못 보게 해줘"). 날짜를
  // 못 박는 일은 서버가 한다(GET /api/settlements) — 화면에서 날짜 칸을
  // 감추는 것만으로는 막은 것이 아니다.
  const OWNER_ONLY_TABS = new Set(["vip", "accounts"]);

  $$(".admin-tabs button").forEach((btn) => {
    btn.onclick = () => {
      // owner 전용 탭 — 직원 세션이 탭 버튼을 눌러도 열리지 않게. (실제
      // 데이터 차단은 서버가 하지만, 눌리는데 아무것도 안 나오는 것보다
      // 아예 안 눌리는 편이 덜 헷갈린다.)
      if (OWNER_ONLY_TABS.has(btn.dataset.tab) && currentRole !== "owner") return;
      $$(".admin-tabs button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      $$(".tab-panel").forEach((p) => (p.hidden = true));
      $(`#tab-${btn.dataset.tab}`).hidden = false;
      if (btn.dataset.tab === "settlement") loadSettlement();
      if (btn.dataset.tab === "reservations") loadReservations();
      if (btn.dataset.tab === "vip") loadVipCards();
      if (btn.dataset.tab === "accounts") loadAccounts();
      // 결제 탭(item 22) — 배치도(zones)는 "테이블 / QR 코드" 탭에서만
      // 로드되던 데이터라, 그 탭을 아직 한 번도 안 열었어도 여기서 곧장
      // 볼 수 있도록 탭 전환 시점에 로드한다. tables는 로그인 직후
      // showDashboard()에서 이미 로드/폴링되고 있어 별도 로드 불필요.
      if (btn.dataset.tab === "payment") loadZones().then(renderPaymentFloorPlan);
    };
  });

  // ---------- Settings categories (left-hand nav: 화면/매장 정보/계정/
  // 알림/결제/인쇄) ----------
  // A few of these (알림/결제/인쇄) are owner-only, hidden for staff via CSS
  // (.role-staff .owner-only) — but we also guard the click handler and
  // reset staff back to 화면 in applyRoleUI, in case a staff session ever
  // has one of them focused/selected already.
  function selectSettingsCategory(name) {
    $$(".settings-nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.category === name));
    $$(".settings-category").forEach((p) => (p.hidden = p.id !== `settings-cat-${name}`));
  }
  $$(".settings-nav-btn").forEach((btn) => {
    btn.onclick = () => {
      if (btn.classList.contains("owner-only") && currentRole !== "owner") return;
      selectSettingsCategory(btn.dataset.category);
    };
  });

  // ---------- 설정 찾기 ----------
  // 2026-09-10 사장님: "설정 안에 너무 많은 게 담겨 있어. 나누거나 뭐가
  // 어디에 있는지 알 수 있게 해줘."
  //
  // 분류를 나누는 것만으로는 부족하다. 찾는 사람은 그게 「매장 정보」에
  // 있는지 「주문 규칙」에 있는지를 모르는 채로 오기 때문이다. 그래서 카드
  // 이름뿐 아니라 그 안의 글자까지 훑어서, 어느 분류에 있는지와 함께
  // 보여주고, 누르면 거기로 데려간 뒤 그 카드를 잠깐 짚어준다.
  //
  // 목록을 미리 만들어두지 않고 찾을 때마다 화면에서 읽는다 — 카드가
  // 늘거나 언어가 바뀌어도 여기를 같이 고쳐야 할 일이 생기지 않는다.
  const SETTINGS_PERMS = ["menuEdit", "tableEdit", "settingsEdit", "orderCancel", "reservationManage"];
  function isGatedFromMe(el) {
    if (el.classList.contains("owner-only") && currentRole !== "owner") return true;
    if (el.classList.contains("staff-only") && currentRole === "owner") return true;
    return SETTINGS_PERMS.some(
      (k) => el.classList.contains(`need-${k}`) && document.body.classList.contains(`perm-no-${k}`)
    );
  }

  function settingsSearchIndex() {
    const rows = [];
    $$(".settings-category").forEach((cat) => {
      const category = cat.id.replace("settings-cat-", "");
      const navBtn = $(`.settings-nav-btn[data-category="${category}"]`);
      // 직원에게 안 보이는 분류는 찾기에도 안 나와야 한다. 눌러도 못 열고,
      // 있다는 사실만 알려주는 꼴이 된다.
      if (!navBtn || (navBtn.classList.contains("owner-only") && currentRole !== "owner")) return;
      const catName = (navBtn.querySelector(".nav-name") || navBtn).textContent.trim();
      cat.querySelectorAll(".settings-card").forEach((card) => {
        // 권한으로 가려진 카드는 찾기에도 안 나와야 한다. 안 그러면 눌러도
        // 아무것도 안 보이는 자리로 데려가게 된다. 지금 화면에 떠 있는지로
        // 판단할 수 없다 — 다른 분류의 카드는 어차피 다 숨어 있다.
        if (isGatedFromMe(card)) return;
        const h3 = card.querySelector("h3");
        if (!h3) return;
        rows.push({
          card,
          category,
          catName,
          name: h3.textContent.trim(),
          haystack: (card.textContent || "").toLowerCase(),
        });
      });
    });
    return rows;
  }

  function revealSetting(hit) {
    selectSettingsCategory(hit.category);
    hit.card.classList.remove("is-found");
    // 클래스를 뗐다 붙여야 같은 카드를 두 번 찾았을 때도 다시 반짝인다.
    void hit.card.offsetWidth;
    hit.card.classList.add("is-found");
    hit.card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderSettingsSearch(term) {
    const box = $("#settingsSearchResults");
    if (!box) return;
    const q = term.trim().toLowerCase();
    if (!q) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    const hits = settingsSearchIndex().filter(
      (r) => r.name.toLowerCase().includes(q) || r.haystack.includes(q)
    );
    box.innerHTML = "";
    if (!hits.length) {
      box.innerHTML = `<div class="settings-search-empty">${T("settingsSearchEmpty")}</div>`;
      box.hidden = false;
      return;
    }
    hits.slice(0, 12).forEach((hit) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settings-search-hit";
      btn.innerHTML = `<span class="hit-name"></span><span class="hit-cat"></span>`;
      btn.querySelector(".hit-name").textContent = hit.name;
      btn.querySelector(".hit-cat").textContent = hit.catName;
      btn.onclick = () => {
        revealSetting(hit);
        $("#settingsSearch").value = "";
        box.hidden = true;
      };
      box.appendChild(btn);
    });
    box.hidden = false;
  }

  if ($("#settingsSearch")) {
    $("#settingsSearch").addEventListener("input", (e) => renderSettingsSearch(e.target.value));
    $("#settingsSearch").addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.target.value = "";
        renderSettingsSearch("");
      }
      if (e.key === "Enter") {
        const first = $("#settingsSearchResults .settings-search-hit");
        if (first) first.click();
      }
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".settings-search")) $("#settingsSearchResults").hidden = true;
    });
  }

  // ---------- Live orders ----------
  // 2026-09-07: 4초 폴링 → 2초로 절반 단축(1차 조치) → 사장님이 "폴링 자체를
  // 없애고 싶다"고 하셔서 Pusher Channels로 실시간 push 추가(2차 조치,
  // src/realtime.js 참고). 이 프로젝트는 원래 Socket.IO로 실시간 push를
  // 했다가 Vercel 서버리스 환경(지속 연결을 못 붙잡음)에 맞추려고 폴링으로
  // 바꾼 이력이 있는데, Pusher는 그 "지속 연결을 붙잡고 있는 역할"을 대신
  // 맡아주는 관리형 서비스라 Vercel 쪽 코드는 그대로 둔 채 붙일 수 있었다.
  //
  // Pusher가 설정된 매장(loadSettings()에서 확인)은 이 채널로 새 주문/상태
  // 변경을 거의 즉시 받아서 loadOrders()를 바로 부르고, 폴링은 30초의 아주
  // 느린 "혹시 Pusher 연결이 끊기면"을 대비한 안전망으로만 돈다. Pusher가
  // 설정 안 된 매장(아직 계정을 안 만들었거나 환경변수를 안 넣은 경우)은
  // realtimeEnabled가 false로 남아서 예전처럼 2초 폴링이 유일한 경로가
  // 된다 — 즉 이 기능을 몰라도, 설정 안 해도 앱은 그대로 잘 돌아간다.
  function initRealtimeOrders(cfg) {
    if (!cfg || !cfg.enabled || !cfg.key || !cfg.cluster || typeof Pusher === "undefined") return;
    if (pusherClient) return; // 이미 연결돼 있으면 재연결하지 않음 (loadSettings()가 여러 번 불릴 수 있음)
    try {
      pusherClient = new Pusher(cfg.key, { cluster: cfg.cluster });
      const channel = pusherClient.subscribe("orders");
      channel.bind("changed", () => loadOrders());
      // 주문 말고 나머지(인원수·테이블·메뉴)가 바뀐 것도 여기로 온다.
      //
      // 사장님(2026-09-11): "현재 뭐가 바뀌거나 인원이 추가되거나 메뉴가
      // 추가되거나 그게 바로바로 반영이 안되고 새로고침을 해야 바뀌어있어."
      //
      // 지금까지 이 화면이 스스로 다시 불러오는 것은 주문뿐이었다. 테이블과
      // 메뉴는 로그인할 때 한 번 불러오고 끝이라, 옆 태블릿에서 인원을
      // 고치거나 품절을 켜도 이 화면은 영영 몰랐다.
      channel.bind("data", (payload) => refreshChangedData(payload && payload.what));
      pusherClient.connection.bind("connected", () => {
        realtimeEnabled = true;
        // 폴링이 이미 빠른 주기로 돌고 있었다면 느린 안전망 주기로 다시 시작
        if (pollTimer) {
          stopPolling();
          startPolling();
        }
      });
      // 연결이 끊기면 안전하게 빠른 폴링으로 되돌아간다 — 손님이 주문을
      // 못 받는 상황이 "몰래" 생기는 것보다는 폴링이라도 도는 게 낫다.
      pusherClient.connection.bind("disconnected", () => {
        realtimeEnabled = false;
        if (pollTimer) {
          stopPolling();
          startPolling();
        }
      });
    } catch (e) {
      console.error("[realtime] Pusher init failed:", e);
      realtimeEnabled = false;
    }
  }
  // 「무엇이 바뀌었나」를 받아서 그것만 다시 불러온다. 전부 다시 불러오면
  // 인원 한 명 고칠 때마다 모든 기기가 메뉴까지 다시 받는다.
  async function refreshChangedData(what) {
    if (what === "menu") {
      await loadMenu();
      return;
    }
    // tables — 인원수, 자리, 구역. 주문 목록과 같은 자리들을 다시 그린다
    // (loadOrders 끝부분과 같은 이유: 배치도와 열려 있는 테이블 상세가
    // 옛날 인원수를 그대로 들고 있으면 안 된다).
    await loadTables();
    if (!$("#floorPlanWrap").hidden && !floorPlanDragging) renderFloorPlan();
    if (!$("#tab-payment").hidden) renderPaymentFloorPlan();
    if (openTableNumber) openTableDetail(openTableNumber, openTableLabel, openFocusOrderId);
  }

  // 알림이 못 올 때를 위한 안전망. Pusher 연결이 조용히 끊기거나, 알림
  // 하나가 유실되면 화면은 그 사실을 스스로 알 방법이 없다 — 그때 「새로고침
  // 해야 보이는」 상태로 되돌아가지 않게 가끔 스스로 다시 불러온다.
  // 주문(위 pollTimer)보다 훨씬 뜸해도 되는 것들이다.
  const DATA_REFRESH_MS = 30000;
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(loadOrders, realtimeEnabled ? 30000 : 2000);
    if (!dataTimer) {
      dataTimer = setInterval(() => {
        refreshChangedData("tables");
        refreshChangedData("menu");
      }, DATA_REFRESH_MS);
    }
  }
  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (dataTimer) {
      clearInterval(dataTimer);
      dataTimer = null;
    }
  }

  // ---------- 주문 알림음 (벨소리 · 음량) ----------
  // 2026-09-10 사장님: "주문 들어올 때 알람이 오는데 그걸 설정에서 소리
  // 크기랑 벨소리를 추가할 수 있게 해줘. 샘플로 너가 몇개 넣어주고 소리는
  // 엄청 크게까지 될 수 있게 해줘."
  //
  // 소리를 mp3 파일로 두지 않고 Web Audio로 그 자리에서 만든다. 음원을
  // 올리면 빌드에 따라붙고 캐시를 타는데, 알림음은 "홀이 시끄러운 순간에
  // 반드시 나야 하는" 소리라 네트워크가 한 번이라도 끼면 안 된다. 만들어
  // 쓰면 용량 0에 오프라인에서도 똑같이 난다.
  //
  // "엄청 크게": 브라우저 음량의 기본 상한(1.0)을 넘겨 최대 10배까지
  // 증폭한다. 그냥 곱하기만 하면 파형이 잘려 찢어지는 소리가 나므로
  // 마지막에 리미터(DynamicsCompressorNode)를 한 겹 두고 통과시킨다 —
  // 크기는 올라가되 깨지지는 않는다. 다만 기기 자체 볼륨이 낮으면 여기서
  // 무슨 짓을 해도 한계가 있어서, 설정 화면에 그 안내를 같이 적어뒀다.
  const ALARM_SOUND_KEY = "hg_admin_alarmSound";
  const ALARM_VOLUME_KEY = "hg_admin_alarmVolume";
  // 「알림 길이」로 시간을 정해 반복하던 설정은 없앴다 — 2026-09-10 사장님:
  // "알림을 특정 시간동안 반복해달라는 게 아니야. 알림음이 길었으면
  // 좋겠다고. 알림을 반복하면 여러 주문 들어온 것 같잖아."
  //
  // 그래서 길이는 벨소리 자체가 갖는다. 아래 ALARM_SOUNDS 의 「긴 벨소리」는
  // 처음부터 3~4초짜리 곡이고, 반복 없이 한 번 울린다.
  //
  // 반복은 「짧은 알림음」에만 남긴다 — 사장님: "짧은 알림음은 몇 번 반복할
  // 건지 물어봐줘". 0.5초짜리 "삐" 는 한 번이면 정말 놓치는데, 이건 사장님이
  // 몇 번으로 할지 고르는 것이므로 여러 번 들리는 것이 뜻과 맞다. 사이를
  // 짧게(0.18초) 붙여서 "삐 삐 삐" 한 덩어리로 들리게 한다 — 여기를 넓히면
  // 다시 "주문이 세 건 들어왔나" 가 된다.
  const ALARM_REPEAT_KEY = "hg_admin_alarmRepeat";
  const ALARM_REPEAT_CHOICES = [1, 2, 3, 5];
  const ALARM_DEFAULT_REPEAT = 2;
  const ALARM_REPEAT_GAP = 0.18;
  const ALARM_VOLUME_MAX = 1000; // %
  const ALARM_DEFAULT_SOUND = "beep";
  const ALARM_DEFAULT_VOLUME = 100;
  // 이 값을 넘어가면 기기 스피커가 낼 수 있는 크기를 넘어 증폭하는
  // 구간이라, 설정 화면에서 경고 문구를 띄운다.
  const ALARM_LOUD_WARN_AT = 200;

  let audioCtx = null;
  let alarmLimiter = null;

  // AudioContext는 한 번만 만들어 재사용한다 — 예전 playBeep()은 주문이
  // 들어올 때마다 새로 만들었는데, 브라우저는 탭당 열 수 있는 컨텍스트
  // 개수가 정해져 있어서(크롬 기준 6개) 바쁜 날 주문이 몇 건 연달아 들어오면
  // 그 뒤로는 알림음이 통째로 안 나게 된다.
  function alarmAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
      alarmLimiter = audioCtx.createDynamicsCompressor();
      alarmLimiter.threshold.value = -3;
      alarmLimiter.knee.value = 0;
      alarmLimiter.ratio.value = 20;
      alarmLimiter.attack.value = 0.002;
      alarmLimiter.release.value = 0.12;
      alarmLimiter.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  }
  // 브라우저는 사람이 화면을 한 번이라도 건드리기 전에는 소리를 막는다.
  // 아침에 태블릿만 켜두고 아무도 안 눌렀는데 첫 주문이 들어오면 알림음이
  // 아예 안 나므로, 첫 클릭/터치/키 입력에서 미리 깨워둔다.
  ["pointerdown", "keydown", "touchstart"].forEach((ev) =>
    document.addEventListener(ev, () => alarmAudio(), { once: true, passive: true })
  );

  // 음 하나. dur 안에서 소리가 붙었다 사라진다(exponentialRamp는 0을 못 받아서
  // 0.0001로 대신한다 — 사람 귀에는 무음).
  function alarmTone(ctx, dest, opt) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = opt.type || "sine";
    const t = ctx.currentTime + (opt.at || 0);
    const dur = opt.dur || 0.2;
    // steps 를 주면 오실레이터 하나가 그 시각에 음 높이만 바꾼다 — 소리가
    // 끊기지 않으므로 사이렌처럼 "이어지는 한 소리"로 들린다. glide 면 미끄러진다.
    if (opt.steps && opt.steps.length) {
      opt.steps.forEach(([at, f], i) => {
        if (i === 0 || !opt.glide) o.frequency.setValueAtTime(f, t + at);
        else o.frequency.exponentialRampToValueAtTime(f, t + at);
      });
    } else {
      o.frequency.setValueAtTime(opt.freq, t);
      if (opt.to) o.frequency.exponentialRampToValueAtTime(opt.to, t + dur);
    }
    const peak = opt.gain === undefined ? 0.3 : opt.gain;
    const attack = opt.attack || 0.008;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    if (opt.hold) {
      // 끝까지 세기를 유지하다가 마지막에만 내린다(사이렌·긴 삐).
      const rel = opt.release || 0.2;
      g.gain.setValueAtTime(peak, t + Math.max(attack, dur - rel));
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // 필터는 음색용이다. 사각파를 그냥 쓰면 째지는데, 위쪽을 깎으면 마림바나
    // 오르골처럼 둥근 소리가 된다.
    let tail = g;
    if (opt.filter) {
      const f = ctx.createBiquadFilter();
      f.type = opt.filter[0];
      f.frequency.value = opt.filter[1];
      if (opt.filter[2]) f.Q.value = opt.filter[2];
      g.connect(f);
      tail = f;
    }
    o.connect(g);
    tail.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // 음 이름 → 진동수. 아래 멜로디를 악보처럼 읽을 수 있게 두는 것뿐이다.
  const SEMITONE_FROM_A = { C: -9, "C#": -8, D: -7, "D#": -6, E: -5, F: -4, "F#": -3, G: -2, "G#": -1, A: 0, "A#": 1, B: 2 };
  function hz(name) {
    const m = /^([A-G]#?)(\d)$/.exec(name);
    if (!m) return 440;
    return 440 * Math.pow(2, (SEMITONE_FROM_A[m[1]] + (parseInt(m[2], 10) - 4) * 12) / 12);
  }
  /**
   * 멜로디 한 줄. notes = [["G5", 시작초, 길이초, (세기)], ...]
   *
   * 음이 계속 바뀌고 서로 겹쳐서 쉼이 없다 — 그래서 같은 소리를 여러 번
   * 울리는 것과 달리 "긴 벨소리 하나"로 들린다.
   */
  function alarmPhrase(ctx, dest, notes, opt) {
    opt = opt || {};
    notes.forEach((n) => {
      alarmTone(ctx, dest, {
        freq: hz(n[0]),
        at: n[1],
        dur: n[2],
        gain: n[3] === undefined ? opt.gain : n[3],
        type: opt.type,
        attack: opt.attack,
        filter: opt.filter,
      });
    });
  }

  // 벨소리 샘플. 새 소리를 넣으려면 여기에 한 줄 추가하고 admin.html의
  // .alarm-tone-grid에 같은 value로 라디오 하나, i18n에 이름만 넣으면 된다.
  const ALARM_SOUNDS = {
    // 기존에 쓰던 소리 그대로 — 설정을 안 건드린 매장은 소리가 안 바뀐다.
    beep: (c, d) => {
      alarmTone(c, d, { freq: 880, dur: 0.5, attack: 0.02 });
    },
    ding: (c, d) => {
      alarmTone(c, d, { freq: 987.77, dur: 0.45, type: "triangle" });
      alarmTone(c, d, { freq: 783.99, dur: 0.9, at: 0.16, type: "triangle" });
    },
    // 종은 배음이 정수배가 아니다(2.76, 5.4) — 그래서 "딩"이 아니라 "뎅"으로 들린다.
    bell: (c, d) => {
      [1, 2.76, 5.4].forEach((m, i) =>
        alarmTone(c, d, { freq: 523.25 * m, dur: 1.6 - i * 0.35, gain: 0.3 / (i + 1.4) })
      );
    },
    chime: (c, d) => {
      [523.25, 659.25, 783.99].forEach((f, i) =>
        alarmTone(c, d, { freq: f, dur: 0.5, at: i * 0.14, type: "triangle", gain: 0.28 })
      );
    },
    triple: (c, d) => {
      for (let i = 0; i < 3; i++)
        alarmTone(c, d, { freq: 1046.5, dur: 0.12, at: i * 0.2, type: "square", gain: 0.22 });
    },
    alarm: (c, d) => {
      for (let i = 0; i < 8; i++)
        alarmTone(c, d, { freq: i % 2 ? 784 : 1046.5, dur: 0.13, at: i * 0.15, type: "square", gain: 0.22 });
    },
    siren: (c, d) => {
      for (let i = 0; i < 3; i++) {
        alarmTone(c, d, { freq: 620, to: 1240, dur: 0.35, at: i * 0.7, type: "sawtooth", gain: 0.26 });
        alarmTone(c, d, { freq: 1240, to: 620, dur: 0.35, at: i * 0.7 + 0.35, type: "sawtooth", gain: 0.26 });
      }
    },
    arcade: (c, d) => {
      alarmTone(c, d, { freq: 987.77, dur: 0.08, type: "square", gain: 0.22 });
      alarmTone(c, d, { freq: 1318.5, dur: 0.35, at: 0.08, type: "square", gain: 0.22 });
    },

    // ── 긴 벨소리 (2026-09-10) ──────────────────────────────────────────
    // 위의 여덟은 "삐" 하고 마는 신호음이라, 홀이 시끄러우면 그 순간을
    // 놓친다. 아래는 처음부터 3~4초짜리 곡이다 (2026-09-10 사장님:
    // "긴소리 알림을 3~4초로 해주고"). 음이 계속 바뀌고 서로
    // 겹쳐서 쉼이 없으므로, 같은 소리를 여러 번 울리는 것과 달리 "한 번
    // 길게 울렸다"로 들린다 — 사장님: "알림을 반복하면 여러 주문 들어온
    // 것 같잖아."
    //
    // 곡은 전부 여기서 지어 쓴다. 남의 벨소리를 가져다 쓰면 저작권이
    // 걸리고, 음원 파일을 올리면 배포와 캐시를 타서 정작 필요한 순간에
    // 안 나는 일이 생긴다.

    // 오르골 — 성글고 부드럽다. 홀이 조용한 시간대(점심 전, 마감 무렵)에.
    musicbox: (c, d) => {
      const N = [
        ["G5", 0, 0.95], ["E5", 0.3, 0.95], ["C5", 0.6, 1.05],
        ["D5", 1.0, 0.85], ["E5", 1.25, 0.85], ["G5", 1.5, 1.1],
        ["A5", 1.95, 0.85], ["G5", 2.2, 0.85], ["E5", 2.45, 1.0],
        ["C5", 2.8, 1.25],
      ];
      alarmPhrase(c, d, N, { type: "sine", gain: 0.26, attack: 0.005 });
      // 한 옥타브 위를 아주 작게 겹쳐 얹으면 오르골 특유의 반짝임이 난다.
      alarmPhrase(c, d, N.map((n) => [n[0].replace(/\d/, (x) => +x + 1), n[1], n[2] * 0.5, 0.05]), { type: "sine" });
    },

    // 차임 — 크고 낮게 울리는 종. 주방까지 닿아야 할 때.
    chimelong: (c, d) => {
      alarmPhrase(c, d, [
        ["C5", 0, 1.2], ["G5", 0.32, 1.2], ["E5", 0.64, 1.3],
        ["A5", 1.2, 1.2], ["E5", 1.52, 1.2], ["C5", 1.84, 1.3],
        ["G5", 2.4, 1.1], ["C6", 2.72, 1.5],
      ], { type: "triangle", gain: 0.24, attack: 0.01 });
    },

    // 마림바 — 통통 튀는 나무 소리. 짧은 음이 촘촘해서 시끄러운 홀에서 잘 뚫는다.
    marimba: (c, d) => {
      const seq = ["C5","E5","G5","E5","D5","F5","A5","F5","E5","G5","C6","G5","E5","C5"];
      alarmPhrase(
        c, d,
        seq.map((n, i) => [n, i * 0.185, i === seq.length - 1 ? 1.1 : 0.36]),
        { type: "sine", gain: 0.28, attack: 0.004, filter: ["lowpass", 2600] }
      );
    },

    // 가야금 — 5음계(도레파솔라)로 지은 우리 가락. 가게 얼굴에 맞는 소리 하나.
    gayageum: (c, d) => {
      alarmPhrase(c, d, [
        ["A4", 0, 0.85], ["G4", 0.28, 0.8], ["F4", 0.56, 1.0],
        ["D4", 1.0, 0.85], ["F4", 1.28, 0.8], ["G4", 1.56, 1.0],
        ["A4", 2.0, 0.85], ["C5", 2.28, 1.0], ["A4", 2.66, 0.85],
        ["F4", 2.95, 1.35],
      ], { type: "triangle", gain: 0.3, attack: 0.006, filter: ["lowpass", 2000] });
    },

    // 디지털 — 요즘 휴대폰 벨소리 같은 오름 아르페지오. 세 번 올라가고 내려앉는다.
    digital: (c, d) => {
      const chords = [
        ["E5", "G#5", "B5", "E6"],
        ["D#5", "G5", "B5", "D#6"],
        ["C#5", "F5", "G#5", "C#6"],
      ];
      const notes = [];
      chords.forEach((ch, k) =>
        ch.forEach((n, i) => notes.push([n, k * 0.68 + i * 0.13, i === 3 ? 0.45 : 0.2]))
      );
      notes.push(["E5", 2.12, 1.5], ["B5", 2.12, 1.5]);
      alarmPhrase(c, d, notes, { type: "square", gain: 0.16, attack: 0.005, filter: ["lowpass", 3200] });
    },

    // 긴 사이렌 — 오실레이터 하나가 처음부터 끝까지 오르내린다. 끊기는 데가
    // 없어서 "여러 번"으로 들릴 수가 없는 소리다.
    sirenlong: (c, d) => {
      const steps = [];
      for (let i = 0; i <= 7; i++) steps.push([i * 0.5, i % 2 ? 1240 : 620]);
      alarmTone(c, d, {
        steps, glide: true, dur: 3.5, type: "sawtooth", gain: 0.22,
        hold: true, release: 0.4, attack: 0.05, filter: ["lowpass", 2200],
      });
    },
  };

  // 소리마다 실제로 나는 길이(초). 위 ALARM_SOUNDS 의 스케줄에서 나온
  // 값이라, 소리를 고치면 여기도 같이 고쳐야 한다. 이 값으로 「알림 끄기」
  // 버튼을 언제 내릴지 정한다 — 짧게 잡으면 아직 울리는데 버튼이 사라지고,
  // 길게 잡으면 끝난 소리에 버튼만 남는다.
  const ALARM_SOUND_LEN = {
    beep: 0.52,
    ding: 1.06,
    bell: 1.6,
    chime: 0.78,
    triple: 0.52,
    alarm: 1.18,
    siren: 2.1,
    arcade: 0.43,
    musicbox: 3.6,
    chimelong: 3.65,
    marimba: 3.15,
    gayageum: 3.85,
    digital: 3.3,
    sirenlong: 3.5,
  };
  // 이 길이부터는 「긴 벨소리」로 친다. 긴 벨소리는 곡 자체가 길어서 반복하지
  // 않으므로, 설정 화면에서 반복 칸을 숨기는 기준도 이것이다.
  const ALARM_LONG_FROM = 2.5;
  function isLongAlarmSound(id) {
    return (ALARM_SOUND_LEN[id] || 0) >= ALARM_LONG_FROM;
  }

  function readStoredNumber(key, fallback, min, max) {
    let v;
    try {
      v = parseInt(localStorage.getItem(key), 10);
    } catch (e) {
      v = NaN;
    }
    if (!Number.isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, v));
  }
  function getAlarmVolume() {
    return readStoredNumber(ALARM_VOLUME_KEY, ALARM_DEFAULT_VOLUME, 0, ALARM_VOLUME_MAX);
  }
  // 슬라이더 손잡이 위치(0~100)와 실제 음량(%)의 환산. 그냥 0~1000%를 자로
  // 재듯 늘어놓으면 평소에 쓰는 100% 근처가 맨 왼쪽 10% 안에 다 몰려서
  // 손가락으로는 조절이 안 된다. 그래서 왼쪽 절반에 0~100%를, 오른쪽 절반에
  // 100~1000%를 로그로 펼쳐 놓았다 — 가운데가 정확히 기본값(100%)이다.
  function alarmVolToPos(v) {
    if (v <= 100) return Math.round(v / 2);
    return Math.round(50 + (50 * Math.log10(v / 100)) / Math.log10(ALARM_VOLUME_MAX / 100));
  }
  function alarmPosToVol(p) {
    if (p <= 50) return Math.round(p * 2);
    const v = 100 * Math.pow(ALARM_VOLUME_MAX / 100, (p - 50) / 50);
    return Math.min(ALARM_VOLUME_MAX, Math.round(v / 10) * 10);
  }
  function getAlarmRepeat() {
    let v;
    try {
      v = parseInt(localStorage.getItem(ALARM_REPEAT_KEY), 10);
    } catch (e) {
      v = NaN;
    }
    return ALARM_REPEAT_CHOICES.indexOf(v) >= 0 ? v : ALARM_DEFAULT_REPEAT;
  }
  function getAlarmSound() {
    let v = null;
    try {
      v = localStorage.getItem(ALARM_SOUND_KEY);
    } catch (e) {
      /* private browsing */
    }
    return ALARM_SOUNDS[v] ? v : ALARM_DEFAULT_SOUND;
  }
  function storeAlarmPref(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (e) {
      /* 저장이 막혀도 이번 화면에서는 그대로 적용된다 — 다음 새로고침에만 잊힌다 */
    }
  }

  /** 한 번 울린다. 반복은 startAlarm() 이 맡는다. */
  function playAlarm(soundId, volumePercent) {
    try {
      const ctx = alarmAudio();
      if (!ctx) return;
      const id = ALARM_SOUNDS[soundId] ? soundId : getAlarmSound();
      const vol = volumePercent === undefined ? getAlarmVolume() : volumePercent;
      if (vol <= 0) return;
      const g = ctx.createGain();
      g.gain.value = vol / 100;
      g.connect(alarmLimiter);
      alarmGains.push(g);
      ALARM_SOUNDS[id](ctx, g);
      // 소리가 끝난 뒤 노드를 떼어낸다. 안 떼면 주문 한 건마다 게인 노드가
      // 하나씩 쌓여서 하루 종일 켜두는 홀 태블릿에서 조금씩 무거워진다.
      setTimeout(() => {
        alarmGains = alarmGains.filter((x) => x !== g);
        try {
          g.disconnect();
        } catch (e) {
          /* 이미 정리됨 */
        }
      }, (ALARM_SOUND_LEN[id] || 1) * 1000 + 3000);
    } catch (e) {
      /* 자동재생 차단 등 — 알림음 때문에 주문 화면이 멈추면 안 된다 */
    }
  }

  // ---------- 알림 울리기 / 멈추기 ----------
  let alarmTimer = null;
  let alarmActive = false;
  // 지금 울리고 있는 소리의 음량 노드들 — stopAlarm() 이 이걸 잡고 내린다.
  let alarmGains = [];

  function stopAlarm() {
    if (alarmTimer) clearTimeout(alarmTimer);
    alarmTimer = null;
    alarmActive = false;
    // 예약된 음까지 실제로 끊는다. 긴 벨소리는 8초짜리 곡이 통째로 미리
    // 예약돼 있어서, 타이머만 지우면 버튼을 눌러도 소리는 끝까지 난다.
    // 뚝 끊으면 "틱" 소리가 나므로 60ms 에 걸쳐 내린다.
    if (alarmGains.length) {
      const ctx = audioCtx;
      alarmGains.forEach((g) => {
        try {
          const now = ctx.currentTime;
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
          g.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
        } catch (e) {
          /* 이미 정리됨 */
        }
      });
      alarmGains = [];
    }
    updateAlarmUiState();
  }

  /**
   * 알림을 울린다.
   *
   * 긴 벨소리는 곡 자체가 3~4초이므로 한 번. 짧은 알림음은 설정에서 고른
   * 횟수만큼(기본 2번) 바로 이어서 울린다 — 0.5초짜리 "삐" 는 한 번이면
   * 정말 놓친다. 사이가 0.18초뿐이라 "삐 삐" 한 덩어리로 들린다.
   *
   * 이미 울리고 있으면 멈추고 새로 시작한다. 주문이 연달아 들어올 때 소리가
   * 겹쳐서 뭉치면 몇 건인지도 모르고 그냥 시끄럽기만 하다.
   */
  function startAlarm(opt) {
    opt = opt || {};
    stopAlarm();
    const id = ALARM_SOUNDS[opt.sound] ? opt.sound : getAlarmSound();
    const vol = opt.volume === undefined ? getAlarmVolume() : opt.volume;
    if (vol <= 0) return;
    const len = ALARM_SOUND_LEN[id] || 1;
    const times = isLongAlarmSound(id) ? 1 : opt.repeat === undefined ? getAlarmRepeat() : opt.repeat;
    alarmActive = true;
    updateAlarmUiState();
    let left = times;
    const tick = () => {
      playAlarm(id, vol);
      left -= 1;
      // 소리가 다 끝나면 「알림 끄기」 버튼도 같이 내린다.
      alarmTimer = setTimeout(left > 0 ? tick : stopAlarm, len * 1000 + (left > 0 ? ALARM_REPEAT_GAP * 1000 : 120));
    };
    tick();
  }

  /** 울리는 동안만 「알림 끄기」 버튼을 보여준다. */
  function updateAlarmUiState() {
    const stop = $("#alarmStopBtn");
    if (stop) stop.hidden = !alarmActive;
    const preview = $("#alarmPreviewBtn");
    if (preview) preview.textContent = alarmActive ? T("alarmPreviewStopBtn") : T("alarmPreviewBtn");
  }

  // 기존 호출부(신규 주문 감지)는 그대로 playBeep()을 부른다.
  function playBeep() {
    startAlarm();
  }

  // ---------- 알림음 설정 화면 ----------
  let alarmSliding = false;
  // 고르는 동안에는 여기에만 담아둔다. **저장 버튼을 눌러야** 기기에 적힌다
  // (2026-09-11 사장님). 그래서 새 주문이 실제로 울릴 때 쓰는 값
  // (getAlarmSound/Volume/Repeat 은 기기에 적힌 것을 읽는다)은 저장 전까지
  // 안 바뀐다 — 고르는 중에 손님 주문이 들어와도 아까 그 소리로 울린다.
  const alarmDraft = { volume: null, sound: null, repeat: null };
  const draftVolume = () => (alarmDraft.volume == null ? getAlarmVolume() : alarmDraft.volume);
  const draftSound = () => (alarmDraft.sound == null ? getAlarmSound() : alarmDraft.sound);
  const draftRepeat = () => (alarmDraft.repeat == null ? getAlarmRepeat() : alarmDraft.repeat);
  function alarmDirty() {
    return (
      draftVolume() !== getAlarmVolume() ||
      draftSound() !== getAlarmSound() ||
      draftRepeat() !== getAlarmRepeat()
    );
  }
  function setAlarmDraft(patch) {
    Object.assign(alarmDraft, patch);
    markSettingDirty("saveAlarmBtn", alarmDirty());
  }
  function applyAlarmUi() {
    updateAlarmUiState();
    const rep = draftRepeat();
    $$("input[name='alarmRepeat']").forEach((r) => {
      r.checked = parseInt(r.value, 10) === rep;
      if (r.parentElement) r.parentElement.classList.toggle("is-on", r.checked);
    });
    // 긴 벨소리를 고르면 반복 칸을 숨긴다. 곡 자체가 3~4초라 반복하지 않으므로,
    // 그대로 두면 아무 일도 하지 않는 설정이 켜져 있는 것처럼 보인다.
    const repRow = $("#alarmRepeatRow");
    if (repRow) repRow.hidden = isLongAlarmSound(draftSound());
    const vol = draftVolume();
    const slider = $("#alarmVolume");
    // 손잡이를 끌고 있는 중이라면 위치를 다시 써넣지 않는다 — 반올림 때문에
    // 손가락 밑에서 손잡이가 되튀는 것처럼 보인다.
    if (slider && !alarmSliding) slider.value = String(alarmVolToPos(vol));
    const label = $("#alarmVolumeValue");
    if (label) label.textContent = vol + "%";
    const warn = $("#alarmLoudWarn");
    if (warn) warn.hidden = vol < ALARM_LOUD_WARN_AT;
    const sound = draftSound();
    $$("input[name='alarmTone']").forEach((r) => {
      r.checked = r.value === sound;
      if (r.parentElement) r.parentElement.classList.toggle("is-on", r.checked);
    });
  }
  if ($("#alarmVolume")) {
    // 슬라이더를 끄는 동안에는 숫자만 따라 움직이고(소리는 안 낸다),
    // 손을 뗀 순간 그 크기로 한 번 들려준다 — 끄는 내내 소리가 나면
    // 시끄럽기만 하고 정작 어느 크기인지 판단이 안 된다.
    $("#alarmVolume").addEventListener("input", (e) => {
      alarmSliding = true;
      const pos = Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0));
      setAlarmDraft({ volume: alarmPosToVol(pos) });
      applyAlarmUi();
    });
    // 음량은 짧은 소리로 재본다. 크기를 맞추는 중인데 8초짜리 곡이 돌면
    // 다음 칸으로 넘어갈 수가 없다 — 여기서 듣고 싶은 건 크기지 곡이 아니다.
    $("#alarmVolume").addEventListener("change", () => {
      alarmSliding = false;
      startAlarm({ sound: "beep", repeat: 1, volume: draftVolume() });
    });
    // 횟수를 고를 때는 그 횟수로 실제 소리를 들려준다 — 고르는 게 횟수니까.
    // 긴 벨소리가 골라져 있으면 반복이 없으니 짧은 「기본 삐」로 들려준다.
    $$("input[name='alarmRepeat']").forEach((r) =>
      r.addEventListener("change", () => {
        if (!r.checked) return;
        const times = parseInt(r.value, 10);
        setAlarmDraft({ repeat: times });
        applyAlarmUi();
        const cur = draftSound();
        startAlarm({ sound: isLongAlarmSound(cur) ? "beep" : cur, repeat: times, volume: draftVolume() });
      })
    );
    if ($("#alarmResetBtn"))
      $("#alarmResetBtn").onclick = () => {
        setAlarmDraft({ volume: ALARM_DEFAULT_VOLUME, sound: ALARM_DEFAULT_SOUND, repeat: ALARM_DEFAULT_REPEAT });
        applyAlarmUi();
        startAlarm({ sound: ALARM_DEFAULT_SOUND, repeat: ALARM_DEFAULT_REPEAT, volume: ALARM_DEFAULT_VOLUME });
      };
    $$("input[name='alarmTone']").forEach((r) =>
      r.addEventListener("change", () => {
        if (!r.checked) return;
        setAlarmDraft({ sound: r.value });
        applyAlarmUi();
        // 고른 소리를 통째로 들려준다. 긴 벨소리는 길이도 골라야 할 대상이라
        // 앞부분만 들려주면 무엇을 고른 건지 알 수가 없다. 길면 「정지」로 끊는다.
        startAlarm();
      })
    );
    if ($("#saveAlarmBtn"))
      $("#saveAlarmBtn").onclick = () => {
        // 여기서 처음으로 기기에 적힌다. 이 순간부터 새 주문이 이 소리로 운다.
        storeAlarmPref(ALARM_VOLUME_KEY, draftVolume());
        storeAlarmPref(ALARM_SOUND_KEY, draftSound());
        storeAlarmPref(ALARM_REPEAT_KEY, draftRepeat());
        alarmDraft.volume = null;
        alarmDraft.sound = null;
        alarmDraft.repeat = null;
        applyAlarmUi();
        flashSettingSaved("alarmSettingsMsg", "saveAlarmBtn");
      };
    if ($("#alarmPreviewBtn"))
      $("#alarmPreviewBtn").onclick = () => {
        // 울리는 중이면 같은 버튼이 정지가 된다. 8초짜리 곡을 끝까지 듣고
        // 있을 이유는 없고, 「알림 끄기」 버튼은 실시간 주문 화면에 있어서
        // 여기서는 안 보인다.
        if (alarmActive) stopAlarm();
        else startAlarm({ sound: draftSound(), repeat: draftRepeat(), volume: draftVolume() });
      };
    applyAlarmUi();
  }

  // 2026-09-06 피드백: "저장 되었으면 저장되었다고도 알려주고. 저렇게
  // 하니까 아슬해서" — localStorage에 저장은 이미 되고 있었지만(바로 위
  // readStoredToggle/writeStoredToggle 참고) 화면에 아무 신호가 없어서
  // 실제로 저장되는지 사장님이 확신하기 어려웠던 것. 토글을 누를 때마다
  // 잠깐 "✔ 저장됨"을 보여줘서 확실히 저장됐다는 걸 눈으로 확인할 수 있게 함.
  let toggleSavedMsgTimer = null;
  function flashToggleSaved() {
    const el = $("#toggleSavedMsg");
    if (!el) return;
    el.hidden = false;
    clearTimeout(toggleSavedMsgTimer);
    toggleSavedMsgTimer = setTimeout(() => (el.hidden = true), 1800);
  }
  // ── 인쇄를 맡은 기기 ──────────────────────────────────────────────
  //
  // 2026-09-10 사장님: "한 대만 켜져있을텐데 그게 큰 의미가 있는거야?
  // 그렇다면 하나에 고정으로 되거나 다른 곳에서 못 키게 막아줘."
  //
  // 크다. 자동 인쇄는 브라우저마다 따로 켜는 것이라 태블릿과 폰에서 둘 다
  // 켜져 있으면 주문 하나에 빌지가 두 벌 나오고, 지금까지는 그게 켜져
  // 있다는 사실조차 다른 기기에서 볼 수 없었다.
  //
  // 서버에 「지금 인쇄하는 기기」를 한 대만 적어두고(GET/PUT
  // /api/settings/print-device), 다른 기기에서 켜려고 하면 누가 맡고
  // 있는지 알려준 뒤 확인을 받는다.
  //
  // 자물쇠가 아니라 표지판이다. 이 값을 못 읽었으면(네트워크가 잠깐
  // 끊겼다든가) 그냥 찍는다 — 빌지가 두 장 나오는 것보다 안 나오는 게
  // 훨씬 비싸다. 오늘 9번 테이블에서 그 값을 치렀다.
  const DEVICE_ID_KEY = "hg_admin_deviceId";
  let printDevice = { id: null, name: null, known: false };

  function myDeviceId() {
    try {
      let id = localStorage.getItem(DEVICE_ID_KEY);
      if (!id) {
        id = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        localStorage.setItem(DEVICE_ID_KEY, id);
      }
      return id;
    } catch (e) {
      // 저장이 막힌 기기. 이 창이 살아 있는 동안만 유효한 번호를 쓴다 —
      // 새로고침하면 남의 기기처럼 보이지만, 못 켜는 것보다는 낫다.
      if (!window.__hgDeviceId) window.__hgDeviceId = `t${Math.random().toString(36).slice(2, 10)}`;
      return window.__hgDeviceId;
    }
  }

  // 사장님이 「어느 기기였더라」를 떠올릴 수 있을 만큼만. 기기 이름을
  // 정확히 알 방법은 없으니 종류만 적는다.
  function myDeviceName() {
    const ua = navigator.userAgent || "";
    if (appPrintBridge()) return T("printDeviceKindPos");
    if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return T("printDeviceKindTablet");
    if (/Mobile|iPhone|Android/i.test(ua)) return T("printDeviceKindPhone");
    return T("printDeviceKindPc");
  }

  async function refreshPrintDevice() {
    try {
      const res = await fetch("/api/settings/print-device");
      if (!res.ok) return;
      const d = await res.json();
      printDevice = { id: d.id || null, name: d.name || null, known: true };
    } catch (e) {
      /* 못 읽었으면 마지막으로 알던 값을 그대로 둔다 */
    }
  }

  async function claimPrintDevice() {
    try {
      const res = await fetch("/api/settings/print-device", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: myDeviceId(), name: myDeviceName() }),
      });
      if (res.ok) printDevice = { id: myDeviceId(), name: myDeviceName(), known: true };
    } catch (e) {}
  }

  async function releasePrintDevice() {
    if (printDevice.id && printDevice.id !== myDeviceId()) return; // 내 것이 아니면 놓을 것도 없다
    try {
      await fetch("/api/settings/print-device", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: null, releaseId: myDeviceId() }),
      });
      printDevice = { id: null, name: null, known: true };
    } catch (e) {}
  }

  /**
   * 이 기기가 지금 찍어도 되는가.
   *
   * 「아무도 안 맡았다」와 「못 읽었다」는 둘 다 찍는 쪽이다. 막는 건
   * 「다른 기기가 분명히 맡고 있다」 하나뿐이다.
   */
  function printHereAllowed() {
    if (!printDevice.known) return true;
    if (!printDevice.id) return true;
    return printDevice.id === myDeviceId();
  }

  function renderPrintDeviceNote() {
    const el = $("#printDeviceNote");
    if (!el) return;
    if (!printDevice.known || !printDevice.id) {
      el.hidden = true;
      return;
    }
    const mine = printDevice.id === myDeviceId();
    el.textContent = mine
      ? T("printDeviceHere")
      : T("printDeviceElsewhere").replace("{name}", printDevice.name || T("printDeviceUnknown"));
    el.classList.toggle("is-elsewhere", !mine);
    el.hidden = false;
    // 다른 기기가 가져갔는데 이 기기의 토글이 켜져 있으면, 켜져 있다고
    // 믿고 있는 쪽이 틀린 것이다 — 조용히 안 찍히느니 꺼진 걸 보여준다.
    if (!mine && autoPrintOn) {
      autoPrintOn = false;
      writeStoredToggle("hg_admin_autoPrintOn", false);
      $("#autoPrintToggle").checked = false;
    }
  }

  /**
   * 화면을 켤 때 한 번 — 누가 인쇄를 맡고 있는지 맞춰본다.
   *
   * 아무도 안 맡았고 이 기기의 토글이 켜져 있으면 내가 맡는다. 다른
   * 기기가 이미 맡고 있으면 뺏지 않는다 — 먼저 켠 쪽이 계속 맡는 게
   * 맞고, 켤 때마다 서로 뺏으면 주방 프린터가 오늘은 태블릿, 내일은
   * 폰이 된다. 이 기기 토글은 renderPrintDeviceNote 가 꺼준다.
   */
  async function syncPrintDevice() {
    await refreshPrintDevice();
    if (autoPrintOn && !printDevice.id) await claimPrintDevice();
    renderPrintDeviceNote();
  }

  if ($("#alarmStopBtn")) $("#alarmStopBtn").onclick = () => stopAlarm();
  $("#soundToggle").onchange = (e) => {
    soundOn = e.target.checked;
    // 알림음을 끄는 순간 지금 울리고 있는 것도 같이 멎어야 한다. 끄고 나서도
    // 10초를 더 울리면 그 토글이 안 먹는 것으로 보인다.
    if (!soundOn) stopAlarm();
    writeStoredToggle("hg_admin_soundOn", soundOn);
    flashToggleSaved();
  };
  $("#autoPrintToggle").onchange = async (e) => {
    const want = e.target.checked;
    if (want) {
      // 다른 기기가 인쇄를 맡고 있으면 물어본다 — 그냥 켜면 빌지가 두 벌
      // 나온다(2026-09-10 사장님: "다른 곳에서 못 키게 막아줘").
      await refreshPrintDevice();
      if (printDevice.id && printDevice.id !== myDeviceId()) {
        const ok = await showConfirm(T("printDeviceTakeoverConfirm").replace("{name}", printDevice.name || T("printDeviceUnknown")));
        if (!ok) {
          e.target.checked = false;
          autoPrintOn = false;
          writeStoredToggle("hg_admin_autoPrintOn", false);
          renderPrintDeviceNote();
          return;
        }
      }
      autoPrintOn = true;
      writeStoredToggle("hg_admin_autoPrintOn", true);
      await claimPrintDevice();
    } else {
      autoPrintOn = false;
      writeStoredToggle("hg_admin_autoPrintOn", false);
      await releasePrintDevice();
    }
    renderPrintDeviceNote();
    flashToggleSaved();
  };
  // Reflect whatever was restored from localStorage above back onto the
  // actual checkboxes — otherwise the JS state and the visible UI disagree
  // right after a reload (state restored, checkbox still shows unchecked).
  $("#soundToggle").checked = soundOn;
  $("#autoPrintToggle").checked = autoPrintOn;
  // Give the 새로고침 button explicit loading/done feedback — before, it did
  // its thing silently, so staff had no way to tell whether a tap actually
  // registered or whether the (identical-looking) board was already
  // up to date.
  $("#refreshOrders").onclick = async () => {
    const btn = $("#refreshOrders");
    if (btn.disabled) return; // ignore rapid re-taps while one is already in flight
    btn.disabled = true;
    btn.classList.add("is-loading");
    btn.textContent = T("refreshingBtn");
    try {
      await loadOrders();
      btn.classList.remove("is-loading");
      btn.classList.add("is-done");
      btn.textContent = T("refreshedBtn");
    } catch (err) {
      btn.classList.remove("is-loading");
      btn.textContent = T("refreshFailedBtn");
    } finally {
      setTimeout(() => {
        btn.disabled = false;
        btn.classList.remove("is-done");
        btn.textContent = T("refreshBtn");
      }, 900);
    }
  };

  // ---------- Orders ----------
  // loadOrders() now gets called from two places that can overlap: the
  // steady 4-second poll below, and a one-off call right after a drag
  // changes an order's status (see wireCardDrag) so the board updates
  // immediately instead of waiting out the rest of the poll interval.
  // Two in-flight requests can resolve out of order — if the poll's
  // request happened to be sent just before the drag's PATCH landed, its
  // response can still arrive AFTER the drag's own follow-up loadOrders(),
  // carrying the pre-drag status and silently snapping the card back to
  // its old column a moment later. ordersRequestSeq makes only the most
  // recently SENT request's response actually get applied; anything that
  // resolves late gets dropped instead of overwriting fresher data.
  let ordersRequestSeq = 0;
  async function loadOrders() {
    const seq = ++ordersRequestSeq;
    const res = await fetch("/api/orders");
    if (res.status === 401) return showLogin();
    const fresh = await res.json();
    if (seq !== ordersRequestSeq) return; // a newer request has since been sent — this response is stale, discard it

    // 이 기기가 아직 판단하지 않은 신규 주문. 기준은 메모리가 아니라
    // 기기에 남는 기록이라(decidedOrderIds), 새로고침 중에 들어온 주문도
    // 여기에 잡힌다 — 그게 9번 테이블 빌지가 안 나온 이유였다.
    const firstEverOnThisDevice = decidedOrderIds === null;
    if (firstEverOnThisDevice) decidedOrderIds = new Set();
    const pending = fresh.filter((o) => o.status === "new" && !decidedOrderIds.has(o.id));

    orders = fresh;
    // An order only needs the "인쇄 실패" flag while it's still sitting in
    // 신규 waiting on a ticket — once staff have moved it along (or
    // cancelled it) they've clearly already noticed it some other way, so
    // drop any flags for orders that are no longer "new" (or gone entirely).
    const stillNew = new Set(fresh.filter((o) => o.status === "new").map((o) => o.id));
    printFailedOrderIds.forEach((id) => {
      if (!stillNew.has(id)) printFailedOrderIds.delete(id);
    });
    // Skip re-rendering the order columns while a card is actively being
    // dragged (see draggingOrderId / wireCardDrag) — this 4-second
    // poll used to wipe out and rebuild every .order-card from scratch
    // mid-drag, which yanks the very DOM node the browser is dragging out
    // from under it and silently aborts the drop (same reason
    // renderFloorPlan() below already skips itself during floorPlanDragging).
    if (!draggingOrderId) renderOrders(); // also refreshes #printFailBanner, using prunedAny above
    renderTables();
    if (!$("#floorPlanWrap").hidden && !floorPlanDragging) renderFloorPlan();
    if (!$("#tab-payment").hidden) renderPaymentFloorPlan();
    if (openTableNumber) openTableDetail(openTableNumber, openTableLabel, openFocusOrderId);

    if (pending.length > 0) {
      // 판단했다는 표시를 먼저 남긴다. 인쇄가 끝나기를 기다렸다가 남기면,
      // 그 사이에 도착한 다음 응답이 같은 주문을 또 찍는다.
      pending.forEach((o) => decidedOrderIds.add(o.id));
      writeDecidedIds();
      // 이 기기에서 처음 켠 것이면 소리도 인쇄도 하지 않는다 — 화면을
      // 켠 순간 밀려 있던 신규 주문을 몰아 찍지 않으려는 것이다. 두 번째
      // 부터는(=새로고침을 포함해) 이 조건이 다시는 참이 되지 않으므로,
      // 새로고침 중에 들어온 주문이 여기서 빠지지 않는다.
      if (!firstEverOnThisDevice) {
        pending.forEach((o) => flashNewOrder(o.id));
        if (soundOn) playBeep();
        if (autoPrintOn && printHereAllowed()) {
          // 한 장씩 차례로. 예전에는 Promise.all 로 한꺼번에 보냈는데,
          // 주문 두 건이 같이 들어오면 프린터에 연결을 두 개 여는 셈이라
          // 한쪽이 조용히 사라진다(sendRasterTicketParts 주석과 같은 이유).
          (async () => {
            for (const o of pending) await printKitchenTicket(o);
            renderOrders();
          })();
        }
      }
    }

    printPendingNotices(fresh);
  }

  // 주방이 알아야 할 「이미 있는 주문의 변화」를 종이로 내보낸다.
  //
  // 사장님(2026-09-10): "늘 출력이 되어야 해. 수기던 고객이 직접 주문을
  // 하던 자리 옮김이던."
  //
  // 새 주문과 같은 원칙으로 돈다 — 먼저 「찍기로 했다」를 남기고 찍는다.
  // 그래야 그 사이 도착한 다음 응답이 같은 것을 또 찍지 않는다.
  function printPendingNotices(fresh) {
    const firstEver = printedNoticeKeys === null;
    if (firstEver) printedNoticeKeys = new Set();

    // 자리 이동은 여기서 다루지 않는다. 옮기는 그 자리에서 이미 한 장
    // 나간다(printMoveSlip, 설정 > 인쇄에 켜고 끄는 스위치까지 있다).
    // 여기서 또 찍으면 같은 이동에 종이가 두 장 나간다.
    const jobs = [];
    for (const o of fresh) {
      if (o.status === "paid" || o.status === "cancelled") continue;
      const ch = o.items_changed;
      if (ch && ch.at && ((ch.added || []).length || (ch.removed || []).length)) {
        const key = `c${o.id}@${ch.at}`;
        if (!printedNoticeKeys.has(key)) {
          jobs.push({ key, order: o, notice: { kind: "changed" }, change: ch });
        }
      }
    }
    if (!jobs.length) return;

    jobs.forEach((j) => printedNoticeKeys.add(j.key));
    writeNoticeKeys();

    // 이 기기에서 처음 켠 것이면 밀려 있던 변화를 몰아 찍지 않는다 —
    // 새 주문 쪽과 같은 이유다(위 firstEverOnThisDevice).
    if (firstEver) return;
    if (!autoPrintOn || !printHereAllowed()) return;

    (async () => {
      for (const j of jobs) await printNoticeTicket(j);
    })();
  }

  // "YYYY-MM-DD" in the browser's own local timezone (the admin device is
  // physically at the restaurant, so this matches Taipei time in practice)
  // — used to keep the 결제완료 column to today only, and by the 오전/오후
  // 정산 buttons below.
  function localDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  // AM/PM settlement, right inside 실시간주문 (2026-09 피드백: "오전장사
  // 끝나고 정산버튼/저녁장사끝나고 정산버튼 눌러서 합계 확인 가능하게", 이후
  // 2026-09-07 사장님 요청으로 "완전 마무리"로 확장: "메뉴가 남아있던
  // 안남아있던 모든 걸 클리어 하고 결산 탭으로 넘기는거야... 오전 정산은
  // 점심시간에 쉬는 시간 전까지 한 걸 마감하는 거고 오후 정산은 하루 마감을
  // 하는 거야"). 처음엔 이미 결제된 주문의 합계만 보여주는 조회용 버튼이었지만,
  // 이제는 실제로 정산을 "마감"한다:
  //   1) 아직 결제 안 된(신규/조리중/서빙완료) 오늘 주문이 있으면 몇 건인지
  //      먼저 보여주고 확인을 받는다 — 확인하면 그 주문들도 전부(음식이
  //      나갔든 안 나갔든) 결제완료로 처리해서 실시간 주문판에서 지운다.
  //      결제수단은 지정하지 않으므로 정산의 결제수단별 집계에는
  //      "미지정"으로 잡힌다(실제로 어떻게 결제됐는지 모르는 채로 강제
  //      마감된 것이므로 정직하게 미지정 처리).
  //   2) 그 다음 오늘 날짜로 결산 마감 스냅샷을 찍는다(POST
  //      /api/settlements/shift-close) — 오전에 한 번, 오후에 한 번 더
  //      찍으면 오후 것이 그날 스냅샷을 하루 전체 합계로 덮어써서 자연스럽게
  //      "오전 정산 = 점심 전까지 마감", "오후 정산 = 하루 마감"이 된다.
  //   3) 그 자리에서 LINE 마감 문자가 나간다(2026-09-10 사장님 요청,
  //      src/routes/settlements.js 의 shift-close 주석 참고). 숫자는 서버가
  //      계산해 돌려준 것을 아래 팝업에도 그대로 쓴다 — 화면과 문자와 장부가
  //      다른 숫자를 말하면 안 된다.
  //      예전에는 owner 전용인 POST /close 를 불러서, 직원이 이 버튼을
  //      누르면 스냅샷이 조용히 실패했다(403). shift-close 는 직원도 부를 수
  //      있다.
  // 오래된 날짜에 걸린(예: 며칠 전부터 안 닫힌) 주문까지 휩쓸리지 않도록
  // 오늘 생성된 주문만 대상으로 한다 — 그보다 오래된 미결제 주문은 결산
  // 탭의 "⚠️ 결제되지 않은 주문" 목록에 계속 남아 사장님이 따로 확인하게
  // 둔다.
  function openOrdersToday() {
    const todayLocalStr = localDateStr(new Date());
    return orders.filter(
      (o) =>
        ["new", "preparing", "served"].includes(o.status) &&
        localDateStr(new Date(o.created_at.replace(" ", "T"))) === todayLocalStr
    );
  }
  function computeHalfDaySettlement(startHour, endHour) {
    const todayLocalStr = localDateStr(new Date());
    const matching = orders.filter((o) => {
      if (o.status !== "paid") return false;
      const d = new Date(o.updated_at.replace(" ", "T"));
      if (localDateStr(d) !== todayLocalStr) return false;
      const hour = d.getHours();
      return hour >= startHour && hour <= endHour;
    });
    const total = matching.reduce((sum, o) => sum + (o.total || 0), 0);
    return { count: matching.length, total };
  }
  async function finalizeHalfDaySettlement({ isFullDay }) {
    const openOrders = openOrdersToday();
    const openTotal = openOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    const confirmMsg =
      openOrders.length > 0
        ? adminLang === "zh"
          ? `尚有 ${openOrders.length} 筆訂單尚未結帳（合計 NT$${openTotal}，不論餐點是否已出）。結算後將全部標記為已結帳並從看板移除，確定要繼續嗎？`
          : `아직 결제되지 않은 주문이 ${openOrders.length}건(합계 NT$${openTotal}) 있어요. 음식이 나갔든 안 나갔든 정산하면 전부 결제완료 처리되어 판에서 사라집니다. 진행할까요?`
        : adminLang === "zh"
        ? "確定要結算嗎？"
        : "정산을 진행할까요?";
    if (!(await showConfirm(confirmMsg))) return;

    if (openOrders.length > 0) {
      await Promise.all(openOrders.map((o) => updateOrderStatus(o.id, "paid")));
      await loadOrders();
      await loadTables();
    }

    // 마감 스냅샷 + LINE 마감 문자. 숫자는 서버가 계산해서 돌려준 것을
    // 그대로 쓴다 — 예전에는 여기서 computeHalfDaySettlement 로 따로 셌는데,
    // 그 함수가 "오전 = 0시~11시"라 점심 영업(11:00~14:00) 중 12시 이후에
    // 받은 돈이 오전 정산 금액에서 통째로 빠졌다. 화면과 문자와 장부가
    // 같은 숫자를 말해야 한다.
    let summary = null;
    try {
      const res = await fetch("/api/settlements/shift-close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shift: isFullDay ? "day" : "am" }),
      });
      if (res.ok) summary = await res.json();
    } catch (e) {
      // network error 등 — 아래에서 예전처럼 화면 계산으로 넘어간다.
    }

    // 서버에 못 닿았을 때만 화면에 있는 주문으로 어림한다. 이때는 오늘
    // 결제된 것 전부(0~23시)를 센다 — 시간대를 좁혀 세다 조용히 적게
    // 나오는 것보다 낫다.
    const count = summary ? summary.paid_order_count : computeHalfDaySettlement(0, 23).count;
    const total = summary ? summary.total_revenue : computeHalfDaySettlement(0, 23).total;

    // 주문 없이 인원수만 남아 있던 자리를 몇 개 비웠는지 알려준다. 조용히
    // 지우면 "내가 뭘 잘못 눌렀나" 가 되고, 안 알려주면 그 자리들이 왜
    // 갑자기 비었는지 모른다(src/partySize.js clearIdleSeats).
    const seatNote =
      summary && summary.cleared_seats
        ? adminLang === "zh"
          ? `\n${summary.cleared_seats} 桌只有人數、沒有點餐，已一併清空。`
          : `\n주문 없이 인원수만 남아 있던 ${summary.cleared_seats}자리도 같이 비웠어요.`
        : "";

    // 결제완료 칸에서 몇 건이 내려갔는지도 같은 이유로 알려준다 — 갑자기
    // 빈 칸을 보면 지워진 줄 안다. 지워진 게 아니라는 것까지 적는다.
    const settledNote =
      summary && summary.settled_orders
        ? adminLang === "zh"
          ? `\n結帳完成欄的 ${summary.settled_orders} 筆已收起（沒有刪除，結算與桌位歷史仍可查看）。`
          : `\n결제완료 칸의 ${summary.settled_orders}건은 내렸어요. 지운 게 아니라 결산 탭과 테이블 이전 주문에서 그대로 볼 수 있어요.`
        : "";

    // LINE 마감 문자가 왜 안 갔는지는 그 자리에서 알려준다 — 조용히 안 가면
    // 사장님은 갔다고 믿는다. 설정은 Admin > 설정 > 알림.
    let lineNote = "";
    if (summary && summary.line) {
      if (summary.line.sent) {
        lineNote = adminLang === "zh" ? "\n\n📩 已傳送 LINE 結算通知。" : "\n\n📩 LINE 정산 알림을 보냈어요.";
      } else if (summary.line.error === "disabled") {
        lineNote =
          adminLang === "zh"
            ? "\n\n(LINE 結算通知目前關閉中 — 設定 > 通知)"
            : "\n\n(LINE 정산 알림이 꺼져 있어요 — 설정 > 알림)";
      } else if (summary.line.error === "no_targets") {
        lineNote =
          adminLang === "zh"
            ? "\n\n(還沒有已核准的 LINE 收件人 — 設定 > 通知)"
            : "\n\n(LINE 알림 받을 사람이 아직 없어요 — 설정 > 알림)";
      } else {
        lineNote =
          adminLang === "zh"
            ? `\n\n⚠️ LINE 通知傳送失敗 (${summary.line.error})`
            : `\n\n⚠️ LINE 알림을 보내지 못했어요 (${summary.line.error})`;
      }
    }

    if (isFullDay) {
      // 오전 정산을 누른 날이면 오전/오후를 갈라 보여준다.
      const split =
        summary && summary.am_part && summary.pm_part
          ? adminLang === "zh"
            ? `\n(上午 NT$${summary.am_part.revenue} · 下午 NT$${summary.pm_part.revenue})`
            : `\n(오전 NT$${summary.am_part.revenue} · 오후 NT$${summary.pm_part.revenue})`
          : "";
      showAlert(
        (adminLang === "zh"
          ? `🌙 今日全天結算完成：已結帳 ${count} 筆，合計 NT$${total}`
          : `🌙 오늘 하루 정산 마감 완료: 결제 ${count}건, 합계 NT$${total}`) + split + seatNote + settledNote + lineNote
      );
    } else {
      showAlert(
        (adminLang === "zh"
          ? `🌅 今日上午結算完成：已結帳 ${count} 筆，合計 NT$${total}`
          : `🌅 오늘 오전 정산 마감 완료: 결제 ${count}건, 합계 NT$${total}`) + seatNote + settledNote + lineNote
      );
    }
  }
  $("#settleAmBtn").onclick = () => finalizeHalfDaySettlement({ isFullDay: false });
  $("#settlePmBtn").onclick = () => finalizeHalfDaySettlement({ isFullDay: true });

  const NEXT_STATUS = { new: "preparing", preparing: "served", served: "paid" };
  const statusLabel = (s) => T("status" + s.charAt(0).toUpperCase() + s.slice(1));
  const nextLabel = (s) => T("next" + s.charAt(0).toUpperCase() + s.slice(1));

  // 칼럼 안의 순서를 이 화면이 스스로 정한다 (2026-09-10).
  //
  // 예전에는 `orders` 배열에 담긴 순서를 그대로 믿고 쌓았다. 그 순서는
  // 서버가 정해준 것이라(GET /api/orders 의 sort), 화면을 갱신하려면 목록을
  // 통째로 다시 받아오는 수밖에 없었다. 주문 한 건만 바뀌어도 마찬가지였다.
  //
  // 서버와 같은 규칙을 여기서 쓴다: 드래그로 자리를 정해둔 것(queue_order)이
  // 먼저, 그 안에서는 정해둔 순서대로. 손대지 않은 것들은 그 뒤에 새 주문이
  // 위로 오게 id 역순. 결제완료 칼럼은 아래에서 자기만의 규칙으로 따로
  // 정렬하므로 여기를 거치지 않는다.
  //
  // 이렇게 해두면 배열 순서가 화면에 영향을 주지 않는다. 그래서 주문 한 건이
  // 바뀌었을 때 그 한 건만 갈아끼우고 다시 그려도 서버에서 통째로 받아온
  // 것과 같은 화면이 나온다 — applyOrderUpdate() 가 그걸 한다.
  function sortWithinColumn(list) {
    return list.slice().sort((a, b) => {
      const aHas = a.queue_order != null;
      const bHas = b.queue_order != null;
      if (aHas && bHas) return a.queue_order - b.queue_order;
      if (aHas !== bHas) return aHas ? -1 : 1;
      return b.id - a.id;
    });
  }

  function renderOrders() {
    const cols = { new: [], preparing: [], served: [], paid: [] };
    orders.forEach((o) => {
      if (cols[o.status]) cols[o.status].push(o);
    });
    cols.new = sortWithinColumn(cols.new);
    cols.preparing = sortWithinColumn(cols.preparing);
    cols.served = sortWithinColumn(cols.served);

    // 결제완료 칼럼은 오늘 결제된 주문만 보여준다 (2026-09 피드백) — 그 전에는
    // 전체 기간이 다 쌓여서 어제/그제 결제 건까지 계속 보였다. 지난 날짜의
    // 결제 내역은 테이블 상세 > 이전 주문 탭이나 결산 탭에서 계속 확인 가능.
    const todayLocalStr = localDateStr(new Date());
    cols.paid = cols.paid.filter((o) => localDateStr(new Date(o.updated_at.replace(" ", "T"))) === todayLocalStr);

    // 정산한 것은 내려간다 (2026-09-10 사장님: "정산 누르면 결제완료 애들
    // 없어지게 해줘"). 정산은 「여기까지 끊는다」는 뜻이라, 끊은 뒤에도 남아
    // 있으면 다음 장사의 결제와 섞여 어디까지가 정산한 몫인지 화면만 보고는
    // 가릴 수 없다. 줄이 지워지는 것은 아니다 — 결산 탭과 테이블 상세 >
    // 이전 주문에서 그대로 볼 수 있다(src/routes/settlements.js).
    cols.paid = cols.paid.filter((o) => !o.settled_at);

    // 결제된 것은 **전부 남긴다** — 한 자리에서 두 번 결제했어도 두 장이다.
    //
    // 2026-09-11 사장님: "실시간 주문 탭에서 결제 완료 중복 없애는 거 아예
    // 삭제해주고 그냥 계속 남게 해주고 정산때는 전부 삭제해주면 돼."
    //
    // 예전에는 「테이블당 최근 1건」만 보여줬다. 그래서 결산 9건이 화면에는
    // 7장으로 보였고, 특히 포장은 QR 하나를 모든 손님이 같이 써서 **다른
    // 손님이 덮였다**(王緦苹 님이 陳小姐 님에게 덮인 그 건). 쌓이는 것은
    // 위의 settled_at 필터가 정산 때 한 번에 치운다 — 그게 끊는 자리다.
    cols.paid.sort(
      (a, b) => new Date(b.updated_at.replace(" ", "T")) - new Date(a.updated_at.replace(" ", "T"))
    );

    let newCount = cols.new.length;
    const badge = $("#newOrderBadge");
    if (newCount > 0) {
      badge.hidden = false;
      badge.textContent = newCount;
    } else {
      badge.hidden = true;
    }

    Object.keys(cols).forEach((status) => {
      const col = document.querySelector(`.order-col[data-status="${status}"]`);
      col.querySelector(".col-count").textContent = `(${cols[status].length})`;
      const body = col.querySelector(".col-body");
      body.innerHTML = "";
      cols[status].forEach((o) => body.appendChild(renderOrderCard(o)));
    });
    renderPrintFailureBanner();
  }

  // ---------- Drag-to-move-or-reorder in the order queue ----------
  // Built on Pointer Events (pointerdown/pointermove/pointerup) instead of
  // the native HTML5 draggable/dragstart/dragover/drop API. The native API
  // only fires for a real mouse — it does NOT recognize touch input on a
  // tablet/touchscreen at all, in any browser. Pointer Events unify mouse,
  // touch, and pen under one event model, so the same code works on both
  // a desktop mouse/trackpad and a kitchen tablet.
  //
  // Dropping a card into a DIFFERENT status column (신규 주문 → 조리 중,
  // etc.) changes its status, exactly like pressing 다음 단계 — including
  // dragging it back a stage to undo a mistake, which the button alone
  // can't do. Dropping it back into the SAME column just reorders it
  // within that column's queue (bump a rushed table up, etc.) — this is
  // what "그 전이나 뒤로 옮길 수 있게" turned out to mean the first time
  // this was built, but staff actually meant moving a card to an earlier
  // or later STAGE, not just up/down a priority list, hence both.
  //
  // Only the small ⠿ handle in the card's corner (not the whole card)
  // starts a drag, so the rest of the card stays a normal tap target
  // (opens the order detail) and a touch column can still be scrolled
  // normally with a finger anywhere else on a card.
  function getDragAfterElement(container, y) {
    const candidates = [...container.querySelectorAll(".order-card:not(.dragging)")];
    return candidates.reduce(
      (closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) return { offset, element: child };
        return closest;
      },
      { offset: Number.NEGATIVE_INFINITY, element: null }
    ).element;
  }

  // Reads the column's final DOM order back out and persists it — to the
  // server, and into each card's queue_order so an intervening
  // renderOrders() (e.g. a poll landing before the PATCH resolves) doesn't
  // visually snap back.
  //
  // 2026-09-10: renderOrders() 가 칼럼별로 스스로 정렬하게 되면서, 화면을
  // 결정하는 것은 queue_order 하나가 됐다(sortWithinColumn). 아래에서
  // `orders` 배열 자체도 같이 재배치하는 것은 이제 화면에는 영향이 없지만,
  // 배열 순서와 queue_order 가 서로 어긋난 채 남지 않도록 그대로 둔다.
  async function persistColumnOrder(body) {
    const orderIds = [...body.querySelectorAll(".order-card")].map((el) => parseInt(el.dataset.orderId, 10));
    const idsSet = new Set(orderIds);
    let insertAt = 0;
    for (const o of orders) {
      if (idsSet.has(o.id)) break;
      insertAt++;
    }
    const remaining = orders.filter((o) => !idsSet.has(o.id));
    const reordered = orderIds.map((id) => orders.find((o) => o.id === id)).filter(Boolean);
    reordered.forEach((o, index) => (o.queue_order = index));
    orders = remaining.slice(0, insertAt).concat(reordered, remaining.slice(insertAt));
    await fetch("/api/orders/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderIds }),
    });
  }

  // Hit-tests which order-queue column body the pointer is currently over
  // (if any), so a drag can preview moving the card into a different
  // status column live, the same way a normal Kanban board works.
  function columnBodyAtPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    const col = el && el.closest(".order-col");
    return col ? col.querySelector(".col-body") : null;
  }

  // Wires a single card's drag handle.
  function wireCardDrag(card, handle, o) {
    let startY = 0;
    let pointerId = null;
    let moved = false;
    // Which column body the card is currently previewed inside — starts as
    // its own column, but can change mid-drag as the pointer crosses into
    // a different one (see columnBodyAtPoint()).
    dragSourceColumnBody = null;

    const onPointerMove = (e) => {
      if (pointerId === null || e.pointerId !== pointerId) return;
      e.preventDefault();
      if (!moved) {
        // A few pixels of slack so a plain tap on the handle doesn't count
        // as a drag.
        if (Math.abs(e.clientY - startY) < 4) return;
        moved = true;
        draggingOrderId = o.id;
        dragSourceColumnBody = card.parentElement;
        card.classList.add("dragging");
      }
      // Hit-test BEFORE moving the card, so this reads the real layout the
      // pointer is over rather than wherever the card last landed.
      const overBody = columnBodyAtPoint(e.clientX, e.clientY) || dragSourceColumnBody;
      dragSourceColumnBody = overBody;
      const afterElement = getDragAfterElement(overBody, e.clientY);
      if (afterElement == null) overBody.appendChild(card);
      else overBody.insertBefore(card, afterElement);
    };

    const finishDrag = async (e) => {
      if (pointerId === null || (e && e.pointerId !== pointerId)) return;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
      pointerId = null;
      card.classList.remove("dragging");
      const wasDragging = moved;
      moved = false;
      draggingOrderId = null;
      const body = dragSourceColumnBody;
      dragSourceColumnBody = null;
      if (wasDragging && body) {
        const targetStatus = body.closest(".order-col")?.dataset.status;
        if (targetStatus && targetStatus !== o.status) {
          // Dropped into a different stage's column — change status, same
          // as pressing 다음 단계 (works backwards too, to undo a mistake).
          //
          // ordersRequestSeq++ here — BEFORE the PATCH below is even sent —
          // matters: the steady 4-second poll's own GET can already be in
          // flight at this exact moment, and if it resolves while we're
          // still awaiting our PATCH, it has nothing "newer" to lose to yet
          // (a later loadOrders() call is what normally bumps the counter),
          // so it would apply normally and briefly flash the card back to
          // its old column before our own refresh corrects it a beat
          // later — the "왔다갔다 한 번" this was reported as. Bumping the
          // counter immediately marks any request already in flight as
          // stale right away, so that flash never happens.
          ordersRequestSeq++;
          const previousStatus = o.status;
          o.status = targetStatus; // reflect locally so the render below doesn't flicker back to the old column first
          const updated = await updateOrderStatus(o.id, targetStatus);
          if (!updated) {
            // The server rejected it — undo the optimistic change instead of
            // silently leaving the card wherever it was dropped, so staff
            // get a clear reason instead of watching it quietly snap back.
            o.status = previousStatus;
            await showAlert(T("orderStatusChangeFailed"));
            await loadOrders(); // 거절당했을 때는 서버 상태를 통째로 다시 맞춘다
            return;
          }
          applyOrderUpdate(updated); // 서버가 돌려준 그 한 건만 — 재조회 없음
          return;
        }
        // Dropped back into the same column — just a priority reorder.
        // Same reasoning as above — persistColumnOrder() also mutates
        // `orders` optimistically before its own PATCH resolves.
        ordersRequestSeq++;
        await persistColumnOrder(body);
      }
      // Catch up on anything a poll skipped re-rendering while this drag
      // was in progress (see the draggingOrderId guard in loadOrders()).
      renderOrders();
    };

    handle.onclick = (e) => e.stopPropagation(); // don't also open the order detail
    handle.onpointerdown = (e) => {
      if (e.button !== undefined && e.button !== 0) return; // left mouse button only (touch/pen have no `button`)
      e.preventDefault();
      e.stopPropagation();
      startY = e.clientY;
      pointerId = e.pointerId;
      // Deliberately NOT handle.setPointerCapture(pointerId) here — capture
      // ties later events to this exact element, but onPointerMove below
      // moves `card` (the handle's ancestor) around in the DOM every time
      // the drag crosses another card, via insertBefore/appendChild. That
      // re-insertion is enough for the browser to drop the capture
      // mid-gesture, which silently kills every pointermove/pointerup
      // event after the first reposition — drag "starts" but the drop
      // never registers. Same root cause as the render-vs-drag bug fixed
      // earlier for the old native-DnD version, just tripped by a
      // different API. Listening on window instead sidesteps it entirely:
      // window is never removed from the document, so nothing here can
      // ever interrupt the listener.
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", finishDrag);
      window.addEventListener("pointercancel", finishDrag);
    };
  }

  // A banner that doesn't go away on its own — sound + the card flash
  // (flashNewOrder) already fade after a few seconds, which is fine for
  // "a new order came in" but wrong for "and the kitchen might not have a
  // ticket for it", since that needs someone to actually go check the
  // printer. Each failed order also gets its own badge on its card (see
  // renderOrderCard) for when staff notice one card among many; this
  // banner is for noticing at a glance that something needs attention at
  // all, and for orders whose card isn't currently in view.
  // ---------- 데이터 저장 공간 경고 ----------
  // 사장님(2026-09-10): "3-4년 후에 내가 잊으면 큰일이잖아."
  //
  // 주문을 밖으로 뺀 뒤에도 결제기록·정산·예약은 계속 쌓여서 연 3~4MB 씩
  // 는다. MongoDB 문서 하나는 16MB 가 한도라 언젠가는 저장이 실패하는데,
  // 그때가 되어도 화면 어디에도 원인이 안 나온다. 그래서 한도의 25% 에서
  // 미리 알린다 — 알림을 본 뒤에도 몇 년의 여유가 있어서, 급히 손댈 필요
  // 없이 준비할 시간이 있다.
  //
  // 크기는 매일 밤 마감 정산이 재둔다(src/storeSize.js). 여기서는 그 값을
  // 읽기만 한다 — 화면이 열릴 때마다 재면 이 기능이 막으려는 바로 그 짓을
  // 하게 된다.
  async function renderStorageBanner() {
    const banner = $("#storageBanner");
    if (!banner) return;
    let info;
    try {
      const res = await fetch("/api/settings/storage");
      if (!res.ok) return;
      info = await res.json();
    } catch (e) {
      return; // 경고를 못 띄우는 것 자체가 장사를 막을 이유는 아니다
    }
    if (!info || (info.level !== "warn" && info.level !== "urgent")) {
      banner.hidden = true;
      return;
    }
    const mb = `${(info.bytes / 1024 / 1024).toFixed(1)}MB`;
    const urgent = info.level === "urgent";
    banner.className = `storage-banner ${info.level}`;
    banner.innerHTML = `
      <div>${urgent ? "🚨" : "ℹ️"} ${T(urgent ? "storageUrgentTitle" : "storageWarnTitle").replace("%s", mb)}</div>
      <div class="storage-banner-sub">${T(urgent ? "storageUrgentSub" : "storageWarnSub")}</div>
      ${info.checked_at ? `<div class="storage-banner-sub">${T("storageCheckedAt").replace("%s", info.checked_at)}</div>` : ""}
    `;
    banner.hidden = false;
  }

  function renderPrintFailureBanner() {
    const banner = $("#printFailBanner");
    if (!banner) return;
    if (printFailedOrderIds.size === 0) {
      banner.hidden = true;
      return;
    }
    const failed = orders.filter((o) => printFailedOrderIds.has(o.id));
    // 「테이블 13 (#296)」 — 자리 이름만으로는 같은 자리에 두 건이 쌓였을 때
    // 어느 것인지 가릴 수 없다.
    const places = failed.map((o) => `${orderPlaceLabel(o)} (#${o.id})`);
    const reasons = [...new Set(failed.map((o) => (printFailedInfo.get(o.id) || {}).reason).filter(Boolean))];
    banner.textContent = fmtPrintFailBanner(failed.length, places, reasons);
    banner.hidden = false;
  }

  function renderOrderCard(o) {
    const card = document.createElement("div");
    // 테스터 모드 주문은 한눈에 갈려야 한다(src/testMode.js). 테스트 기기는
    // 진짜 주문과 테스트 주문을 같이 보므로, 표시가 없으면 직원이 없는
    // 손님의 음식을 만든다.
    card.className =
      "order-card" +
      (printFailedOrderIds.has(o.id) ? " print-failed" : "") +
      (o.test_session ? " test-order" : "");
    card.dataset.orderId = o.id;
    const time = new Date(o.created_at.replace(" ", "T")).toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    // 매장(dine-in) is chosen per dish now, so one order can mix both — the
    // header badge below only covers the uniform cases (order_type is
    // "dine_in"/"takeout" when every item agrees, "mixed" otherwise, see
    // src/routes/orders.js). For a mixed order we also tag each individual
    // takeout line here, since the header badge alone can't say which dish
    // needs to-go packaging.
    const itemLines = o.items.map((it) => {
      const label = `${it.code ? `${it.code} ` : ""}${itemName(it)} x${it.qty}${it.option_choice ? `(${optionLabel(it.option_choice)})` : ""}${it.takeout_choice ? `(${it.takeout_choice})` : ""}`;
      const perItemTag =
        o.order_type === "mixed" && it.order_type === "takeout"
          ? ` <span class="order-card-type-badge takeout">${T("orderCardTakeoutBadge")}</span>`
          : "";
      return label + perItemTag;
    });
    // A table's big order (lots of dishes) used to make its card grow to
    // however many lines that took, which forced a long scroll through the
    // whole 신규/조리중 column to see everything below it. Past the
    // threshold, only show the first few and offer 펼치기 for the rest —
    // expandedOrderIds (declared up top) remembers the choice across the
    // 4-second auto-refresh re-render.
    const expanded = expandedOrderIds.has(o.id);
    const overflowCount = itemLines.length - ORDER_ITEMS_COLLAPSE_THRESHOLD;
    const visibleLines = expanded || overflowCount <= 0 ? itemLines : itemLines.slice(0, ORDER_ITEMS_COLLAPSE_THRESHOLD);
    const itemsHtml = visibleLines.join("<br/>");
    const itemsToggleHtml =
      overflowCount > 0
        ? `<button type="button" class="order-items-toggle" data-toggle-items-id="${o.id}">${
            expanded ? T("collapseItemsBtn") : fmtExpandItemsBtn(overflowCount)
          }</button>`
        : "";
    // 매장(dine-in) orders are the overwhelming default and stay unbadged;
    // 포장(takeout)/혼합(mixed) get a badge right in the live queue so staff
    // notice to-go packaging is needed without opening/printing the ticket.
    const typeBadge =
      o.order_type === "takeout"
        ? `<span class="order-card-type-badge takeout">${T("orderCardTakeoutBadge")}</span>`
        : o.order_type === "mixed"
          ? `<span class="order-card-type-badge mixed">${T("orderCardMixedBadge")}</span>`
          : o.order_type === "delivery"
            ? `<span class="order-card-type-badge delivery">${T("orderCardDeliveryBadge")}</span>`
            : "";
    const failInfo = printFailedInfo.get(o.id);
    const printFailedNotice = printFailedOrderIds.has(o.id)
      ? `<div class="order-card-print-fail">${escapeHtml(fmtPrintFailCard(orderPlaceLabel(o), o.id, failInfo && failInfo.reason))}</div>`
      : "";
    // 포장 카운터 orders aren't a real table — "테이블 COUNTER" would be
    // meaningless to staff, so show its pickup number + name instead.
    const tableTag = isCounterOrder(o) ? fmtCounterOrderTag(o) : `${T("tableLabel")} ${o.table_number}${partyTag(o)}`;
    // 자리를 옮긴 주문 — 주방에는 이미 옛 번호가 찍힌 티켓이 나가 있다.
    // 이 표시가 없으면 "5번 것이 왜 8번에 있지" 가 된다.
    const movedTag = o.moved_from ? `<span class="order-card-moved">${fmtMovedFrom(o.moved_from)}</span>` : "";
    // 위치 확인이 안 된 주문 — 「멀리 있다」가 아니라 「확인 못 했다」이다.
    // 실내라 위치가 안 잡혔거나 손님이 권한을 거부한 경우가 대부분이고,
    // 그래도 자리에 앉아 계신 손님이다. 직원이 눈으로 보고 판단하도록
    // 사실만 적어 둔다(src/routes/orders.js).
    const locTag = o.location_unverified ? `<span class="order-card-loc-unverified">${T("orderCardLocUnverified")}</span>` : "";
    card.innerHTML = `
      <div class="order-card-top">
        <span>${tableTag}${typeBadge}${movedTag}${locTag}${
          o.test_session ? '<span class="order-card-test-badge">테스트</span>' : ""
        }</span>
        <span class="order-card-top-right">
          <span class="order-card-time">${time}</span>
          <span class="order-card-drag-handle" title="${T("dragHandleTitle")}">⠿</span>
        </span>
      </div>
      ${printFailedNotice}
      <div class="order-card-items">${itemsHtml}</div>
      ${itemsToggleHtml}
      <div class="order-card-total">NT$${o.total}</div>
      <div class="order-card-actions" id="actions-${o.id}"></div>
    `;
    // Drag-to-reorder within this same column, via the ⠿ handle above (see
    // wireCardDrag()) — staff can bump a particular order up/down the
    // queue by hand, e.g. a table that asked to rush their order.
    wireCardDrag(card, card.querySelector(".order-card-drag-handle"), o);
    const itemsToggleBtn = card.querySelector("[data-toggle-items-id]");
    if (itemsToggleBtn) {
      itemsToggleBtn.onclick = (e) => {
        e.stopPropagation();
        if (expandedOrderIds.has(o.id)) expandedOrderIds.delete(o.id);
        else expandedOrderIds.add(o.id);
        renderOrders();
      };
    }
    const actions = card.querySelector(`#actions-${o.id}`);
    if (NEXT_STATUS[o.status]) {
      const btn = document.createElement("button");
      btn.className = "primary";
      btn.textContent = nextLabel(o.status);
      btn.onclick = async (e) => {
        e.stopPropagation();
        // 2026-09-10: 예전에는 요청만 던져놓고 화면 갱신을 **서버가 되쏘는
        // Pusher 알림**에 기대고 있었다. 즉 카드가 움직이려면 PATCH 왕복,
        // Pusher 왕복, 주문 목록 재조회가 차례로 다 끝나야 했다. 누른 사람
        // 입장에서는 그 셋을 전부 기다리는 시간이 「조리 시작」의 반응
        // 속도였다.
        //
        // 서버는 갱신된 주문을 PATCH 응답으로 이미 돌려준다. 그것으로 바로
        // 갱신하면 왕복 하나로 끝난다.
        btn.disabled = true; // 왕복 도중 두 번 눌려 단계가 두 칸 가지 않게
        const updated = await updateOrderStatus(o.id, NEXT_STATUS[o.status]);
        if (!applyOrderUpdate(updated)) await loadOrders();
      };
      actions.appendChild(btn);
    }
    if (o.status !== "cancelled" && o.status !== "paid" && canCancelOrder()) {
      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = T("cancelBtn");
      cancelBtn.onclick = async (e) => {
        e.stopPropagation();
        if (!(await showConfirm(T("confirmCancelOrder")))) return;
        const updated = await updateOrderStatus(o.id, "cancelled");
        if (!applyOrderUpdate(updated)) await loadOrders();
      };
      actions.appendChild(cancelBtn);
    }
    if (o.status !== "cancelled" && o.status !== "paid" && canEditOrder()) {
      const editBtn = document.createElement("button");
      editBtn.textContent = T("orderEditBtn");
      editBtn.onclick = (e) => {
        e.stopPropagation();
        openOrderEdit(o);
      };
      actions.appendChild(editBtn);
    }
    const printBtn = document.createElement("button");
    printBtn.textContent = T("printBtn");
    printBtn.onclick = async (e) => {
      e.stopPropagation();
      // A manual click is a real user gesture, so this can't be
      // popup-blocked the way the automatic 자동 인쇄 path can be — clicking
      // 인쇄 again is exactly the retry for a card showing 인쇄 실패.
      await printKitchenTicket(o);
      renderOrders();
    };
    actions.appendChild(printBtn);
    const previewBtn = document.createElement("button");
    previewBtn.textContent = T("previewBtn");
    previewBtn.onclick = (e) => {
      e.stopPropagation();
      previewKitchenTicket(o);
    };
    actions.appendChild(previewBtn);
    card.onclick = () => openOrderDetail(o);
    return card;
  }

  function flashNewOrder(id) {
    setTimeout(() => {
      const el = document.querySelector(`.order-card[data-order-id="${id}"]`);
      if (el) el.classList.add("flash");
    }, 50);
  }

  // ---------- Kitchen ticket printing (thermal receipt version) ----------
  // Simple kitchen-bill-style ticket for a real narrow-roll thermal receipt
  // printer (confirmed with the owner — not a regular A4 printer), replacing
  // the earlier photo-overlay recreation of the paper order slip. The
  // owner's spec: which table, when, each menu item's name + quantity, the
  // order type (內用/dine-in, 外帶/takeout — picked per dish via the
  // .order-type-tabs pill inside order.html's item sheet, or 外送/delivery,
  // a possible future order_type value with no customer-facing UI yet — see
  // order_type in src/routes/orders.js), and the 소/돼지 (option_choice) and
  // 맵기 (spice_choice) distinctions per item, printed as clearly-labeled
  // sub-lines (see "detail" comment below) so the kitchen never mistakes an
  // item's meat-type/spice-level for a second item. Since order type is now
  // chosen per dish, a single order can mix 內用 and 外帶 — the header badge
  // shows the order-level summary (dine_in/takeout/mixed, see orders.js) and
  // each individual takeout dish additionally gets its own "└ 外帶" line so
  // the kitchen can't miss which specific item needs to-go packaging.
  // No more hand-measured coordinates onto a fixed photo — each ordered
  // line just flows down the narrow strip, so a menu item added after the
  // fact needs no special "extra items" handling like the old system did.
  //
  // Every fixed label on this ticket is in Traditional Chinese (this
  // restaurant's kitchen staff read Chinese, not Korean) — only the dish
  // names come from whichever language that menu item actually has
  // (name_zh preferred, falling back to name_ko/name_en if a dish was never
  // given a Chinese name).
  function orderTypeLabel(o) {
    if (o.order_type === "mixed") return "混合";
    if (o.order_type === "takeout") return "外帶";
    if (o.order_type === "delivery") return "外送";
    return "內用";
  }

  // Per-component font sizes (px) for the kitchen ticket — adjustable by
  // the owner in Settings > "빌지 글자 크기" (see loadTicketFontSizes() /
  // #saveTicketFontSizesBtn below), independently of each other, with a
  // live actual-size preview in that settings card. These are the
  // fallback/default values (= this ticket's original fixed sizes) used
  // until the owner changes them, or if the setting fails to load.
  const DEFAULT_TICKET_FONT_SIZES = {
    storeName: 17, // header line ("한국관 廚房出單")
    tableNo: 13, // "桌號 12" text
    orderTypeBadge: 13, // 內用/外帶/混合 badge next to the table number
    time: 13, // order time, its own row under the table number
    itemName: 16, // each dish's name + quantity
    itemDetail: 13, // └ meat-type/spice lines under a dish
    itemTakeout: 13, // └ 外帶 line under a dish ordered as takeout
    // 사장님 피드백(2026-09-08): "크기, 두께 전부 설정할 수 있잖아 영수증.
    // 거기에 금액 버전도 설정할 수 있게 해줘 현재 있는 것과 같이" — 결제용
    // (금액) 사본에서만 찍히는 └ NT$ 줄. 지금까지는 itemDetail 크기를
    // 같이 쓰고 굵기는 700으로 고정돼 있었는데, 계산할 때 한눈에 들어와야
    // 하는 숫자라 다른 세부사항(소/맵기 등)과 별도로 조절할 수 있게 뺐다.
    itemPrice: 13, // └ NT$(결제용 사본 품목 금액) 줄
    total: 16, // 合計 row
    // 원래 이름 그대로 orderNote(전체 주문 메모, o.note 렌더링)를 위한
    // 크기였는데, 손님 주문 화면에서 整單備註 입력칸이 완전히 삭제되면서
    // (커밋 e0f1b86) o.note는 다시는 채워질 수 없는 값이 됐다(2026-09-08
    // 피드백: "여전히 저 가장 아래 빨간 글씨가 그거 아니야?" — 맞음, 같은
    // 문제였다). 그 렌더링(.order-note)은 지웠고, 이 크기 값은 결제용
    // (금액) 사본 하단에만 찍히는 참고 문구 두 가지(price-copy-note —
    // "※本單僅供結帳參考..." / "※ 飲料/酒類恕不折扣")에 그대로 재사용
    // 중이라 키 이름·서버 저장 필드는 바꾸지 않고 놔둠(설정 라벨만 실제
    // 역할에 맞게 수정 — 아래 tfsOrderNote 참고).
    orderNote: 11,
    printTime: 10, // footer 列印時間 line
    // 사장님 피드백(2026-09-06): "그 부분들 전부 글자 굵기 조절하는것도
    // 추가해줘" — 위 크기 항목과 정확히 같은 11개 부위에 대한 굵기
    // (CSS font-weight). 기본값은 지금까지 하드코딩되어 있던 실제 값
    // 그대로라서, 사장님이 직접 바꾸기 전까지는 인쇄 결과가 1px도 안
    // 달라진다. 400/700/900만 고를 수 있게 한 이유는 아래 buildTicketHtml의
    // Google Fonts 링크가 이 세 굵기만 실제로 불러오기 때문 — 그 외
    // 값(예: 500)을 넣어도 브라우저가 가장 가까운 걸로 대충 흉내만 내서
    // 눈으로 차이가 잘 안 보인다.
    storeNameWeight: 900,
    tableNoWeight: 700,
    orderTypeBadgeWeight: 900,
    timeWeight: 700,
    itemNameWeight: 900,
    itemDetailWeight: 400,
    itemTakeoutWeight: 900,
    itemPriceWeight: 700,
    totalWeight: 900,
    orderNoteWeight: 400,
    printTimeWeight: 400,
  };
  let ticketFontSizes = { ...DEFAULT_TICKET_FONT_SIZES };

  // `opts.screenPreview` controls only the on-screen "paper on a desk"
  // chrome (gray background, drop shadow, 2.4x zoom, flex-centering) —
  // it's on (default) for the real previewKitchenTicket()/printKitchenTicket()
  // tab, and off for the small actual-size live preview embedded directly
  // in the Settings > 빌지 글자 크기 card (an <iframe>, already exactly
  // 80mm wide in its own box, where zooming/centering would be wrong).
  // `fontSizes` overrides individual component sizes — pass a partial
  // object; anything not given falls back to DEFAULT_TICKET_FONT_SIZES.
  // 사장님 요청(2026-09-07): "주문서 2장인출 한장은 지금처럼 주방용, 다른
  // 한장은 각각의 가격이 나오게... 화면을 안보고 결제시도를 하게 됐을때
  // 가격이 나온 주문서를 보고 계산을 할 수 있도록. 할인이 들어가면 그
  // 안에 음료수같은 것은 제하는 부분도 있으니까 보다 명료해야함" —
  // priceCopy가 true면 기존 주방용 티켓과 똑같은 내용에 품목별 금액을 한
  // 줄씩 더 붙이고(단가×수량, 애드온 포함), 할인 대상에서 빠지는 음료·
  // 주류 품목(category_key === "drink" — 위 computeVipDiscount/
  // discountEligibleTotal과 같은 기준)은 별도로 표시해서, 화면 없이 이
  // 종이만 보고 계산해도 헷갈리지 않게 한다. 실제 할인 금액 자체는 결제
  // 시점에 고른 할인(特約95折/VIP9折/직접 입력)에 따라 달라지므로 여기서
  // 미리 계산해 찍지 않고, 맨 아래에 "참고용" 문구만 남긴다.
  //
  // <style> 블록(글자 크기 fontSizes 반영)과 이 본문(.receipt 안쪽)은
  // 서로 독립적이라(본문은 클래스 이름만 쓰고 인라인 크기값은 안 씀)
  // 따로 뽑아뒀다 — buildTicketHtml(한 장짜리 문서)과 아래
  // buildDualTicketHtml(주방용+결제용 두 장을 한 인쇄 작업에 담는 문서)이
  // 이 함수 하나를 그대로 재사용한다.
  // 브라우저로 인쇄하는 빌지에도 같은 표시. ESC/POS 두 갈래(escpos.js)와
  // 문구를 맞춘다 — 어느 경로로 나오든 주방이 보는 종이는 같아야 한다.
  function testTicketBannerHtml(o) {
    if (!o || !o.test_session) return "";
    return (
      '<div style="text-align:center;border:3px solid #000;padding:6px;margin-bottom:8px;">' +
      '<div style="font-size:1.4em;font-weight:900;">*** 테스트 / 測試 ***</div>' +
      '<div style="font-weight:700;">이 주문은 만들지 마세요</div>' +
      '<div style="font-weight:700;">請勿製作此訂單</div>' +
      "</div>"
    );
  }

  function buildReceiptBodyHtml(o, priceCopy) {
    const time = new Date(o.created_at.replace(" ", "T")).toLocaleString("zh-TW");
    const storeName = (storeSettings && (storeSettings.store_name_zh || storeSettings.store_name_ko)) || "한국관";
    // 사장님 피드백(2026-09-07): "할인 반영 안될 때는 굳이 음료수 얘기
    // 안해도 되고" — 이 주문(정확히는 테이블/포장카운터 단위, 결제 팝업과
    // 완전히 같은 규칙)에 지금 걸려 있는 할인이 없으면 { active: false }를
    // 반환해서 아래 렌더링 쪽에서 가격/음료 관련 문구를 전부 건너뛴다.
    // 特約95折/VIP9折(퍼센트 할인)만 품목별로 나눠 보여줄 수 있고
    // (discountEligibleClientTotal/computeVipDiscountClient 참고), 직접
    // 입력(재량, isPercent:false)은 음료를 빼지 않고 품목별로도 못 나누는
    // 기존 규칙(위 fullEligibleClientTotal 주석) 그대로 유지 — 그때는
    // 소계/합계에서만 할인 반영된 금액을 보여준다.
    const discountInfo = priceCopy ? computeTicketDiscountInfo(o) : { active: false };
    let hasDrinkItem = false;

    const itemRows = o.items
      .map((it) => {
        const name = it.name_zh || it.name_ko || it.name_en || "";
        // Each attribute of the item (meat type, spice level, note) gets
        // its own indented "└" line instead of being crammed onto one line
        // — the owner asked for this specifically so a busy kitchen can
        // never mistake "牛" / "豬" / a spice level for a second dish.
        const detailLines = [];
        if (it.option_choice) detailLines.push(`<div class="item-detail">└ ${it.option_choice}</div>`);
        // 基本(default spice level) stays implicit and is never printed —
        // every menu item's spice_options starts with "基本" (see seed.js),
        // so an unprinted spice line already means "기본맛, 안 바뀜" to the
        // kitchen. Only a spice choice that actually differs from that
        // default (不辣/小辣/中辣/大辣/辣) is worth a line, same "only the
        // exception gets called out" pattern already used for 매장/外帶
        // below (owner: "특별히 맵기 안 바꾸면 기본맛이야").
        if (it.spice_choice && it.spice_choice !== "基本") detailLines.push(`<div class="item-detail">└ ${it.spice_choice}</div>`);
        (it.selected_addons || []).forEach((a) => detailLines.push(`<div class="item-detail">└ +${a.name}</div>`));
        // 부대찌개(部隊鍋) 포장 전용 조리 여부(不煮外帶/煮熟外帶) — priceCopy
        // 여부와 무관하게 항상 찍는다. 조리 여부는 결제 화면이 아니라
        // 주방이 판단해야 하는 정보라서 option_choice/spice_choice와 같은
        // 취급이다(사장님 메모: "부대찌개 포장주문할때 두가지 옵션이
        // 있대. 不煮外帶 → 조리하지 않은 포장 / 煮熟外帶 → 조리한 포장").
        if (it.takeout_choice) detailLines.push(`<div class="item-detail item-takeout">└ ${it.takeout_choice}</div>`);
        // 매장(dine-in) is this dish's default and stays implicit — only
        // 外帶(takeout) is called out per-dish, since that's the one that
        // changes how the kitchen has to send it out. See the file-level
        // comment above for why this exists even when the order-level badge
        // already says takeout/mixed.
        if (it.order_type === "takeout") detailLines.push(`<div class="item-detail item-takeout">└ 外帶</div>`);
        // 메뉴별 개별 요청사항(itemNote) 입력칸은 손님 주문 화면에서 완전히
        // 제거됐고(커밋 d5440f5) 관리자 쪽에도 대신 입력할 곳이 없어서, 이
        // 줄은 어떤 주문에서도 다시는 채워질 일이 없다 — 렌더링 자체를
        // 지웠다(사장님 피드백: "요청사항 손님한테 받는 거 아예 없애기로
        // 했었잖아. 여전히 있는데?").
        // priceCopy 전용 — 품목 금액(단가+애드온 합계)×수량. 주방용
        // 사본에는 안 넣는다(주방은 가격을 알 필요가 없고, 오히려 화면이
        // 복잡해질 뿐이다). 할인이 걸려 있는 特約95折/VIP9折(퍼센트)이면
        // 화면(vipPriceHtml)과 완전히 같은 공식으로 품목별 할인가를 같이
        // 찍어서, 화면을 안 보고도 이 티켓만으로 정확한 금액을 셀 수 있게
        // 한다 — 음료/주류는 이 할인에서 제외되므로 원가 그대로에 "※"만
        // 짧게 붙이고(품목마다 긴 문구를 반복하면 음료가 여러 개일 때
        // 지저분해진다는 피드백), 설명 문구는 아래 합계 위에 한 번만
        // 넣는다(hasDrinkItem/drinkFootnoteHtml 참고). 직접 입력(재량)
        // 할인은 음료를 빼지 않고 품목별로도 안 나누므로(위 주석) 이
        // 블록에서는 아무 것도 달라지지 않는다.
        if (priceCopy) {
          const amount = lineTotalOf(it);
          const isDrink = it.category_key === "drink";
          if (isDrink) hasDrinkItem = true;
          if (discountInfo.active && discountInfo.isPercent && !isDrink) {
            const discounted = amount - Math.round(amount * (1 - discountInfo.rate));
            detailLines.push(
              `<div class="item-detail item-price">└ <span class="item-price-orig">NT$${amount}</span> <span class="item-price-final">NT$${discounted}</span></div>`
            );
          } else {
            const mark = discountInfo.active && discountInfo.isPercent && isDrink ? " ※" : "";
            detailLines.push(`<div class="item-detail item-price">└ NT$${amount}${mark}</div>`);
          }
        }
        return `<div class="item-row">
          <div class="item-main"><span class="item-name">${name}</span><span class="item-qty">x${it.qty}</span></div>
          ${detailLines.join("")}
        </div>`;
      })
      .join("");

    return `<div class="receipt">
    ${testTicketBannerHtml(o)}
    <div class="header"><div class="store-name">${storeName} ${priceCopy ? "結帳單" : "廚房出單"}</div></div>
    <div class="divider"></div>
    <div class="meta-row"><span class="table-no">${
      isCounterOrder(o)
        ? o.pickup_number && o.customer_name
          ? `📦 ${o.pickup_number}號 · ${o.customer_name}`
          : "外帶櫃檯"
        : `桌號 ${o.table_number}${partyTag(o)}`
    }</span><span class="order-type-badge">${orderTypeLabel(o)}</span></div>
    ${isCounterOrder(o) && o.customer_phone ? `<div class="meta-row"><span class="order-time">☎ ${o.customer_phone}</span></div>` : ""}
    <div class="meta-row"><span class="order-time">${time}</span></div>
    <div class="divider"></div>
    ${itemRows}
    ${
      discountInfo.active && hasDrinkItem && discountInfo.isPercent
        ? `<div class="price-copy-note price-copy-drink-note">※ 飲料/酒類恕不折扣</div>`
        : ""
    }
    <div class="total-row"><span>合計</span><span>${
      discountInfo.active
        ? `<span class="total-price-orig">NT$${o.total}</span> NT$${discountInfo.discountedTotal}`
        : `NT$${o.total}`
    }</span></div>
    ${priceCopy ? `<div class="price-copy-note">※本單僅供結帳參考，實際折扣依系統結帳畫面為準</div>` : ""}
    <div class="print-time">列印時間：${new Date().toLocaleString("zh-TW")}</div>
  </div>`;
  }

  // 위 buildReceiptBodyHtml()의 .receipt 마크업을 실제 인쇄 가능한 HTML
  // 문서로 감싼다 — <style>은 fontSizes(빌지 글자 크기 설정)에 따라
  // 달라지므로 여기서 한 번만 계산해서 공유한다. 문서 하나에 .receipt를
  // 몇 장 넣을지는 `bodyHtml`을 넘기는 쪽(buildTicketHtml/
  // buildDualTicketHtml)이 정한다.
  function wrapReceiptDocument(bodyHtml, fontSizes, screenPreview) {
    const fs = Object.assign({}, DEFAULT_TICKET_FONT_SIZES, fontSizes || {});
    // Only the standalone preview/print tab gets the gray "desk" background
    // + shadow + 2.4x zoom + centering — the embedded Settings-card preview
    // needs none of that (it's already a small fixed-size box at true 1x
    // scale), and none of it should ever reach the real printed page.
    const screenChromeCss = screenPreview
      ? `
  html, body { height: 100%; }
  body {
    background: #dfe3e7;
    min-height: 100%;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 28px 0;
  }
  .receipt {
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
    zoom: 2.4;
  }
  @media print {
    html, body { height: auto; }
    body { background: none; min-height: 0; display: block; padding: 0; }
    .receipt { box-shadow: none; margin: 0; zoom: 1; }
  }`
      : "";

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<!-- 사장님 피드백(2026-09-06): "굵기도 사이즈 크기처럼 숫자로 정할 수 있게 해줄래?" —
     굵기 입력을 3단계 <select>에서 100~900 사이 아무 100단위 숫자나 입력하는
     <input type=number>로 바꿨다. Noto Sans TC/KR은 (가변 폰트가 아니라)
     100/200/.../900의 9개 고정 굵기 파일로만 제공되므로, 사용자가 고를 수 있는
     값 전부를 실제로 로드해둬야 브라우저가 안 쓴 굵기를 가짜로 합성(synthetic
     bold)하지 않고 폰트 파일 그대로의 굵기로 렌더링한다. -->
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@100;200;300;400;500;600;700;800;900&family=Noto+Sans+KR:wght@100;200;300;400;500;600;700;800;900&display=swap" />
<style>
  /* 80mm narrow-roll thermal/receipt printer, not A4 — height is left to
     "auto" since the roll cuts to whatever length the content needs. */
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
  body {
    margin: 0;
    font-family: "Noto Sans KR", "Noto Sans TC", "PMingLiU", sans-serif;
    color: #000;
  }
  .receipt { width: 80mm; background: #fff; padding: 3mm 4mm; }
  .header { text-align: center; margin-bottom: 2mm; }
  .store-name { font-size: ${fs.storeName}px; font-weight: ${fs.storeNameWeight}; }
  .divider { border-top: 1px dashed #000; margin: 2mm 0; }
  .meta-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1mm; }
  .table-no { font-size: ${fs.tableNo}px; font-weight: ${fs.tableNoWeight}; }
  .order-type-badge { display: inline-block; font-size: ${fs.orderTypeBadge}px; font-weight: ${fs.orderTypeBadgeWeight}; border: 1.5px solid #000; padding: 0.5mm 2mm; border-radius: 3px; }
  .order-time { font-size: ${fs.time}px; font-weight: ${fs.timeWeight}; }
  .item-row { padding: 2mm 0; border-bottom: 1px dotted #999; }
  .item-row:last-child { border-bottom: none; }
  .item-main { display: flex; justify-content: space-between; gap: 3mm; font-size: ${fs.itemName}px; font-weight: ${fs.itemNameWeight}; }
  .item-name { flex: 1; }
  .item-qty { white-space: nowrap; }
  .item-detail { font-size: ${fs.itemDetail}px; font-weight: ${fs.itemDetailWeight}; color: #333; margin-top: 0.5mm; padding-left: 1mm; }
  .item-takeout { font-size: ${fs.itemTakeout}px; font-weight: ${fs.itemTakeoutWeight}; color: #000; }
  .item-price { font-size: ${fs.itemPrice}px; font-weight: ${fs.itemPriceWeight}; color: #000; }
  .item-price-orig { color: #999; text-decoration: line-through; margin-right: 1mm; font-weight: 400; }
  .item-price-final { font-weight: ${fs.itemPriceWeight}; color: #000; }
  .total-row { display: flex; justify-content: space-between; font-size: ${fs.total}px; font-weight: ${fs.totalWeight}; margin-top: 2mm; padding-top: 2mm; border-top: 1px dashed #000; }
  .total-price-orig { color: #999; text-decoration: line-through; margin-right: 1mm; font-weight: 400; }
  .price-copy-note { font-size: ${fs.orderNote}px; color: #555; margin-top: 2mm; text-align: center; }
  .price-copy-drink-note { color: #966; margin-top: 1mm; }
  .print-time { text-align: center; font-size: ${fs.printTime}px; font-weight: ${fs.printTimeWeight}; color: #555; margin-top: 3mm; }
  .receipt-page-break { break-after: page; page-break-after: always; }
  ${screenChromeCss}
</style>
</head><body>
  ${bodyHtml}
</body></html>`;
  }

  function buildTicketHtml(o, fontSizes, opts) {
    const screenPreview = !opts || opts.screenPreview !== false;
    const priceCopy = !!(opts && opts.priceCopy);
    return wrapReceiptDocument(buildReceiptBodyHtml(o, priceCopy), fontSizes, screenPreview);
  }

  // 사장님 요청(2026-09-07): "주문서 2장인출 한장은 지금처럼 주방용, 다른
  // 한장은 각각의 가격이 나오게" — 실물 프린터(QZ Tray/RawBT/앱 브릿지)
  // 경로는 각자 티켓을 2번 따로 인쇄해서 2장을 뽑지만(각 인쇄 함수 참고),
  // 브라우저 print() 경로는 인쇄 대화상자가 두 번 뜨는 걸 피하려고 한
  // 문서 안에 .receipt 두 장(주방용 + 결제용)을 넣고 그 사이에
  // break-after: page를 줘서 한 번의 print() 호출로 (프린터/드라이버가
  // 페이지 사이 자동 커팅을 지원하면) 2장이 이어서 나오게 한다.
  function buildDualTicketHtml(o, fontSizes) {
    const kitchenReceipt = buildReceiptBodyHtml(o, false);
    const priceReceipt = buildReceiptBodyHtml(o, true);
    const bodyHtml = `<div class="receipt-page-break">${kitchenReceipt}</div>${priceReceipt}`;
    return wrapReceiptDocument(bodyHtml, fontSizes, false);
  }

  // Prints via the exact same code path as previewKitchenTicket (a real
  // window.open tab) instead of a hidden iframe, so print renders
  // byte-for-byte what 미리보기 already showed.
  // Neither print path can actually confirm paper came out of the printer
  // — browsers deliberately don't expose that, and QZ Tray only confirms
  // the raw ESC/POS bytes were handed to the printer connection, not that
  // it had paper or wasn't jammed. What we CAN detect and must not swallow
  // silently: the browser-print popup getting blocked, which is a very
  // real failure mode here specifically, since 자동 인쇄 fires this from the
  // 4-second order-polling timer (see startPolling/loadOrders below), not
  // from a click — exactly the kind of call popup blockers exist to stop.
  // When that happens the kitchen never gets a ticket and, without this,
  // nobody would know: the paper just never comes out. markPrintFailed()/
  // markPrintSucceeded() turn that into a visible banner + card badge
  // instead (see renderPrintFailureBanner() and the badge in
  // renderOrderCard()), and the existing manual 인쇄 button on each card
  // doubles as the retry — being a real click, it can't be popup-blocked.
  //
  // 2026-09-10 사장님: "인쇄 실패가 떴어. 그럼 어떤 테이블이 실패했는지도
  // 알 수 있게 해줘. 13번이 안 나왔거든."
  //
  // 띠에는 테이블 번호가 적혀 있었지만 카드 쪽 문구에는 없었다. 신규 주문이
  // 여러 건 쌓여 있으면 실패한 카드는 아래로 밀려 화면 밖에 있고, 눈에
  // 들어오는 것은 「인쇄 실패」 네 글자뿐이다. 어느 자리인지는 그 카드를
  // 찾아내야 알 수 있었다. 찍힌 자리를 찾는 것이 실패를 아는 것보다 오래
  // 걸리면 안 된다.
  //
  // 그래서 실패한 자리와 이유를 같이 들고 있는다. 이유는 사다리의 어느
  // 칸에서 떨어졌는지다 — 오늘 하루 「조용히 아무 일도 안 일어남」을 네 번
  // 겪었고, 매번 이유를 아는 데 시간이 다 갔다.
  const printFailedInfo = new Map(); // orderId -> { table, reason }
  function markPrintFailed(orderId, info) {
    printFailedOrderIds.add(orderId);
    if (info) printFailedInfo.set(orderId, info);
  }
  function markPrintSucceeded(orderId) {
    printFailedOrderIds.delete(orderId);
    printFailedInfo.delete(orderId);
  }
  /** 화면에 적을 자리 이름 — 포장은 번호가 아니라 픽업 이름으로 부른다. */
  function orderPlaceLabel(o) {
    if (!o) return "";
    if (isCounterOrder(o)) {
      return o.pickup_number && o.customer_name
        ? `📦 ${o.pickup_number}번 · ${o.customer_name}`
        : T("takeoutCounterShort") || "포장";
    }
    const t = (tables || []).find((x) => String(x.number) === String(o.table_number));
    return tableDisplayName(t || { number: o.table_number });
  }
  // 사장님 요청(2026-09-07): "주문서 인출되면 신규주문에서 조리시작 누르지
  // 않아도 자동으로 조리중으로 주문내용 넘어가도록" — 주방 티켓이 실제로
  // 나갔다는 것 자체가 이미 주방이 그 주문을 인지했다는 뜻이므로, 인쇄가
  // 성공하면(자동 인쇄든, 카드의 수동 "인쇄" 버튼이든) "신규 주문" 상태인
  // 주문은 사람이 따로 "조리 시작"을 누르지 않아도 곧장 "조리중"으로
  // 넘어간다. o.status !== "new"인 경우(이미 조리중/서빙완료 등인 주문을
  // 재인쇄하는 경우)는 아무 영향이 없다 — 되돌리거나 건너뛰지 않는다.
  // orders 배열의 같은 객체를 그대로 낙관적으로 바꿔서(다음 4초 폴링을
  // 기다리지 않고) 카드가 바로 조리중 칸으로 옮겨가 보이게 하고, 서버에는
  // 그 뒤에 실제 PATCH를 보낸다 — 실패해도 다음 loadOrders()의 폴링이
  // 서버의 실제 상태로 다시 맞춰준다(다른 곳의 낙관적 업데이트들과 동일).
  function markPrintSucceededAndAdvance(o) {
    markPrintSucceeded(o.id);
    if (o.status === "new") {
      o.status = "preparing";
      updateOrderStatus(o.id, "preparing");
      renderOrders();
    }
  }

  // 사다리의 어느 칸에서 떨어졌는지. 이 한 줄이 「왜 안 나왔는가」를 찾는
  // 시간을 없앤다.
  function printFailReason() {
    if (appPrintBridge()) return T("printFailReasonApp");
    if (!autoPrintOn) return T("printFailReasonOff");
    if (!printHereAllowed()) return T("printFailReasonElsewhere");
    return T("printFailReasonNoPrinter");
  }

  async function printKitchenTicket(o) {
    // Inside the 한국관 POS app (the tablet's own kiosk app, see
    // appPrintBridge() below) the ticket goes straight from here to the
    // printer's TCP port, so that is the whole print path. It runs ahead of
    // QZ Tray because QZ Tray is desktop-only: on the tablet it can only
    // ever time out, and that delay would sit between a new order arriving
    // and paper coming out of the kitchen printer.
    if (appPrintBridge() && (await tryPrintViaRawBt(o))) {
      markPrintSucceededAndAdvance(o);
      return;
    }

    // If ESC/POS auto-print is turned on and QZ Tray is reachable on this
    // computer, this sends the ticket straight to the physical printer with
    // no dialog at all and we're done. Any failure here (feature off, QZ
    // Tray not running, printer name mismatch, etc.) falls straight through
    // to the normal browser-print flow below, so printing is never silently
    // lost either way.
    if (await tryPrintViaEscPos(o)) {
      markPrintSucceededAndAdvance(o);
      return;
    }

    // Second rung of the same fallback ladder: on a computer with no QZ
    // Tray running this does nothing (disabled by default / no RawBT app
    // there to catch the intent), but on the Android tablet this is what
    // actually delivers a silent, no-dialog print — see tryPrintViaRawBt()
    // below and the "RawBT 자동 인쇄" settings card.
    if (await tryPrintViaRawBt(o)) {
      markPrintSucceededAndAdvance(o);
      return;
    }

    const win = window.open("", "_blank");
    if (!win) {
      // 사다리 끝까지 왔다는 것은 앞의 칸이 전부 실패했다는 뜻이다.
      // 그중 무엇이었는지를 같이 남긴다.
      markPrintFailed(o.id, { reason: printFailReason() });
      return;
    }
    win.document.open();
    win.document.write(buildDualTicketHtml(o, ticketFontSizes));
    win.document.close();

    // Wait for the receipt fonts (Noto Sans KR/TC) to finish loading before
    // printing — otherwise a font that arrives late can print some
    // characters blank instead of falling back cleanly.
    const triggerPrint = () => {
      win.focus();
      win.print();
    };
    const doc = win.document;
    const fontsReady = doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve();
    Promise.race([fontsReady, new Promise((resolve) => setTimeout(resolve, 4000))]).then(() => setTimeout(triggerPrint, 50));
    // Getting this far (a real ticket window opened and print() was called)
    // is the best confirmation this code can get, so treat it as success —
    // clears any earlier failure flag if this was a manual retry.
    markPrintSucceededAndAdvance(o);
  }

  // Opens the exact same ticket HTML in its own small popup WINDOW (not a
  // browser tab) — a fast way to check the layout after a tweak without
  // needing to actually print a physical page each time. Passing a real
  // features string (width/height/etc.) is what makes browsers render this
  // as a separate window instead of a new tab in the current window; a bare
  // window.open("", "_blank") with no features string opens as a tab.
  function previewKitchenTicket(o) {
    const win = window.open(
      "",
      "_blank",
      "width=420,height=720,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes"
    );
    if (!win) return; // popup blocked — nothing we can do without a click gesture, which this already is
    win.document.open();
    // 사장님 요청(2026-09-07)으로 실제 인쇄가 주방용+결제용 2장이 됐으니
    // (buildDualTicketHtml, printKitchenTicket 참고) 미리보기도 그 2장을
    // 그대로 보여줘서 레이아웃을 한 번에 확인할 수 있게 한다.
    win.document.write(buildDualTicketHtml(o, ticketFontSizes));
    win.document.close();
  }

  // ---------- Kitchen-ticket per-component font sizes (Settings >
  // 관리자 전용 > 빌지 글자 크기 — owner-editable, server-stored so every
  // print, on every login, uses the same sizes; see /api/settings/ticket-print
  // in settings.js and DEFAULT_TICKET_FONT_SIZES next to buildTicketHtml
  // above). Only affects the browser-print ticket — ESC/POS direct
  // printing (escpos.js) uses fixed printer character sizes instead, since
  // a thermal printer's font table doesn't support arbitrary px sizes. ----------
  const TICKET_FONT_INPUT_IDS = {
    storeName: "tfsStoreName",
    tableNo: "tfsTableNo",
    orderTypeBadge: "tfsOrderTypeBadge",
    time: "tfsTime",
    itemName: "tfsItemName",
    itemDetail: "tfsItemDetail",
    itemTakeout: "tfsItemTakeout",
    itemPrice: "tfsItemPrice",
    total: "tfsTotal",
    orderNote: "tfsOrderNote",
    printTime: "tfsPrintTime",
    // 사장님 피드백(2026-09-06): "그 부분들 전부 글자 굵기 조절하는것도
    // 추가해줘" — 위 크기 입력칸과 짝을 이루는 굵기 <select> id들. 이
    // 객체 하나로 readTicketFontInputs()/setTicketFontInputs()가 크기·굵기
    // 둘 다 그대로 처리하므로 그 두 함수는 손댈 필요가 없다.
    storeNameWeight: "tfsStoreNameWeight",
    tableNoWeight: "tfsTableNoWeight",
    orderTypeBadgeWeight: "tfsOrderTypeBadgeWeight",
    timeWeight: "tfsTimeWeight",
    itemNameWeight: "tfsItemNameWeight",
    itemDetailWeight: "tfsItemDetailWeight",
    itemTakeoutWeight: "tfsItemTakeoutWeight",
    itemPriceWeight: "tfsItemPriceWeight",
    totalWeight: "tfsTotalWeight",
    orderNoteWeight: "tfsOrderNoteWeight",
    printTimeWeight: "tfsPrintTimeWeight",
  };

  // A small sample order for the live actual-size preview in the settings
  // card — deliberately touches every element a real ticket can have (two
  // dishes, a meat-type choice, a spice-level choice, a takeout dish) so
  // every font-size field's effect is visible in the preview at once.
  // 품목별 note(itemNote)와 전체 주문 note(o.note)는 둘 다 뺐다 — 손님
  // 주문 화면에서 완전히 제거된 기능이라(itemNote: 커밋 d5440f5, 전체
  // 주문 note: 커밋 e0f1b86) 실제 주문에 다시는 나타나지 않는다(사장님
  // 피드백 2026-09-08: "요청사항 손님한테 받는 거 아예 없애기로
  // 했었잖아. 여전히 있는데?" → itemNote 제거 → "여전히 저 가장 아래
  // 빨간 글씨가 그거 아니야?" → o.note도 같은 이유로 제거).
  function sampleTicketOrderForPreview() {
    return {
      id: "preview",
      status: "new",
      table_number: "7",
      // "mixed" + one takeout item below, so this preview also shows what
      // the per-dish 外帶 sub-line (see buildTicketHtml's detailLines) looks
      // like at whatever font sizes the owner is trying out.
      order_type: "mixed",
      created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      // 좌석번호 옆 「(3-2)」 도 미리보기에 나와야 한다(2026-09-10) — 실제
      // 종이에 찍히는데 미리보기에만 없으면, 글자 크기를 그것 없이 맞추게 된다.
      party_size: 5,
      party_adults: 3,
      party_children: 2,
      total: 670,
      // unit_price/category_key 추가(2026-09-08, tfsItemPrice 미리보기 위해) —
      // 결제용(금액) 사본은 lineTotalOf(unit_price 기반)로 금액을 계산하므로
      // 이 값이 없으면 "NT$NaN"이 찍힌다. 음료(可樂)도 하나 넣어서 결제용
      // 사본 전용 "※ 飲料/酒類恕不折扣" 문구까지(할인이 걸려 있을 때) 이
      // 미리보기에서 확인할 수 있게 한다.
      items: [
        { name_zh: "石鍋拌飯", unit_price: 230, qty: 1, option_choice: "牛", spice_choice: "中辣", order_type: "dine_in" },
        { name_zh: "辣炒年糕", unit_price: 190, qty: 2, option_choice: null, spice_choice: null, order_type: "takeout" },
        { name_zh: "可樂", unit_price: 60, qty: 1, category_key: "drink", order_type: "dine_in" },
      ],
    };
  }

  function readTicketFontInputs() {
    const out = {};
    for (const k of Object.keys(TICKET_FONT_INPUT_IDS)) {
      const el = $("#" + TICKET_FONT_INPUT_IDS[k]);
      const v = el ? parseInt(el.value, 10) : NaN;
      if (Number.isFinite(v)) out[k] = v;
    }
    return out;
  }

  function setTicketFontInputs(sizes) {
    for (const k of Object.keys(TICKET_FONT_INPUT_IDS)) {
      const el = $("#" + TICKET_FONT_INPUT_IDS[k]);
      if (el && sizes[k] != null) el.value = sizes[k];
    }
  }

  // screenPreview:false here — the settings-card preview is an <iframe>
  // already fixed at 80mm wide, so it should show the ticket at true 1x
  // size, not the 2.4x-zoomed "paper on a desk" look of the real preview tab.
  // 사장님 피드백(2026-09-08): "금액 버전도 설정할 수 있게 해줘 ...
  // 이렇게 똑같이 금액 나오는 걸로 미리보기 보면서 따로 설정할 수 있게
  // 해달라는 의미였어" — 처음엔 buildDualTicketHtml(주방용+결제용 두
  // 장을 이어붙임)로 바꿨었는데, 미리보기 iframe이 고정 높이(440px)라
  // 두 번째 장은 안에서 스크롤해야만 보여서 마치 반영이 안 된 것처럼
  // 보였다. 그 대신 주방용/결제용(금액) 두 버튼으로 전환하는 탭을 두고,
  // 한 번에 하나씩 실제 크기 그대로 또렷하게 보여준다.
  let ticketFontPreviewMode = "kitchen"; // "kitchen" | "price"

  function updateTicketFontPreview() {
    const frame = $("#ticketFontPreviewFrame");
    if (!frame) return;
    frame.srcdoc = buildTicketHtml(sampleTicketOrderForPreview(), readTicketFontInputs(), {
      screenPreview: false,
      priceCopy: ticketFontPreviewMode === "price",
    });
  }

  const tfsPreviewKitchenBtn = $("#tfsPreviewKitchenBtn");
  const tfsPreviewPriceBtn = $("#tfsPreviewPriceBtn");
  if (tfsPreviewKitchenBtn && tfsPreviewPriceBtn) {
    tfsPreviewKitchenBtn.onclick = () => {
      ticketFontPreviewMode = "kitchen";
      tfsPreviewKitchenBtn.classList.add("active");
      tfsPreviewPriceBtn.classList.remove("active");
      updateTicketFontPreview();
    };
    tfsPreviewPriceBtn.onclick = () => {
      ticketFontPreviewMode = "price";
      tfsPreviewPriceBtn.classList.add("active");
      tfsPreviewKitchenBtn.classList.remove("active");
      updateTicketFontPreview();
    };
  }

  // 크기·굵기 모두 <input type=number>라서 oninput 하나로 충분하지만,
  // change도 같이 걸어 브라우저별 스피너 클릭 등 oninput이 누락될 수 있는
  // 경우까지 안전하게 잡는다.
  $$("#settings-cat-print input[id^='tfs']").forEach((el) => {
    el.oninput = updateTicketFontPreview;
    el.onchange = updateTicketFontPreview;
  });

  // Called for every logged-in role (owner or staff) — see showDashboard()
  // below — because ticketFontSizes is the cache printKitchenTicket() and
  // previewKitchenTicket() actually print with, not just settings-card
  // display data. Only owners see/edit the settings card itself, but a
  // staff member's printout still needs to match whatever the owner set.
  async function loadTicketFontSizes() {
    const res = await fetch("/api/settings/ticket-print");
    if (res.ok) {
      const data = await res.json();
      ticketFontSizes = Object.assign({}, DEFAULT_TICKET_FONT_SIZES, data);
    }
    setTicketFontInputs(ticketFontSizes);
    updateTicketFontPreview();
  }

  const saveTicketFontSizesBtn = $("#saveTicketFontSizesBtn");
  if (saveTicketFontSizesBtn) {
    saveTicketFontSizesBtn.onclick = async () => {
      const res = await fetch("/api/settings/ticket-print", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(readTicketFontInputs()),
      });
      const msg = $("#ticketFontSizesMsg");
      if (res.ok) {
        const data = await res.json();
        ticketFontSizes = Object.assign({}, DEFAULT_TICKET_FONT_SIZES, data);
        setTicketFontInputs(ticketFontSizes);
        updateTicketFontPreview();
        msg.style.color = "#1a8a44";
        msg.textContent = T("ticketFontSavedMsg");
      } else {
        msg.style.color = "#b5232c";
        msg.textContent = T("staffPasswordFailed");
      }
      msg.hidden = false;
      setTimeout(() => (msg.hidden = true), 2500);
    };
  }

  const resetTicketFontSizesBtn = $("#resetTicketFontSizesBtn");
  if (resetTicketFontSizesBtn) {
    resetTicketFontSizesBtn.onclick = () => {
      setTicketFontInputs(DEFAULT_TICKET_FONT_SIZES);
      updateTicketFontPreview();
    };
  }

  // paymentMethod/vipDiscountType are only meaningful when status === "paid"
  // (결제 완료 팝업에서 고른 값, 아래 data-advance-id 핸들러 참고) — 다른
  // 상태 전환(조리 시작/서빙 완료 등, 큐 카드의 드래그 등)은 그냥 두 인자를
  // 안 넘기면 예전과 동일하게 동작한다.
  async function updateOrderStatus(id, status, paymentMethod, vipDiscountType, manualDiscountValue) {
    const body = { status };
    if (paymentMethod) body.paymentMethod = paymentMethod;
    if (vipDiscountType) body.vipDiscountType = vipDiscountType;
    // 재량 할인은 特約95折/VIP9折와 같이 걸 수 있으므로(2026-09-10) 서로
    // 무관하게 따로 실어 보낸다 — 서버도 따로 받는다(resolvePaymentFields).
    if (manualDiscountValue) {
      body.manualDiscountMode = manualDiscountValue.mode;
      body.manualDiscountValue = manualDiscountValue.value;
    }
    const res = await fetch(`/api/orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // 2026-09-10: 예전에는 res.ok(불리언)만 돌려줬다. 서버는 갱신된 주문을
    // 응답으로 이미 주고 있는데(orders.js 의 PATCH /:id, res.json(order))
    // 그걸 버리고 곧바로 loadOrders() 로 목록 전체를 다시 받아왔다. 이제
    // 그 주문을 그대로 돌려주고, 부르는 쪽이 applyOrderUpdate() 로 자기
    // 목록의 그 한 자리만 갈아끼운다 — 요청 한 번이 사라진다.
    //
    // 실패하면 null. 기존 호출부들은 `if (!ok)` 로 검사하고 있어서 불리언을
    // 객체/null 로 바꿔도 그대로 동작한다.
    if (!res.ok) return null;
    return res.json().catch(() => null);
  }

  // 서버가 돌려준 주문 한 건을 로컬 목록에 반영하고 화면을 다시 그린다.
  // loadOrders() 의 "받아오는" 절반을 뺀 나머지다.
  //
  // renderOrders() 가 칼럼별로 스스로 정렬하므로(sortWithinColumn), 배열의
  // 어느 자리에 넣든 화면은 서버에서 통째로 받아온 것과 같다.
  function applyOrderUpdate(updated) {
    if (!updated || typeof updated.id !== "number") return false;
    const i = orders.findIndex((o) => o.id === updated.id);
    if (i === -1) orders.push(updated);
    else orders[i] = updated;
    // 신규에서 벗어난 주문은 "인쇄 실패" 표시를 달고 있을 이유가 없다 —
    // 직원이 이미 다른 방법으로 알아챘다는 뜻이다(loadOrders() 와 같은 규칙).
    if (updated.status !== "new") printFailedOrderIds.delete(updated.id);
    // 이미 날아가 있는 GET /api/orders 응답이 이 갱신 뒤에 도착해서 방금
    // 바꾼 것을 옛 값으로 덮지 않도록, 그것을 지금 낡은 것으로 표시한다
    // (드래그 쪽에서 쓰는 것과 같은 장치 — ordersRequestSeq 주석 참고).
    ordersRequestSeq++;
    if (!draggingOrderId) renderOrders();
    renderTables();
    if (!$("#floorPlanWrap").hidden && !floorPlanDragging) renderFloorPlan();
    if (!$("#tab-payment").hidden) renderPaymentFloorPlan();
    return true;
  }

  // 부분 결제(메뉴 품목 단위 체크) — 사장님 피드백(2026-09-05): "체크체크
  // 해서 그것만 결제완료 할 수 있게... 선택이 주문별이 아니라 메뉴별이야".
  // itemIndexes로 넘긴 품목들만 새 주문으로 분리해 결제완료 처리하고
  // (전부 체크했으면 서버가 그냥 이 주문 전체를 결제완료로), 나머지
  // 품목은 이 주문에 그대로 남는다 — src/routes/orders.js의
  // PATCH /:id/split-pay 참고.
  // 사장님 피드백(2026-09-06): "선택 결제 완료 버튼 누르고 확인누르고
  // 실제 적용되기까지 너무 오래 걸려" — 이 함수는 res.ok만 boolean으로
  // 돌려주고, 호출부(아래 pay-selected-items-btn 핸들러)는 그 뒤에 매번
  // loadOrders()(이 식당의 모든 주문을 통째로 다시 받아오는 무거운
  // 요청)를 또 불렀었다. 서버가 이미 갱신된 주문 전체를 응답으로
  // 돌려주고 있으니(orders.js의 PATCH /:id/split-pay, updatedOrder),
  // 그걸 그대로 돌려줘서 호출부가 로컬 orders 배열의 같은 자리만
  // 바꿔치기하면 되게 한다 — 그러면 재조회 요청 자체가 필요 없어진다.
  async function splitPayOrderItems(id, itemIndexes, paymentMethod, vipDiscountType, manualDiscountValue) {
    const reqBody = { itemIndexes };
    if (paymentMethod) reqBody.paymentMethod = paymentMethod;
    if (vipDiscountType) reqBody.vipDiscountType = vipDiscountType;
    if (manualDiscountValue) {
      reqBody.manualDiscountMode = manualDiscountValue.mode;
      reqBody.manualDiscountValue = manualDiscountValue.value;
    }
    const res = await fetch(`/api/orders/${id}/split-pay`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody),
    });
    if (!res.ok) return { ok: false, updatedOrder: null };
    const body = await res.json().catch(() => null);
    return { ok: true, updatedOrder: body ? body.updatedOrder : null };
  }

  function openOrderDetail(o) {
    const time = new Date(o.created_at.replace(" ", "T")).toLocaleString("ko-KR");
    const itemsHtml = o.items
      .map(
        (it) =>
          `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;">
            <span>${it.code ? `${it.code} ` : ""}${itemName(it)} ${it.option_choice ? `(${optionLabel(it.option_choice)})` : ""} x${it.qty}${it.order_type === "takeout" ? ` <span class="order-card-type-badge takeout">${T("orderCardTakeoutBadge")}</span>` : ""}${(it.selected_addons || []).length ? `<br/><small style="color:var(--muted);">+${it.selected_addons.map((a) => a.name).join(", ")}</small>` : ""}${it.note ? `<br/><small style="color:#999;">${T("memoLabel")}: ${it.note}</small>` : ""}</span>
            <span>NT$${(it.unit_price + (it.selected_addons || []).reduce((s, a) => s + a.price, 0)) * it.qty}</span>
          </div>`
      )
      .join("");
    const detailTableTag = isCounterOrder(o) ? fmtCounterOrderTag(o) : `${T("tableLabel")} ${o.table_number}${partyTag(o)}`;
    $("#orderDetailBody").innerHTML = `
      <h2>${detailTableTag}</h2>
      <p style="color:#999;font-size:15px;">${time} · ${T("statusTh")}: ${statusLabel(o.status)}</p>
      ${itemsHtml}
      ${o.note ? `<p style="margin-top:10px;"><strong>${T("memoLabel")}:</strong>${o.note}</p>` : ""}
      <div style="text-align:right;font-weight:800;font-size:18px;margin-top:10px;">${T("totalLabel")} NT$${o.total}</div>
    `;
    $("#orderDetailBackdrop").hidden = false;
  }
  $("#orderDetailClose").onclick = () => ($("#orderDetailBackdrop").hidden = true);
  $("#orderDetailBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "orderDetailBackdrop") $("#orderDetailBackdrop").hidden = true;
  });

  // ---------- 주문 수정 (edit an already-placed order's items) ----------
  // categories is the same menu tree loadMenu() already keeps for the 메뉴
  // 관리 tab — flattened here just to look up a line's menu-item definition
  // (its options/spice_options lists, availability, current price) by id.
  function flatMenuItems() {
    return categories.flatMap((c) => c.items);
  }

  // Mirrors src/addons.js / order.js's parseAddons() exactly — see the
  // file-level comment there for the "Name:Price" format.
  function parseAddons(addonsStr) {
    if (!addonsStr) return [];
    return addonsStr
      .split(",")
      .map((pair) => {
        const [name, priceStr] = pair.split(":");
        const trimmedName = (name || "").trim();
        const price = parseInt((priceStr || "0").trim(), 10);
        return trimmedName ? { name: trimmedName, price: Number.isNaN(price) ? 0 : price } : null;
      })
      .filter(Boolean);
  }

  // The "add a dish to this order" side panel — opened from the quick-add
  // row in openOrderEdit() below. Shows the dish's photo/name plus its own
  // option/spice/addon pickers and a qty stepper (same idea as the customer
  // order page's item sheet in order.js), and only calls onCommit(line) —
  // which the caller uses to push the finished line onto its draft list —
  // when "+ 추가" *inside this panel* is pressed. Self-contained: doesn't
  // touch draftItems directly, so openOrderEdit's Save flow doesn't need to
  // know anything changed here beyond the one onCommit call.
  function openAddPicker(mi, onCommit) {
    const backdrop = $("#orderEditPickerModal");
    let qty = mi.min_first_order_qty || 1;
    let option = mi.options ? mi.options.split(",")[0].trim() : null;
    let spice = mi.spice_options ? mi.spice_options.split(",")[0].trim() : null;
    let addons = [];
    const availableAddons = parseAddons(mi.addons);

    $("#orderEditPickerPhoto").style.backgroundImage = mi.photo_url ? `url('${mi.photo_url}')` : "";
    $("#orderEditPickerName").innerHTML = `${mi.code ? `${mi.code} ` : ""}${itemName(mi)}${meatIconsHtml(mi)}`;

    const pillPicker = (wrapId, values, current, onPick, labelFor) => {
      const wrap = $(wrapId);
      if (!values.length) {
        wrap.innerHTML = "";
        return;
      }
      wrap.innerHTML = `<div class="order-edit-pill-group">${values
        .map(
          (v) =>
            `<button type="button" class="order-edit-pill-btn${v === current ? " active" : ""}" data-value="${v}">${labelFor ? labelFor(v) : v}</button>`
        )
        .join("")}</div>`;
      wrap.querySelectorAll(".order-edit-pill-btn").forEach((btn) => {
        btn.onclick = () => {
          onPick(btn.dataset.value);
          wrap.querySelectorAll(".order-edit-pill-btn").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          updateCommitLabel();
        };
      });
    };
    const renderAddons = () => {
      const wrap = $("#orderEditPickerAddons");
      if (!availableAddons.length) {
        wrap.innerHTML = "";
        return;
      }
      wrap.innerHTML = `<div class="order-edit-pill-group">${availableAddons
        .map(
          (a) =>
            `<button type="button" class="order-edit-pill-btn${addons.includes(a.name) ? " active" : ""}" data-name="${a.name}">${a.name}${a.price > 0 ? ` +${a.price}` : ""}</button>`
        )
        .join("")}</div>`;
      wrap.querySelectorAll(".order-edit-pill-btn").forEach((btn) => {
        btn.onclick = () => {
          const name = btn.dataset.name;
          const idx = addons.indexOf(name);
          if (idx === -1) addons.push(name);
          else addons.splice(idx, 1);
          btn.classList.toggle("active");
          updateCommitLabel();
        };
      });
    };
    const updateCommitLabel = () => {
      const addonsPrice = addons.reduce((s, name) => {
        const a = availableAddons.find((x) => x.name === name);
        return s + (a ? a.price : 0);
      }, 0);
      $("#orderEditPickerQty").textContent = String(qty);
      $("#orderEditPickerCommit").textContent = `${T("orderEditAddBtn")} — NT$${(mi.price + addonsPrice) * qty}`;
    };

    pillPicker("#orderEditPickerOptions", mi.options ? mi.options.split(",").map((o) => o.trim()).filter(Boolean) : [], option, (v) => (option = v), optionLabel);
    pillPicker("#orderEditPickerSpice", mi.spice_options ? mi.spice_options.split(",").map((o) => o.trim()).filter(Boolean) : [], spice, (v) => (spice = v), spiceLabel);
    renderAddons();
    updateCommitLabel();

    $("#orderEditPickerDec").onclick = () => {
      if (qty > 1) qty--;
      updateCommitLabel();
    };
    $("#orderEditPickerInc").onclick = () => {
      if (qty < 20) qty++;
      updateCommitLabel();
    };
    const close = () => (backdrop.hidden = true);
    $("#orderEditPickerClose").onclick = close;
    $("#orderEditPickerCancel").onclick = close;
    $("#orderEditPickerCommit").onclick = () => {
      onCommit({
        item_id: mi.id,
        code: mi.code || null,
        name_zh: mi.name_zh,
        name_ko: mi.name_ko,
        name_en: mi.name_en,
        qty,
        unit_price: mi.price,
        option_choice: option,
        spice_choice: spice,
        order_type: "dine_in",
        note: "",
        selected_addons: addons.map((name) => {
          const a = availableAddons.find((x) => x.name === name);
          return { name, price: a ? a.price : 0 };
        }),
      });
      close();
    };
    backdrop.hidden = false;
  }

  function openOrderEdit(order) {
    // 이미 일부 품목이 부분결제(item.paid)된 주문은 버튼 자체를 숨기지만
    // (buildOrderRoundParts의 editBtn/groupEditBtn 참고), 혹시 다른 경로로
    // 이 함수가 불려도 한 번 더 막아서 이미 받은 돈이 수정으로 꼬이지
    // 않게 한다.
    if (order.status === "paid" || order.status === "cancelled" || order.items.some((it) => it.paid)) {
      showAlert(T("orderEditNotEditable"));
      return;
    }
    // Edited entirely on a local draft copy — nothing reaches the server
    // until Save, so closing/cancelling this modal never has a side effect.
    // Lines that are genuinely identical (same dish, same option/spice/order
    // type, same note, same addons) get folded into one row with a summed
    // qty — customers often add the same dish to the cart more than once,
    // which used to show as several visually-identical rows in a row and
    // just added confusion (2026-09 피드백). Anything that differs in any of
    // those fields — including a note — stays its own row, so nothing about
    // a distinct line is ever silently combined away.
    const addonsKey = (it) =>
      (it.selected_addons || [])
        .map((a) => a.name)
        .sort()
        .join("|");
    const draftItems = [];
    order.items.forEach((it) => {
      const existing = draftItems.find(
        (d) =>
          d.item_id === it.item_id &&
          d.option_choice === it.option_choice &&
          d.spice_choice === it.spice_choice &&
          d.order_type === it.order_type &&
          (d.note || "") === (it.note || "") &&
          addonsKey(d) === addonsKey(it)
      );
      if (existing) existing.qty += it.qty;
      else draftItems.push({ ...it });
    });
    const allItems = flatMenuItems();
    // Includes any selected_addons (사리면 추가 등) already on the line —
    // this modal doesn't offer a UI to change addons (that's chosen once at
    // order time on the customer page), it just needs to keep the price
    // consistent with what the server will recompute on save.
    const itemTotal = (it) =>
      (it.unit_price + (it.selected_addons || []).reduce((s, a) => s + a.price, 0)) * it.qty;
    const grandTotal = () => draftItems.reduce((s, it) => s + itemTotal(it), 0);

    function renderDraft() {
      const wrap = $("#orderEditItems");
      wrap.innerHTML = "";
      draftItems.forEach((it, idx) => {
        const mi = allItems.find((m) => m.id === it.item_id);
        // A mix_options item (동판불고기 etc.) keeps whatever option/spice it
        // already had — changing that would mean re-splitting quantities
        // across multiple lines, which is exactly the complexity 수기 주문
        // exists to sidestep, so only qty/removal are offered for those.
        // Small fixed choice lists (2-3 values) read as pill-button toggle
        // groups instead of a native <select> — the same interaction/look
        // the customer order page already uses for this exact kind of
        // choice (.options-list button in order.html/main.css) — rather
        // than a mismatched bare dropdown (2026-09 피드백: "10년 전 코드
        // 같다"). Native <select> stayed unstyled-looking however it's
        // dressed up (plus its chevron rendered oversized without an
        // explicit background-size — the immediate bug report), so this
        // swaps it out entirely instead of just patching the chevron.
        const pillGroup = (field, values, current, labelFor, extraClass) =>
          `<div class="order-edit-pill-group${extraClass ? ` ${extraClass}` : ""}" data-idx="${idx}" data-field="${field}">${values
            .map(
              (v) =>
                `<button type="button" class="order-edit-pill-btn${v === current ? " active" : ""}" data-value="${v}">${labelFor ? labelFor(v) : v}</button>`
            )
            .join("")}</div>`;
        const optionsHtml =
          mi && mi.options && !mi.mix_options
            ? pillGroup(
                "option",
                mi.options.split(",").map((o) => o.trim()).filter(Boolean),
                it.option_choice,
                optionLabel,
                "order-edit-pill-group-segmented"
              )
            : it.option_choice
              ? `<span class="order-edit-meta-badge">${optionLabel(it.option_choice)}</span>`
              : "";
        const spiceHtml =
          mi && mi.spice_options
            ? pillGroup(
                "spice",
                mi.spice_options.split(",").map((o) => o.trim()).filter(Boolean),
                it.spice_choice,
                spiceLabel,
                "order-edit-pill-group-segmented"
              )
            : it.spice_choice
              ? `<span class="order-edit-meta-badge">${spiceLabel(it.spice_choice)}</span>`
              : "";
        // 매장내/포장 (dine-in/takeout) is chosen per line, same as when the
        // order was first placed (see .order-type-tabs in order.html) — the
        // server already stores/accepts order_type per item (see
        // src/routes/orders.js PATCH /:id/items), this was just missing from
        // the edit UI itself (2026-09 피드백).
        const dineInLabel = adminLang === "zh" ? "內用" : "매장내";
        const takeoutLabel = adminLang === "zh" ? "外帶" : "포장";
        const orderTypeHtml = pillGroup(
          "orderType",
          ["dine_in", "takeout"],
          it.order_type === "takeout" ? "takeout" : "dine_in",
          (v) => (v === "takeout" ? takeoutLabel : dineInLabel),
          "order-edit-pill-group-segmented"
        );
        const addonsHtml =
          it.selected_addons && it.selected_addons.length
            ? `<span class="order-edit-meta-badge">+${it.selected_addons.map((a) => a.name).join(", ")}</span>`
            : "";
        // 부대찌개 포장 전용 조리 여부(不煮外帶/煮熟外帶) — 손님이 주문 시
        // 고른 값을 읽기 전용 배지로만 보여준다. option/spice처럼 여기서
        // 다시 바꿀 일은 없어서(수기 주문 편집은 수량/삭제/기본 옵션 정정이
        // 목적) 별도 pill 그룹은 만들지 않는다.
        const takeoutChoiceHtml = it.takeout_choice ? `<span class="order-edit-meta-badge">${it.takeout_choice}</span>` : "";
        // Two-tier layout so the qty/price/delete controls always land in
        // exactly the same place: a fixed "main" row (name — qty — price —
        // delete), plus one "choice" row per attribute below it (option,
        // spice, addons, order-type — whichever apply to this line). These
        // used to share a single row: first option+spice+addons all packed
        // into one flex-wrap line, then order-type got pulled onto its own
        // row and its own segmented-switch look because it read as just
        // another option pill otherwise and it was easy to miss which one
        // was selected (2026-09 피드백: "포장인지 매장인지 안나와있고 2개의
        // 다른 옵션이 한 열에 있어"). The owner then asked for the same
        // treatment across the board — every different kind of choice on
        // its own row, and the order-type segmented-switch look reused for
        // all of them, not just order-type (2026-09 피드백: "소 돼지랑
        // 맵기랑 포장 매장 전부 다른 거여서 다 다른 열에 나열해줘야돼.
        // 그리고 토글 디자인은 현재 매장내 포장이 좋아. 그걸로 다른 애들도
        // 적용해줘") — so option/spice/order-type all render via the same
        // "order-edit-pill-group-segmented" extraClass now (see the CSS
        // comment in admin.css), each in its own .order-edit-item-row-choice
        // row, and an empty row (a line with no option, say) simply
        // collapses via the :empty rule instead of leaving a gap.
        const row = document.createElement("div");
        row.className = "order-edit-item-row";
        row.innerHTML = `
          <div class="order-edit-item-row-main">
            <span class="order-edit-item-name">${it.code ? `${it.code} ` : ""}${itemName(it)}${meatIconsHtml(mi)}</span>
            <div class="order-edit-qty-group">
              <button type="button" class="order-edit-qty-btn" data-idx="${idx}" data-action="dec">−</button>
              <span class="order-edit-qty-value">${it.qty}</span>
              <button type="button" class="order-edit-qty-btn" data-idx="${idx}" data-action="inc">+</button>
            </div>
            <span class="order-edit-item-price">NT$${itemTotal(it)}</span>
            <button type="button" class="order-edit-remove-btn" data-idx="${idx}" title="${T("cancelBtn")}">✕</button>
          </div>
          <div class="order-edit-item-row-choice">${optionsHtml}</div>
          <div class="order-edit-item-row-choice">${spiceHtml}</div>
          <div class="order-edit-item-row-choice">${addonsHtml}</div>
          <div class="order-edit-item-row-choice">${takeoutChoiceHtml}</div>
          <div class="order-edit-item-row-choice">${orderTypeHtml}</div>
        `;
        wrap.appendChild(row);
      });

      wrap.querySelectorAll("[data-action='dec']").forEach((btn) => {
        btn.onclick = () => {
          const idx = parseInt(btn.dataset.idx, 10);
          if (draftItems[idx].qty > 1) draftItems[idx].qty--;
          renderDraft();
        };
      });
      wrap.querySelectorAll("[data-action='inc']").forEach((btn) => {
        btn.onclick = () => {
          const idx = parseInt(btn.dataset.idx, 10);
          if (draftItems[idx].qty < 20) draftItems[idx].qty++;
          renderDraft();
        };
      });
      wrap.querySelectorAll(".order-edit-remove-btn").forEach((btn) => {
        btn.onclick = () => {
          draftItems.splice(parseInt(btn.dataset.idx, 10), 1);
          renderDraft();
        };
      });
      // Pill-button toggle groups (option/spice/orderType) — one click sets
      // that line's field and re-renders (same pattern as qty +/-/delete
      // above) so the newly-active pill highlights immediately.
      const PILL_FIELD_KEY = { option: "option_choice", spice: "spice_choice", orderType: "order_type" };
      wrap.querySelectorAll(".order-edit-pill-group").forEach((group) => {
        const idx = parseInt(group.dataset.idx, 10);
        const key = PILL_FIELD_KEY[group.dataset.field];
        group.querySelectorAll(".order-edit-pill-btn").forEach((btn) => {
          btn.onclick = () => {
            draftItems[idx][key] = btn.dataset.value;
            renderDraft();
          };
        });
      });

      $("#orderEditTotal").textContent = `${T("totalLabel")} NT$${grandTotal()}`;
    }

    // Quick-add only offers simple items (no mix_options, still available)
    // — see the modal's own hint text for why griddle/mix items are excluded.
    const addable = allItems.filter((mi) => mi.available && !mi.mix_options);
    const addSelect = $("#orderEditAddSelect");
    addSelect.innerHTML = addable
      .map((mi) => `<option value="${mi.id}">${mi.code ? `${mi.code} ` : ""}${itemName(mi)} — NT$${mi.price}</option>`)
      .join("");
    // Picking a dish and pressing "+ 추가" used to drop it straight onto the
    // list with whatever option/spice happened to be first and no way to
    // choose addons at all. Now it opens a second same-size panel beside
    // this one showing that dish's photo/name and its own option/spice/
    // addon pickers + qty (mirroring the customer order page's item sheet)
    // — only pressing "+ 추가" *inside* that panel actually commits the line
    // (2026-09 피드백). See openAddPicker() below.
    $("#orderEditAddBtn").onclick = () => {
      const mi = allItems.find((m) => m.id === parseInt(addSelect.value, 10));
      if (mi) openAddPicker(mi, (line) => { draftItems.push(line); renderDraft(); });
    };

    const editTableTag = isCounterOrder(order) ? fmtCounterOrderTag(order) : `${T("tableLabel")} ${order.table_number}${partyTag(order)}`;
    $("#orderEditTitle").textContent = `${T("orderEditModalTitle")} — ${editTableTag}`;
    $("#orderEditMsg").hidden = true;
    $("#orderEditPickerModal").hidden = true;
    renderDraft();
    $("#orderEditBackdrop").hidden = false;

    $("#orderEditSave").onclick = async () => {
      if (draftItems.length === 0) {
        await showAlert(T("orderEditEmptyError"));
        return;
      }
      const payload = {
        items: draftItems.map((it) => ({
          itemId: it.item_id,
          qty: it.qty,
          option: it.option_choice,
          spice: it.spice_choice,
          orderType: it.order_type,
          note: it.note || "",
          // Names only — the server re-resolves prices from the menu item's
          // own addons definition (src/addons.js), same as the customer
          // order page does. Round-trips whatever this line already had.
          addons: (it.selected_addons || []).map((a) => a.name),
        })),
      };
      const res = await fetch(`/api/orders/${order.id}/items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const msg = $("#orderEditMsg");
        msg.style.color = "#b5232c";
        msg.textContent = T("orderEditNotEditable");
        msg.hidden = false;
        return;
      }
      $("#orderEditBackdrop").hidden = true;
      $("#orderEditPickerModal").hidden = true;
      // loadOrders() already re-opens the table-detail modal for whatever
      // table is currently shown (see openTableNumber), so no separate
      // refresh call is needed here even when this was opened from there.
      await loadOrders();
      await loadTables();
    };
  }
  const closeOrderEdit = () => {
    $("#orderEditBackdrop").hidden = true;
    $("#orderEditPickerModal").hidden = true;
  };
  $("#orderEditClose").onclick = closeOrderEdit;
  $("#orderEditCancel").onclick = closeOrderEdit;
  $("#orderEditBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "orderEditBackdrop") closeOrderEdit();
  });

  // ---------- Menu management ----------
  async function loadMenu() {
    const res = await fetch("/api/menu/admin");
    categories = await res.json();
    renderMenuAdmin();
    populateCategorySelect();
    scheduleSoldOutRefresh();
  }

  // 품절이 풀리는 시각에 목록을 스스로 다시 불러온다.
  //
  // 2026-09-11 사장님: "이거 품절 10일까지였는데 오늘 11일인데 안 풀렸어."
  // 서버는 제때 풀어주고 있었다. 문제는 **화면이 그걸 몰랐다**는 것이다 —
  // 메뉴 목록은 탭을 누를 때만 다시 불러오는데, 가게 태블릿은 화면을 켜둔
  // 채라 어제 불러온 목록을 그대로 보여주고 있었다.
  //
  // 1분마다 계속 물어보게 하지 않는 이유: 하루에 한 번 있는 일이라 그건
  // 낭비다. 서버가 각 품목에 「언제 풀리는지」를 적어 보내주니, 그 중 가장
  // 이른 시각 하나에만 알람을 맞춰두면 된다.
  let soldOutRefreshTimer = null;
  function scheduleSoldOutRefresh() {
    if (soldOutRefreshTimer) {
      clearTimeout(soldOutRefreshTimer);
      soldOutRefreshTimer = null;
    }
    const now = Date.now();
    let soonest = null;
    for (const c of categories || []) {
      for (const item of c.items || []) {
        // 이미 팔리고 있는 것은 풀릴 일이 없다.
        if (item.available) continue;
        const at = item.soldout_release_at;
        if (!at || typeof at !== "string") continue;
        // "YYYY-MM-DD HH:MM:SS" 는 대만 시각이다. 태블릿도 대만에 있으니
        // 브라우저의 지역 시각으로 읽으면 맞는다. 혹시 기기 시계가 다른
        // 시간대여도, 아래에서 한 번 더 불러오면 서버 판단이 이긴다.
        const ms = new Date(at.replace(" ", "T")).getTime();
        if (!Number.isFinite(ms) || ms <= now) continue;
        if (soonest == null || ms < soonest) soonest = ms;
      }
    }
    // 알람이 걸렸는지 밖에서 볼 수 있게 남겨둔다. 「왜 안 풀렸지」를 다시
    // 겪었을 때, 콘솔에서 이 값 하나만 보면 화면이 기다리고 있는지 아니면
    // 아예 안 기다리고 있는지가 바로 갈린다. e2e 도 이 값을 본다.
    window.__soldOutRefreshAt = soonest == null ? null : new Date(soonest).toISOString();
    if (soonest == null) return;
    // setTimeout 은 25일쯤이 한계다(32비트). 그보다 먼 것은 굳이 안 건다 —
    // 그 사이에 화면을 한 번은 새로 열게 된다.
    const delay = soonest - now + 2000; // 경계에 딱 걸리지 않게 2초 뒤
    if (delay > 20 * 24 * 3600 * 1000) return;
    soldOutRefreshTimer = setTimeout(() => {
      soldOutRefreshTimer = null;
      loadMenu();
    }, delay);
  }

  function renderMenuAdmin() {
    const wrap = $("#menuCategories");
    wrap.innerHTML = "";
    // 사장님 피드백(2026-09-06): "메뉴 순서를 바꾸고 싶어. 코드 정렬로
    // 되어있지 않은 거 같거든" — 코드(code) 숫자와 무관하게 사장님이 원하는
    // 순서로 직접 배치할 수 있도록 상태 칸 오른쪽에 위/아래 화살표 버튼을
    // 추가한다(드래그 방식도 검토했으나, 터치(태블릿) 환경에서 오작동하기
    // 쉬워 화살표 버튼 방식으로 확정). 실제 순서는 메뉴 아이템의
    // sort_order 필드(서버가 이미 손님 화면/관리자 목록 모두 이걸로 정렬)를
    // 같은 카테고리 안의 바로 위/아래 아이템과 맞바꾸는 방식으로 바꾼다 —
    // 아래 PATCH /api/menu/admin/items/:id/move 참고.
    categories.forEach((c) => {
      const block = document.createElement("div");
      block.className = "cat-block";
      block.innerHTML = `<h3>${catName(c)}</h3>`;
      const table = document.createElement("table");
      table.className = "item-table";
      table.innerHTML = `
        <thead><tr><th></th><th>${T("codeTh")}</th><th>${T("nameTh")}</th><th>${T("priceTh")}</th><th>${T("statusTh")}</th><th>${T("orderTh")}</th></tr></thead>
        <tbody></tbody>
      `;
      const tbody = table.querySelector("tbody");
      c.items.forEach((item, idx) => {
        const tr = document.createElement("tr");
        const moveButtonsHtml = canMenuEdit()
          ? `<div style="display:flex;gap:4px;">
              <button type="button" class="menu-move-btn" data-move-item-id="${item.id}" data-move-direction="up" title="${T("moveItemUpTitle")}" ${idx === 0 ? "disabled" : ""} style="padding:4px 8px;font-size:13px;line-height:1;${idx === 0 ? "opacity:0.3;cursor:default;" : "cursor:pointer;"}">▲</button>
              <button type="button" class="menu-move-btn" data-move-item-id="${item.id}" data-move-direction="down" title="${T("moveItemDownTitle")}" ${idx === c.items.length - 1 ? "disabled" : ""} style="padding:4px 8px;font-size:13px;line-height:1;${idx === c.items.length - 1 ? "opacity:0.3;cursor:default;" : "cursor:pointer;"}">▼</button>
            </div>`
          : "";
        tr.innerHTML = `
          <td>${item.photo_url ? `<span class="item-row-photo" style="background-image:url('${item.photo_url}')"></span>` : `<span class="photo-missing-badge" title="${T("photoMissingTitle")}">${T("photoMissing")}</span>`}</td>
          <td>${item.code || ""}</td>
          <td>${itemName(item)}</td>
          <td>NT$${item.price}</td>
          <td>${canMenuEdit()
            ? `<button type="button" class="availability-pill ${item.available ? "on" : "off"}" data-soldout-id="${item.id}" title="${T("soldOutTitle")}">${item.available ? T("onSale") : T("soldOut")}</button>`
            : `<span class="availability-pill ${item.available ? "on" : "off"}">${item.available ? T("onSale") : T("soldOut")}</span>`}${
              soldOutNote(item) ? `<div class="soldout-note">${soldOutNote(item)}</div>` : ""}${
              soldOutReleaseNote(item) ? `<div class="soldout-release">${soldOutReleaseNote(item)}</div>` : ""}</td>
          <td>${moveButtonsHtml}</td>
        `;
        // Staff without menuEdit can look at the menu but not open the edit
        // modal (server would 403 the save/delete anyway; this just avoids
        // showing a form they can't actually use).
        if (canMenuEdit()) {
          tr.onclick = (e) => {
            // 품절 배지는 자기 일(품절 설정)만 하고 끝난다 — 행 전체의
            // "수정 창 열기"까지 같이 터지면 창 두 개가 겹친다.
            if (e.target.closest("[data-soldout-id]")) return;
            openItemModal(item);
          };
          const pill = tr.querySelector("[data-soldout-id]");
          if (pill) pill.onclick = () => openSoldOutModal(item);
        } else tr.style.cursor = "default";
        tbody.appendChild(tr);
      });
      block.appendChild(table);
      wrap.appendChild(block);
    });
    // 화살표는 행 클릭(수정 모달 열기)과 같은 <tr> 안에 있으므로, 클릭이
    // 상위 tr.onclick으로 번지지 않게 막고 순서 변경 API만 호출한다.
    wrap.querySelectorAll("[data-move-item-id]").forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        if (btn.disabled) return;
        const itemId = parseInt(btn.dataset.moveItemId, 10);
        const direction = btn.dataset.moveDirection;
        btn.disabled = true;
        try {
          await fetch(`/api/menu/admin/items/${itemId}/move`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ direction }),
          });
          await loadMenu();
        } finally {
          btn.disabled = false;
        }
      };
    });
  }

  function populateCategorySelect() {
    const sel = $("#f_category_id");
    sel.innerHTML = categories.map((c) => `<option value="${c.id}">${catName(c)}</option>`).join("");
  }

  $("#addItemBtn").onclick = () => openItemModal(null);

  /**
   * 메뉴 수정 폼의 왼쪽 탭 — 사장님(2026-09-10): "메뉴 관리 폼이 너무 이것
   * 저것 다 섞여 있어서 엄청 헷갈려 ... 왼쪽에 탭을 둬서 설정처럼 구분하면서
   * 보는 게 좋을 것 같아."
   *
   * 보여주고 감추기만 한다. 입력칸은 전부 DOM 에 그대로 남아 있으므로 저장은
   * 예전과 똑같이 한 번에 다 나간다 — 지금 안 보이는 탭의 값도 같이 저장된다.
   */
  function showItemPane(name) {
    $$(".item-form-nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.itemPane === name));
    $$(".item-form-pane").forEach((p) => (p.hidden = p.dataset.itemPane !== name));
  }
  $$(".item-form-nav-btn").forEach((btn) => {
    btn.onclick = () => showItemPane(btn.dataset.itemPane);
  });

  /**
   * 쉼표로 나누던 칸을 「치고 Enter」 로 바꾼다.
   *
   * 사장님(2026-09-10): "옵션 치고 엔터하면 밑에 글자 등록되어있는 것처럼
   * 뜨게 해서 보다 더 직관적으로 옵션이 등록되었다는 걸 인지하게 해주고
   * 싶어."
   *
   * 값의 저장 형태는 하나도 바꾸지 않는다. 진짜 값은 여전히 hidden 입력이
   * 쉼표로 들고 있고, saveItemBtn 은 예전 그대로 그 칸을 읽는다. 손님
   * 화면·주방 빌지·서버 파서(src/addons.js)도 전부 그대로다. 바뀐 것은
   * 사장님이 그 쉼표를 직접 찍지 않아도 된다는 것뿐이다.
   */
  function chipValuesOf(field) {
    const raw = ($(`#${field.dataset.chipFor}`).value || "").trim();
    return raw ? raw.split(",").map((v) => v.trim()).filter(Boolean) : [];
  }
  function renderChips(field) {
    const priced = field.classList.contains("chip-field-priced");
    const list = field.querySelector(".chip-list");
    list.innerHTML = "";
    const values = chipValuesOf(field);
    list.hidden = values.length === 0;
    values.forEach((value, idx) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      let text = value;
      if (priced) {
        // "볶음밥 추가:80" → "볶음밥 추가 +NT$80". 0 원은 무료 교환이라
        // (예: 飯換冬粉:0) 값 대신 그렇게 적어준다.
        const [name, priceStr] = value.split(":");
        const price = parseInt((priceStr || "0").trim(), 10) || 0;
        text = `${(name || "").trim()} ${price ? `+NT$${price}` : T("chipFreeAddon")}`;
      }
      chip.innerHTML = `<span class="chip-text"></span><button type="button" class="chip-x" aria-label="remove">✕</button>`;
      chip.querySelector(".chip-text").textContent = text;
      chip.querySelector(".chip-x").onclick = () => {
        const next = chipValuesOf(field).filter((_, i) => i !== idx);
        $(`#${field.dataset.chipFor}`).value = next.join(",");
        renderChips(field);
      };
      list.appendChild(chip);
    });
  }
  /**
   * 조각 하나를 넣는다. name 은 사람이 친 이름, price 는 값이 붙는 칸
   * (추가 옵션)에서만 쓴다.
   *
   * 쉼표와 콜론은 이 값들을 나누는 글자다(src/addons.js) — 이름에 들어가면
   * 옵션 하나가 조용히 둘로 쪼개지거나 가격이 엉뚱하게 읽힌다. 그래서
   * **이름에서만** 지운다. 콜론을 값 전체에서 지우면 "이름:가격" 의 그
   * 콜론까지 없어져서 가격이 통째로 날아간다.
   */
  function addChip(field, name, price) {
    const cleanName = String(name || "").replace(/[,:]/g, " ").replace(/\s+/g, " ").trim();
    if (!cleanName) return false;
    const priced = field.classList.contains("chip-field-priced");
    const value = priced ? `${cleanName}:${parseInt(price, 10) || 0}` : cleanName;
    const values = chipValuesOf(field);
    const keyOf = (v) => (priced ? v.split(":")[0].trim() : v);
    if (values.some((v) => keyOf(v) === keyOf(value))) return false; // 같은 걸 두 번 넣지 않는다
    values.push(value);
    $(`#${field.dataset.chipFor}`).value = values.join(",");
    renderChips(field);
    return true;
  }
  function initChipFields() {
    $$(".chip-field").forEach((field) => {
      const priced = field.classList.contains("chip-field-priced");
      const entry = field.querySelector(".chip-entry");
      const priceEntry = field.querySelector(".chip-entry-price");
      const commit = () => {
        const name = entry.value;
        if (!String(name || "").trim()) return;
        if (addChip(field, name, priced ? priceEntry.value : null)) {
          entry.value = "";
          if (priceEntry) priceEntry.value = "";
        }
        entry.focus();
      };
      const onKey = (e) => {
        // 쉼표도 받아준다 — 지금까지 쉼표로 찍어오셨으니 손이 그렇게 간다.
        if (e.key === "Enter" || e.key === ",") {
          e.preventDefault();
          commit();
          return;
        }
        // 빈 칸에서 지우기를 누르면 마지막 조각을 뺀다.
        if (e.key === "Backspace" && !entry.value) {
          const values = chipValuesOf(field);
          if (!values.length) return;
          e.preventDefault();
          values.pop();
          $(`#${field.dataset.chipFor}`).value = values.join(",");
          renderChips(field);
        }
      };
      entry.onkeydown = onKey;
      if (priceEntry) {
        priceEntry.onkeydown = (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        };
      }
      const addBtn = field.querySelector(".chip-add-btn");
      if (addBtn) addBtn.onclick = commit;
      // 조각이 쌓이는 자리를 누르면 바로 칠 수 있게.
      field.onclick = (e) => {
        if (e.target === field || e.target.classList.contains("chip-list")) entry.focus();
      };
    });
  }
  initChipFields();
  /** 창을 열 때 hidden 입력의 값으로 조각들을 다시 그린다. */
  function renderAllChips() {
    $$(".chip-field").forEach(renderChips);
    $$(".chip-field .chip-entry, .chip-field .chip-entry-price").forEach((el) => (el.value = ""));
  }

  function openItemModal(item) {
    // 열 때마다 「기본」부터. 지난번에 보던 탭이 그대로 열려 있으면, 다른
    // 메뉴를 고치러 들어왔는데 이름이 안 보이는 화면에서 시작하게 된다.
    showItemPane("basic");
    editingItemId = item ? item.id : null;
    editingItemPhotoUrl = item ? item.photo_url : null;
    selectedPhotoFile = null;
    $("#itemModalTitle").textContent = item ? T("itemModalEditTitle") : T("itemModalAddTitle");
    $("#f_category_id").value = item ? item.category_id : categories[0] ? categories[0].id : "";
    $("#f_code").value = item?.code || "";
    $("#f_name_zh").value = item?.name_zh || "";
    $("#f_name_ko").value = item?.name_ko || "";
    $("#f_name_en").value = item?.name_en || "";
    $("#f_desc_zh").value = item?.desc_zh || "";
    $("#f_desc_ko").value = item?.desc_ko || "";
    $("#f_desc_en").value = item?.desc_en || "";
    $("#f_price").value = item?.price ?? "";
    $("#f_price_note").value = item?.price_note || "";
    $("#f_original_price").value = item?.original_price || "";
    $("#f_options").value = item?.options || "";
    $("#f_spice_options").value = item?.spice_options || "";
    $("#f_takeout_options").value = item?.takeout_options || "";
    $("#f_addons").value = item?.addons || "";
    $("#f_min_first_order_qty").value = item?.min_first_order_qty || "";
    $("#f_is_spicy").checked = !!item?.is_spicy;
    $("#f_is_signature").checked = !!item?.is_signature;
    // 품절은 체크박스 하나가 아니라 네 가지 중 하나다 — 표의 배지 팝업과
    // 같은 선택지를 같은 모양으로 쓴다.
    itemFormSoldOutMode = item ? soldOutModeOf(item) : "on_sale";
    $("#f_soldout_from").value = (item && item.soldout_from) || "";
    $("#f_soldout_until").value = (item && item.soldout_until) || "";
    paintItemFormSoldOut();
    $("#f_mix_options").checked = !!item?.mix_options;
    renderAllergenCheckboxes(item?.allergens || []);
    $("#f_photo").value = "";
    if (item?.photo_url) {
      $("#f_photo_preview").src = item.photo_url;
      $("#f_photo_preview").hidden = false;
    } else {
      $("#f_photo_preview").hidden = true;
    }
    $("#deleteItemBtn").hidden = !item;
    // hidden 입력에 값을 다 채운 뒤에 조각을 그린다.
    renderAllChips();
    $("#itemModalBackdrop").hidden = false;
  }
  // Renders one checkbox per ALLERGENS entry (see public/js/allergens.js)
  // into the item modal, checking whichever ones the item already has.
  function renderAllergenCheckboxes(selected) {
    const wrap = $("#f_allergens_list");
    wrap.innerHTML = "";
    (window.ALLERGENS || []).forEach((a) => {
      const label = document.createElement("label");
      label.className = "allergen-checkbox";
      const label_text = a[adminLang] || a.zh;
      label.innerHTML = `<input type="checkbox" value="${a.id}" ${selected.includes(a.id) ? "checked" : ""} /> <span>${a.icon} ${label_text}</span>`;
      wrap.appendChild(label);
    });
  }

  function collectSelectedAllergens() {
    return Array.from($("#f_allergens_list").querySelectorAll("input[type=checkbox]:checked")).map((el) => el.value);
  }

  $("#itemModalClose").onclick = () => ($("#itemModalBackdrop").hidden = true);
  $("#itemModalBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "itemModalBackdrop") $("#itemModalBackdrop").hidden = true;
  });

  $("#f_photo").onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    selectedPhotoFile = file;
    const reader = new FileReader();
    reader.onload = (ev) => {
      $("#f_photo_preview").src = ev.target.result;
      $("#f_photo_preview").hidden = false;
    };
    reader.readAsDataURL(file);
  };

  $("#saveItemBtn").onclick = async () => {
    const payload = {
      category_id: parseInt($("#f_category_id").value, 10),
      code: $("#f_code").value.trim() || null,
      name_zh: $("#f_name_zh").value.trim(),
      name_ko: $("#f_name_ko").value.trim() || null,
      name_en: $("#f_name_en").value.trim() || null,
      desc_zh: $("#f_desc_zh").value.trim() || null,
      desc_ko: $("#f_desc_ko").value.trim() || null,
      desc_en: $("#f_desc_en").value.trim() || null,
      price: parseInt($("#f_price").value, 10) || 0,
      price_note: $("#f_price_note").value.trim() || null,
      original_price: parseInt($("#f_original_price").value, 10) || null,
      options: $("#f_options").value.trim() || null,
      spice_options: $("#f_spice_options").value.trim() || null,
      takeout_options: $("#f_takeout_options").value.trim() || null,
      addons: $("#f_addons").value.trim() || null,
      min_first_order_qty: parseInt($("#f_min_first_order_qty").value, 10) || null,
      is_spicy: $("#f_is_spicy").checked,
      is_signature: $("#f_is_signature").checked,
      // available 은 서버가 soldoutMode 를 보고 정한다(applySoldOut) —
      // 여기서 같이 보내면 두 값이 어긋날 수 있다.
      soldoutMode: itemFormSoldOutMode,
      soldoutFrom: itemFormSoldOutMode === "range" ? $("#f_soldout_from").value || null : null,
      soldoutUntil: itemFormSoldOutMode === "range" ? $("#f_soldout_until").value || null : null,
      mix_options: $("#f_mix_options").checked,
      allergens: collectSelectedAllergens(),
    };
    if (!payload.name_zh) {
      await showAlert(T("alertMenuNameRequired"));
      return;
    }
    let itemId = editingItemId;
    if (itemId) {
      await fetch(`/api/menu/admin/items/${itemId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      const res = await fetch(`/api/menu/admin/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const created = await res.json();
      itemId = created.id;
    }
    if (selectedPhotoFile && itemId) {
      const fd = new FormData();
      fd.append("photo", selectedPhotoFile);
      await fetch(`/api/menu/admin/items/${itemId}/photo`, { method: "POST", body: fd });
    }
    $("#itemModalBackdrop").hidden = true;
    loadMenu();
  };

  $("#deleteItemBtn").onclick = async () => {
    if (!editingItemId) return;
    if (!(await showConfirm(T("confirmDeleteItem")))) return;
    await fetch(`/api/menu/admin/items/${editingItemId}`, { method: "DELETE" });
    $("#itemModalBackdrop").hidden = true;
    loadMenu();
  };

  // ---------- Tables ----------
  async function loadTables() {
    const res = await fetch("/api/tables");
    tables = await res.json();
    renderTables();
  }

  function activeOrdersForTable(tableNumber) {
    return orders
      .filter((o) => String(o.table_number) === String(tableNumber) && o.status !== "cancelled")
      .sort((a, b) => new Date(a.created_at.replace(" ", "T")) - new Date(b.created_at.replace(" ", "T")));
  }

  // The 포장 카운터 "table" (see renderCounterSection below) isn't a real
  // dine-in table — it never appears in the regular list/floor plan/합산 결제,
  // only in its own dedicated box above them.
  function realTables() {
    return tables.filter((t) => !t.is_counter);
  }

  // 포장 카운터 box above the regular table list — shows a "만들기" button
  // until one exists (lazily provisioned via POST /api/tables/counter, see
  // src/routes/tables.js), then its own live-order badge and QR print link.
  function renderCounterSection() {
    const wrap = $("#counterSection");
    if (!wrap) return;
    const counterTable = tables.find((t) => t.is_counter);
    if (!counterTable) {
      wrap.innerHTML = `
        <div class="counter-card counter-card-empty">
          <div class="counter-card-text">
            <strong>${T("counterSectionTitle")}</strong>
            <p>${T("counterSectionHint")}</p>
          </div>
          ${canTableEdit() ? `<button type="button" id="createCounterBtn" class="primary-btn">${T("counterCreateBtn")}</button>` : ""}
        </div>
      `;
      const btn = $("#createCounterBtn");
      if (btn) {
        btn.onclick = async () => {
          btn.disabled = true;
          try {
            await fetch("/api/tables/counter", { method: "POST" });
            await loadTables();
          } finally {
            btn.disabled = false;
          }
        };
      }
      return;
    }
    const counterOrders = activeOrdersForTable(counterTable.number);
    const unpaid = counterOrders.filter((o) => o.status !== "paid");
    const badge =
      unpaid.length > 0
        ? `<div class="table-order-badge active">${fmtOrderCount(unpaid.length, unpaid.reduce((s, o) => s + o.total, 0))}</div>`
        : `<div class="table-order-badge empty">${T("tableEmptyBadge")}</div>`;
    wrap.innerHTML = `
      <div class="counter-card">
        <div class="counter-card-text">
          <strong>${T("counterSectionTitle")}</strong>
          <p>${T("counterSectionHint")}</p>
        </div>
        <div class="counter-card-right">
          ${badge}
          <a href="/api/tables/counter-qr" target="_blank" class="print-qr-btn" onclick="event.stopPropagation()">${T("counterQrBtn")}</a>
        </div>
      </div>
    `;
    wrap.querySelector(".counter-card").onclick = () => openTableDetail(counterTable.number, counterTable.label);
  }

  function renderTables() {
    renderCounterSection();
    const wrap = $("#tablesList");
    wrap.innerHTML = "";
    realTables().forEach((t) => {
      const tableOrders = activeOrdersForTable(t.number);
      const unpaid = tableOrders.filter((o) => o.status !== "paid");
      const chip = document.createElement("div");
      chip.className = "table-chip" + (unpaid.length > 0 ? " has-order" : "");
      const badge = unpaid.length > 0
        ? `<div class="table-order-badge active">${fmtOrderCount(unpaid.length, unpaid.reduce((s, o) => s + o.total, 0))}</div>`
        : `<div class="table-order-badge empty">${T("tableEmptyBadge")}</div>`;
      // 인원수가 등록돼 있으면 주문이 아직 없어도 보여준다.
      //
      // 예전에는 주문이 있을 때만 보여줬다. "인원수만 남은 테이블은 낡은
      // 값"이라고 보고, 그런 테이블이 차 있는 것처럼 보이지 않게 하려던
      // 것이다. 그런데 사장님 규칙(2026-09-09)에서는 인원수가 저절로
      // 사라지지 않고 직원이 「손님 나감」으로 직접 비운다 — 그러려면 어느
      // 테이블에 숫자가 남아 있는지가 눈에 보여야 한다. 숨기면 아무도
      // 모르고, 다음 손님이 인원수를 안 물어보는 이유도 알 수 없게 된다.
      const partyBadge = t.party_size ? `<div class="table-party-badge">${fmtPartySeat(t)}</div>` : "";
      const delBtn = canTableEdit() && !mergePayMode && tableEditMode ? `<button class="del-btn" title="${T("tableDelTitle")}">✕</button>` : "";
      const mergeCheckbox = mergePayMode && unpaid.length > 0 ? `<div class="merge-checkbox">${mergePaySelected.has(t.number) ? "✓" : ""}</div>` : "";
      chip.innerHTML = `${delBtn}${mergeCheckbox}<div class="num">${escapeHtml(tableDisplayName(t))}</div>${partyBadge}${badge}`;
      if (canTableEdit() && !mergePayMode && tableEditMode) {
        chip.querySelector(".del-btn").onclick = async (e) => {
          e.stopPropagation();
          if (!(await showConfirm(fmtConfirmDeleteTable(t.number)))) return;
          // 서버가 거절할 수 있다 — 못 받은 돈이 남았거나, 손님이 앉아
          // 계시거나, 포장 카운터이거나(src/routes/tables.js 의 DELETE).
          // 예전에는 응답을 안 보고 그냥 다시 그려서, 사장님 눈에는
          // "안 지워지네" 로만 보였다. 이유를 그 자리에서 말해준다.
          const res = await fetch(`/api/tables/${t.id}`, { method: "DELETE" });
          if (!res.ok) {
            let error = "";
            try {
              error = (await res.json()).error || "";
            } catch (err) {
              /* 본문이 없을 수도 있다 — 아래 기본 문구로 간다 */
            }
            const msg =
              {
                table_has_unpaid_orders: T("tableDelUnpaidMsg"),
                table_seated: T("tableDelSeatedMsg"),
                counter_not_deletable: T("tableDelCounterMsg"),
              }[error] || T("tableDelFailedMsg");
            await showAlert(msg);
          }
          loadTables();
        };
      }
      if (mergePayMode) {
        // Only a table with something unpaid is worth combining into a
        // group payment — an empty table has nothing to add to the total.
        if (unpaid.length > 0) {
          chip.classList.add("merge-selectable");
          if (mergePaySelected.has(t.number)) chip.classList.add("merge-selected");
          chip.onclick = () => {
            if (mergePaySelected.has(t.number)) mergePaySelected.delete(t.number);
            else mergePaySelected.add(t.number);
            renderTables();
            updateMergePayBar();
          };
        } else {
          chip.classList.add("merge-disabled");
          chip.onclick = null;
        }
      } else {
        chip.onclick = () => openTableDetail(t.number, t.label);
      }
      wrap.appendChild(chip);
    });
  }

  // 사장님 피드백: "전체결제완료 버튼을 눌렀는데, 다시 테이블 1의 다른
  // 주문 화면이 떠. 내가 선택할 수 있는 탭도 없고." — 실제로는 다른 주문이
  // 아니라, 결제 처리 후 목록 길이가 줄어들면서 이전 스크롤 위치가 전혀
  // 다른 내용 위에 놓이게 되는 문제였다. #tableDetailBody는 다시 그려질
  // 때마다 내용은 새로 채워지지만, 실제로 스크롤되는 부모 .modal 요소의
  // scrollTop은 그대로 남아있어서 — 화면 아래쪽(전체결제완료 버튼은 목록
  // 맨 아래 footer에도 있음)에 있다가 누르면, 결제 후 짧아진 목록에서는
  // 그 스크롤 위치가 엉뚱한 주문 블록 한가운데를 가리키게 되고, 맨 위에
  // 있는 현재 주문/이전 주문 탭은 화면 밖으로 벗어나 안 보이게 된다. 상태가
  // 크게 바뀌는 동작(탭 전환/결제 처리) 뒤에는 항상 맨 위로 스크롤을
  // 리셋해서 탭이 항상 보이도록 한다.
  function resetTableDetailScroll() {
    const modal = $("#tableDetailBackdrop .modal");
    if (modal) modal.scrollTop = 0;
  }

  function openTableDetail(tableNumber, label, focusOrderId) {
    // 다른 자리로 넘어가면 얹어 둔 카드는 따라가지 않는다. 5번 손님이
    // 사기로 한 카드가 8번 결제창에 얹혀 있으면 엉뚱한 사람이 낸다.
    if (pendingVipCardSale && String(pendingVipCardSale.tableNumber) !== String(tableNumber)) {
      clearPendingVipCardSale();
    }
    // A previous round's paid order used to sit in the same undivided,
    // continuously-scrolling list as whatever the table ordered next —
    // fine right after paying, confusing once a new order comes in.
    // 진행중/결제완료 내역 tabs (tableDetailView, declared up top) keep the
    // two apart: paid orders always land in 완료 내역, so a fresh order for
    // the same table always starts clean in 진행중.
    focusOrderId = focusOrderId || null;
    if (openTableNumber !== tableNumber || openFocusOrderId !== focusOrderId) {
      tableDetailView = "active";
      // 다른 테이블(혹은 다른 focusOrderId)을 새로 연 것이므로, 이전에
      // 열어봤던 화면에서 개별로 치워뒀던 카드(dismissedOrderIds)와
      // 부분결제용으로 체크해뒀던 품목(selectedPayItemKeys)은 이번
      // 화면과 무관하니 초기화한다.
      dismissedOrderIds = new Set();
      selectedPayItemKeys = new Set();
      tableVipDiscountType = null;
      counterVipDiscountTypeByOrderId = new Map();
      tableManualDiscountValue = null;
      counterManualDiscountValueByOrderId = new Map();
    }
    openTableNumber = tableNumber;
    if (label != null) openTableLabel = label;
    openFocusOrderId = focusOrderId;
    const table = tables.find((t) => String(t.number) === String(tableNumber));
    const allTableOrders = activeOrdersForTable(tableNumber); // excludes only "cancelled"
    // 결제탭에서 포장 카운터의 특정 손님 주문 타일 하나를 눌러 들어온
    // 경우(focusOrderId) — 그 손님과 무관한 다른 포장 주문들과 섞이지
    // 않도록 이 화면 전체를 그 주문 하나로 좁힌다. 진짜 테이블(같은
    // 일행)에서는 focusOrderId 없이 항상 테이블 전체 주문을 그대로 보여준다.
    const focusedOrder = focusOrderId != null ? allTableOrders.find((o) => o.id === focusOrderId) : null;
    const tableOrders = focusOrderId != null ? allTableOrders.filter((o) => o.id === focusOrderId) : allTableOrders;
    const activeOrders = tableOrders.filter((o) => o.status !== "paid");
    const paidOrders = tableOrders.filter((o) => o.status === "paid");
    const unpaidOrders = activeOrders;
    // remainingAmountOf: unpaidOrders는 항상 status !== "paid"라서 결국
    // 매번 "품목 중 아직 안 받은 것만 합산"이 되지만, 부분결제로 이미 일부
    // 품목이 결제완료된 라운드는 o.total(품목 전체 합)보다 작아야 하므로
    // 헬퍼를 그대로 재사용한다.
    const unpaidTotal = unpaidOrders.reduce((s, o) => s + remainingAmountOf(o), 0);
    // 인원수가 등록돼 있으면 주문이 아직 없어도 보여준다.
    //
    // 예전에는 "받을 돈이 있을 때만" 보여줬다. 그런데 사장님 규칙
    // (2026-09-09: "결제를 완료했다고 직원이 누르지 않는 한 ... 계속 같은
    // 손님")에서는 인원수가 시간이 지나도 저절로 사라지지 않으므로, 손님이
    // 그냥 나가버린 테이블은 직원이 직접 비워야 한다. 그러려면 그 숫자가
    // 화면에 보여야 한다 — 안 보이면 무엇을 비우는지 알 수 없고, 애초에
    // 비워야 한다는 것도 모른다.
    // 제목 옆 인원 — 좌석번호 바로 뒤에 「(3-2)」 로 붙는다. 예전에는
    // 여기에 「· 👥5인 (大3·小1)」 이 따로 있었는데, 좌석번호 옆에도 같은 걸
    // 적으면 한 줄에 같은 말이 두 번 나온다.
    const partyText = partyTag(table);
    // 사장님 피드백(2026-09-06): "모든 기능을 다 오른쪽 제일 아래 있는
    // 걸로 합쳐서 넣어줘. 그리고 전체 결제 완료를 없애줘. 대신에 그
    // 기능은 모든 메뉴들을 체크하면 가능하게 해줘" — 헤더/footer에 각각
    // 있던 "전체 결제 완료" 버튼을 없앤다. "전부 결제"는 이제 별도 버튼이
    // 아니라, 위의 "전체 선택" 체크박스로 미결제 품목을 다 체크한 뒤 맨
    // 아래(footer)의 버튼 하나를 누르는 것으로 대체한다 — footerPayBtn
    // 참고. 포장 카운터의 "미결제 주문"은 서로 무관한 손님들 것이라
    // 애초에 이 일괄 버튼/체크박스 대상이 아니라서(withItemCheckboxes가
    // 항상 false) 그대로 각 주문 카드의 개별 "결제 완료로 변경" 버튼으로만
    // 처리한다(아래 renderTableOrderBlock의 data-advance-id 버튼).
    // 포장 카운터 has no table number worth prefixing "테이블" onto — its own
    // label already says what it is. focusedOrder가 있으면(결제탭의 개별
    // 포장 타일을 눌러 들어온 경우) 제목에 그 주문의 태그를 덧붙여서 지금
    // 보고 있는 게 어느 주문인지 한눈에 보이게 한다 — 포장 카운터는 기존
    // 픽업번호·이름 태그, 진짜 테이블은 "📦 포장" 배지. 포장 카운터는
    // order_type 값과 상관없이 항상 포장으로 취급한다(위 renderPaymentFloorPlan의
    // takeoutOrders와 같은 이유 — order_type이 실수로 dine_in/mixed로
    // 찍혀 있어도 여전히 포장 손님 것).
    const focusTag = focusedOrder && (focusedOrder.order_type === "takeout" || (table && table.is_counter)) ? ` · ${fmtTakeoutTileTag(table, focusedOrder)}` : "";
    const titleText = table && table.is_counter
      ? `${label || openTableLabel || tableNumber}${focusTag}`
      : `${T("tableLabel")} ${label || tableNumber}${focusTag}`;
    // 사장님 요청(2026-09-09): "결제를 완료했다고 직원이 누르지 않는 한
    // 한번이라도 주문한 손님은 계속 같은 손님으로 취급할거야."
    //
    // 그래서 인원수는 시간이 지났다고 알아서 사라지지 않는다. 대신 손님이
    // 결제 없이 그냥 나간 경우(인원수만 찍고 안 시켰거나, 주문이 전부
    // 취소된 경우)를 직원이 직접 정리할 수 있어야 한다 — 안 그러면 그
    // 숫자가 계속 남아서 다음 손님에게 인원수를 안 묻게 된다.
    //
    // 결제할 것이 남아 있는 동안에는 이 버튼을 내놓지 않는다. 그때 눌러야
    // 하는 건 「결제 완료」이고, 그쪽이 인원수까지 알아서 정리한다.
    // 실수로 눌러도 되돌릴 수 있다 — 손님에게 인원수만 다시 물으면 된다.
    const showClearParty = !!(table && !table.is_counter && table.party_size && unpaidOrders.length === 0);
    // 자리 이동 — 받을 돈이 남아 있는 진짜 테이블에서만 내놓는다. 옮길 게
    // 없으면 누를 이유가 없고, 포장 카운터는 자리가 아니다(주문들이 서로
    // 무관한 손님 것이라 테이블로 옮기면 누구 것인지 알 수 없어진다).
    // focusOrderId 로 좁혀 들어온 화면에서도 내놓지 않는다 — 거기서 누르면
    // 화면에 안 보이는 다른 주문까지 같이 옮겨진다.
    const showMoveTable = !!(table && !table.is_counter && unpaidOrders.length > 0 && !focusOrderId);
    const header = `
      <h2>${titleText}${partyText}</h2>
      <div style="margin-top:-6px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <p style="color:var(--muted);font-size:15px;margin:0;">${T("unpaidTotalLabel")} <strong>NT$${unpaidTotal}</strong></p>
        ${showMoveTable
          ? `<button type="button" id="moveTableBtn" class="table-detail-clear-party">${T("moveTableBtn")}</button>`
          : ""}
        ${showClearParty
          ? `<button type="button" id="clearPartySizeBtn" class="table-detail-clear-party">${T("clearPartySizeBtn")}</button>`
          : ""}
      </div>
    `;
    const tabsHtml = `
      <div class="table-detail-tabs">
        <button type="button" class="table-detail-tab-btn ${tableDetailView === "active" ? "active" : ""}" data-detail-view="active">${T("tableDetailTabActive")} (${activeOrders.length})</button>
        <button type="button" class="table-detail-tab-btn ${tableDetailView === "paid" ? "active" : ""}" data-detail-view="paid">${T("tableDetailTabPaid")} (${paidOrders.length})</button>
      </div>
    `;
    const shownOrders = tableDetailView === "paid" ? paidOrders : activeOrders;
    const emptyMsg = tableDetailView === "paid" ? T("tableDetailNoPaidHistory") : T("noOrdersYetAdmin");
    // 사장님 피드백(2026-09-05, 포장 카운터 화면 스크린샷과 함께, 두 차례에
    // 걸쳐): 처음엔 "지금 한 창에 다른 여러개의 주문들이 섞여 있잖아.
    // 차라리 각 주문들의 창을 한 열 행으로 이어붙여서 여러개 할 수 있으면
    // 좋을 거 같아"(→ 카드로 분리 + 가로 한 줄), 그 다음엔 스크린샷과 함께
    // "이 엑스하는 창 같은 걸 따로따로 다 만들어달라는 거였어. 옆으로
    // 위아래로 이어 붙여서. 그러면 완전 다른 거라고 인식하기 편하고" — 카드
    // 하나가 한 줄로 옆에 이어붙는 걸론 부족하고, 이 모달 자체(자기만의
    // ✕ 버튼이 있는 하나의 "창")처럼 보이는 독립된 창을 여러 개, 가로뿐
    // 아니라 세로로도 줄바꿈되는 격자로 늘어놔야 "완전 다른 것"으로
    // 보인다는 뜻. 주문이 2건 이상이면 각 카드에 자기만의 ✕(치우기) 버튼을
    // 달고 grid로 배치해서 옆으로도 위아래로도 이어붙게 하고, 1건뿐이거나
    // 특정 주문 하나만 보고 있을 때(focusOrderId)는 굳이 그럴 필요가 없어
    // 카드 하나만 그대로 보여준다.
    // 단, 이건 포장 카운터(서로 무관한 손님들의 주문)에만 해당 — 사장님
    // 피드백(2026-09-05, 테이블 6 스크린샷과 함께): "이거 한 주문이잖아.
    // 이건 나누면 안돼. 테이블 주문은 결제 전까지 한 곳에서 추가주문을
    // 하는 거라서 하나로 묶는 게 맞는 거 같아" — 진짜 테이블에서 미결제
    // 주문이 여러 건인 건 같은 일행이 결제 전에 추가 주문한 것뿐이므로
    // 서로 무관한 손님처럼 독립된 창(개별 ✕ 버튼 포함)으로 나누면 안 되고
    // 계속 하나로 묶어서(세로로 쌓아) 보여줘야 한다. grid/치우기 버튼
    // 처리는 table.is_counter일 때만 켠다.
    const isGrid = shownOrders.length > 1 && !!(table && table.is_counter);
    const visibleOrders = isGrid ? shownOrders.filter((o) => !dismissedOrderIds.has(o.id)) : shownOrders;
    // 사장님 피드백(2026-09-05, isGrid를 카운터로 한정한 바로 다음):
    // "하나로 만들어줘 대신에 그냥 시간대가 다르면 지금처럼 사이에 시간만
    // 나타내주고" — 진짜 테이블에 라운드가 2건 이상이어도(isGrid는
    // false) 예전처럼 카드를 여러 개 세로로 나열하지 말고, 카드 하나
    // 안에 라운드들을 이어붙인다(renderMergedOrderGroup). 카운터는 그대로
    // 라운드마다 독립된 카드(renderTableOrderBlock).
    const orderBlocksHtml = isGrid
      ? visibleOrders.map((o) => renderTableOrderBlock(o, true)).join("")
      : visibleOrders.length > 1
      ? renderMergedOrderGroup(visibleOrders)
      : visibleOrders.map((o) => renderTableOrderBlock(o, false)).join("");
    // 사장님 피드백(2026-09-05): "부분 결제 완료 너무 오래 걸려. 그리고 한
    // 번에 전체 체크랑 시간대별 한 번에 전체 체크 기능도 있으면 좋을 거
    // 같아" — 라운드별 전체 체크(위 buildOrderRoundParts의
    // roundSelectAllHtml)와 별개로, 이 테이블(포장 카운터는 애초에
    // 부분결제 대상이 아니라서 제외 — isGrid)의 모든 라운드에 걸친 미결제
    // 품목을 한 번에 다 체크/해제하는 토글. "현재 주문" 탭에서만 의미가
    // 있다.
    const allUnpaidKeys =
      !isGrid && tableDetailView === "active"
        ? unpaidOrders
            .filter((o) => !isCounterOrder(o) && o.status !== "paid" && o.status !== "cancelled")
            .flatMap((o) => o.items.map((it, i) => (it.paid ? null : `${o.id}:${i}`)).filter(Boolean))
        : [];
    const allItemsSelected = allUnpaidKeys.length > 0 && allUnpaidKeys.every((k) => selectedPayItemKeys.has(k));
    // 사장님 피드백(2026-09-06): "하나 밖에 안남았어도 전체 선택 옵션은
    // 유지해줘" — 미결제 품목이 딱 1개만 남아도(예: 라운드 마지막 한
    // 품목) 이 체크박스를 계속 보여준다. 품목이 1개일 때도 그 품목
    // 자신의 체크박스 대신 이 "전체 선택"으로 바로 체크할 수 있게 하는
    // 편이 일관적이다.
    const selectAllHtml =
      allUnpaidKeys.length > 0
        ? `<label style="display:flex;align-items:center;gap:6px;font-size:14px;color:var(--ink);cursor:pointer;margin:0 0 10px;">
            <input type="checkbox" id="tableDetailSelectAll" ${allItemsSelected ? "checked" : ""} style="width:16px;height:16px;cursor:pointer;" />
            ${T("selectAllItemsLabel")}
          </label>`
        : "";
    const allDismissedHtml =
      isGrid && shownOrders.length && !visibleOrders.length
        ? `<div style="text-align:center;padding:20px 0;color:var(--muted);">
             <p style="margin:0 0 10px;">${T("allOrderCardsDismissed")}</p>
             <button type="button" id="tableDetailRestoreDismissed" style="padding:7px 14px;font-size:14px;">${T("restoreDismissedBtn")}</button>
           </div>`
        : "";
    const body = !shownOrders.length
      ? `<p style="color:var(--muted);padding:20px 0;text-align:center;">${emptyMsg}</p>`
      : allDismissedHtml
      ? allDismissedHtml
      : isGrid
      ? `<div class="order-block-grid">${orderBlocksHtml}</div>`
      : `${selectAllHtml}${orderBlocksHtml}`;
    // 사장님 피드백(2026-09-06): "모든 기능을 다 오른쪽 제일 아래 있는
    // 걸로 합쳐서 넣어줘. 그리고 전체 결제 완료를 없애줘. 대신에 그
    // 기능은 모든 메뉴들을 체크하면 가능하게 해줘" — 이 테이블(포장
    // 카운터 제외)의 결제 버튼은 이제 이 footer 하나뿐이다. 체크된
    // 품목이 있으면 그 합계로 "선택 결제 완료"를, 하나도 없으면 아직
    // 결제할 게 없다는 뜻이라 눌러도 반응 없는 회색 버튼을 보여준다 —
    // 전부 결제하고 싶으면 위 "전체 선택"으로 다 체크한 뒤 이 버튼을
    // 누르면 된다. class="pay-selected-items-btn"라서 위에서 이미 연결한
    // 핸들러(unpaidOrders 기준으로 매번 새로 체크 상태를 모음)가 그대로
    // 처리한다.
    // isGrid가 아니라 table.is_counter로 직접 판단한다 — 카운터인데
    // 주문이 1건뿐이라 isGrid가 false인 경우(포커스로 들어온 개별 픽업
    // 등)도 여전히 이 합산 버튼 대상이 아니어야 하기 때문.
    const isCounterTable = !!(table && table.is_counter);
    const footerSelections = isCounterTable ? [] : collectSelectedItemsByOrder(unpaidOrders);
    const footerSelectedTotal = footerSelections.reduce((s, x) => s + x.total, 0);
    // 얹어 둔 VIP 카드값은 결제 버튼 금액에 더해진다 — 직원이 손님에게
    // 부르는 숫자가 하나여야 한다.
    const pendingCardAmount = pendingVipCardAmountFor(tableNumber);
    const footerPayTotal = footerSelectedTotal + pendingCardAmount;
    const footerPayBtn = isCounterTable
      ? ""
      : footerSelections.length > 0
      ? `<button class="primary-btn pay-selected-items-btn" style="padding:8px 16px;font-size:15px;">${T("paySelectedBtn")} (NT$${footerPayTotal})</button>`
      : `<button class="primary-btn" disabled style="padding:8px 16px;font-size:15px;opacity:0.4;cursor:not-allowed;">${T("paySelectedBtn")}</button>`;
    // 特約95折/VIP9折 토글 — 처음엔 여기 footer에 따로 한 줄로 뒀는데,
    // 사장님 피드백(2026-09-06, 스크린샷과 함께): "할인 위치를 가장 아래
    // 수정 같은 수평선 오른쪽으로 넣어줘" — footer가 아니라 각 라운드
    // 자신의 "수정" 버튼과 같은 줄로 옮겼다(위 buildOrderRoundParts의
    // vipDiscountToggleHtml, renderTableOrderBlock/renderMergedOrderGroup
    // 참고). 라운드가 여러 개여도 모두 같은 테이블 전체 값을 공유해서
    // 보여주므로 footer에 따로 둘 필요가 없다.
    // VIP 카드 판매 — 사장님(2026-09-10): "직원이 결제할 때 손님이 vip 사고
    // 싶다면 살 수 있게 해줘. 직원이 결제창에서 직접 쉽게 추가할 수 있게
    // 버튼으로 추가할 수 있게 해줘."
    //
    // 주문이 하나도 없어도 내놓는다. 밥을 다 먹고 결제까지 끝낸 손님이
    // 나가면서 "카드 하나 주세요" 하는 게 오히려 흔한 순간이고, 그때
    // 이 버튼이 없으면 직원이 살 길을 못 찾는다. 그래서 아래 footer 는
    // 이제 「받을 돈이 있을 때」가 아니라 「현재 주문 탭일 때」 나온다.
    // 얹어 둔 상태면 버튼이 「빼기」로 바뀌고, 그 옆에 현금이라는 것을
    // 적어 둔다 — 결제수단을 고르는 팝업에서 「LINE」을 눌러도 이 300은
    // 현금이라는 것을 그 전에 알아야 한다.
    const vipSellBtnHtml = pendingCardAmount
      ? `<button type="button" id="vipSellBtn" class="vip-sell-btn is-pending">${T("vipSellPendingBtn")} NT$${pendingCardAmount}</button>` +
        `<span class="vip-sell-pending-note">${T("vipSellPendingNote")}</span>`
      : `<button type="button" id="vipSellBtn" class="vip-sell-btn">${T("vipSellBtn")}${vipSalePrice == null ? "" : ` NT$${vipSalePrice}`}</button>`;
    const footer = tableDetailView === "active"
      ? `
        <div class="table-detail-footer">
          <div class="table-detail-footer-left">
            ${activeOrders.length
              ? `<p style="font-size:16px;margin:0;">${T("unpaidTotalLabel2")} <strong>NT$${unpaidTotal}</strong></p>`
              : ""}
            ${vipSellBtnHtml}
          </div>
          ${activeOrders.length ? footerPayBtn : ""}
        </div>
      `
      : "";
    $("#tableDetailBody").innerHTML = header + tabsHtml + body + footer;
    // 카드가 여러 개 격자로 뜨는 화면은 기본 480px 폭으로는 한 줄에 하나도
    // 넉넉히 안 들어가 "독립된 창"처럼 안 보이므로(위 admin.css의
    // .table-detail-modal.wide 참고) 이때만 폭을 넓힌다.
    const modalEl = $("#tableDetailBackdrop .modal");
    if (modalEl) modalEl.classList.toggle("wide", isGrid);
    $("#tableDetailBody")
      .querySelectorAll("[data-detail-view]")
      .forEach((btn) => {
        btn.onclick = () => {
          tableDetailView = btn.dataset.detailView;
          openTableDetail(tableNumber, label, focusOrderId);
          resetTableDetailScroll();
        };
      });

    // 「손님 나감」 — 등록된 인원수를 직원이 직접 비운다. 결제 없이 손님이
    // 나간 테이블(인원수만 찍고 안 시켰거나 주문이 전부 취소된 경우)을
    // 정리하는 유일한 길이다. 시간이 지났다고 알아서 지우지는 않으므로,
    // 이 버튼을 누르지 않으면 그 숫자가 그대로 남는다.
    const clearPartyBtn = $("#clearPartySizeBtn");
    if (clearPartyBtn) {
      clearPartyBtn.onclick = async () => {
        if (!(await showConfirm(T("clearPartySizeConfirm")))) return;
        clearPartyBtn.disabled = true;
        try {
          const res = await fetch(`/api/tables/${encodeURIComponent(tableNumber)}/party-size`, { method: "DELETE" });
          if (!res.ok) throw new Error("failed");
          // 화면의 tables 사본도 같이 맞춰준다 — 다음 폴링을 기다리지 않고
          // 버튼이 바로 사라지고 인원수 표시도 없어져야 한다.
          const t = tables.find((x) => String(x.number) === String(tableNumber));
          if (t) {
            t.party_size = null;
            t.party_size_updated_at = null;
          }
          await loadTables();
          openTableDetail(tableNumber, label, focusOrderId);
          if (!$("#tab-payment").hidden) renderPaymentFloorPlan();
        } catch (e) {
          clearPartyBtn.disabled = false;
          await showAlert(T("clearPartySizeFailed"));
        }
      };
    }
    const moveBtn = $("#moveTableBtn");
    if (moveBtn) moveBtn.onclick = () => openMoveTable(tableNumber, label || openTableLabel);
    const sellBtn = $("#vipSellBtn");
    if (sellBtn) {
      sellBtn.onclick = () => {
        // 이미 얹어 둔 게 있으면 한 번 더 누르는 것은 「빼기」다.
        if (pendingVipCardAmountFor(tableNumber) > 0) {
          clearPendingVipCardSale();
          openTableDetail(tableNumber, label, focusOrderId);
          return;
        }
        openVipSellModal(
          tableNumber,
          () => {
            // 판 기록이 바로 「결제 완료」 탭에 보이게 다시 그린다.
            openTableDetail(tableNumber, label, focusOrderId);
          },
          // 받을 돈이 남아 있으면 지금 팔지 않고 이번 결제에 얹는다.
          (cardNumber) => {
            if (!unpaidOrders.length) return false;
            pendingVipCardSale = { tableNumber: String(tableNumber), cardNumber: cardNumber || "" };
            openTableDetail(tableNumber, label, focusOrderId);
            return true;
          }
        );
      };
    }

    $("#tableDetailBody")
      .querySelectorAll("[data-edit-id]")
      .forEach((btn) => {
        btn.onclick = () => {
          const o = tableOrders.find((x) => x.id === parseInt(btn.dataset.editId, 10));
          if (o) openOrderEdit(o);
        };
      });
    $("#tableDetailBody")
      .querySelectorAll("[data-toggle-items-id]")
      .forEach((btn) => {
        btn.onclick = () => {
          const id = parseInt(btn.dataset.toggleItemsId, 10);
          if (expandedOrderIds.has(id)) expandedOrderIds.delete(id);
          else expandedOrderIds.add(id);
          openTableDetail(tableNumber, label, focusOrderId);
        };
      });
    // 카드 자체의 ✕(치우기) 버튼 — 결제 상태와는 무관하게 이 화면에서만
    // 그 카드를 잠깐 안 보이게 한다(dismissedOrderIds, 위 선언부 주석
    // 참고). 전부 치우면 "모든 주문 카드를 치웠습니다 / 다시 보기" 안내로
    // 바뀐다.
    $("#tableDetailBody")
      .querySelectorAll("[data-dismiss-id]")
      .forEach((btn) => {
        btn.onclick = () => {
          dismissedOrderIds.add(parseInt(btn.dataset.dismissId, 10));
          openTableDetail(tableNumber, label, focusOrderId);
        };
      });
    const restoreBtn = $("#tableDetailRestoreDismissed");
    if (restoreBtn) {
      restoreBtn.onclick = () => {
        dismissedOrderIds = new Set();
        openTableDetail(tableNumber, label, focusOrderId);
      };
    }
    $("#tableDetailBody")
      .querySelectorAll("[data-advance-id]")
      .forEach((btn) => {
        btn.onclick = async () => {
          const orderId = parseInt(btn.dataset.advanceId, 10);
          const toStatus = btn.dataset.advanceTo;
          // 이 화면 안에서 [data-advance-id]는 항상 포장 카운터의 "결제
          // 완료로 변경" 버튼뿐이다(진짜 테이블은 nextBtn 자체가 없음 — 위
          // buildOrderRoundParts 참고) — toStatus === "paid"일 때만 결제
          // 방식 팝업(特約95折/VIP9折 토글 포함)을 띄운다.
          let applied = false;
          if (toStatus === "paid") {
            const o = tableOrders.find((x) => x.id === orderId);
            const discountType = counterVipDiscountTypeByOrderId.get(orderId) || null;
            const manualValue = counterManualDiscountValueByOrderId.get(orderId) || null;
            const breakdown =
              o && (discountType || manualValue)
                ? computeCombinedDiscountClient(
                    discountType,
                    manualValue,
                    fullEligibleClientTotal(o),
                    discountEligibleClientTotal(o)
                  )
                : { vipAmount: 0, manualAmount: 0, afterVip: 0, total: 0 };
            const method = await showPaymentMethodPopup(
              fmtPaymentSummary(o ? o.total : 0, discountType, manualValue, breakdown),
              discountRequiresCashOnly(discountType)
            );
            if (!method) return;
            const updated = await updateOrderStatus(orderId, toStatus, method, discountType, manualValue);
            if (!updated) {
              await showAlert(T("paySelectedFailedMsg"));
              return;
            }
            counterVipDiscountTypeByOrderId.delete(orderId);
            counterManualDiscountValueByOrderId.delete(orderId);
            applied = applyOrderUpdate(updated);
          } else {
            applied = applyOrderUpdate(await updateOrderStatus(orderId, toStatus));
          }
          // 서버가 돌려준 주문으로 그 한 자리만 갈아끼웠으면 목록을 다시
          // 받아올 필요가 없다. 응답을 못 받은 경우에만 예전처럼 통째로.
          if (!applied) await loadOrders();
          openTableDetail(tableNumber, label, focusOrderId);
          resetTableDetailScroll();
        };
      });
    // 特約95折/VIP9折 토글 클릭 — scope가 "table"이면 테이블 전체(footer)용
    // 값을, 그 외(포장 카운터 라운드의 주문 id 문자열)면 그 주문 하나만의
    // 값을 갱신한다. 같은 값을 다시 누르면 해제(미선택)된다.
    $("#tableDetailBody")
      .querySelectorAll("[data-vip-discount-btn]")
      .forEach((btn) => {
        btn.onclick = () => {
          const type = btn.dataset.vipDiscountBtn;
          const scope = btn.dataset.vipDiscountScope;
          if (scope === "table") {
            tableVipDiscountType = tableVipDiscountType === type ? null : type;
          } else {
            const orderId = parseInt(scope, 10);
            const current = counterVipDiscountTypeByOrderId.get(orderId) || null;
            if (current === type) counterVipDiscountTypeByOrderId.delete(orderId);
            else counterVipDiscountTypeByOrderId.set(orderId, type);
          }
          openTableDetail(tableNumber, label, focusOrderId);
        };
      });
    // 직접 입력(재량 할인) 버튼 — 누르면 prompt로 금액/퍼센트를 입력받는다.
    // scope 규칙은 위 特約95折/VIP9折 핸들러와 동일(table ↔ 카운터 주문id).
    $("#tableDetailBody")
      .querySelectorAll("[data-manual-discount-btn]")
      .forEach((btn) => {
        btn.onclick = async () => {
          const scope = btn.dataset.vipDiscountScope;
          const orderId = scope === "table" ? null : parseInt(scope, 10);
          const existing = scope === "table" ? tableManualDiscountValue : counterManualDiscountValueByOrderId.get(orderId) || null;
          const result = await promptManualDiscount(existing);
          if (result === undefined) return; // 취소/입력 오류 — 값 유지
          // 2026-09-10부터 재량 할인은 特約95折/VIP9折 선택과 완전히 별개다
          // — 여기서 VIP 쪽 상태를 건드리지 않는다(예전에는 "manual"로
          // 덮어써서 VIP 할인이 꺼졌다).
          if (scope === "table") {
            tableManualDiscountValue = result;
          } else if (result) {
            counterManualDiscountValueByOrderId.set(orderId, result);
          } else {
            counterManualDiscountValueByOrderId.delete(orderId);
          }
          openTableDetail(tableNumber, label, focusOrderId);
        };
      });
    // 사장님 피드백(2026-09-06)으로 "전체 결제 완료"(.pay-all-btn) 버튼
    // 자체가 없어져서(위 footerPayBtn/groupButtonsHtml 참고) 이 핸들러도
    // 함께 지웠다 — 이제 전부 결제는 "전체 선택" 체크 + footer의
    // "선택 결제 완료"(.pay-selected-items-btn, 아래)로 이뤄진다.
    // 부분 결제(체크한 메뉴 품목만 결제 완료) — 위 buildOrderRoundParts가
    // 품목 줄마다 붙여준 체크박스와, renderTableOrderBlock/
    // renderMergedOrderGroup 양쪽에서 만드는 "선택 결제 완료" 버튼.
    // 체크박스를 누르면 selectedPayItemKeys만 갱신하고 다시 그려서 버튼
    // 라벨(선택 결제 완료 ↔ 전체 결제 완료)이 바로 반영되게 한다.
    $("#tableDetailBody")
      .querySelectorAll("[data-select-item-key]")
      .forEach((checkbox) => {
        checkbox.onchange = () => {
          const key = checkbox.dataset.selectItemKey;
          if (checkbox.checked) selectedPayItemKeys.add(key);
          else selectedPayItemKeys.delete(key);
          openTableDetail(tableNumber, label, focusOrderId);
        };
      });
    // 사장님 피드백(2026-09-06): "체크 박스뿐 아니라 메뉴 이름 눌러도
    // 체크되게 해줘" — 위 buildOrderRoundParts가 체크 가능한 품목 줄에
    // 붙여준 data-select-item-row. 줄 아무 데나 누르면 그 줄의
    // 체크박스를 토글하고 change 이벤트를 그대로 발생시켜서(위
    // checkbox.onchange 재사용) 체크박스를 직접 눌렀을 때와 똑같이
    // 동작하게 한다. 체크박스 자체를 누른 경우는 이미 그 checkbox의
    // onchange가 처리하므로 여기서 또 토글하면 두 번 뒤집히니 제외한다.
    $("#tableDetailBody")
      .querySelectorAll("[data-select-item-row]")
      .forEach((row) => {
        row.onclick = (e) => {
          if (e.target.closest("input")) return;
          const checkbox = row.querySelector("[data-select-item-key]");
          if (!checkbox) return;
          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event("change"));
        };
      });
    // 사장님 피드백(2026-09-06): "부분 결제 완료 너무 오래 걸려. 그리고
    // 한 번에 전체 체크랑 시간대별 한 번에 전체 체크 기능도 있으면 좋을 거
    // 같아" — 라운드 하나 전체를 한 번에 체크/해제(라운드 헤더의
    // roundSelectAllHtml). 이미 결제완료된 품목(it.paid)은 애초에
    // unpaidIdxOfRound에서 빠져 있으므로 여기서 다시 걸러줄 필요 없다.
    $("#tableDetailBody")
      .querySelectorAll("[data-select-round-all]")
      .forEach((checkbox) => {
        checkbox.onchange = () => {
          const orderId = parseInt(checkbox.dataset.selectRoundAll, 10);
          const o = unpaidOrders.find((x) => x.id === orderId);
          if (!o) return;
          const idxs = o.items.map((_, i) => i).filter((i) => !o.items[i].paid);
          if (checkbox.checked) idxs.forEach((i) => selectedPayItemKeys.add(`${o.id}:${i}`));
          else idxs.forEach((i) => selectedPayItemKeys.delete(`${o.id}:${i}`));
          openTableDetail(tableNumber, label, focusOrderId);
        };
      });
    // 같은 피드백의 "한 번에 전체 체크" — 이 테이블의 모든 라운드에 걸친
    // 미결제 품목을 한 번에 체크/해제(위 openTableDetail의 allUnpaidKeys/
    // selectAllHtml).
    const selectAllCheckbox = $("#tableDetailSelectAll");
    if (selectAllCheckbox) {
      selectAllCheckbox.onchange = () => {
        if (selectAllCheckbox.checked) allUnpaidKeys.forEach((k) => selectedPayItemKeys.add(k));
        else allUnpaidKeys.forEach((k) => selectedPayItemKeys.delete(k));
        openTableDetail(tableNumber, label, focusOrderId);
      };
    }
    // unpaidOrders(=이 테이블의 미결제 주문 전체)를 기준으로 매번 다시
    // 모으므로, 카드 하나짜리 화면(renderTableOrderBlock)이든 여러 라운드
    // 병합 화면(renderMergedOrderGroup)이든 같은 핸들러 하나로 처리된다.
    $("#tableDetailBody")
      .querySelectorAll(".pay-selected-items-btn")
      .forEach((btn) => {
        btn.onclick = async () => {
          const selections = collectSelectedItemsByOrder(unpaidOrders);
          if (!selections.length) return;
          const total = selections.reduce((s, x) => s + x.total, 0);
          // 사장님 요청(2026-09-06): "결제 완료 누르면 팝업으로" 결제
          // 방식(현금/LinePay/신용카드)을 고르게 해달라 — 이 팝업 자체가
          // 요약(합계/할인/실수령액)도 함께 보여주므로 예전의
          // showConfirm(fmtConfirmPaySelected)은 더 이상 따로 거치지
          // 않는다. 할인은 "테이블 전체 단위"(tableVipDiscountType/
          // tableManualDiscountValue, 2026-09-07 확정 — 위
          // payment-discount-rules 참고)라 이 footer 버튼 하나에만 있다.
          const discountType = tableVipDiscountType;
          const manualValue = tableManualDiscountValue;
          // 特約95折/VIP9折와 직접 입력을 같이 걸 수 있으므로(2026-09-10)
          // 두 기준 금액을 모두 모아 한 번에 계산한다 — 서버(orders.js
          // computeDiscountAmount)와 같은 순서: VIP 먼저, 남은 금액에서 재량.
          const fullTotalAll = selections.reduce((s, x) => s + fullEligibleClientTotal(x.order, x.indexes), 0);
          const vipEligibleAll = selections.reduce((s, x) => s + discountEligibleClientTotal(x.order, x.indexes), 0);
          const breakdown = computeCombinedDiscountClient(discountType, manualValue, fullTotalAll, vipEligibleAll);
          // 얹어 둔 VIP 카드가 있으면 팝업이 두 몫을 갈라 보여준다.
          // 고르는 결제수단은 밥값 것이고, 카드값은 언제나 현금이다.
          const cardAmount = pendingVipCardAmountFor(tableNumber);
          const summary =
            fmtPaymentSummary(total, discountType, manualValue, breakdown) +
            (cardAmount ? fmtPaymentVipCardPart(total - breakdown.total, cardAmount) : "");
          const method = await showPaymentMethodPopup(summary, discountRequiresCashOnly(discountType));
          if (!method) return;
          // 사장님 피드백(2026-09-07, 스크린샷과 함께): "직접 숫자 로직
          // 이상해" — 정액(금액) 직접 할인은 特約95折/VIP9折(비율)와 달리
          // 라운드마다 독립적으로 적용하면 안 된다. 이 버튼은 체크된
          // 라운드마다 splitPayOrderItems를 따로 호출하는데, 서버(orders.js
          // computeDiscountAmount)는 각 호출을 그 라운드 자기 금액만 보고
          // 독립적으로 다시 계산하므로, 금액 그대로를 매 호출에 실어 보내면
          // 라운드 수만큼 곱절로(예: 500원이 3라운드 결제에서 최대
          // 1500원까지) 할인되는 버그가 있었다. 2라운드 이상을 한 번에
          // 결제할 때는 실제로 적용될 총 할인액을 동일 비율(%)로 환산해서
          // 보낸다 — 그러면 서버가 라운드별로 각자 계산해도 합이 원래
          // 의도한 총 할인액과 같아진다(特約95折/VIP9折가 원래 비율이라
          // 안전한 것과 같은 원리). 라운드가 1개뿐이면 애초에 곱절 문제가
          // 없으니 원래 값(사장님이 입력한 그대로) 그대로 보낸다.
          //
          // 2026-09-10: VIP 할인과 같이 걸 수 있게 되면서 환산 기준이
          // 바뀌었다. 서버의 재량 할인 기준은 "전체 금액"이 아니라 "VIP
          // 할인을 뺀 뒤 남은 금액"(computeDiscountAmount의 afterVip)이므로,
          // 퍼센트로 환산할 때도 그 기준으로 나눠야 라운드별 합이 원래
          // 의도한 할인액과 맞는다.
          const perCallManualValue =
            manualValue && manualValue.mode === "amount" && selections.length > 1 && breakdown.afterVip > 0
              ? { mode: "percent", value: Math.min(100, (breakdown.manualAmount / breakdown.afterVip) * 100) }
              : manualValue;
          const results = await Promise.all(
            selections.map((x) => splitPayOrderItems(x.order.id, x.indexes, method, discountType, perCallManualValue))
          );
          if (results.some((r) => !r.ok)) {
            await showAlert(T("paySelectedFailedMsg"));
          }
          // 밥값이 실제로 결제된 뒤에 카드를 판다. 순서가 반대면, 밥값
          // 결제가 실패했는데 카드만 팔려 있는 상태가 된다 — 손님은 아직
          // 아무것도 안 냈는데 장부에는 300이 들어와 있다.
          if (cardAmount && !results.some((r) => !r.ok)) {
            const sold = await sellVipCard(tableNumber, pendingVipCardSale.cardNumber);
            if (sold.ok) {
              clearPendingVipCardSale();
            } else {
              // 조용히 넘기지 않는다. 밥값은 받았고 카드만 안 팔린 상태라,
              // 직원이 그것을 모르면 손님은 돈을 내고 카드를 못 받는다.
              await showAlert(
                sold.body && sold.body.error === "card_exists" ? T("vipCardNumberTaken") : T("vipSellFailedAfterPay")
              );
            }
          }
          tableVipDiscountType = null; // 결제가 끝났으니 다음 결제를 위해 리셋
          tableManualDiscountValue = null;
          // 사장님 피드백(2026-09-06): "선택 결제 완료 버튼 누르고
          // 확인누르고 실제 적용되기까지 너무 오래 걸려" — 예전엔 여기서
          // loadOrders()로 이 식당 전체 주문을 통째로 다시 받아왔는데,
          // 그게 split-pay 요청들 자체보다도 훨씬 무거워서 체감 지연의
          // 대부분을 차지했다. 서버가 이미 돌려준 updatedOrder로 로컬
          // orders 배열의 같은 자리만 바꿔치면 화면은 똑같이 갱신되면서
          // 그 재조회 요청이 통째로 없어진다(unpaidOrders 등은 orders를
          // 필터링한 배열이라 참조가 아니라 값 복사이므로, 바로 아래
          // openTableDetail 재호출이 orders에서 새로 걸러 다시 그린다).
          results.forEach((r) => {
            if (!r.ok || !r.updatedOrder) return;
            const idx = orders.findIndex((o) => o.id === r.updatedOrder.id);
            if (idx !== -1) orders[idx] = r.updatedOrder;
          });
          selections.forEach((x) => x.indexes.forEach((i) => selectedPayItemKeys.delete(`${x.order.id}:${i}`)));
          // 라운드가 이번에 통째로 결제완료(paid)로 바뀐 경우에만, 서버가
          // 정리했을 수 있는 party_size(테이블 인원수 표시)를 반영하려고
          // 가벼운 테이블 목록을 다시 받아온다(loadTables가 renderTables도
          // 같이 해준다) — 매번 결제할 때마다 항상 다시 받아올 필요는
          // 없다. 그 외엔 renderTables()만 직접 불러 화면을 갱신한다.
          const roundFullyPaid = results.some((r) => r.ok && r.updatedOrder && r.updatedOrder.status === "paid");
          if (roundFullyPaid) await loadTables();
          else renderTables();
          renderOrders();
          if (!$("#floorPlanWrap").hidden && !floorPlanDragging) renderFloorPlan();
          if (!$("#tab-payment").hidden) renderPaymentFloorPlan();
          openTableDetail(tableNumber, label, focusOrderId);
          resetTableDetailScroll();
        };
      });
    $("#tableDetailBackdrop").hidden = false;
  }

  // renderTableOrderBlock(카드 하나 전체를 그리는 함수, 아래)와
  // renderMergedOrderGroup(여러 라운드를 카드 하나 안에 이어붙이는 함수,
  // 더 아래) 둘 다 "주문 하나"의 시간/품목/버튼/소계를 똑같이 필요로 해서
  // 공통 로직을 여기로 뽑아둔다 — 카드 테두리를 씌우는 방식만 둘이 다르다.
  // 한 품목 라인의 금액(단가+애드온 합)×수량 — 부분 결제(아래) 계산과
  // itemLines 표시에서 공통으로 쓰던 계산식을 하나로 모음.
  function lineTotalOf(it) {
    return (it.unit_price + (it.selected_addons || []).reduce((s, a) => s + a.price, 0)) * it.qty;
  }
  // 사장님 피드백(2026-09-05): "결제 완료했다고 사라지진 않았으면 좋겠어"
  // (체크한 품목 기준) — split-pay는 이제 체크한 품목을 다른 주문으로
  // 떼어내지 않고, 같은 주문 안에서 item.paid만 표시한다(서버쪽도 동일하게
  // 변경, src/routes/orders.js 참고). 그래서 "이 라운드에 아직 못 받은
  // 금액이 얼마인지"는 더 이상 o.total(품목 전체 합)이 아니라, paid 안 된
  // 품목만 더해야 한다 — 라운드가 이미 전부 결제완료(o.status==="paid")면
  // (이전 주문 탭에 보이는 지난 내역) 그때는 원래대로 전체 금액을 그대로
  // 보여준다.
  function remainingAmountOf(o) {
    if (o.status === "paid") return o.total;
    return o.items.reduce((s, it) => (it.paid ? s : s + lineTotalOf(it)), 0);
  }
  // 特約95折/VIP9折은 음료·주류(메뉴 카테고리 key "drink" — src/seed.js 참고,
  // 이 매장은 주류를 따로 분리하지 않고 drink 안에 함께 둔다)는 빼고
  // 적용된다. categories는 loadMenu()가 채워두는, 메뉴 관리 탭과 같은
  // 트리(각 카테고리에 items 배열)라 여기서 그대로 재사용한다. 실제
  // 반영/저장은 항상 서버(src/routes/orders.js)가 다시 계산하므로, 여기
  // 계산은 결제 방식 팝업에 보여줄 미리보기용일 뿐이다.
  function drinkItemIdSet() {
    const drinkCat = categories.find((c) => c.key === "drink");
    return new Set(drinkCat ? drinkCat.items.map((i) => i.id) : []);
  }
  function discountEligibleClientTotal(order, indexes) {
    const drinkIds = drinkItemIdSet();
    const idxs = indexes || order.items.map((_, i) => i);
    return idxs.reduce((s, i) => {
      const it = order.items[i];
      if (!it || drinkIds.has(it.item_id)) return s;
      return s + lineTotalOf(it);
    }, 0);
  }
  function computeVipDiscountClient(type, eligibleTotal) {
    const rate = VIP_DISCOUNT_RATES_CLIENT[type];
    if (!rate) return 0;
    return eligibleTotal - Math.round(eligibleTotal * rate);
  }
  // 직접 입력(재량 할인) 전용 — 特約95折/VIP9折와 달리 음료·주류를 빼지
  // 않는다(src/routes/orders.js의 fullEligibleTotal과 동일 규칙, 위
  // payment-discount-rules 참고).
  function fullEligibleClientTotal(order, indexes) {
    const idxs = indexes || order.items.map((_, i) => i);
    return idxs.reduce((s, i) => {
      const it = order.items[i];
      if (!it) return s;
      return s + lineTotalOf(it);
    }, 0);
  }
  function computeManualDiscountAmountClient(manualValue, eligibleTotal) {
    if (!manualValue) return 0;
    if (manualValue.mode === "percent") {
      return Math.min(eligibleTotal, Math.round(eligibleTotal * (manualValue.value / 100)));
    }
    return Math.min(eligibleTotal, Math.round(manualValue.value));
  }
  // 特約95折/VIP9折 + 직접 입력을 같이 걸었을 때의 미리보기 계산 — 서버의
  // src/routes/orders.js computeDiscountAmount와 반드시 같은 순서/기준이어야
  // 한다(화면에 보여준 실수령액과 실제 저장액이 어긋나면 안 되므로):
  // VIP 할인을 음료 제외 금액에 먼저 적용하고, 재량 할인은 그러고 남은
  // 실수령액(음료 포함 전체 - VIP 할인액)에서 뺀다. 둘 중 하나만 걸려
  // 있으면 예전 계산과 결과가 같다.
  //
  // fullTotal: 이번 대상 품목의 전체 금액(음료 포함)
  // vipEligibleTotal: 그중 음료·주류를 뺀 금액
  function computeCombinedDiscountClient(discountType, manualValue, fullTotal, vipEligibleTotal) {
    const vipAmount = computeVipDiscountClient(discountType, vipEligibleTotal);
    const afterVip = Math.max(0, fullTotal - vipAmount);
    const manualAmount = computeManualDiscountAmountClient(manualValue, afterVip);
    return { vipAmount, manualAmount, afterVip, total: vipAmount + manualAmount };
  }
  // buildReceiptBodyHtml()의 결제용 사본(priceCopy)에서 쓰는, "이 주문의
  // 테이블/포장카운터에 지금 걸려 있는 할인"을 결제 팝업(위
  // vipDiscountActive/vipRate 등, renderTableOrderBlock 쪽)과 완전히
  // 똑같은 규칙으로 다시 계산한다 — 화면과 티켓이 서로 다른 금액을 찍으면
  // 안 되므로 판단 기준(어떤 타입인지, 활성 여부)과 공식을 그대로
  // 재사용한다. 결제 팝업 로직 자체를 재사용하지 못하는 건 그쪽이 DOM을
  // 직접 그리는 함수라서이고, 여기는 숫자만 필요하다.
  function computeTicketDiscountInfo(o) {
    const vipCurrentType = isCounterOrder(o) ? counterVipDiscountTypeByOrderId.get(o.id) || null : tableVipDiscountType;
    const manualDiscountValue = isCounterOrder(o)
      ? counterManualDiscountValueByOrderId.get(o.id) || null
      : tableManualDiscountValue;
    const active = (!!vipCurrentType || !!manualDiscountValue) && o.status !== "paid" && o.status !== "cancelled";
    if (!active) return { active: false };
    const { total: discountAmount } = computeCombinedDiscountClient(
      vipCurrentType,
      manualDiscountValue,
      fullEligibleClientTotal(o),
      discountEligibleClientTotal(o)
    );
    // isPercent는 "품목 하나하나에 할인가를 나눠 찍을 수 있느냐"는 뜻이다.
    // 정액 재량 할인이 섞이면 품목별로 고르게 나눌 수 없으므로(위
    // fullEligibleClientTotal 주석), 그때는 소계/합계에서만 보여준다 —
    // 재량 할인이 걸려 있으면 항상 false.
    const isPercent = !!vipCurrentType && !manualDiscountValue;
    return {
      active: true,
      isPercent,
      rate: isPercent ? VIP_DISCOUNT_RATES_CLIENT[vipCurrentType] : undefined,
      discountedTotal: o.total - discountAmount,
    };
  }
  // 결제 방식/재량 할인 미리보기 계산을 한 곳에서 — 特約95折/VIP9折와
  // 직접 입력을 같이 걸었으면 둘을 합한 금액을 돌려준다(계산 순서는
  // computeCombinedDiscountClient 참고). 실제 반영 금액은 항상 서버가
  // 다시 계산하므로 여기 결과는 미리보기용.
  function previewDiscountAmount(discountType, manualValue, order, indexes) {
    if (!discountType && !manualValue) return 0;
    return computeCombinedDiscountClient(
      discountType,
      manualValue,
      fullEligibleClientTotal(order, indexes),
      discountEligibleClientTotal(order, indexes)
    ).total;
  }
  // 사장님 요청(2026-09-07): "vip 할인 옆에 결제자 재량으로 특정 금액/
  // 퍼센트 할인(직접 입력)이 가능하도록 넣어줘" → 곧이어 "팝업이 내부에서
  // 일어났으면 좋겠어" — 처음엔 브라우저 native window.prompt()로
  // 구현했었는데(이 파일에서 유일하게 native 팝업을 쓰는 곳이었다), 다른
  // 팝업(appDialogBackdrop, paymentMethodBackdrop)과 다르게 브라우저가
  // 그리는 OS 스타일 박스라 UI에서 붕 떠 보였다. #manualDiscountBackdrop
  // (admin.html)으로 같은 스타일의 인앱 모달로 바꾼다 — 모드(금액/퍼센트)
  // 버튼 두 개 + 숫자 입력칸 하나. 반환 규약은 이전과 동일: 취소하면
  // undefined(기존 값 유지), "할인 해제" 버튼이나 빈 입력으로 확인하면
  // null(할인 해제), 그 외 유효한 값이면 {mode, value} 객체.
  function promptManualDiscount(existing) {
    return new Promise((resolve) => {
      const backdrop = $("#manualDiscountBackdrop");
      const input = $("#manualDiscountValueInput");
      const errorEl = $("#manualDiscountError");
      const amountBtn = $("#manualDiscountModeAmount");
      const percentBtn = $("#manualDiscountModePercent");
      let mode = existing ? existing.mode : "amount";
      const paintMode = () => {
        const isAmount = mode === "amount";
        amountBtn.style.border = `1px solid ${isAmount ? "var(--red)" : "var(--line)"}`;
        amountBtn.style.background = isAmount ? "var(--red)" : "#fff";
        amountBtn.style.color = isAmount ? "#fff" : "var(--ink)";
        percentBtn.style.border = `1px solid ${!isAmount ? "var(--red)" : "var(--line)"}`;
        percentBtn.style.background = !isAmount ? "var(--red)" : "#fff";
        percentBtn.style.color = !isAmount ? "#fff" : "var(--ink)";
      };
      input.value = existing ? String(existing.value) : "";
      errorEl.hidden = true;
      paintMode();
      const finish = (result) => {
        backdrop.hidden = true;
        amountBtn.onclick = null;
        percentBtn.onclick = null;
        $("#manualDiscountOk").onclick = null;
        $("#manualDiscountClear").onclick = null;
        $("#manualDiscountCancel").onclick = null;
        input.onkeydown = null;
        resolve(result);
      };
      const submit = () => {
        const trimmed = input.value.trim();
        if (trimmed === "") {
          finish(null); // 빈 입력으로 확인 = 할인 해제
          return;
        }
        const num = parseFloat(trimmed);
        if (!Number.isFinite(num) || num <= 0 || (mode === "percent" && num > 100)) {
          errorEl.hidden = false;
          return;
        }
        finish({ mode, value: num });
      };
      amountBtn.onclick = () => {
        mode = "amount";
        paintMode();
      };
      percentBtn.onclick = () => {
        mode = "percent";
        paintMode();
      };
      $("#manualDiscountOk").onclick = submit;
      $("#manualDiscountClear").onclick = () => finish(null);
      $("#manualDiscountCancel").onclick = () => finish(undefined);
      input.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      };
      backdrop.hidden = false;
      input.focus();
      input.select();
    });
  }
  // 할인 토글 버튼 세 개. 特約95折/VIP9折는 서로 배타(같은 걸 다시 누르면
  // 해제)지만, "직접 입력"은 그 둘과 나란히 같이 켤 수 있다 — 사장님
  // 요청(2026-09-10), 위 tableManualDiscountValue 주석 참고. scope는 클릭
  // 핸들러가 어느 대상(테이블 전체는 "table", 포장 카운터 라운드는 그 주문
  // id)에 적용할지 구분하는 값으로, data 속성에 그대로 실어둔다.
  // manualValue는 "직접입력" 버튼에 지금 값을 라벨로 보여주기 위한 것
  // (tableManualDiscountValue 또는 counterManualDiscountValueByOrderId에서
  // scope에 맞게 뽑아 전달).
  function renderVipDiscountToggle(currentType, scope, manualValue) {
    const btn = (type) => {
      const active = currentType === type;
      return `<button type="button" data-vip-discount-btn="${type}" data-vip-discount-scope="${scope}" style="padding:6px 10px;font-size:13px;white-space:nowrap;border-radius:6px;border:1px solid ${active ? "var(--red)" : "var(--line)"};background:${active ? "var(--red)" : "#fff"};color:${active ? "#fff" : "var(--ink)"};cursor:pointer;">${VIP_DISCOUNT_LABELS[type]}</button>`;
    };
    const manualActive = !!manualValue;
    const manualBtn = `<button type="button" data-manual-discount-btn data-vip-discount-scope="${scope}" style="padding:6px 10px;font-size:13px;white-space:nowrap;border-radius:6px;border:1px solid ${manualActive ? "var(--red)" : "var(--line)"};background:${manualActive ? "var(--red)" : "#fff"};color:${manualActive ? "#fff" : "var(--ink)"};cursor:pointer;">${fmtManualDiscountLabel(manualValue)}</button>`;
    return `<div style="display:flex;gap:6px;flex-wrap:wrap;">${btn("te95")}${btn("vip9")}${manualBtn}</div>`;
  }
  // 소계/합계 줄에서 원래 금액을 회색 취소선으로, 그 옆에 할인 적용된 새
  // 금액을 보여주는 공용 헬퍼(2026-09-07 피드백) — discountAmount가 0/없음
  // 이면 그냥 원래 금액만 보여준다(할인 꺼짐, 또는 이 라운드에 할인 대상
  // 품목이 없어서 결과가 원래와 같은 경우).
  function vipTotalHtml(original, discountAmount) {
    if (!discountAmount) return `NT$${original}`;
    const newAmount = original - discountAmount;
    return `<span style="color:var(--muted);text-decoration:line-through;margin-right:6px;">NT$${original}</span><span>NT$${newAmount}</span>`;
  }
  // 사장님 피드백(2026-09-05): "外帶 에 있는 거 제외하고 다른 테이블
  // 전체들은 부분 결제를 허용해줘. 체크체크 해서 그것만 결제완료 할 수
  // 있게. 나눠서 계산할 수도 있고 그래서 그래" → 곧이어 "선택이 주문별이
  // 아니라 메뉴별이야" — 체크는 라운드(주문) 단위가 아니라 개별 메뉴
  // 품목 단위. selectedPayItemKeys(아래 선언)에 "주문id:품목인덱스" 키로
  // 담아둔 체크 상태를 실제 결제 대상으로 모아주는 헬퍼 — 주어진 주문
  // 목록(테이블 전체 or 카드 하나) 중 카운터가 아니고 아직 결제 전인
  // 주문에서, 체크된 품목이 하나라도 있는 주문만 {order, indexes, total}
  // 형태로 뽑아 배열로 돌려준다. 한 주문의 품목을 전부 체크했든 일부만
  // 체크했든 여기서는 구분하지 않는다 — 서버(split-pay)가 "전부 선택"이면
  // 그냥 주문 전체를 결제완료 처리하고, "일부만"이면 실제로 나눈다.
  function collectSelectedItemsByOrder(orders) {
    return orders
      .map((o) => {
        if (isCounterOrder(o) || o.status === "paid" || o.status === "cancelled") return null;
        const indexes = o.items.map((_, i) => i).filter((i) => selectedPayItemKeys.has(`${o.id}:${i}`) && !o.items[i].paid);
        if (!indexes.length) return null;
        const total = indexes.reduce((s, i) => s + lineTotalOf(o.items[i]), 0);
        return { order: o, indexes, total };
      })
      .filter(Boolean);
  }
  function buildOrderRoundParts(o, withDismiss) {
    const createdAt = new Date(o.created_at.replace(" ", "T"));
    // 2026-09-05 피드백: "시간 왼쪽에 간단하게 날짜까지 넣어줄래? 연도랑" —
    // 포장 카운터 픽업번호가 매일 1로 리셋되다 보니(위 orders.js 참고),
    // 시간만 봐서는 서로 다른 날짜의 "1번"들이 같은 날짜인 것처럼
    // 헷갈렸다. "연도.월.일" 형식으로 짧게 앞에 붙인다(예: 2026.9.2).
    const dateStr = `${createdAt.getFullYear()}.${createdAt.getMonth() + 1}.${createdAt.getDate()}`;
    const time = `${dateStr} ${createdAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
    // 부분 결제 체크박스는 카운터가 아니고 아직 결제 전인 주문에서만
    // 보인다(外帶 제외 — collectSelectedItemsByOrder와 같은 조건).
    const withItemCheckboxes = !isCounterOrder(o) && o.status !== "paid" && o.status !== "cancelled";
    // 사장님 피드백(2026-09-07, 스크린샷과 함께): "할인 버튼 밑으로 빨간
    // 글씨 넣지 말고 각 메뉴 가격, 소계, 합계 원래 가격을 회색처리 하고
    // 가운데 평행으로 줄 긋고 새 가격을 적어줘" — 별도 텍스트 배지 대신,
    // 할인 대상(드링크 제외, 이미 결제된 품목 제외) 가격 자체를 원래가
    // (회색 취소선) + 새 가격으로 바꿔서 보여준다. itemLines/소계/합계가
    // 모두 이 값들을 같이 써야 해서 itemLines보다 먼저 계산해둔다.
    const vipCurrentType = isCounterOrder(o) ? counterVipDiscountTypeByOrderId.get(o.id) || null : tableVipDiscountType;
    const manualDiscountValue = isCounterOrder(o)
      ? counterManualDiscountValueByOrderId.get(o.id) || null
      : tableManualDiscountValue;
    // 2026-09-10부터 둘은 따로 켜지고 같이 켤 수도 있다 — 어느 한쪽이라도
    // 켜져 있으면 할인이 걸린 상태다.
    const isManualDiscount = !!manualDiscountValue;
    const vipDiscountActive =
      (!!vipCurrentType || isManualDiscount) && o.status !== "paid" && o.status !== "cancelled";
    const vipRate = vipDiscountActive && vipCurrentType ? VIP_DISCOUNT_RATES_CLIENT[vipCurrentType] : null;
    // 직접 입력(재량) 할인은 음료를 빼지 않으므로(위 payment-discount-rules
    // 참고) 품목별 취소선 표시 대상에서 아예 빼지 않는다 — 대신 아래에서
    // isManualDiscount일 때 vipPriceHtml 자체를 건너뛴다(품목당 취소선은
    // 特約95折/VIP9折 전용, 재량 할인은 소계/합계에서만 보여준다 — 정액
    // 할인은 품목 하나하나에 고르게 나눌 수 없어서).
    const vipDrinkIds = vipDiscountActive && !isManualDiscount && vipRate ? drinkItemIdSet() : new Set();
    // amount(=이 줄의 원래 가격)를 받아, 할인 대상이면 "회색 취소선 원래가 +
    // 새 가격", 아니면(할인 꺼짐/드링크/이미 결제됨/재량 할인) 원래 표시
    // 그대로 반환.
    function vipPriceHtml(amount, isEligible) {
      if (!vipDiscountActive || isManualDiscount || !vipRate || !isEligible) return `NT$${amount}`;
      const discounted = amount - Math.round(amount * (1 - vipRate));
      return `<span style="color:var(--muted);text-decoration:line-through;margin-right:6px;">NT$${amount}</span><span style="font-weight:700;">NT$${discounted}</span>`;
    }
    // 이 라운드에서 아직 결제 안 된 품목들의 합계 기준으로 계산한 할인액 —
    // 소계/합계 표시에 재사용(품목 줄 하나하나를 따로 더해 반올림 오차가
    // 생기는 대신, 결제 팝업/서버와 같은 방식으로 한 번에 계산). 이미
    // 결제된 품목은 가격이 확정된 것이라 대상에서 제외한다. 직접 입력은
    // 음료를 포함한 전체 금액 기준(fullEligibleClientTotal), 特約95折/
    // VIP9折는 음료 제외 기준(discountEligibleClientTotal) — 위
    // payment-discount-rules 참고.
    const vipUnpaidIdxs = o.items.map((_, i) => i).filter((i) => !o.items[i].paid);
    const vipDiscountAmount = vipDiscountActive
      ? computeCombinedDiscountClient(
          vipCurrentType,
          manualDiscountValue,
          fullEligibleClientTotal(o, vipUnpaidIdxs),
          discountEligibleClientTotal(o, vipUnpaidIdxs)
        ).total
      : 0;
    const itemLines = o.items.map((it, idx) => {
      // 사장님 피드백(2026-09-05): "결제 완료했다고 사라지진 않았으면
      // 좋겠어" — 체크해서 결제완료 처리한 품목(it.paid)도 목록에서 빼지
      // 않고 계속 그 자리에 두되, 체크박스 대신 완료 표시(✓)와 "결제완료"
      // 배지를 붙이고 흐리게 보여서 이미 끝난 품목이라는 걸 표시한다. 다시
      // 체크할 수 없게 checkbox 자체를 없앤다.
      //
      // 사장님 피드백(2026-09-06, "이전 주문" 탭 스크린샷과 함께): "여전히
      // 오른쪽으로 넘어간다니까?" — 이 라운드가 이미 통째로 결제완료(주문
      // 상태 자체가 paid, 이전 주문 탭)된 뒤에는 개별 품목의 it.paid 여부가
      // 들쭉날쭉하다(구버전 "결제 완료로 변경"으로 끝난 라운드는 품목에
      // paid 플래그가 아예 없고, 새 부분결제로 하나씩 끝나서 완료된
      // 라운드만 있음). 그 결과 같은 목록 안에서 ✓ 아이콘이 있는 줄과 없는
      // 줄이 섞여 좌우 정렬이 안 맞았다 — 라운드 전체가 이미 끝난 뒤에는
      // 품목 하나하나를 구분해서 보여줄 필요가 없으므로, 그 라운드가
      // 아직 진행 중(active)일 때만 개별 품목의 완료 표시를 보여준다.
      const isPaidItem = o.status !== "paid" && !!it.paid;
      const isSelected = !isPaidItem && withItemCheckboxes && selectedPayItemKeys.has(`${o.id}:${idx}`);
      const checkboxHtml = isPaidItem
        ? `<span style="display:inline-block;width:16px;margin:2px 8px 0 0;flex-shrink:0;text-align:center;color:var(--muted);">✓</span>`
        : withItemCheckboxes
        ? `<input type="checkbox" data-select-item-key="${o.id}:${idx}" ${isSelected ? "checked" : ""} style="width:16px;height:16px;margin:2px 8px 0 0;cursor:pointer;flex-shrink:0;" />`
        : "";
      const paidBadgeHtml = isPaidItem
        ? `<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:10px;background:var(--line);color:var(--muted);font-size:12px;font-weight:600;vertical-align:middle;">${T("itemPaidBadge")}</span>`
        : "";
      // 체크했을 때 배경으로 표시하되, padding만큼 음수 margin을 같이 줘서
      // 체크 여부와 상관없이 좌우 폭이 그대로 유지되게 한다 — 사장님
      // 피드백: "선택하면 조금 좁아지는 현상이 있어. 그거 수정해줘." (체크
      // 안 한 다른 줄과 비교했을 때 내용이 안쪽으로 밀려 보이던 문제).
      //
      // 사장님 피드백(2026-09-06): "체크 박스뿐 아니라 메뉴 이름 눌러도
      // 체크되게 해줘" — 체크박스가 있는 줄(withItemCheckboxes && 아직
      // 미결제)은 data-select-item-row를 붙여서 줄 전체를 클릭 영역으로
      // 만든다. 실제 토글 처리는 아래 handler에서 체크박스의 change를
      // 그대로 재사용한다(checkbox.onchange 참고).
      const isRowClickable = withItemCheckboxes && !isPaidItem;
      return `<div ${isRowClickable ? `data-select-item-row="${o.id}:${idx}"` : ""} style="display:flex;align-items:flex-start;justify-content:space-between;font-size:16px;padding:5px 6px;margin:0 -6px;border-radius:6px;${isRowClickable ? "cursor:pointer;" : ""}${isSelected ? "background:#fdf1ea;" : ""}${isPaidItem ? "opacity:0.55;" : ""}">
          <span style="display:flex;align-items:flex-start;">${checkboxHtml}<span>${it.code ? `${it.code} ` : ""}${itemName(it)}${it.option_choice ? ` (${optionLabel(it.option_choice)})` : ""} x${it.qty}${paidBadgeHtml}${it.order_type === "takeout" ? ` <span class="order-card-type-badge takeout">${T("orderCardTakeoutBadge")}</span>` : ""}${it.takeout_choice ? ` <span class="order-card-type-badge takeout">${it.takeout_choice}</span>` : ""}${(it.selected_addons || []).length ? `<br/><small style="color:var(--muted);font-size:14px;">+${it.selected_addons.map((a) => a.name).join(", ")}</small>` : ""}${it.note ? `<br/><small style="color:var(--muted);font-size:14px;">${T("memoLabel")}: ${it.note}</small>` : ""}</span></span>
          <span>${vipPriceHtml(lineTotalOf(it), !isPaidItem && !vipDrinkIds.has(it.item_id))}</span>
        </div>`;
    });
    // 사장님 피드백(2026-09-05): "부분 결제 완료 너무 오래 걸려. 그리고
    // 한 번에 전체 체크랑 시간대별 한 번에 전체 체크 기능도 있으면 좋을 거
    // 같아" — 품목을 하나씩 체크하는 게 느리니, 라운드(시간대) 하나
    // 전체를 한 번에 체크/해제하는 토글을 라운드 헤더에 둔다(테이블
    // 전체를 한 번에 체크하는 토글은 openTableDetail에 따로 있음).
    // 사장님 피드백(2026-09-06): "하나 밖에 안남았어도 전체 선택 옵션은
    // 유지해줘" — 미결제 품목이 1개뿐이어도 계속 보여준다(예전엔 개별
    // 체크박스와 다를 게 없다고 숨겼었음).
    const unpaidIdxOfRound = withItemCheckboxes ? o.items.map((_, i) => i).filter((i) => !o.items[i].paid) : [];
    const roundAllSelected = unpaidIdxOfRound.length > 0 && unpaidIdxOfRound.every((i) => selectedPayItemKeys.has(`${o.id}:${i}`));
    const roundSelectAllHtml =
      unpaidIdxOfRound.length > 0
        ? `<label style="display:flex;align-items:center;gap:5px;font-size:13px;color:var(--muted);cursor:pointer;white-space:nowrap;flex-shrink:0;">
            <input type="checkbox" data-select-round-all="${o.id}" ${roundAllSelected ? "checked" : ""} style="width:14px;height:14px;cursor:pointer;" />
            ${T("selectRoundAllLabel")}
          </label>`
        : "";
    // Same fixed-size-by-default treatment as the order-queue cards (see
    // renderOrderCard) — a table with a big running order shouldn't force
    // the whole 테이블 상세 panel into a long scroll.
    const expanded = expandedOrderIds.has(o.id);
    const overflowCount = itemLines.length - ORDER_ITEMS_COLLAPSE_THRESHOLD;
    const visibleLines = expanded || overflowCount <= 0 ? itemLines : itemLines.slice(0, ORDER_ITEMS_COLLAPSE_THRESHOLD);
    const itemsHtml = visibleLines.join("");
    const itemsToggleHtml =
      overflowCount > 0
        ? `<button type="button" class="order-items-toggle" data-toggle-items-id="${o.id}">${
            expanded ? T("collapseItemsBtn") : fmtExpandItemsBtn(overflowCount)
          }</button>`
        : "";
    // 사장님 피드백(2026-09-06): "모든 기능을 다 오른쪽 제일 아래 있는
    // 걸로 합쳐서 넣어줘. 그리고 전체 결제 완료를 없애줘. 대신에 그
    // 기능은 모든 메뉴들을 체크하면 가능하게 해줘" — 라운드/카드마다
    // 따로 있던 결제 버튼(선택 결제 완료 ↔ 결제 완료로 변경)을 없애고,
    // 테이블 상세 화면 맨 아래(footer)의 버튼 하나로 합친다 — 아래
    // openTableDetail의 footerPayBtn 참고. 부분/전체 결제 모두 이제
    // "품목을 체크하고 그 버튼을 누르는" 한 가지 방식으로만 이뤄진다.
    // 단, 포장 카운터(外帶)는 서로 무관한 손님들 주문이라 애초에
    // 체크박스/합산 결제 대상이 아니므로(withItemCheckboxes가 항상
    // false), 카운터만은 예전처럼 카드 자신의 "결제 완료로 변경" 버튼을
    // 그대로 둔다 — 그게 그 손님 주문 하나를 처리하는 유일한 방법이다.
    const nextBtn =
      o.status === "paid" || o.status === "cancelled" || !isCounterOrder(o)
        ? ""
        : `<button class="primary-btn" style="padding:7px 14px;font-size:14px;white-space:nowrap;" data-advance-id="${o.id}" data-advance-to="paid">${T("nextServed")}</button>`;
    // 이미 일부 품목이 결제완료(item.paid) 처리된 주문은 "수정"을 막는다 —
    // 수정 화면은 품목을 통째로 새로 짜서 저장하는 방식이라(openOrderEdit),
    // 이미 결제된 품목과 같은 메뉴/옵션의 새 품목이 한 줄로 합쳐지거나
    // 수량이 바뀌면 어디까지가 이미 받은 돈인지 알 수 없게 꼬여버린다.
    const editBtn =
      o.status !== "paid" && o.status !== "cancelled" && !o.items.some((it) => it.paid) && canEditOrder()
        ? `<button style="padding:7px 14px;font-size:14px;white-space:nowrap;" data-edit-id="${o.id}">${T("orderEditBtn")}</button>`
        : "";
    // 特約95折/VIP9折 토글 — 사장님 요청: "수정 같은 열에 오른쪽에 넣고
    // 싶은 것들이 있어... vip 카드를 소지중이면 세일을 해주거든", 이어서
    // (footer 위쪽 별도 줄로 넣었던 첫 시도에 대한 피드백, 스크린샷과 함께):
    // "할인 위치를 가장 아래 수정 같은 수평선 오른쪽으로 넣어줘" — 그래서
    // footer가 아니라 항상 이 카드/라운드 자신의 "수정" 버튼과 같은 줄에
    // 둔다. 포장 카운터는 라운드 = 그 손님 주문 하나라는 단위가 이미
    // "전체"와 같으므로 그 라운드 자신의 값(주문 id별)을 쓰고, 진짜
    // 테이블은 결제가 테이블 전체 단위(footer의 결제 버튼 하나)로 이뤄지므로
    // 라운드가 여러 개여도 모두 같은 테이블 전체 값(tableVipDiscountType)을
    // 공유해서 보여준다 — 어느 라운드의 버튼을 눌러도 같은 값이 바뀌고,
    // 다시 그리면 모든 라운드의 버튼이 함께 갱신된다.
    const vipDiscountToggleHtml =
      o.status === "paid" || o.status === "cancelled"
        ? ""
        : isCounterOrder(o)
        ? renderVipDiscountToggle(vipCurrentType, String(o.id), manualDiscountValue)
        : renderVipDiscountToggle(vipCurrentType, "table", manualDiscountValue);
    // 포장 카운터의 "테이블 상세"는 서로 다른 손님들의 주문을 한 목록에 같이
    // 보여주므로 (전체 결제 완료 버튼은 이미 위에서 숨겼다), 어느 버튼이
    // 누구 주문인지 헷갈리지 않도록 블록마다 픽업 번호/성함을 붙여준다.
    // 사장님 요청: "주문시 이름과 전화번호를 같이 넣도록 했으니 포장 같은
    // 경우는 결제하는 이 화면에서 전화번호까지 볼 수 있도록" — 메인 주문
    // 큐 카드(위 renderOrderCard, ☎ 표시)와 같은 필드(o.customer_phone)를
    // 여기 결제 화면의 픽업 번호/성함 태그 옆에도 붙여준다.
    const counterPhone = isCounterOrder(o) && o.customer_phone ? ` · ☎${o.customer_phone}` : "";
    // 2026-09-05 피드백: "시간이랑 주문 상태는 번호 이름 전화번호 애들
    // 줄바꿈 밑으로 내려가게 해주고 아주 조금 연하게 해줘. 다른 거라는 걸
    // 인식할 수 있게" — 예전엔 "1번 · 김 · ☎0921167610 · 오전 01:48 ·
    // 서빙 완료"처럼 다 한 줄(굵게)로 붙어 있어서 "누구 주문인지"와
    // "언제/무슨 상태인지"가 안 구분됐다. 아래 return의 헤더에서 뒷부분
    // (더 이상 여기서 이어붙이지 않음 — 각자 자기 줄로) 없이 앞부분
    // 정체성 태그만 여기서 만든다.
    const counterTagPrefix = isCounterOrder(o) ? `${fmtCounterOrderTag(o)}${counterPhone}` : "";
    // 각 주문을 (구분선만 있던) 이어붙은 한 목록의 일부가 아니라 뚜렷한
    // 카드 하나로 보이도록 전체 테두리를 준다 — order-block-grid(위)가 여러
    // 개를 가로세로로 늘어놓을 때도, 주문이 하나뿐이라 그냥 하나만 보여줄
    // 때도 항상 "이건 하나의 독립된 주문"이라는 게 한눈에 보이게.
    //
    // withDismiss(주문이 2건 이상일 때만 true)면 카드 자기 자신의 ✕ 버튼을
    // 오른쪽 위 모서리에 달아준다 — 사장님 피드백: "이 엑스하는 창 같은 걸
    // 따로따로 다 만들어달라는 거였어" — 위쪽 모달 전체의 ✕와는 별개로,
    // 이 카드 하나만 이 화면에서 잠깐 치울 수 있게(결제 상태와는 무관, 아래
    // openTableDetail의 dismissedOrderIds 참고).
    const dismissBtn = withDismiss
      ? `<button type="button" class="table-order-block-dismiss" data-dismiss-id="${o.id}" title="${T("dismissOrderCardBtn")}" aria-label="${T("dismissOrderCardBtn")}">✕</button>`
      : "";
    // 2026-09-05: 라벨(픽업번호·이름·시간 등, 길어질 수 있음)과 버튼을 한
    // 줄에 나란히 두면 카드가 좁을 때 버튼 쪽 공간이 짓눌려 "결제 완료로
    // 변경" 글자가 한 글자씩 세로로 쪼개지는 문제가 있었다("좌우 너비가
    // 너무 좁아" 피드백). 라벨을 위 줄, 버튼을 아래 줄로 나누고 버튼에
    // white-space:nowrap을 줘서 버튼 텍스트는 절대 안 쪼개지고, 라벨만
    // 필요하면 줄바꿈되게 한다.
    //
    // 이어진 피드백: "모든 게 규격이 같았으면 좋겠어 예를들어 결제 완료로
    // 변경, 수정 위치랑 소계 위치랑 이런 거" — 한 줄에 여러 카드가 늘어설
    // 때, 카드마다 라벨 길이(1줄/2줄)와 품목 수가 달라서 버튼 줄과 소계
    // 줄의 세로 위치가 카드마다 들쭉날쭉했다. 두 가지로 고정한다:
    // (1) 라벨 영역에 min-height를 줘서 1줄이든 2줄이든 그 아래 버튼 줄은
    // 항상 같은 높이에서 시작하고, (2) 카드를 세로 flex로 만들고 소계
    // 줄에 margin-top:auto를 줘서 품목이 몇 개든 소계는 항상 카드
    // 맨 아래(같은 줄의 다른 카드와 격자로 높이가 맞춰짐, 위 .order-block-grid
    // 참고)에 붙는다.
    // 정체성 줄(픽업번호·이름·전화번호, 굵게)과 시간·상태 줄(연하게)을 위
    // 아래로 분리 — 진짜 테이블 주문(counterTagPrefix가 없음)은 시간·상태
    // 줄 하나만 뜬다. min-height는 정체성 줄이 전화번호까지 있어 2줄로
    // 줄바꿈되는 경우까지 감안한 값 — 다른 카드와 버튼 줄 위치가 계속
    // 맞도록(위 "규격이 같았으면" 수정과 같은 이유).
    const identityLineHtml = counterTagPrefix ? `<div style="font-weight:700;font-size:15px;">${counterTagPrefix}</div>` : "";
    const timeStatusLineHtml = `<div style="font-size:13px;color:var(--muted);margin-top:${counterTagPrefix ? "2px" : "0"};">${time} · ${statusLabel(o.status)}</div>`;
    const noteHtml = o.note ? `<p style="font-size:14px;color:var(--muted);margin:8px 0 0;">${T("orderMemoLabel")}: ${o.note}</p>` : "";
    return {
      time,
      identityLineHtml,
      timeStatusLineHtml,
      nextBtn,
      editBtn,
      vipDiscountToggleHtml,
      itemsHtml,
      itemsToggleHtml,
      noteHtml,
      dismissBtn,
      roundSelectAllHtml,
      total: remainingAmountOf(o),
      vipDiscountAmount,
    };
  }
  function renderTableOrderBlock(o, withDismiss) {
    const p = buildOrderRoundParts(o, withDismiss);
    // 사장님 피드백(2026-09-05): "위치를 번호, 메뉴 사이 말고 메뉴 아래에
    // 놨으면 좋겠어 전체적으로" — 결제 완료/수정 버튼을 시간·상태 줄과
    // 품목 목록 사이가 아니라 품목 목록 아래로 옮긴다(카운터 카드까지
    // 포함해서 전체적으로 적용).
    //
    // 이어진 피드백(카운터 격자 스크린샷과 함께): "결제완료 수정도 다른
    // 애들처럼 고정해줘 일관되게" — 버튼을 품목 바로 아래(품목 개수에
    // 따라 위치가 들쭉날쭉)에 두면, 카드마다 품목 수가 달라 같은 줄에
    // 늘어선 카드들 사이에서 버튼 높이가 서로 안 맞았다. 소계가
    // margin-top:auto로 카드 맨 아래에 항상 고정되는 것처럼, 버튼 줄도
    // 소계와 한 덩어리로 묶어 같이 margin-top:auto를 줘서 품목이 몇 개든
    // 항상 카드 맨 아래(같은 줄의 다른 카드와 격자로 높이가 맞춰짐)에
    // 붙게 한다.
    //
    // 사장님 피드백(2026-09-06, 테이블 1(라운드 3개)과 테이블 2(라운드
    // 1개) 스크린샷을 나란히 보여주며): "메뉴가 하나여도 합계가 있었으면
    // 좋겠어. 항상 전부가 UI가 같았으면 좋겠어" — 라운드가 여러 개라
    // renderMergedOrderGroup으로 병합될 때만 맨 아래에 빨간 "합계" 줄이
    // 있고, 라운드가 하나뿐이라 이 함수(단일 카드)로 그려질 때는 검정
    // "소계" 줄만 있어 두 화면의 생김새가 달랐다. 값 자체는 소계와
    // 같아지지만(라운드가 하나뿐이니 당연히), 라운드 개수와 무관하게
    // 카드 생김새가 항상 똑같아 보이도록 여기도 같은 빨간 "합계" 줄을
    // 추가한다 — 값은 병합 화면과 똑같이 o.total(부분결제와 무관한 고정
    // 총액, 위 renderMergedOrderGroup 참고)을 쓴다.
    return `
      <div class="table-order-block${withDismiss ? " table-order-block-windowed" : ""}">
        ${p.dismissBtn}
        <div style="margin-bottom:10px;min-height:58px;display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
          <div>
            ${p.identityLineHtml}
            ${p.timeStatusLineHtml}
          </div>
          ${p.roundSelectAllHtml}
        </div>
        ${p.itemsHtml}
        ${p.itemsToggleHtml}
        ${p.noteHtml}
        <div style="margin-top:auto;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-top:10px;">
            <div style="display:flex;gap:6px;flex-wrap:wrap;">${p.nextBtn}${p.editBtn}</div>
          </div>
          <div style="text-align:right;font-weight:700;font-size:16px;padding-top:8px;border-top:1px solid var(--line);">${T("subtotalLabel")} ${vipTotalHtml(p.total, p.vipDiscountAmount)}</div>
          ${p.vipDiscountToggleHtml ? `<div style="display:flex;justify-content:flex-end;padding:8px 0;">${p.vipDiscountToggleHtml}</div>` : ""}
          <div style="text-align:right;font-weight:800;font-size:17px;color:var(--red);margin-top:10px;padding-top:10px;border-top:1px solid var(--line);">${T("totalLabel")} ${vipTotalHtml(o.total, p.vipDiscountAmount)}</div>
        </div>
      </div>
    `;
  }
  // 사장님 피드백(2026-09-05, 테이블 6 스크린샷과 함께, 세 차례에 걸쳐):
  // 1) "이거 한 주문이잖아. 이건 나누면 안돼. 테이블 주문은 결제 전까지
  //    한 곳에서 추가주문을 하는 거라서 하나로 묶는 게 맞는 거 같아" —
  //    카드를 아예 분리하면 안 된다(위 openTableDetail의 isGrid를
  //    table.is_counter로 한정한 수정으로 해결).
  // 2) "하나로 만들어줘 대신에 그냥 시간대가 다르면 지금처럼 사이에
  //    시간만 나타내주고" — 라운드마다 따로 테두리 있는 카드로 보이는 것도
  //    원치 않는다. 카드(테두리) 자체를 하나로 합치고, 그 안에서 라운드가
  //    바뀌는 지점에만 옅은 구분선과 그 라운드의 시간을 표시.
  // 3) "결제완료랑 수정은 전체 주문당 하나씩 있으면 돼. 그리고 위치를
  //    번호, 메뉴 사이 말고 메뉴 아래에 놨으면 좋겠어 전체적으로" —
  //    라운드마다 반복되던 결제완료/수정 버튼도 없앤다. 이 병합 카드
  //    전체(=이 테이블의 미결제 탭 전체)에 대해 딱 한 쌍만, 모든 라운드의
  //    품목 아래에 둔다.
  //    - 결제 완료: merged 그룹은 항상 이 테이블의 미결제 주문 전체와
  //      같으므로(포커스 없이 여러 라운드가 보이는 건 always 전체 활성
  //      주문 — 위 openTableDetail 참고), 위 헤더의 "전체 결제 완료"와
  //      완전히 같은 동작이면 된다. 같은 .pay-all-btn 클래스를 붙여
  //      openTableDetail 안의 기존 핸들러(unpaidOrders 전부를 paid로)를
  //      그대로 재사용 — 새 JS 로직 불필요.
  //    - 수정: (2026-09-06 피드백 이전) 주문 하나만 고를 수 있으니, 가장
  //      최근(마지막) 라운드를 대상으로 했었다.
  //
  // 사장님 피드백(2026-09-06): "지금 수정 누르면 제일 아래 2개만 뜨거든?
  // 근데 주문 전체가 떠야 되던지 아니면 선택한 걸 수정하거나" — 위 "가장
  // 최근 라운드만 수정"이 오히려 다른 라운드 품목이 조용히 편집 대상에서
  // 빠지는 것처럼 보여 혼란을 줬다. openOrderEdit()가 애초에 주문(라운드)
  // 하나 단위로만 동작하고(서버 PATCH /api/orders/:id/items도 마찬가지 —
  // 여러 라운드를 한 번에 합쳐 편집/저장하려면 저장 시 다시 어느 품목이
  // 어느 라운드로 되돌아가야 하는지부터 정해야 해서 훨씬 큰 변경이 필요),
  // "주문 전체를 한 화면에서 통합 편집"보다는 "선택한 걸 수정" 쪽으로
  // 맞춘다 — 맨 아래 버튼 하나 대신, 각 라운드 소계 옆에 그 라운드만의
  // 수정 버튼을 되살려서(단일 카드일 때의 renderTableOrderBlock과 동일한
  // p.editBtn 재사용) 어느 라운드를 고칠지 항상 명확하게 고를 수 있게 한다.
  function renderMergedOrderGroup(orders) {
    // 사장님 피드백(2026-09-05): "外帶 에 있는 거 제외하고 다른 테이블
    // 전체들은 부분 결제를 허용해줘. 체크체크 해서 그것만 결제완료 할 수
    // 있게. 나눠서 계산할 수도 있고 그래서 그래" → 곧이어 "선택이 주문별이
    // 아니라 메뉴별이야" — 라운드 단위가 아니라 개별 메뉴 품목 단위로
    // 체크한다. 체크박스는 각 라운드의 품목 줄(p.itemsHtml, 위
    // buildOrderRoundParts에서 이미 붙여서 만들어짐)에 있으므로, 여기서는
    // 라운드 시간은 원래대로 그냥 텍스트로 두고(라운드 자체를 체크하는 게
    // 아니라서 라운드 전체에 배경을 주지 않는다), 맨 아래 버튼만 여러
    // 라운드에 걸쳐 체크된 품목을 모아 계산한다.
    // 사장님 피드백(2026-09-07): "가장 아래 수정 버튼이랑 수평으로 오른쪽
    // 정렬해서 한 곳에만 있었으면 좋겠어" → 곧이어 "위치를 마지막 소계와
    // 합계 사이에 공간 하나 만들어서 거기에다가 넣어줄래" — 特約95折/
    // VIP9折/직접입력은 테이블 전체에 공유되는 값 하나뿐인데(위
    // payment-discount-rules 참고) 라운드마다 반복해서 보여주면 마치
    // 라운드별로 따로 있는 것처럼 보인다. 토글은 맨 아래(마지막 소계와
    // 합계 사이)에 한 번만 보여준다(아래 discountRowHtml).
    //
    // 사장님 피드백(2026-09-07, 스크린샷과 함께): "직접 숫자 로직 이상해" —
    // 특히 정액(금액) 직접 할인은 라운드마다 독립적으로 적용하면 안 된다
    // (特約95折/VIP9折는 비율이라 라운드별로 계산해서 더해도 결과가 같지만,
    // 정액은 그렇지 않다 — 라운드가 3개면 최대 3배로 할인되어 보이는
    // 버그가 있었다). 그래서 라운드별 소계에는 더 이상 할인을 반영하지
    // 않고(항상 원래 금액), 할인은 테이블 전체 미결제 금액 기준으로 딱
    // 한 번만 계산해서 맨 아래 합계에 반영한다.
    const roundParts = orders.map((o) => buildOrderRoundParts(o, false));
    const roundsHtml = orders
      .map((o, i) => {
        const p = roundParts[i];
        const dividerStyle = i > 0 ? "margin-top:14px;padding-top:14px;border-top:1px dashed var(--line);" : "";
        // p.editBtn is already "" when this specific round is paid/cancelled
        // or has any part-paid item (see buildOrderRoundParts) — checking
        // per round here (instead of only the last one, as before) is what
        // fixes an earlier round wrongly staying editable after it was
        // already partially paid off.
        return `
          <div style="${dividerStyle}">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
              <span style="font-size:13px;color:var(--muted);">${p.time}</span>
              ${p.roundSelectAllHtml}
            </div>
            ${p.itemsHtml}
            ${p.itemsToggleHtml}
            ${p.noteHtml}
            <div style="display:flex;align-items:center;justify-content:${p.editBtn ? "space-between" : "flex-end"};gap:8px;margin-top:8px;">
              ${p.editBtn}
              <div style="text-align:right;font-weight:700;font-size:15px;">${T("subtotalLabel")} NT$${p.total}</div>
            </div>
          </div>
        `;
      })
      .join("");
    // 테이블 전체(미결제 라운드만) 기준으로 할인액을 딱 한 번 계산 — 위
    // 주석 참고. 이미 결제완료/취소된 라운드는 대상에서 빠진다(라운드별
    // 계산이던 buildOrderRoundParts의 vipDiscountActive 조건과 동일).
    // 特約95折/VIP9折와 직접 입력을 같이 걸 수 있으므로(2026-09-10) 두
    // 기준 금액을 함께 모은다 — VIP는 음료 제외, 재량은 음료 포함 전체.
    const tableDiscountActive = !!tableVipDiscountType || !!tableManualDiscountValue;
    let tableFullTotal = 0;
    let tableVipEligibleTotal = 0;
    if (tableDiscountActive) {
      orders.forEach((o) => {
        if (o.status === "paid" || o.status === "cancelled") return;
        const unpaidIdxs = o.items.map((_, idx) => idx).filter((idx) => !o.items[idx].paid);
        tableFullTotal += fullEligibleClientTotal(o, unpaidIdxs);
        tableVipEligibleTotal += discountEligibleClientTotal(o, unpaidIdxs);
      });
    }
    const tableDiscountAmount = tableDiscountActive
      ? computeCombinedDiscountClient(tableVipDiscountType, tableManualDiscountValue, tableFullTotal, tableVipEligibleTotal).total
      : 0;
    // 토글 자체는 어느 라운드에서 만들었든 동일(테이블 전체 공유 값)하므로
    // 마지막 라운드 것을 그대로 쓴다.
    const discountToggleHtml = roundParts[roundParts.length - 1].vipDiscountToggleHtml;
    const discountRowHtml = discountToggleHtml
      ? `<div style="display:flex;justify-content:flex-end;padding:8px 0;">${discountToggleHtml}</div>`
      : "";
    // 사장님 피드백(2026-09-05, 스크린샷과 함께): "합계는 가장 아래 소계
    // 아래에 하나 있었으면 좋겠어 다른 색으로" — 라운드마다 있는 소계
    // (검정 텍스트)와는 별개로, 맨 마지막 소계 바로 아래에 전체 라운드를
    // 합친 합계를 한 번만, 눈에 띄는 색(포인트 레드, 버튼과 같은 색)으로
    // 보여준다. 기존 소계보다 진하게/크게 해서 "이게 전체 합"이라는 게
    // 한눈에 구분되게 한다.
    //
    // 사장님 피드백(2026-09-06, 스크린샷과 함께): "저기서 뜨는 빨간 글씨의
    // 합계는 계산 완료랑 무관하게 전체 합계여서 바뀌면 안돼" — 위쪽
    // 헤더/맨 아래 footer의 "미결제 합계"(remainingAmountOf 기반, 부분
    // 결제로 품목이 하나둘 paid 처리될 때마다 정확히 그만큼 줄어드는 게
    // 맞는 값)와 달리, 이 빨간 합계는 "이 테이블이 지금까지 주문한 전체
    // 금액"이라 부분 결제 여부와 무관하게 항상 같은 값이어야 한다. 그런데
    // 여기 이전 코드가 잘못 remainingAmountOf(o)를 합산해서, 어떤 라운드가
    // 부분 결제(split-pay로 일부 품목만 paid)되면 그 순간부터 이 빨간
    // 합계도 (다른 미결제 합계들처럼) 슬쩍 줄어드는 버그가 있었다.
    // o.total은 그 라운드가 처음 주문/수정 저장될 때 한 번 계산되어
    // 박히는 값이라(품목이 이후에 부분결제로 paid 표시돼도 서버가
    // 건드리지 않음 — src/routes/orders.js의 split-pay 참고) 이걸 더하면
    // 항상 "전체 합계"를 유지한다. (2026-09-07: 여기에 特約95折/VIP9折/
    // 직접입력 할인이 활성화돼 있으면 위에서 계산한 tableDiscountAmount로
    // 취소선+할인가를 같이 보여준다 — 부분 결제 여부와는 여전히 무관.)
    const grandTotal = orders.reduce((s, o) => s + o.total, 0);
    const grandTotalHtml = `<div style="text-align:right;font-weight:800;font-size:17px;color:var(--red);margin-top:10px;padding-top:10px;border-top:1px solid var(--line);">${T("totalLabel")} ${vipTotalHtml(grandTotal, tableDiscountAmount)}</div>`;
    return `<div class="table-order-block">${roundsHtml}${discountRowHtml}${grandTotalHtml}</div>`;
  }
  $("#tableDetailClose").onclick = () => {
    $("#tableDetailBackdrop").hidden = true;
    openTableNumber = null;
    openTableLabel = null;
    openFocusOrderId = null;
  };
  $("#tableDetailBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "tableDetailBackdrop") {
      $("#tableDetailBackdrop").hidden = true;
      openTableNumber = null;
      openTableLabel = null;
      openFocusOrderId = null;
    }
  });

  // ---------- Floor plan (배치도) ----------
  // Height reserved at the top of every zone for its label / "+ 테이블" / ✕
  // buttons — tables can never be dragged or placed up into this strip.
  const ZONE_HEADER_HEIGHT = 34;
  // True while any zone/table drag or resize is in progress. The live poll
  // rebuilds the whole floor plan from scratch (see loadOrders below) —
  // doing that mid-drag would rip out the element being dragged and make it
  // look like it teleports back to its last saved spot, so we skip that
  // rebuild until the interaction finishes.
  let floorPlanDragging = false;

  // Shared save helper for every floor-plan edit (dragging/resizing a table
  // or zone, renaming a zone, unassigning a table). Every call site already
  // updates the local `tables`/`zones` model optimistically before this
  // resolves. If the PATCH fails, this un-does that local change and
  // rebuilds the floor plan from the (now-reverted) model, then tells the
  // owner — previously a failed save had NO feedback at all, so the move
  // just quietly vanished the next time the page reloaded or the 4s poll
  // rebuilt the floor plan ("자꾸 바꿨는데 다시 되돌아간다"). Returns true/false
  // so a caller that needs a re-render on SUCCESS too (e.g. unassigning a
  // table moves it to a different container) can decide that itself.
  async function patchFloorPlan(url, body, revert) {
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("save_failed");
      return true;
    } catch (e) {
      revert();
      await showAlert(T("alertFloorPlanSaveFailed"));
      renderFloorPlan();
      return false;
    }
  }
  // Generic drag helper: mousedown+drag moves the element (position: absolute
  // inside a position: relative parent); a small movement threshold tells a
  // real drag apart from a plain click, so tapping a table still opens its
  // detail modal without accidentally nudging it.
  function makeDraggable(el, opts) {
    // opts.bounded: true -> clamp to the parent element's own box (used for
    // tables, which must stay inside their zone). Zones themselves are left
    // unbounded (only clamped to >= 0) since they live directly on the canvas.
    let moved = false;
    el.addEventListener("mousedown", (e) => {
      if (e.target.closest(".resize-handle") || e.target.closest(".zone-label") || e.target.closest(".zone-del") || e.target.closest(".zone-add-btn") || e.target.closest(".table-unassign")) return;
      e.preventDefault();
      // A table sits inside its zone's DOM element, which has its own drag
      // handler for moving the zone — without this, starting a table drag
      // would bubble up and start dragging the zone underneath it too.
      e.stopPropagation();
      floorPlanDragging = true;
      moved = false;
      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      const parentRect = el.parentElement.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      const startX = rect.left - parentRect.left + el.parentElement.scrollLeft;
      const startY = rect.top - parentRect.top + el.parentElement.scrollTop;
      const maxX = opts.bounded ? Math.max(0, el.parentElement.clientWidth - rect.width) : Infinity;
      const maxY = opts.bounded ? Math.max(0, el.parentElement.clientHeight - rect.height) : Infinity;
      const minY = opts.minY || 0;
      // Tables must not be able to overlap each other — track the last
      // position that didn't overlap any sibling, and hold there instead of
      // passing through when the pointer tries to drag one table into another.
      let lastValidX = startX;
      let lastValidY = startY;

      // Alignment guides: snap to other tables' left/center/right edges (and
      // top/center/bottom) when close, like Figma/PowerPoint's smart guides
      // — so lining up a row of tables just clicks into place.
      const SNAP = 6;
      const siblings = opts.snapEnabled ? opts.getSnapSiblings() : [];
      let guideV = null;
      let guideH = null;
      function clearGuides() {
        if (guideV) {
          guideV.remove();
          guideV = null;
        }
        if (guideH) {
          guideH.remove();
          guideH = null;
        }
      }

      function onMove(e2) {
        const dx = e2.clientX - startMouseX;
        const dy = e2.clientY - startMouseY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
        let newX = Math.min(maxX, Math.max(0, startX + dx));
        let newY = Math.min(maxY, Math.max(minY, startY + dy));

        clearGuides();
        if (siblings.length) {
          const w = rect.width;
          const h = rect.height;
          const xOffsets = [0, w / 2, w]; // left, center, right
          const yOffsets = [0, h / 2, h]; // top, center, bottom
          let bestX = null;
          let bestXDelta = SNAP + 1;
          let bestY = null;
          let bestYDelta = SNAP + 1;
          siblings.forEach((s) => {
            const sXs = [s.left, s.left + s.width / 2, s.left + s.width];
            const sYs = [s.top, s.top + s.height / 2, s.top + s.height];
            xOffsets.forEach((offset, i) => {
              const mine = newX + offset;
              sXs.forEach((sx) => {
                const d = Math.abs(mine - sx);
                if (d < bestXDelta) {
                  bestXDelta = d;
                  bestX = { value: sx, offset: xOffsets[i], sib: s };
                }
              });
            });
            yOffsets.forEach((offset, i) => {
              const mine = newY + offset;
              sYs.forEach((sy) => {
                const d = Math.abs(mine - sy);
                if (d < bestYDelta) {
                  bestYDelta = d;
                  bestY = { value: sy, offset: yOffsets[i], sib: s };
                }
              });
            });
          });
          // The guide line only runs between the dragged table and the
          // sibling it snapped to — not all the way across the zone.
          if (bestX && bestXDelta <= SNAP) {
            newX = Math.min(maxX, Math.max(0, bestX.value - bestX.offset));
            const s = bestX.sib;
            const spanTop = Math.min(newY, s.top);
            const spanBottom = Math.max(newY + h, s.top + s.height);
            guideV = document.createElement("div");
            guideV.className = "align-guide align-guide-v";
            guideV.style.left = bestX.value + "px";
            guideV.style.top = spanTop + "px";
            guideV.style.height = spanBottom - spanTop + "px";
            el.parentElement.appendChild(guideV);
          }
          if (bestY && bestYDelta <= SNAP) {
            newY = Math.min(maxY, Math.max(minY, bestY.value - bestY.offset));
            const s = bestY.sib;
            const spanLeft = Math.min(newX, s.left);
            const spanRight = Math.max(newX + w, s.left + s.width);
            guideH = document.createElement("div");
            guideH.className = "align-guide align-guide-h";
            guideH.style.top = bestY.value + "px";
            guideH.style.left = spanLeft + "px";
            guideH.style.width = spanRight - spanLeft + "px";
            el.parentElement.appendChild(guideH);
          }
        }

        // Prevent tables from overlapping each other: if this position
        // would overlap a sibling, hold at the last position that didn't
        // (so a table bumps into its neighbor instead of passing through it).
        if (siblings.length) {
          const overlapsAny = siblings.some(
            (s) => newX < s.left + s.width && newX + rect.width > s.left && newY < s.top + s.height && newY + rect.height > s.top
          );
          if (overlapsAny) {
            newX = lastValidX;
            newY = lastValidY;
          } else {
            lastValidX = newX;
            lastValidY = newY;
          }
        }

        el.style.left = newX + "px";
        el.style.top = newY + "px";
      }
      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        clearGuides();
        if (moved) opts.onEnd(parseFloat(el.style.left), parseFloat(el.style.top));
        floorPlanDragging = false;
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
    el.addEventListener("click", (e) => {
      if (moved || el._suppressClick) {
        e.stopPropagation();
        e.preventDefault();
      } else if (opts.onClick) {
        opts.onClick();
      }
    });
  }

  function makeResizable(el, opts) {
    const handle = document.createElement("div");
    handle.className = "resize-handle";
    el.appendChild(handle);
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // A resize still ends in a native "click" on this element afterward
      // (mousedown + mouseup counts as a click even though we stopped the
      // mousedown from bubbling) — suppress that one click so resizing a
      // table doesn't also pop open its detail modal.
      el._suppressClick = true;
      floorPlanDragging = true;
      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      const rect = el.getBoundingClientRect();
      const startW = rect.width;
      const startH = rect.height;
      // opts.bounded: clamp so the table can't be resized past its zone's edge.
      const maxW = opts.bounded ? el.parentElement.clientWidth - el.offsetLeft : Infinity;
      const maxH = opts.bounded ? el.parentElement.clientHeight - el.offsetTop : Infinity;

      // Snap while resizing too: match another table's width/height exactly
      // (so a row ends up the same size), or line the growing right/bottom
      // edge up with another table's edge (so gaps stay even).
      const SNAP = 6;
      const siblings = opts.snapEnabled ? opts.getSnapSiblings() : [];
      const myLeft = el.offsetLeft;
      const myTop = el.offsetTop;
      // Only match/snap against tables that are actually nearby — matching
      // sizes or edges with something clear across the zone looks wrong.
      const PROXIMITY = 150;
      function isNearby(s, w, h) {
        const dx = Math.max(myLeft - (s.left + s.width), s.left - (myLeft + w), 0);
        const dy = Math.max(myTop - (s.top + s.height), s.top - (myTop + h), 0);
        return Math.sqrt(dx * dx + dy * dy) <= PROXIMITY;
      }
      let guideV = null;
      let guideH = null;
      let sizeMarks = [];
      function clearGuides() {
        if (guideV) {
          guideV.remove();
          guideV = null;
        }
        if (guideH) {
          guideH.remove();
          guideH = null;
        }
        sizeMarks.forEach((m) => m.remove());
        sizeMarks = [];
      }
      // Independent (non-connecting) markers drawn on BOTH tables' edges to
      // confirm a pure size match (e.g. this table's width now equals a
      // table beside it) — unlike the alignment guide above, these don't
      // need to touch since the two tables may not be lined up at all.
      function markV(x, top, bottom) {
        const m = document.createElement("div");
        m.className = "size-match-mark size-match-mark-v";
        m.style.left = x + "px";
        m.style.top = top + "px";
        m.style.height = bottom - top + "px";
        el.parentElement.appendChild(m);
        sizeMarks.push(m);
      }
      function markH(y, left, right) {
        const m = document.createElement("div");
        m.className = "size-match-mark size-match-mark-h";
        m.style.top = y + "px";
        m.style.left = left + "px";
        m.style.width = right - left + "px";
        el.parentElement.appendChild(m);
        sizeMarks.push(m);
      }

      function onMove(e2) {
        let w = Math.min(maxW, Math.max(opts.minWidth || 60, startW + (e2.clientX - startMouseX)));
        let h = Math.min(maxH, Math.max(opts.minHeight || 60, startH + (e2.clientY - startMouseY)));

        clearGuides();
        if (siblings.length) {
          // Two kinds of snap: matching another table's exact size (no
          // natural line to draw), or the growing edge lining up with a
          // sibling's edge (drawn as a short guide between the two tables
          // only, not stretched across the whole zone).
          let bestW = null;
          let bestWGuide = null;
          let bestWSizeSib = null;
          let bestWDelta = SNAP + 1;
          let bestH = null;
          let bestHGuide = null;
          let bestHSizeSib = null;
          let bestHDelta = SNAP + 1;
          siblings.filter((s) => isNearby(s, w, h)).forEach((s) => {
            const dW = Math.abs(w - s.width);
            if (dW < bestWDelta) {
              bestWDelta = dW;
              bestW = s.width;
              bestWGuide = null;
              bestWSizeSib = s;
            }
            [s.left, s.left + s.width / 2, s.left + s.width].forEach((tx) => {
              const d = Math.abs(myLeft + w - tx);
              if (d < bestWDelta) {
                bestWDelta = d;
                bestW = tx - myLeft;
                bestWGuide = { x: tx, sib: s };
                bestWSizeSib = null;
              }
            });
            const dH = Math.abs(h - s.height);
            if (dH < bestHDelta) {
              bestHDelta = dH;
              bestH = s.height;
              bestHGuide = null;
              bestHSizeSib = s;
            }
            [s.top, s.top + s.height / 2, s.top + s.height].forEach((ty) => {
              const d = Math.abs(myTop + h - ty);
              if (d < bestHDelta) {
                bestHDelta = d;
                bestH = ty - myTop;
                bestHGuide = { y: ty, sib: s };
                bestHSizeSib = null;
              }
            });
          });
          if (bestW != null && bestWDelta <= SNAP) {
            w = Math.min(maxW, Math.max(opts.minWidth || 60, bestW));
            if (bestWGuide) {
              const s = bestWGuide.sib;
              const spanTop = Math.min(myTop, s.top);
              const spanBottom = Math.max(myTop + h, s.top + s.height);
              guideV = document.createElement("div");
              guideV.className = "align-guide align-guide-v";
              guideV.style.left = bestWGuide.x + "px";
              guideV.style.top = spanTop + "px";
              guideV.style.height = spanBottom - spanTop + "px";
              el.parentElement.appendChild(guideV);
            } else if (bestWSizeSib) {
              // Pure size match (widths now equal) — mark both tables' own
              // left/right edges independently, no connecting line.
              const s = bestWSizeSib;
              markV(myLeft, myTop, myTop + h);
              markV(myLeft + w, myTop, myTop + h);
              markV(s.left, s.top, s.top + s.height);
              markV(s.left + s.width, s.top, s.top + s.height);
            }
          }
          if (bestH != null && bestHDelta <= SNAP) {
            h = Math.min(maxH, Math.max(opts.minHeight || 60, bestH));
            if (bestHGuide) {
              const s = bestHGuide.sib;
              const spanLeft = Math.min(myLeft, s.left);
              const spanRight = Math.max(myLeft + w, s.left + s.width);
              guideH = document.createElement("div");
              guideH.className = "align-guide align-guide-h";
              guideH.style.top = bestHGuide.y + "px";
              guideH.style.left = spanLeft + "px";
              guideH.style.width = spanRight - spanLeft + "px";
              el.parentElement.appendChild(guideH);
            } else if (bestHSizeSib) {
              // Pure size match (heights now equal) — mark both tables' own
              // top/bottom edges independently, no connecting line.
              const s = bestHSizeSib;
              markH(myTop, myLeft, myLeft + w);
              markH(myTop + h, myLeft, myLeft + w);
              markH(s.top, s.left, s.left + s.width);
              markH(s.top + s.height, s.left, s.left + s.width);
            }
          }
        }

        // Prevent tables from overlapping each other while resizing — stop
        // growing right where a table to the right/below already sits.
        if (siblings.length) {
          siblings.forEach((s) => {
            const vOverlap = myTop < s.top + s.height && myTop + h > s.top;
            if (vOverlap && s.left >= myLeft) w = Math.min(w, s.left - myLeft);
          });
          siblings.forEach((s) => {
            const hOverlap = myLeft < s.left + w && myLeft + w > s.left;
            if (hOverlap && s.top >= myTop) h = Math.min(h, s.top - myTop);
          });
          w = Math.max(opts.minWidth || 60, w);
          h = Math.max(opts.minHeight || 60, h);
        }

        el.style.width = w + "px";
        el.style.height = h + "px";
      }
      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        clearGuides();
        opts.onEnd(parseFloat(el.style.width), parseFloat(el.style.height));
        setTimeout(() => (el._suppressClick = false), 0);
        floorPlanDragging = false;
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  async function loadZones() {
    const res = await fetch("/api/zones");
    zones = await res.json();
  }

  function renderTableBlock(container, t) {
    const unpaid = activeOrdersForTable(t.number).filter((o) => o.status !== "paid");
    // Correct any table that ended up above the header strip (e.g. placed
    // before this protection existed) — nudge it down and persist the fix.
    if (t.y == null || t.y < ZONE_HEADER_HEIGHT) {
      t.y = ZONE_HEADER_HEIGHT;
      fetch(`/api/tables/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ y: t.y }),
      });
    }
    const el = document.createElement("div");
    el.className = "table-block" + (unpaid.length ? " has-order" : "");
    el.style.left = (t.x != null ? t.x : 10) + "px";
    el.style.top = t.y + "px";
    el.style.width = (t.width || 70) + "px";
    el.style.height = (t.height || 70) + "px";
    const unassignBtn = canTableEdit() ? `<button class="table-unassign" title="${T("tableUnassignTitle")}">✕</button>` : "";
    el.innerHTML = `
      ${unassignBtn}
      <span>${t.label || t.number}</span>${t.party_size ? `<span class="tb-party">${fmtPartySeat(t)}</span>` : ""}
    `;
    container.appendChild(el);

    if (canTableEdit()) {
      el.querySelector(".table-unassign").onclick = async (e) => {
        e.stopPropagation();
        if (!(await showConfirm(fmtConfirmUnassignTable(t.label || t.number)))) return;
        const prevZoneId = t.zone_id;
        t.zone_id = null;
        const ok = await patchFloorPlan(`/api/tables/${t.id}`, { zoneId: null }, () => {
          t.zone_id = prevZoneId;
        });
        if (ok) renderFloorPlan();
      };
    }

    const getSnapSiblings = () =>
      [...container.querySelectorAll(".table-block")]
        .filter((sib) => sib !== el)
        .map((sib) => ({ left: sib.offsetLeft, top: sib.offsetTop, width: sib.offsetWidth, height: sib.offsetHeight }));

    // Staff without tableEdit can still see the floor plan and tap a table
    // to open its order detail, but can't drag/resize it around (the PATCH
    // would be rejected server-side anyway) or pull it out of the zone.
    if (canTableEdit()) {
      makeDraggable(el, {
        bounded: true,
        minY: ZONE_HEADER_HEIGHT,
        snapEnabled: true,
        getSnapSiblings,
        onEnd: async (x, y) => {
          const prevX = t.x;
          const prevY = t.y;
          t.x = x;
          t.y = y;
          await patchFloorPlan(`/api/tables/${t.id}`, { x, y }, () => {
            t.x = prevX;
            t.y = prevY;
          });
        },
        onClick: () => openTableDetail(t.number, t.label),
      });
      makeResizable(el, {
        bounded: true,
        minWidth: 44,
        minHeight: 44,
        snapEnabled: true,
        getSnapSiblings,
        onEnd: async (width, height) => {
          const prevWidth = t.width;
          const prevHeight = t.height;
          t.width = width;
          t.height = height;
          await patchFloorPlan(`/api/tables/${t.id}`, { width, height }, () => {
            t.width = prevWidth;
            t.height = prevHeight;
          });
        },
      });
    } else {
      el.onclick = () => openTableDetail(t.number, t.label);
    }
  }

  // Lays newly-added tables out into empty grid cells inside the zone,
  // scanning around whatever's already placed there so nothing overlaps.
  // Returns where each new table should go, plus how tall the zone needs to
  // be to fit everything (grows downward — width stays as the owner set it).
  function layoutNewTablesInZone(zone, existingInZone, newTables) {
    const cellW = 80;
    const cellH = 80;
    const marginX = 10;
    const topOffset = ZONE_HEADER_HEIGHT;
    const cols = Math.max(1, Math.floor((zone.width - marginX * 2) / cellW));
    const occupied = new Set();
    existingInZone.forEach((t) => {
      const col = Math.max(0, Math.round(((t.x != null ? t.x : marginX) - marginX) / cellW));
      const row = Math.max(0, Math.round(((t.y != null ? t.y : topOffset) - topOffset) / cellH));
      occupied.add(`${row},${col}`);
    });
    const placements = [];
    let row = 0;
    newTables.forEach((t) => {
      let placed = false;
      while (!placed) {
        for (let col = 0; col < cols; col++) {
          const key = `${row},${col}`;
          if (!occupied.has(key)) {
            occupied.add(key);
            placements.push({ table: t, x: marginX + col * cellW, y: topOffset + row * cellH });
            placed = true;
            break;
          }
        }
        if (!placed) row++;
      }
    });
    const maxRow = Math.max(0, ...[...occupied].map((k) => parseInt(k.split(",")[0], 10)));
    const neededHeight = topOffset + (maxRow + 1) * cellH + 10;
    return { placements, neededHeight };
  }

  function addTableToZone(zone) {
    // 2026-09-05: 포장 카운터(is_counter)도 다른 테이블처럼 tables 배열의
    // 한 행일 뿐이라 zone_id가 null이면 배치도/결제탭 어디에도 안 보인다.
    // 예전엔 여기서 카운터를 일부러 제외했었는데(카운터는 자체 QR 카드가
    // 따로 있으니 배치도에 놓을 일이 없다고 가정한 듯), 결제탭에 포장 주문을
    // 개별 타일로 쪼개서 보여주는 기능이 생기면서 카운터도 다른 테이블처럼
    // 반드시 어느 존엔가 배치돼 있어야 그 타일들이 뜬다. 그런데 카운터가
    // 배치된 적이 한 번도 없어서(zone_id: null) 화면에 계속 안 나타났고,
    // 사장님이 대신 "外帶"라는 이름의 평범한 테이블을 하나 만들어서 눌러보고
    // 계셨던 것 — 그 테이블엔 실제 포장 주문이 절대 안 붙는다(진짜 포장
    // 주문은 테이블 번호 "COUNTER"로 들어가지, "外帶" 테이블 번호로는 안
    // 들어가서). 카운터를 이 "미배치 테이블" 목록에도 포함시켜서, 사장님이
    // 원래 쓰던 "+테이블 추가" 방식 그대로 카운터를 원하는 자리에 직접 놓을
    // 수 있게 한다.
    const unplaced = tables.filter((t) => t.zone_id == null);
    const selected = new Set();
    $("#addTableToZoneTitle").textContent = fmtAddTableToZoneTitle(zone.name);
    const grid = $("#addTableToZoneGrid");
    grid.innerHTML = "";
    if (unplaced.length === 0) {
      grid.innerHTML = `<div class="table-picker-empty">${T("addTableToZoneEmpty")}</div>`;
    } else {
      unplaced
        // 포장 카운터는 번호가 "COUNTER"라 parseInt가 NaN이 되어 정렬이
        // 뒤죽박죽될 수 있었다 — 카운터는 항상 맨 앞에 고정.
        .sort((a, b) => {
          if (a.is_counter !== b.is_counter) return a.is_counter ? -1 : 1;
          return parseInt(a.number, 10) - parseInt(b.number, 10);
        })
        .forEach((t) => {
          const btn = document.createElement("button");
          btn.className = "table-picker-btn";
          btn.textContent = tableDisplayName(t);
          btn.onclick = () => {
            if (selected.has(t.id)) {
              selected.delete(t.id);
              btn.classList.remove("selected");
            } else {
              selected.add(t.id);
              btn.classList.add("selected");
            }
          };
          grid.appendChild(btn);
        });
    }
    $("#addTableToZoneBackdrop").hidden = false;

    $("#addTableToZoneConfirm").onclick = async () => {
      if (selected.size === 0) {
        $("#addTableToZoneBackdrop").hidden = true;
        return;
      }
      const chosen = unplaced.filter((t) => selected.has(t.id));
      const existingInZone = tables.filter((t) => t.zone_id === zone.id);
      const { placements, neededHeight } = layoutNewTablesInZone(zone, existingInZone, chosen);

      if (neededHeight > zone.height) {
        zone.height = neededHeight;
        await fetch(`/api/zones/${zone.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ height: neededHeight }),
        });
      }

      await Promise.all(
        placements.map(({ table: t, x, y }) => {
          t.zone_id = zone.id;
          t.x = x;
          t.y = y;
          return fetch(`/api/tables/${t.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ zoneId: zone.id, x, y }),
          });
        })
      );

      $("#addTableToZoneBackdrop").hidden = true;
      renderFloorPlan();
    };
  }
  $("#addTableToZoneClose").onclick = () => ($("#addTableToZoneBackdrop").hidden = true);
  $("#addTableToZoneCancel").onclick = () => ($("#addTableToZoneBackdrop").hidden = true);
  $("#addTableToZoneBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "addTableToZoneBackdrop") $("#addTableToZoneBackdrop").hidden = true;
  });

  function renderFloorPlan() {
    const wrap = $("#floorPlan");
    wrap.innerHTML = "";

    [...zones].sort((a, b) => a.sort_order - b.sort_order).forEach((z) => {
      const el = document.createElement("div");
      el.className = "zone-block";
      el.style.left = z.x + "px";
      el.style.top = z.y + "px";
      el.style.width = z.width + "px";
      el.style.height = z.height + "px";
      const zoneButtons = canTableEdit()
        ? `<button class="zone-add-btn" title="${T("zoneAddBtnTitle")}">${T("zoneAddBtnLabel")}</button>
           <button class="zone-del" title="${T("zoneDelTitle")}">✕</button>`
        : "";
      el.innerHTML = `
        <span class="zone-label">${z.name}</span>
        ${zoneButtons}
      `;
      wrap.appendChild(el);

      // Everything below (renaming, adding/removing tables, deleting the
      // zone, dragging/resizing it) is floor-plan editing — gated the same
      // way as the table controls above.
      if (canTableEdit()) {
        el.querySelector(".zone-label").onclick = async () => {
          const name = prompt(T("promptZoneName"), z.name);
          if (name && name.trim() && name.trim() !== z.name) {
            const prevName = z.name;
            z.name = name.trim();
            el.querySelector(".zone-label").textContent = z.name;
            await patchFloorPlan(`/api/zones/${z.id}`, { name: z.name }, () => {
              z.name = prevName;
            });
          }
        };
        el.querySelector(".zone-add-btn").onclick = (e) => {
          e.stopPropagation();
          addTableToZone(z);
        };
        el.querySelector(".zone-del").onclick = async (e) => {
          e.stopPropagation();
          if (!(await showConfirm(fmtConfirmDeleteZone(z.name)))) return;
          await fetch(`/api/zones/${z.id}`, { method: "DELETE" });
          tables.filter((t) => t.zone_id === z.id).forEach((t) => (t.zone_id = null));
          await loadZones();
          renderFloorPlan();
        };

        makeDraggable(el, {
          onEnd: async (x, y) => {
            const prevX = z.x;
            const prevY = z.y;
            z.x = x;
            z.y = y;
            await patchFloorPlan(`/api/zones/${z.id}`, { x, y }, () => {
              z.x = prevX;
              z.y = prevY;
            });
          },
        });
      }
      // A zone can never be shrunk smaller than the tables already sitting
      // inside it — the floor for the resize is whichever is bigger: the
      // fixed minimum, or the bounding box of its current tables.
      const tablesInThisZone = tables.filter((t) => t.zone_id === z.id);
      if (canTableEdit()) {
        const requiredWidth = tablesInThisZone.reduce((m, t) => Math.max(m, (t.x || 0) + (t.width || 70) + 10), 120);
        const requiredHeight = tablesInThisZone.reduce((m, t) => Math.max(m, (t.y || 0) + (t.height || 70) + 10), 100);
        makeResizable(el, {
          minWidth: requiredWidth,
          minHeight: requiredHeight,
          onEnd: async (width, height) => {
            const prevWidth = z.width;
            const prevHeight = z.height;
            z.width = width;
            z.height = height;
            await patchFloorPlan(`/api/zones/${z.id}`, { width, height }, () => {
              z.width = prevWidth;
              z.height = prevHeight;
            });
          },
        });
      }

      tablesInThisZone.forEach((t) => renderTableBlock(el, t));
    });
  }

  // 결제 탭(item 22) — "테이블 / QR 코드" 탭의 배치도(zones/tables, 같은
  // 전역 변수)를 그대로 재사용해서 보여주지만, 여기서는 항상 보기 전용:
  // 드래그/크기조절/구역 추가삭제/좌석 떼어내기 같은 편집 기능은 아예
  // 붙이지 않고, 좌석을 누르면 바로 openTableDetail()이 열려 결제로
  // 이어진다 (item 23에서 통일한 "상태 무관 결제 완료" 버튼과 그대로
  // 이어짐). renderFloorPlan()과 달리 canTableEdit() 분기 자체가 없다 —
  // 사장님이든 직원이든 이 탭에서는 절대 배치가 흐트러지지 않는다.
  function renderPaymentFloorPlan() {
    const wrap = $("#paymentFloorPlan");
    if (!wrap) return;
    wrap.innerHTML = "";
    [...zones].sort((a, b) => a.sort_order - b.sort_order).forEach((z) => {
      const zoneEl = document.createElement("div");
      zoneEl.className = "zone-block";
      zoneEl.style.left = z.x + "px";
      zoneEl.style.top = z.y + "px";
      zoneEl.style.width = z.width + "px";
      zoneEl.style.height = z.height + "px";
      zoneEl.innerHTML = `<span class="zone-label">${z.name}</span>`;
      wrap.appendChild(zoneEl);

      tables
        .filter((t) => t.zone_id === z.id)
        .forEach((t) => {
          const unpaid = activeOrdersForTable(t.number).filter((o) => o.status !== "paid");
          const left = t.x != null ? t.x : 10;
          const top = t.y != null ? t.y : ZONE_HEADER_HEIGHT;
          const w = t.width || 70;
          const h = t.height || 70;
          const gap = 8;
          // "완전 포장" 주문은 진짜 테이블에서는 별도 타일로 분리해서 그
          // 주문 하나만 바로 결제할 수 있게 한다 — 사장님 피드백
          // (2026-09-05): "혼합은 적용 안 할거고 완전 포장인 것만 적용할
          // 거야... 현재 이미 있는 포장 애들도 적용해줘. 저기 저 박스
          // 누르면 나오게 해달라는 말이야".
          //
          // 포장 카운터(is_counter)는 정반대다 — 사장님 피드백(2026-09-05,
          // 후속): "모든 포장 카운터 번호들은 전부 저 하나에 테이블에
          // 들어갈건데 그 테이블을 누르면 여러개 나열해서 나오게 해달라고".
          // 즉 카운터는 서로 무관한 손님들 주문이 여러 건 쌓여도 배치도
          // 상에는 항상 "포장 카운터" 타일 하나만 있고, 그 타일을 누르면
          // (openTableDetail을 focusOrderId 없이 호출 → 아래 body가 모든
          // 미결제 주문을 각자 카드로 나열하고, 카운터는 payAllBtn도 이미
          // 꺼져 있어 각 카드의 개별 "결제 완료로 변경" 버튼으로만 처리됨)
          // 그 목록이 펼쳐진다. 카운터를 주문 개수만큼 옆으로 늘어놓던
          // 이전 방식(이 세션 초반의 결제탭 포장 타일 분리 작업)은 되돌림.
          const takeoutOrders = t.is_counter ? [] : unpaid.filter((o) => o.order_type === "takeout");
          const bundledOrders = t.is_counter ? unpaid : unpaid.filter((o) => o.order_type !== "takeout");
          const showMainTile = t.is_counter || bundledOrders.length > 0 || unpaid.length === 0;

          let nextLeft = left;
          if (showMainTile) {
            const tableEl = document.createElement("div");
            tableEl.className = "table-block" + (bundledOrders.length ? " has-order" : "");
            // 어느 자리 타일인지 화면에서 집어낼 수 있게 남긴다 — 타일에
            // 보이는 글자는 표시 이름(label)일 수도 있어서 글자로는 못 찾는다.
            tableEl.dataset.tableNumber = t.number;
            tableEl.style.left = nextLeft + "px";
            tableEl.style.top = top + "px";
            tableEl.style.width = w + "px";
            tableEl.style.height = h + "px";
            tableEl.innerHTML = `
              <span>${t.label || t.number}</span>${t.party_size ? `<span class="tb-party">${fmtPartySeat(t)}</span>` : ""}
            `;
            tableEl.onclick = () => openTableDetail(t.number, t.label);
            zoneEl.appendChild(tableEl);
            nextLeft += w + gap;
          }

          takeoutOrders.forEach((o) => {
            const tileEl = document.createElement("div");
            tileEl.className = "table-block has-order takeout-order-tile";
            tileEl.dataset.tableNumber = t.number;
            tileEl.dataset.orderId = o.id;
            tileEl.style.left = nextLeft + "px";
            tileEl.style.top = top + "px";
            tileEl.style.width = w + "px";
            tileEl.style.height = h + "px";
            tileEl.innerHTML = `
              <span>${t.label || t.number}</span><span class="tb-counter-tag">${fmtTakeoutTileTag(t, o)}</span>
            `;
            tileEl.onclick = () => openTableDetail(t.number, t.label, o.id);
            zoneEl.appendChild(tileEl);
            nextLeft += w + gap;
          });
        });
    });
  }

  $("#viewListBtn").onclick = () => {
    $("#viewListBtn").classList.add("active");
    $("#viewFloorBtn").classList.remove("active");
    $("#tablesList").hidden = false;
    $("#floorPlanWrap").hidden = true;
    $("#addZoneBtn").hidden = true;
    $("#saveFloorPlanBtn").hidden = true;
  };
  $("#viewFloorBtn").onclick = async () => {
    $("#viewFloorBtn").classList.add("active");
    $("#viewListBtn").classList.remove("active");
    $("#tablesList").hidden = true;
    $("#floorPlanWrap").hidden = false;
    $("#addZoneBtn").hidden = false;
    $("#saveFloorPlanBtn").hidden = false;
    await loadZones();
    renderFloorPlan();
  };

  // ---------- 합산 결제 (combine several tables' unpaid orders into one
  // payment action, for a group that came in together but sat at more than
  // one table) ----------
  function updateMergePayBar() {
    const bar = $("#mergePayBar");
    if (!mergePayMode || mergePaySelected.size === 0) {
      bar.hidden = true;
      return;
    }
    let orderCount = 0;
    let total = 0;
    mergePaySelected.forEach((tableNumber) => {
      activeOrdersForTable(tableNumber)
        .filter((o) => o.status !== "paid")
        .forEach((o) => {
          orderCount++;
          total += o.total;
        });
    });
    $("#mergePaySummary").textContent = fmtMergePaySummary(mergePaySelected.size, orderCount, total);
    bar.hidden = false;
  }

  // 사장님 피드백(2026-09-07): "지금 엑스로 바로 테이블을 삭제할 수
  // 있는데 편집 기능을 만들어서 그거 눌러야 삭제 되게 해줘" — 위
  // mergePayMode와 같은 켜고/끄는 토글. 편집 모드일 때만 renderTables()가
  // 테이블 카드에 ✕ 버튼을 그린다(위 delBtn 참고). 합산 결제 모드와 동시에
  // 켜지면 카드 클릭 의미가 겹치므로(하나는 삭제, 하나는 합산 선택) 서로
  // 배타적으로 만든다.
  $("#tableEditModeBtn").onclick = () => {
    tableEditMode = !tableEditMode;
    $("#tableEditModeBtn").classList.toggle("active", tableEditMode);
    $("#tableEditModeHint").hidden = !tableEditMode;
    if (tableEditMode && mergePayMode) {
      mergePayMode = false;
      mergePaySelected = new Set();
      $("#mergePayModeBtn").classList.remove("active");
      $("#mergePayHint").hidden = true;
      updateMergePayBar();
    }
    renderTables();
  };
  $("#mergePayModeBtn").onclick = () => {
    mergePayMode = !mergePayMode;
    mergePaySelected = new Set();
    $("#mergePayModeBtn").classList.toggle("active", mergePayMode);
    $("#mergePayHint").hidden = !mergePayMode;
    if (mergePayMode && tableEditMode) {
      tableEditMode = false;
      $("#tableEditModeBtn").classList.remove("active");
      $("#tableEditModeHint").hidden = true;
    }
    renderTables();
    updateMergePayBar();
  };
  $("#mergePayCancelBtn").onclick = () => {
    mergePayMode = false;
    mergePaySelected = new Set();
    $("#mergePayModeBtn").classList.remove("active");
    $("#mergePayHint").hidden = true;
    renderTables();
    updateMergePayBar();
  };
  $("#mergePayConfirmBtn").onclick = async () => {
    const allUnpaid = [...mergePaySelected].flatMap((tableNumber) =>
      activeOrdersForTable(tableNumber).filter((o) => o.status !== "paid")
    );
    if (allUnpaid.length === 0) return;
    if (!(await showConfirm(fmtConfirmMergePay(mergePaySelected.size, allUnpaid.length)))) return;
    // Same principle as the single-table 전체 결제 완료 button above: no
    // separate "now also clear the party size" step here either. Each
    // updateOrderStatus() call PATCHes that order to "paid", and the
    // server's PATCH /api/orders/:id handler clears that order's own
    // table's party_size the instant that table's last active order clears
    // (src/routes/orders.js) — happens independently, per table, exactly as
    // if 전체 결제 완료 had been pressed on each of these tables one by one.
    // The table structure itself is untouched: this only changes which
    // orders got marked "paid" together, not which table any order belongs
    // to (the "결제할 때만 합치기" approach chosen over reassigning orders).
    await Promise.all(allUnpaid.map((o) => updateOrderStatus(o.id, "paid")));
    mergePayMode = false;
    mergePaySelected = new Set();
    $("#mergePayModeBtn").classList.remove("active");
    $("#mergePayHint").hidden = true;
    updateMergePayBar();
    await loadOrders();
    await loadTables();
  };

  // ---------- 자리 이동 ----------
  // 2026-09-10 사장님: "손님이 주문하고 난 후에도 좌석 이동을 가능하게 해줘.
  // 지금은 합산 결제 기능만 있는데 자리 이동 만들어줘."
  //
  // 합산 결제와 다른 일이다. 합산 결제는 결제할 때만 합칠 뿐 주문이 어느
  // 테이블 것인지는 그대로 두는데, 자리를 옮기는 건 지금부터 그 손님이 저
  // 자리에 있다는 뜻이다 — 다음 주문도, 결산의 테이블별 매출도 새 자리로 간다.
  function openMoveTable(fromNumber, fromLabel) {
    const grid = $("#moveTableGrid");
    if (!grid) return;
    grid.innerHTML = "";
    $("#moveTableHint").textContent = fmtMoveTableHint(fromLabel || fromNumber);
    const candidates = [...tables]
      .filter((t) => !t.is_counter && String(t.number) !== String(fromNumber))
      .sort((a, b) => parseInt(a.number, 10) - parseInt(b.number, 10));
    if (!candidates.length) {
      grid.innerHTML = `<div class="table-picker-empty">${T("moveTableNoTargets")}</div>`;
    }
    candidates.forEach((t) => {
      // 이미 손님이 있는 자리도 고를 수 있게 둔다 — 두 테이블을 하나로 합치는
      // 일이 실제로 있다. 다만 고르기 전에 보이게 표시한다.
      const occupied = activeOrdersForTable(t.number).some((o) => o.status !== "paid");
      const btn = document.createElement("button");
      btn.className = "table-picker-btn" + (occupied ? " occupied" : "");
      btn.innerHTML = `<span>${escapeHtml(tableDisplayName(t))}</span>${occupied ? `<span class="picker-sub">${T("moveTableOccupied")}</span>` : ""}`;
      btn.onclick = async () => {
        const msg = occupied
          ? fmtConfirmMoveMerge(fromLabel || fromNumber, t.label || t.number)
          : fmtConfirmMove(fromLabel || fromNumber, t.label || t.number);
        if (!(await showConfirm(msg))) return;
        btn.disabled = true;
        try {
          const res = await fetch("/api/orders/move", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ from: String(fromNumber), to: String(t.number) }),
          });
          if (!res.ok) throw new Error("failed");
          const body = await res.json().catch(() => ({}));
          $("#moveTableBackdrop").hidden = true;
          // 종이가 먼저다. 화면을 다시 그리기 전에 뽑아야, 인쇄가 실패해도
          // 직원이 그 사실을 바로 본다.
          await printMoveSlip(buildMoveSlipInfo(fromNumber, fromLabel, t, body));
          await loadOrders();
          await loadTables();
          // 옮긴 자리를 바로 열어준다 — 옮겼는데 화면이 빈 옛 자리에
          // 머물러 있으면 정말 옮겨졌는지 알 수 없다.
          openTableDetail(String(t.number), t.label || String(t.number));
          if (!$("#tab-payment").hidden) renderPaymentFloorPlan();
          await showAlert(fmtMovedDone(t.label || t.number, body.moved || 0, body.moved_paid || 0));
        } catch (e) {
          btn.disabled = false;
          await showAlert(T("moveTableFailed"));
        }
      };
      grid.appendChild(btn);
    });
    $("#moveTableBackdrop").hidden = false;
  }

  // 빌지에 실을 내용. 서버가 돌려준 옮긴 주문 id 로 화면의 주문을 찾아
  // 품목을 한 줄로 줄인다 — 종이는 좁고, 여기서 필요한 건 "무엇이 딸려
  // 왔는지" 를 알아볼 정도다.
  function buildMoveSlipInfo(fromNumber, fromLabel, toTable, body) {
    const ids = body.moved_ids || [];
    const movedOrders = ids
      .map((id) => orders.find((o) => o.id === id))
      .filter(Boolean)
      .map((o) => ({
        id: o.id,
        time: (o.created_at || "").slice(11, 16),
        summary: (o.items || []).map((it) => `${itemName(it)}×${it.qty}`).join(", "),
      }));
    const toNum = toTable.label || toTable.number;
    return {
      storeName: (storeSettings && (storeSettings.store_name_zh || storeSettings.store_name_ko)) || "한국관",
      from: fromLabel || fromNumber,
      to: toNum,
      at: new Date().toTimeString().slice(0, 5),
      // 자리 이동 빌지에도 어른/아이를 그대로 적는다 — 옮긴 자리에서
      // 아이 의자를 몇 개 옮겨야 하는지가 이 종이에 있어야 한다.
      partySize: body.party_size || null,
      partyAdults: body.party_adults == null ? null : body.party_adults,
      partyChildren: body.party_children || 0,
      orders: movedOrders,
    };
  }

  // 테스트가 종이 내용을 확인할 수 있게 열어둔다. 브라우저 인쇄는 팝업이라
  // 자동으로 열어보기 어렵고, 정작 중요한 건 그 종이에 무엇이 찍히는가다.
  window.__moveSlipHtmlForTest = buildMoveSlipHtml;

  $("#moveTableClose") && ($("#moveTableClose").onclick = () => ($("#moveTableBackdrop").hidden = true));
  $("#moveTableBackdrop") && $("#moveTableBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "moveTableBackdrop") $("#moveTableBackdrop").hidden = true;
  });

  // ---------- 수기 주문 (staff enters an order on a customer's behalf, e.g.
  // no phone or prefers ordering in person) ----------
  // Rather than rebuilding the menu/options/cart UI here, this opens the
  // real customer order page for the chosen table in a new tab — same menu,
  // same option/spice/mix pickers, same takeout toggle, same party-size
  // prompt and location check. Whatever gets submitted there is a normal
  // POST /api/orders call, so it lands in the queue as an ordinary "new"
  // order and prints through the exact same auto-print/manual-print
  // pipeline as any customer-placed order — no special-casing needed.
  $("#manualOrderBtn").onclick = () => {
    const grid = $("#manualOrderGrid");
    grid.innerHTML = "";
    // 포장 카운터 (is_counter) belongs in this picker too — staff can open it
    // on behalf of a phone-less takeout customer the same way as any table —
    // but its number isn't numeric, so it's sorted to the end instead of
    // joining the parseInt comparison below.
    [...tables]
      .sort((a, b) => {
        if (a.is_counter) return 1;
        if (b.is_counter) return -1;
        return parseInt(a.number, 10) - parseInt(b.number, 10);
      })
      .forEach((t) => {
        const btn = document.createElement("button");
        btn.className = "table-picker-btn";
        // 「外帶」 라는 이름의 0번 테이블과 진짜 포장 카운터가 이 창에서
        // 나란히 똑같이 보였다 — 라벨이 번호를 가렸기 때문이다
        // (위 tableDisplayName).
        btn.textContent = tableDisplayName(t);
        btn.onclick = () => {
          // 한국관 POS 키오스크 앱(태블릿 전용 네이티브 WebView 앱) 안에서는
          // window.open()이 전부 막혀 있다 — MainActivity.java의
          // onCreateWindow가 항상 false를 반환하는데, 이건 원래 영수증 인쇄
          // 폴백 경로(window.open을 실패시켜 "인쇄 실패" 처리)만 노리고 넣은
          // 것이었지만 부작용으로 이 수기 주문 버튼도 같이 막아버렸다. 그
          // 앱은 window.HangukgwanPrint를 주입해두므로 이걸로 감지해서, 그
          // 경우에만 새 탭 대신 같은 화면에서 바로 이동한다(WebView는 보통의
          // http/https 이동은 그대로 허용함 — handleUrl() 참고). 그러면
          // 직원이 돌아올 방법이 없어지므로 ?fromAdmin=1을 붙여서
          // order.js가 "관리자로 돌아가기" 버튼을 띄우게 한다. 일반 브라우저
          // (PC/폰 웹)에서는 이 조건이 안 걸리므로 기존처럼 새 탭으로 연다.
          if (window.HangukgwanPrint) {
            location.href = `/t/${encodeURIComponent(t.number)}?fromAdmin=1`;
          } else {
            window.open(`/t/${encodeURIComponent(t.number)}`, "_blank");
          }
          $("#manualOrderBackdrop").hidden = true;
        };
        grid.appendChild(btn);
      });
    $("#manualOrderBackdrop").hidden = false;
  };
  $("#manualOrderClose").onclick = () => ($("#manualOrderBackdrop").hidden = true);
  $("#manualOrderBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "manualOrderBackdrop") $("#manualOrderBackdrop").hidden = true;
  });

  // Explicit save button for the 배치도 floor plan — every drag/resize
  // already auto-saves on its own (see patchFloorPlan() above), but the
  // owner specifically asked for a visible save action with its own
  // confirmation message, the same way every other editable section here
  // works (설정 저장, 계절 설정 저장, etc.), rather than trusting a silent
  // auto-save. Re-sends every table/zone's current position/size — cheap,
  // and doubles as a "sync now" in case anything from a recent drag hasn't
  // landed yet — then re-loads from the server and re-renders so what's on
  // screen is guaranteed to match what's actually saved.
  $("#saveFloorPlanBtn").onclick = async () => {
    const btn = $("#saveFloorPlanBtn");
    const msg = $("#floorPlanSaveMsg");
    btn.disabled = true;
    try {
      const tablePatches = tables
        .filter((t) => t.zone_id != null)
        .map((t) =>
          fetch(`/api/tables/${t.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ x: t.x, y: t.y, width: t.width, height: t.height }),
          })
        );
      const zonePatches = zones.map((z) =>
        fetch(`/api/zones/${z.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ x: z.x, y: z.y, width: z.width, height: z.height }),
        })
      );
      const results = await Promise.all([...tablePatches, ...zonePatches]);
      const allOk = results.every((r) => r.ok);
      msg.textContent = allOk ? T("floorPlanSavedMsg") : T("alertFloorPlanSaveFailed");
      msg.style.color = allOk ? "" : "var(--red)";
      msg.hidden = false;
      if (allOk) {
        // Confirms on-screen state matches what's actually in the DB now,
        // instead of just trusting the local model that sent the PATCHes.
        await Promise.all([loadTables(), loadZones()]);
        renderFloorPlan();
      }
      setTimeout(() => (msg.hidden = true), 4000);
    } finally {
      btn.disabled = false;
    }
  };
  $("#addZoneBtn").onclick = async () => {
    const res = await fetch("/api/zones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: fmtDefaultZoneName(zones.length + 1), x: 20, y: 20, width: 300, height: 240 }),
    });
    const zone = await res.json();
    zones.push(zone);
    renderFloorPlan();
  };

  $("#addTableBtn").onclick = async () => {
    const number = $("#newTableNumber").value.trim();
    const label = $("#newTableLabel").value.trim();
    if (!number) return showAlert(T("alertTableNumberRequired"));
    const res = await fetch("/api/tables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ number, label: label || null }),
    });
    if (res.ok) {
      $("#newTableNumber").value = "";
      $("#newTableLabel").value = "";
      loadTables();
    } else {
      const body = await res.json().catch(() => ({}));
      if (body.error === "unlucky_number") {
        await showAlert(T("alertUnluckyNumber"));
      } else {
        await showAlert(T("alertTableExists"));
      }
    }
  };

  // ---------- Settings ----------
  let currentStoreLat = "";
  let currentStoreLng = "";

  function renderLocationStatus() {
    const text = $("#locationStatusText");
    if (!text) return;
    if (currentStoreLat && currentStoreLng) {
      text.textContent = fmtLocationSetStatus(parseFloat(currentStoreLat).toFixed(5), parseFloat(currentStoreLng).toFixed(5));
    } else {
      text.textContent = T("locationNotSet");
    }
  }

  // 영업 시작 시각 — 이 시각 전 주문은 테스트로 보고 결산·주문 목록에서
  // 뺀다. 사장님(2026-09-10): "9월 8일 저녁부터 실제로 시행... 그 전까지는
  // 전부 테스트였고." 지우는 게 아니라 빼는 것이라, 비우면 다시 다 보인다.
  async function loadServiceStart() {
    try {
      const res = await fetch("/api/settings/service-start");
      if (!res.ok) return;
      const { service_started_at: v } = await res.json();
      // datetime-local 은 "YYYY-MM-DDTHH:MM" 을 원한다.
      $("#s_service_started_at").value = v ? v.slice(0, 16).replace(" ", "T") : "";
    } catch (e) {
      /* 이 칸 하나 때문에 설정 화면 전체가 막히면 안 된다 */
    }
  }
  async function saveServiceStart() {
    if (currentRole !== "owner") return;
    const el = $("#s_service_started_at");
    if (!el) return;
    await fetch("/api/settings/service-start", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service_started_at: el.value || null }),
    });
  }

  // ---------- 주문 받는 시간 ----------
  // 손님이 QR 로 주문할 수 있는 시각. 위 「영업시간」 칸(store_hours)은
  // 손님에게 그대로 보여주는 문구고, 여기가 실제로 막는 규칙이다. 왜 나눴는지는
  // src/openHours.js 첫머리 — 한 줄로 합쳐두면 문구를 고치다 장사를 막는다.
  const OH_DAY_KEYS = ["daySun", "dayMon", "dayTue", "dayWed", "dayThu", "dayFri", "daySat"];
  let orderHoursCfg = { enabled: 0, ranges: [], closed_days: [], day_ranges: {} };

  // 기본 시간과 요일별 시간이 똑같이 생긴 편집기를 쓴다. 두 벌로 나눠 쓰면
  // 한쪽만 고치는 일이 반드시 생긴다.
  function renderRangeEditor(container, ranges, opts) {
    container.innerHTML = "";
    ranges.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "oh-range";
      row.innerHTML = `
        <input type="time" data-oh="start" data-i="${i}" value="${r.start}" />
        <span class="oh-dash">~</span>
        <input type="time" data-oh="end" data-i="${i}" value="${r.end}" />
        <button type="button" data-oh-remove="${i}">${T("orderHoursRemoveRange")}</button>`;
      container.appendChild(row);
    });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "oh-add";
    add.textContent = T("orderHoursAddRange");
    add.onclick = () => {
      if (ranges.length >= 6) return;
      ranges.push({ start: "11:00", end: "21:00" });
      renderRangeEditor(container, ranges, opts);
      if (opts && opts.onChange) opts.onChange();
    };
    container.appendChild(add);

    const changed = () => opts && opts.onChange && opts.onChange();
    container.querySelectorAll("input[data-oh]").forEach((el) => {
      el.onchange = () => {
        const r = ranges[parseInt(el.dataset.i, 10)];
        if (r) r[el.dataset.oh] = el.value;
        // 요일 줄과 달력에 적히는 요약이 편집기와 어긋나면, 사장님은 자기가
        // 적은 것과 다른 게 저장돼 있다고 믿게 된다.
        changed();
      };
    });
    container.querySelectorAll("button[data-oh-remove]").forEach((el) => {
      el.onclick = () => {
        ranges.splice(parseInt(el.dataset.ohRemove, 10), 1);
        renderRangeEditor(container, ranges, opts);
        changed();
      };
    });
  }

  function renderOrderHoursRanges() {
    const wrap = $("#ohRanges");
    if (!wrap) return;
    // 기본 시간을 고치면 「기본과 같음」인 요일과 달력 칸의 요약도 같이 바뀐다.
    renderRangeEditor(wrap, orderHoursCfg.ranges, {
      onChange: () => {
        renderOrderHoursDayRules();
        renderOhCalendar();
      },
    });
  }

  // 요일마다 세 가지 중 하나다: 기본과 같음 / 직접 지정 / 휴무.
  // 「휴무」를 「구간이 하나도 없는 요일」로 표현하지 않는 이유는
  // src/openHours.js 의 normalizeDayRanges 주석에 있다 — 시간을 다 지운
  // 요일이 조용히 휴무가 되면 안 된다.
  //
  // 화면은 가로 한 줄이다(2026-09-10 사장님: "월부터 일까지 가로로 한 줄로").
  // 고른 요일의 편집기만 그 밑에 연다.
  const OH_WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 월요일부터
  let ohSelectedDay = null;
  let ohSelectedDate = null;
  let ohCalMonth = null; // "YYYY-MM"

  function ohDayMode(day) {
    if (orderHoursCfg.closed_days.includes(day)) return "closed";
    if (orderHoursCfg.day_ranges[String(day)]) return "custom";
    return "default";
  }

  function ohDaySummary(day) {
    const mode = ohDayMode(day);
    if (mode === "closed") return T("orderHoursDayClosed");
    if (mode === "custom") return ohRangesText(orderHoursCfg.day_ranges[String(day)]);
    return T("orderHoursDayDefault");
  }

  function ohRangesText(ranges) {
    return (ranges || []).map((r) => `${r.start}~${r.end}`).join(", ");
  }

  function ohSetDayMode(day, mode) {
    const at = orderHoursCfg.closed_days.indexOf(day);
    if (at >= 0) orderHoursCfg.closed_days.splice(at, 1);
    if (mode === "closed") orderHoursCfg.closed_days.push(day);
    if (mode === "custom") {
      if (!orderHoursCfg.day_ranges[String(day)]) {
        // 기본 시간을 복사해서 시작한다 — 빈 칸부터 채우게 하지 않는다.
        orderHoursCfg.day_ranges[String(day)] = orderHoursCfg.ranges.map((r) => ({ start: r.start, end: r.end }));
      }
    } else {
      delete orderHoursCfg.day_ranges[String(day)];
    }
    renderOrderHoursDayRules();
  }

  function renderOrderHoursDayRules() {
    const row = $("#ohWeekRow");
    if (!row) return;
    row.innerHTML = "";
    OH_WEEK_ORDER.forEach((day) => {
      const mode = ohDayMode(day);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `oh-week-day mode-${mode}` + (ohSelectedDay === day ? " selected" : "");
      btn.dataset.ohDay = String(day);
      btn.innerHTML = `<span class="oh-week-name"></span><span class="oh-week-sub"></span>`;
      btn.querySelector(".oh-week-name").textContent = T(OH_DAY_KEYS[day]);
      btn.querySelector(".oh-week-sub").textContent = ohDaySummary(day);
      btn.onclick = () => {
        ohSelectedDay = ohSelectedDay === day ? null : day;
        renderOrderHoursDayRules();
      };
      row.appendChild(btn);
    });
    renderOhDayPanel();
  }

  function renderOhDayPanel() {
    const panel = $("#ohDayPanel");
    if (!panel) return;
    if (ohSelectedDay === null) {
      panel.hidden = true;
      panel.innerHTML = "";
      return;
    }
    const day = ohSelectedDay;
    const mode = ohDayMode(day);
    panel.hidden = false;
    panel.innerHTML = `
      <div class="oh-panel-head"><b></b><select data-oh-mode></select></div>
      <div class="oh-panel-ranges"></div>`;
    panel.querySelector("b").textContent = T(OH_DAY_KEYS[day]);
    const sel = panel.querySelector("select[data-oh-mode]");
    [["default", T("orderHoursDayDefault")], ["custom", T("orderHoursDayCustom")], ["closed", T("orderHoursDayClosed")]]
      .forEach(([v, label]) => {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = label;
        if (v === mode) o.selected = true;
        sel.appendChild(o);
      });
    sel.onchange = () => ohSetDayMode(day, sel.value);
    if (mode === "custom") {
      renderRangeEditor(panel.querySelector(".oh-panel-ranges"), orderHoursCfg.day_ranges[String(day)], {
        onChange: () => renderOrderHoursDayRules(),
      });
    }
  }

  // ---------- 특정 날짜 (달력) ----------
  // 태풍으로 하루 닫는 건 평소 규칙을 잠깐 덮는 일이지 평소 규칙을 고치는
  // 일이 아니다. 그래서 요일과 따로, 달력에서 그 날을 직접 찍는다.
  function ohToday() {
    // 대만 시각 기준 오늘. 관리자 태블릿이 한국 시간으로 맞춰져 있어도
    // 달력이 하루 어긋나면 안 된다.
    const p = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    return p; // en-CA 는 YYYY-MM-DD
  }

  function ohDateRule(date) {
    return orderHoursCfg.date_rules[date] || null;
  }

  function ohDateMode(date) {
    const rule = ohDateRule(date);
    if (!rule) return "default";
    return rule.closed ? "closed" : "custom";
  }

  function ohSetDateMode(date, mode) {
    if (mode === "default") delete orderHoursCfg.date_rules[date];
    else if (mode === "closed") {
      const note = (orderHoursCfg.date_rules[date] || {}).note || "";
      orderHoursCfg.date_rules[date] = note ? { closed: 1, note } : { closed: 1 };
    } else {
      const prev = orderHoursCfg.date_rules[date] || {};
      const ranges = (prev.ranges && prev.ranges.length)
        ? prev.ranges
        : ohRangesForDatePreview(date).map((r) => ({ start: r.start, end: r.end }));
      orderHoursCfg.date_rules[date] = prev.note ? { ranges, note: prev.note } : { ranges };
    }
    renderOhCalendar();
  }

  // 그 날 평소 같으면 어떤 시간인지 — 날짜 규칙을 새로 만들 때의 출발점이자
  // 달력 칸에 회색으로 적어주는 값. 서버의 rangesForDate 와 같은 순서다
  // (날짜 > 요일 휴무 > 요일별 > 기본); 날짜 규칙은 여기서 빼고 본다.
  function ohRangesForDatePreview(date) {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (orderHoursCfg.closed_days.includes(day)) return [];
    const own = orderHoursCfg.day_ranges[String(day)];
    if (own && own.length) return own;
    return orderHoursCfg.ranges;
  }

  function ohMonthShift(ym, n) {
    const [y, m] = ym.split("-").map((v) => parseInt(v, 10));
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  function renderOhCalendar() {
    const grid = $("#ohCalGrid");
    if (!grid) return;
    if (!ohCalMonth) ohCalMonth = ohToday().slice(0, 7);
    const [y, m] = ohCalMonth.split("-").map((v) => parseInt(v, 10));
    $("#ohCalTitle").textContent = fmtOhCalTitle(y, m);

    const head = $("#ohCalWeekdays");
    head.innerHTML = "";
    OH_WEEK_ORDER.forEach((day) => {
      const el = document.createElement("span");
      el.textContent = T(OH_DAY_KEYS[day]);
      head.appendChild(el);
    });

    grid.innerHTML = "";
    const first = new Date(Date.UTC(y, m - 1, 1));
    // 월요일 시작이라 일요일(0)은 맨 뒤로 보낸다.
    const lead = (first.getUTCDay() + 6) % 7;
    for (let i = 0; i < lead; i++) grid.appendChild(document.createElement("span"));
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const today = ohToday();
    for (let d = 1; d <= days; d++) {
      const date = `${ohCalMonth}-${String(d).padStart(2, "0")}`;
      const mode = ohDateMode(date);
      const weekdayClosed = mode === "default" && ohRangesForDatePreview(date).length === 0;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = [
        "oh-cal-day",
        `mode-${mode}`,
        weekdayClosed ? "weekday-closed" : "",
        date === today ? "is-today" : "",
        date === ohSelectedDate ? "selected" : "",
        date < today ? "is-past" : "",
      ].filter(Boolean).join(" ");
      btn.dataset.ohDate = date;
      const mark = mode === "closed" ? "휴" : mode === "custom" ? "시" : weekdayClosed ? "·" : "";
      btn.innerHTML = `<span class="oh-cal-num">${d}</span><span class="oh-cal-mark"></span>`;
      btn.querySelector(".oh-cal-mark").textContent =
        mode === "closed" ? T("orderHoursMarkClosed")
        : mode === "custom" ? T("orderHoursMarkCustom")
        : weekdayClosed ? "·" : "";
      btn.onclick = () => {
        ohSelectedDate = ohSelectedDate === date ? null : date;
        renderOhCalendar();
      };
      grid.appendChild(btn);
    }
    renderOhDatePanel();
  }

  function renderOhDatePanel() {
    const panel = $("#ohDatePanel");
    if (!panel) return;
    if (!ohSelectedDate) {
      panel.hidden = true;
      panel.innerHTML = "";
      return;
    }
    const date = ohSelectedDate;
    const mode = ohDateMode(date);
    const rule = ohDateRule(date) || {};
    panel.hidden = false;
    panel.innerHTML = `
      <div class="oh-panel-head"><b></b><select data-oh-datemode></select></div>
      <label class="oh-note"><span></span><input type="text" maxlength="40" data-oh-note /></label>
      <div class="oh-panel-ranges"></div>`;
    panel.querySelector("b").textContent = date;
    const sel = panel.querySelector("select[data-oh-datemode]");
    [["default", T("orderHoursDateDefault")], ["closed", T("orderHoursDateClosed")], ["custom", T("orderHoursDateCustom")]]
      .forEach(([v, label]) => {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = label;
        if (v === mode) o.selected = true;
        sel.appendChild(o);
      });
    sel.onchange = () => ohSetDateMode(date, sel.value);

    const noteWrap = panel.querySelector(".oh-note");
    noteWrap.querySelector("span").textContent = T("orderHoursNoteLabel");
    const noteInput = noteWrap.querySelector("input");
    noteInput.value = rule.note || "";
    // 예시는 고른 것에 맞춘다. 시간을 줄인 날에 "예: 태풍 휴무" 가 떠 있으면
    // 무엇을 적으라는 건지 헷갈린다.
    noteInput.placeholder = T(mode === "closed" ? "orderHoursNotePlaceholder" : "orderHoursNotePlaceholderHours");
    noteWrap.hidden = mode === "default";
    noteInput.oninput = () => {
      const r = orderHoursCfg.date_rules[date];
      if (!r) return;
      const v = noteInput.value.trim();
      if (v) r.note = v;
      else delete r.note;
    };

    if (mode === "custom") {
      renderRangeEditor(panel.querySelector(".oh-panel-ranges"), orderHoursCfg.date_rules[date].ranges, {
        onChange: () => renderOhCalendar(),
      });
    }
  }

  $("#ohCalPrev") && ($("#ohCalPrev").onclick = () => {
    ohCalMonth = ohMonthShift(ohCalMonth || ohToday().slice(0, 7), -1);
    renderOhCalendar();
  });
  $("#ohCalNext") && ($("#ohCalNext").onclick = () => {
    ohCalMonth = ohMonthShift(ohCalMonth || ohToday().slice(0, 7), 1);
    renderOhCalendar();
  });

  // 지금 실제로 받고 있는지를 맨 위에 적어준다. 규칙만 보여주면 사장님이
  // 머리로 시계를 맞춰봐야 하고, 그러다 "왜 손님이 주문을 못 하지" 가 된다.
  // 마지막으로 받은 상태를 들고 있는다. 언어를 바꿨을 때 이 줄만 예전
  // 언어로 남으면 안 되는데, 이 값은 서버에서 오는 것이라 다시 그리려면
  // 갖고 있어야 한다.
  let lastOrderingState = null;
  function renderOrderHoursState(state) {
    lastOrderingState = state || null;
    const el = $("#orderHoursState");
    if (!el) return;
    // 상태를 모르면 빈 띠를 남겨두지 않는다. 색만 있고 글자가 없는 칸은
    // "괜찮은가 보다" 로 읽히는데, 실제로는 아무것도 못 불러온 상태다.
    if (!state) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const closed = state.enabled && !state.open;
    el.classList.toggle("is-closed", closed);
    if (!state.enabled) {
      el.innerHTML = `${T("orderHoursOff")}<span class="oh-state-sub"> · ${T("orderHoursOffSub")}</span>`;
      el.classList.remove("is-closed");
      return;
    }
    if (state.open) {
      el.innerHTML = `${T("orderHoursOpenNow")}<span class="oh-state-sub"> · ${T("orderHoursTodayLabel")} ${state.ranges_text || ""}</span>`;
      return;
    }
    const bits = [];
    if (state.today_closed) bits.push(T("orderHoursTodayHoliday"));
    if (state.next_open_at) {
      const when = state.next_open_at.slice(11, 16);
      const dayWord =
        state.next_open_days === 0 ? T("orderHoursToday") : state.next_open_days === 1 ? T("orderHoursTomorrow") : "";
      bits.push(`${T("orderHoursNextOpen")} ${dayWord} ${when}`.replace(/\s+/g, " "));
    } else if (state.ranges_text) {
      bits.push(state.ranges_text);
    }
    el.innerHTML = `${T("orderHoursClosedNow")}<span class="oh-state-sub"> · ${bits.join(" · ")}</span>`;
  }

  function applyOrderHoursCfg(cfg) {
    orderHoursCfg = {
      enabled: cfg.enabled ? 1 : 0,
      ranges: (cfg.ranges || []).map((r) => ({ start: r.start, end: r.end })),
      closed_days: (cfg.closed_days || []).slice(),
      day_ranges: Object.fromEntries(
        Object.entries(cfg.day_ranges || {}).map(([d, rs]) => [d, rs.map((r) => ({ start: r.start, end: r.end }))])
      ),
      date_rules: Object.fromEntries(
        Object.entries(cfg.date_rules || {}).map(([d, r]) => [
          d,
          r.closed
            ? (r.note ? { closed: 1, note: r.note } : { closed: 1 })
            : (r.note
                ? { ranges: (r.ranges || []).map((x) => ({ start: x.start, end: x.end })), note: r.note }
                : { ranges: (r.ranges || []).map((x) => ({ start: x.start, end: x.end })) }),
        ])
      ),
    };
    $("#oh_enabled").checked = !!orderHoursCfg.enabled;
    renderOrderHoursRanges();
    renderOrderHoursDayRules();
    renderOhCalendar();
  }

  // 못 불러오면 카드가 통째로 빈 채로 남는다 — 제목과 안내문만 있고 그
  // 밑은 아무것도 없다. 2026-09-10 에 실제로 그렇게 됐다: 서버는 패치
  // 전에 띄운 프로세스라 이 주소가 없었고(404), 화면 파일만 새것이라
  // 사장님에게는 "설정하는 곳이 안 뜬다" 로 보였다. 조용히 넘어가지 않는다.
  function showOrderHoursUnavailable() {
    const el = $("#orderHoursState");
    if (!el) return;
    el.hidden = false;
    el.classList.add("is-closed");
    el.innerHTML = `${T("orderHoursUnavailable")}<span class="oh-state-sub"> · ${T("orderHoursUnavailableSub")}</span>`;
  }

  // 언어를 바꾸면 이 카드도 같이 바뀌어야 한다. 여기 글자는 대부분
  // data-i18n 이 아니라 JS 가 만들어 넣은 것이라(요일 이름, 드롭다운 항목,
  // 「삭제」·「+ 시간대 추가」, 상태 줄) 그냥 두면 이 카드만 예전 언어로 남는다.
  function refreshOrderHoursI18n() {
    renderOrderHoursRanges();
    renderOrderHoursDayRules();
    renderOhCalendar();
    renderOrderHoursState(lastOrderingState);
  }

  async function loadOrderHours() {
    try {
      const res = await fetch("/api/settings/order-hours");
      if (!res.ok) return showOrderHoursUnavailable();
      applyOrderHoursCfg(await res.json());
    } catch (e) {
      // 이 칸 하나 때문에 설정 화면 전체가 막히면 안 된다 — 하지만 아무 말
      // 없이 비어 있는 것도 안 된다.
      showOrderHoursUnavailable();
    }
  }



  // ---------- 테스터 모드 (src/testMode.js) ----------
  //
  // 화면이 할 일은 셋이다.
  //   1. 켜져 있으면 놓칠 수 없게 보여준다 (위쪽 고정 배너)
  //   2. 켜고 끄는 길을 준다
  //   3. 끄기 전에 **무엇이 사라지는지 먼저 보여준다**
  //
  // 3번이 제일 중요하다. 지우는 것은 되돌릴 수 없고, 설정·메뉴는 "테스트가
  // 바꾼 것"과 "그 사이 다른 직원이 진짜로 바꾼 것"을 자동으로 가를 수 없다.
  // 목록을 눈으로 보고 확인을 누르는 것이 그 둘을 가르는 유일한 방법이다.
  let testModeState = { active: false, thisDevice: false };

  async function loadTestMode() {
    try {
      const res = await fetch("/api/test-mode");
      if (!res.ok) return;
      testModeState = await res.json();
    } catch (e) {
      // 못 읽으면 꺼진 것으로 둔다. 배너가 안 뜨는 것이 잘못 뜨는 것보다 낫다.
      testModeState = { active: false, thisDevice: false };
    }
    renderTestMode();
  }

  function renderTestMode() {
    const st = testModeState || {};
    const banner = $("#testModeBanner");
    if (banner) banner.hidden = !st.thisDevice;

    const off = $("#testModeOff");
    const on = $("#testModeOn");
    if (off) off.hidden = !!st.active;
    if (on) on.hidden = !st.active;
    if (!st.active) return;

    const started = $("#testModeStartedAt");
    if (started && st.startedAt) {
      started.textContent = " (시작 " + new Date(st.startedAt).toLocaleString("ko-KR") + ")";
    }
    const mine = $("#testModeThisDevice");
    if (mine) {
      mine.textContent = st.thisDevice
        ? "이 기기는 테스트 중이에요. 여기서 만드는 주문·결산은 종료할 때 사라집니다."
        : "이 기기는 평소 그대로예요. 여기서 넣는 주문은 진짜로 남습니다.";
    }
    const joinBtn = $("#testModeJoinBtn");
    const leaveBtn = $("#testModeLeaveBtn");
    if (joinBtn) joinBtn.hidden = !!st.thisDevice;
    if (leaveBtn) leaveBtn.hidden = !st.thisDevice;
    const url = $("#testModeJoinUrl");
    if (url && st.joinPath) url.value = location.origin + st.joinPath + "&to=/admin";
  }

  function wireTestMode() {
    const start = $("#testModeStartBtn");
    if (start) {
      start.onclick = async () => {
        if (!(await showConfirm("테스터 모드를 켤까요?\n\n이 기기에서 만드는 주문·결산은 종료할 때 전부 사라집니다.\n다른 기기와 손님 QR 주문은 평소 그대로예요."))) return;
        const res = await fetch("/api/test-mode/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        if (!res.ok) return showAlert("테스터 모드를 켜지 못했어요.");
        testModeState = await res.json();
        renderTestMode();
        await loadOrders();
      };
    }
    const join = $("#testModeJoinBtn");
    if (join) {
      join.onclick = async () => {
        const res = await fetch("/api/test-mode/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        if (!res.ok) return showAlert("참여하지 못했어요.");
        testModeState = await res.json();
        renderTestMode();
        await loadOrders();
      };
    }
    const leave = $("#testModeLeaveBtn");
    if (leave) {
      leave.onclick = async () => {
        const res = await fetch("/api/test-mode/leave", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        if (!res.ok) return;
        testModeState = await res.json();
        renderTestMode();
        await loadOrders();
      };
    }
    const phone = $("#testModePhoneBtn");
    if (phone) phone.onclick = () => { const b = $("#testModePhoneBox"); if (b) b.hidden = !b.hidden; };
    const copy = $("#testModeCopyBtn");
    if (copy) {
      copy.onclick = async () => {
        const el = $("#testModeJoinUrl");
        if (!el) return;
        el.select();
        try { await navigator.clipboard.writeText(el.value); copy.textContent = "복사됨"; setTimeout(() => (copy.textContent = "복사"), 1500); }
        catch (e) { document.execCommand("copy"); }
      };
    }
    const end = $("#testModeEndBtn");
    if (end) end.onclick = endTestMode;
    const bannerEnd = $("#testModeBannerEnd");
    if (bannerEnd) bannerEnd.onclick = endTestMode;
  }

  async function endTestMode() {
    // 먼저 무엇이 사라지는지 받아온다. 이걸 건너뛰고 바로 지우면 안 된다.
    let pv = null;
    let alreadyOff = false;
    try {
      const res = await fetch("/api/test-mode/preview-end");
      if (res.ok) pv = await res.json();
      // 다른 기기가 이미 껐다. 이 화면만 켜져 있는 줄 알고 있는 것이다.
      //
      // 2026-09-10 사장님: "내걸 띄우고 태블릿에 들어갔다가 내가 끈 후에
      // 태블릿도 끄려고 하면 테스터 모드 상태를 읽지 못했대."
      //
      // 서버는 "지금 열린 세션이 없다"고 정확히 답하고 있었는데, 화면이
      // 그걸 「읽지 못했다」로 뭉쳐서 보여줬다. 사장님은 통신이 안 되는 줄
      // 알고 새로고침을 반복하게 된다 — 실제로는 아무 문제가 없고 이미
      // 끝나 있는데. 조용히 뭉개지 말고 무슨 일인지 그대로 말한다.
      else if (res.status === 400) {
        const body = await res.json().catch(() => ({}));
        alreadyOff = body.error === "test_mode_not_active";
      }
    } catch (e) {}

    if (alreadyOff) {
      // 이 기기에 남은 표시도 같이 정리한다. 안 그러면 빨간 띠가 계속
      // 붙어 있고, 누를 때마다 같은 안내가 반복된다.
      try {
        const res = await fetch("/api/test-mode/leave", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        if (res.ok) testModeState = await res.json();
      } catch (e) {}
      renderTestMode();
      await loadOrders();
      return showAlert("테스터 모드는 이미 다른 기기에서 종료됐어요.\n이 기기 화면도 방금 정리했습니다.");
    }
    if (!pv) return showAlert("테스터 모드 상태를 읽지 못했어요. 새로고침 후 다시 시도해 주세요.");

    const lines = ["테스터 모드를 종료하면 아래가 영구히 사라집니다.", ""];
    const rows = pv.rows || {};
    const label = { orders: "주문", payments: "결제기록", daily_settlements: "마감 기록", reservations: "예약" };
    for (const [k, v] of Object.entries(rows)) if (v > 0) lines.push(`· ${label[k] || k} ${v}건`);
    if (pv.vipCards > 0) lines.push(`· VIP 카드 ${pv.vipCards}장`);
    if (pv.photos > 0) lines.push(`· 테스트 중 올린 사진 ${pv.photos}장`);
    // 인원과 메뉴는 하나의 세트다 — 주문이 사라지면 그 손님도 자리에서
    // 일어난다(2026-09-11 사장님). 몇 자리가 비워지는지 여기서 같이 보여준다.
    if ((pv.seats || []).length) {
      const seatNames = pv.seats.map((x) => `${x.number}번`).slice(0, 10).join(", ");
      lines.push(`· 테스트로 앉힌 자리 ${pv.seats.length}곳의 인원수 (${seatNames}${pv.seats.length > 10 ? " 외" : ""})`);
    }

    const menu = pv.menu || {};
    const menuChanged = (menu.added || []).length + (menu.removed || []).length + (menu.modified || []).length;
    if (menuChanged) lines.push(`· 메뉴 ${menuChanged}건이 켜기 전으로 되돌아갑니다`);
    if ((pv.settings || []).length) lines.push(`· 설정 ${pv.settings.length}가지가 켜기 전으로 되돌아갑니다`);

    if (menuChanged || (pv.settings || []).length) {
      lines.push("");
      lines.push("⚠ 메뉴·설정은 테스트가 바꾼 것인지 그 사이 다른 직원이 진짜로 바꾼 것인지 가릴 수 없어요. 되돌릴 게 있다면 아래 목록을 확인해 주세요.");
      if ((pv.settings || []).length) lines.push("설정: " + pv.settings.join(", "));
      if (menuChanged) {
        const names = [...(menu.added || []), ...(menu.modified || []), ...(menu.removed || [])].map((m) => m.name);
        lines.push("메뉴: " + names.slice(0, 12).join(", ") + (names.length > 12 ? " 외" : ""));
      }
    }
    lines.push("");
    lines.push("계속할까요?");
    if (!(await showConfirm(lines.join("\n")))) return;

    const res = await fetch("/api/test-mode/end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revertSettings: true, revertMenu: true }),
    });
    if (!res.ok) return showAlert("종료하지 못했어요.");
    const body = await res.json();
    testModeState = { active: false, thisDevice: false };
    renderTestMode();
    await Promise.all([loadOrders(), loadMenu(), loadTables(), loadSettings()]);
    const d = body.deleted || {};
    await showAlert(`테스터 모드를 종료했어요.\n주문 ${d.orders || 0}건, 마감 ${d.daily_settlements || 0}건을 지웠습니다.`);
  }

  async function loadSettings() {
    const res = await fetch("/api/settings");
    const s = await res.json();
    storeSettings = s;
    initRealtimeOrders(s.realtime);
    $("#s_store_name_zh").value = s.store_name_zh || "";
    $("#s_store_name_ko").value = s.store_name_ko || "";
    $("#s_store_name_en").value = s.store_name_en || "";
    $("#s_store_phone").value = s.store_phone || "";
    $("#s_store_address_zh").value = s.store_address_zh || "";
    $("#s_store_address_ko").value = s.store_address_ko || "";
    $("#s_store_address_en").value = s.store_address_en || "";
    $("#s_store_hours").value = s.store_hours || "";
    $("#s_soldout_release_time").value = s.soldout_release_time || "";
    renderSoldOutReleaseNote(s);
    $("#s_store_min_spend").value = s.store_min_spend || "";
    $("#s_store_notice").value = s.store_notice || "";
    $("#s_order_radius_m").value = s.order_radius_m || "200";
    // 저장된 적이 없으면 켜진 것으로 본다 — 지금까지 쓰던 대로다.
    const locOn = s.location_check_enabled !== false && s.location_check_enabled !== "false";
    $("#s_location_check_enabled").checked = locOn;
    $("#locationOffHint").hidden = locOn;
    // 껐다는 것이 저장 전에도 바로 보여야 한다 — 「저장을 눌러야 아는」
    // 스위치는 켜둔 줄 알고 나가게 만든다.
    $("#s_location_check_enabled").onchange = (e) => {
      $("#locationOffHint").hidden = e.target.checked;
    };
    currentStoreLat = s.store_lat || "";
    currentStoreLng = s.store_lng || "";
    renderLocationStatus();
    renderMiniHeroPreview(s);
    $("#s_taegeuk_season_mode").value = s.taegeuk_season_mode || "auto";
    // 영업 시작 시각은 매출 숫자를 바꾸는 설정이라 사장님만 볼 수 있는
    // 별도 라우트에서 온다(직원은 403 — 그때는 조용히 넘어간다).
    if (currentRole === "owner") loadServiceStart();
    loadOrderHours();
    renderOrderHoursState(s.ordering || null);
    if (window.applyTaegeukSeason) window.applyTaegeukSeason(s.taegeuk_season_mode || "auto");
    refreshLogoPreview();
    renderNoticePreview($("#s_store_notice").value);
    $("#vipFirebaseConfigInput").value = s.firebase_web_config || "";
    renderVipConfigStatus(s.firebase_web_config || "");
  }

  // ---------- VIP (회원) Google 로그인 설정 — firebaseConfig is not secret
  // (see the comment on PUBLIC_KEYS in src/routes/settings.js), so it rides
  // the same generic GET/PUT /api/settings as everything else in
  // loadSettings()/saveSettingsBtn rather than needing its own route like
  // payment/escpos below. Just a JSON blob the owner pastes in — this only
  // sanity-checks it parses and has the two fields a Firebase web config
  // always has, so a copy-paste mistake shows up immediately instead of
  // silently breaking Google sign-in on the customer page.
  // Firebase 콘솔은 firebaseConfig 를 **자바스크립트 객체 리터럴**로 보여준다:
  //
  //     const firebaseConfig = {
  //       apiKey: "AIza...",
  //       projectId: "hangookgwan-f8cd5"
  //     };
  //
  // 키에 따옴표가 없어서 JSON 이 아니다. 그런데 이 값을 읽는 쪽
  // (Web/src/lib/firebaseClient.ts, public/js/order.js)은 전부 JSON.parse 를
  // 쓴다. 그래서 콘솔에서 복사한 그대로 붙여넣으면 저장이 거부됐고, 사장님
  // 입장에서는 "화면이 시키는 대로 했는데 안 된다" 가 된다.
  //
  // 붙여넣은 값을 알아서 JSON 으로 바꿔준다. 못 바꾸면 null 을 돌려주고
  // 호출한 쪽이 평소대로 오류를 띄운다 — 조용히 이상한 값을 저장하지 않는다.
  function normalizeFirebaseConfig(raw) {
    const text = String(raw || "");
    if (!text.trim()) return null;

    const accept = (obj) =>
      obj && typeof obj === "object" && obj.apiKey && obj.projectId ? JSON.stringify(obj, null, 2) : null;

    // 이미 올바른 JSON 이면 그대로.
    try {
      const direct = accept(JSON.parse(text));
      if (direct) return direct;
    } catch (e) {
      /* 아래에서 콘솔 형태로 시도한다 */
    }

    // 따옴표 안을 건드리지 않으면서 주석을 지운다. 문자열 안의 "//" 를
    // 주석으로 잘못 보면 값이 깨진다.
    const stripComments = (src) => {
      let out = "";
      let quote = null;
      for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (quote) {
          out += c;
          if (c === "\\") { out += src[++i] || ""; continue; }
          if (c === quote) quote = null;
          continue;
        }
        if (c === '"' || c === "'" || c === "`") { quote = c; out += c; continue; }
        if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; out += "\n"; continue; }
        if (c === "/" && src[i + 1] === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i++; continue; }
        out += c;
      }
      return out;
    };

    // 괄호가 맞는 { … } 덩어리를 전부 찾는다.
    //
    // 첫 "{" 부터 마지막 "}" 까지 자르는 방식으로는 안 된다 — Firebase 콘솔이
    // 보여주는 코드는 `import { initializeApp } from "firebase/app";` 로
    // 시작해서, 첫 "{" 가 import 문의 것이다. 사장님이 화면을 통째로 복사해
    // 붙여넣는 게 가장 자연스러운데 그게 바로 실패했다.
    const blocks = [];
    {
      const src = stripComments(text);
      let depth = 0, from = -1, quote = null;
      for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (quote) {
          if (c === "\\") { i++; continue; }
          if (c === quote) quote = null;
          continue;
        }
        if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
        if (c === "{") { if (depth === 0) from = i; depth++; }
        else if (c === "}") {
          if (depth > 0) depth--;
          if (depth === 0 && from >= 0) { blocks.push(src.slice(from, i + 1)); from = -1; }
        }
      }
    }

    const toJson = (body) =>
      body
        // 따옴표 없는 키에 따옴표를 씌운다  ->  apiKey:  =>  "apiKey":
        .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
        // 작은따옴표 문자열을 큰따옴표로
        .replace(/'([^'\\]*)'/g, '"$1"')
        // 마지막 항목 뒤의 쉼표 제거
        .replace(/,(\s*[}\]])/g, "$1");

    // apiKey 와 projectId 가 둘 다 있는 첫 덩어리가 우리가 찾는 것이다.
    for (const block of blocks) {
      try {
        const ok = accept(JSON.parse(toJson(block)));
        if (ok) return ok;
      } catch (e) {
        /* 다음 덩어리 */
      }
    }
    return null;
  }

  function renderVipConfigStatus(raw) {
    const el = $("#vipConfigStatus");
    if (!el) return;
    if (!raw || !raw.trim()) {
      el.textContent = T("vipConfigNotSet");
      el.style.color = "";
      return;
    }
    if (normalizeFirebaseConfig(raw)) {
      el.textContent = T("vipConfigSet");
      el.style.color = "#1a8a44";
    } else {
      el.textContent = T("vipConfigInvalid");
      el.style.color = "#b5232c";
    }
  }

  $("#saveVipSettingsBtn").onclick = async () => {
    const typed = $("#vipFirebaseConfigInput").value.trim();
    const msg = $("#vipSettingsMsg");
    // 빈 값은 "구글 로그인 끄기" 로 취급한다(이메일 로그인은 계속 동작).
    let raw = "";
    if (typed) {
      raw = normalizeFirebaseConfig(typed);
      if (!raw) {
        msg.style.color = "#b5232c";
        msg.textContent = T("vipConfigInvalidJson");
        msg.hidden = false;
        setTimeout(() => (msg.hidden = true), 4000);
        return;
      }
      // 정리된 값을 입력칸에도 되돌려 보여준다 — 저장된 것과 화면에 보이는
      // 게 다르면 다음에 열었을 때 "내가 넣은 게 아닌데?" 가 된다.
      $("#vipFirebaseConfigInput").value = raw;
    }
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firebase_web_config: raw }),
    });
    renderVipConfigStatus(raw);
    msg.style.color = "#1a8a44";
    msg.textContent = T("vipSettingsSavedMsg");
    msg.hidden = false;
    setTimeout(() => (msg.hidden = true), 2500);
  };

  // ---------- VIP 카드 판매 ----------
  //
  // 2026-09-10 사장님: "vip카드 구매도 현금으로만 구매가능. 버튼필요 —
  // VIP卡販售 / 300원. 직원이 결제할 때 손님이 vip 사고 싶다면 살 수 있게
  // 해줘. 직원이 결제창에서 직접 쉽게 추가할 수 있게 버튼으로."
  //
  // 판매가는 사장님만 고칠 수 있어서 /api/settings 가 아니라 자기 라우트로
  // 온다. 직원 화면에서는 이 카드 자체가 안 보이지만(owner-only), 결제창의
  // 판매 버튼에는 금액이 찍혀야 하므로 값 자체는 직원도 읽을 수 있다.
  let vipSalePrice = null;

  async function loadVipSaleSettings() {
    try {
      const res = await fetch("/api/vip-cards/sale-settings");
      if (!res.ok) return;
      const s = await res.json();
      vipSalePrice = s.price;
      const priceInput = $("#vipSalePriceInput");
      const discountInput = $("#vipSaleDiscountInput");
      if (priceInput) priceInput.value = s.price;
      if (discountInput) discountInput.value = s.discount_percent;
    } catch (e) {
      /* 값을 못 읽어도 결제창은 그대로 열려야 한다 */
    }
  }

  const saveVipSaleBtn = $("#saveVipSaleBtn");
  if (saveVipSaleBtn) {
    saveVipSaleBtn.onclick = async () => {
      const msg = $("#vipSaleMsg");
      const res = await fetch("/api/vip-cards/sale-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          price: $("#vipSalePriceInput").value,
          discount_percent: $("#vipSaleDiscountInput").value,
        }),
      });
      if (!res.ok) return;
      const saved = await res.json();
      vipSalePrice = saved.price;
      // 서버가 자른 값을 그대로 되돌려 보여준다 — 0 을 넣었는데 화면에만
      // 0 이 남아 있으면 다음에 열었을 때 "내가 넣은 게 아닌데" 가 된다.
      $("#vipSalePriceInput").value = saved.price;
      $("#vipSaleDiscountInput").value = saved.discount_percent;
      msg.style.color = "#1a8a44";
      msg.textContent = T("savedMsg");
      msg.hidden = false;
      setTimeout(() => (msg.hidden = true), 2500);
    };
  }

  /**
   * 결제창의 「VIP卡販售」 버튼이 여는 창.
   *
   * 고를 것을 최소로 뒀다 — 금액은 설정에서 이미 정해져 있고, 카드번호는
   * 비워도 된다(사장님이 고른 쪽: "번호는 선택 입력"). 바쁠 때 돈만 받고
   * 번호는 나중에 회원(VIP) 탭에서 넣으면 된다.
   */
  // 결제와 함께 팔리기를 기다리는 VIP 카드.
  //
  // 사장님(2026-09-10): "현재 vip 카드 구매 버튼이 있는데 그게 총 결제
  // 금액이랑 더해지게 해줘. 그리고 vip 카드는 무조건 현금으로 결제할
  // 거라서 나머지 금액은 line, 카드, 현금 으로 선택할 수 있게 해줘."
  //
  // 전에는 버튼을 누르는 순간 카드가 따로 팔렸다. 그러면 직원이 손님에게
  // 금액을 두 번 부른다 — "밥값 1340이요, 그리고 카드 300이요". 손님은
  // 한 번에 내고 싶어 한다.
  //
  // 그래서 「지금 판다」가 아니라 「이번 결제에 얹는다」로 바꾼다. 결제
  // 버튼의 금액이 밥값+카드값이 되고, 결제수단을 고르면 밥값만 그 수단으로
  // 가고 카드값은 언제나 현금으로 따로 찍힌다.
  //
  // 카드 판매는 여전히 자기 주문(kind: "vip_card_sale")으로 남는다 —
  // 결산이 「카드 판매」를 밥값과 갈라 보는 근거가 그것이고, 결제수단
  // 집계도 품목마다 보기 때문에 현금 칸에 300이 정확히 들어간다.
  let pendingVipCardSale = null; // { tableNumber, cardNumber }

  function clearPendingVipCardSale() {
    pendingVipCardSale = null;
  }

  function pendingVipCardAmountFor(tableNumber) {
    if (!pendingVipCardSale) return 0;
    if (String(pendingVipCardSale.tableNumber) !== String(tableNumber)) return 0;
    return vipSalePrice == null ? 0 : vipSalePrice;
  }

  /** 카드 한 장을 실제로 판다. 성공하면 서버가 만든 주문을 돌려준다. */
  async function sellVipCard(tableNumber, cardNumber) {
    try {
      const res = await fetch("/api/vip-cards/sell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableNumber, cardNumber: cardNumber || undefined }),
      });
      const body = await res.json().catch(() => null);
      return { ok: res.ok, body };
    } catch (e) {
      return { ok: false, body: null };
    }
  }

  function openVipSellModal(tableNumber, onDone, onPend) {
    const backdrop = $("#vipSellBackdrop");
    if (!backdrop) return;
    const input = $("#vipSellCardNumber");
    const err = $("#vipSellError");
    const confirmBtn = $("#vipSellConfirm");
    input.value = "";
    err.hidden = true;
    confirmBtn.disabled = false;
    $("#vipSellPrice").textContent = `NT$${vipSalePrice == null ? "" : vipSalePrice}`;
    backdrop.hidden = false;
    input.focus();

    const close = () => {
      backdrop.hidden = true;
      $("#vipSellCancel").onclick = null;
      confirmBtn.onclick = null;
      input.onkeydown = null;
    };
    $("#vipSellCancel").onclick = close;
    input.onkeydown = (e) => {
      if (e.key === "Enter") confirmBtn.click();
    };
    confirmBtn.onclick = async () => {
      const number = input.value.trim();
      // 두 번 눌러서 두 장이 팔리는 일이 없게 잠근다. 돈이 걸린 버튼이다.
      confirmBtn.disabled = true;
      err.hidden = true;

      // 아직 받을 돈이 남아 있으면 지금 팔지 않는다 — 이번 결제에 얹는다.
      // 결제 버튼 금액이 밥값+카드값이 되고, 결제가 끝나는 순간에 팔린다.
      // 결제할 게 없는 자리(밥값을 이미 다 낸 손님이 나가면서 카드만 사는
      // 경우)는 얹을 결제가 없으므로 예전처럼 그 자리에서 판다.
      if (typeof onPend === "function" && onPend(number)) {
        close();
        return;
      }

      const { ok, body } = await sellVipCard(tableNumber, number);
      if (!ok) {
        confirmBtn.disabled = false;
        err.textContent =
          body && body.error === "card_exists" ? T("vipCardNumberTaken") : T("vipSellFailed");
        err.hidden = false;
        return;
      }
      close();
      await loadOrders();
      if (typeof onDone === "function") onDone();
      // 돈을 받는 일이라 확인 한 번을 남긴다 — 얼마를 받았는지가 화면에
      // 또렷하게 남아야 서랍과 맞출 때 헷갈리지 않는다.
      const paid = body && body.price != null ? body.price : vipSalePrice;
      await showAlert(`${number ? T("vipSellDoneWithCard") : T("vipSellDone")}\nNT$${paid}`);
    };
  }

  // ---------- VIP (회원) 카드 관리 (owner only) ----------
  // Cards are keyed by their own `id`, not the customer — a row starts as
  // "issued, unclaimed" the moment the owner types a physical card's number
  // in here, and stays that way until a customer claims it from the order
  // page's 회원 modal (src/routes/members.js POST /register-card). See the
  // long comment on vipCards in src/db.js for the full model.
  let vipCards = [];
  let vipEditingId = null;

  async function loadVipCards() {
    const res = await fetch("/api/vip-cards");
    if (!res.ok) return;
    vipCards = await res.json();
    renderVipCards();
  }

  function renderVipCards() {
    const wrap = $("#vipCardsList");
    if (!wrap) return;
    wrap.innerHTML = "";
    if (!vipCards.length) {
      wrap.innerHTML = `<p style="color:var(--muted);padding:20px 0;text-align:center;">${T("vipNoCards")}</p>`;
      return;
    }
    vipCards.forEach((c) => {
      const row = document.createElement("div");
      row.className = "vip-card-row";
      if (vipEditingId === c.id) {
        row.innerHTML = `
          <div class="vip-card-main vip-card-edit-form">
            <div class="vip-card-number">${c.card_number}</div>
            <label>${T("vipDiscountLabel")}
              <input type="number" min="1" max="100" class="vip-edit-discount" />
            </label>
            <label>${T("vipIssueDateLabel")}
              <input type="date" class="vip-edit-issuedate" />
            </label>
            <label>${T("vipNoteLabelShort")}
              <input type="text" class="vip-edit-note" />
            </label>
          </div>
          <div class="vip-card-actions">
            <button class="primary-btn vip-save-btn" data-id="${c.id}">${T("saveBtn")}</button>
            <button class="vip-cancel-btn" data-id="${c.id}">${T("cancelBtn")}</button>
          </div>
        `;
        wrap.appendChild(row);
        // Set values via properties rather than baking them into the HTML
        // string above — discount_percent is numeric (safe either way) but
        // note is free-typed admin text that could contain quotes, and this
        // sidesteps needing an attribute-escaping helper for one spot.
        row.querySelector(".vip-edit-discount").value = c.discount_percent;
        row.querySelector(".vip-edit-issuedate").value = c.issue_date || "";
        row.querySelector(".vip-edit-note").value = c.note || "";
        return;
      }
      const statusText = c.google_uid ? (c.expired ? T("vipStatusExpired") : T("vipStatusActive")) : T("vipStatusUnclaimed");
      const statusClass = c.google_uid ? (c.expired ? "vip-expired" : "vip-active") : "vip-unclaimed";
      const customerLine = c.google_uid
        ? `<div class="vip-card-customer">${c.customer_name || ""} · ${c.customer_email || ""}</div>`
        : "";
      row.innerHTML = `
        <div class="vip-card-main">
          <div class="vip-card-number">${c.card_number}</div>
          <div class="vip-card-meta">
            <span class="vip-badge ${statusClass}">${statusText}</span>
            <span>${T("vipDiscountLabel")} <strong>${c.discount_percent}%</strong></span>
            <span>${T("vipIssueDateLabel")} ${c.issue_date}</span>
            <span>${T("vipExpiryDateLabel")} ${c.expiry_date || "-"}</span>
          </div>
          ${customerLine}
          ${c.note ? `<div class="vip-card-note">${c.note}</div>` : ""}
        </div>
        <div class="vip-card-actions">
          <button class="vip-edit-btn" data-id="${c.id}">${T("vipEditBtn")}</button>
          ${c.google_uid ? `<button class="vip-unlink-btn" data-id="${c.id}">${T("vipUnlinkBtn")}</button>` : ""}
          ${!c.google_uid ? `<button class="del-btn vip-del-btn" data-id="${c.id}" title="${T("vipDeleteBtn")}">✕</button>` : ""}
        </div>
      `;
      wrap.appendChild(row);
    });

    wrap.querySelectorAll(".vip-edit-btn").forEach((btn) => {
      btn.onclick = () => {
        // c.id (from JSON) is a number; dataset.id is always a string —
        // parseInt so the `vipEditingId === c.id` check below actually
        // matches instead of every row silently failing to enter edit mode.
        vipEditingId = parseInt(btn.dataset.id, 10);
        renderVipCards();
      };
    });
    wrap.querySelectorAll(".vip-cancel-btn").forEach((btn) => {
      btn.onclick = () => {
        vipEditingId = null;
        renderVipCards();
      };
    });
    wrap.querySelectorAll(".vip-save-btn").forEach((btn) => {
      btn.onclick = async () => {
        const row = btn.closest(".vip-card-row");
        const discount = parseInt(row.querySelector(".vip-edit-discount").value, 10);
        const issueDate = row.querySelector(".vip-edit-issuedate").value;
        const note = row.querySelector(".vip-edit-note").value.trim();
        if (!discount || discount < 1 || discount > 100 || !issueDate) {
          await showAlert(T("vipEditInvalid"));
          return;
        }
        await fetch(`/api/vip-cards/${btn.dataset.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ discountPercent: discount, issueDate, note }),
        });
        vipEditingId = null;
        loadVipCards();
      };
    });
    wrap.querySelectorAll(".vip-unlink-btn").forEach((btn) => {
      btn.onclick = async () => {
        if (!(await showConfirm(T("vipUnlinkConfirm")))) return;
        await fetch(`/api/vip-cards/${btn.dataset.id}/unlink`, { method: "POST" });
        loadVipCards();
      };
    });
    wrap.querySelectorAll(".vip-del-btn").forEach((btn) => {
      btn.onclick = async () => {
        if (!(await showConfirm(T("vipDeleteConfirm")))) return;
        const res = await fetch(`/api/vip-cards/${btn.dataset.id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.error === "cannot_delete_claimed_card") await showAlert(T("vipCannotDeleteClaimed"));
          return;
        }
        loadVipCards();
      };
    });
  }

  $("#vipAddCardBtn").onclick = async () => {
    const cardNumber = $("#vipNewCardNumber").value.trim();
    const issueDate = $("#vipNewIssueDate").value;
    const discountPercent = parseInt($("#vipNewDiscount").value, 10);
    const note = $("#vipNewNote").value.trim();
    if (!cardNumber || !issueDate || !discountPercent || discountPercent < 1 || discountPercent > 100) {
      await showAlert(T("vipAddInvalid"));
      return;
    }
    const res = await fetch("/api/vip-cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardNumber, issueDate, discountPercent, note }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      await showAlert(data.error === "card_exists" ? T("vipCardNumberTaken") : T("vipAddInvalid"));
      return;
    }
    $("#vipNewCardNumber").value = "";
    $("#vipNewIssueDate").value = "";
    $("#vipNewDiscount").value = "";
    $("#vipNewNote").value = "";
    loadVipCards();
  };

  // Live "실제 코드 UI" previews — show the cover photo and logo exactly as
  // they'll actually render for a customer, instead of a raw image thumbnail.
  function renderMiniHeroPreview(s) {
    const hero = $("#miniHero");
    if (hero) {
      hero.style.backgroundImage = s.store_cover_photo ? `url('${s.store_cover_photo}')` : "none";
    }
    const nameEl = $("#miniStoreName");
    if (nameEl) {
      nameEl.textContent = (adminLang === "zh" ? s.store_name_zh : s.store_name_ko) || s.store_name_zh || s.store_name_ko || "한국관";
    }
  }

  // Updates live as the owner types (see #s_store_notice's oninput below),
  // not just after saving — matches production's "비워두면 표시되지 않음"
  // behavior (empty banner just doesn't render).
  function renderNoticePreview(text) {
    const banner = $("#noticePreview");
    const empty = $("#noticePreviewEmpty");
    if (!banner) return;
    banner.textContent = text || "";
    if (empty) empty.hidden = !!text;
  }
  $("#s_store_notice").addEventListener("input", (e) => renderNoticePreview(e.target.value));

  // Re-fetches the sample QR-with-logo SVG from the server (same generator
  // as the real printed QR sheet) so the owner sees exactly how the logo
  // will look stamped into a real QR code — not just the raw uploaded image.
  function refreshLogoPreview() {
    const img = $("#logoQrPreview");
    if (!img) return;
    img.src = `/api/settings/logo-preview?t=${Date.now()}`;
  }

  // 「매장 정보」 카드의 저장. **이 카드 안의 칸만 보낸다.**
  //
  // 사장님(2026-09-11): "전체적으로 설정에서 변경하고 저장하는 부분들이 각
  // 부분에 있어야 할 것 같아."
  //
  // 예전에는 여기서 허용 반경·위치 확인 스위치·계절 설정까지 같이 보냈다.
  // 그 칸들은 다른 카드(어떤 건 다른 분류)에 있어서, 두 가지가 어긋났다.
  //   1. 그 카드에서 고쳐놓고 저장할 버튼이 거기 없었다.
  //   2. 여기서 저장하면 안 건드린 남의 칸까지 화면 값으로 덮어썼다.
  // 이제 카드마다 자기 칸만 저장한다.
  $("#saveSettingsBtn").onclick = async () => {
    const payload = {
      store_name_zh: $("#s_store_name_zh").value.trim(),
      store_name_ko: $("#s_store_name_ko").value.trim(),
      store_name_en: $("#s_store_name_en").value.trim(),
      store_phone: $("#s_store_phone").value.trim(),
      store_address_zh: $("#s_store_address_zh").value.trim(),
      store_address_ko: $("#s_store_address_ko").value.trim(),
      store_address_en: $("#s_store_address_en").value.trim(),
      store_hours: $("#s_store_hours").value.trim(),
      store_min_spend: $("#s_store_min_spend").value.trim(),
    };
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    // 영업 시작 시각은 사장님 전용 라우트라 따로 보낸다 — 매출 숫자가
    // 달라지는 설정이라 직원이 바꾸면 안 된다. (이 칸도 이 카드 안에 있다)
    await saveServiceStart();
    const msg = $("#settingsMsg");
    msg.hidden = false;
    setTimeout(() => (msg.hidden = true), 2000);
  };

  // 「위치 기반 주문 제한」 카드의 저장. 이 카드 안의 두 칸만 보낸다.
  $("#saveLocationSettingsBtn").onclick = async () => {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_radius_m: $("#s_order_radius_m").value.trim(),
        location_check_enabled: $("#s_location_check_enabled").checked,
      }),
    });
    const msg = $("#locationSettingsMsg");
    if (msg) {
      msg.hidden = false;
      setTimeout(() => (msg.hidden = true), 2000);
    }
  };

  $("#saveOrderHoursBtn").onclick = async () => {
    const res = await fetch("/api/settings/order-hours", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: $("#oh_enabled").checked ? 1 : 0,
        ranges: orderHoursCfg.ranges,
        closed_days: orderHoursCfg.closed_days,
        day_ranges: orderHoursCfg.day_ranges,
        date_rules: orderHoursCfg.date_rules,
      }),
    });
    if (res.ok) {
      const saved = await res.json();
      // 서버가 다듬은 결과를 그대로 다시 그린다 — 화면과 실제로 저장된 것이
      // 다르면, 사장님은 자기가 적은 대로 막히고 있다고 믿게 된다.
      applyOrderHoursCfg(saved);
      renderOrderHoursState(saved.ordering);
    }
    const msg = $("#orderHoursMsg");
    msg.hidden = false;
    setTimeout(() => (msg.hidden = true), 2000);
  };

  $("#captureLocationBtn").onclick = () => {
    const msg = $("#locationMsg");
    if (!navigator.geolocation) {
      msg.style.color = "#b3261e";
      msg.textContent = T("locationNoBrowserSupport");
      msg.hidden = false;
      return;
    }
    msg.style.color = "#6b6357";
    msg.textContent = T("locationChecking");
    msg.hidden = false;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            store_lat: String(lat),
            store_lng: String(lng),
            order_radius_m: $("#s_order_radius_m").value.trim() || "200",
            location_check_enabled: $("#s_location_check_enabled").checked,
          }),
        });
        currentStoreLat = String(lat);
        currentStoreLng = String(lng);
        renderLocationStatus();
        msg.style.color = "#1a8a44";
        msg.textContent = T("locationSaved");
        setTimeout(() => (msg.hidden = true), 3000);
      },
      (err) => {
        msg.style.color = "#b3261e";
        msg.textContent = T("locationFailed");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  $("#saveTaegeukSeasonBtn").onclick = async () => {
    const mode = $("#s_taegeuk_season_mode").value;
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taegeuk_season_mode: mode }),
    });
    if (window.applyTaegeukSeason) window.applyTaegeukSeason(mode);
    const msg = $("#taegeukSeasonMsg");
    msg.style.color = "#1a8a44";
    msg.textContent = T("savedMsg");
    msg.hidden = false;
    setTimeout(() => (msg.hidden = true), 2000);
  };

  $("#saveNoticeBtn").onclick = async () => {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store_notice: $("#s_store_notice").value.trim() }),
    });
    const msg = $("#noticeMsg");
    msg.style.color = "#1a8a44";
    msg.textContent = T("savedMsg");
    msg.hidden = false;
    setTimeout(() => (msg.hidden = true), 2000);
  };

  // 고른 파일은 들고만 있다가 **저장을 눌러야** 올라간다 (2026-09-11 사장님).
  // 예전에는 고르는 순간 바로 올라가서, 잘못 고른 사진이 곧장 손님 화면의
  // QR 코드 한가운데로 갔다. 되돌리려면 옛 파일을 다시 찾아야 했다.
  let logoDraftFile = null;
  $("#logoPhotoInput").onchange = (e) => {
    logoDraftFile = e.target.files[0] || null;
    const msg = $("#logoMsg");
    if (logoDraftFile) {
      msg.style.color = "";
      msg.textContent = T("logoPicked").replace("{name}", logoDraftFile.name);
      msg.hidden = false;
    } else {
      msg.hidden = true;
    }
    markSettingDirty("saveLogoBtn", !!logoDraftFile);
  };
  $("#saveLogoBtn").onclick = async () => {
    const msg = $("#logoMsg");
    if (!logoDraftFile) {
      // 고른 파일이 없으면 올릴 것도 없다. 아무 말 없이 성공한 척하면
      // 사장님은 바뀐 줄 안다.
      msg.style.color = "#b5232c";
      msg.textContent = T("logoNonePicked");
      msg.hidden = false;
      setTimeout(() => (msg.hidden = true), 2000);
      return;
    }
    const fd = new FormData();
    fd.append("photo", logoDraftFile);
    const res = await fetch("/api/settings/logo", { method: "POST", body: fd });
    if (res.ok) {
      refreshLogoPreview();
      logoDraftFile = null;
      $("#logoPhotoInput").value = "";
      msg.style.color = "#1a8a44";
      msg.textContent = T("logoUpdated");
      markSettingDirty("saveLogoBtn", false);
    } else {
      msg.style.color = "#b5232c";
      msg.textContent = T("uploadFailed");
    }
    msg.hidden = false;
    setTimeout(() => (msg.hidden = true), 2000);
  };

  $("#coverPhotoInput").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("photo", file);
    const msg = $("#coverMsg");
    const res = await fetch("/api/settings/cover-photo", { method: "POST", body: fd });
    if (res.ok) {
      const data = await res.json();
      $("#miniHero").style.backgroundImage = `url('${data.store_cover_photo}')`;
      msg.style.color = "#1a8a44";
      msg.textContent = T("coverUpdated");
    } else {
      msg.style.color = "#b5232c";
      msg.textContent = T("uploadFailed");
    }
    msg.hidden = false;
    setTimeout(() => (msg.hidden = true), 2000);
  };

  // Same endpoint for both cards below — the server changes whichever
  // account (owner or staff) the current session actually belongs to, so
  // the "사장 비밀번호 변경" card just needs to be owner-only in the UI.
  async function changeOwnPassword(curId, newId, msgId) {
    const currentPassword = $(`#${curId}`).value;
    const newPassword = $(`#${newId}`).value;
    const msg = $(`#${msgId}`);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (res.ok) {
      msg.style.color = "#1a8a44";
      msg.textContent = T("pwChanged");
      $(`#${curId}`).value = "";
      $(`#${newId}`).value = "";
    } else {
      msg.style.color = "#b5232c";
      msg.textContent = T("pwChangeFailed");
    }
    msg.hidden = false;
  }

  $("#changePwBtn").onclick = () => changeOwnPassword("pw_current", "pw_new", "pwMsg");
  $("#changeOwnerPwBtn").onclick = () => changeOwnPassword("owner_pw_current", "owner_pw_new", "ownerPwMsg");

  // ---------- 계정 관리 (owner only) ----------
  // 홈페이지에서 가입한 계정(src/accounts.js의 users 컬렉션)의 등급을
  // 바꾸는 화면. 손님 → 직원/사장으로 올리면 그 사람이 홈페이지에
  // 로그인했을 때 "관리자 페이지" 버튼이 생기고 이 대시보드에 들어올 수
  // 있게 된다(사장님 요청 2026-09-08: "어드민 계정만 ... 어드민 페이지로
  // 들어갈 수 있는 버튼").
  //
  // 여기서 쓰는 /api/users 는 requireOwner다 — 직원은 목록조차 못 본다.
  // 자기 자신을 강등하는 것과 마지막 사장을 강등하는 것은 서버가 막는다
  // (src/routes/users.js) — 그렇게 되면 등급을 되돌려줄 사람이 아무도
  // 없어지기 때문이다.
  let accountsCache = [];

  async function loadAccounts() {
    const wrap = $("#accountsList");
    if (!wrap) return;
    wrap.innerHTML = `<p style="color:var(--muted);padding:20px 0;text-align:center;">${T("accountsLoading")}</p>`;
    try {
      const res = await fetch("/api/users");
      if (!res.ok) {
        wrap.innerHTML = `<p style="color:var(--muted);padding:20px 0;text-align:center;">${T("accountsLoadError")}</p>`;
        return;
      }
      const data = await res.json();
      accountsCache = data.users || [];
      renderAccounts();
    } catch (e) {
      wrap.innerHTML = `<p style="color:var(--muted);padding:20px 0;text-align:center;">${T("accountsLoadError")}</p>`;
    }
  }

  function accountRoleLabel(role) {
    if (role === "owner") return T("accountRoleOwner");
    if (role === "staff") return T("accountRoleStaff");
    return T("accountRoleCustomer");
  }

  function renderAccounts() {
    const wrap = $("#accountsList");
    if (!wrap) return;
    const q = ($("#accountSearch") && $("#accountSearch").value.trim().toLowerCase()) || "";
    const rows = accountsCache.filter(
      (u) => !q || (u.name || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q)
    );

    if (!rows.length) {
      wrap.innerHTML = `<p style="color:var(--muted);padding:20px 0;text-align:center;">${
        accountsCache.length ? T("accountsNoMatch") : T("accountsEmpty")
      }</p>`;
      return;
    }

    wrap.innerHTML = rows
      .map((u) => {
        const methods = [u.hasPassword ? T("accountMethodPassword") : null, u.hasGoogle ? T("accountMethodGoogle") : null]
          .filter(Boolean)
          .join(" · ");
        const roleClass = u.role === "owner" ? "owner" : u.role === "staff" ? "staff" : "customer";
        return `<div class="account-row" data-id="${u.id}">
          <div class="account-main">
            <div class="account-name">${escapeHtml(u.name || "-")} <span class="account-role-badge ${roleClass}">${accountRoleLabel(u.role)}</span></div>
            <div class="account-sub">${escapeHtml(u.email || "-")}${u.phone ? ` · ${escapeHtml(u.phone)}` : ""}${methods ? ` · ${methods}` : ""}</div>
          </div>
          <div class="account-actions">
            <select class="account-role-select">
              <option value="customer"${u.role === "customer" ? " selected" : ""}>${T("accountRoleCustomer")}</option>
              <option value="staff"${u.role === "staff" ? " selected" : ""}>${T("accountRoleStaff")}</option>
              <option value="owner"${u.role === "owner" ? " selected" : ""}>${T("accountRoleOwner")}</option>
            </select>
          </div>
        </div>`;
      })
      .join("");

    $$("#accountsList .account-role-select").forEach((sel) => {
      sel.onchange = async () => {
        const row = sel.closest(".account-row");
        const id = row.dataset.id;
        const user = accountsCache.find((u) => u.id === id);
        const newRole = sel.value;
        if (!user || newRole === user.role) return;

        // 관리자 권한을 주고 뺏는 일이라 되돌리기 어렵다 — 한 번 묻는다.
        const ok = await showConfirm(
          T("accountRoleConfirm")
            .replace("{name}", user.name || user.email || "")
            .replace("{role}", accountRoleLabel(newRole))
        );
        if (!ok) {
          sel.value = user.role;
          return;
        }

        sel.disabled = true;
        try {
          const res = await fetch(`/api/users/${id}/role`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: newRole }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            // 서버가 막는 두 경우(자기 강등 / 마지막 사장)는 각각 왜 안
            // 되는지 알려줘야 사장님이 "왜 안 바뀌지?" 하지 않는다.
            const key =
              data.error === "cannot_demote_self"
                ? "accountErrSelfDemote"
                : data.error === "last_owner"
                  ? "accountErrLastOwner"
                  : "accountErrGeneric";
            await showAlert(T(key));
            sel.value = user.role;
            return;
          }
          user.role = data.user.role;
          renderAccounts();
        } catch (e) {
          await showAlert(T("accountErrGeneric"));
          sel.value = user.role;
        } finally {
          sel.disabled = false;
        }
      };
    });
  }

  if ($("#accountSearch")) $("#accountSearch").oninput = renderAccounts;
  if ($("#accountsRefreshBtn")) $("#accountsRefreshBtn").onclick = loadAccounts;

  // ---------- Staff permission management (owner only) ----------
  const PERMISSION_KEYS = ["menuEdit", "tableEdit", "settingsEdit", "orderCancel", "orderEdit", "reservationManage"];

  async function loadStaffPermissions() {
    const res = await fetch("/api/settings/staff-permissions");
    if (!res.ok) return;
    const perms = await res.json();
    PERMISSION_KEYS.forEach((k) => {
      const box = $(`#perm_${k}`);
      if (box) box.checked = !!perms[k];
    });
  }

  // LINE closing-summary settings (owner-only). The token itself is never
  // sent back from the server once saved — only whether one is set — so
  // the input is left blank on load and only overwrites the saved token if
  // the owner actually types a new one in.
  // Renders one row in either the pending or approved list — avatar photo
  // (or a initial-letter fallback circle if LINE didn't give us one) plus
  // name plus an action button (approve/reject, or remove).
  function renderLinePersonRow(person, actionLabel, actionClass, onAction) {
    const row = document.createElement("div");
    row.className = "line-person-row";
    const avatar = person.pictureUrl
      ? `<img class="line-person-avatar" src="${person.pictureUrl}" alt="" />`
      : `<div class="line-person-avatar-fallback">${(person.displayName || "?").charAt(0)}</div>`;
    row.innerHTML = `${avatar}<span class="line-person-name">${person.displayName}</span>`;
    const btn = document.createElement("button");
    btn.className = actionClass;
    btn.textContent = actionLabel;
    btn.onclick = onAction;
    row.appendChild(btn);
    return row;
  }

  function renderLineStatus(data) {
    $("#lineEnabledToggle").checked = !!data.enabled;
    $("#lineTokenStatus").textContent = data.hasToken ? T("lineTokenSetStatus") : T("lineTokenNotSetStatus");
    $("#lineSecretStatus").textContent = data.hasSecret ? T("lineSecretSetStatus") : T("lineSecretNotSetStatus");

    const pendingEl = $("#linePendingList");
    pendingEl.innerHTML = "";
    if ((data.pending || []).length === 0) {
      pendingEl.innerHTML = `<div class="line-people-empty">${T("linePendingEmpty")}</div>`;
    } else {
      data.pending.forEach((p) => {
        pendingEl.appendChild(
          renderLinePersonRow(p, T("lineApproveBtn"), "line-approve-btn", () => approveLineFollower(p.userId))
        );
        const rejectBtn = document.createElement("button");
        rejectBtn.className = "line-reject-btn";
        rejectBtn.textContent = T("lineRejectBtn");
        rejectBtn.onclick = () => rejectLineFollower(p.userId);
        pendingEl.lastChild.appendChild(rejectBtn);
      });
    }

    const approvedEl = $("#lineApprovedList");
    approvedEl.innerHTML = "";
    if ((data.targets || []).length === 0) {
      approvedEl.innerHTML = `<div class="line-people-empty">${T("lineApprovedEmpty")}</div>`;
    } else {
      data.targets.forEach((t) => {
        approvedEl.appendChild(
          renderLinePersonRow(t, T("lineRemoveBtn"), "line-remove-btn", () => removeLineTarget(t.userId))
        );
      });
    }
  }

  async function loadLineSettings() {
    const res = await fetch("/api/settings/line");
    if (!res.ok) return;
    renderLineStatus(await res.json());
  }

  async function approveLineFollower(userId) {
    const res = await fetch("/api/settings/line/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) renderLineStatus(await res.json());
  }

  async function rejectLineFollower(userId) {
    const res = await fetch("/api/settings/line/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) renderLineStatus(await res.json());
  }

  async function removeLineTarget(userId) {
    if (!(await showConfirm(T("lineRemoveConfirm")))) return;
    const res = await fetch(`/api/settings/line/targets/${encodeURIComponent(userId)}`, { method: "DELETE" });
    if (res.ok) renderLineStatus(await res.json());
  }

  $("#saveLineSettingsBtn").onclick = async () => {
    const payload = { enabled: $("#lineEnabledToggle").checked };
    const token = $("#lineTokenInput").value.trim();
    const secret = $("#lineSecretInput").value.trim();
    if (token) payload.token = token;
    if (secret) payload.secret = secret;
    const res = await fetch("/api/settings/line", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const msg = $("#lineMsg");
    if (res.ok) {
      $("#lineTokenInput").value = "";
      $("#lineTokenInput").type = "password";
      $("#lineTokenRevealBtn").textContent = T("lineRevealBtn");
      $("#lineSecretInput").value = "";
      $("#lineSecretInput").type = "password";
      $("#lineSecretRevealBtn").textContent = T("lineRevealBtn");
      renderLineStatus(await res.json());
      msg.style.color = "#1a8a44";
      msg.textContent = T("lineSavedMsg");
    } else {
      msg.style.color = "#b5232c";
      msg.textContent = T("staffPasswordFailed");
    }
    msg.hidden = false;
    setTimeout(() => (msg.hidden = true), 2500);
  };

  // ---------- Online payment (ECPay) toggle (owner only) ----------
  async function loadPaymentSettings() {
    const res = await fetch("/api/settings/payment");
    if (!res.ok) return;
    const data = await res.json();
    $("#paymentEnabledToggle").checked = !!data.enabled;
    $("#paymentModeStatus").textContent = data.isTestMode ? T("paymentTestModeStatus") : T("paymentLiveModeStatus");
  }

  $("#savePaymentSettingsBtn").onclick = async () => {
    const res = await fetch("/api/settings/payment", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: $("#paymentEnabledToggle").checked }),
    });
    const msg = $("#paymentMsg");
    if (res.ok) {
      const data = await res.json();
      $("#paymentEnabledToggle").checked = !!data.enabled;
      $("#paymentModeStatus").textContent = data.isTestMode ? T("paymentTestModeStatus") : T("paymentLiveModeStatus");
      msg.style.color = "#1a8a44";
      msg.textContent = T("paymentSavedMsg");
    } else {
      msg.style.color = "#b5232c";
      msg.textContent = T("staffPasswordFailed");
    }
    msg.hidden = false;
    setTimeout(() => (msg.hidden = true), 2500);
  };

  // ---------- Direct ESC/POS kitchen printer via QZ Tray (owner only UI,
  // but see the GET route comment in settings.js — staff sessions can read
  // the saved config too, since printKitchenTicket() below needs it for
  // staff logins as well) ----------
  async function loadEscposSettings() {
    const res = await fetch("/api/settings/escpos");
    if (!res.ok) return;
    const data = await res.json();
    $("#escposEnabledToggle").checked = !!data.enabled;
    $("#escposPrinterNameInput").value = data.printerName || "";
    $("#rawbtEnabledToggle").checked = !!data.rawbtEnabled;
  }

  $("#saveEscposSettingsBtn").onclick = async () => {
    const res = await fetch("/api/settings/escpos", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: $("#escposEnabledToggle").checked,
        printerName: $("#escposPrinterNameInput").value.trim(),
      }),
    });
    const msg = $("#escposMsg");
    if (res.ok) {
      const data = await res.json();
      $("#escposEnabledToggle").checked = !!data.enabled;
      $("#escposPrinterNameInput").value = data.printerName || "";
      msg.style.color = "#1a8a44";
      msg.textContent = T("escposSavedMsg");
    } else {
      msg.style.color = "#b5232c";
      msg.textContent = T("staffPasswordFailed");
    }
    msg.hidden = false;
    setTimeout(() => (msg.hidden = true), 2500);
  };

  // Separate save button/card from ESC/POS above (see rawbtSettingsTitle in
  // the i18n blocks + settings-cat-print in admin.html) — this only ever
  // sends { rawbtEnabled }, and the PUT route merges partial updates, so it
  // can't clobber the QZ Tray printerName/enabled fields saved by the
  // button above, or vice versa.
  $("#saveRawbtSettingsBtn").onclick = async () => {
    const res = await fetch("/api/settings/escpos", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawbtEnabled: $("#rawbtEnabledToggle").checked }),
    });
    const msg = $("#rawbtMsg");
    if (res.ok) {
      const data = await res.json();
      $("#rawbtEnabledToggle").checked = !!data.rawbtEnabled;
      msg.style.color = "#1a8a44";
      msg.textContent = T("rawbtSavedMsg");
    } else {
      msg.style.color = "#b5232c";
      msg.textContent = T("staffPasswordFailed");
    }
    msg.hidden = false;
    setTimeout(() => (msg.hidden = true), 2500);
  };

  // QZ Tray connects over a local WebSocket to the QZ Tray program running
  // on THIS computer (not the server — the server is on Vercel and can't
  // reach a restaurant's LAN printer directly, which is the whole reason
  // this bridge exists). No certificate/signature is configured here since
  // this restaurant's single-computer setup doesn't need signed requests —
  // QZ Tray will instead show a one-time "Allow/Block" popup on its own the
  // first time it connects; checking "remember this decision" there avoids
  // it showing again on future connects.
  let qzSecuritySetup = false;
  function setupQzSecurity() {
    if (qzSecuritySetup || typeof qz === "undefined") return;
    qz.security.setCertificatePromise((resolve) => resolve(""));
    qz.security.setSignaturePromise(() => (resolve) => resolve(""));
    qzSecuritySetup = true;
  }

  async function ensureQzConnected() {
    if (typeof qz === "undefined") throw new Error("qz_tray_js_not_loaded");
    setupQzSecurity();
    if (!qz.websocket.isActive()) await qz.websocket.connect();
  }

  // Tries to print `o` straight to the physical printer via QZ Tray,
  // completely bypassing the browser's print dialog (no click needed, paper
  // auto-cuts — see public/js/escpos.js). Returns true only if the print
  // command was actually sent; false for any reason at all (feature turned
  // off, no printer name saved, QZ Tray not installed/running on this
  // computer, printer not found by that name, etc.) — callers fall back to
  // the existing browser-print ticket whenever this returns false, so
  // printing never just silently fails for the kitchen.
  async function tryPrintViaEscPos(o) {
    try {
      const res = await fetch("/api/settings/escpos");
      if (!res.ok) return false;
      const cfg = await res.json();
      if (!cfg.enabled || !cfg.printerName) return false;
      if (typeof qz === "undefined" || typeof buildEscPosTicket !== "function") return false;

      await ensureQzConnected();
      const storeName = (storeSettings && (storeSettings.store_name_zh || storeSettings.store_name_ko)) || "한국관";
      // 사장님 요청(2026-09-07): "주문서 2장인출 한장은 지금처럼 주방용,
      // 다른 한장은 각각의 가격이 나오게" — 한 인쇄 작업(qz.print) 안에
      // raw 데이터 2개를 순서대로 넣으면 같은 프린터에서 이어서 2장이
      // 나온다(각 티켓 끝에 이미 FEED_AND_CUT이 들어있어 장마다 알아서
      // 커팅됨).
      const rawKitchen = buildEscPosTicket(o, storeName);
      const rawPriceCopy = buildEscPosTicket(o, storeName, { priceCopy: true, discount: computeTicketDiscountInfo(o) });
      const config = qz.configs.create(cfg.printerName, { encoding: "UTF-8" });
      await qz.print(config, [
        { type: "raw", format: "command", flavor: "plain", data: rawKitchen },
        { type: "raw", format: "command", flavor: "plain", data: rawPriceCopy },
      ]);
      return true;
    } catch (e) {
      console.warn("ESC/POS print failed, falling back to browser print:", e);
      return false;
    }
  }

  // Base64-encodes a raw byte array (Uint8Array of 0-255 values) exactly
  // as-is — used for the raster ticket below, which is real binary image
  // data, not Unicode text, so the UTF-8-string trick used elsewhere in
  // this file (see buildTicketHtml/tryPrintViaEscPos) doesn't apply here.
  // Chunked to avoid the call-stack limit of String.fromCharCode.apply on
  // a large ticket's byte array.
  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  // Sends the ticket bytes to RawBT's own local print service over a
  // loopback WebSocket (ws://127.0.0.1:40213/, documented at
  // https://github.com/402d/rawbt_ws_server — send the raw ESC/POS bytes
  // as binary, no base64/JSON wrapper). This is the PRIMARY delivery path
  // (see tryPrintViaRawBt below) because, unlike the "rawbt:" intent link
  // it replaces as first choice, opening a WebSocket is not something
  // Android/Chrome treats as "launching an external app" — so it isn't
  // subject to the "requires a real user gesture" rule that silently
  // swallowed 신규 주문 자동 인쇄 (see the long comment on 신규 주문 자동 인쇄
  // 안 됨, only 수동 인쇄 버튼 works — 2026-09-06 field report): the tablet's
  // 4-second order poll calls printKitchenTicket() with no click behind it
  // at all, and Chrome for Android silently refuses to hand a fire-and-forget
  // "rawbt:" navigation to another app from a non-gesture context (the exact
  // same category of restriction as the popup blocker that already forced
  // markPrintFailed()'s window.open() check below). A loopback WebSocket
  // connection has no such restriction, so it fires from the poll exactly
  // as reliably as from a real click.
  // ws://127.0.0.1:40213/ from this HTTPS admin page is not blocked as
  // mixed content either — Chrome (and the mixed-content spec) treats
  // 127.0.0.1/localhost as a "potentially trustworthy" loopback origin.
  function sendViaRawBtWebSocket(bytes) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      let socket;
      try {
        socket = new WebSocket("ws://127.0.0.1:40213/");
      } catch (e) {
        resolve(false);
        return;
      }
      // If RawBT's WS service isn't running (older app version, service
      // disabled, or the app isn't installed at all) the connection just
      // hangs instead of erroring quickly on some Android versions, so
      // this timeout is what actually lets tryPrintViaRawBt fall back to
      // the "rawbt:" intent link below within a reasonable time.
      const timer = setTimeout(() => {
        try {
          socket.close();
        } catch (e) {}
        finish(false);
      }, 2500);
      socket.binaryType = "arraybuffer";
      socket.onopen = () => {
        try {
          socket.send(bytes);
          // Give the loopback socket a beat to actually flush the bytes to
          // RawBT before closing — closing immediately after send() has
          // been seen to drop the last chunk on some Android WebView builds.
          setTimeout(() => {
            try {
              socket.close();
            } catch (e) {}
            finish(true);
          }, 300);
        } catch (e) {
          finish(false);
        }
      };
      socket.onerror = () => finish(false);
      socket.onclose = () => finish(false);
    });
  }

  // Sends the kitchen ticket to the RawBT app instead of QZ Tray
  // (Android-only — see the "RawBT 자동 인쇄" settings card and
  // 프로젝트 문서 claude/kitchen-printer-recommendation.md for the full
  // story). Tries RawBT's local WebSocket print service first
  // (sendViaRawBtWebSocket above — works from both a click and the silent
  // 4-second order-poll auto-print), and only falls back to the documented
  // "rawbt:base64,..." URL scheme (https://rawbt.ru/intents.html) — a
  // hidden iframe whose src is that URL makes Android open RawBT via an
  // intent — for older RawBT app versions without the WS service, or if
  // the WS connection is refused for any other reason. That intent
  // fallback is fire-and-forget and, from field testing, only actually
  // reaches RawBT when triggered by a real click (e.g. the manual 인쇄
  // button or "RawBT 테스트 인쇄"), not from the automatic poll. RawBT
  // itself already has the actual printer (Bluetooth, USB, or — this
  // restaurant's case — a network/IP printer reached over WiFi) configured
  // inside the RawBT app, so neither path here ever needs to know the
  // printer's address.
  //
  // Sends buildEscPosRasterTicket()'s bitmap, not buildEscPosTicket()'s
  // plain ESC/POS text — the on-site test print (2026-09-06) came out with
  // every Chinese character replaced by a different, unrelated glyph while
  // digits/ASCII printed fine, the signature of this printer's firmware
  // reading our UTF-8 bytes through its own built-in (non-UTF-8) code page.
  // A bitmap sidesteps that entirely — see buildEscPosRasterTicket's own
  // comment in escpos.js for the full explanation.
  //
  // IMPORTANT caveat: the "rawbt:" fallback tier is fire-and-forget — unlike
  // tryPrintViaEscPos(), Android doesn't hand a success/failure result back
  // to the web page for it — so returning true from that tier only means
  // "RawBT looks enabled and we handed it the data", not "paper actually
  // came out". The WebSocket tier is more honest (it only returns true once
  // the bytes were actually sent over an open connection), but still can't
  // confirm the physical printer accepted them. Use the RawBT app's own
  // test print, and the "RawBT 테스트 인쇄" button below, to verify real
  // printing before relying on this for live orders.
  // The 한국관 POS app injects window.HangukgwanPrint into this page. Its
  // presence is how the page knows it is running inside that app rather than
  // in a browser — and it is also the print path itself: printBase64() hands
  // the ticket bytes to the app, which writes them to the printer's own TCP
  // port (9100). No RawBT app in the middle re-reading our bytes through some
  // other code page, and none of Chrome's "an app launch needs a real tap"
  // rule that stopped 신규 주문 자동 인쇄 from ever firing on its own.
  function appPrintBridge() {
    try {
      const bridge = typeof HangukgwanPrint !== "undefined" ? HangukgwanPrint : null;
      return bridge && typeof bridge.printBase64 === "function" ? bridge : null;
    } catch (e) {
      return null;
    }
  }

  // 한 장(bytes 하나)을 현재 활성화된 경로(앱 브릿지 → RawBT WebSocket →
  // "rawbt:" intent iframe, 우선순위 그대로)로 실제로 내보낸다 — 아래
  // tryPrintViaRawBt()가 주방용/결제용 2장 각각에 대해 이 함수를 순서대로
  // 호출한다. bridge가 이미 확인돼 있으면 그대로 재사용(매 장마다 다시
  // appPrintBridge()를 부를 필요 없음).
  function concatBytes(parts) {
    const total = parts.reduce((n, p) => n + p.length, 0);
    const all = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
      all.set(p, at);
      at += p.length;
    }
    return all;
  }

  /**
   * 빌지 여러 장을 「한 번에」 내보낸다.
   *
   * 2026-09-10 사장님(장사 중): "프린트는 잘 되는 거 같은데 여전히 1장만
   * 나오는 테이블이 있다니까."
   *
   * 주방용과 결제용을 따로 두 번 보내고 있었던 게 원인이다. 값싼 열전사
   * 프린터는 9100 포트에 연결을 하나만 받고, 버퍼도 몇십 KB뿐이다. 첫 장이
   * 아직 나오고 있는 동안 두 번째 연결을 열면 거절되거나 버퍼가 넘쳐서
   * 조용히 사라진다 — 앱은 "queued" 를 돌려줬으니 화면에는 아무 문제도
   * 안 보인다. 품목이 많은 테이블에서만 1장이 나온 이유가 이것이다.
   * 짧은 빌지는 두 번째가 도착하기 전에 다 나와버리니까.
   *
   * 두 장을 이어붙여 한 줄기로 보내면 그 일이 없어진다. 연결도 하나, 버퍼가
   * 차면 TCP 가 알아서 기다린다. 각 빌지 끝에 이미 커팅 명령이 들어 있어서
   * 종이는 그대로 두 장으로 나온다.
   *
   * "rawbt:" intent 경로만 예외다 — 주소 길이 제한이 있어서 이어붙이면
   * 통째로 못 보낸다. 거기서는 예전처럼 나눠 보내되, 사이를 띄운다.
   */
  async function sendRasterTicketParts(parts, bridge) {
    const list = parts.filter((p) => p && p.length);
    if (!list.length) return false;

    if (bridge) {
      const result = bridge.printBase64(bytesToBase64(concatBytes(list)));
      if (result === "queued") return true;
      // The app shows its own on-screen message for a real failure (no
      // printer address saved, printer unreachable). Returning false here
      // lets printKitchenTicket()'s ladder carry on to the browser-print
      // fallback, so a ticket is never dropped without a trace.
      console.warn("한국관 POS 앱 인쇄 실패:", result);
      return false;
    }

    if (await sendViaRawBtWebSocket(concatBytes(list))) return true;

    for (let i = 0; i < list.length; i++) {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = "rawbt:base64," + bytesToBase64(list[i]);
      document.body.appendChild(iframe);
      setTimeout(() => iframe.remove(), 1000);
      // 앞 장이 나올 시간을 준다. 길이에 비례해서 — 긴 빌지일수록 오래 걸리고,
      // 1장만 나오던 게 바로 그 긴 빌지들이었다.
      if (i < list.length - 1) await new Promise((r) => setTimeout(r, printDrainMs(list[i])));
    }
    return true;
  }

  // 이 빌지가 실제로 종이로 나오는 데 걸릴 대략의 시간.
  // 폭 576px 래스터는 한 줄에 72바이트다. 203dpi 에서 한 줄은 1/8mm,
  // 값싼 열전사 프린터가 넉넉잡아 초당 40mm — 한 줄에 약 3.2ms.
  function printDrainMs(bytes) {
    const rows = bytes.length / 72;
    return Math.min(10000, Math.max(800, Math.round(rows * 3.2) + 700));
  }

  // 한 장짜리(자리 이동 빌지, 시험 인쇄)를 위한 얇은 껍데기.
  async function sendRasterTicketBytes(bytes, bridge) {
    return sendRasterTicketParts([bytes], bridge);
  }

  // ---------- 자리 이동 빌지 설정 (설정 > 인쇄) ----------
  // 2026-09-10 사장님: "이것도 설정 -> 인쇄 에서 수정할 수 있게 해줘."
  // 주문서 글자 크기 카드와 같은 모양·같은 저장 방식이다(위
  // loadTicketFontSizes 참고) — 두 화면이 다르게 동작하면 매번 다시 배워야 한다.
  const DEFAULT_MOVE_SLIP = {
    storeName: 13, title: 20, tables: 34, info: 13, orders: 13, footer: 14,
    storeNameWeight: 400, titleWeight: 700, tablesWeight: 700,
    infoWeight: 400, ordersWeight: 400, footerWeight: 700,
  };
  const MOVE_SLIP_KEYS = ["storeName", "title", "tables", "info", "orders", "footer"];
  // 직원 화면에서도 들고 있어야 한다 — 자리를 옮기는 건 직원이고, 그때
  // 나가는 종이는 사장님이 정한 크기여야 한다(주문서와 같은 이유).
  let moveSlipSettings = Object.assign({ enabled: true, showOrders: true }, DEFAULT_MOVE_SLIP);

  function readMoveSlipInputs() {
    const out = {
      enabled: !!($("#moveSlipEnabledToggle") || {}).checked,
      showOrders: !!($("#moveSlipShowOrdersToggle") || {}).checked,
    };
    MOVE_SLIP_KEYS.forEach((k) => {
      const id = `ms${k.charAt(0).toUpperCase()}${k.slice(1)}`;
      const size = $(`#${id}`);
      const weight = $(`#${id}Weight`);
      if (size && size.value !== "") out[k] = Number(size.value);
      if (weight && weight.value !== "") out[`${k}Weight`] = Number(weight.value);
    });
    return out;
  }

  function setMoveSlipInputs(cfg) {
    const enabled = $("#moveSlipEnabledToggle");
    const showOrders = $("#moveSlipShowOrdersToggle");
    if (enabled) enabled.checked = cfg.enabled !== false;
    if (showOrders) showOrders.checked = cfg.showOrders !== false;
    MOVE_SLIP_KEYS.forEach((k) => {
      const id = `ms${k.charAt(0).toUpperCase()}${k.slice(1)}`;
      const size = $(`#${id}`);
      const weight = $(`#${id}Weight`);
      if (size) size.value = cfg[k] != null ? cfg[k] : DEFAULT_MOVE_SLIP[k];
      if (weight) weight.value = cfg[`${k}Weight`] != null ? cfg[`${k}Weight`] : DEFAULT_MOVE_SLIP[`${k}Weight`];
    });
  }

  // 미리보기는 실제로 인쇄되는 그 HTML 그대로다 — 따로 그린 그림이면
  // 화면과 종이가 조금씩 달라지고, 그 차이는 종이가 나온 뒤에야 보인다.
  function sampleMoveSlipInfo() {
    return {
      storeName: (storeSettings && (storeSettings.store_name_zh || storeSettings.store_name_ko)) || "한국관",
      from: "5",
      to: "8",
      at: new Date().toTimeString().slice(0, 5),
      partySize: 4,
      partyAdults: 3,
      partyChildren: 1,
      orders: [
        { id: 128, time: "19:05", summary: `${T("moveSlipSampleItemA")}×2` },
        { id: 131, time: "19:24", summary: `${T("moveSlipSampleItemB")}×1` },
      ],
    };
  }

  function updateMoveSlipPreview() {
    const frame = $("#moveSlipPreviewFrame");
    if (!frame) return;
    const cfg = readMoveSlipInputs();
    frame.srcdoc = buildMoveSlipHtml(
      Object.assign(sampleMoveSlipInfo(), { showOrders: cfg.showOrders }),
      Object.assign({}, DEFAULT_MOVE_SLIP, cfg)
    );
  }

  ["#moveSlipEnabledToggle", "#moveSlipShowOrdersToggle"].forEach((sel) => {
    const el = $(sel);
    if (el) el.onchange = updateMoveSlipPreview;
  });
  MOVE_SLIP_KEYS.forEach((k) => {
    const id = `ms${k.charAt(0).toUpperCase()}${k.slice(1)}`;
    [$(`#${id}`), $(`#${id}Weight`)].forEach((el) => {
      if (!el) return;
      el.oninput = updateMoveSlipPreview;
      el.onchange = updateMoveSlipPreview;
    });
  });

  async function loadMoveSlipSettings() {
    try {
      const res = await fetch("/api/settings/move-slip");
      if (res.ok) moveSlipSettings = Object.assign({}, DEFAULT_MOVE_SLIP, await res.json());
    } catch (e) {
      /* 못 불러와도 기본값으로 종이는 나와야 한다 */
    }
    setMoveSlipInputs(moveSlipSettings);
    updateMoveSlipPreview();
  }

  const saveMoveSlipBtn = $("#saveMoveSlipBtn");
  if (saveMoveSlipBtn) {
    saveMoveSlipBtn.onclick = async () => {
      const res = await fetch("/api/settings/move-slip", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(readMoveSlipInputs()),
      });
      const msg = $("#moveSlipMsg");
      if (res.ok) {
        moveSlipSettings = Object.assign({}, DEFAULT_MOVE_SLIP, await res.json());
        setMoveSlipInputs(moveSlipSettings);
        updateMoveSlipPreview();
        msg.style.color = "#1a8a44";
        msg.textContent = T("ticketFontSavedMsg");
      } else {
        msg.style.color = "#b5232c";
        msg.textContent = T("staffPasswordFailed");
      }
      msg.hidden = false;
      setTimeout(() => (msg.hidden = true), 2500);
    };
  }

  const resetMoveSlipBtn = $("#resetMoveSlipBtn");
  if (resetMoveSlipBtn) {
    resetMoveSlipBtn.onclick = () => {
      setMoveSlipInputs(Object.assign({ enabled: true, showOrders: true }, DEFAULT_MOVE_SLIP));
      updateMoveSlipPreview();
    };
  }

  const testMoveSlipBtn = $("#testMoveSlipBtn");
  if (testMoveSlipBtn) {
    testMoveSlipBtn.onclick = async () => {
      // 화면에 지금 적혀 있는 값으로 뽑는다 — 저장하기 전에 종이로 확인할
      // 수 있어야 "저장하고 손님 자리 옮겨보기" 를 안 한다.
      const saved = moveSlipSettings;
      moveSlipSettings = Object.assign({}, DEFAULT_MOVE_SLIP, readMoveSlipInputs(), { enabled: true });
      try {
        await printMoveSlip(sampleMoveSlipInfo());
      } finally {
        moveSlipSettings = saved;
      }
    };
  }

  // ---------- 자리 이동 빌지 ----------
  // 2026-09-10 사장님: "자리이동하면 자리이동 빌지도 하나 나왔으면 좋겠어."
  //
  // 주방과 홀에는 이미 옛 번호가 찍힌 주문서가 나가 있다. 화면에서만 바뀌면
  // 종이를 들고 다니는 사람은 그 사실을 모른다.
  //
  // 주문서와 같은 사다리를 탄다: 앱 브릿지 → RawBT → QZ Tray → 브라우저 인쇄.
  // 어느 한 칸이 안 되는 매장에서도 종이가 나와야 하고, 그 순서를 여기서
  // 새로 정하면 주문서와 어긋난다.
  async function printMoveSlip(info) {
    if (typeof buildEscPosMoveSlip !== "function") return false;
    // 사장님이 이 종이를 꺼둔 매장에서는 아무것도 하지 않는다.
    if (moveSlipSettings.enabled === false) return false;
    info = Object.assign({ showOrders: moveSlipSettings.showOrders !== false }, info);
    let bytes;
    try {
      const storeName = (storeSettings && (storeSettings.store_name_zh || storeSettings.store_name_ko)) || "한국관";
      bytes = buildEscPosMoveSlip(info, storeName, moveSlipSettings);
    } catch (e) {
      console.warn("자리 이동 빌지를 만들지 못했습니다:", e);
      return false;
    }

    const bridge = appPrintBridge();
    if (bridge) {
      if (await sendRasterTicketBytes(bytes, bridge)) return true;
    } else {
      try {
        const res = await fetch("/api/settings/escpos");
        const cfg = res.ok ? await res.json() : {};
        if (cfg.rawbtEnabled && (await sendRasterTicketBytes(bytes, null))) return true;
        // QZ Tray 는 같은 래스터 바이트를 base64 로 받는다 — 텍스트 모드로
        // 따로 만들지 않는다. 한국어·중국어는 프린터 코드페이지에 기대지
        // 않고 그림으로 찍는 편이 어느 기계에서도 같게 나온다.
        if (cfg.enabled && cfg.printerName && typeof qz !== "undefined") {
          await ensureQzConnected();
          const config = qz.configs.create(cfg.printerName);
          await qz.print(config, [{ type: "raw", format: "command", flavor: "base64", data: bytesToBase64(bytes) }]);
          return true;
        }
      } catch (e) {
        console.warn("자리 이동 빌지 인쇄 실패, 브라우저 인쇄로 넘어갑니다:", e);
      }
    }

    // 마지막 칸 — 프린터가 하나도 안 잡힌 자리에서도 종이는 나와야 한다.
    const win = window.open("", "_blank");
    if (!win) return false;
    win.document.open();
    win.document.write(buildMoveSlipHtml(info, moveSlipSettings));
    win.document.close();
    setTimeout(() => {
      win.focus();
      win.print();
    }, 300);
    return true;
  }

  function buildMoveSlipHtml(info, sizes) {
    const z = Object.assign({}, DEFAULT_MOVE_SLIP, sizes || {});
    const esc = (v) =>
      String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const rows = (info.showOrders === false ? [] : info.orders || [])
      .map((o) => `<div class="row ord"><span>#${esc(o.id)} ${esc(o.time || "")}</span><span>${esc(o.summary || "")}</span></div>`)
      .join("");
    return `<!doctype html><html><head><meta charset="utf-8"><title>자리 이동</title><style>
      @page { margin: 4mm; }
      body { font-family: "Noto Sans TC","Noto Sans KR",sans-serif; width: 72mm; margin: 0 auto; color: #000; }
      .store { text-align: center; font-size: ${z.storeName}px; font-weight: ${z.storeNameWeight}; }
      h1 { text-align: center; font-size: ${z.title}px; font-weight: ${z.titleWeight}; margin: 6px 0 10px; }
      .big { text-align: center; font-size: ${z.tables}px; font-weight: ${z.tablesWeight}; margin: 10px 0; }
      hr { border: none; border-top: 2px solid #000; margin: 8px 0; }
      .row { display: flex; justify-content: space-between; font-size: ${z.info}px; font-weight: ${z.infoWeight}; margin-bottom: 4px; gap: 8px; }
      .row.ord { font-size: ${z.orders}px; font-weight: ${z.ordersWeight}; }
      .qr { text-align: center; font-size: ${z.footer}px; font-weight: ${z.footerWeight}; margin-top: 8px; }
      .qr small { display: block; font-weight: 400; font-size: ${Math.max(8, z.footer - 2)}px; }
    </style></head><body>
      <div class="store">${esc(info.storeName || "한국관")}</div>
      <h1>자리 이동 · 換桌</h1>
      <hr>
      <div class="big">${esc(info.from)} → ${esc(info.to)}</div>
      <hr>
      <div class="row"><span>시각 / 時間</span><span>${esc(info.at || "")}</span></div>
      ${info.partySize ? `<div class="row"><span>인원 / 人數</span><span>${esc(moveSlipPartyText(info))}</span></div>` : ""}
      ${rows ? `<hr>${rows}` : ""}
      <hr>
      <div class="qr">손님은 새 자리 QR 로 주문<small>請客人改掃新桌號 QR</small></div>
    </body></html>`;
  }

  // 알림 빌지 한 장. 새 주문 빌지와 다른 점 두 가지:
  //   · 한 장만 나간다 (주방용만 — 결제용 사본은 새 주문에만 의미가 있다)
  //   · 주문 상태를 건드리지 않는다. 「신규 → 조리 중」으로 밀어버리면
  //     아직 안 찍힌 주문을 찍힌 것으로 만든다.
  async function printNoticeTicket(job) {
    const o = job.order;
    try {
      if (typeof buildEscPosRasterTicket !== "function") return false;
      const bridge = appPrintBridge();
      if (!bridge) {
        const res = await fetch("/api/settings/escpos");
        if (!res.ok) return false;
        const cfg = await res.json();
        if (!cfg.rawbtEnabled) return false;
      }
      const storeName = (storeSettings && (storeSettings.store_name_zh || storeSettings.store_name_ko)) || "한국관";
      const counter = isCounterOrder(o);
      const tableLabel = counter
        ? o.pickup_number && o.customer_name
          ? `📦 ${o.pickup_number}號 · ${o.customer_name}`
          : "外帶櫃檯"
        : `桌號 ${o.table_number}${partyTag(o)}`;
      const labelInfo = { tableLabel, phoneLine: counter && o.customer_phone ? `☎ ${o.customer_phone}` : null };

      // 바뀐 줄만 찍는다. 전체를 다시 찍으면 이미 만들고 있는 요리를 또
      // 만들게 된다.
      const lines = [
        ...(job.change.added || []).map((it) => Object.assign({}, it, { __delta: "+" })),
        ...(job.change.removed || []).map((it) => Object.assign({}, it, { __delta: "-" })),
      ];
      if (!lines.length) return false;

      const noticeOrder = Object.assign({}, o, { items: lines });
      const parts = [buildEscPosRasterTicket(noticeOrder, storeName, ticketFontSizes, labelInfo, { notice: job.notice })];
      // 품목이 바뀌면 받을 돈도 바뀐다. 새 주문과 똑같이 결제용 사본을 한 장
      // 더 내보낸다 — 그 새 금액을 알려주는 종이가 이것 하나뿐이다.
      // 자리 이동은 금액이 그대로라 주방용 한 장이면 된다.
      if (job.notice.kind === "changed") {
        parts.push(
          buildEscPosRasterTicket(noticeOrder, storeName, ticketFontSizes, labelInfo, {
            notice: job.notice,
            priceCopy: true,
            discount: computeTicketDiscountInfo(o),
          })
        );
      }
      // 한 줄기로 보낸다 — 따로 보내면 두 번째가 조용히 사라진다
      // (sendRasterTicketParts 주석).
      return await sendRasterTicketParts(parts, bridge);
    } catch (e) {
      console.warn("notice print failed:", e);
      return false;
    }
  }

  async function tryPrintViaRawBt(o) {
    try {
      if (typeof buildEscPosRasterTicket !== "function") return false;
      const bridge = appPrintBridge();
      // In the app the printer is configured in the app's own settings, so
      // the "RawBT 자동 인쇄" switch — which only ever gated handing the job to
      // the RawBT app from a browser — does not apply. Skipping the lookup
      // also keeps a network round-trip out of every single ticket.
      if (!bridge) {
        const res = await fetch("/api/settings/escpos");
        if (!res.ok) return false;
        const cfg = await res.json();
        if (!cfg.rawbtEnabled) return false;
      }

      const storeName = (storeSettings && (storeSettings.store_name_zh || storeSettings.store_name_ko)) || "한국관";
      // Mirrors buildTicketHtml()'s own table-label/phone logic exactly
      // (see admin.js above) — escpos.js doesn't know about the `tables`
      // list, so that lookup happens here and the result is handed in.
      const counter = isCounterOrder(o);
      const tableLabel = counter
        ? o.pickup_number && o.customer_name
          ? `📦 ${o.pickup_number}號 · ${o.customer_name}`
          : "外帶櫃檯"
        : `桌號 ${o.table_number}${partyTag(o)}`;
      const phoneLine = counter && o.customer_phone ? `☎ ${o.customer_phone}` : null;
      const labelInfo = { tableLabel, phoneLine };

      // 사장님 요청(2026-09-07): "주문서 2장인출 한장은 지금처럼 주방용,
      // 다른 한장은 각각의 가격이 나오게" — 주방용 비트맵을 먼저 내보내고
      // 이어서 결제용(가격 포함) 비트맵을 내보낸다. 첫 장이 이미
      // 실패했다면(false) 굳이 두 번째를 시도하지 않고 바로 실패 처리 —
      // printKitchenTicket()의 다음 단계(브라우저 인쇄, 2장 모두 다시
      // 시도)로 넘어가는 편이 반쪽짜리 인쇄보다 낫다.
      const kitchenBytes = buildEscPosRasterTicket(o, storeName, ticketFontSizes, labelInfo);
      const priceBytes = buildEscPosRasterTicket(o, storeName, ticketFontSizes, labelInfo, {
        priceCopy: true,
        discount: computeTicketDiscountInfo(o),
      });
      // 두 장을 한 줄기로 보낸다 — 따로 보내면 긴 빌지에서 두 번째가
      // 조용히 사라진다(sendRasterTicketParts 주석).
      return await sendRasterTicketParts([kitchenBytes, priceBytes], bridge);
    } catch (e) {
      console.warn("RawBT print failed:", e);
      return false;
    }
  }

  $("#testEscposBtn").onclick = async () => {
    const btn = $("#testEscposBtn");
    const status = $("#escposConnStatus");
    const printerName = $("#escposPrinterNameInput").value.trim();
    if (!printerName) {
      status.style.color = "#b5232c";
      status.textContent = T("escposNoPrinterName");
      status.hidden = false;
      return;
    }
    btn.disabled = true;
    status.style.color = "";
    status.textContent = T("escposConnecting");
    status.hidden = false;
    try {
      await ensureQzConnected();
      const storeName = (storeSettings && (storeSettings.store_name_zh || storeSettings.store_name_ko)) || "한국관";
      const sampleOrder = {
        table_number: "TEST",
        order_type: "dine_in",
        created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        items: [{ name_ko: "테스트 메뉴", name_zh: "測試菜品", qty: 1, option_choice: "보통", spice_choice: "보통", note: "" }],
        total: 0,
        note: "",
      };
      const raw = buildEscPosTicket(sampleOrder, storeName);
      const config = qz.configs.create(printerName, { encoding: "UTF-8" });
      await qz.print(config, [{ type: "raw", format: "command", flavor: "plain", data: raw }]);
      status.style.color = "#1a8a44";
      status.textContent = T("escposTestSuccess");
    } catch (e) {
      console.warn("ESC/POS test print failed:", e);
      status.style.color = "#b5232c";
      status.textContent = T("escposTestFailed");
    } finally {
      btn.disabled = false;
    }
  };

  // No QZ Tray/websocket connection step here — RawBT is reached purely via
  // the "rawbt:" intent (see tryPrintViaRawBt/bytesToBase64 above), which
  // is fire-and-forget, so this can only confirm "we sent it to the OS",
  // never "RawBT actually printed it". The status message says so
  // explicitly to avoid a false sense of certainty. Uses the same raster
  // ticket builder as the real print path, so this test print actually
  // exercises the fix for the Chinese-character garbling found on-site
  // (2026-09-06), not the old plain-text path that caused it.
  $("#testRawbtBtn").onclick = async () => {
    const status = $("#rawbtTestStatus");
    try {
      const storeName = (storeSettings && (storeSettings.store_name_zh || storeSettings.store_name_ko)) || "한국관";
      const sampleOrder = {
        table_number: "TEST",
        order_type: "dine_in",
        created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        items: [{ name_ko: "테스트 메뉴", name_zh: "測試菜品", qty: 1, option_choice: "보통", spice_choice: "보통", note: "" }],
        total: 0,
        note: "",
      };
      const bytes = buildEscPosRasterTicket(sampleOrder, storeName, ticketFontSizes, { tableLabel: "桌號 TEST" });
      const bridge = appPrintBridge();
      if (bridge) {
        const result = bridge.printBase64(bytesToBase64(bytes));
        if (result !== "queued") {
          throw new Error(String(result));
        }
      } else {
        const iframe = document.createElement("iframe");
        iframe.style.display = "none";
        iframe.src = "rawbt:base64," + bytesToBase64(bytes);
        document.body.appendChild(iframe);
        setTimeout(() => iframe.remove(), 1000);
      }
      status.style.color = "#1a8a44";
      status.textContent = T("rawbtTestSent");
    } catch (e) {
      console.warn("RawBT test print failed:", e);
      status.style.color = "#b5232c";
      status.textContent = T("rawbtTestFailed");
    }
    status.hidden = false;
  };

  // Owner-only "reveal" toggle: fetches the actual saved token/secret and
  // shows it in the input (in place of the "leave blank to keep" prompt) so
  // a paste error (stray whitespace, cut-off characters, an old rotated
  // token) can be spotted at a glance instead of guessing.
  function wireLineReveal(btnId, inputId) {
    const btn = $(btnId);
    const input = $(inputId);
    let revealed = false;
    btn.onclick = async () => {
      if (revealed) {
        input.type = "password";
        input.value = "";
        input.placeholder = input.dataset.origPlaceholder || input.placeholder;
        btn.textContent = T("lineRevealBtn");
        revealed = false;
        return;
      }
      const res = await fetch("/api/settings/line/reveal");
      if (!res.ok) return;
      const data = await res.json();
      const value = inputId === "#lineTokenInput" ? data.token : data.secret;
      input.dataset.origPlaceholder = input.placeholder;
      input.type = "text";
      input.value = value || "";
      btn.textContent = T("lineHideBtn");
      revealed = true;
    };
  }
  wireLineReveal("#lineTokenRevealBtn", "#lineTokenInput");
  wireLineReveal("#lineSecretRevealBtn", "#lineSecretInput");

  $("#testLineBtn").onclick = async () => {
    const btn = $("#testLineBtn");
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = T("lineTestSending");
    const msg = $("#lineMsg");
    const res = await fetch("/api/settlements/line-test", { method: "POST" });
    if (res.ok) {
      msg.style.color = "#1a8a44";
      msg.textContent = T("lineTestSuccess");
    } else {
      msg.style.color = "#b5232c";
      msg.textContent = T("lineTestFailed");
    }
    msg.hidden = false;
    btn.disabled = false;
    btn.textContent = original;
    setTimeout(() => (msg.hidden = true), 4000);
  };

  PERMISSION_KEYS.forEach((k) => {
    const box = $(`#perm_${k}`);
    if (!box) return;
    // 스위치를 만지면 「저장 안 됨」만 켠다. 실제 저장은 아래 버튼이 한다
    // (2026-09-11 사장님). 여러 개를 한꺼번에 고쳐놓고 한 번에 저장하는 쪽이
    // 권한처럼 서로 엮인 설정에는 맞다 — 하나씩 저장되면 그 사이에 직원이
    // 반쯤 열린 권한으로 들어온다.
    box.onchange = () => markSettingDirty("saveStaffPermsBtn", true);
  });
  if ($("#saveStaffPermsBtn")) {
    $("#saveStaffPermsBtn").onclick = async () => {
      const payload = {};
      PERMISSION_KEYS.forEach((key) => {
        const b = $(`#perm_${key}`);
        if (b) payload[key] = b.checked;
      });
      await fetch("/api/settings/staff-permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      flashSettingSaved("staffPermSavedMsg", "saveStaffPermsBtn");
    };
  }

  // 직원 비밀번호는 사장이 여기서 정할 때까지 아예 없는 상태다(직원 로그인만
  // 막히고 나머지는 정상). 그 상태를 눈에 보이게 해둔다 — 안 그러면 "직원이
  // 로그인이 안 된다" 는 문의로만 드러난다.
  function renderStaffPasswordStatus(isSet) {
    const el = $("#staffPwStatus");
    if (!el) return;
    el.textContent = isSet ? T("staffPasswordIsSet") : T("staffPasswordNotSet");
    el.style.color = isSet ? "" : "#b5232c";
  }

  $("#setStaffPasswordBtn").onclick = async () => {
    const newPassword = $("#staff_new_password").value;
    const msg = $("#staffPwMsg");
    if (!newPassword || newPassword.length < 6) {
      msg.style.color = "#b5232c";
      msg.textContent = T("staffPasswordTooShort");
      msg.hidden = false;
      return;
    }
    const res = await fetch("/api/auth/set-staff-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword }),
    });
    if (res.ok) {
      msg.style.color = "#1a8a44";
      msg.textContent = T("staffPasswordSaved");
      $("#staff_new_password").value = "";
      renderStaffPasswordStatus(true);
    } else {
      msg.style.color = "#b5232c";
      msg.textContent = T("staffPasswordFailed");
    }
    msg.hidden = false;
    setTimeout(() => (msg.hidden = true), 2500);
  };

  // ---------- Settlement (결산) ----------
  // Owner-only. The main view is always a *live* computation (no button to
  // press, no manual tallying) — "이 날짜 정산 기록 저장" just additionally
  // snapshots it into permanent history, same as the nightly cron does
  // automatically after closing time.
  let currentSettlementDate = null; // only set (non-null) when start === end — used by the manual "저장" button
  let lastSettlementData = null; // used by the CSV export button
  let settlementItemsChart = null;
  let settlementHistoryChart = null;
  let settlementTrendChart = null;
  let settlementHourlyChart = null;

  function itemDisplayName(it) {
    return adminLang === "zh" ? it.name_zh || it.name_ko : it.name_ko || it.name_zh;
  }

  // Bar chart of today's (or the selected date's) top-selling items by
  // revenue — the table below already has the exact numbers, this is just
  // the "그래프로도 보여줘" visual on top of it.
  // 그래프를 못 그릴 때 **말은 해준다.**
  //
  // 2026-09-10 사장님: "여기도 볼 수 있게 해줘. 지금은 비어있어."
  // 원인은 Chart.js 주소가 404 였던 것이지만(admin.html 주석), 진짜 문제는
  // 그게 아니라 **아무 말 없이 빈칸이었다는 것**이다. 빈 그래프는 「오늘
  // 손님이 없었나 보다」로 읽힌다. 못 그렸으면 못 그렸다고 적어야 한다.
  function chartFallbackNote(canvas, show) {
    const wrap = canvas && canvas.closest(".settlement-chart-wrap");
    if (!wrap) return;
    let el = wrap.querySelector(".stl-chart-missing");
    if (!show) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement("p");
      el.className = "stl-chart-missing";
      wrap.appendChild(el);
    }
    el.textContent = T("settlementChartUnavailable");
  }

  // 그릴 수 있으면 true. 못 그리면 그 자리에 이유를 적고 false.
  function chartReady(canvas) {
    if (!canvas) return false;
    if (typeof Chart === "undefined") {
      chartFallbackNote(canvas, true);
      return false;
    }
    chartFallbackNote(canvas, false);
    return true;
  }

  function renderItemsChart(itemBreakdown) {
    const canvas = $("#settlementItemsChart");
    if (!chartReady(canvas)) return;
    const top = itemBreakdown.slice(0, 10);
    if (settlementItemsChart) settlementItemsChart.destroy();
    settlementItemsChart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: top.map(itemDisplayName),
        datasets: [{ label: T("settlementItemSubtotal"), data: top.map((it) => it.subtotal), backgroundColor: "#b5232c", borderRadius: 4 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } },
      },
    });
  }

  // Bar chart of revenue across saved settlement history — bars for days
  // that had unpaid/problem orders are colored red so a bad night stands
  // out at a glance, not just as a number in the list below.
  function renderHistoryChart(list) {
    const canvas = $("#settlementHistoryChart");
    if (!chartReady(canvas)) return;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    if (settlementHistoryChart) settlementHistoryChart.destroy();
    settlementHistoryChart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: sorted.map((s) => s.date.slice(5)),
        datasets: [
          {
            label: T("settlementRevenue"),
            data: sorted.map((s) => s.total_revenue || 0),
            backgroundColor: sorted.map((s) => (s.problem_order_count > 0 ? "#b3261e" : "#16213e")),
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } },
      },
    });
  }

  // Trend chart for the currently selected range — one bar per day that had
  // paid revenue in it, so a multi-day range (이번 주/이번 달 등) reads as an
  // actual trend instead of one flat total.
  function renderTrendChart(dailyBreakdown) {
    const canvas = $("#settlementTrendChart");
    if (!chartReady(canvas)) return;
    if (settlementTrendChart) settlementTrendChart.destroy();
    settlementTrendChart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: dailyBreakdown.map((d) => d.date.slice(5)),
        datasets: [{ label: T("settlementRevenue"), data: dailyBreakdown.map((d) => d.revenue), backgroundColor: "#16213e", borderRadius: 4 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } },
      },
    });
  }

  // Bar chart of order count by hour-of-day (0–23) — "몇 시에 손님이 많이
  // 오는지". Hovering a bar shows that hour's top-selling items via a custom
  // tooltip callback, so "그 시간대엔 뭐가 잘 팔리는지" is one hover away
  // instead of needing a second chart.
  function renderHourlyChart(hourlyBreakdown) {
    const canvas = $("#settlementHourlyChart");
    if (!chartReady(canvas)) return;
    const byHour = new Map(hourlyBreakdown.map((h) => [h.hour, h]));
    const hours = Array.from({ length: 24 }, (_, h) => h);
    const data = hours.map((h) => (byHour.get(h) ? byHour.get(h).order_count : 0));
    if (settlementHourlyChart) settlementHourlyChart.destroy();
    settlementHourlyChart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: hours.map((h) => `${h}시`),
        datasets: [{ label: T("settlementHourlyOrders"), data, backgroundColor: "#16213e", borderRadius: 4 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              afterLabel: (ctx) => {
                const h = byHour.get(ctx.dataIndex);
                if (!h || !h.top_items || h.top_items.length === 0) return "";
                const names = h.top_items.map((it) => `${itemDisplayName(it)} x${it.qty}`).join(", ");
                return `${T("settlementHourlyTopItems")}: ${names}`;
              },
            },
          },
        },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
  }

  function renderSettlement(data) {
    lastSettlementData = data;
    currentSettlementDate = data.date; // null when viewing a multi-day range
    $("#settlementStartDate").value = data.start_date;
    $("#settlementEndDate").value = data.end_date;
    const closeBtn = $("#settlementCloseBtn");
    closeBtn.disabled = !data.date;
    closeBtn.title = data.date ? "" : T("settlementCloseRangeHint");
    // 직원 계정에는 날짜를 고르는 길이 없다(.settlement-date-label 은 owner-only).
    // 그러면 지금 무엇을 보고 있는지도 알 수 없으니, 그 자리에 날짜를 적어준다.
    // 서버가 today_only 를 붙여 보낸다 — 「오늘만 보인다」를 정하는 쪽은 서버다.
    const todayOnly = $("#settlementTodayOnly");
    if (todayOnly) {
      todayOnly.textContent = data.today_only
        ? `${data.start_date} · ${T("settlementTodayOnlyNote")}`
        : "";
    }
    const share = (v, total) => (total > 0 ? Math.round((v / total) * 100) : 0);

    // ── 1. 오늘 한눈에 ────────────────────────────────────────────
    // 사장님(2026-09-10): "결산 탭 보는 게 너무 복잡해. 눈에 딱 들어오지도
    // 않고." 매출 하나만 크게 두고, 그것을 설명하는 값들은 옆에 작게 둔다.
    $("#settlementRevenue").textContent = nt(data.total_revenue);
    $("#settlementHeroSub").textContent = fmtSettlementHeroSub(data);
    $("#settlementGuests").textContent = Number(data.guest_count || 0).toLocaleString();
    // 어른·아이 (2026-09-10 사장님: "결산에 들어가는 인원 성인 아이 따로
    // 구분해서 집계해줘"). 손님 수 아래에 한 줄로 붙인다 — 칸을 따로 만들면
    // 「결산 탭 보는 게 너무 복잡해」로 되돌아간다.
    renderSettlementHalves(data);
    // 곁가지 하나가 본체를 끌고 내려가지 않게 (위 renderSettlementHalves 주석).
    try {
      renderSettlementShiftBadge(data);
    } catch (e) {
      console.warn("시간대 표를 그리지 못했습니다:", e);
    }
    const guestSplit = $("#settlementGuestSplit");
    if (guestSplit) {
      const a = Number(data.adult_count || 0);
      const c = Number(data.child_count || 0);
      guestSplit.textContent = a + c > 0 ? fmtGuestSplit(a, c) : "";
      guestSplit.hidden = a + c === 0;
    }
    $("#settlementAvgPerGuest").textContent = nt(data.avg_per_guest);
    $("#settlementAvgPerOrder").textContent = nt(data.avg_per_order);
    $("#settlementTurnover").textContent =
      data.avg_turnover_minutes != null ? `${data.avg_turnover_minutes}${T("settlementTurnoverMinutes")}` : T("settlementTurnoverNoData");

    // 챙길 것이 있을 때만 띠를 만든다. "미결제 0건"을 매일 보여주면 그
    // 자리가 배경이 되어, 정작 숫자가 생긴 날에도 눈에 안 들어온다.
    const alerts = [];
    if (data.problem_order_count > 0) {
      alerts.push(`<div class="stl-alert warn">⚠️ ${T("settlementProblemCount").replace("⚠️ ", "")} ${data.problem_order_count}${T("settlementCountSuffix")} · ${nt(data.problem_amount)}</div>`);
    }
    if (data.cancelled_order_count > 0) {
      alerts.push(`<div class="stl-alert info">${T("settlementCancelledCount")} ${data.cancelled_order_count}${T("settlementCountSuffix")} · ${nt(data.cancelled_amount)}</div>`);
    }
    const alertsEl = $("#settlementAlerts");
    alertsEl.innerHTML = alerts.join("");
    alertsEl.hidden = alerts.length === 0;

    const problemSection = $("#settlementProblemSection");
    if (data.problem_order_count > 0) {
      problemSection.hidden = false;
      $("#settlementProblemList").innerHTML = data.problem_orders
        .map((o) => {
          const time = o.created_at.slice(11, 16);
          const itemsText = o.items.map((it) => `${itemDisplayName(it)} x${it.qty}`).join(", ");
          return `
            <div class="settlement-problem-row">
              <div class="settlement-problem-head">
                <span class="settlement-problem-time">${time}</span>
                <span class="settlement-problem-table">${fmtOrderTableTag(o.table_number)}</span>
                <span class="settlement-problem-status">${statusLabel(o.status)}</span>
                <span class="settlement-problem-total">NT$${o.total}</span>
              </div>
              <div class="settlement-problem-items">${itemsText}</div>
            </div>`;
        })
        .join("");
    } else {
      problemSection.hidden = true;
    }

    // ── 2. 돈이 어떻게 들어왔나 ───────────────────────────────────
    const paymentMethodLabel = (method) =>
      ({
        cash: T("paymentMethodCash"),
        linepay: T("paymentMethodLinepay"),
        card: T("paymentMethodCard"),
        other: T("paymentMethodOther"),
        online: T("paymentMethodOnline"),
        unspecified: T("paymentMethodUnspecified"),
      })[method] || method;

    renderBars("#settlementPaymentMethodBars", (data.payment_method_breakdown || [])
      .map((pm) => ({ name: paymentMethodLabel(pm.method), value: pm.revenue, count: pm.order_count })));
    $("#settlementPaymentMethodTotal").textContent = nt(data.payment_method_total);
    // 총합이 위의 매출과 같아야 서랍의 현금을 맞출 수 있다. 예전에는 할인
    // 때문에 어긋났고(2026-09-10 고침), 그래서 맞다는 것을 눈으로 확인할 수
    // 있게 한 줄 적어둔다.
    $("#settlementReconcileNote").textContent =
      data.payment_method_total === data.total_revenue ? T("settlementReconcileOk") : "";

    const orderTypeLabel = (t) =>
      ({ dine_in: T("settlementOrderTypeDineIn"), takeout: T("settlementOrderTypeTakeout"), mixed: T("settlementOrderTypeMixed") })[t] || t;
    renderBars("#settlementOrderTypeBars", (data.order_type_breakdown || [])
      .map((e) => ({ name: orderTypeLabel(e.order_type), value: e.revenue, count: e.order_count })));

    // 주문에 저장되는 키는 src/routes/orders.js의 discountTypeKey가 만든다
    // — 한 종류면 "te95", 둘을 같이 걸었으면 "te95+manual" 처럼 붙어서 온다.
    // vip95/vip10은 이 키가 te95/vip9로 바뀌기 전에 저장된 옛 주문용.
    const discountPartLabel = (t) =>
      ({
        te95: "特約95折",
        vip9: "VIP9折",
        vip95: "特約95折",
        vip10: "VIP9折",
        manual: T("settlementDiscountManual"),
        unspecified: T("paymentMethodUnspecified"),
      })[t] || t;
    const discountLabel = (t) =>
      String(t || "unspecified")
        .split("+")
        .map(discountPartLabel)
        .join(" + ");
    const discountRows = data.discount_breakdown || [];
    // 할인이 한 건도 없으면 이 묶음을 통째로 감춘다 — 빈 표는 자리만 먹는다.
    $("#settlementDiscountBlock").hidden = discountRows.length === 0;
    renderBars("#settlementDiscountBars", discountRows
      .map((e) => ({ name: discountLabel(e.discount_type), value: e.amount, count: e.order_count })));
    $("#settlementGrossRevenue").textContent = nt(data.gross_revenue);

    // VIP 카드 손익 — 카드를 판 돈에서 그 카드들이 깎아준 돈을 뺀다.
    // 카드를 팔지도 않았고 카드 할인도 없었던 기간에는 통째로 감춘다.
    const vip = data.vip_card_program || {};
    const vipHasAnything = !!(vip.cards_sold || vip.card_discount_given);
    $("#settlementVipCardBlock").hidden = !vipHasAnything;
    if (vipHasAnything) {
      const soldSuffix = vip.cards_sold ? ` (${vip.cards_sold}${adminLang === "zh" ? "張" : "장"})` : "";
      $("#settlementVipCardSales").textContent = nt(vip.card_sales_revenue) + soldSuffix;
      $("#settlementVipCardDiscount").textContent = `-${nt(vip.card_discount_given)}`;
      const netEl = $("#settlementVipCardNet");
      netEl.textContent = `${vip.net >= 0 ? "+" : "-"}${nt(Math.abs(vip.net))}`;
      // 적자면 빨강. 사장님이 한눈에 보려는 것이 이 한 줄이다.
      netEl.style.color = vip.net >= 0 ? "var(--ink)" : "var(--red)";
    }

    // ── 3. 무엇이 팔렸나 ─────────────────────────────────────────
    // 분류 이름은 메뉴 관리의 카테고리에서 가져온다 — 결산에만 따로 적어두면
    // 사장님이 이름을 바꿨을 때 여기만 옛 이름으로 남는다.
    const categoryLabel = (key) => {
      if (key === "uncategorized") return T("settlementCategoryNone");
      // VIP 카드 판매는 메뉴가 아니라서 카테고리 목록에 없다 — 그대로 두면
      // 결산에 "vip_card" 라는 날것이 찍힌다.
      if (key === "vip_card") return T("settlementCategoryVipCard");
      const c = (categories || []).find((x) => x.key === key);
      return c ? catName(c) : key;
    };
    renderBars("#settlementCategoryBars", (data.category_breakdown || [])
      .map((e) => ({ name: categoryLabel(e.category_key), value: e.subtotal, count: e.qty, countUnit: T("settlementQtySuffix") })));

    // 품목은 40줄이 넘는다. 다 펼치면 이 표 하나가 화면 절반을 먹어서
    // 아래 것들이 전부 스크롤 밖으로 밀린다 — 위 10개만 두고, 필요할 때
    // 사장님이 펼친다.
    renderSettlementItems(data.item_breakdown || [], false);

    // ── 4. 언제, 어디서 ──────────────────────────────────────────
    // 상위 15개만 보여주므로, 퍼센트는 **하루 매출 전체** 대비여야 한다.
    // 보여준 15개의 합으로 나누면 그 안에서만 100% 가 되어, 실제로는 하루의
    // 20% 인 테이블이 「30%」로 보인다.
    renderBars(
      "#settlementTableBars",
      (data.table_breakdown || [])
        .slice(0, 15)
        .map((e) => ({
          name: e.table_number === "COUNTER" ? T("counterSectionTitle").replace("📦 ", "") : fmtOrderTableTag(e.table_number),
          value: e.revenue,
          count: e.order_count,
        })),
      { total: data.total_revenue }
    );

    // 날짜를 바꾸면 아래 주문 목록도 그 범위로 따라간다.
    loadSettlementOrders();

    renderItemsChart(data.item_breakdown);
    renderTrendChart(data.daily_breakdown || []);
    renderHourlyChart(data.hourly_breakdown || []);
  }

  const fmtOrderTableTag = (n) => (adminLang === "zh" ? `桌號 ${n}` : `${n}번 테이블`);

  // Which single saved day (if any) the 왼쪽 탭 sidebar should currently
  // highlight as "open" — set by loadSettlement() below, read by
  // loadSettlementHistory() when it re-renders. Stays null for a multi-day
  // range (지난 7일 등), since that doesn't correspond to one sidebar row.
  let activeSettlementHistoryDate = null;
  // Which year-month folders the sidebar currently has expanded — persists
  // across re-renders (every loadSettlement() call re-renders the sidebar)
  // so clicking a day in an older month doesn't collapse that month right
  // back on you. null until first render, which seeds it with just the
  // newest month open.
  let openHistoryMonths = null;

  // start/end default to today when omitted. Pass the same date for both to
  // view a single day (e.g. from clicking a row in 지난 정산 기록 — the
  // sidebar to the left of this tab's content, see settlement-shell in
  // admin.html).
  // 결산 화면에 적힌 숫자를 전부 지운다. 「비어 있다」와 「앞사람 것이
  // 남아 있다」는 화면에서 똑같이 생겼지만, 뒤쪽은 틀린 숫자를 믿게 만든다.
  function blankSettlement() {
    lastSettlementData = null;
    currentSettlementDate = null;
    const dash = "—";
    [
      "#settlementRevenue", "#settlementGuests", "#settlementAvgPerGuest",
      "#settlementAvgPerOrder", "#settlementTurnover",
      "#settlementAmRevenue", "#settlementPmRevenue",
    ].forEach((sel) => { const el = $(sel); if (el) el.textContent = dash; });
    [
      "#settlementHeroSub", "#settlementGuestSplit", "#settlementTodayOnly",
      "#settlementAmOrders", "#settlementAmGuests", "#settlementAmPerGuest", "#settlementAmPerOrder",
      "#settlementPmOrders", "#settlementPmGuests", "#settlementPmPerGuest", "#settlementPmPerOrder",
      "#settlementOrdersCount",
    ].forEach((sel) => { const el = $(sel); if (el) el.textContent = ""; });
    [
      "#settlementPaymentMethodBars", "#settlementAlerts", "#settlementOrdersList",
      // 지난 정산 기록 사이드바도 지운다. 직원 화면에서는 CSS 로 숨을 뿐
      // 문서에는 그대로 남는다 — 숨은 것은 지운 것이 아니다.
      "#settlementHistoryList",
    ].forEach((sel) => { const el = $(sel); if (el) el.innerHTML = ""; });
  }

  async function loadSettlement(start, end) {
    const params = new URLSearchParams();
    // 직원 세션은 **날짜를 아예 안 보낸다.** 서버는 직원이 보낸 날짜가
    // 오늘이 아니면 403 으로 거절하는데(src/auth.js requireTodayForStaff),
    // 여기서 굳이 오늘을 계산해 보내면 자정을 넘기는 순간 이 화면의 「오늘」과
    // 서버의 「오늘」이 잠깐 어긋나 멀쩡한 직원이 거절당한다. 안 보내면
    // 서버가 자기 시계로 오늘을 정한다 — 어긋날 자리가 없다.
    const staffToday = currentRole !== "owner";
    if (!staffToday && start) params.set("start", start);
    if (!staffToday && end) params.set("end", end);
    // 「오전만 보기」를 켜둔 채 새로고침해도 그대로 남는다. 날짜를 바꿀
    // 때만 합산으로 되돌린다(settlementDateRangeChanged) — 어제 오후를 보다
    // 오늘로 넘어왔는데 여전히 오후만 보이면 그게 더 헷갈린다.
    if (settlementShift) params.set("shift", settlementShift);
    const qs = params.toString();
    const res = await fetch(qs ? `/api/settlements?${qs}` : "/api/settlements");
    // 못 받아왔으면 **비운다.** 그냥 돌아가면 조금 전 숫자가 그대로 남아,
    // 못 받아온 것을 「지금 값」으로 읽게 된다 (2026-09-11 사장님 화면에
    // 사장님의 일주일치가 남아 있던 것과 같은 종류의 사고다).
    if (!res.ok) {
      blankSettlement();
      return;
    }
    renderSettlement(await res.json());
    activeSettlementHistoryDate = start && end && start === end ? start : null;
    // 지난 정산 기록(추이·월별 폴더)은 사장님 것이다. 직원 세션에서는
    // 부르지 않는다 — 서버가 403 으로 막고 있어 화면은 비지만, 매번 막힐
    // 요청을 보내는 것 자체가 콘솔을 더럽히고 「왜 빈칸이지」를 만든다.
    if (currentRole === "owner") loadSettlementHistory();
  }

  function taipeiTodayString() {
    // Client-side approximation of "today" in Taipei — used only to seed
    // the date pickers' initial values; the server is always the source of
    // truth for what "today" actually is (see loadSettlement()/GET /api/settlements).
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const map = {};
    parts.forEach((p) => (map[p.type] = p.value));
    return `${map.year}-${map.month}-${map.day}`;
  }

  function addDaysToDateString(dateStr, days) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // Year-month label for a settlement-history folder, e.g. "2026-09" ->
  // "2026년 9월" / "2026年9月".
  const fmtHistoryMonthLabel = (ym) => {
    const [y, m] = ym.split("-");
    return adminLang === "zh" ? `${y}年${parseInt(m, 10)}月` : `${y}년 ${parseInt(m, 10)}월`;
  };

  async function loadSettlementHistory() {
    if (currentRole !== "owner") return;
    const res = await fetch("/api/settlements/history");
    if (!res.ok) return;
    const list = await res.json();
    renderHistoryChart(list);
    const el = $("#settlementHistoryList");
    if (!el) return;
    if (list.length === 0) {
      el.innerHTML = `<p class="settings-hint">${T("settlementHistoryEmpty")}</p>`;
      return;
    }
    // Grouped into one collapsible "folder" per year-month instead of one
    // long flat list of every saved day — a few months in, that list was
    // long enough to just scroll past rather than actually browse (owner:
    // "파일 폴더처럼 날짜별로 들어가서 볼 수 있게 해줬으면 좋겠어"), then
    // moved into the left-hand settlement-nav sidebar entirely so clicking
    // a date updates settlement-content right next to it instead of
    // somewhere off-screen above (owner: "누르고 위에가 바뀌는 것도
    // 안보이고 위 아래 왔다갔다 하는 거 별로야 ... 왼쪽 탭 느낌으로").
    // `list` already arrives newest-day-first (GET /api/settlements/history),
    // so the first time a year-month is seen is always its most recent day
    // — a plain Map preserves that insertion order, so months come out
    // newest-first with no extra sort needed.
    const months = new Map();
    list.forEach((s) => {
      const ym = s.date.slice(0, 7);
      if (!months.has(ym)) months.set(ym, { revenue: 0, paidCount: 0, days: [] });
      const g = months.get(ym);
      g.revenue += Number(s.total_revenue || 0);
      g.paidCount += Number(s.paid_order_count || 0);
      g.days.push(s);
    });
    // Which folders are expanded persists in openHistoryMonths across
    // re-renders (this function re-runs after every single settlement
    // load) — seeded once with just the newest month open, and always
    // force-including whichever month the currently active date lives in
    // so clicking a day never immediately re-collapses its own folder.
    if (!openHistoryMonths) openHistoryMonths = new Set([[...months.keys()][0]]);
    if (activeSettlementHistoryDate) openHistoryMonths.add(activeSettlementHistoryDate.slice(0, 7));
    el.innerHTML = [...months.entries()]
      .map(([ym, g]) => {
        const openAttr = openHistoryMonths.has(ym) ? " open" : "";
        return `
          <details class="settlement-history-month" data-ym="${ym}"${openAttr}>
            <summary class="settlement-history-month-summary">📁 ${fmtHistoryMonthLabel(ym)}</summary>
            <div class="settlement-history-month-days">
              ${g.days
                .map((s) => {
                  const day = parseInt(s.date.slice(8, 10), 10);
                  const dayLabel = adminLang === "zh" ? `${day}日` : `${day}일`;
                  // A bare "⚠18" read as ambiguous — could look like a table
                  // number or some other count entirely — so this spells out
                  // what it counts instead of leaning on the icon alone
                  // (owner: "느낌표가 테이블 번호를 나타내려고 하는 거
                  // 같은데 뭔가 오류의 개수를 나타내는 거 같아서 헷갈려").
                  const warn = s.problem_order_count > 0 ? ` · <b class="settlement-history-warn">⚠ ${T("settlementHistoryProblem")} ${s.problem_order_count}</b>` : "";
                  return `
                <button type="button" class="settlement-history-row" data-date="${s.date}">
                  <span class="settlement-history-date">${dayLabel}</span>
                  <span class="settlement-history-row-sub">NT$${Number(s.total_revenue || 0).toLocaleString()}${warn}</span>
                </button>`;
                })
                .join("")}
            </div>
          </details>`;
      })
      .join("");
    $$(".settlement-history-month").forEach((det) => {
      det.addEventListener("toggle", () => {
        if (det.open) openHistoryMonths.add(det.dataset.ym);
        else openHistoryMonths.delete(det.dataset.ym);
      });
    });
    $$(".settlement-history-row").forEach((row) => {
      row.classList.toggle("active", row.dataset.date === activeSettlementHistoryDate);
      row.onclick = () => {
        settlementShift = null;
        loadSettlement(row.dataset.date, row.dataset.date);
      };
    });
  }

  // ── 결산 화면 부품들 (2026-09-10) ────────────────────────────────
  // 사장님: "눈에 딱 들어오지도 않고 뭔가 체계적이지 못한 것 같아."

  // 이름·막대·금액·비중 한 줄짜리. 표 대신 막대를 쓰는 이유는 "현금이
  // 절반쯤"을 숫자를 읽지 않고 알 수 있어서다. 그리고 CSS 막대라서 차트
  // 라이브러리가 못 뜨는 상황(네트워크가 막힌 가게 태블릿 등)에서도 그대로
  // 보인다 — 마감 숫자가 라이브러리 하나에 달려 있으면 안 된다.
  // 막대와 그 옆의 퍼센트는 **같은 것을 말해야 한다.**
  //
  // 사장님(2026-09-11): "지금 결산에 퍼센트가 100%가 아닌데 바가 꽉 차있거든?
  // 그거 왜 그런거야?"
  //
  // 예전에는 둘이 서로 다른 자를 썼다. 퍼센트는 「전체 중 몇 %」였는데 막대는
  // 「1등 대비 몇 %」라서, 그 묶음의 1등은 몇 %든 늘 꽉 찼다. 현금 59% 옆에
  // 꽉 찬 막대가, 직접 입력 47% 옆에도 꽉 찬 막대가 있었다. 눈은 숫자보다
  // 막대를 먼저 읽으므로, 이건 「보기 불편한」 것이 아니라 **틀리게 읽히는**
  // 것이다.
  //
  // 이제 막대도 전체 대비다. 작은 항목이 짧아지는 건 맞지만, 그게 사실이다.
  // 0 이 아닌데 안 보이는 일이 없게 최소 2%만 남긴다.
  //
  // opts.total — 목록을 잘라서 보여줄 때(테이블별 상위 15개) 쓴다. 잘린
  // 목록의 합으로 나누면 그 15개끼리 100% 가 되어, 하루 매출의 절반인
  // 테이블이 「80%」로 보인다.
  function renderBars(selector, rows, opts = {}) {
    const el = $(selector);
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = `<div class="stl-bars-empty">${T("settlementNoData")}</div>`;
      return;
    }
    const total = opts.total != null ? opts.total : rows.reduce((a, r) => a + r.value, 0);
    el.innerHTML = rows
      .map((r) => {
        const share = total > 0 ? (r.value / total) * 100 : 0;
        const pct = Math.round(share);
        const width = share <= 0 ? 0 : Math.min(100, Math.max(2, Math.round(share * 10) / 10));
        const count = r.count != null ? `<span class="stl-bar-count">${r.count}${r.countUnit || T("settlementCountSuffix")}</span>` : "";
        return `
          <div class="stl-bar-row">
            <span class="stl-bar-name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}${count}</span>
            <span class="stl-bar-track">${width > 0 ? `<span class="stl-bar-fill" style="width:${width}%"></span>` : ""}</span>
            <span class="stl-bar-amount">NT$${Number(r.value || 0).toLocaleString()}</span>
            <span class="stl-bar-share">${pct}%</span>
          </div>`;
      })
      .join("");
  }

  // 큰 숫자 아래 한 줄 — "75건 · 9월 9일" 처럼 그 숫자가 무엇의 합인지.
  function fmtSettlementHeroSub(data) {
    const period = data.date
      ? data.date
      : `${data.start_date} ~ ${data.end_date}`;
    return `${period} · ${T("settlementPaidCount")} ${data.paid_order_count}${T("settlementCountSuffix")}`;
  }

  const SETTLEMENT_ITEMS_PREVIEW = 10;
  function renderSettlementItems(items, expanded) {
    const shown = expanded ? items : items.slice(0, SETTLEMENT_ITEMS_PREVIEW);
    $("#settlementItemsBody").innerHTML = shown
      .map(
        (it) => `
          <tr>
            <td>${itemDisplayName(it)}</td>
            <td>${it.qty}</td>
            <td>NT$${it.subtotal.toLocaleString()}</td>
          </tr>`
      )
      .join("");
    const more = $("#settlementItemsMore");
    if (!more) return;
    if (items.length <= SETTLEMENT_ITEMS_PREVIEW) {
      more.hidden = true;
      return;
    }
    more.hidden = false;
    more.textContent = expanded
      ? T("settlementItemsCollapse")
      : `${T("settlementItemsExpand")} (${items.length - SETTLEMENT_ITEMS_PREVIEW})`;
    more.onclick = () => renderSettlementItems(items, !expanded);
  }

  // 블록 안 탭 — 세로로 계속 쌓지 않으려는 것이다. 같은 묶음 안에서만
  // 갈아 끼우므로 그룹(data-tabgroup)별로 따로 다룬다.
  document.querySelectorAll(".stl-tabs").forEach((group) => {
    const block = group.closest(".stl-block");
    group.querySelectorAll(".stl-tab").forEach((btn) => {
      btn.onclick = () => {
        group.querySelectorAll(".stl-tab").forEach((b) => b.classList.toggle("active", b === btn));
        block.querySelectorAll(".stl-pane").forEach((pane) => {
          pane.hidden = pane.dataset.pane !== btn.dataset.pane;
        });
        // 숨겨져 있던 캔버스는 크기가 0이라 그 상태로 그려진 차트가
        // 찌그러져 있다 — 보이게 된 다음 한 번 다시 그린다.
        if (lastSettlementData) {
          if (btn.dataset.pane === "whenHourly") renderHourlyChart(lastSettlementData.hourly_breakdown || []);
          if (btn.dataset.pane === "whenTrend") renderTrendChart(lastSettlementData.daily_breakdown || []);
          if (btn.dataset.pane === "soldItems") renderItemsChart(lastSettlementData.item_breakdown || []);
        }
      };
    });
  });

  // ── 지난 주문 불러오기 (2026-09-10) ──────────────────────────────
  // 사장님: "어느 테이블에서 언제 몇시에 뭐를 시켰고 그런 게 다 기록을
  // 하고 있잖아 우리가. 그래서 ... 나중에 필요할 때 불러올 수 있게."
  //
  // 기록은 이미 다 남고 있었다. 없던 건 꺼내 보는 길뿐이라, 서버의
  // GET /api/orders/history 를 그대로 보여준다. 날짜는 위 결산 범위를
  // 따라가므로, "지난주 금요일"을 고르면 그 날 주문이 여기 뜬다.
  let settlementOrdersExpanded = new Set();

  async function loadSettlementOrders() {
    const listEl = $("#settlementOrdersList");
    const countEl = $("#settlementOrdersCount");
    if (!listEl) return;
    const params = new URLSearchParams();
    const start = $("#settlementStartDate").value;
    const end = $("#settlementEndDate").value;
    // 위에서 오전만 보고 있으면 이 목록도 오전만. 위는 오전 매출인데 아래
    // 목록만 하루치면, 목록을 세어보다가 위 숫자를 의심하게 된다.
    if (settlementShift) params.set("shift", settlementShift);
    // 직원은 날짜를 안 보낸다 — 위 loadSettlement() 와 같은 이유다.
    const staffToday = currentRole !== "owner";
    if (!staffToday && start) params.set("start", start);
    if (!staffToday && end) params.set("end", end);
    const q = $("#settlementOrderSearch").value.trim();
    const table = $("#settlementOrderTable").value.trim();
    const status = $("#settlementOrderStatus").value;
    if (q) params.set("q", q);
    if (table) params.set("table", table);
    if (status) params.set("status", status);

    countEl.textContent = T("settlementOrdersLoading");
    listEl.innerHTML = "";
    let data;
    try {
      const res = await fetch(`/api/orders/history?${params.toString()}`);
      if (!res.ok) throw new Error("failed");
      data = await res.json();
    } catch (e) {
      countEl.textContent = T("settlementOrdersFailed");
      return;
    }
    settlementOrdersExpanded = new Set();
    renderSettlementOrders(data);
  }

  function renderSettlementOrders(data) {
    const listEl = $("#settlementOrdersList");
    const countEl = $("#settlementOrdersCount");
    const orders = data.orders || [];
    countEl.textContent = orders.length
      ? `${orders.length}${T("settlementCountSuffix")}${data.truncated ? T("settlementOrdersTruncated") : ""}`
      : T("settlementOrdersNone");
    listEl.innerHTML = orders
      .map((o) => {
        const time = String(o.created_at || "").slice(11, 16);
        const day = String(o.created_at || "").slice(5, 10);
        // 포장 카운터는 테이블 번호가 없다 — 픽업 번호와 이름으로 부른다.
        const who = o.pickup_number && o.customer_name
          ? `📦 ${o.pickup_number}${T("settlementOrdersPickupSuffix")} ${escapeHtml(o.customer_name)}`
          : fmtOrderTableTag(o.table_number);
        const peek = (o.items || []).map((it) => `${itemDisplayName(it)} x${it.qty}`).join(", ");
        const open = settlementOrdersExpanded.has(o.id);
        return `
          <div class="stl-order${o.status === "cancelled" ? " cancelled" : ""}" data-order-id="${o.id}">
            <div class="stl-order-head" role="button" tabindex="0">
              <span class="stl-order-time">${day} ${time}</span>
              <span class="stl-order-table">${who}</span>
              <span class="stl-order-peek">${escapeHtml(peek)}</span>
              <span class="stl-order-total">NT$${Number(o.total || 0).toLocaleString()}</span>
              <span class="stl-order-actions">
                <button type="button" class="stl-order-btn" data-stl-print="${o.id}">${T("printBtn")}</button>
                <button type="button" class="stl-order-btn" data-stl-preview="${o.id}">${T("previewBtn")}</button>
              </span>
              <span class="stl-order-caret">${open ? "▴" : "▾"}</span>
            </div>
            ${open ? renderSettlementOrderBody(o) : ""}
          </div>`;
      })
      .join("");

    const toggle = (el) => {
      const id = parseInt(el.closest(".stl-order").dataset.orderId, 10);
      if (settlementOrdersExpanded.has(id)) settlementOrdersExpanded.delete(id);
      else settlementOrdersExpanded.add(id);
      renderSettlementOrders(data);
    };
    listEl.querySelectorAll(".stl-order-head").forEach((head) => {
      head.onclick = (e) => {
        // 인쇄·미리보기를 눌렀을 때 줄이 같이 펼쳐지면 안 된다.
        if (e.target.closest(".stl-order-btn")) return;
        toggle(head);
      };
      // <button> 을 <div role="button"> 으로 바꿨다 — 버튼 안에 버튼은 넣을 수
      // 없기 때문이다. 키보드로도 되게 Enter/Space 를 직접 받는다.
      head.onkeydown = (e) => {
        if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
        if (e.target.closest(".stl-order-btn")) return;
        e.preventDefault();
        toggle(head);
      };
    });

    // 지난 주문도 언제든 다시 뽑고 미리 볼 수 있다.
    //
    // 2026-09-11 사장님: "결산탭에서도 인쇄랑 미리보기 그대로 가능하게 해줘.
    // 언제든 예전 것 출력하고 싶거나 영수증 미리보기 하고 싶을 떄 할 수 있게."
    //
    // 실시간 주문판의 카드와 **같은 함수**를 부른다(printKitchenTicket /
    // previewKitchenTicket). 여기만 따로 만들면 빌지 모양이 언젠가 둘로
    // 갈라지고, 그러면 주방에 두 가지 종이가 나간다.
    const byId = new Map(orders.map((o) => [o.id, o]));
    listEl.querySelectorAll("[data-stl-print]").forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const o = byId.get(parseInt(btn.dataset.stlPrint, 10));
        if (!o) return;
        btn.disabled = true;
        try {
          await printKitchenTicket(o);
        } finally {
          btn.disabled = false;
        }
      };
    });
    listEl.querySelectorAll("[data-stl-preview]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const o = byId.get(parseInt(btn.dataset.stlPreview, 10));
        if (o) previewKitchenTicket(o);
      };
    });
  }

  function renderSettlementOrderBody(o) {
    const lines = (o.items || [])
      .map((it) => {
        const extras = [
          it.option_choice,
          it.spice_choice && it.spice_choice !== "基本" ? it.spice_choice : null,
          it.takeout_choice,
          it.order_type === "takeout" ? T("settlementOrderTypeTakeout") : null,
          ...(it.selected_addons || []).map((a) => `+${a.name}`),
        ].filter(Boolean);
        return `
          <div class="stl-order-line">
            <span>${itemDisplayName(it)} <span style="color:var(--muted)">x${it.qty}</span></span>
            <span>NT$${Number((it.unit_price || 0) * (it.qty || 0)).toLocaleString()}</span>
          </div>
          ${extras.length ? `<div class="stl-order-line-sub">└ ${escapeHtml(extras.join(" · "))}</div>` : ""}`;
      })
      .join("");
    // 결제수단·인원수·할인은 나중에 "그때 어떻게 계산했더라"를 확인하는
    // 값들이다. 없으면 그 줄을 아예 안 만든다.
    const meta = [
      o.payment_method ? `${T("settlementOrdersPaidWith")} ${paymentMethodLabelFor(o.payment_method)}` : null,
      o.party_size ? fmtPartyDetail(o) : null,
      o.discount_amount ? `${T("settlementDiscountAmount")} NT$${Number(o.discount_amount).toLocaleString()}` : null,
      o.paid_at ? `${T("settlementOrdersPaidAt")} ${String(o.paid_at).slice(5, 16)}` : null,
      `${T("settlementOrdersStatus")} ${statusLabel(o.status)}`,
    ].filter(Boolean);
    return `<div class="stl-order-body">${lines}<div class="stl-order-meta">${escapeHtml(meta.join(" · "))}</div></div>`;
  }

  const paymentMethodLabelFor = (m) =>
    ({
      cash: T("paymentMethodCash"), linepay: T("paymentMethodLinepay"), card: T("paymentMethodCard"),
      other: T("paymentMethodOther"), online: T("paymentMethodOnline"), unspecified: T("paymentMethodUnspecified"),
    })[m] || m;

  $("#settlementOrderSearchBtn").onclick = loadSettlementOrders;
  $("#settlementOrderSearch").addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadSettlementOrders();
  });
  $("#settlementOrderTable").addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadSettlementOrders();
  });
  $("#settlementOrderStatus").onchange = loadSettlementOrders;

  // 오전/오후 칸을 눌러 그 시간대만 보기 (2026-09-10 사장님 요청).
  //
  // <div> 에 role="button" 을 붙인 이유: 이 칸 안에 <dl> 이 들어 있어서
  // <button> 으로는 못 감싼다(버튼 안에 목록은 유효하지 않은 HTML이다).
  // 그 대신 키보드도 되게 Enter/Space 를 직접 받는다 — 태블릿 옆에 키보드를
  // 꽂아 쓰시는 날이 온다.
  [["#settlementAmBox", "am"], ["#settlementPmBox", "pm"]].forEach(([sel, which]) => {
    const el = $(sel);
    if (!el) return;
    el.onclick = () => toggleSettlementShift(which);
    el.onkeydown = (e) => {
      if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
      e.preventDefault(); // Space 가 화면을 굴려버리지 않게
      toggleSettlementShift(which);
    };
  });
  const shiftReset = $("#settlementShiftReset");
  if (shiftReset) {
    shiftReset.onclick = () => {
      settlementShift = null;
      loadSettlement($("#settlementStartDate").value, $("#settlementEndDate").value);
    };
  }

  function settlementDateRangeChanged() {
    const start = $("#settlementStartDate").value;
    const end = $("#settlementEndDate").value;
    if (!start || !end) return;
    settlementShift = null;
    loadSettlement(start, end);
  }
  $("#settlementStartDate").onchange = settlementDateRangeChanged;
  $("#settlementEndDate").onchange = settlementDateRangeChanged;
  $("#settlementTodayBtn").onclick = () => {
    const today = taipeiTodayString();
    settlementShift = null;
    loadSettlement(today, today);
  };
  $("#settlementWeekBtn").onclick = () => {
    const today = taipeiTodayString();
    settlementShift = null;
    loadSettlement(addDaysToDateString(today, -6), today);
  };
  $("#settlementMonthBtn").onclick = () => {
    const today = taipeiTodayString();
    settlementShift = null;
    loadSettlement(addDaysToDateString(today, -29), today);
  };
  // Builds a spreadsheet-friendly CSV from whatever's currently loaded
  // (summary + item breakdown + unpaid orders) — a UTF-8 BOM is prepended
  // so Excel opens Korean/Chinese text correctly instead of mojibake.
  function csvEscape(v) {
    const s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  // CSV 는 엑셀에서 열어 정리하는 파일이라 화면 언어와 무관하게 한국어로
  // 적는다 — 중국어 화면에서 받은 파일과 한국어 화면에서 받은 파일의 열
  // 이름이 다르면 두 파일을 나란히 놓고 비교할 수가 없다.
  const paymentMethodCsvLabel = (m) =>
    ({ cash: "현금", linepay: "LinePay", card: "신용카드", other: "기타", online: "온라인결제", unspecified: "미지정" })[m] || m;

  function buildSettlementCsv(data) {
    const rows = [];
    rows.push(["결산 기간", data.date || `${data.start_date} ~ ${data.end_date}`]);
    rows.push(["매출(결제완료)", data.total_revenue]);
    rows.push(["결제 완료 주문", data.paid_order_count]);
    rows.push(["취소된 주문", data.cancelled_order_count]);
    rows.push(["미결제/문제 주문", data.problem_order_count]);
    rows.push(["평균 테이블 회전 시간(분)", data.avg_turnover_minutes ?? ""]);
    // 사장님 요청(2026-09-10) — 화면에 보이는 건 CSV 에도 다 들어가야 한다.
    // 엑셀로 따로 정리하실 때 화면과 파일이 다르면 결국 둘 다 못 믿는다.
    rows.push(["할인 전 매출", data.gross_revenue ?? ""]);
    rows.push(["할인해준 금액", data.discount_total ?? 0]);
    rows.push(["취소 금액", data.cancelled_amount ?? 0]);
    rows.push(["미결제 금액", data.problem_amount ?? 0]);
    rows.push(["손님 수", data.guest_count ?? 0]);
    rows.push(["  어른", data.adult_count ?? 0]);
    rows.push(["  아이", data.child_count ?? 0]);
    rows.push(["1인당 평균", data.avg_per_guest ?? 0]);
    rows.push(["주문당 평균", data.avg_per_order ?? 0]);
    rows.push([]);
    rows.push(["결제수단별 집계"]);
    rows.push(["결제수단", "건수", "매출"]);
    (data.payment_method_breakdown || []).forEach((pm) =>
      rows.push([paymentMethodCsvLabel(pm.method), pm.order_count, pm.revenue])
    );
    rows.push(["총합", "", data.payment_method_total ?? 0]);
    rows.push([]);
    rows.push(["매장 / 포장"]);
    rows.push(["구분", "건수", "매출"]);
    (data.order_type_breakdown || []).forEach((e) =>
      rows.push([{ dine_in: "매장", takeout: "포장", mixed: "섞임" }[e.order_type] || e.order_type, e.order_count, e.revenue])
    );
    rows.push([]);
    rows.push(["분류별 매출"]);
    rows.push(["분류", "수량", "소계"]);
    (data.category_breakdown || []).forEach((e) => {
      const c = (categories || []).find((x) => x.key === e.category_key);
      rows.push([c ? catName(c) : e.category_key === "uncategorized" ? "분류 없음" : e.category_key, e.qty, e.subtotal]);
    });
    if ((data.discount_breakdown || []).length) {
      rows.push([]);
      rows.push(["할인 내역"]);
      rows.push(["종류", "건수", "할인액"]);
      data.discount_breakdown.forEach((e) => rows.push([e.discount_type, e.order_count, e.amount]));
    }
    rows.push([]);
    rows.push(["테이블별 매출"]);
    rows.push(["테이블", "건수", "매출"]);
    (data.table_breakdown || []).forEach((e) => rows.push([e.table_number, e.order_count, e.revenue]));
    rows.push([]);
    rows.push(["시간대별"]);
    rows.push(["시간", "주문 건수", "매출"]);
    (data.hourly_breakdown || []).forEach((h) => rows.push([`${h.hour}시`, h.order_count, h.revenue]));
    if ((data.daily_breakdown || []).length > 1) {
      rows.push([]);
      rows.push(["날짜별 매출"]);
      rows.push(["날짜", "매출"]);
      data.daily_breakdown.forEach((d) => rows.push([d.date, d.revenue]));
    }
    rows.push([]);
    rows.push(["품목별 판매 현황"]);
    rows.push(["메뉴", "수량", "소계"]);
    data.item_breakdown.forEach((it) => rows.push([itemDisplayName(it), it.qty, it.subtotal]));
    rows.push([]);
    rows.push(["미결제 주문 상세"]);
    rows.push(["시간", "테이블", "상태", "금액", "주문 내역"]);
    data.problem_orders.forEach((o) =>
      rows.push([o.created_at, o.table_number, statusLabel(o.status), o.total, o.items.map((it) => `${itemDisplayName(it)} x${it.qty}`).join("; ")])
    );
    return "﻿" + rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  }
  $("#settlementCsvBtn").onclick = () => {
    if (!lastSettlementData) return;
    const csv = buildSettlementCsv(lastSettlementData);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const label = lastSettlementData.date || `${lastSettlementData.start_date}_${lastSettlementData.end_date}`;
    a.href = url;
    a.download = `settlement_${label}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  $("#settlementCloseBtn").onclick = async () => {
    if (!currentSettlementDate) return;
    const btn = $("#settlementCloseBtn");
    const original = btn.textContent;
    await fetch("/api/settlements/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: currentSettlementDate }),
    });
    btn.textContent = T("settlementSavedMsg");
    loadSettlementHistory();
    setTimeout(() => (btn.textContent = original), 2000);
  };

  // ---------- Reservations (예약) ----------
  // Visible to any logged-in staff (like the table list) — adding/editing/
  // deleting is gated behind the owner's "예약 추가/수정/삭제" toggle via
  // canManageReservations(), same pattern as menu/table editing.
  let reservations = [];
  let editingReservationId = null;

  function reservationStatusLabel(status) {
    if (status === "cancelled") return adminLang === "zh" ? "已取消" : "취소됨";
    return adminLang === "zh" ? "已確認" : "확정";
  }

  function renderReservations() {
    const el = $("#reservationsList");
    if (!el) return;
    if (reservations.length === 0) {
      el.innerHTML = `<p class="settings-hint">${T("reservationEmpty")}</p>`;
      return;
    }
    el.innerHTML = reservations
      .map((r) => {
        const tableText = r.table_number ? fmtOrderTableTag(r.table_number) : T("reservationNoTable");
        return `
          <div class="reservation-row ${r.status === "cancelled" ? "reservation-cancelled" : ""}" data-id="${r.id}">
            <div class="reservation-when">
              <div class="reservation-date">${r.date}</div>
              <div class="reservation-time">${r.time}</div>
            </div>
            <div class="reservation-info">
              <div class="reservation-name">${r.customer_name} <span class="reservation-party">👥 ${r.party_size}</span></div>
              <div class="reservation-meta">${r.phone || ""} ${r.phone ? "·" : ""} ${tableText}${r.note ? ` · ${r.note}` : ""}</div>
            </div>
            <div class="reservation-status status-${r.status}">${reservationStatusLabel(r.status)}</div>
          </div>`;
      })
      .join("");
    $$(".reservation-row").forEach((row) => {
      if (!canManageReservations()) return;
      row.onclick = () => openReservationModal(parseInt(row.dataset.id, 10));
    });
  }

  async function loadReservations(date) {
    const url = date ? `/api/reservations?date=${encodeURIComponent(date)}` : "/api/reservations";
    const res = await fetch(url);
    if (!res.ok) return;
    reservations = await res.json();
    renderReservations();
  }

  $("#reservationDateFilter").onchange = (e) => loadReservations(e.target.value);
  $("#reservationShowAllBtn").onclick = () => {
    $("#reservationDateFilter").value = "";
    loadReservations();
  };

  function openReservationModal(id) {
    if (!canManageReservations()) return;
    editingReservationId = id || null;
    const r = id ? reservations.find((x) => x.id === id) : null;
    $("#reservationModalTitle").textContent = r ? T("reservationEditTitle") : T("reservationAddTitle");
    $("#r_customer_name").value = r ? r.customer_name : "";
    $("#r_phone").value = r ? r.phone : "";
    $("#r_date").value = r ? r.date : $("#reservationDateFilter").value || taipeiTodayString();
    $("#r_time").value = r ? r.time : "";
    $("#r_party_size").value = r ? r.party_size : "2";
    $("#r_table_number").value = r ? r.table_number || "" : "";
    $("#r_note").value = r ? r.note : "";
    $("#deleteReservationBtn").hidden = !r;
    $("#cancelReservationBtn").hidden = !r || r.status === "cancelled";
    $("#reservationModalBackdrop").hidden = false;
  }
  $("#addReservationBtn").onclick = () => openReservationModal(null);
  $("#reservationModalClose").onclick = () => ($("#reservationModalBackdrop").hidden = true);

  $("#saveReservationBtn").onclick = async () => {
    const payload = {
      customer_name: $("#r_customer_name").value.trim(),
      phone: $("#r_phone").value.trim(),
      date: $("#r_date").value,
      time: $("#r_time").value,
      party_size: $("#r_party_size").value,
      table_number: $("#r_table_number").value.trim() || null,
      note: $("#r_note").value.trim(),
    };
    if (!payload.customer_name || !payload.date || !payload.time) return;
    const url = editingReservationId ? `/api/reservations/${editingReservationId}` : "/api/reservations";
    await fetch(url, {
      method: editingReservationId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    $("#reservationModalBackdrop").hidden = true;
    loadReservations($("#reservationDateFilter").value || undefined);
  };

  $("#cancelReservationBtn").onclick = async () => {
    if (!editingReservationId) return;
    await fetch(`/api/reservations/${editingReservationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    });
    $("#reservationModalBackdrop").hidden = true;
    loadReservations($("#reservationDateFilter").value || undefined);
  };

  $("#deleteReservationBtn").onclick = async () => {
    if (!editingReservationId) return;
    if (!(await showConfirm(T("reservationDeleteConfirm")))) return;
    await fetch(`/api/reservations/${editingReservationId}`, { method: "DELETE" });
    $("#reservationModalBackdrop").hidden = true;
    loadReservations($("#reservationDateFilter").value || undefined);
  };

  applyAdminI18n();
  wireTestMode();
  checkAuth();
})();
