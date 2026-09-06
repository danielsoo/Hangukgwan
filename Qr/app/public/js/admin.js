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
  let storeSettings = {};
  let pollTimer = null;
  let knownOrderIds = new Set();
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
  function applyUiFontScale(v) {
    document.body.style.zoom = v;
    const label = $("#uiFontScaleValue");
    if (label) label.textContent = Math.round(v * 100) + "%";
  }
  function setUiFontScale(v) {
    v = Math.round(v * 10) / 10;
    v = Math.min(UI_FONT_SCALE_MAX, Math.max(UI_FONT_SCALE_MIN, v));
    try {
      localStorage.setItem(UI_FONT_SCALE_KEY, String(v));
    } catch (e) {
      // Private browsing / storage blocked — still applies for this page
      // view, it just won't be remembered on the next visit.
    }
    applyUiFontScale(v);
  }
  applyUiFontScale(getUiFontScale());
  if ($("#uiFontScaleDecBtn")) {
    $("#uiFontScaleDecBtn").onclick = () => setUiFontScale(getUiFontScale() - UI_FONT_SCALE_STEP);
    $("#uiFontScaleIncBtn").onclick = () => setUiFontScale(getUiFontScale() + UI_FONT_SCALE_STEP);
    $("#uiFontScaleResetBtn").onclick = () => setUiFontScale(1);
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
      loginPasswordPlaceholder: "관리자 비밀번호",
      loginBtn: "로그인",
      loginError: "비밀번호가 올바르지 않습니다. 다시 시도해주세요",
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
      onSale: "판매 중",
      soldOut: "품절",
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
      noOrdersYetAdmin: "아직 주문이 없습니다.",
      unpaidTotalLabel: "현재 미결제 합계:",
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
      paymentMethodCashOnlyHint: "선택한 할인은 현금 결제에만 적용돼요.",
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
      settingsCatDisplay: "화면",
      settingsCatStore: "매장 정보",
      settingsCatAccount: "계정",
      settingsCatNotify: "알림",
      settingsCatPayment: "결제",
      settingsCatPrint: "인쇄",
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
      itemOptionsLabel: "옵션 (쉼표로 구분, 예: 소고기,돼지고기)",
      itemOptionsPlaceholder: "옵션이 없으면 비워두세요",
      itemSpiceOptionsLabel: "맵기 옵션 (쉼표로 구분, 예: 안 맵게,보통,맵게)",
      itemSpiceOptionsPlaceholder: "맵기 옵션이 없으면 비워두세요",
      itemAddonsLabel: "추가 옵션 (이름:가격, 쉼표로 구분, 예: 볶음밥 추가:80,사리면 추가:50)",
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
      lineSettingsHint: "매일 밤 마감 시간 이후 그날 매출/미결제 요약을, 아래 등록된 사람에게만 개별로 전송해요 (친구 추가한 모두에게 보내는 게 아니에요).",
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
      settingsCatVip: "회원(VIP) 로그인",
      vipSettingsTitle: "회원(VIP) 구글 로그인 설정 (Firebase)",
      vipSettingsHint:
        "손님이 주문 페이지에서 구글로 로그인해 VIP 카드를 등록하려면 Firebase 프로젝트가 필요해요. 1) Firebase 콘솔(console.firebase.google.com)에서 새 프로젝트를 만들고, 2) Authentication에서 \"Google\" 로그인 방법을 켜고, 3) 웹 앱을 추가한 뒤 나오는 firebaseConfig 코드를 통째로 복사해서 아래에 붙여넣으세요. 추가로 4) 프로젝트 설정 > 서비스 계정에서 \"새 비공개 키 생성\"으로 받은 JSON 파일 내용은 여기가 아니라 배포 서버(Vercel)의 환경변수 FIREBASE_SERVICE_ACCOUNT에 등록해야 해요 (보안 정보라 이 화면에는 넣지 않아요).",
      vipConfigLabel: "firebaseConfig (JSON)",
      vipConfigPlaceholder: '{"apiKey": "...", "authDomain": "...", "projectId": "...", ...}',
      vipConfigNotSet: "아직 설정되지 않았습니다 — 손님은 구글 로그인을 사용할 수 없어요.",
      vipConfigSet: "✔ 설정되어 있습니다.",
      vipConfigInvalid: "⚠ 형식이 올바르지 않아요 (apiKey, projectId가 포함된 JSON이어야 해요).",
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
      tfsItemNote: "메뉴별 요청사항 (└ 비고)",
      tfsItemTakeout: "메뉴별 포장 표시 (└ 포장)",
      tfsTotal: "합계",
      tfsOrderNote: "전체 주문 메모",
      tfsPrintTime: "인쇄 시간",
      tfsSizeColLabel: "크기",
      tfsWeightColLabel: "굵기",
      ticketFontSavedMsg: "저장되었습니다",
      ticketFontResetBtn: "기본값으로",
      staffPasswordLabel: "직원 로그인 비밀번호 재설정 (6자 이상)",
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
      loginPasswordPlaceholder: "管理員密碼",
      loginBtn: "登入",
      loginError: "密碼錯誤，請重新輸入",
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
      onSale: "供應中",
      soldOut: "已售完",
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
      noOrdersYetAdmin: "目前尚無訂單。",
      unpaidTotalLabel: "目前未結帳金額：",
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
      paymentMethodCashOnlyHint: "所選折扣僅適用於現金付款。",
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
      settingsCatDisplay: "顯示",
      settingsCatStore: "店家資訊",
      settingsCatAccount: "帳號",
      settingsCatNotify: "通知",
      settingsCatPayment: "付款",
      settingsCatPrint: "列印",
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
      lineSettingsHint: "每天打烊時間後，只會把當天營業額/未結帳摘要傳送給下方已註冊的人（不是傳送給所有加好友的人）。",
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
      settingsCatVip: "會員(VIP) 登入",
      vipSettingsTitle: "會員(VIP) Google 登入設定（Firebase）",
      vipSettingsHint:
        "要讓顧客在點餐頁面用 Google 登入並註冊 VIP 卡，需要一個 Firebase 專案。1) 到 Firebase 主控台（console.firebase.google.com）建立新專案，2) 在 Authentication 開啟「Google」登入方式，3) 新增網頁應用程式後，把出現的 firebaseConfig 程式碼整段複製貼到下面。另外 4) 在專案設定 > 服務帳戶用「產生新的私密金鑰」取得的 JSON 檔內容，不要貼在這裡，要設定到部署伺服器（Vercel）的環境變數 FIREBASE_SERVICE_ACCOUNT（這是機密資訊，這個畫面不會儲存）。",
      vipConfigLabel: "firebaseConfig (JSON)",
      vipConfigPlaceholder: '{"apiKey": "...", "authDomain": "...", "projectId": "...", ...}',
      vipConfigNotSet: "尚未設定 — 顧客目前無法使用 Google 登入。",
      vipConfigSet: "✔ 已設定。",
      vipConfigInvalid: "⚠ 格式不正確（必須是包含 apiKey、projectId 的 JSON）。",
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
      tfsItemNote: "單品要求（└ 備註）",
      tfsItemTakeout: "單品外帶標示（└ 外帶）",
      tfsTotal: "合計",
      tfsOrderNote: "整單備註",
      tfsPrintTime: "列印時間",
      tfsSizeColLabel: "大小",
      tfsWeightColLabel: "粗細",
      ticketFontSavedMsg: "已儲存",
      ticketFontResetBtn: "恢復預設值",
      staffPasswordLabel: "重設員工登入密碼（至少 6 碼）",
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
  const fmtPartyCount = (n) => (adminLang === "zh" ? `👥 ${n} 位` : `👥 ${n}인`);
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
  const fmtPrintFailBanner = (n, tableNumbers) => {
    const tables = tableNumbers.join(", ");
    return adminLang === "zh"
      ? `⚠️ ${n} 張出單可能沒印出來（桌號：${tables}）— 出單機沒紙、沒連線、或彈出視窗被瀏覽器擋下都可能造成這樣，請確認廚房收到，或按該筆訂單的「列印」重新送出。`
      : `⚠️ 빌지 ${n}건이 제대로 안 나갔을 수 있어요 (테이블: ${tables}) — 프린터 용지 부족, 연결 끊김, 브라우저 팝업 차단 등이 원인일 수 있어요. 주방에 실제로 전달됐는지 확인하거나, 해당 주문의 "인쇄" 버튼으로 다시 보내주세요.`;
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
  // 결제 방식 팝업(showPaymentMethodPopup)에 보여줄 한 줄 요약 — 실제
  // 반영 금액은 항상 서버가 다시 계산해서 저장하므로(아래
  // discountEligibleClientTotal 주석 참고) 이건 미리보기용.
  function fmtPaymentSummary(total, discountType, discountAmount) {
    if (!discountType) {
      return adminLang === "zh" ? `本次結帳合計 NT$${total}` : `이번 결제 합계 NT$${total}`;
    }
    const label = VIP_DISCOUNT_LABELS[discountType] || "";
    const payable = total - discountAmount;
    return adminLang === "zh"
      ? `本次結帳合計 NT$${total} → ${label}折扣 -NT$${discountAmount}（飲料、酒類不適用）→ 實收 NT$${payable}`
      : `이번 결제 합계 NT$${total} → ${label} 할인 -NT$${discountAmount} (음료·주류 제외) → 실수령 NT$${payable}`;
  }
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
    };
  });

  // ---------- Auth ----------
  async function checkAuth() {
    const res = await fetch("/api/auth/me");
    const data = await res.json();
    if (data.isAdmin) {
      currentRole = data.role || "owner";
      staffPermissions = data.permissions || staffPermissions;
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
      // Same for the owner-only 결산 탭 — bounce staff back to 실시간 주문.
      const settlementTab = $('.admin-tabs button[data-tab="settlement"]');
      if (settlementTab && settlementTab.classList.contains("active")) {
        settlementTab.classList.remove("active");
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
    await Promise.all([loadOrders(), loadMenu(), loadTables(), loadSettings(), loadTicketFontSizes()]);
    // loadOrders() and loadTables() run concurrently above, so the order
    // queue's very first render can land before `tables` is populated —
    // harmless before this feature, but renderOrderCard now looks up
    // is_counter on `tables` to label 포장 카운터 orders, so re-render once
    // both are guaranteed to be in.
    renderOrders();
    if (currentRole === "owner") {
      loadStaffPermissions();
      loadLineSettings();
      loadPaymentSettings();
      loadEscposSettings();
    }
    startPolling();
  }

  $("#loginBtn").onclick = doLogin;
  $("#loginPassword").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLogin();
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
      await checkAuth();
    } else {
      $("#loginError").textContent = T("loginError");
      $("#loginError").hidden = false;
    }
  }

  $("#logoutBtn").onclick = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    stopPolling();
    showLogin();
  };

  // ---------- Tabs ----------
  $$(".admin-tabs button").forEach((btn) => {
    btn.onclick = () => {
      if ((btn.dataset.tab === "settlement" || btn.dataset.tab === "vip") && currentRole !== "owner") return;
      $$(".admin-tabs button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      $$(".tab-panel").forEach((p) => (p.hidden = true));
      $(`#tab-${btn.dataset.tab}`).hidden = false;
      if (btn.dataset.tab === "settlement") loadSettlement();
      if (btn.dataset.tab === "reservations") loadReservations();
      if (btn.dataset.tab === "vip") loadVipCards();
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

  // ---------- Live orders (polling — no persistent server connection
  // needed, so this works the same on Vercel, Railway, or a laptop) ----------
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(loadOrders, 4000);
  }
  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function playBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.55);
    } catch (e) {
      /* ignore autoplay restrictions */
    }
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
  $("#soundToggle").onchange = (e) => {
    soundOn = e.target.checked;
    writeStoredToggle("hg_admin_soundOn", soundOn);
    flashToggleSaved();
  };
  $("#autoPrintToggle").onchange = (e) => {
    autoPrintOn = e.target.checked;
    writeStoredToggle("hg_admin_autoPrintOn", autoPrintOn);
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

    const isFirstLoad = orders.length === 0 && knownOrderIds.size === 0;
    const newlyArrived = fresh.filter((o) => !knownOrderIds.has(o.id) && o.status === "new");

    orders = fresh;
    knownOrderIds = new Set(fresh.map((o) => o.id));
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

    if (!isFirstLoad && newlyArrived.length > 0) {
      newlyArrived.forEach((o) => flashNewOrder(o.id));
      if (soundOn) playBeep();
      if (autoPrintOn) {
        Promise.all(newlyArrived.map((o) => printKitchenTicket(o))).then(renderOrders);
      }
    }
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

  // Quick AM/PM settlement check, right inside 실시간주문 (2026-09 피드백:
  // "오전장사 끝나고 정산버튼/저녁장사끝나고 정산버튼 눌러서 합계 확인 가능하게") —
  // sums today's already-loaded `orders` (paid status, updated_at in the
  // given hour range) without a separate API round-trip. This is a quick
  // on-the-spot total, not a replacement for the full 결산 탭 (which has the
  // permanent nightly snapshot, item breakdown, etc.).
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
  $("#settleAmBtn").onclick = () => {
    const { count, total } = computeHalfDaySettlement(0, 11);
    showAlert(
      adminLang === "zh"
        ? `🌅 今日上午（00:00–11:59）已結帳 ${count} 筆，合計 NT$${total}`
        : `🌅 오늘 오전(00:00~11:59) 결제 ${count}건, 합계 NT$${total}`
    );
  };
  $("#settlePmBtn").onclick = () => {
    const { count, total } = computeHalfDaySettlement(12, 23);
    showAlert(
      adminLang === "zh"
        ? `🌙 今日下午（12:00–23:59）已結帳 ${count} 筆，合計 NT$${total}`
        : `🌙 오늘 오후(12:00~23:59) 결제 ${count}건, 합계 NT$${total}`
    );
  };

  const NEXT_STATUS = { new: "preparing", preparing: "served", served: "paid" };
  const statusLabel = (s) => T("status" + s.charAt(0).toUpperCase() + s.slice(1));
  const nextLabel = (s) => T("next" + s.charAt(0).toUpperCase() + s.slice(1));

  function renderOrders() {
    const cols = { new: [], preparing: [], served: [], paid: [] };
    orders.forEach((o) => {
      if (cols[o.status]) cols[o.status].push(o);
    });

    // 결제완료 칼럼은 오늘 결제된 주문만 보여준다 (2026-09 피드백) — 그 전에는
    // 전체 기간이 다 쌓여서 어제/그제 결제 건까지 계속 보였다. 지난 날짜의
    // 결제 내역은 테이블 상세 > 이전 주문 탭이나 결산 탭에서 계속 확인 가능.
    const todayLocalStr = localDateStr(new Date());
    cols.paid = cols.paid.filter((o) => localDateStr(new Date(o.updated_at.replace(" ", "T"))) === todayLocalStr);

    // 결제완료 칼럼은 같은 테이블의 과거 결제 기록이 계속 쌓이면 헷갈리므로,
    // 테이블당 가장 최근에 결제된 주문 1건만 보여준다. 나머지 이력은
    // 테이블 상세 > 이전 주문 탭에서 계속 확인 가능하다.
    const latestPaidByTable = new Map();
    cols.paid.forEach((o) => {
      const existing = latestPaidByTable.get(o.table_number);
      if (!existing || new Date(o.updated_at.replace(" ", "T")) > new Date(existing.updated_at.replace(" ", "T"))) {
        latestPaidByTable.set(o.table_number, o);
      }
    });
    cols.paid = [...latestPaidByTable.values()].sort(
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

  // Reads the column's final DOM order back out and persists it — both to
  // the server and into the in-memory `orders` array (so an intervening
  // renderOrders() call, e.g. the next 4-second poll landing before the
  // PATCH resolves, doesn't visually snap back: renderOrders() rebuilds
  // each column by iterating `orders` in its current array order, so the
  // array itself needs to reflect the drop too, not just the field the
  // server will eventually re-sort by).
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
          const ok = await updateOrderStatus(o.id, targetStatus);
          if (!ok) {
            // The server rejected it — undo the optimistic change instead of
            // silently leaving the card wherever it was dropped, so staff
            // get a clear reason instead of watching it quietly snap back.
            o.status = previousStatus;
            await showAlert(T("orderStatusChangeFailed"));
          }
          await loadOrders(); // re-renders with the server's fresh state, no need to also renderOrders() below
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
  function renderPrintFailureBanner() {
    const banner = $("#printFailBanner");
    if (!banner) return;
    if (printFailedOrderIds.size === 0) {
      banner.hidden = true;
      return;
    }
    const tableNumbers = orders
      .filter((o) => printFailedOrderIds.has(o.id))
      .map((o) => o.table_number);
    banner.textContent = fmtPrintFailBanner(printFailedOrderIds.size, tableNumbers);
    banner.hidden = false;
  }

  function renderOrderCard(o) {
    const card = document.createElement("div");
    card.className = "order-card" + (printFailedOrderIds.has(o.id) ? " print-failed" : "");
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
      const label = `${it.code ? `${it.code} ` : ""}${itemName(it)} x${it.qty}${it.option_choice ? `(${optionLabel(it.option_choice)})` : ""}`;
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
    const printFailedNotice = printFailedOrderIds.has(o.id)
      ? `<div class="order-card-print-fail">${T("printFailedCardMsg")}</div>`
      : "";
    // 포장 카운터 orders aren't a real table — "테이블 COUNTER" would be
    // meaningless to staff, so show its pickup number + name instead.
    const tableTag = isCounterOrder(o) ? fmtCounterOrderTag(o) : `${T("tableLabel")} ${o.table_number}`;
    card.innerHTML = `
      <div class="order-card-top">
        <span>${tableTag}${typeBadge}</span>
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
      btn.onclick = (e) => {
        e.stopPropagation();
        updateOrderStatus(o.id, NEXT_STATUS[o.status]);
      };
      actions.appendChild(btn);
    }
    if (o.status !== "cancelled" && o.status !== "paid" && canCancelOrder()) {
      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = T("cancelBtn");
      cancelBtn.onclick = async (e) => {
        e.stopPropagation();
        if (await showConfirm(T("confirmCancelOrder"))) updateOrderStatus(o.id, "cancelled");
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
    itemNote: 13, // └ 備註 (customer note) line under a dish
    itemTakeout: 13, // └ 外帶 line under a dish ordered as takeout
    total: 16, // 合計 row
    orderNote: 11, // 訂單備註 (whole-order note) line
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
    itemNoteWeight: 400,
    itemTakeoutWeight: 900,
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
  function buildTicketHtml(o, fontSizes, opts) {
    const fs = Object.assign({}, DEFAULT_TICKET_FONT_SIZES, fontSizes || {});
    const screenPreview = !opts || opts.screenPreview !== false;
    const time = new Date(o.created_at.replace(" ", "T")).toLocaleString("zh-TW");
    const storeName = (storeSettings && (storeSettings.store_name_zh || storeSettings.store_name_ko)) || "한국관";

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
        // 매장(dine-in) is this dish's default and stays implicit — only
        // 外帶(takeout) is called out per-dish, since that's the one that
        // changes how the kitchen has to send it out. See the file-level
        // comment above for why this exists even when the order-level badge
        // already says takeout/mixed.
        if (it.order_type === "takeout") detailLines.push(`<div class="item-detail item-takeout">└ 外帶</div>`);
        if (it.note) detailLines.push(`<div class="item-detail item-note">└ 備註：${it.note}</div>`);
        return `<div class="item-row">
          <div class="item-main"><span class="item-name">${name}</span><span class="item-qty">x${it.qty}</span></div>
          ${detailLines.join("")}
        </div>`;
      })
      .join("");

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
  .item-note { font-size: ${fs.itemNote}px; font-weight: ${fs.itemNoteWeight}; color: #c0161f; }
  .item-takeout { font-size: ${fs.itemTakeout}px; font-weight: ${fs.itemTakeoutWeight}; color: #000; }
  .total-row { display: flex; justify-content: space-between; font-size: ${fs.total}px; font-weight: ${fs.totalWeight}; margin-top: 2mm; padding-top: 2mm; border-top: 1px dashed #000; }
  .order-note { font-size: ${fs.orderNote}px; font-weight: ${fs.orderNoteWeight}; color: #c0161f; margin-top: 2mm; }
  .print-time { text-align: center; font-size: ${fs.printTime}px; font-weight: ${fs.printTimeWeight}; color: #555; margin-top: 3mm; }
  ${screenChromeCss}
</style>
</head><body>
  <div class="receipt">
    <div class="header"><div class="store-name">${storeName} 廚房出單</div></div>
    <div class="divider"></div>
    <div class="meta-row"><span class="table-no">${
      isCounterOrder(o)
        ? o.pickup_number && o.customer_name
          ? `📦 ${o.pickup_number}號 · ${o.customer_name}`
          : "外帶櫃檯"
        : `桌號 ${o.table_number}`
    }</span><span class="order-type-badge">${orderTypeLabel(o)}</span></div>
    ${isCounterOrder(o) && o.customer_phone ? `<div class="meta-row"><span class="order-time">☎ ${o.customer_phone}</span></div>` : ""}
    <div class="meta-row"><span class="order-time">${time}</span></div>
    <div class="divider"></div>
    ${itemRows}
    <div class="total-row"><span>合計</span><span>NT$${o.total}</span></div>
    ${o.note ? `<div class="order-note">訂單備註：${o.note}</div>` : ""}
    <div class="print-time">列印時間：${new Date().toLocaleString("zh-TW")}</div>
  </div>
</body></html>`;
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
  function markPrintFailed(orderId) {
    printFailedOrderIds.add(orderId);
  }
  function markPrintSucceeded(orderId) {
    printFailedOrderIds.delete(orderId);
  }

  async function printKitchenTicket(o) {
    // If ESC/POS auto-print is turned on and QZ Tray is reachable on this
    // computer, this sends the ticket straight to the physical printer with
    // no dialog at all and we're done. Any failure here (feature off, QZ
    // Tray not running, printer name mismatch, etc.) falls straight through
    // to the normal browser-print flow below, so printing is never silently
    // lost either way.
    if (await tryPrintViaEscPos(o)) {
      markPrintSucceeded(o.id);
      return;
    }

    // Second rung of the same fallback ladder: on a computer with no QZ
    // Tray running this does nothing (disabled by default / no RawBT app
    // there to catch the intent), but on the Android tablet this is what
    // actually delivers a silent, no-dialog print — see tryPrintViaRawBt()
    // below and the "RawBT 자동 인쇄" settings card.
    if (await tryPrintViaRawBt(o)) {
      markPrintSucceeded(o.id);
      return;
    }

    const win = window.open("", "_blank");
    if (!win) {
      markPrintFailed(o.id);
      return;
    }
    win.document.open();
    win.document.write(buildTicketHtml(o, ticketFontSizes));
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
    markPrintSucceeded(o.id);
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
    win.document.write(buildTicketHtml(o, ticketFontSizes));
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
    itemNote: "tfsItemNote",
    itemTakeout: "tfsItemTakeout",
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
    itemNoteWeight: "tfsItemNoteWeight",
    itemTakeoutWeight: "tfsItemTakeoutWeight",
    totalWeight: "tfsTotalWeight",
    orderNoteWeight: "tfsOrderNoteWeight",
    printTimeWeight: "tfsPrintTimeWeight",
  };

  // A small sample order for the live actual-size preview in the settings
  // card — deliberately touches every element a real ticket can have (two
  // dishes, a meat-type choice, a spice-level choice, a per-dish note, a
  // takeout dish, and a whole-order note) so every font-size field's effect
  // is visible in the preview at once.
  function sampleTicketOrderForPreview() {
    return {
      table_number: "7",
      // "mixed" + one takeout item below, so this preview also shows what
      // the per-dish 外帶 sub-line (see buildTicketHtml's detailLines) looks
      // like at whatever font sizes the owner is trying out.
      order_type: "mixed",
      created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      total: 780,
      note: "餐具x3",
      items: [
        { name_zh: "石鍋拌飯", qty: 1, option_choice: "牛", spice_choice: "中辣", order_type: "dine_in" },
        { name_zh: "辣炒年糕", qty: 2, option_choice: null, spice_choice: null, note: "不要洋蔥", order_type: "takeout" },
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
  function updateTicketFontPreview() {
    const frame = $("#ticketFontPreviewFrame");
    if (!frame) return;
    frame.srcdoc = buildTicketHtml(sampleTicketOrderForPreview(), readTicketFontInputs(), { screenPreview: false });
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
  async function updateOrderStatus(id, status, paymentMethod, vipDiscountType) {
    const body = { status };
    if (paymentMethod) body.paymentMethod = paymentMethod;
    if (vipDiscountType) body.vipDiscountType = vipDiscountType;
    const res = await fetch(`/api/orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok; // callers that optimistically updated the UI (e.g. drag-to-change-status) need to know if it should be undone
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
  async function splitPayOrderItems(id, itemIndexes, paymentMethod, vipDiscountType) {
    const reqBody = { itemIndexes };
    if (paymentMethod) reqBody.paymentMethod = paymentMethod;
    if (vipDiscountType) reqBody.vipDiscountType = vipDiscountType;
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
    const detailTableTag = isCounterOrder(o) ? fmtCounterOrderTag(o) : `${T("tableLabel")} ${o.table_number}`;
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

    const editTableTag = isCounterOrder(order) ? fmtCounterOrderTag(order) : `${T("tableLabel")} ${order.table_number}`;
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
          <td><span class="availability-pill ${item.available ? "on" : "off"}">${item.available ? T("onSale") : T("soldOut")}</span></td>
          <td>${moveButtonsHtml}</td>
        `;
        // Staff without menuEdit can look at the menu but not open the edit
        // modal (server would 403 the save/delete anyway; this just avoids
        // showing a form they can't actually use).
        if (canMenuEdit()) tr.onclick = () => openItemModal(item);
        else tr.style.cursor = "default";
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

  function openItemModal(item) {
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
    $("#f_addons").value = item?.addons || "";
    $("#f_min_first_order_qty").value = item?.min_first_order_qty || "";
    $("#f_is_spicy").checked = !!item?.is_spicy;
    $("#f_is_signature").checked = !!item?.is_signature;
    $("#f_available").checked = item ? !!item.available : true;
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
      addons: $("#f_addons").value.trim() || null,
      min_first_order_qty: parseInt($("#f_min_first_order_qty").value, 10) || null,
      is_spicy: $("#f_is_spicy").checked,
      is_signature: $("#f_is_signature").checked,
      available: $("#f_available").checked,
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
      // Only shown while the table actually has an order in flight — a
      // party size registered on an otherwise-empty table is stale data
      // (see the party_size auto-clear in src/routes/orders.js's PATCH
      // handler) and showing it here would make an empty table look
      // occupied, exactly the "비어있음인데 인원수가 남아있다" bug reported.
      const partyBadge = t.party_size && unpaid.length > 0 ? `<div class="table-party-badge">${fmtPartyCount(t.party_size)}</div>` : "";
      const delBtn = canTableEdit() && !mergePayMode ? `<button class="del-btn" title="${T("tableDelTitle")}">✕</button>` : "";
      const mergeCheckbox = mergePayMode && unpaid.length > 0 ? `<div class="merge-checkbox">${mergePaySelected.has(t.number) ? "✓" : ""}</div>` : "";
      chip.innerHTML = `${delBtn}${mergeCheckbox}<div class="num">${t.label || t.number}</div>${partyBadge}${badge}`;
      if (canTableEdit() && !mergePayMode) {
        chip.querySelector(".del-btn").onclick = async (e) => {
          e.stopPropagation();
          if (!(await showConfirm(fmtConfirmDeleteTable(t.number)))) return;
          await fetch(`/api/tables/${t.id}`, { method: "DELETE" });
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
    // Same "only while actually occupied" rule as the table-list badge above.
    const partyText = table && table.party_size && unpaidOrders.length > 0 ? ` · ${fmtPartyCount(table.party_size)}` : "";
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
    const header = `
      <h2>${titleText}${partyText}</h2>
      <div style="margin-top:-6px;">
        <p style="color:var(--muted);font-size:15px;margin:0;">${T("unpaidTotalLabel")} <strong>NT$${unpaidTotal}</strong></p>
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
    const footerPayBtn = isCounterTable
      ? ""
      : footerSelections.length > 0
      ? `<button class="primary-btn pay-selected-items-btn" style="padding:8px 16px;font-size:15px;">${T("paySelectedBtn")} (NT$${footerSelectedTotal})</button>`
      : `<button class="primary-btn" disabled style="padding:8px 16px;font-size:15px;opacity:0.4;cursor:not-allowed;">${T("paySelectedBtn")}</button>`;
    // 特約95折/VIP9折 토글 — 처음엔 여기 footer에 따로 한 줄로 뒀는데,
    // 사장님 피드백(2026-09-06, 스크린샷과 함께): "할인 위치를 가장 아래
    // 수정 같은 수평선 오른쪽으로 넣어줘" — footer가 아니라 각 라운드
    // 자신의 "수정" 버튼과 같은 줄로 옮겼다(위 buildOrderRoundParts의
    // vipDiscountToggleHtml, renderTableOrderBlock/renderMergedOrderGroup
    // 참고). 라운드가 여러 개여도 모두 같은 테이블 전체 값을 공유해서
    // 보여주므로 footer에 따로 둘 필요가 없다.
    const footer = tableDetailView === "active" && activeOrders.length
      ? `
        <div style="display:flex;justify-content:space-between;align-items:center;border-top:2px solid var(--ink);margin-top:4px;padding-top:12px;">
          <p style="font-size:16px;margin:0;">${T("unpaidTotalLabel2")} <strong>NT$${unpaidTotal}</strong></p>
          ${footerPayBtn}
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
          if (toStatus === "paid") {
            const o = tableOrders.find((x) => x.id === orderId);
            const discountType = counterVipDiscountTypeByOrderId.get(orderId) || null;
            const eligible = discountType && o ? discountEligibleClientTotal(o) : 0;
            const discountAmount = discountType ? computeVipDiscountClient(discountType, eligible) : 0;
            const method = await showPaymentMethodPopup(fmtPaymentSummary(o ? o.total : 0, discountType, discountAmount), !!discountType);
            if (!method) return;
            const ok = await updateOrderStatus(orderId, toStatus, method, discountType);
            if (!ok) {
              await showAlert(T("paySelectedFailedMsg"));
              return;
            }
            counterVipDiscountTypeByOrderId.delete(orderId);
          } else {
            await updateOrderStatus(orderId, toStatus);
          }
          await loadOrders();
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
          // 않는다. 할인은 "테이블 전체 단위"(tableVipDiscountType)라
          // 이 footer 버튼 하나에만 있다.
          const discountType = tableVipDiscountType;
          const eligible = discountType ? selections.reduce((s, x) => s + discountEligibleClientTotal(x.order, x.indexes), 0) : 0;
          const discountAmount = discountType ? computeVipDiscountClient(discountType, eligible) : 0;
          const method = await showPaymentMethodPopup(fmtPaymentSummary(total, discountType, discountAmount), !!discountType);
          if (!method) return;
          const results = await Promise.all(selections.map((x) => splitPayOrderItems(x.order.id, x.indexes, method, discountType)));
          if (results.some((r) => !r.ok)) {
            await showAlert(T("paySelectedFailedMsg"));
          }
          tableVipDiscountType = null; // 결제가 끝났으니 다음 결제를 위해 리셋
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
  // 特約95折/VIP9折 중 하나만 고를 수 있는 토글 버튼 두 개 — 같은 걸 다시
  // 누르면 해제(미선택으로). scope는 클릭 핸들러가 어느 대상(테이블
  // 전체는 "table", 포장 카운터 라운드는 그 주문 id)에 적용할지 구분하는
  // 값으로, data 속성에 그대로 실어둔다.
  function renderVipDiscountToggle(currentType, scope) {
    const btn = (type) => {
      const active = currentType === type;
      return `<button type="button" data-vip-discount-btn="${type}" data-vip-discount-scope="${scope}" style="padding:6px 10px;font-size:13px;white-space:nowrap;border-radius:6px;border:1px solid ${active ? "var(--red)" : "var(--line)"};background:${active ? "var(--red)" : "#fff"};color:${active ? "#fff" : "var(--ink)"};cursor:pointer;">${VIP_DISCOUNT_LABELS[type]}</button>`;
    };
    return `<div style="display:flex;gap:6px;">${btn("te95")}${btn("vip9")}</div>`;
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
          <span style="display:flex;align-items:flex-start;">${checkboxHtml}<span>${it.code ? `${it.code} ` : ""}${itemName(it)}${it.option_choice ? ` (${optionLabel(it.option_choice)})` : ""} x${it.qty}${paidBadgeHtml}${it.order_type === "takeout" ? ` <span class="order-card-type-badge takeout">${T("orderCardTakeoutBadge")}</span>` : ""}${(it.selected_addons || []).length ? `<br/><small style="color:var(--muted);font-size:14px;">+${it.selected_addons.map((a) => a.name).join(", ")}</small>` : ""}${it.note ? `<br/><small style="color:var(--muted);font-size:14px;">${T("memoLabel")}: ${it.note}</small>` : ""}</span></span>
          <span>NT$${lineTotalOf(it)}</span>
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
        ? renderVipDiscountToggle(counterVipDiscountTypeByOrderId.get(o.id) || null, String(o.id))
        : renderVipDiscountToggle(tableVipDiscountType, "table");
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
    return { time, identityLineHtml, timeStatusLineHtml, nextBtn, editBtn, vipDiscountToggleHtml, itemsHtml, itemsToggleHtml, noteHtml, dismissBtn, roundSelectAllHtml, total: remainingAmountOf(o) };
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
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px;">${p.nextBtn}${p.editBtn}${p.vipDiscountToggleHtml}</div>
          <div style="text-align:right;font-weight:700;font-size:16px;padding-top:8px;border-top:1px solid var(--line);">${T("subtotalLabel")} NT$${p.total}</div>
          <div style="text-align:right;font-weight:800;font-size:17px;color:var(--red);margin-top:10px;padding-top:10px;border-top:1px solid var(--line);">${T("totalLabel")} NT$${o.total}</div>
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
    const roundsHtml = orders
      .map((o, i) => {
        const p = buildOrderRoundParts(o, false);
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
            <div style="display:flex;align-items:center;justify-content:${p.editBtn || p.vipDiscountToggleHtml ? "space-between" : "flex-end"};gap:8px;margin-top:8px;">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">${p.editBtn}${p.vipDiscountToggleHtml}</div>
              <div style="text-align:right;font-weight:700;font-size:15px;">${T("subtotalLabel")} NT$${p.total}</div>
            </div>
          </div>
        `;
      })
      .join("");
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
    // 항상 "전체 합계"를 유지한다.
    const grandTotal = orders.reduce((s, o) => s + o.total, 0);
    const grandTotalHtml = `<div style="text-align:right;font-weight:800;font-size:17px;color:var(--red);margin-top:10px;padding-top:10px;border-top:1px solid var(--line);">${T("totalLabel")} NT$${grandTotal}</div>`;
    return `<div class="table-order-block">${roundsHtml}${grandTotalHtml}</div>`;
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
      <span>${t.label || t.number}</span>${t.party_size && unpaid.length > 0 ? `<span class="tb-party">👥${t.party_size}</span>` : ""}
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
          btn.textContent = t.label || t.number;
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
            tableEl.style.left = nextLeft + "px";
            tableEl.style.top = top + "px";
            tableEl.style.width = w + "px";
            tableEl.style.height = h + "px";
            tableEl.innerHTML = `
              <span>${t.label || t.number}</span>${t.party_size && bundledOrders.length > 0 ? `<span class="tb-party">👥${t.party_size}</span>` : ""}
            `;
            tableEl.onclick = () => openTableDetail(t.number, t.label);
            zoneEl.appendChild(tableEl);
            nextLeft += w + gap;
          }

          takeoutOrders.forEach((o) => {
            const tileEl = document.createElement("div");
            tileEl.className = "table-block has-order takeout-order-tile";
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

  $("#mergePayModeBtn").onclick = () => {
    mergePayMode = !mergePayMode;
    mergePaySelected = new Set();
    $("#mergePayModeBtn").classList.toggle("active", mergePayMode);
    $("#mergePayHint").hidden = !mergePayMode;
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
        btn.textContent = t.label || t.number;
        btn.onclick = () => {
          window.open(`/t/${encodeURIComponent(t.number)}`, "_blank");
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

  async function loadSettings() {
    const res = await fetch("/api/settings");
    const s = await res.json();
    storeSettings = s;
    $("#s_store_name_zh").value = s.store_name_zh || "";
    $("#s_store_name_ko").value = s.store_name_ko || "";
    $("#s_store_name_en").value = s.store_name_en || "";
    $("#s_store_phone").value = s.store_phone || "";
    $("#s_store_address_zh").value = s.store_address_zh || "";
    $("#s_store_address_ko").value = s.store_address_ko || "";
    $("#s_store_address_en").value = s.store_address_en || "";
    $("#s_store_hours").value = s.store_hours || "";
    $("#s_store_min_spend").value = s.store_min_spend || "";
    $("#s_store_notice").value = s.store_notice || "";
    $("#s_order_radius_m").value = s.order_radius_m || "200";
    currentStoreLat = s.store_lat || "";
    currentStoreLng = s.store_lng || "";
    renderLocationStatus();
    renderMiniHeroPreview(s);
    $("#s_taegeuk_season_mode").value = s.taegeuk_season_mode || "auto";
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
  function renderVipConfigStatus(raw) {
    const el = $("#vipConfigStatus");
    if (!el) return;
    if (!raw || !raw.trim()) {
      el.textContent = T("vipConfigNotSet");
      el.style.color = "";
      return;
    }
    try {
      const cfg = JSON.parse(raw);
      if (cfg && cfg.apiKey && cfg.projectId) {
        el.textContent = T("vipConfigSet");
        el.style.color = "#1a8a44";
      } else {
        el.textContent = T("vipConfigInvalid");
        el.style.color = "#b5232c";
      }
    } catch (e) {
      el.textContent = T("vipConfigInvalid");
      el.style.color = "#b5232c";
    }
  }

  $("#saveVipSettingsBtn").onclick = async () => {
    const raw = $("#vipFirebaseConfigInput").value.trim();
    const msg = $("#vipSettingsMsg");
    if (raw) {
      try {
        JSON.parse(raw);
      } catch (e) {
        msg.style.color = "#b5232c";
        msg.textContent = T("vipConfigInvalidJson");
        msg.hidden = false;
        setTimeout(() => (msg.hidden = true), 3000);
        return;
      }
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
      order_radius_m: $("#s_order_radius_m").value.trim(),
      taegeuk_season_mode: $("#s_taegeuk_season_mode").value,
    };
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (window.applyTaegeukSeason) window.applyTaegeukSeason(payload.taegeuk_season_mode);
    const msg = $("#settingsMsg");
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

  $("#logoPhotoInput").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("photo", file);
    const msg = $("#logoMsg");
    const res = await fetch("/api/settings/logo", { method: "POST", body: fd });
    if (res.ok) {
      refreshLogoPreview();
      msg.style.color = "#1a8a44";
      msg.textContent = T("logoUpdated");
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
      const raw = buildEscPosTicket(o, storeName);
      const config = qz.configs.create(cfg.printerName, { encoding: "UTF-8" });
      await qz.print(config, [{ type: "raw", format: "command", flavor: "plain", data: raw }]);
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
  async function tryPrintViaRawBt(o) {
    try {
      const res = await fetch("/api/settings/escpos");
      if (!res.ok) return false;
      const cfg = await res.json();
      if (!cfg.rawbtEnabled) return false;
      if (typeof buildEscPosRasterTicket !== "function") return false;

      const storeName = (storeSettings && (storeSettings.store_name_zh || storeSettings.store_name_ko)) || "한국관";
      // Mirrors buildTicketHtml()'s own table-label/phone logic exactly
      // (see admin.js above) — escpos.js doesn't know about the `tables`
      // list, so that lookup happens here and the result is handed in.
      const counter = isCounterOrder(o);
      const tableLabel = counter
        ? o.pickup_number && o.customer_name
          ? `📦 ${o.pickup_number}號 · ${o.customer_name}`
          : "外帶櫃檯"
        : `桌號 ${o.table_number}`;
      const phoneLine = counter && o.customer_phone ? `☎ ${o.customer_phone}` : null;
      const bytes = buildEscPosRasterTicket(o, storeName, ticketFontSizes, { tableLabel, phoneLine });

      if (await sendViaRawBtWebSocket(bytes)) return true;

      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = "rawbt:base64," + bytesToBase64(bytes);
      document.body.appendChild(iframe);
      setTimeout(() => iframe.remove(), 1000);
      return true;
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
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = "rawbt:base64," + bytesToBase64(bytes);
      document.body.appendChild(iframe);
      setTimeout(() => iframe.remove(), 1000);
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
    box.onchange = async () => {
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
      const msg = $("#staffPermMsg");
      msg.style.color = "#1a8a44";
      msg.textContent = T("staffPermSaved");
      msg.hidden = false;
      setTimeout(() => (msg.hidden = true), 2000);
    };
  });

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
  function renderItemsChart(itemBreakdown) {
    const canvas = $("#settlementItemsChart");
    if (!canvas || typeof Chart === "undefined") return;
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
    if (!canvas || typeof Chart === "undefined") return;
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
    if (!canvas || typeof Chart === "undefined") return;
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
    if (!canvas || typeof Chart === "undefined") return;
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
    $("#settlementRevenue").textContent = `NT$${Number(data.total_revenue || 0).toLocaleString()}`;
    $("#settlementPaidCount").textContent = data.paid_order_count;
    $("#settlementProblemCount").textContent = data.problem_order_count;
    $("#settlementCancelledCount").textContent = data.cancelled_order_count;
    $("#settlementTurnover").textContent =
      data.avg_turnover_minutes != null ? `${data.avg_turnover_minutes}${T("settlementTurnoverMinutes")}` : T("settlementTurnoverNoData");

    const problemSection = $("#settlementProblemSection");
    const problemCard = $("#settlementProblemCard");
    if (data.problem_order_count > 0) {
      problemSection.hidden = false;
      problemCard.classList.add("has-problems");
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
      problemCard.classList.remove("has-problems");
    }

    $("#settlementItemsBody").innerHTML = data.item_breakdown
      .map(
        (it) => `
          <tr>
            <td>${itemDisplayName(it)}</td>
            <td>${it.qty}</td>
            <td>NT$${it.subtotal.toLocaleString()}</td>
          </tr>`
      )
      .join("");
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
  async function loadSettlement(start, end) {
    const params = new URLSearchParams();
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    const qs = params.toString();
    const res = await fetch(qs ? `/api/settlements?${qs}` : "/api/settlements");
    if (!res.ok) return;
    renderSettlement(await res.json());
    activeSettlementHistoryDate = start && end && start === end ? start : null;
    loadSettlementHistory();
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
      row.onclick = () => loadSettlement(row.dataset.date, row.dataset.date);
    });
  }

  function settlementDateRangeChanged() {
    const start = $("#settlementStartDate").value;
    const end = $("#settlementEndDate").value;
    if (!start || !end) return;
    loadSettlement(start, end);
  }
  $("#settlementStartDate").onchange = settlementDateRangeChanged;
  $("#settlementEndDate").onchange = settlementDateRangeChanged;
  $("#settlementTodayBtn").onclick = () => {
    const today = taipeiTodayString();
    loadSettlement(today, today);
  };
  $("#settlementWeekBtn").onclick = () => {
    const today = taipeiTodayString();
    loadSettlement(addDaysToDateString(today, -6), today);
  };
  $("#settlementMonthBtn").onclick = () => {
    const today = taipeiTodayString();
    loadSettlement(addDaysToDateString(today, -29), today);
  };
  // Builds a spreadsheet-friendly CSV from whatever's currently loaded
  // (summary + item breakdown + unpaid orders) — a UTF-8 BOM is prepended
  // so Excel opens Korean/Chinese text correctly instead of mojibake.
  function csvEscape(v) {
    const s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function buildSettlementCsv(data) {
    const rows = [];
    rows.push(["결산 기간", data.date || `${data.start_date} ~ ${data.end_date}`]);
    rows.push(["매출(결제완료)", data.total_revenue]);
    rows.push(["결제 완료 주문", data.paid_order_count]);
    rows.push(["취소된 주문", data.cancelled_order_count]);
    rows.push(["미결제/문제 주문", data.problem_order_count]);
    rows.push(["평균 테이블 회전 시간(분)", data.avg_turnover_minutes ?? ""]);
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
  checkAuth();
})();
