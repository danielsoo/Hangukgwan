(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
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

  // ---------- Role / permissions ----------
  // "owner" (사장) always has every permission; "staff" (직원) only has
  // whatever the owner has switched on below. Populated from /api/auth/me
  // after login — the server enforces the same boundaries independently
  // (see requirePermission in src/auth.js), this is just for the UI.
  let currentRole = "owner";
  let staffPermissions = { menuEdit: true, tableEdit: true, settingsEdit: true, orderCancel: true, reservationManage: true };
  const canMenuEdit = () => currentRole === "owner" || staffPermissions.menuEdit;
  const canTableEdit = () => currentRole === "owner" || staffPermissions.tableEdit;
  const canSettingsEdit = () => currentRole === "owner" || staffPermissions.settingsEdit;
  const canCancelOrder = () => currentRole === "owner" || staffPermissions.orderCancel;
  const canManageReservations = () => currentRole === "owner" || staffPermissions.reservationManage;

  // ---------- Admin UI language (Korean / Traditional Chinese) ----------
  // Unlike the customer order page (which always resets to Chinese on a
  // fresh scan), this is a staff tool — whichever language a staff member
  // picks should stick around the next time they open it, so it's saved
  // in localStorage instead of resetting.
  let adminLang = localStorage.getItem("hgk_admin_lang") || "ko";

  const ADMIN_I18N = {
    ko: {
      pageTitle: "한국관 관리자 페이지",
      loginTitle: "관리자 로그인",
      loginPasswordPlaceholder: "관리자 비밀번호",
      loginBtn: "로그인",
      loginError: "비밀번호가 올바르지 않습니다. 다시 시도해주세요",
      brand: "☯ 한국관 관리자",
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
      printBtn: "🖨️ 인쇄",
      previewBtn: "👁️ 미리보기",
      confirmCancelOrder: "이 주문을 취소하시겠습니까?",
      tableLabel: "테이블",
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
      floorPlanHint: "구역과 테이블을 드래그해서 움직이고, 오른쪽 아래 모서리를 드래그해서 크기를 조절하세요. 구역 이름을 클릭하면 수정할 수 있어요.",
      alertTableNumberRequired: "테이블 번호를 입력하세요",
      alertUnluckyNumber: "숫자 '4'가 들어간 테이블 번호는 사용할 수 없습니다 (대만에서 불길한 숫자로 여겨져 제외됩니다).",
      alertTableExists: "이미 존재하는 테이블 번호입니다",
      tableEmptyBadge: "비어있음",
      tableDelTitle: "삭제",
      noOrdersYetAdmin: "아직 주문이 없습니다.",
      unpaidTotalLabel: "현재 미결제 합계:",
      unpaidTotalLabel2: "미결제 합계:",
      payAllBtn: "전체 결제 완료",
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
      settingsTabGeneral: "일반",
      settingsTabAdmin: "관리자 전용",
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
      itemOptionsLabel: "옵션 (쉼표로 구분, 예: 소고기,돼지고기)",
      itemOptionsPlaceholder: "옵션이 없으면 비워두세요",
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
      pageTitle: "韓國館 管理後台",
      loginTitle: "管理員登入",
      loginPasswordPlaceholder: "管理員密碼",
      loginBtn: "登入",
      loginError: "密碼錯誤，請重新輸入",
      brand: "☯ 韓國館 管理後台",
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
      printBtn: "🖨️ 列印",
      previewBtn: "👁️ 預覽",
      confirmCancelOrder: "確定要取消這筆訂單嗎？",
      tableLabel: "桌號",
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
      floorPlanHint: "拖曳區域和桌號即可移動位置，拖曳右下角可調整大小。點擊區域名稱可以修改名稱。",
      alertTableNumberRequired: "請輸入桌號",
      alertUnluckyNumber: "桌號不能包含數字「4」（在台灣被視為不吉利的數字）。",
      alertTableExists: "此桌號已經存在",
      tableEmptyBadge: "空桌",
      tableDelTitle: "刪除",
      noOrdersYetAdmin: "目前尚無訂單。",
      unpaidTotalLabel: "目前未結帳金額：",
      unpaidTotalLabel2: "未結帳金額：",
      payAllBtn: "全部結帳完成",
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
      settingsTabGeneral: "一般",
      settingsTabAdmin: "僅限管理員",
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
      itemOptionsLabel: "選項（用逗號分隔，例如：牛肉,豬肉）",
      itemOptionsPlaceholder: "沒有選項請留空",
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
  const fmtConfirmDeleteTable = (n) => (adminLang === "zh" ? `確定要刪除桌號 ${n} 嗎？` : `테이블 ${n}을(를) 삭제하시겠습니까?`);
  const fmtConfirmPayAll = (label, n) =>
    adminLang === "zh"
      ? `確定要將桌號 ${label} 的 ${n} 筆未結帳訂單全部標記為已結帳嗎？`
      : `테이블 ${label}의 미결제 주문 ${n}건을 모두 결제 완료로 처리하시겠습니까?`;
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
    document.body.classList.toggle("perm-no-reservationManage", !canManageReservations());
    // Staff can never see the 관리자 전용 settings sub-tab — force back to 일반.
    if (currentRole !== "owner") {
      const generalBtn = $('.settings-subtab-btn[data-subtab="general"]');
      if (generalBtn) {
        $$(".settings-subtab-btn").forEach((b) => b.classList.remove("active"));
        generalBtn.classList.add("active");
      }
      const generalPanel = $("#settings-general");
      const adminPanel = $("#settings-admin");
      if (generalPanel) generalPanel.hidden = false;
      if (adminPanel) adminPanel.hidden = true;
      // Same for the owner-only 결산 tab — bounce staff back to 실시간 주문.
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
    await Promise.all([loadOrders(), loadMenu(), loadTables(), loadSettings()]);
    if (currentRole === "owner") {
      loadStaffPermissions();
      loadLineSettings();
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

  // ---------- Settings sub-tabs (일반 / 관리자 전용) ----------
  // The 관리자 전용 button itself is owner-only (hidden for staff via CSS),
  // but we also guard the click handler and reset staff back to 일반 in
  // applyRoleUI, in case a staff session ever has it focused/selected.
  $$(".settings-subtab-btn").forEach((btn) => {
    btn.onclick = () => {
      if (btn.dataset.subtab === "admin" && currentRole !== "owner") return;
      $$(".settings-subtab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      $("#settings-general").hidden = btn.dataset.subtab !== "general";
      $("#settings-admin").hidden = btn.dataset.subtab !== "admin";
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
    renderOrders();
    renderTables();
    if (!$("#floorPlanWrap").hidden && !floorPlanDragging) renderFloorPlan();
    if (openTableNumber) openTableDetail(openTableNumber);

    if (!isFirstLoad && newlyArrived.length > 0) {
      newlyArrived.forEach((o) => flashNewOrder(o.id));
      if (soundOn) playBeep();
      if (autoPrintOn) newlyArrived.forEach((o) => printKitchenTicket(o));
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
    });
  }

  function renderOrderCard(o) {
    const card = document.createElement("div");
    card.className = "order-card";
    card.dataset.orderId = o.id;
    const time = new Date(o.created_at.replace(" ", "T")).toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const itemsHtml = o.items
      .map((it) => `${itemName(it)} x${it.qty}${it.option_choice ? `(${it.option_choice})` : ""}`)
      .join("<br/>");
    card.innerHTML = `
      <div class="order-card-top"><span>${T("tableLabel")} ${o.table_number}</span><span class="order-card-time">${time}</span></div>
      <div class="order-card-items">${itemsHtml}</div>
      <div class="order-card-total">NT$${o.total}</div>
      <div class="order-card-actions" id="actions-${o.id}"></div>
    `;
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
      cancelBtn.onclick = (e) => {
        e.stopPropagation();
        if (confirm(T("confirmCancelOrder"))) updateOrderStatus(o.id, "cancelled");
      };
      actions.appendChild(cancelBtn);
    }
    const printBtn = document.createElement("button");
    printBtn.textContent = T("printBtn");
    printBtn.onclick = (e) => {
      e.stopPropagation();
      printKitchenTicket(o);
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

  // ---------- Kitchen ticket printing (photo-overlay version) ----------
  // Prints the restaurant's actual paper order-slip PHOTO as-is (staff
  // already know this exact layout), and draws only the ordered quantities
  // (as 正/丨 tally marks) and the 桌號/人數/金額合計 numbers on top of it
  // at hand-measured coordinates — deliberately NOT a from-scratch HTML
  // recreation. This was a conscious choice after the recreated version
  // kept drifting from the real form (missing colors/glyphs, spacing) —
  // the owner asked to use the real photo directly instead, accepting that:
  //   1) menu items added AFTER this photo was taken (e.g. the Pororo kids
  //      meals) have no reserved spot on it, so they print in a small
  //      appendix table below the photo instead of being silently dropped;
  //   2) the coordinates below were measured by hand from the photo and
  //      may drift by a few px in places — nudge ROW_POINTS/COLS below if
  //      a tally ever lands slightly off from its row.
  // Image asset: public/images/kitchen-ticket-template.jpg (878x1865).
  // Traditional 正-tally counting draws the 5 strokes of 正 one at a time
  // as the count goes from 1 to 5 (1=一, 2=+vertical, 3=+a horizontal,
  // 4=+another horizontal, 5=complete 正), then starts a new 正 alongside
  // for the next group of 5. There's no existing font character for the
  // in-between partial forms (2/3/4 strokes), so these are drawn as small
  // inline SVG line strokes instead of text — guarantees they render
  // identically on any printer regardless of what Chinese font is
  // installed, the same problem that caused rare characters to print
  // blank elsewhere in this ticket.
  const TALLY_STROKES = [
    "M1,4 L23,4", // 1: top horizontal (一)
    "M12,4 L12,25", // 2: + vertical spine
    "M1,11 L23,11", // 3: + upper-middle horizontal
    "M1,18 L23,18", // 4: + lower-middle horizontal
    "M1,25 L23,25", // 5: + bottom horizontal — now a complete 正
  ];
  function strokeGlyphSvg(strokeCount) {
    if (strokeCount === 1) {
      // A lone "1" is just a short centered dash, sized/positioned to sit
      // level with the price number beside it — the top stroke of a
      // growing 正 is deliberately biased toward the top of its box (so
      // strokes 2-5 can stack below it), which looks off-center when it's
      // the only stroke on its own.
      return `<svg viewBox="0 0 24 12" class="tally-glyph tally-glyph-single"><path d="M1,6 L23,6" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="square"/></svg>`;
    }
    const paths = TALLY_STROKES.slice(0, strokeCount)
      .map((d) => `<path d="${d}" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="square"/>`)
      .join("");
    return `<svg viewBox="0 0 24 28" class="tally-glyph">${paths}</svg>`;
  }
  function tallyMark(n) {
    if (!n || n <= 0) return "";
    const groups = Math.floor(n / 5);
    const rem = n % 5;
    let out = "";
    for (let i = 0; i < groups; i++) out += strokeGlyphSvg(5);
    if (rem > 0) out += strokeGlyphSvg(rem);
    return out;
  }

  const TICKET_IMG_W = 878;
  const TICKET_IMG_H = 1865;
  // Row boundaries measured directly from the photo (not a uniform-height
  // formula — that drifted a few px further off with every row down the
  // page, which was visibly wrong by the bottom of the form). Index i's
  // row spans ROW_POINTS[i] to ROW_POINTS[i+1]. If a row ever needs
  // nudging, adjust the specific point(s) here rather than a formula.
  const ROW_POINTS = [
    404, 461, 506, 558, 609, 666, 711, 771, 814, 866, 917, 968, 1019, 1071, 1122, 1173, 1225,
    1276, 1328, 1379, 1430, 1481, 1533, 1584, 1635, 1687, 1738, 1790, 1841,
  ];
  function rowRect(index) {
    if (index + 1 < ROW_POINTS.length) {
      return { top: ROW_POINTS[index], bottom: ROW_POINTS[index + 1] };
    }
    // Ran past the measured points (an unusually long category) — keep
    // going at the same height as the last measured row rather than
    // erroring out.
    const lastHeight = ROW_POINTS[ROW_POINTS.length - 1] - ROW_POINTS[ROW_POINTS.length - 2];
    const stepsPast = index - (ROW_POINTS.length - 2);
    const top = ROW_POINTS[ROW_POINTS.length - 1] + (stepsPast - 1) * lastHeight;
    return { top, bottom: top + lastHeight };
  }
  const BAR_RECT = { top: 352, bottom: 404 }; // shared 飯類/烤肉類 bar row, right above row 0
  const COLS = {
    left: { code: [48, 85], name: [85, 287], price: [287, 363], qty: [363, 444] },
    right: { code: [444, 480], name: [480, 682], price: [682, 751], qty: [751, 839] },
  };
  // How many physical rows the photo reserves per category (src/seed.js
  // category keys) — anything beyond this per category goes to the
  // appendix instead of overflowing onto a row that doesn't exist.
  const TEMPLATE_SLOTS = { rice: 8, noodle: 9, hotpot: 9, bbq: 6, other: 13, drink: 7 };
  const LEFT_CAT_KEYS = ["rice", "noodle", "hotpot"];
  const RIGHT_CAT_KEYS = ["bbq", "other", "drink"];

  function buildSideSlots(catKeys) {
    let rowCursor = 0;
    const slots = [];
    const extra = [];
    catKeys.forEach((key, catIdx) => {
      const cat = categories.find((c) => c.key === key);
      const barRect = catIdx === 0 ? BAR_RECT : rowRect(rowCursor++);
      slots.push({ rect: barRect, type: "bar" });
      const reserved = TEMPLATE_SLOTS[key] || 0;
      const items = (cat && cat.items) || [];
      for (let i = 0; i < reserved; i++) {
        slots.push({ rect: rowRect(rowCursor++), type: "item", item: items[i] || null });
      }
      if (items.length > reserved) extra.push(...items.slice(reserved));
    });
    return { slots, extra };
  }

  function pct(px, total) {
    return (px / total) * 100;
  }

  function tallyOverlayForSlot(rect, side, item, orderedMap) {
    if (!item) return "";
    const ord = orderedMap[item.id];
    if (!ord) return "";
    const colX = COLS[side].qty;
    const optsArr = item.options ? item.options.split(",").map((s) => s.trim()).filter(Boolean) : null;
    if (optsArr && optsArr.length) {
      const subW = (colX[1] - colX[0]) / optsArr.length;
      return optsArr
        .map((opt, i) => {
          const qty = ord.byOption[opt];
          if (!qty) return "";
          const x0 = colX[0] + i * subW;
          // The 牛/豬 (etc) label printed on the photo sits in the top
          // ~45% of the row; the tally goes in the remaining space below
          // it. Keeping a small gap from the row's bottom border (ending
          // at 90%, not 100%) matters — a mark sitting right against the
          // border reads as "belongs to the row below" at a glance.
          const top = rect.top + (rect.bottom - rect.top) * 0.5;
          const height = (rect.bottom - rect.top) * 0.4;
          return `<div class="tally-overlay" style="left:${pct(x0, TICKET_IMG_W)}%;top:${pct(top, TICKET_IMG_H)}%;width:${pct(
            subW,
            TICKET_IMG_W
          )}%;height:${pct(height, TICKET_IMG_H)}%;">${tallyMark(qty)}</div>`;
        })
        .join("");
    }
    return `<div class="tally-overlay" style="left:${pct(colX[0], TICKET_IMG_W)}%;top:${pct(rect.top, TICKET_IMG_H)}%;width:${pct(
      colX[1] - colX[0],
      TICKET_IMG_W
    )}%;height:${pct(rect.bottom - rect.top, TICKET_IMG_H)}%;">${tallyMark(ord.qty)}</div>`;
  }

  function buildTicketHtml(o) {
    const table = tables.find((t) => t.number === o.table_number);
    const partySize = table && table.party_size ? table.party_size : "";
    const orderedMap = {};
    o.items.forEach((it) => {
      if (!orderedMap[it.item_id]) orderedMap[it.item_id] = { qty: 0, notes: [], byOption: {} };
      orderedMap[it.item_id].qty += it.qty;
      if (it.option_choice) {
        orderedMap[it.item_id].byOption[it.option_choice] = (orderedMap[it.item_id].byOption[it.option_choice] || 0) + it.qty;
      }
      if (it.note) orderedMap[it.item_id].notes.push(it.note);
    });

    const time = new Date(o.created_at.replace(" ", "T")).toLocaleString("ko-KR");

    const leftBuild = buildSideSlots(LEFT_CAT_KEYS);
    const rightBuild = buildSideSlots(RIGHT_CAT_KEYS);

    let overlays = "";
    leftBuild.slots.forEach((s) => {
      if (s.type === "item") overlays += tallyOverlayForSlot(s.rect, "left", s.item, orderedMap);
    });
    rightBuild.slots.forEach((s) => {
      if (s.type === "item") overlays += tallyOverlayForSlot(s.rect, "right", s.item, orderedMap);
    });

    // 桌號 / 人數 values, in the blank cell of the top header box (y249-301).
    // 桌號's box is pushed toward the right side of its blank area, 人數's
    // toward the left side of its blank area (closer to its own label).
    const headerTop = 249;
    const headerBottom = 301;
    overlays += `<div class="value-overlay header-value" style="left:${pct(330, TICKET_IMG_W)}%;top:${pct(
      headerTop,
      TICKET_IMG_H
    )}%;width:${pct(110, TICKET_IMG_W)}%;height:${pct(headerBottom - headerTop, TICKET_IMG_H)}%;">${o.table_number}</div>`;
    overlays += `<div class="value-overlay header-value" style="left:${pct(674, TICKET_IMG_W)}%;top:${pct(
      headerTop,
      TICKET_IMG_H
    )}%;width:${pct(140, TICKET_IMG_W)}%;height:${pct(headerBottom - headerTop, TICKET_IMG_H)}%;">${partySize || ""}</div>`;

    // 金額合計 value — the merged box spanning the last 2 rows (rows[26..27]).
    const totalTop = ROW_POINTS[ROW_POINTS.length - 3];
    const totalBottom = ROW_POINTS[ROW_POINTS.length - 1];
    overlays += `<div class="value-overlay total-overlay" style="left:${pct(230, TICKET_IMG_W)}%;top:${pct(
      totalTop,
      TICKET_IMG_H
    )}%;width:${pct(214, TICKET_IMG_W)}%;height:${pct(totalBottom - totalTop, TICKET_IMG_H)}%;">NT$${o.total}</div>`;

    // Menu items that don't fit in their category's reserved photo rows
    // (added to the live menu after the photo was taken) — printed in a
    // small appendix below the photo instead of being silently dropped.
    const extraItems = [...leftBuild.extra, ...rightBuild.extra];
    let extraHtml = "";
    if (extraItems.length) {
      extraHtml =
        `<div class="extra-title">추가 메뉴 (사진 양식에 없음)</div><table class="extra-table">` +
        extraItems
          .map((item) => {
            const ord = orderedMap[item.id];
            return `<tr class="${ord ? "ordered" : ""}"><td class="code">${item.code || ""}</td><td class="name">${
              item.name_zh || item.name_ko
            }</td><td class="price">${item.price}</td><td class="qty">${ord ? tallyMark(ord.qty) : ""}</td></tr>`;
          })
          .join("") +
        `</table>`;
    }

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@700;900&display=swap" />
<style>
  @page { size: A4; margin: 6mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
  body { font-family: "Noto Sans TC", "PMingLiU", sans-serif; margin: 0; padding: 0; color: #000; }
  .ticket-photo-wrap { position: relative; width: 100%; }
  .ticket-photo-wrap img { width: 100%; display: block; }
  .value-overlay, .tally-overlay {
    position: absolute; display: flex; align-items: center; justify-content: center;
    font-weight: 900; color: #c0161f; line-height: 1;
  }
  /* Sized in vw (relative to the printed page width) rather than a fixed
     px, so they scale with the photo the same way regardless of paper
     size — 3.76vw was measured directly off the "金額合計" label's own
     printed character height, so the total lines up with it exactly. */
  .value-overlay { font-size: 3.6vw; justify-content: center; }
  .total-overlay { font-size: 3.76vw; }
  .tally-overlay { display: flex; align-items: center; justify-content: center; gap: 1px; flex-wrap: wrap; transform: translateX(-10px); }
  .tally-glyph { width: 5.2vw; height: 2.2vw; overflow: visible; }
  .tally-glyph-single { height: 1.1vw; }
  .extra-title { margin-top: 4mm; font-weight: 900; font-size: 13px; }
  .extra-table { width: 100%; border-collapse: collapse; margin-top: 2mm; }
  .extra-table td { border: 1px solid #000; padding: 1mm 2mm; font-size: 11px; }
  .extra-table .qty { color: #c0161f; font-weight: 900; text-align: center; }
  .extra-table tr.ordered td { background: #ffe9a8; }
  .row-note { font-size: 10px; color: #333; }
  .print-time { text-align: center; font-size: 9px; color: #555; margin-top: 3mm; }
</style>
</head><body>
  <div class="ticket-photo-wrap">
    <img src="${location.origin}/images/kitchen-ticket-template.jpg" />
    ${overlays}
  </div>
  ${extraHtml}
  ${o.note ? `<div class="row-note" style="margin-top:2mm;">주문 메모: ${o.note}</div>` : ""}
  <div class="print-time">${time}</div>
</body></html>`;
  }

  function printKitchenTicket(o) {
    let iframe = document.getElementById("ticketPrintFrame");
    if (!iframe) {
      iframe = document.createElement("iframe");
      iframe.id = "ticketPrintFrame";
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      document.body.appendChild(iframe);
    }
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(buildTicketHtml(o));
    doc.close();

    // Wait for both the Noto Sans TC webfont AND the ticket photo itself
    // to finish loading before printing — otherwise the print can fire on
    // a still-blank page (image not painted yet / font not arrived yet,
    // the latter silently rendering some less-common Chinese characters
    // blank instead of falling back to a font that has them).
    const triggerPrint = () => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    };
    const fontsReady = doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve();
    const img = doc.querySelector(".ticket-photo-wrap img");
    const imgReady =
      img && !img.complete
        ? new Promise((resolve) => {
            img.addEventListener("load", resolve, { once: true });
            img.addEventListener("error", resolve, { once: true });
          })
        : Promise.resolve();
    Promise.race([Promise.all([fontsReady, imgReady]), new Promise((resolve) => setTimeout(resolve, 4000))]).then(() =>
      setTimeout(triggerPrint, 50)
    );
  }

  // Opens the exact same ticket HTML in a new tab, without triggering the
  // print dialog — a fast way to check tally-mark alignment/sizing after a
  // tweak without needing to actually print a physical page each time.
  function previewKitchenTicket(o) {
    const win = window.open("", "_blank");
    if (!win) return; // popup blocked — nothing we can do without a click gesture, which this already is
    win.document.open();
    win.document.write(buildTicketHtml(o));
    win.document.close();
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
            <span>${itemName(it)} ${it.option_choice ? `(${it.option_choice})` : ""} x${it.qty}${it.note ? `<br/><small style="color:#999;">${T("memoLabel")}: ${it.note}</small>` : ""}</span>
            <span>NT$${it.unit_price * it.qty}</span>
          </div>`
      )
      .join("");
    $("#orderDetailBody").innerHTML = `
      <h2>${T("tableLabel")} ${o.table_number}</h2>
      <p style="color:#999;font-size:13px;">${time} · ${T("statusTh")}: ${statusLabel(o.status)}</p>
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
    $("#f_options").value = item?.options || "";
    $("#f_is_spicy").checked = !!item?.is_spicy;
    $("#f_is_signature").checked = !!item?.is_signature;
    $("#f_available").checked = item ? !!item.available : true;
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
      options: $("#f_options").value.trim() || null,
      is_spicy: $("#f_is_spicy").checked,
      is_signature: $("#f_is_signature").checked,
      available: $("#f_available").checked,
    };
    if (!payload.name_zh) {
      alert(T("alertMenuNameRequired"));
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
    if (!confirm(T("confirmDeleteItem"))) return;
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
      const partyBadge = t.party_size ? `<div class="table-party-badge">${fmtPartyCount(t.party_size)}</div>` : "";
      const delBtn = canTableEdit() ? `<button class="del-btn" title="${T("tableDelTitle")}">✕</button>` : "";
      chip.innerHTML = `${delBtn}<div class="num">${t.label || t.number}</div>${partyBadge}${badge}`;
      if (canTableEdit()) {
        chip.querySelector(".del-btn").onclick = async (e) => {
          e.stopPropagation();
          if (!confirm(fmtConfirmDeleteTable(t.number))) return;
          await fetch(`/api/tables/${t.id}`, { method: "DELETE" });
          loadTables();
        };
      }
      chip.onclick = () => openTableDetail(t.number, t.label);
      wrap.appendChild(chip);
    });
  }

  function openTableDetail(tableNumber, label) {
    openTableNumber = tableNumber;
    const table = tables.find((t) => String(t.number) === String(tableNumber));
    const tableOrders = activeOrdersForTable(tableNumber);
    const unpaidOrders = tableOrders.filter((o) => o.status !== "paid");
    const unpaidTotal = unpaidOrders.reduce((s, o) => s + o.total, 0);
    const partyText = table && table.party_size ? ` · ${fmtPartyCount(table.party_size)}` : "";
    const payAllBtn = unpaidOrders.length
      ? `<button class="primary-btn pay-all-btn" style="padding:6px 14px;font-size:12px;">${T("payAllBtn")}</button>`
      : "";
    const header = `
      <h2>${T("tableLabel")} ${label || tableNumber}${partyText}</h2>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:-6px;">
        <p style="color:var(--muted);font-size:13px;margin:0;">${T("unpaidTotalLabel")} <strong>NT$${unpaidTotal}</strong></p>
        ${payAllBtn}
      </div>
    `;
    const body = tableOrders.length
      ? tableOrders.map((o) => renderTableOrderBlock(o)).join("")
      : `<p style="color:var(--muted);padding:20px 0;text-align:center;">${T("noOrdersYetAdmin")}</p>`;
    const footer = tableOrders.length
      ? `
        <div style="display:flex;justify-content:space-between;align-items:center;border-top:2px solid var(--ink);margin-top:4px;padding-top:12px;">
          <p style="font-size:15px;margin:0;">${T("unpaidTotalLabel2")} <strong>NT$${unpaidTotal}</strong></p>
          ${payAllBtn}
        </div>
      `
      : "";
    $("#tableDetailBody").innerHTML = header + body + footer;
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
          if (!confirm(fmtConfirmPayAll(label || tableNumber, unpaidOrders.length))) return;
          await Promise.all(unpaidOrders.map((o) => updateOrderStatus(o.id, "paid")));
          await loadOrders();
          openTableDetail(tableNumber, label);
        };
      });
    $("#tableDetailBackdrop").hidden = false;
  }

  function renderTableOrderBlock(o) {
    const time = new Date(o.created_at.replace(" ", "T")).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    const itemsHtml = o.items
      .map(
        (it) =>
          `<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;">
            <span>${itemName(it)}${it.option_choice ? ` (${it.option_choice})` : ""} x${it.qty}${it.note ? `<br/><small style="color:var(--muted);">${T("memoLabel")}: ${it.note}</small>` : ""}</span>
            <span>NT$${it.unit_price * it.qty}</span>
          </div>`
      )
      .join("");
    const nextBtn = NEXT_STATUS[o.status]
      ? `<button class="primary-btn" style="padding:6px 12px;font-size:12px;" data-advance-id="${o.id}" data-advance-to="${NEXT_STATUS[o.status]}">${nextLabel(o.status)}</button>`
      : "";
    return `
      <div style="border-top:1px solid var(--line);padding:12px 0;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-weight:700;font-size:13px;">${time} · ${statusLabel(o.status)}</span>
          ${nextBtn}
        </div>
        ${itemsHtml}
        ${o.note ? `<p style="font-size:12px;color:var(--muted);margin:6px 0 0;">${T("orderMemoLabel")}: ${o.note}</p>` : ""}
        <div style="text-align:right;font-weight:700;font-size:13px;margin-top:4px;">${T("subtotalLabel")} NT$${o.total}</div>
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
      <span>${t.label || t.number}</span>${t.party_size ? `<span class="tb-party">👥${t.party_size}</span>` : ""}
    `;
    container.appendChild(el);

    if (canTableEdit()) {
      el.querySelector(".table-unassign").onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(fmtConfirmUnassignTable(t.label || t.number))) return;
        await fetch(`/api/tables/${t.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ zoneId: null }),
        });
        t.zone_id = null;
        renderFloorPlan();
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
          t.x = x;
          t.y = y;
          await fetch(`/api/tables/${t.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ x, y }),
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
          t.width = width;
          t.height = height;
          await fetch(`/api/tables/${t.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ width, height }),
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
            z.name = name.trim();
            el.querySelector(".zone-label").textContent = z.name;
            await fetch(`/api/zones/${z.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: z.name }),
            });
          }
        };
        el.querySelector(".zone-add-btn").onclick = (e) => {
          e.stopPropagation();
          addTableToZone(z);
        };
        el.querySelector(".zone-del").onclick = async (e) => {
          e.stopPropagation();
          if (!confirm(fmtConfirmDeleteZone(z.name))) return;
          await fetch(`/api/zones/${z.id}`, { method: "DELETE" });
          tables.filter((t) => t.zone_id === z.id).forEach((t) => (t.zone_id = null));
          await loadZones();
          renderFloorPlan();
        };

        makeDraggable(el, {
          onEnd: async (x, y) => {
            z.x = x;
            z.y = y;
            await fetch(`/api/zones/${z.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ x, y }),
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
            z.width = width;
            z.height = height;
            await fetch(`/api/zones/${z.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ width, height }),
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
  };
  $("#viewFloorBtn").onclick = async () => {
    $("#viewFloorBtn").classList.add("active");
    $("#viewListBtn").classList.remove("active");
    $("#tablesList").hidden = true;
    $("#floorPlanWrap").hidden = false;
    $("#addZoneBtn").hidden = false;
    await loadZones();
    renderFloorPlan();
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
    if (!number) return alert(T("alertTableNumberRequired"));
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
        alert(T("alertUnluckyNumber"));
      } else {
        alert(T("alertTableExists"));
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
    };
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
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
  const PERMISSION_KEYS = ["menuEdit", "tableEdit", "settingsEdit", "orderCancel", "reservationManage"];

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
    if (!confirm(T("lineRemoveConfirm"))) return;
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
    if (!confirm(T("reservationDeleteConfirm"))) return;
    await fetch(`/api/reservations/${editingReservationId}`, { method: "DELETE" });
    $("#reservationModalBackdrop").hidden = true;
    loadReservations($("#reservationDateFilter").value || undefined);
  };

  applyAdminI18n();
  checkAuth();
})();
