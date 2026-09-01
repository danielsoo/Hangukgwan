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
  let soundOn = true;
  let autoPrintOn = false;
  let storeSettings = {};
  let pollTimer = null;
  let knownOrderIds = new Set();
  let openTableNumber = null;
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

  // ---------- Admin-panel-wide font size (this browser only) ----------
  // A personal display preference, not a shared setting — stored in this
  // browser's localStorage (never sent to the server), so adjusting it can
  // never affect anyone else's screen or another device. Separate from the
  // kitchen-ticket font sizes further down, which ARE shared/server-side —
  // a printed ticket is a real document everyone who prints it needs to
  // see rendered the same way, unlike this screen-only preference.
  const UI_FONT_SCALE_KEY = "hangukgwan_admin_ui_font_scale";
  const UI_FONT_SCALE_MIN = 0.8;
  const UI_FONT_SCALE_MAX = 1.6;
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
      tabMenu: "메뉴 관리",
      tabTables: "테이블 / QR 코드",
      tabSettings: "설정",
      logoutBtn: "로그아웃",
      soundToggleLabel: "🔔 신규 주문 알림음",
      autoPrintToggleLabel: "🖨️ 신규 주문 자동 인쇄",
      refreshBtn: "새로고침",
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
      tableDetailTabActive: "현재 주문",
      tableDetailTabPaid: "이전 주문",
      tableDetailNoPaidHistory: "아직 결제 완료된 주문이 없습니다.",
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
      alertTableNumberRequired: "테이블 번호를 입력하세요",
      alertUnluckyNumber: "숫자 '4'가 들어간 테이블 번호는 사용할 수 없습니다 (대만에서 불길한 숫자로 여겨져 제외됩니다).",
      alertTableExists: "이미 존재하는 테이블 번호입니다",
      alertFloorPlanSaveFailed: "배치 저장에 실패했어요. 방금 옮긴 자리가 원래대로 되돌아갑니다 — 다시 시도해주세요.",
      tableEmptyBadge: "비어있음",
      tableDelTitle: "삭제",
      noOrdersYetAdmin: "아직 주문이 없습니다.",
      unpaidTotalLabel: "현재 미결제 합계:",
      unpaidTotalLabel2: "미결제 합계:",
      payAllBtn: "전체 결제 완료",
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
      settlementHistoryTitle: "지난 정산 기록",
      settlementHistoryHint: "매일 마감 시간 이후 자동으로 저장되는 기록입니다 (수동 저장도 가능).",
      settlementHistoryEmpty: "아직 저장된 정산 기록이 없습니다.",
      settlementHistoryPaid: "결제",
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
      uiFontScaleTitle: "화면 글자 크기",
      uiFontScaleHint: "이 관리자 화면 전체의 글자 크기를 조절해요. 이 컴퓨터/브라우저에서만 적용되고 다른 사람 화면에는 영향이 없어요.",
      uiFontScaleResetBtn: "기본값",
      ticketFontSizesTitle: "빌지(주방 티켓) 글자 크기",
      ticketFontSizesHint:
        "항목별로 글자 크기를 따로 조절할 수 있어요. 오른쪽 미리보기는 실제 인쇄 크기 그대로예요. 브라우저 인쇄(미리보기 인쇄)에만 적용되고, ESC/POS 직접 인쇄에는 적용되지 않아요 — 프린터 자체 글꼴이라 크기를 이렇게 세밀하게 조절할 수 없어요.",
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
      tabMenu: "菜單管理",
      tabTables: "桌號 / QR Code",
      tabSettings: "設定",
      logoutBtn: "登出",
      soundToggleLabel: "🔔 新訂單提示音",
      autoPrintToggleLabel: "🖨️ 新訂單自動列印",
      refreshBtn: "重新整理",
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
      tableDetailTabActive: "目前訂單",
      tableDetailTabPaid: "先前訂單",
      tableDetailNoPaidHistory: "目前還沒有已結帳的訂單。",
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
      alertTableNumberRequired: "請輸入桌號",
      alertUnluckyNumber: "桌號不能包含數字「4」（在台灣被視為不吉利的數字）。",
      alertTableExists: "此桌號已經存在",
      alertFloorPlanSaveFailed: "版面儲存失敗，剛剛移動的位置會還原——請再試一次。",
      tableEmptyBadge: "空桌",
      tableDelTitle: "刪除",
      noOrdersYetAdmin: "目前尚無訂單。",
      unpaidTotalLabel: "目前未結帳金額：",
      unpaidTotalLabel2: "未結帳金額：",
      payAllBtn: "全部結帳完成",
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
      settlementHistoryTitle: "過往結算紀錄",
      settlementHistoryHint: "每天打烊時間後會自動儲存紀錄（也可以手動儲存）。",
      settlementHistoryEmpty: "尚無已儲存的結算紀錄。",
      settlementHistoryPaid: "已結帳",
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
      uiFontScaleTitle: "畫面文字大小",
      uiFontScaleHint: "調整整個管理後台畫面的文字大小。只影響這台電腦/瀏覽器，不會影響其他人的畫面。",
      uiFontScaleResetBtn: "預設值",
      ticketFontSizesTitle: "廚房出單文字大小",
      ticketFontSizesHint:
        "可以個別調整每個項目的文字大小，右邊的預覽是實際列印大小。只影響瀏覽器列印（預覽列印），不影響 ESC/POS 直接列印 — 因為印表機本身的字型無法這樣細部調整大小。",
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
  const fmtPrintFailBanner = (n, tableNumbers) => {
    const tables = tableNumbers.join(", ");
    return adminLang === "zh"
      ? `⚠️ ${n} 張出單可能沒印出來（桌號：${tables}）— 出單機沒紙、沒連線、或彈出視窗被瀏覽器擋下都可能造成這樣，請確認廚房收到，或按該筆訂單的「列印」重新送出。`
      : `⚠️ 빌지 ${n}건이 제대로 안 나갔을 수 있어요 (테이블: ${tables}) — 프린터 용지 부족, 연결 끊김, 브라우저 팝업 차단 등이 원인일 수 있어요. 주방에 실제로 전달됐는지 확인하거나, 해당 주문의 "인쇄" 버튼으로 다시 보내주세요.`;
  };
  const fmtConfirmDeleteTable = (n) => (adminLang === "zh" ? `確定要刪除桌號 ${n} 嗎？` : `테이블 ${n}을(를) 삭제하시겠습니까?`);
  const fmtConfirmPayAll = (label, n) =>
    adminLang === "zh"
      ? `確定要將桌號 ${label} 的 ${n} 筆未結帳訂單全部標記為已結帳嗎？`
      : `테이블 ${label}의 미결제 주문 ${n}건을 모두 결제 완료로 처리하시겠습니까?`;
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
      if (openTableNumber) openTableDetail(openTableNumber);
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
      if (btn.dataset.tab === "settlement" && currentRole !== "owner") return;
      $$(".admin-tabs button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      $$(".tab-panel").forEach((p) => (p.hidden = true));
      $(`#tab-${btn.dataset.tab}`).hidden = false;
      if (btn.dataset.tab === "settlement") loadSettlement();
      if (btn.dataset.tab === "reservations") loadReservations();
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

  $("#soundToggle").onchange = (e) => (soundOn = e.target.checked);
  $("#autoPrintToggle").onchange = (e) => (autoPrintOn = e.target.checked);
  $("#refreshOrders").onclick = loadOrders;

  // ---------- Orders ----------
  async function loadOrders() {
    const res = await fetch("/api/orders");
    if (res.status === 401) return showLogin();
    const fresh = await res.json();

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
    renderOrders(); // also refreshes #printFailBanner, using prunedAny above
    renderTables();
    if (!$("#floorPlanWrap").hidden && !floorPlanDragging) renderFloorPlan();
    if (openTableNumber) openTableDetail(openTableNumber);

    if (!isFirstLoad && newlyArrived.length > 0) {
      newlyArrived.forEach((o) => flashNewOrder(o.id));
      if (soundOn) playBeep();
      if (autoPrintOn) {
        Promise.all(newlyArrived.map((o) => printKitchenTicket(o))).then(renderOrders);
      }
    }
  }

  const NEXT_STATUS = { new: "preparing", preparing: "served", served: "paid" };
  const statusLabel = (s) => T("status" + s.charAt(0).toUpperCase() + s.slice(1));
  const nextLabel = (s) => T("next" + s.charAt(0).toUpperCase() + s.slice(1));

  function renderOrders() {
    const cols = { new: [], preparing: [], served: [], paid: [] };
    orders.forEach((o) => {
      if (cols[o.status]) cols[o.status].push(o);
    });

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
      wireColumnDragDrop(body);
    });
    renderPrintFailureBanner();
  }

  // ---------- Drag-to-reorder within one order-queue column ----------
  // Classic "vanilla JS sortable list" trick: while dragging, figure out
  // which existing card the pointer is currently above/below and move the
  // dragged card there live in the DOM; on drop, read the column's final
  // DOM order back out and persist it. Reassigned on every renderOrders()
  // call (property assignment, not addEventListener) so there's never more
  // than one live handler per column even though the cards get rebuilt
  // from scratch every 4-second poll.
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

  function wireColumnDragDrop(body) {
    body.ondragover = (e) => {
      if (body !== dragSourceColumnBody) return; // never drop into a different status column
      e.preventDefault();
      const dragging = body.querySelector(".dragging");
      if (!dragging) return;
      const afterElement = getDragAfterElement(body, e.clientY);
      if (afterElement == null) body.appendChild(dragging);
      else body.insertBefore(dragging, afterElement);
    };
    body.ondrop = async (e) => {
      if (body !== dragSourceColumnBody) return;
      e.preventDefault();
      const orderIds = [...body.querySelectorAll(".order-card")].map((el) => parseInt(el.dataset.orderId, 10));
      // Keep the in-memory list consistent with what's now on screen so an
      // intervening renderOrders() call (e.g. the next poll landing before
      // the PATCH below resolves) doesn't visually snap back. Updating
      // queue_order alone isn't enough — renderOrders() rebuilds each
      // column by iterating `orders` in its current array order, so the
      // array itself needs to reflect the drop too, not just the field the
      // server will eventually re-sort by.
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
    // Drag-to-reorder within this same column (see wireColumnDragDrop()) —
    // staff can bump a particular order up/down the queue by hand, e.g. a
    // table that asked to rush their order.
    card.draggable = true;
    card.ondragstart = (e) => {
      draggingOrderId = o.id;
      dragSourceColumnBody = card.parentElement;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(o.id));
      setTimeout(() => card.classList.add("dragging"), 0);
    };
    card.ondragend = () => {
      card.classList.remove("dragging");
      draggingOrderId = null;
      dragSourceColumnBody = null;
    };
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
      const label = `${it.code ? `${it.code} ` : ""}${itemName(it)} x${it.qty}${it.option_choice ? `(${it.option_choice})` : ""}`;
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
    card.innerHTML = `
      <div class="order-card-top"><span>${T("tableLabel")} ${o.table_number}${typeBadge}</span><span class="order-card-time">${time}</span></div>
      ${printFailedNotice}
      <div class="order-card-items">${itemsHtml}</div>
      ${itemsToggleHtml}
      <div class="order-card-total">NT$${o.total}</div>
      <div class="order-card-actions" id="actions-${o.id}"></div>
    `;
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
        if (it.spice_choice) detailLines.push(`<div class="item-detail">└ ${it.spice_choice}</div>`);
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@700;900&family=Noto+Sans+KR:wght@700;900&display=swap" />
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
  .store-name { font-size: ${fs.storeName}px; font-weight: 900; }
  .divider { border-top: 1px dashed #000; margin: 2mm 0; }
  .meta-row { display: flex; justify-content: space-between; align-items: center; font-weight: 700; margin-bottom: 1mm; }
  .table-no { font-size: ${fs.tableNo}px; }
  .order-type-badge { display: inline-block; font-size: ${fs.orderTypeBadge}px; font-weight: 900; border: 1.5px solid #000; padding: 0.5mm 2mm; border-radius: 3px; }
  .order-time { font-size: ${fs.time}px; }
  .item-row { padding: 2mm 0; border-bottom: 1px dotted #999; }
  .item-row:last-child { border-bottom: none; }
  .item-main { display: flex; justify-content: space-between; gap: 3mm; font-size: ${fs.itemName}px; font-weight: 900; }
  .item-name { flex: 1; }
  .item-qty { white-space: nowrap; }
  .item-detail { font-size: ${fs.itemDetail}px; color: #333; margin-top: 0.5mm; padding-left: 1mm; }
  .item-note { font-size: ${fs.itemNote}px; color: #c0161f; }
  .item-takeout { font-size: ${fs.itemTakeout}px; font-weight: 900; color: #000; }
  .total-row { display: flex; justify-content: space-between; font-size: ${fs.total}px; font-weight: 900; margin-top: 2mm; padding-top: 2mm; border-top: 1px dashed #000; }
  .order-note { font-size: ${fs.orderNote}px; color: #c0161f; margin-top: 2mm; }
  .print-time { text-align: center; font-size: ${fs.printTime}px; color: #555; margin-top: 3mm; }
  ${screenChromeCss}
</style>
</head><body>
  <div class="receipt">
    <div class="header"><div class="store-name">${storeName} 廚房出單</div></div>
    <div class="divider"></div>
    <div class="meta-row"><span class="table-no">桌號 ${o.table_number}</span><span class="order-type-badge">${orderTypeLabel(o)}</span></div>
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

  // Opens the exact same ticket HTML in a new tab, without triggering the
  // print dialog — a fast way to check the layout after a tweak without
  // needing to actually print a physical page each time.
  function previewKitchenTicket(o) {
    const win = window.open("", "_blank");
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

  $$("#settings-cat-print input[id^='tfs']").forEach((el) => (el.oninput = updateTicketFontPreview));

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

  async function updateOrderStatus(id, status) {
    await fetch(`/api/orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

  function openOrderDetail(o) {
    const time = new Date(o.created_at.replace(" ", "T")).toLocaleString("ko-KR");
    const itemsHtml = o.items
      .map(
        (it) =>
          `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;">
            <span>${it.code ? `${it.code} ` : ""}${itemName(it)} ${it.option_choice ? `(${it.option_choice})` : ""} x${it.qty}${it.order_type === "takeout" ? ` <span class="order-card-type-badge takeout">${T("orderCardTakeoutBadge")}</span>` : ""}${it.note ? `<br/><small style="color:#999;">${T("memoLabel")}: ${it.note}</small>` : ""}</span>
            <span>NT$${it.unit_price * it.qty}</span>
          </div>`
      )
      .join("");
    $("#orderDetailBody").innerHTML = `
      <h2>${T("tableLabel")} ${o.table_number}</h2>
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

  function openOrderEdit(order) {
    if (order.status === "paid" || order.status === "cancelled") {
      showAlert(T("orderEditNotEditable"));
      return;
    }
    // Edited entirely on a local draft copy — nothing reaches the server
    // until Save, so closing/cancelling this modal never has a side effect.
    const draftItems = order.items.map((it) => ({ ...it }));
    const allItems = flatMenuItems();
    const itemTotal = (it) => it.unit_price * it.qty;
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
        const optionsHtml =
          mi && mi.options && !mi.mix_options
            ? `<select data-idx="${idx}" data-field="option">${mi.options
                .split(",")
                .map((o) => o.trim())
                .filter(Boolean)
                .map((o) => `<option value="${o}" ${it.option_choice === o ? "selected" : ""}>${o}</option>`)
                .join("")}</select>`
            : it.option_choice
              ? `<span style="font-size:13px;color:var(--muted);">(${it.option_choice})</span>`
              : "";
        const spiceHtml =
          mi && mi.spice_options
            ? `<select data-idx="${idx}" data-field="spice">${mi.spice_options
                .split(",")
                .map((o) => o.trim())
                .filter(Boolean)
                .map((o) => `<option value="${o}" ${it.spice_choice === o ? "selected" : ""}>${o}</option>`)
                .join("")}</select>`
            : it.spice_choice
              ? `<span style="font-size:13px;color:var(--muted);">(${it.spice_choice})</span>`
              : "";
        const row = document.createElement("div");
        row.className = "order-edit-item-row";
        row.innerHTML = `
          <span class="order-edit-item-name">${it.code ? `${it.code} ` : ""}${itemName(it)}</span>
          ${optionsHtml}
          ${spiceHtml}
          <div class="order-edit-qty-group">
            <button type="button" class="order-edit-qty-btn" data-idx="${idx}" data-action="dec">−</button>
            <span class="order-edit-qty-value">${it.qty}</span>
            <button type="button" class="order-edit-qty-btn" data-idx="${idx}" data-action="inc">+</button>
          </div>
          <span class="order-edit-item-price">NT$${itemTotal(it)}</span>
          <button type="button" class="order-edit-remove-btn" data-idx="${idx}" title="${T("cancelBtn")}">✕</button>
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
      wrap.querySelectorAll("select[data-field='option']").forEach((sel) => {
        sel.onchange = () => {
          draftItems[parseInt(sel.dataset.idx, 10)].option_choice = sel.value;
        };
      });
      wrap.querySelectorAll("select[data-field='spice']").forEach((sel) => {
        sel.onchange = () => {
          draftItems[parseInt(sel.dataset.idx, 10)].spice_choice = sel.value;
        };
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
    $("#orderEditAddBtn").onclick = () => {
      const mi = allItems.find((m) => m.id === parseInt(addSelect.value, 10));
      if (!mi) return;
      draftItems.push({
        item_id: mi.id,
        code: mi.code || null,
        name_zh: mi.name_zh,
        name_ko: mi.name_ko,
        name_en: mi.name_en,
        qty: 1,
        unit_price: mi.price,
        option_choice: mi.options ? mi.options.split(",")[0].trim() : null,
        spice_choice: mi.spice_options ? mi.spice_options.split(",")[0].trim() : null,
        order_type: "dine_in",
        note: "",
      });
      renderDraft();
    };

    $("#orderEditTitle").textContent = `${T("orderEditModalTitle")} — ${T("tableLabel")} ${order.table_number}`;
    $("#orderEditMsg").hidden = true;
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
      // loadOrders() already re-opens the table-detail modal for whatever
      // table is currently shown (see openTableNumber), so no separate
      // refresh call is needed here even when this was opened from there.
      await loadOrders();
      await loadTables();
    };
  }
  $("#orderEditClose").onclick = () => ($("#orderEditBackdrop").hidden = true);
  $("#orderEditCancel").onclick = () => ($("#orderEditBackdrop").hidden = true);
  $("#orderEditBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "orderEditBackdrop") $("#orderEditBackdrop").hidden = true;
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
    categories.forEach((c) => {
      const block = document.createElement("div");
      block.className = "cat-block";
      block.innerHTML = `<h3>${catName(c)}</h3>`;
      const table = document.createElement("table");
      table.className = "item-table";
      table.innerHTML = `
        <thead><tr><th></th><th>${T("codeTh")}</th><th>${T("nameTh")}</th><th>${T("priceTh")}</th><th>${T("statusTh")}</th></tr></thead>
        <tbody></tbody>
      `;
      const tbody = table.querySelector("tbody");
      c.items.forEach((item) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${item.photo_url ? `<span class="item-row-photo" style="background-image:url('${item.photo_url}')"></span>` : `<span class="photo-missing-badge" title="${T("photoMissingTitle")}">${T("photoMissing")}</span>`}</td>
          <td>${item.code || ""}</td>
          <td>${itemName(item)}</td>
          <td>NT$${item.price}</td>
          <td><span class="availability-pill ${item.available ? "on" : "off"}">${item.available ? T("onSale") : T("soldOut")}</span></td>
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

  function renderTables() {
    const wrap = $("#tablesList");
    wrap.innerHTML = "";
    tables.forEach((t) => {
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

  function openTableDetail(tableNumber, label) {
    // A previous round's paid order used to sit in the same undivided,
    // continuously-scrolling list as whatever the table ordered next —
    // fine right after paying, confusing once a new order comes in.
    // 진행중/결제완료 내역 tabs (tableDetailView, declared up top) keep the
    // two apart: paid orders always land in 완료 내역, so a fresh order for
    // the same table always starts clean in 진행중.
    if (openTableNumber !== tableNumber) tableDetailView = "active";
    openTableNumber = tableNumber;
    const table = tables.find((t) => String(t.number) === String(tableNumber));
    const tableOrders = activeOrdersForTable(tableNumber); // excludes only "cancelled"
    const activeOrders = tableOrders.filter((o) => o.status !== "paid");
    const paidOrders = tableOrders.filter((o) => o.status === "paid");
    const unpaidOrders = activeOrders;
    const unpaidTotal = unpaidOrders.reduce((s, o) => s + o.total, 0);
    // Same "only while actually occupied" rule as the table-list badge above.
    const partyText = table && table.party_size && unpaidOrders.length > 0 ? ` · ${fmtPartyCount(table.party_size)}` : "";
    const payAllBtn = unpaidOrders.length
      ? `<button class="primary-btn pay-all-btn" style="padding:8px 16px;font-size:15px;">${T("payAllBtn")}</button>`
      : "";
    const header = `
      <h2>${T("tableLabel")} ${label || tableNumber}${partyText}</h2>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:-6px;">
        <p style="color:var(--muted);font-size:15px;margin:0;">${T("unpaidTotalLabel")} <strong>NT$${unpaidTotal}</strong></p>
        ${payAllBtn}
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
    const body = shownOrders.length
      ? shownOrders.map((o) => renderTableOrderBlock(o)).join("")
      : `<p style="color:var(--muted);padding:20px 0;text-align:center;">${emptyMsg}</p>`;
    const footer = tableDetailView === "active" && activeOrders.length
      ? `
        <div style="display:flex;justify-content:space-between;align-items:center;border-top:2px solid var(--ink);margin-top:4px;padding-top:12px;">
          <p style="font-size:16px;margin:0;">${T("unpaidTotalLabel2")} <strong>NT$${unpaidTotal}</strong></p>
          ${payAllBtn}
        </div>
      `
      : "";
    $("#tableDetailBody").innerHTML = header + tabsHtml + body + footer;
    $("#tableDetailBody")
      .querySelectorAll("[data-detail-view]")
      .forEach((btn) => {
        btn.onclick = () => {
          tableDetailView = btn.dataset.detailView;
          openTableDetail(tableNumber, label);
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
          openTableDetail(tableNumber, label);
        };
      });
    $("#tableDetailBody")
      .querySelectorAll("[data-advance-id]")
      .forEach((btn) => {
        btn.onclick = async () => {
          await updateOrderStatus(parseInt(btn.dataset.advanceId, 10), btn.dataset.advanceTo);
          await loadOrders();
          openTableDetail(tableNumber, label);
        };
      });
    $("#tableDetailBody")
      .querySelectorAll(".pay-all-btn")
      .forEach((btn) => {
        btn.onclick = async () => {
          if (!(await showConfirm(fmtConfirmPayAll(label || tableNumber, unpaidOrders.length)))) return;
          // No separate "now also clear the party size" step here on
          // purpose — each updateOrderStatus() call PATCHes that order to
          // "paid", and the server's PATCH /api/orders/:id handler already
          // clears the table's party_size by itself the instant the table's
          // last order leaves active status (see src/routes/orders.js). The
          // order and the headcount are one bundled unit for this purpose:
          // they disappear together as a side effect of the same status
          // change, not as a second, separately-triggered rule.
          await Promise.all(unpaidOrders.map((o) => updateOrderStatus(o.id, "paid")));
          await loadOrders();
          await loadTables();
          openTableDetail(tableNumber, label);
        };
      });
    $("#tableDetailBackdrop").hidden = false;
  }

  function renderTableOrderBlock(o) {
    const time = new Date(o.created_at.replace(" ", "T")).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    const itemLines = o.items.map(
      (it) =>
        `<div style="display:flex;justify-content:space-between;font-size:16px;padding:5px 0;">
          <span>${it.code ? `${it.code} ` : ""}${itemName(it)}${it.option_choice ? ` (${it.option_choice})` : ""} x${it.qty}${it.order_type === "takeout" ? ` <span class="order-card-type-badge takeout">${T("orderCardTakeoutBadge")}</span>` : ""}${it.note ? `<br/><small style="color:var(--muted);font-size:14px;">${T("memoLabel")}: ${it.note}</small>` : ""}</span>
          <span>NT$${it.unit_price * it.qty}</span>
        </div>`
    );
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
    const nextBtn = NEXT_STATUS[o.status]
      ? `<button class="primary-btn" style="padding:7px 14px;font-size:14px;" data-advance-id="${o.id}" data-advance-to="${NEXT_STATUS[o.status]}">${nextLabel(o.status)}</button>`
      : "";
    const editBtn =
      o.status !== "paid" && o.status !== "cancelled" && canEditOrder()
        ? `<button style="padding:7px 14px;font-size:14px;" data-edit-id="${o.id}">${T("orderEditBtn")}</button>`
        : "";
    return `
      <div style="border-top:1px solid var(--line);padding:14px 0;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-weight:700;font-size:15px;">${time} · ${statusLabel(o.status)}</span>
          <div style="display:flex;gap:6px;">${nextBtn}${editBtn}</div>
        </div>
        ${itemsHtml}
        ${itemsToggleHtml}
        ${o.note ? `<p style="font-size:14px;color:var(--muted);margin:8px 0 0;">${T("orderMemoLabel")}: ${o.note}</p>` : ""}
        <div style="text-align:right;font-weight:700;font-size:16px;margin-top:6px;">${T("subtotalLabel")} NT$${o.total}</div>
      </div>
    `;
  }
  $("#tableDetailClose").onclick = () => {
    $("#tableDetailBackdrop").hidden = true;
    openTableNumber = null;
  };
  $("#tableDetailBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "tableDetailBackdrop") {
      $("#tableDetailBackdrop").hidden = true;
      openTableNumber = null;
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
    const unplaced = tables.filter((t) => t.zone_id == null);
    const selected = new Set();
    $("#addTableToZoneTitle").textContent = fmtAddTableToZoneTitle(zone.name);
    const grid = $("#addTableToZoneGrid");
    grid.innerHTML = "";
    if (unplaced.length === 0) {
      grid.innerHTML = `<div class="table-picker-empty">${T("addTableToZoneEmpty")}</div>`;
    } else {
      unplaced
        .sort((a, b) => parseInt(a.number, 10) - parseInt(b.number, 10))
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
    [...tables]
      .sort((a, b) => parseInt(a.number, 10) - parseInt(b.number, 10))
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
  }

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

  // start/end default to today when omitted. Pass the same date for both to
  // view a single day (e.g. from clicking a row in 지난 정산 기록).
  async function loadSettlement(start, end) {
    const params = new URLSearchParams();
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    const qs = params.toString();
    const res = await fetch(qs ? `/api/settlements?${qs}` : "/api/settlements");
    if (!res.ok) return;
    renderSettlement(await res.json());
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
    el.innerHTML = list
      .map(
        (s) => `
          <div class="settlement-history-row" data-date="${s.date}">
            <span class="settlement-history-date">${s.date}</span>
            <span>NT$${Number(s.total_revenue || 0).toLocaleString()}</span>
            <span>${T("settlementHistoryPaid")} ${s.paid_order_count}</span>
            <span class="${s.problem_order_count > 0 ? "settlement-history-warn" : ""}">${T("settlementHistoryProblem")} ${s.problem_order_count}</span>
          </div>`
      )
      .join("");
    $$(".settlement-history-row").forEach((row) => {
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
