(function () {
  const tableNumber = decodeURIComponent(location.pathname.split("/t/")[1] || "").trim();
  // Always defaults to Chinese (this is a Taiwan restaurant) — not persisted
  // across page loads, so every fresh scan starts back at the default. A
  // fresh load happens naturally once a table is settled and re-scanned by
  // the next party (see the inactivity lock + party-size prompt above).
  let lang = "zh";
  // Defaults to Taiwan dollars (this is a Taiwan restaurant) — same
  // reset-on-fresh-load behavior as language, in case a customer changed it
  // and moved on before the next party scans the QR code.
  let currency = "TWD";
  let categories = [];
  let cart = []; // { itemId, qty, option, spice, note, orderType, addons, item }

  // 담긴 것 한 벌을 가리키는 표.
  //
  // 2026-09-14 사장님: "폰주문시 주문송출버튼 누르면 로딩이라는 화면없이 그냥
  // 잠깐 멈추고 있어. 그래서 다시 누르게 되는데" — 오늘 52건 중 6건.
  //
  // 화면에서 버튼을 잠그는 것만으로는 부족하다. 손님 폰이 답을 잃어버리면
  // 「보냈는데 못 받은」 상태가 되고, 그때 다시 누르는 것은 잘못이 아니다.
  // 그래서 서버가 같은 표를 두 번 받으면 두 번째는 새로 만들지 않고 처음
  // 만든 주문을 그대로 돌려준다 (src/routes/orders.js).
  //
  // 담긴 것이 바뀌면 표도 바뀐다 — 같은 것을 일부러 한 번 더 시키는 손님을
  // 막으면 안 되고, 그건 담긴 것을 다시 채우는 일이기 때문이다.
  let cartToken = newCartToken();
  let submitting = false;

  function newCartToken() {
    try {
      if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    } catch (e) {
      /* 오래된 WebView */
    }
    return (
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 10) +
      Math.random().toString(36).slice(2, 10)
    );
  }

  // Mirrors src/addons.js's server-side parser exactly — a menu item's
  // `addons` field is "Name:Price" pairs separated by commas (e.g.
  // "볶음밥 추가:80,사리면 추가:50", or a free swap like "飯換冬粉:0").
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
  function addonsPriceFor(item, selectedNames) {
    if (!selectedNames || selectedNames.length === 0) return 0;
    const available = parseAddons(item && item.addons);
    return selectedNames.reduce((sum, name) => {
      const match = available.find((a) => a.name === name);
      return sum + (match ? match.price : 0);
    }, 0);
  }
  // 牛/豬 (beef/pork) face icons, cropped directly from the restaurant's own
  // PDF menu (public/images/cow-face.png, pig-face.png) for guaranteed
  // pixel-identical rendering everywhere — originally plain 🐂/🐷 Unicode
  // emoji, replaced once the owner pointed out the emoji rendered as a
  // side-profile animal on some fonts/platforms instead of the front-facing
  // head the printed menu shows ("소 옆 모습말고 pdf 그대로").
  //
  // Used two different ways, deliberately not the same function:
  //  - optionIconHtml(): the image, for an at-a-glance badge next to a dish's
  //    NAME (menu list, item sheet title) — nothing to choose there, just a
  //    quick visual "this dish has a meat choice" ("사진은 간단히 확인하라고
  //    있는거").
  //  - optionLabel(): plain text, for the actual option buttons a customer
  //    picks from — the owner asked these stay text, not images, since a
  //    control you're actively selecting needs to read unambiguously
  //    ("선택해서 하는 건 확실하게 글로 해야 돼"). The raw stored value is
  //    already the dish's real option text (牛/豬, same as any other option
  //    like 鮪魚/蝦仁 on 오므라이스), so this is a no-op today — kept as a
  //    function in case a future option value ever needs localizing.
  const OPTION_ICONS = { "牛": "cow-face.png", "豬": "pig-face.png" };
  const optionIconHtml = (raw) =>
    OPTION_ICONS[raw] ? `<img class="option-icon" src="/images/${OPTION_ICONS[raw]}" alt="${raw}">` : "";
  const optionLabel = (raw) => raw;
  let currentItem = null;
  let currentOption = null;
  let currentSpiceOption = null;
  // 부대찌개(部隊鍋) 등 일부 메뉴가 "포장(外帶)"으로 주문될 때만 고를 수
  // 있는 옵션(예: 不煮外帶/조리하지 않은 포장 vs 煮熟外帶/조리한 포장) —
  // 사장님 메모(2026-09-07). item.takeout_options에 콤마로 저장되고,
  // currentOrderType이 "takeout"일 때만 #itemTakeoutOptions가 보인다(위
  // openItemSheet/updateTakeoutOptionsVisibility 참고). 매장 식사에는
  // 의미가 없는 선택이라(가게에서 먹을 땐 늘 조리해서 나감) item.options
  // 처럼 항상 보이는 일반 옵션과는 별개로 관리한다.
  let currentTakeoutOption = null;
  // Multi-select extras (사리면 추가, 밥→당면 교체 등) currently checked in the
  // item sheet — array of addon name strings. See parseAddons() below,
  // which mirrors src/addons.js's server-side parser exactly so the price
  // shown here always matches what the server will actually charge.
  let currentAddons = [];
  // 매장(dine-in) vs 포장(takeout) — chosen per dish (see the
  // #itemOrderTypeTabs pill inside the item detail sheet), since a single
  // order can now mix dine-in and takeout items — e.g. eating here but
  // taking dessert home. Reset to "dine_in" every time openItemSheet() opens
  // for a fresh item, same as currentOption/currentSpiceOption above, and
  // carried onto the cart line itself (not a page-wide setting) when added.
  let currentOrderType = "dine_in";
  let currentQty = 1;
  let mixQty = {}; // { optionLabel: qty } — used instead of currentQty for mix_options items
  let activeOrderId = null;
  // Whether this table already has an order in flight (from this phone or
  // any other phone at the same table — see checkPriorOrder). Drives the
  // griddle items' first-order minimum (see min_first_order_qty below).
  // Defaults to false (= "treat as first order") so the safe direction on a
  // slow/failed check is asking for the minimum, not silently skipping it.
  let hasPriorOrder = false;
  let searchTerm = "";
  let statusPollTimer = null;
  let storeLat = null;
  let storeLng = null;
  let partySize = null;
  // 어른(大)/아이(小) — 2026-09-10 사장님: "인원수 물을 때 어른(大), 아이(小)
  // 묻기". partySize 는 계속 총원이고(결산·빌지가 그대로 쓴다), 아래 둘은
  // 그 안의 내역이다. 구분이 생기기 전에 앉은 손님은 서버가 전부 어른으로
  // 채워 내려준다.
  let partyAdults = null;
  let partyChildren = null;
  let onlinePaymentEnabled = false;

  // 지금 손님이 주문할 수 있는 시간인가 — 서버(/api/settings 의 ordering)가
  // 정해서 내려준다. 여기서 직접 시각을 재지 않는 이유: 기준이 손님 폰의
  // 시계가 되어버린다. 시계가 어긋난 폰 하나 때문에 주문이 되거나 안 되고,
  // 여행 온 손님 폰은 아예 다른 시간대일 수도 있다.
  // enabled 가 false 면(사장님이 안 켰거나 설정이 이상하면) 아무것도 막지
  // 않는다 — 못 막는 것보다 잘못 막는 게 훨씬 비싸다(src/openHours.js).
  let ordering = { enabled: false, open: true };

  // 지금 이 화면을 보는 사람이 로그인한 직원인가. 수기 주문은 이 페이지를
  // 그대로 열기 때문에(관리자 > 수기 주문), 영업시간 밖에 여기가 잠기면
  // 직원도 같이 묶인다. 사장님(2026-09-10): "직원들이 직접 앱에서 수동
  // 주문을 할 때는 가능할 수 있도록."
  let isStaffSession = false;

  // 자리 이동 안내가 「내 것」인지 가리는 데 쓰는 표시. refreshTableState 가
  // 이 값을 읽으므로 선언이 위에 있어야 한다.
  const SEAT_KEY = `hgk_seat_${tableNumber}`;
  let movedNoticeShown = false;

  // 이 자리에 생긴 일을 바로 받아보는 통로(Pusher). 연결돼 있으면 폰이
  // 주기적으로 물어볼 필요가 없다 — 아래 setInterval 이 이 값을 본다.
  let realtimeCfg = null;
  let realtimeChannelName = null;
  let realtimeTableConnected = false;
  let realtimeTableClient = null;
  // True when this QR points at the counter's takeout-only order flow
  // instead of a real dine-in table (see the "포장 카운터" section in Admin >
  // 테이블 / QR 코드) — set once initPartySize() learns it from the server.
  // Skips the headcount prompt entirely and defaults every item to 포장.
  let isCounterTable = false;
  // 이 QR 이 가리키는 자리가 서버에 없다. 자리를 정리하면 이미 손님 손에
  // 나가 있던 옛 QR 이 이 상태가 된다 — 2026-09-10 에 포장 손님이 들어오던
  // 「테이블 0」 을 없애면서 실제로 생긴다.
  //
  // 이때 아무것도 안 하면 화면은 인원수부터 묻고, 손님이 답하면 그것도
  // 실패하고, 주문을 누르면 "인원수를 먼저 입력해주세요" 가 뜬다. 손님은
  // 자기가 뭘 잘못한 줄 알고 그 자리에서 몇 번을 다시 해본다. 그럴 바에는
  // 첫 화면에서 분명히 말하는 게 낫다.
  let tableGone = false;
  // Required pickup name for a counter/takeout order — collected via
  // #counterNameBackdrop (see showCounterNameModal below) instead of the
  // headcount prompt real tables get.
  let counterCustomerName = null;
  let counterCustomerPhone = null;

  // ---------- Membership (회원/VIP) — optional Google sign-in ----------
  // Firebase Authentication only; all real data (VIP cards, discounts,
  // orders) stays in the existing MongoDB — see src/firebaseAdmin.js and
  // src/routes/members.js. Ordering never requires any of this: every
  // variable below just stays at its default (signed out, no membership)
  // when the store hasn't configured firebaseConfig yet, or a customer
  // never signs in.
  let firebaseAuth = null;
  // { name, email } once signed in via Google, else null.
  let memberUser = null;
  // The linked VIP card's public shape from GET /api/members/me, e.g.
  // { card_number, discount_percent, issue_date, expiry_date, active }, or
  // null when signed in but no card is linked yet.
  let membership = null;
  let membershipInitAttempted = false;
  // 低消 — 이 자리가 채워야 할 금액과 지금까지 쓴 금액.
  //
  // **서버가 계산해서 내려보낸다**(GET /api/tables/:n/party-size,
  // src/minSpend.js). 화면이 스스로 계산하면 같은 규칙이 두 군데 있게 되고,
  // 언젠가 한쪽만 고쳐져서 손님 폰과 계산대가 다른 금액을 말하게 된다.
  let minSpendPerPerson = 0;
  let minSpendRequired = 0;


  // 문구 안에 직접 박히는 금액에도 쉼표를 찍는다(아래 money() 와 같은 규칙).
  // 여기는 통화 기호를 문구가 직접 들고 있어서 money() 를 못 쓴다.
  const comma = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString("en-US") : n);

  /**
   * 「하나만 고르는 옵션」을 읽는다. 「이름:금액」, 금액은 없으면 0.
   *
   * 2026-09-16 사장님: 크기(S/M/L/XL)처럼 **하나만 고르면서 값이 붙는**
   * 옵션이 필요하다. 여러 개 고르는 옵션(addons)으로 넣으면 손님이 M 과 L 을
   * 같이 고를 수 있어서 안 된다.
   *
   * 읽는 규칙은 addons 와 똑같다(src/addons.js parseOptions) — 두 화면이
   * 같은 값을 봐야 부르는 금액과 실제로 받는 금액이 안 갈린다. 금액을 안
   * 적으면 0 이라, 지금까지 쓰던 "牛,豬" 는 그대로 돈다.
   */
  function parseOptions(str) {
    if (!str) return [];
    return String(str)
      .split(",")
      .map((pair) => {
        const [name, priceStr] = pair.split(":");
        const trimmed = (name || "").trim();
        const price = parseInt((priceStr || "0").trim(), 10);
        return trimmed ? { name: trimmed, price: Number.isNaN(price) ? 0 : price } : null;
      })
      .filter(Boolean);
  }
  /** 옵션 이름만. 값이 붙어 있어도 이름만 돌려준다. */
  const optionNames = (str) => parseOptions(str).map((o) => o.name);
  /** 지금 고른 옵션의 값. 못 찾으면 0 — 서버도 같은 판단을 한다. */
  /** 담긴 줄의 옵션 값. currentOptionPrice 는 지금 고르는 중인 것을 본다. */
  function optionPriceIn(item, name) {
    if (!item || !name) return 0;
    const found = parseOptions(item.options).find((o) => o.name === name);
    return found ? found.price : 0;
  }
  function currentOptionPrice(item) {
    if (!item || !currentOption) return 0;
    const found = parseOptions(item.options).find((o) => o.name === currentOption);
    return found ? found.price : 0;
  }

  // 사장님이 주신 문구 그대로다(2026-09-11). 금액만 설정에서 가져온다 —
  // 여기에 200을 박아두면 설정을 바꿔도 안내문만 옛 금액으로 남는다.
  const MIN_SPEND_NOTICE = {
    zh: (n) => `大人及13歲以上兒童，每人低消${comma(n)}元；13歲以下免低消。`,
    ko: (n) => `어른과 13세 이상 어린이는 1인당 최소 주문 금액이 NT$${comma(n)} 입니다. 13세 이하는 해당되지 않습니다.`,
    en: (n) => `Minimum NT$${comma(n)} per person for adults and children aged 13 and over. Under 13 exempt.`,
  };

  // 규칙만 적어두면 손님은 얼마를 더 담아야 하는지 직접 계산해야 한다.
  // 이미 시킨 라운드까지 합친 금액과 모자란 금액을 같이 적어준다.
  const MIN_SPEND_SHORTFALL = {
    zh: (have, need) => `目前 NT$${comma(have)} / 需要 NT$${comma(need)}（還差 NT$${comma(need - have)}）`,
    ko: (have, need) => `지금 NT$${comma(have)} / 필요 NT$${comma(need)} (NT$${comma(need - have)} 부족)`,
    en: (have, need) => `Now NT$${comma(have)} of NT$${comma(need)} (NT$${comma(need - have)} to go)`,
  };

  // Shown when trying to add a griddle (불판) item below its
  // min_first_order_qty on the table's first order (see openItemSheet /
  // addToCartBtn below, and the matching server check in
  // src/routes/orders.js).
  const GRILL_MIN_MSG = {
    zh: (n) => `首次點餐這道菜至少要 ${n} 份（可自由搭配比例）`,
    ko: (n) => `첫 주문에서는 이 메뉴를 최소 ${n}인분 담아야 해요 (비율은 자유롭게 조절 가능)`,
    en: (n) => `On your first order, this dish needs at least ${n} servings total (mix the ratio however you like)`,
  };

  // 직원이 단말기에서 들어온 수기 주문인가 (admin.js 의 수기 주문 버튼이
  // ?fromAdmin=1 을 붙인다). 손님이 벽의 QR 로 들어온 화면에는 절대 안 붙는다.
  const fromAdmin = new URLSearchParams(location.search).get("fromAdmin") === "1";

  // 주문을 넣고 나면 관리자 화면으로 **저절로** 돌아간다.
  //
  // 2026-09-14 사장님: "단말기로 수기주문완료후 실시간주문탭으로 자동
  // 복귀되도록."
  //
  // 이 화면은 직원이 손님 대신 주문을 넣으려고 잠깐 들어온 곳이다. 넣고 나면
  // 볼 일이 없는데 지금까지는 「관리자로」를 직접 눌러야 했다. /admin 은 열
  // 때마다 실시간 주문 탭에서 시작하므로(admin.html 의 .admin-tabs), 그냥
  // 돌아가면 사장님이 말한 그 탭이다.
  //
  // 곧바로 튕기지는 않는다. 넣자마자 화면이 사라지면 들어갔는지 못 본다.
  // 완료 화면을 잠깐 보여주고 돌아간다.
  const ADMIN_RETURN_MS = 1500;
  const ADMIN_RETURN_NOTE = {
    zh: "即將返回管理畫面…",
    ko: "관리자 화면으로 돌아갑니다…",
    en: "Returning to the admin screen…",
  };
  // 2026-09-16 사장님: "주문하고 뜨는 이걸 실시간 주문 탭으로 이동으로
  // 바꿔줘." 기다리지 않고 바로 갈 수 있어야 한다.
  const ADMIN_ORDERS_BTN = {
    zh: "前往即時訂單",
    ko: "실시간 주문 탭으로 이동",
    en: "Go to live orders",
  };
  // 실시간 주문 탭을 **못 박아서** 부른다. /admin 이 지금은 그 탭에서
  // 시작하지만, 나중에 기본 탭이 바뀌면 이 약속이 조용히 깨진다.
  const ADMIN_ORDERS_URL = "/admin#orders";
  /**
   * 관리자 화면으로 돌아간다.
   *
   * 두 가지 길로 여기 온다.
   *  · 키오스크 앱: window.open 이 막혀 있어 같은 화면에서 이동해 왔다.
   *    그대로 /admin 으로 이동하면 된다.
   *  · 보통 브라우저: 새 탭으로 열려 왔다(window.opener 가 있다). 이 탭을
   *    닫는 것이 맞다 — 안 그러면 관리자 화면이 두 개가 된다. 닫기가
   *    막힌 경우를 대비해 조금 뒤 이동으로 넘어간다.
   */
  function goBackToAdmin() {
    if (window.opener) {
      try {
        window.close();
      } catch (e) {
        /* 닫기가 막힌 브라우저 */
      }
      setTimeout(() => {
        location.href = ADMIN_ORDERS_URL;
      }, 300);
      return;
    }
    location.href = ADMIN_ORDERS_URL;
  }

  const SEATING_STALE_MSG = {
    zh: "這個畫面是上一位客人開啟的。已為您重新整理，請再點一次餐。",
    ko: "이 화면은 앞 손님이 열어두신 것이에요. 새로 불러올게요. 다시 주문해 주세요.",
    en: "This page was opened by a previous guest. Reloading — please order again.",
  };

  // 맵기 목록에는 늘 기본 칸이 맨 앞에 있다. 저장된 데이터에서 빠져 있어도
  // 화면에서 채워 넣는다 — 그래야 아무것도 안 건드린 손님에게 매운 것이
  // 나가는 일이 없다(openItemSheet 주석).
  //
  // 「무엇이 기본 칸인가」는 public/js/spice.js 한 곳에서 정한다. 손님 화면과
  // 빌지가 서로 다르게 판단하면, 화면에는 안 매운 것으로 보이는데 주방에는
  // 매운 것으로 나간다.
  const SPICE_BASIC = window.HG_SPICE.BASIC;
  function spiceOptionsOf(item) {
    return window.HG_SPICE.optionsOf(item && item.spice_options);
  }

  const $ = (sel) => document.querySelector(sel);
  const t = (key) => (I18N[lang] && I18N[lang][key]) || I18N.zh[key] || key;
  const LANG_PILL_LABEL = { zh: "中文", ko: "한국어", en: "English" };
  const CURRENCY_SYMBOL = { TWD: "NT$", KRW: "₩", USD: "US$" };

  function nameFor(obj) {
    return obj[`name_${lang}`] || obj.name_zh || obj.name_en || obj.name_ko || "";
  }
  function descFor(obj) {
    return obj[`desc_${lang}`] || "";
  }

  function applyStaticI18n() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    $("#tableBadge").textContent = isCounterTable ? t("counterBadge") : `${t("table")} ${tableNumber}`;
    $("#langPillLabel").textContent = LANG_PILL_LABEL[lang] || "Language";
    document.querySelectorAll(".lang-option").forEach((b) => {
      if (b.dataset.lang) b.classList.toggle("active", b.dataset.lang === lang);
      if (b.dataset.currency) b.classList.toggle("active", b.dataset.currency === currency);
    });
    $("#currencyPillLabel").textContent = CURRENCY_SYMBOL[currency] || "NT$";
    // #memberBtn deliberately isn't [data-i18n] (its label depends on
    // membership.active, not just the current language) — updateMemberBtnLabel
    // and renderMemberSheet below cover its own text on every language
    // switch, same as the rest of this function covers everything else.
    updateMemberBtnLabel();
    renderMemberSheet();
  }

  /**
   * 돈 한 덩이. 천 자리마다 쉼표.
   *
   * 2026-09-16 사장님: "모든 돈이 표시되는 액수에는 천 자리수마다 , 를
   * 표시해줘 1,000 이렇게." NT$7120 과 NT$712 는 흘깃 보면 같아 보인다.
   *
   * 이 화면의 금액은 전부 이 함수를 지난다 — 통화 기호도 여기서 붙는다.
   * 숫자가 아닌 것이 오면 그대로 둔다. 지어내지 않는다.
   */
  // 품목 한 줄의 금액 — 밥값 × 수량 + 고른 옵션 값 + 추가 옵션 값.
  // 옵션 값은 **수량을 안 곱한다**(src/discounts.js lineTotalOf, 2026-09-16
  // 사장님: "가격에 넣은 그 액수만큼 올라가게 해줘. 최소 주문 관련 없이").
  function lineTotalOf(it) {
    const optPrice = Number((it && it.option_price) || 0) || 0;
    const addons = ((it && it.selected_addons) || []).reduce((s, a) => s + (a.price || 0), 0);
    return (it.unit_price || 0) * (it.qty || 0) + optPrice + addons;
  }

  function money(n) {
    const num = Number(n);
    const shown = Number.isFinite(num) ? num.toLocaleString("en-US") : n;
    return `${CURRENCY_SYMBOL[currency] || "NT$"}${shown}`;
  }

  // Set-discount price display (e.g. 신라면 김밥세트: original_price is what
  // the items would cost bought separately, price is the set's discounted
  // total) — shows the crossed-out original price plus how much is saved,
  // so the discount is obvious at a glance instead of just a lower number.
  function priceHtml(item) {
    if (item.original_price && item.original_price > item.price) {
      const off = item.original_price - item.price;
      return `<span class="item-price-original">${money(item.original_price)}</span> ${money(item.price)}<span class="item-discount-badge">-${money(off)}</span>`;
    }
    return money(item.price);
  }

  // Meat-type / allergen badges (see public/js/allergens.js for the shared
  // ALLERGENS list) — `compact` renders icon-only pills for the menu list
  // row, the full version (icon + label) is used in the item detail sheet.
  function allergenBadgesHtml(item, compact) {
    const ids = item.allergens || [];
    if (!ids.length) return "";
    const defs = (window.ALLERGENS || []).filter((a) => ids.includes(a.id));
    if (!defs.length) return "";
    return defs
      .map((a) => {
        const label = a[lang] || a.zh;
        return compact
          ? `<span class="allergen-badge allergen-badge-compact" title="${label}">${a.icon}</span>`
          : `<span class="allergen-badge">${a.icon} ${label}</span>`;
      })
      .join("");
  }

  let toastTimer = null;
  function showToast(msg) {
    const el = $("#toastBanner");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
  }

  // 사장님이 적은 글을 innerHTML 에 그대로 넣지 않는다. 지금은 관리자만
  // 적을 수 있는 칸이지만, 화면에 그리는 자리에서 막아두는 편이 낫다.
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  /** 지금이 영업시간 밖인가 — 사실 그 자체. 직원인지와 무관하다. */
  function orderingClosedForCustomers() {
    return !!(ordering && ordering.enabled && !ordering.open);
  }

  /**
   * 이 화면에서 주문을 막아야 하는가. 직원은 막지 않는다 — 없어진 자리만
   * 예외다. 그 자리는 직원이 대신 눌러도 서버가 받지 않으므로, 열어두면
   * 직원만 한 번 더 헛걸음한다.
   */
  function orderingClosed() {
    if (tableGone) return true;
    return orderingClosedForCustomers() && !isStaffSession;
  }

  /** "오늘 17:00" / "내일 11:00" / "09/15 11:00" — 며칠 뒤인지는 서버가 센다. */
  function nextOpenLabel() {
    if (!ordering || !ordering.next_open_at) return "";
    const time = ordering.next_open_at.slice(11, 16);
    if (ordering.next_open_days === 0) return `${t("closedTodayWord")} ${time}`;
    if (ordering.next_open_days === 1) return `${t("closedTomorrowWord")} ${time}`;
    return `${ordering.next_open_at.slice(5, 10).replace("-", "/")} ${time}`;
  }

  /** 알림창 한 줄로 쓸 문구 — 주문을 눌렀는데 그 사이 영업이 끝난 경우. */
  function closedMessage() {
    const parts = [t("closedTitle")];
    if (ordering && ordering.today_note) parts.push(ordering.today_note);
    if (ordering && ordering.today_closed) parts.push(t("closedTodayHoliday"));
    const when = nextOpenLabel();
    if (when) parts.push(`${t("closedNextOpenLabel")} ${when}`);
    else if (ordering && ordering.ranges_text) parts.push(`${t("closedHoursLabel")} ${ordering.ranges_text}`);
    return parts.join("\n");
  }

  /**
   * 영업시간 밖이면 띠를 띄우고 담기·주문 버튼을 잠근다.
   *
   * 메뉴 자체는 그대로 둔다 (사장님: "메뉴는 보이고 주문만 잠금"). 지나가다
   * QR 을 찍은 손님이 뭘 파는지는 볼 수 있어야 한다.
   *
   * 이건 어디까지나 화면일 뿐이고, 진짜로 막는 건 서버다
   * (src/routes/orders.js). QR 주소는 테이블마다 종이에 인쇄돼 있어서
   * 화면만 잠그면 주소를 아는 사람에게는 아무 의미가 없다.
   */
  function applyOrderingState() {
    const closed = orderingClosed();
    const banner = $("#closedBanner");
    // 없어진 자리는 영업시간과 무관하다 — 기다린다고 열리지 않으므로
    // 영업시간 안내 대신 무엇을 하면 되는지만 적는다.
    if (tableGone) {
      banner.classList.remove("staff-mode");
      banner.innerHTML = `<b>${t("tableGoneTitle")}</b><div class="closed-sub">${t("tableGoneSub")}</div>`;
      banner.hidden = false;
      for (const id of ["#addToCartBtn", "#submitOrderBtn"]) {
        const btn = $(id);
        if (!btn) continue;
        btn.disabled = true;
        btn.classList.add("is-closed");
      }
      return;
    }
    // 직원에게는 잠그지 않되, 지금이 영업시간 밖이라는 것은 알려준다.
    // 안 알려주면 직원은 손님도 지금 주문할 수 있는 줄 안다.
    if (!closed && orderingClosedForCustomers() && isStaffSession) {
      banner.classList.add("staff-mode");
      banner.innerHTML = `<b>${t("closedStaffTitle")}</b><div class="closed-sub">${t("closedStaffSub")}</div>`;
      banner.hidden = false;
      for (const id of ["#addToCartBtn", "#submitOrderBtn"]) {
        const btn = $(id);
        if (!btn) continue;
        btn.disabled = false;
        btn.classList.remove("is-closed");
      }
      // 직원 화면은 잠기지 않으므로 여기서 물어봐야 한다.
      askSeatingIfOpen();
      return;
    }
    banner.classList.remove("staff-mode");
    if (closed) {
      const lines = [`<b>${t("closedTitle")}</b>`];
      // 요일마다 시간이 다를 수 있으니 여기 적히는 건 "오늘" 의 시간이다
      // (서버가 오늘 것으로 골라서 보낸다). 오늘이 휴무면 시간 대신 그렇게
      // 적는다 — 빈 줄을 두면 손님은 시간을 못 봤다고 생각한다.
      // 사장님이 그 날에 적어둔 이유(예: 태풍 휴무). 번역하지 않고 적힌
      // 그대로 보여준다 — 우리가 옮기면 뜻이 달라질 수 있고, 사장님은
      // 손님이 읽을 말로 적으면 된다.
      if (ordering.today_note) lines.push(escapeHtml(ordering.today_note));
      if (ordering.today_closed) lines.push(t("closedTodayHoliday"));
      else if (ordering.ranges_text) lines.push(`${t("closedHoursLabel")} ${ordering.ranges_text}`);
      const when = nextOpenLabel();
      if (when) lines.push(`${t("closedNextOpenLabel")} ${when}`);
      banner.innerHTML = `${lines.join("<br>")}<div class="closed-sub">${t("closedCallStaff")}</div>`;
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
    for (const id of ["#addToCartBtn", "#submitOrderBtn"]) {
      const btn = $(id);
      if (!btn) continue;
      btn.disabled = closed;
      btn.classList.toggle("is-closed", closed);
    }
    // 영업이 시작되면(1분마다 도는 refreshOrderingState 가 여기로 온다)
    // 그때 미뤄둔 질문을 한다.
    askSeatingIfOpen();
  }

  // 영업 시작·종료 시각을 걸치고 앉아 있는 손님이 있다. 20:58 에 페이지를
  // 열고 21:05 에 주문을 누르면 서버는 막는데 화면은 열려 있는 것처럼 보인다
  // — 그 반대(11:00 이 지났는데 화면은 계속 잠겨 있어서 손님이 나가버리는
  // 것)가 더 나쁘다. 그래서 1분마다 서버에 다시 물어본다.
  // 화면을 보고 있을 때만 물어본다 — 주머니 속 폰까지 1분마다 깨울 이유는 없다.
  async function refreshOrderingState() {
    if (document.visibilityState !== "visible") return;
    try {
      const res = await fetch("/api/settings/ordering");
      if (!res.ok) return;
      const body = await res.json();
      ordering = body;
      isStaffSession = !!body.is_staff;
      applyOrderingState();
    } catch (e) {
      // 네트워크가 잠깐 끊긴 것으로 주문을 막지는 않는다. 다음 분에 다시 묻는다.
    }
  }
  /**
   * 이 자리에 무슨 일이 생겼는지 물어본다 — 지금은 「자리가 옮겨졌는가」.
   *
   * 이건 이제 주 경로가 아니라 그물이다. 정상적인 경로는 push 다
   * (initRealtimeTable — 직원이 자리 이동을 누르는 그 순간 도착한다).
   *
   * 2026-09-10 사장님: "60초마다 갱신하는 게 아니라 그 이벤트가 발생하면
   * 그걸 인지하고 작동하는 방식으로 하면 되는 거 아니야?"
   *
   * 그래서 아래 setInterval 은 push 가 붙어 있는 동안 이 함수를 아예 부르지
   * 않는다. 부르는 경우는 둘뿐이다 — Pusher 를 아직 설정하지 않은 매장이거나
   * 연결이 끊겼을 때, 그리고 폰을 다시 집어들었을 때(잠겨 있는 동안 온
   * 이벤트는 놓쳤을 수 있으니 그 한 번은 물어보는 게 맞다).
   */
  // 이 기기를 이 자리의 지금 착석에 묶어 달라고 서버에 알린다.
  //
  // **화면을 새로 열 때 딱 한 번만 부른다.** 주기적으로 도는
  // refreshTableState 안에서 부르면 안 된다 — 앞 손님이 열어둔 채 떠 있는
  // 페이지가 다음 폴링 때 스스로 새 착석으로 다시 묶여서, 막으려던 그
  // 페이지가 통과권을 받아간다. (2026-09-10 사장님이 「이건 누구한테
  // 띄운다는거야」라고 물으신 덕분에 발견했다. 처음 구현이 그랬다.)
  //
  // 새로 여는 것은 손님이 QR 을 찍는 순간이고, 그때는 그 자리에 있다.
  // 떠 있는 페이지는 새로 열지 않는다 — 그 둘의 차이가 이 기능의 전부다.
  //
  // 실패해도 아무 말 하지 않는다. 주문할 때 서버가 다시 가린다.
  async function bindSeat() {
    if (isCounterTable) return;
    try {
      await fetch(`/api/tables/${encodeURIComponent(tableNumber)}/seat`, { method: "POST" });
    } catch (e) {
      /* 다음 기회에 */
    }
  }

  async function refreshTableState() {
    if (movedNoticeShown) return;
    if (document.visibilityState !== "visible") return;
    try {
      const res = await fetch(`/api/tables/${encodeURIComponent(tableNumber)}/party-size`);
      if (!res.ok) return;
      const data = await res.json();
      rememberSeating(data.seating_started_at);
      if (data.realtime_channel) {
        realtimeChannelName = data.realtime_channel;
        initRealtimeTable();
      }
      checkMovedTable(data.moved_to);
    } catch (e) {
      /* 다음 기회에 다시 묻는다 */
    }
  }

  /**
   * 이 자리 채널을 구독한다 — 자리 이동을 그 즉시 받는다.
   *
   * 관리자 화면이 주문 알림에 쓰는 것과 같은 Pusher 연결이다
   * (public/js/admin.js 의 initRealtimeOrders, src/realtime.js).
   *
   * 채널 이름은 서버가 정해서 내려준다(GET /api/tables/:n/party-size 의
   * realtime_channel). 여기서 직접 만들지 않는 이유는 자리 번호에 한글이나
   * 공백이 들어갈 수 있어서인데, 규칙을 양쪽에 두면 한쪽만 고쳐졌을 때
   * 안내가 영영 안 오는 쪽으로 조용히 어긋난다.
   *
   * pusher.min.js 는 필요할 때만 받아온다. 손님 화면은 식사 중에 한 번
   * 열리고 마는 화면이라, Pusher 를 안 쓰는 매장에까지 CDN 스크립트를
   * 매번 얹지 않는다.
   */
  function initRealtimeTable() {
    if (realtimeTableClient) return;
    if (!realtimeChannelName) return;
    const cfg = realtimeCfg;
    if (!cfg || !cfg.enabled || !cfg.key || !cfg.cluster) return;
    loadPusherScript(() => {
      if (realtimeTableClient || typeof Pusher === "undefined") return;
      try {
        realtimeTableClient = new Pusher(cfg.key, { cluster: cfg.cluster });
        const channel = realtimeTableClient.subscribe(realtimeChannelName);
        channel.bind("moved", (payload) => checkMovedTable(payload));
        realtimeTableClient.connection.bind("connected", () => {
          realtimeTableConnected = true;
        });
        // 끊기면 다시 물어보는 쪽으로 돌아간다 — 손님이 옮긴 걸 모르는 채로
        // 옛 자리에 주문을 넣는 것보다는 한 번씩 묻는 게 낫다.
        realtimeTableClient.connection.bind("disconnected", () => {
          realtimeTableConnected = false;
        });
        realtimeTableClient.connection.bind("unavailable", () => {
          realtimeTableConnected = false;
        });
      } catch (e) {
        realtimeTableConnected = false;
      }
    });
  }

  let pusherScriptState = null; // null | "loading" | "done"
  const pusherScriptWaiting = [];
  function loadPusherScript(done) {
    if (typeof Pusher !== "undefined" || pusherScriptState === "done") return done();
    pusherScriptWaiting.push(done);
    if (pusherScriptState === "loading") return;
    pusherScriptState = "loading";
    const el = document.createElement("script");
    el.src = "https://js.pusher.com/8.4.0/pusher.min.js";
    el.async = true;
    el.onload = () => {
      pusherScriptState = "done";
      while (pusherScriptWaiting.length) pusherScriptWaiting.shift()();
    };
    // 못 받아와도 화면은 그대로 돌아간다 — 아래 setInterval 이 물어보는
    // 쪽으로 계속 돈다.
    el.onerror = () => {
      pusherScriptState = null;
      pusherScriptWaiting.length = 0;
    };
    document.head.appendChild(el);
  }

  // 화면을 새로 여는 그 한 번. 여기서만 이 기기를 지금 착석에 묶는다
  // (bindSeat 주석 참고 — 폴링 안에서 부르면 보호가 통째로 무너진다).
  bindSeat();

  setInterval(() => {
    refreshOrderingState();
    // push 가 붙어 있으면 물어보지 않는다.
    if (!realtimeTableConnected) refreshTableState();
  }, 60000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    refreshOrderingState();
    // 잠겨 있는 동안 온 이벤트는 놓쳤을 수 있다 — 켤 때 한 번은 확인한다.
    refreshTableState();
  });

  async function loadSettings() {
    const res = await fetch("/api/settings");
    const s = await res.json();
    const lat = parseFloat(s.store_lat);
    const lng = parseFloat(s.store_lng);
    // 사장님이 위치 확인을 꺼두셨으면 좌표를 아예 안 들고 온다. 그러면
    // 아래 주문 흐름에서 위치를 묻는 단계 자체가 사라진다 — 권한 창도 안
    // 뜨고, 잡히기를 기다리는 시간도 없다.
    // 서버는 참/거짓으로 내려준다(src/locationGate.js). 글자 "false" 까지
    // 같이 보는 것은, 배포 사이에 옛 서버가 내려준 값을 들고 있는 화면이
    // 있을 수 있어서다 — 그때 위치 제한이 조용히 되살아나면 안 된다.
    const locationOn = s.location_check_enabled !== false && s.location_check_enabled !== "false";
    storeLat = !locationOn || Number.isNaN(lat) ? null : lat;
    storeLng = !locationOn || Number.isNaN(lng) ? null : lng;
    onlinePaymentEnabled = !!s.online_payment_enabled;
    // 자리 이동을 즉시 받기 위한 연결 정보(key/cluster 는 공개해도 되는 값
    // 이다 — src/routes/settings.js 주석). 채널 이름은 initPartySize 가
    // 서버에서 따로 받아온다.
    realtimeCfg = s.realtime || null;
    initRealtimeTable();
    if (s.ordering) ordering = s.ordering;
    isStaffSession = !!s.is_staff;
    applyOrderingState();
    if (window.applyTaegeukSeason) window.applyTaegeukSeason(s.taegeuk_season_mode || "auto");
    $("#storeName").textContent = s[`store_name_${lang}`] || s.store_name_zh || "韓國館";
    $("#storeInfoName").textContent = s[`store_name_${lang}`] || s.store_name_zh || "韓國館";
    $("#infoHours").textContent = s.store_hours || "-";
    $("#infoPhone").textContent = s.store_phone || "-";
    $("#infoAddress").textContent = s[`store_address_${lang}`] || s.store_address_zh || "-";
    $("#infoMinSpend").textContent = s.store_min_spend ? `$${s.store_min_spend}` : "-";
    if (s.store_cover_photo) {
      $("#hero").style.backgroundImage = `url('${s.store_cover_photo}')`;
    }
    const notice = s.store_notice && s.store_notice.trim();
    const banner = $("#noticeBanner");
    if (notice) {
      banner.textContent = notice;
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
    // loadSettings() re-runs on every language switch (see the lang-option
    // handler below), but Firebase only needs to be initialized once per
    // page load — re-calling firebase.initializeApp() with the same config
    // throws, and there's nothing to redo anyway since it's not
    // language-dependent.
    if (!membershipInitAttempted) {
      membershipInitAttempted = true;
      initMembership(s.firebase_web_config);
    }
  }

  async function loadMenu() {
    const res = await fetch("/api/menu");
    categories = await res.json();
    renderTabs();
    renderMenu();
  }

  // Whether this table already has an order in flight — determines whether
  // griddle items (min_first_order_qty) enforce their minimum. Checked
  // against the server rather than just the local activeOrderId, since
  // everyone at the table usually orders from their own phone, not just the
  // one that placed the very first order.
  async function checkPriorOrder() {
    // The 포장 카운터 QR is shared by every walk-in customer, so unlike a
    // real table, "does this table already have an order?" can't be
    // answered from the shared /api/orders/table/:tableNumber endpoint —
    // that would count a completely different customer's order and
    // incorrectly waive the griddle first-order minimum for this one.
    // Scoped instead to this device's own placed orders (see
    // saveOrderToHistory below). Relies on isCounterTable already being set
    // by initPartySize() — see the .then(checkPriorOrder) chain at the
    // bottom of this file.
    // 일반 테이블은 initPartySize 응답이 이미 같은 착석의 주문을 계산해서
    // has_prior_order로 준다. 예전처럼 /api/orders/table/:n 을 다시 부르면
    // QR 첫 화면에서 같은 주문 데이터를 두 번 읽는다.
    if (!isCounterTable) return;
    const myIds = JSON.parse(localStorage.getItem(`hgk_orders_${tableNumber}`) || "[]");
    hasPriorOrder = myIds.length > 0;
  }

  function renderTabs() {
    const tabs = $("#catTabs");
    tabs.innerHTML = "";
    categories.forEach((c, i) => {
      const btn = document.createElement("button");
      btn.textContent = nameFor(c);
      btn.className = i === 0 ? "active" : "";
      btn.onclick = () => {
        document.querySelectorAll(".cat-tabs button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const target = document.getElementById(`cat-${c.id}`);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      };
      tabs.appendChild(btn);
    });
  }

  function itemPhotoStyle(item) {
    return item.photo_url ? `background-image:url('${item.photo_url}')` : "";
  }

  // 냉면/비빔밥(28/29) contain beef broth and originally got a 🐄 emoji
  // baked straight onto their name (2026-09-feedback.js's ICON_APPEND) —
  // pulled back out by the 2026-09-followup migration once it turned out 🐄
  // renders as a side-view dairy cow on most platforms, the exact same
  // "옆 모습" problem 牛/豬 had. Shown here instead as the same cropped,
  // front-facing cow-face.png used everywhere else, same as meatIconsHtml()
  // below — a rendered image, not more emoji text baked into the name.
  const BEEF_BROTH_ICON_CODES = ["28", "29"];

  // 牛/豬 icons shown right next to the dish name in the menu list, matching
  // the official printed menu (which puts the same 🐂🐷 right after the dish
  // title, e.g. "石鍋拌飯 🐂🐷") — this is what the owner actually meant by
  // "메뉴에 표시되는 동물 사진에 넣어달라" (put it in the animal picture
  // shown on the menu list), not the option picker inside the item sheet,
  // which already had these icons from an earlier round.
  function meatIconsHtml(item) {
    const icons = optionNames(item.options)
      .filter((o) => OPTION_ICONS[o])
      .map((o) => optionIconHtml(o));
    if (BEEF_BROTH_ICON_CODES.includes(item.code)) icons.push(optionIconHtml("牛"));
    return icons.length ? `<span class="item-meat-icons">${icons.join("")}</span>` : "";
  }

  function itemMatchesSearch(item) {
    if (!searchTerm) return true;
    const haystack = [item.name_zh, item.name_ko, item.name_en, item.desc_zh, item.desc_ko, item.desc_en]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(searchTerm.toLowerCase());
  }

  function renderMenu() {
    const list = $("#menuList");
    list.innerHTML = "";
    let anyMatch = false;
    categories.forEach((c) => {
      const items = c.items.filter(itemMatchesSearch);
      if (!items.length) return;
      anyMatch = true;
      const section = document.createElement("section");
      section.className = "cat-section";
      section.id = `cat-${c.id}`;
      const title = document.createElement("h3");
      title.className = "cat-title";
      title.textContent = nameFor(c);
      section.appendChild(title);

      items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "item-row" + (item.available ? "" : " item-unavailable");
        row.innerHTML = `
          <div class="item-row-text">
            <div class="item-name-row">
              <span class="item-name">${nameFor(item)}</span>
              ${meatIconsHtml(item)}
              ${item.is_signature ? `<span class="badge badge-signature">★ ${t("signature")}</span>` : ""}
              ${item.is_spicy ? `<span class="badge badge-spicy">🌶 ${t("spicy")}</span>` : ""}
            </div>
            <div class="item-price">${priceHtml(item)}${item.price_note ? `<span class="item-price-note">${item.price_note}</span>` : ""}</div>
            <div class="item-sub">${descFor(item) || [item.name_zh, item.name_ko, item.name_en].filter((n) => n && n !== nameFor(item)).join(" · ")}</div>
            ${item.allergens && item.allergens.length ? `<div class="item-row-allergens">${allergenBadgesHtml(item, true)}</div>` : ""}
          </div>
          <div class="item-row-photo" style="${itemPhotoStyle(item)}">${item.photo_url ? "" : "🍽️"}</div>
        `;
        row.onclick = () => openItemSheet(item);
        section.appendChild(row);
      });
      list.appendChild(section);
    });
    if (!anyMatch) {
      list.innerHTML = `<div class="no-results">${t("noResults")}</div>`;
    }
  }

  $("#searchBtn").onclick = () => {
    const bar = $("#searchBar");
    bar.hidden = !bar.hidden;
    if (!bar.hidden) $("#searchInput").focus();
    else {
      searchTerm = "";
      $("#searchInput").value = "";
      renderMenu();
    }
  };
  $("#searchInput").addEventListener("input", (e) => {
    searchTerm = e.target.value.trim();
    renderMenu();
  });

  function openItemSheet(item) {
    currentItem = item;
    currentOption = item.options ? optionNames(item.options)[0] || null : null;
    // 맵기는 늘 「基本」이 있고, 그게 기본으로 골라져 있다.
    //
    // 2026-09-10 사장님: "매운맛 선택이 무조건 첫번째거로 선택되어있어" →
    // "맵기 기본에 늘 기본이 있어야 하고 그게 기본 세팅으로 선택이 되어있어야 해."
    //
    // 원래 의도가 그것이었다. 씨앗 데이터는 「基本,小辣」처럼 基本 을 첫 칸에
    // 두고 있었고, 첫 칸을 미리 고르니 아무것도 안 건드린 손님에게는 基本 이
    // 나갔다. 그런데 운영 데이터에서 일부 메뉴의 基本 이 빠져 있었다 —
    // 그러면 첫 칸이 小辣 가 되고, 안 매운 것을 원하던 손님에게 매운 것이
    // 나간다. 사장님이 보신 것이 그 상태다.
    //
    // 그래서 「첫 칸을 고른다」가 아니라 「基本 을 고른다」로 못 박는다.
    // 데이터가 어떻게 생겼든 화면에는 늘 基本 이 있고 늘 그것이 켜져 있다.
    // 저장된 데이터도 같이 고쳐 뒀다(src/migrations/2026-09-10-spice-basic.js).
    // 사장님이 「基本(中辣)」처럼 고쳐 둔 이름을 그대로 고른다. 「基本」으로
    // 저장하면 주문에는 사장님이 지운 이름이 남는다 (2026-09-12).
    currentSpiceOption = item.spice_options ? window.HG_SPICE.defaultOf(item.spice_options) : null;
    currentTakeoutOption = item.takeout_options ? item.takeout_options.split(",")[0].trim() : null;
    // A counter/takeout QR has no dine-in seat to speak of, so every item
    // defaults to 포장 there instead of the usual 매장 default — the toggle
    // itself is hidden for the same reason (see initPartySize below).
    currentOrderType = isCounterTable ? "takeout" : "dine_in";
    document.querySelectorAll("#itemOrderTypeTabs .order-type-tab[data-type]").forEach((b) => {
      b.classList.toggle("active", b.dataset.type === currentOrderType);
    });

    const takeoutOptWrap = $("#itemTakeoutOptions");
    const takeoutOptList = $("#takeoutOptionsList");
    takeoutOptList.innerHTML = "";
    if (item.takeout_options) {
      item.takeout_options.split(",").forEach((opt, i) => {
        const b = document.createElement("button");
        b.textContent = optionLabel(opt.trim());
        if (i === 0) b.classList.add("active");
        b.onclick = () => {
          currentTakeoutOption = opt.trim();
          takeoutOptList.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
        };
        takeoutOptList.appendChild(b);
      });
    }
    // 처음 열 때의 표시 여부는 이 아래 currentOrderType(포장 QR이면
    // takeout, 아니면 dine_in)에 따라 결정 — updateTakeoutOptionsVisibility()가
    // #itemOrderTypeTabs 탭을 눌러 바꿀 때도 같은 조건으로 다시 계산한다.
    takeoutOptWrap.hidden = !item.takeout_options || currentOrderType !== "takeout";
    $("#itemPhoto").style.backgroundImage = item.photo_url ? `url('${item.photo_url}')` : "";
    $("#itemPhoto").textContent = item.photo_url ? "" : "";
    $("#itemName").innerHTML = `${nameFor(item)}${meatIconsHtml(item)}`;
    $("#itemSubNames").textContent = [item.name_zh, item.name_ko, item.name_en]
      .filter((n) => n && n !== nameFor(item))
      .join(" · ");
    $("#itemDesc").textContent = descFor(item);
    const allergensEl = $("#itemAllergens");
    if (item.allergens && item.allergens.length) {
      allergensEl.innerHTML = allergenBadgesHtml(item, false);
      allergensEl.hidden = false;
    } else {
      allergensEl.hidden = true;
    }
    const priceInfo = $("#itemPriceInfo");
    if (item.original_price && item.original_price > item.price) {
      priceInfo.innerHTML = priceHtml(item);
      priceInfo.hidden = false;
    } else {
      priceInfo.hidden = true;
    }

    const optWrap = $("#itemOptions");
    const optList = $("#optionsList");
    const qtyRow = $("#qtyRow");
    const mixWrap = $("#mixOptions");
    optList.innerHTML = "";

    const spiceWrap = $("#itemSpiceOptions");
    const spiceList = $("#spiceOptionsList");
    spiceList.innerHTML = "";
    if (item.spice_options) {
      spiceWrap.hidden = false;
      spiceOptionsOf(item).forEach((opt) => {
        const b = document.createElement("button");
        b.textContent = opt;
        if (opt === currentSpiceOption) b.classList.add("active");
        b.onclick = () => {
          currentSpiceOption = opt;
          spiceList.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
        };
        spiceList.appendChild(b);
      });
    } else {
      spiceWrap.hidden = true;
    }

    // Multi-select paid/free extras (사리면 추가, 밥→당면 교체 등) — checkboxes,
    // unlike options/spice_options above which are single-choice radios,
    // since a customer can pick any number of these at once.
    currentAddons = [];
    const addonWrap = $("#itemAddons");
    const addonList = $("#addonsList");
    addonList.innerHTML = "";
    const availableAddons = parseAddons(item.addons);
    if (availableAddons.length) {
      addonWrap.hidden = false;
      availableAddons.forEach((a) => {
        const b = document.createElement("button");
        b.textContent = a.price > 0 ? `${a.name} +${money(a.price)}` : a.name;
        b.onclick = () => {
          const idx = currentAddons.indexOf(a.name);
          if (idx === -1) currentAddons.push(a.name);
          else currentAddons.splice(idx, 1);
          b.classList.toggle("active");
          updateAddBtnPrice();
        };
        addonList.appendChild(b);
      });
    } else {
      addonWrap.hidden = true;
    }

    if (item.mix_options && item.options) {
      // e.g. 동판불고기: 牛/豬 get their own independent +/- counters instead
      // of a single radio choice, so a table can mix both in one line item.
      // Defaults to a plain single-choice pick, same as a normal item's
      // options (see the "else" branch below) — quick-pick 牛 sets 2/0,
      // 豬 sets 0/2 — and the +/- counters underneath still let the
      // customer fine-tune from there into an actual mix (e.g. 1/1).
      optWrap.hidden = true;
      qtyRow.hidden = true;
      mixWrap.hidden = false;
      // 섞는 메뉴는 mixOptionsHint 가 같은 이야기를 한다 — 두 줄이 겹치면
      // 안 된다.
      if ($("#qtyHint")) $("#qtyHint").hidden = true;
      // 최소 수량은 「이 자리의 첫 주문」에만 걸린다. 이미 주문한 적이
      // 있으면 그 문장은 사실이 아니므로 비율 이야기만 남긴다.
      const mixMin = item.min_first_order_qty || 0;
      $("#mixOptionsHint").textContent =
        mixMin && !hasPriorOrder
          ? t("mixOptionsHint").replace("{n}", mixMin)
          : t("mixOptionsHintAfter");
      const opts = optionNames(item.options);
      mixQty = {};
      opts.forEach((opt) => (mixQty[opt] = 0));
      mixQty[opts[0]] = 2;
      renderMixQuickPick(opts, opts[0]);
      renderMixOptions(opts);
    } else {
      mixWrap.hidden = true;
      currentQty = item.min_first_order_qty && !hasPriorOrder ? item.min_first_order_qty : 1;
      $("#qtyVal").textContent = String(currentQty);
      qtyRow.hidden = false;
      // 왜 2 로 올라가 있는지 적어준다.
      //
      // 사장님(2026-09-12): 동판불고기에 있는 안내를 닭갈비·삼겹살에도
      // 넣어달라고 하셨다. 셋 다 첫 주문 최소 2인분인데, 안내가 붙어 있던
      // 것은 牛/豬 를 섞는 동판뿐이었다 — 나머지 둘은 숫자만 2 로 올라가
      // 있고 이유는 아무 데도 없었다. 손님은 그걸 「왜 1인분은 안 되지」로
      // 읽는다.
      const qtyHint = $("#qtyHint");
      if (qtyHint) {
        const minQty = item.min_first_order_qty || 0;
        const show = minQty > 1 && !hasPriorOrder;
        qtyHint.hidden = !show;
        qtyHint.textContent = show ? t("minFirstOrderHint").replace("{n}", minQty) : "";
      }
      if (item.options) {
        optWrap.hidden = false;
        parseOptions(item.options).forEach((opt, i) => {
          const b = document.createElement("button");
          // 옵션에 붙은 값은 칩에 적지 않는다 — 이름만 보인다.
          //
          // 사장님(2026-09-25): "옵션에 우리가 가격을 넣잖아. 그거 손님
          // 화면에서는 안 보이게 해줘". 값은 그대로 담기 버튼 합계에
          // 더해지고(updateAddBtnPrice), 종이에도 찍힌다.
          b.textContent = optionLabel(opt.name);
          if (i === 0) b.classList.add("active");
          b.onclick = () => {
            currentOption = opt.name;
            optList.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
            b.classList.add("active");
            // 고른 값이 합계에 바로 보여야 한다.
            updateAddBtnPrice();
          };
          optList.appendChild(b);
        });
      } else {
        optWrap.hidden = true;
      }
    }

    updateAddBtnPrice();
    $("#itemSheetBackdrop").hidden = false;
  }

  // Quick-pick row for a mix_options item (see openItemSheet above) —
  // ordinary-looking option buttons (牛/豬) that just set a starting point:
  // clicking one zeroes every other option and puts everything (2 servings)
  // on that one, then re-renders the +/- counters below so the customer can
  // still nudge it into an actual mix from there.
  function renderMixQuickPick(opts, activeOpt) {
    const wrap = $("#mixQuickPickList");
    wrap.innerHTML = "";
    opts.forEach((opt) => {
      const b = document.createElement("button");
      b.textContent = optionLabel(opt);
      if (opt === activeOpt) b.classList.add("active");
      b.onclick = () => {
        opts.forEach((o) => (mixQty[o] = 0));
        mixQty[opt] = 2;
        wrap.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        renderMixOptions(opts);
        updateAddBtnPrice();
      };
      wrap.appendChild(b);
    });
  }

  // Renders one +/- row per option for a mix_options item (see openItemSheet
  // above) into #mixOptionsList, wired to mutate the shared `mixQty` map.
  function renderMixOptions(opts) {
    const mixList = $("#mixOptionsList");
    mixList.innerHTML = "";
    opts.forEach((opt) => {
      const row = document.createElement("div");
      row.className = "mix-option-row";
      row.innerHTML = `
        <span class="mix-option-name">${optionLabel(opt)}</span>
        <div class="qty-row">
          <button data-act="minus">−</button>
          <span class="mix-qty-val">${mixQty[opt]}</span>
          <button data-act="plus">+</button>
        </div>
      `;
      row.querySelector('[data-act="minus"]').onclick = () => {
        mixQty[opt] = Math.max(0, mixQty[opt] - 1);
        row.querySelector(".mix-qty-val").textContent = mixQty[opt];
        updateAddBtnPrice();
      };
      row.querySelector('[data-act="plus"]').onclick = () => {
        mixQty[opt] = Math.min(20, mixQty[opt] + 1);
        row.querySelector(".mix-qty-val").textContent = mixQty[opt];
        updateAddBtnPrice();
      };
      mixList.appendChild(row);
    });
  }

  function updateAddBtnPrice() {
    if (!currentItem) return;
    const addonsPrice = addonsPriceFor(currentItem, currentAddons);
    if (currentItem.mix_options) {
      // 섞는 메뉴(牛/豬)는 옵션에 값이 붙지 않는다 — 옵션마다 수량이 따로
      // 있어서 값을 붙이면 어느 쪽 값인지 한 줄로는 못 적는다. 메뉴 관리
      // 화면이 그 조합을 막는다.
      const totalQty = Object.values(mixQty).reduce((sum, q) => sum + q, 0);
      $("#addToCartPrice").textContent = money(currentItem.price * totalQty + addonsPrice);
    } else {
      // 옵션 값은 수량을 안 곱한다 — 적어둔 금액이 그대로 한 번 붙는다.
      const optPrice = currentOptionPrice(currentItem);
      $("#addToCartPrice").textContent = money(currentItem.price * currentQty + optPrice + addonsPrice);
    }
  }

  $("#itemSheetClose").onclick = () => ($("#itemSheetBackdrop").hidden = true);
  $("#itemSheetBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "itemSheetBackdrop") $("#itemSheetBackdrop").hidden = true;
  });
  // Order-type tabs (매장/포장) inside the item sheet — wired once here;
  // openItemSheet() above resets which one is active every time it opens.
  document.querySelectorAll("#itemOrderTypeTabs .order-type-tab[data-type]").forEach((b) => {
    b.onclick = () => {
      currentOrderType = b.dataset.type;
      document.querySelectorAll("#itemOrderTypeTabs .order-type-tab[data-type]").forEach((btn) => btn.classList.toggle("active", btn === b));
      // 부대찌개 등 "포장에만 있는 옵션"(위 currentTakeoutOption 참고) —
      // 매장/포장을 이 안에서 바꿀 때마다 표시 여부를 다시 계산한다.
      $("#itemTakeoutOptions").hidden = !currentItem.takeout_options || currentOrderType !== "takeout";
    };
  });
  // Griddle items with a min_first_order_qty are NOT floored at that minimum
  // here — the qty stepper moves freely like any other item (down to 1).
  // The minimum is only enforced (with an explanatory toast) at add-to-cart
  // time below, same as the mix_options items — clearer to customers than a
  // stepper that mysteriously refuses to go lower.
  $("#qtyMinus").onclick = () => {
    currentQty = Math.max(1, currentQty - 1);
    $("#qtyVal").textContent = currentQty;
    updateAddBtnPrice();
  };
  $("#qtyPlus").onclick = () => {
    currentQty = Math.min(20, currentQty + 1);
    $("#qtyVal").textContent = currentQty;
    updateAddBtnPrice();
  };

  $("#addToCartBtn").onclick = () => {
    // 버튼은 이미 disabled 지만, 키보드나 스크립트로도 눌릴 수 있다.
    if (orderingClosed()) {
      showToast(t("closedTitle"));
      return;
    }
    if (currentItem.mix_options) {
      const opts = Object.keys(mixQty);
      const totalQty = opts.reduce((sum, o) => sum + mixQty[o], 0);
      const requiredMin = currentItem.min_first_order_qty && !hasPriorOrder ? currentItem.min_first_order_qty : 1;
      if (totalQty < requiredMin) {
        showToast((GRILL_MIN_MSG[lang] || GRILL_MIN_MSG.zh)(requiredMin));
        return;
      }
      opts.forEach((opt) => {
        if (mixQty[opt] > 0) {
          cart.push({
            itemId: currentItem.id,
            item: currentItem,
            qty: mixQty[opt],
            option: opt,
            spice: currentSpiceOption,
            takeoutOption: currentOrderType === "takeout" ? currentTakeoutOption : null,
            orderType: currentOrderType,
            addons: [...currentAddons],
          });
        }
      });
    } else {
      const requiredMin = currentItem.min_first_order_qty && !hasPriorOrder ? currentItem.min_first_order_qty : 1;
      if (currentQty < requiredMin) {
        showToast((GRILL_MIN_MSG[lang] || GRILL_MIN_MSG.zh)(requiredMin));
        return;
      }
      cart.push({
        itemId: currentItem.id,
        item: currentItem,
        qty: currentQty,
        option: currentOption,
        spice: currentSpiceOption,
        // 부대찌개 등 "포장에만 있는 옵션" — currentOrderType이 takeout일
        // 때만 실제로 보낸다(dine_in인데 화면에 안 보였던 기본값이 몰래
        // 딸려가는 걸 막는다).
        takeoutOption: currentOrderType === "takeout" ? currentTakeoutOption : null,
        orderType: currentOrderType,
        addons: [...currentAddons],
      });
    }
    $("#itemSheetBackdrop").hidden = true;
    cartChanged();
  };

  function cartTotal() {
    // 옵션·추가 옵션은 한 줄에 한 번(서버와 같은 규칙, src/discounts.js).
    return cart.reduce(
      (sum, c) =>
        sum +
        c.item.price * c.qty +
        optionPriceIn(c.item, c.option) +
        addonsPriceFor(c.item, c.addons),
      0
    );
  }
  function cartCount() {
    return cart.reduce((sum, c) => sum + c.qty, 0);
  }
  // Preview only — matches the math src/routes/orders.js actually applies
  // (see finalTotal there), but the server independently recomputes and
  // enforces it from the verified ID token at submit time, never trusting
  // anything the client sends. Falls back to the plain subtotal whenever
  // there's no active linked VIP card, i.e. for every customer who never
  // touches this feature at all.
  function estimatedCartTotal() {
    const subtotal = cartTotal();
    const pct = membership && membership.active ? membership.discount_percent : 0;
    return pct ? Math.round((subtotal * (100 - pct)) / 100) : subtotal;
  }

  // 담긴 것이 바뀌었다. 표를 새로 만든다 — 「같은 것을 다시 보내는 것」과
  // 「내용을 바꿔 새로 보내는 것」이 여기서 갈린다.
  //
  // renderCartFab() 안에 두면 안 된다. 그 함수는 VIP 상태가 바뀔 때도,
  // 통화를 바꿀 때도, 화면을 처음 그릴 때도 불린다. 답을 못 받아 다시
  // 누르는 손님이 그 사이에 표를 새로 달면 서버가 두 번째를 못 알아본다.
  function cartChanged() {
    cartToken = newCartToken();
    renderCartFab();
  }

  function renderCartFab() {
    const fab = $("#cartFab");
    if (cart.length === 0) {
      fab.hidden = true;
      return;
    }
    fab.hidden = false;
    $("#cartCount").textContent = cartCount();
    $("#cartTotal").textContent = money(estimatedCartTotal());
  }

  $("#cartFab").onclick = () => {
    renderCart();
    $("#cartBackdrop").hidden = false;
    // 위치를 미리 잡아둔다. 버튼을 누른 뒤에 잡기 시작하면 그 자리에서 몇
    // 초가 그냥 멈추는데, 손님 눈에는 아무 일도 안 일어난 것으로 보인다.
    // 장바구니를 여는 순간 잡아두면 누를 때는 이미 답이 있다.
    warmGeolocation();
  };
  $("#cartClose").onclick = () => ($("#cartBackdrop").hidden = true);
  $("#cartBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "cartBackdrop") $("#cartBackdrop").hidden = true;
  });

  function renderCart() {
    const wrap = $("#cartItems");
    wrap.innerHTML = "";
    if (cart.length === 0) {
      wrap.innerHTML = `<div class="cart-empty">${t("empty")}</div>`;
    }
    cart.forEach((c, idx) => {
      const row = document.createElement("div");
      row.className = "cart-item";
      const metaParts = [];
      if (c.option) metaParts.push(c.option);
      if (c.spice) metaParts.push(c.spice);
      if (c.takeoutOption) metaParts.push(c.takeoutOption);
      if (c.addons && c.addons.length) metaParts.push(`+${c.addons.join(", ")}`);
      // 매장(dine-in) is the default and stays implicit; only 포장(takeout)
      // is called out here, so a customer mixing both in one order can see
      // at a glance which lines are which without extra clutter on the rest.
      if (c.orderType === "takeout") metaParts.push(t("orderTypeTakeout"));
      row.innerHTML = `
        <div>
          <div class="cart-item-name">${nameFor(c.item)}</div>
          <div class="cart-item-meta">${metaParts.join(" · ")}</div>
          <div class="cart-item-qty-ctrl">
            <button data-act="minus">−</button>
            <span>${c.qty}</span>
            <button data-act="plus">+</button>
            <button class="cart-item-remove" data-act="remove">${t("remove")}</button>
          </div>
        </div>
        <div class="cart-item-right">${money(
          c.item.price * c.qty + optionPriceIn(c.item, c.option) + addonsPriceFor(c.item, c.addons)
        )}</div>
      `;
      row.querySelector('[data-act="minus"]').onclick = () => {
        // No min_first_order_qty floor here either (see #qtyMinus above) —
        // the server re-checks the minimum at submit and shows an
        // explanatory alert (see #submitOrderBtn's grill_min_qty handling)
        // if the cart ends up under it.
        c.qty = Math.max(1, c.qty - 1);
        renderCart();
        cartChanged();
      };
      row.querySelector('[data-act="plus"]').onclick = () => {
        c.qty = Math.min(20, c.qty + 1);
        renderCart();
        cartChanged();
      };
      row.querySelector('[data-act="remove"]').onclick = () => {
        cart.splice(idx, 1);
        renderCart();
        cartChanged();
      };
      wrap.appendChild(row);
    });
    const subtotal = cartTotal();
    const pct = membership && membership.active ? membership.discount_percent : 0;
    const discountRow = $("#cartVipDiscountRow");
    if (pct) {
      discountRow.hidden = false;
      $("#cartVipDiscountLabel").textContent = `${t("memberDiscountAppliedPrefix")} -${pct}% (-${money(subtotal - estimatedCartTotal())})`;
    } else {
      discountRow.hidden = true;
    }
    $("#cartTotalBig").textContent = money(estimatedCartTotal());
    $("#submitOrderBtn").disabled = cart.length === 0;
  }

  // 마지막으로 미리 잡아본 시각. 장바구니를 여닫을 때마다 다시 잡지 않는다
  // (getCurrentPosition 의 maximumAge 가 5분이라 어차피 그 값을 쓴다).
  let warmGeoAt = 0;
  function warmGeolocation() {
    if (storeLat == null || storeLng == null) return;
    if (Date.now() - warmGeoAt < 60000) return;
    warmGeoAt = Date.now();
    // 실패해도 아무것도 하지 않는다. 여기서 잡히면 빠른 것이고, 안 잡혀도
    // 주문은 좌표 없이 들어간다(아래 locationOrNothing 주석).
    acquireGeolocation().catch(() => {});
  }

  // 잡고 있는 중이면 그것을 같이 쓴다.
  //
  // 미리 잡기 시작해 놓고 주문할 때 getGeolocation() 을 새로 부르면, 미리
  // 잡아둔 보람이 없다 — 브라우저는 새 요청을 처음부터 다시 처리한다.
  let geoInFlight = null;
  function acquireGeolocation() {
    if (geoInFlight) return geoInFlight;
    const p = getGeolocation();
    geoInFlight = p;
    const clear = () => {
      if (geoInFlight === p) geoInFlight = null;
    };
    // then 의 두 갈래를 다 채운다 — 아무도 안 기다리는 사이에 실패하면
    // 「처리 안 된 거절」이 된다.
    p.then(clear, clear);
    return p;
  }

  // 위치를 **얼마나** 기다릴 것인가.
  //
  // 2026-09-14 사장님: "손님이 qr 을 읽고 주문했을 때 주문완료를 보는 시간이
  // 너무 길다고 피드백이 왔어."
  //
  // getCurrentPosition 의 제한 시간은 8초다. 실내에서 안 잡히면 그 8초를 다
  // 쓰고 실패하는데, 그 8초는 **손님이 완료 화면을 못 보고 기다리는 시간**
  // 그대로다. 그리고 8초를 기다려서 얻는 것이 없다 — 못 잡으면 어차피 좌표
  // 없이 보내고, 서버는 그런 주문을 받아 표만 달아 직원에게 보여준다
  // (claude/2026-09-10-location-gate.md: "확인이 안 되는 것을 위반으로 세지
  // 않는다"). 오래 기다릴수록 손해만 커지는 기다림이다.
  //
  // 기지국·와이파이 기반 위치는 잡힐 것이면 1~2초 안에 잡힌다. 그래서 여기서
  // 끊는다. 끊어도 뒤에서는 계속 잡고 있고, 잡히면 브라우저가 그 값을 5분간
  // 들고 있으므로(maximumAge) **다음 주문**은 그 값을 바로 쓴다.
  const GEO_WAIT_MS = 2500;
  function locationOrNothing() {
    if (storeLat == null || storeLng == null) return Promise.resolve(null);
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        resolve(v);
      };
      const timer = setTimeout(() => finish(null), GEO_WAIT_MS);
      const settle = (v) => {
        clearTimeout(timer);
        finish(v);
      };
      // 여기서 막지 않는다.
      //
      // 2026-09-10 저녁, 사장님: "이런 오류가 꽤 많은 테이블에서 일어나" —
      // 「無法取得您的位置」 창이 뜨고 주문 버튼이 아무것도 안 했다. 자리에
      // 앉아 계신 손님이 밥을 못 시킨다.
      //
      // 위치를 보는 목적은 「QR 사진을 찍어 집에서 주문하는 것」을 막는
      // 것이지 앞에 앉은 손님을 돌려보내는 게 아니다. 못 잡는 이유는 대개
      // 손님 잘못이 아니다 — 실내, 권한 거부, 새 도메인이라 권한이 처음부터
      // 다시, 기기 설정. 그 전부를 「주문 불가」로 묶으면 잃는 게 훨씬 크다.
      acquireGeolocation().then(settle, () => settle(null));
    });
  }

  // 로그인한 손님의 Firebase 토큰. 서버가 직접 확인해서 VIP 카드를 찾는다
  // (src/routes/orders.js) — 할인은 화면이 주장하는 값이 아니다. 토큰을 못
  // 새로 받으면 그냥 일반 주문으로 보낸다. 그것 때문에 주문을 막지 않는다.
  async function authHeadersNow() {
    const headers = { "Content-Type": "application/json" };
    if (firebaseAuth && firebaseAuth.currentUser) {
      try {
        headers.Authorization = `Bearer ${await firebaseAuth.currentUser.getIdToken()}`;
      } catch (e) {
        /* 토큰 갱신 실패 — 일반 주문으로 보낸다 */
      }
    }
    return headers;
  }

  // 보내는 중이라는 것을 눈에 보이게 한다. 잠그기만 하고 아무 말이 없으면
  // 손님은 「안 눌렸구나」로 읽고 한 번 더 누른다.
  function setSubmitBusy(on) {
    const btn = $("#submitOrderBtn");
    if (!btn) return;
    btn.disabled = on || cart.length === 0;
    btn.classList.toggle("is-busy", on);
    btn.textContent = on ? t("submitting") : t("placeOrder");
  }

  // Resolves { lat, lng } from the browser, or rejects. Only called when
  // the owner has configured a store location (see loadSettings above) —
  // this is what actually stops an old QR photo from being used far away
  // from the restaurant; the server re-checks this independently too.
  function getGeolocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("unsupported"));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => reject(err),
        // enableHighAccuracy 를 껐다. 이 값은 GPS 위성을 직접 잡으라는
        // 뜻인데, 실내에서는 잡히지 않아 10초를 다 쓰고 실패한다. 가게 안이
        // 바로 그 실내다. 우리가 재는 것은 「가게에서 200m 안인가」뿐이라
        // 기지국·와이파이 기반 위치로 충분하다 — 훨씬 빠르고 실내에서도 잡힌다.
        //
        // maximumAge 도 늘렸다. 같은 손님이 추가 주문할 때마다 위치를 다시
        // 잡을 이유가 없다. 5분 안의 값이면 그대로 쓴다.
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
      );
    });
  }

  // Blocking version of the old auto-dismissing toast (2026-09 피드백:
  // "인원수에 맞춰서 주문하라는 메시지창을 본인이 ok 누르고 닫을수 있도록") — the
  // customer must tap the button themselves to close it, instead of it
  // silently vanishing after 3.5s whether or not they saw it. Confirming
  // continues on to actually submit the order (this is a heads-up, not a
  // hard block on ordering less than the headcount).
  function showPartyWarningModal(have, need, onConfirm) {
    const notice = MIN_SPEND_NOTICE[lang] || MIN_SPEND_NOTICE.zh;
    const short = MIN_SPEND_SHORTFALL[lang] || MIN_SPEND_SHORTFALL.zh;
    $("#partyWarningMsg").textContent = notice(minSpendPerPerson);
    $("#partyWarningAmount").textContent = short(have, need);
    $("#partyWarningBackdrop").hidden = false;
    $("#partyWarningConfirmBtn").onclick = () => {
      $("#partyWarningBackdrop").hidden = true;
      onConfirm();
    };
  }

  /**
   * 이 자리의 低消를 서버에 다시 물어본다 — 필요한 금액과 **이미 시킨 금액**.
   *
   * 低消는 한 라운드가 아니라 그 손님이 앉아 있는 동안 전체에 걸리는
   * 규칙이다. 두 번째 라운드에서 음료 하나를 시킬 때마다 「모자랍니다」가
   * 뜨면 아무도 안 읽는다.
   *
   * 화면을 연 뒤에 라운드가 더 들어왔을 수 있어서, 주문을 보내기 직전에
   * 한 번 더 물어본다.
   */
  async function refreshMinSpend() {
    try {
      const res = await fetch(`/api/tables/${encodeURIComponent(tableNumber)}/party-size`);
      const d = await res.json();
      if (!res.ok) return 0;
      minSpendPerPerson = Number(d.min_spend_per_person) || 0;
      minSpendRequired = Number(d.min_spend_required) || 0;
      return Number(d.min_spend_spent) || 0;
    } catch (e) {
      // 못 물어보면 안내를 건너뛴다. 네트워크가 잠깐 끊긴 것 때문에 손님이
      // 주문을 못 하게 되면 더 나쁘다 — 低消는 계산대에서도 확인된다.
      minSpendRequired = 0;
      return 0;
    }
  }

  $("#submitOrderBtn").onclick = () => submitOrderFlow(false);

  async function submitOrderFlow(skipPartyWarning) {
    if (cart.length === 0) return;
    // 이미 보내는 중이면 아무것도 하지 않는다. 예전에는 위치를 다 잡은
    // **뒤에야** 버튼을 잠갔다 — 그 사이 최대 8초 동안 버튼은 멀쩡히 살아
    // 있었고 화면에는 아무 표시도 없었다. 그 8초에 한 번 더 눌리면 두 흐름이
    // 나란히 돌아 같은 주문이 두 번 들어갔다.
    if (submitting) return;

    // Belt-and-suspenders: party size is required before an order can go
    // through, even if something let the modal get skipped/dismissed.
    if (!partySize) {
      pendingSeatingPrompt = "party";
      askSeatingIfOpen();
      return;
    }
    // Same belt-and-suspenders idea for the counter's required pickup name.
    if (isCounterTable && !counterCustomerName) {
      pendingSeatingPrompt = "counter";
      askSeatingIfOpen();
      return;
    }

    // 여기서부터 네트워크를 탄다. 누른 그 순간에 잠그고, 그 순간에
    // 「送出中…」 으로 바꾼다.
    submitting = true;
    setSubmitBusy(true);
    try {
      await submitOrderRequest(skipPartyWarning);
    } finally {
      submitting = false;
      setSubmitBusy(false);
      // 위에서 무조건 풀어준 잠금을, 영업시간 밖이면 다시 건다.
      applyOrderingState();
    }
  }

  async function submitOrderRequest(skipPartyWarning) {
    // 기다려야 하는 것 셋을 **동시에** 시작한다.
    //
    // 예전에는 하나씩 줄을 세웠다 — 低消를 물어보고, 그게 끝나야 위치를
    // 잡기 시작하고, 위치가 잡혀야 주문을 보냈다. 셋은 서로 아무 상관이
    // 없는데도 손님은 그 합을 다 기다렸다. 이제는 제일 오래 걸리는 하나만큼만
    // 기다린다.
    const coordsPromise = locationOrNothing();
    const headersPromise = authHeadersNow();

    // 低消 안내 (2026-09-11 사장님). 예전에는 「메뉴 개수 < 어른 수」였다.
    //
    // 막지는 않는다 — 확인을 누르면 그대로 주문된다. 低消는 가게 규칙이고
    // 직원이 사정에 따라 넘어가 주기도 하는데, 화면이 손님을 가로막아 버리면
    // 그 여지가 없어진다. 사장님도 「안내 문구」라고 하셨다.
    if (!skipPartyWarning && !isCounterTable) {
      const spent = await refreshMinSpend();
      const have = spent + cartTotal();
      if (minSpendRequired > 0 && have < minSpendRequired) {
        // 안내를 읽는 동안은 보내는 중이 아니다. 확인을 누르면 이 흐름이
        // 처음부터 다시 들어온다(그때 다시 잠근다).
        submitting = false;
        setSubmitBusy(false);
        showPartyWarningModal(have, minSpendRequired, () => submitOrderFlow(true));
        return;
      }
    }

    const coords = await coordsPromise;

    let grillMinBody = null;
    // Signed-in customers carry their Firebase ID token along so the server
    // can independently verify it and look up their linked VIP card itself
    // (see src/routes/orders.js) — the discount is never something the
    // client asserts. Harmless to always attempt this when signed in, even
    // with no card linked yet: the server just finds nothing and charges
    // full price, same as any other customer.
    const authHeaders = await headersPromise;
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          tableNumber,
          // 두 번 눌렸을 때 두 번째를 새 주문으로 만들지 않기 위한 표.
          clientRequestId: cartToken,
          // Each cart line carries its own orderType now (chosen per dish in
          // the item sheet) — see src/routes/orders.js, which validates and
          // stores order_type per item instead of once for the whole order.
          items: cart.map((c) => ({
            itemId: c.itemId,
            qty: c.qty,
            option: c.option,
            spice: c.spice,
            takeoutOption: c.takeoutOption,
            orderType: c.orderType,
            addons: c.addons || [],
          })),
          lat: coords ? coords.lat : undefined,
          lng: coords ? coords.lng : undefined,
          // Only meaningful (and only required server-side) for a counter
          // order — see is_counter handling in src/routes/orders.js.
          customerName: isCounterTable ? counterCustomerName : undefined,
          customerPhone: isCounterTable ? counterCustomerPhone : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.error === "out_of_range") throw new Error("out_of_range");
        if (body.error === "location_required") throw new Error("location_required");
        if (body.error === "closed_now") {
          // 서버가 내려준 최신 상태로 화면을 맞춘다 — 주문을 누르는 사이에
          // 영업이 끝난 경우라, 화면은 아직 열려 있는 줄 알고 있다.
          if (body.ordering) ordering = body.ordering;
          throw new Error("closed_now");
        }
        if (body.error === "seating_stale") throw new Error("seating_stale");
        if (body.error === "party_size_required") throw new Error("party_size_required");
        if (body.error === "customer_name_required") throw new Error("customer_name_required");
        if (body.error === "customer_phone_required") throw new Error("customer_phone_required");
        if (body.error === "grill_min_qty") {
          grillMinBody = body;
          throw new Error("grill_min_qty");
        }
        throw new Error("submit_failed");
      }
      const order = await res.json();
      activeOrderId = order.id;
      hasPriorOrder = true;
      saveOrderToHistory(order.id);
      // 포장 카운터는 「주문 한 건 = 손님 한 분」이다. 전화로 오는 포장 주문은
      // 직원이 같은 화면에서 계속 받는데, 이름과 전화번호가 sessionStorage 에
      // 남아 있으면 다음 손님 주문도 앞 손님 이름으로 찍힌다 (2026-09-13
      // 사장님: "그 다음주문부터 안물어봐서 같은 사람으로 찍혀").
      //
      // 특히 키오스크 앱에서는 수기 주문이 새 탭을 못 열고 같은 탭에서
      // 이동하므로(admin.js manualOrderBtn) sessionStorage 가 그대로 살아
      // 있다. 주문이 들어간 순간 비워서, 다음 주문은 반드시 다시 묻게 한다.
      if (isCounterTable) {
        counterCustomerName = null;
        counterCustomerPhone = null;
        try {
          sessionStorage.removeItem(COUNTER_NAME_KEY);
          sessionStorage.removeItem(COUNTER_PHONE_KEY);
        } catch (err) {
          /* 저장이 막힌 기기 */
        }
      }
      cart = [];
      cartChanged();
      $("#cartBackdrop").hidden = true;
      showConfirmation(order);
      if (fromAdmin) returnToAdminAfterOrder();
    } catch (e) {
      if (e.message === "closed_now") alert(closedMessage());
      else if (e.message === "out_of_range") alert(t("locationOutOfRangeMsg"));
      else if (e.message === "location_required") alert(t("locationRequiredMsg"));
      else if (e.message === "seating_stale") {
        // 이 페이지가 앞 손님 때 열린 것이다. 화면만 남아 있고 자리에는
        // 다른 분이 앉으셨다 — 그대로 담아둔 것을 보내면 그 분 계산서에
        // 붙는다. 담긴 것을 비우고 지금 자리 상태로 다시 연다.
        cart = [];
        try {
          localStorage.removeItem(`hgk_orders_${tableNumber}`);
        } catch (err) {
          /* 저장이 막힌 기기 */
        }
        alert(SEATING_STALE_MSG[lang] || SEATING_STALE_MSG.zh);
        location.reload();
      } else if (e.message === "party_size_required") showPartySizeModal();
      else if (e.message === "customer_name_required" || e.message === "customer_phone_required") {
        counterCustomerName = null;
        counterCustomerPhone = null;
        sessionStorage.removeItem(COUNTER_NAME_KEY);
        sessionStorage.removeItem(COUNTER_PHONE_KEY);
        showCounterNameModal();
      }
      else if (e.message === "grill_min_qty" && grillMinBody) {
        const mi = categories.flatMap((c) => c.items).find((i) => i.id === grillMinBody.itemId);
        const name = mi ? nameFor(mi) : "";
        alert((GRILL_MIN_MSG[lang] || GRILL_MIN_MSG.zh)(grillMinBody.min) + (name ? ` (${name})` : ""));
      } else alert(t("submitFailed"));
    }
  }

  function saveOrderToHistory(id) {
    const key = `hgk_orders_${tableNumber}`;
    const list = JSON.parse(localStorage.getItem(key) || "[]");
    // 같은 번호를 두 번 적지 않는다. 두 번 눌렀을 때 서버는 처음 만든 주문을
    // 그대로 돌려주는데(src/routes/orders.js), 그것을 그냥 밀어 넣으면 내
    // 주문 내역에 같은 것이 두 줄로 보인다.
    if (list.includes(id)) return;
    list.push(id);
    localStorage.setItem(key, JSON.stringify(list.slice(-10)));
  }

  const STATUS_STEPS = ["new", "preparing", "served", "paid"];
  // 완료 화면을 잠깐 보여준 뒤 관리자 화면으로. 「계속 추가」를 누르면
  // 직원이 더 넣겠다는 뜻이므로 돌아가지 않는다.
  let adminReturnTimer = null;
  function returnToAdminAfterOrder() {
    const note = $("#confirmReturnNote");
    if (note) {
      note.textContent = ADMIN_RETURN_NOTE[lang] || ADMIN_RETURN_NOTE.zh;
      note.hidden = false;
    }
    clearTimeout(adminReturnTimer);
    adminReturnTimer = setTimeout(goBackToAdmin, ADMIN_RETURN_MS);
  }
  function cancelAdminReturn() {
    clearTimeout(adminReturnTimer);
    adminReturnTimer = null;
    const note = $("#confirmReturnNote");
    if (note) note.hidden = true;
  }

  function showConfirmation(order) {
    renderStatusTrack(order.status);
    $("#confirmBackdrop").hidden = false;
    startStatusPolling();
  }
  function renderStatusTrack(status) {
    const idx = STATUS_STEPS.indexOf(status);
    const track = $("#orderStatusTrack");
    track.innerHTML = "";
    STATUS_STEPS.forEach((s, i) => {
      const step = document.createElement("div");
      step.className = "status-step" + (i <= idx ? " done" : "");
      step.innerHTML = `<div class="status-dot"></div><div class="status-step-label">${t("status" + s.charAt(0).toUpperCase() + s.slice(1))}</div>`;
      track.appendChild(step);
    });
  }
  $("#backToMenuBtn").onclick = () => {
    // 더 넣겠다는 뜻이다. 돌아가려던 것을 멈춘다 — 메뉴를 고르는 중에 화면이
    // 관리자로 넘어가면 담던 것이 사라진다.
    cancelAdminReturn();
    $("#confirmBackdrop").hidden = true;
    stopStatusPolling();
  };

  // Poll the order's own status every few seconds while the confirmation
  // sheet is open (no persistent server connection needed this way).
  function startStatusPolling() {
    stopStatusPolling();
    statusPollTimer = setInterval(async () => {
      if (!activeOrderId) return;
      try {
        const res = await fetch(`/api/orders/${activeOrderId}`);
        if (!res.ok) return;
        const order = await res.json();
        renderStatusTrack(order.status);
        if (order.status === "paid") stopStatusPolling();
      } catch (e) {
        /* ignore transient network errors, next poll will retry */
      }
    }, 4000);
  }
  function stopStatusPolling() {
    if (statusPollTimer) {
      clearInterval(statusPollTimer);
      statusPollTimer = null;
    }
  }

  // Order history — this table's running (unpaid) receipt, shared by anyone
  // ordering from this table. Disappears once the table is settled, since
  // the endpoint only returns non-paid, non-cancelled orders.
  //
  // The 포장 카운터 is the one exception: "shared by anyone ordering from
  // this table" is exactly the problem there, since "this table" is really
  // every unrelated walk-in customer. Showing them the combined
  // /api/orders/table/COUNTER list would mix in whatever a completely
  // different customer just ordered, with a wrong combined total to match.
  // So for the counter, only this device's own placed orders are shown —
  // the same locally-tracked id list saveOrderToHistory() already keeps.
  async function openHistory() {
    $("#historyTableLabel").textContent = isCounterTable ? t("counterBadge") : `${t("table")} ${tableNumber}`;
    const list = $("#historyList");
    list.innerHTML = `<div class="loading">…</div>`;
    $("#historyTotalBig").textContent = money(0);
    $("#historyBackdrop").hidden = false;
    try {
      let ordersForTable;
      if (isCounterTable) {
        const myIds = JSON.parse(localStorage.getItem(`hgk_orders_${tableNumber}`) || "[]");
        const results = await Promise.all(
          myIds.map((id) =>
            fetch(`/api/orders/${id}`)
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null)
          )
        );
        ordersForTable = results.filter((o) => o && o.status !== "paid" && o.status !== "cancelled");
      } else {
        const res = await fetch(`/api/orders/table/${encodeURIComponent(tableNumber)}`);
        ordersForTable = await res.json();
      }
      renderHistory(ordersForTable);
    } catch (e) {
      list.innerHTML = `<div class="history-empty">${t("networkErrorMsg")}</div>`;
    }
  }

  function renderHistory(ordersForTable) {
    const list = $("#historyList");
    list.innerHTML = "";
    // Summed from each order's own authoritative `total` (post-VIP-discount,
    // computed server-side at submit time — see src/routes/orders.js), NOT
    // recomputed from the per-item unit prices below. Those are still shown
    // per line for a normal itemized read-out; once a VIP discount applies
    // to an order they'll naturally add up to more than this grand total,
    // same as any receipt with a discount line — the total here is what
    // actually matters, since it's what #payOnlineBtn charges.
    let total = 0;
    // 이미 결제한 라운드는 따로 센다. 「합계」와 온라인 결제 금액은 아직 안
    // 낸 것만이어야 한다 — 여기에 결제된 것까지 더하면 손님이 같은 돈을 두 번
    // 내게 된다(서버는 미결제만 청구하므로 화면 숫자만 틀리는 것도 아니고,
    // 화면과 실제 청구액이 어긋난다).
    let paidTotal = 0;
    let anyItem = false;
    let anyVipDiscount = false;
    ordersForTable.forEach((o) => {
      const isPaid = o.status === "paid";
      o.items.forEach((it) => {
        anyItem = true;
        const name = it[`name_${lang}`] || it.name_zh || it.name_en || it.name_ko || "";
        const row = document.createElement("div");
        row.className = "history-item" + (isPaid ? " paid" : "");
        const addonsSuffix = (it.selected_addons || []).length ? ` +${it.selected_addons.map((a) => a.name).join(", ")}` : "";
        const optionSuffix = [it.option_choice, it.takeout_choice].filter(Boolean).join(", ");
        row.innerHTML = `
          <span class="history-item-name">${name}${optionSuffix ? ` (${optionSuffix})` : ""}${addonsSuffix}<span class="history-item-qty">x${it.qty}</span></span>
          <span class="history-item-price">${money(lineTotalOf(it))}${isPaid ? `<span class="history-paid-badge">${t("historyPaidBadge")}</span>` : ""}</span>
        `;
        list.appendChild(row);
      });
      if (isPaid) paidTotal += o.total;
      else total += o.total;
      if (o.vip_discount_percent) anyVipDiscount = true;
    });
    if (!anyItem) {
      list.innerHTML = `<div class="history-empty">${t("noOrdersYet")}</div>`;
    } else if (anyVipDiscount) {
      const note = document.createElement("div");
      note.className = "history-vip-note";
      note.textContent = t("historyVipDiscountAppliedMsg");
      list.appendChild(note);
    }
    if (anyItem && paidTotal > 0) {
      // 이미 낸 돈을 적어주지 않으면, 목록에는 있는데 합계에는 없는 금액이
      // 생겨서 손님이 계산이 틀렸다고 생각한다.
      const paidNote = document.createElement("div");
      paidNote.className = "history-paid-note";
      paidNote.textContent = `${t("historyAlreadyPaid")} ${money(paidTotal)}`;
      list.appendChild(paidNote);
    }
    $("#historyTotalBig").textContent = money(total);
    $("#payOnlineBtn").hidden = !(onlinePaymentEnabled && total > 0);
  }

  $("#payOnlineBtn").onclick = () => {
    if (!confirm(t("payOnlineConfirm"))) return;
    location.href = `/api/payment/checkout?table=${encodeURIComponent(tableNumber)}`;
  };

  $("#historyBtn").onclick = openHistory;
  $("#historyClose").onclick = () => ($("#historyBackdrop").hidden = true);
  $("#historyBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "historyBackdrop") $("#historyBackdrop").hidden = true;
  });

  // "관리자로 돌아가기" — only relevant when the manual-order table picker
  // (admin.js, #manualOrderBtn) sent staff here via a same-window
  // location.href navigation instead of window.open(). That path only runs
  // inside the kiosk POS app's WebView, which blocks window.open() entirely
  // (MainActivity.java's onCreateWindow), so admin.js appends ?fromAdmin=1
  // and we show a way back. Ordinary customers scanning the table QR code
  // never carry this param, so this stays hidden for them.
  if (fromAdmin) {
    const backBtn = $("#backToAdminBtn");
    backBtn.hidden = false;
    backBtn.onclick = goBackToAdmin;
    // 완료 화면의 큰 버튼도 여기서 켠다. 손님 주문에는 안 뜬다.
    const goBtn = $("#goToAdminOrdersBtn");
    if (goBtn) {
      goBtn.textContent = ADMIN_ORDERS_BTN[lang] || ADMIN_ORDERS_BTN.zh;
      goBtn.hidden = false;
      goBtn.onclick = () => {
        cancelAdminReturn();
        goBackToAdmin();
      };
      // 「계속 추가」는 이제 둘째 버튼이다 — 누르는 일이 드물다.
      const more = $("#backToMenuBtn");
      if (more) more.classList.add("secondary-btn");
    }
  }

  // Store info sheet
  $("#storeInfoBtn").onclick = () => ($("#storeInfoBackdrop").hidden = false);
  $("#storeInfoClose").onclick = () => ($("#storeInfoBackdrop").hidden = true);
  $("#storeInfoBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "storeInfoBackdrop") $("#storeInfoBackdrop").hidden = true;
  });

  // ---------- Membership (회원/VIP) sheet ----------
  // Firebase Auth (firebase-app-compat.js + firebase-auth-compat.js, loaded
  // from Google's CDN) used to sit as two plain <script> tags in order.html,
  // downloaded and parsed on EVERY customer page load before the menu could
  // even render — even though this store hasn't finished the one-time
  // Firebase Console setup yet (see vip-membership-system.md), so
  // initMembership() below always bailed out at `if (!rawConfig) return;`
  // anyway. That made every single customer pay the SDK's download/parse
  // cost for a feature that, right now, never actually turns on. 사장님
  // 피드백: "터치 후 반응 속도랑 링크 타고 들어가는 속도가... 느려" — this
  // is the biggest single cost we could remove from that initial load, so
  // the two <script> tags are gone from order.html and this now injects
  // them lazily, only once a store actually has a valid firebaseConfig.
  // Once a store does configure it, this still runs once per page load
  // (same as before) and behaves identically after that.
  let firebaseSdkPromise = null;
  function loadFirebaseSdk() {
    if (window.firebase) return Promise.resolve();
    if (firebaseSdkPromise) return firebaseSdkPromise;
    const FIREBASE_VERSION = "10.14.1";
    const loadScript = (src) =>
      new Promise((resolve, reject) => {
        const el = document.createElement("script");
        el.src = src;
        el.onload = resolve;
        el.onerror = reject;
        document.head.appendChild(el);
      });
    firebaseSdkPromise = loadScript(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app-compat.js`).then(() =>
      loadScript(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth-compat.js`)
    );
    return firebaseSdkPromise;
  }

  // Sets up Firebase Authentication from the store's own firebaseConfig
  // (Admin > 설정 > 회원(VIP) 로그인 — see PUBLIC_KEYS in src/routes/settings.js
  // for why that config is safe to ship to every customer). A store that
  // hasn't configured it yet — the overwhelming common case until the owner
  // does the one-time Firebase Console setup — leaves rawConfig empty and
  // this whole feature quietly never turns on: #memberBtn stays hidden,
  // firebaseAuth stays null, and every VIP-related check elsewhere in this
  // file already treats that as "not signed in / no membership".
  async function initMembership(rawConfig) {
    if (!rawConfig) return;
    let config;
    try {
      config = JSON.parse(rawConfig);
    } catch (e) {
      return;
    }
    if (!config || !config.apiKey || !config.projectId) return;
    try {
      await loadFirebaseSdk();
    } catch (e) {
      return; // SDK failed to load (e.g. offline) — degrade to no login, same as before
    }
    if (typeof firebase === "undefined") return; // shouldn't happen if loadFirebaseSdk() resolved, but stay defensive
    try {
      firebase.initializeApp(config);
      firebaseAuth = firebase.auth();
    } catch (e) {
      firebaseAuth = null;
      return;
    }
    $("#memberBtn").hidden = false;
    firebaseAuth.onAuthStateChanged(async (user) => {
      memberUser = user ? { name: user.displayName || user.email, email: user.email } : null;
      membership = null;
      if (user) await refreshMembership();
      renderMemberSheet();
      updateMemberBtnLabel();
      renderCart();
      renderCartFab();
    });
  }

  async function refreshMembership() {
    if (!firebaseAuth || !firebaseAuth.currentUser) {
      membership = null;
      return;
    }
    try {
      const idToken = await firebaseAuth.currentUser.getIdToken();
      const res = await fetch("/api/members/me", { headers: { Authorization: `Bearer ${idToken}` } });
      membership = res.ok ? (await res.json()).membership : null;
    } catch (e) {
      membership = null;
    }
  }

  function updateMemberBtnLabel() {
    const btn = $("#memberBtn");
    if (!btn) return;
    btn.textContent = membership && membership.active ? `⭐ ${t("memberBtnLabel")}` : t("memberBtnLabel");
  }

  function renderMemberSheet() {
    const signedOutEl = $("#memberSignedOut");
    const signedInEl = $("#memberSignedIn");
    if (!signedOutEl || !signedInEl) return; // firebase never initialized — nothing to render
    const signedIn = !!memberUser;
    signedOutEl.hidden = signedIn;
    signedInEl.hidden = !signedIn;
    if (!signedIn) return;
    $("#memberAccountLine").textContent = memberUser.name || memberUser.email || "";
    const hasCard = !!(membership && membership.card_number);
    $("#memberNoCard").hidden = hasCard;
    $("#memberHasCard").hidden = !hasCard;
    if (hasCard) {
      const badgeEl = $("#memberCardBadge");
      badgeEl.textContent = membership.active ? t("memberActiveBadge") : t("memberExpiredBadge");
      badgeEl.className = "member-card-badge" + (membership.active ? " active" : " expired");
      $("#memberCardInfo").innerHTML = `
        <div>${t("memberCardNumberLabel")} ${membership.card_number}</div>
        <div>${t("memberDiscountLabel")} ${membership.discount_percent}%</div>
        <div>${t("memberExpiryLabel")} ${membership.expiry_date || "-"}</div>
      `;
    }
  }

  const MEMBER_REGISTER_ERR = {
    card_not_found: "memberErrorCardNotFound",
    card_already_claimed: "memberErrorCardClaimed",
    already_registered: "memberErrorAlreadyRegistered",
  };

  $("#memberBtn").onclick = () => {
    renderMemberSheet();
    $("#memberBackdrop").hidden = false;
  };
  $("#memberClose").onclick = () => ($("#memberBackdrop").hidden = true);
  $("#memberBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "memberBackdrop") $("#memberBackdrop").hidden = true;
  });

  $("#googleSignInBtn").onclick = async () => {
    if (!firebaseAuth) return;
    const msg = $("#memberSignInMsg");
    msg.hidden = true;
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await firebaseAuth.signInWithPopup(provider);
      // onAuthStateChanged above picks up the result and re-renders.
    } catch (e) {
      // Includes the ordinary case of the customer just closing the Google
      // popup themselves — not worth alarming wording for that, so this
      // stays a plain, low-key message either way.
      msg.textContent = t("memberSignInFailedMsg");
      msg.hidden = false;
    }
  };

  $("#memberSignOutBtn").onclick = async () => {
    if (firebaseAuth) await firebaseAuth.signOut();
  };

  $("#memberRegisterBtn").onclick = async () => {
    const cardNumber = $("#memberCardInput").value.trim();
    const msg = $("#memberRegisterMsg");
    msg.style.color = "";
    if (!cardNumber) {
      msg.textContent = t("memberCardNumberRequiredMsg");
      msg.hidden = false;
      return;
    }
    if (!firebaseAuth || !firebaseAuth.currentUser) return;
    const btn = $("#memberRegisterBtn");
    btn.disabled = true;
    try {
      const idToken = await firebaseAuth.currentUser.getIdToken();
      const res = await fetch("/api/members/register-card", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ cardNumber }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        msg.style.color = "#b3261e";
        msg.textContent = t(MEMBER_REGISTER_ERR[data.error] || "memberRegisterErrorGeneric");
        msg.hidden = false;
        return;
      }
      membership = data.membership;
      $("#memberCardInput").value = "";
      msg.hidden = true;
      renderMemberSheet();
      updateMemberBtnLabel();
      renderCart();
      renderCartFab();
    } catch (e) {
      msg.style.color = "#b3261e";
      msg.textContent = t("networkErrorMsg");
      msg.hidden = false;
    } finally {
      btn.disabled = false;
    }
  };

  // Language sheet
  $("#langPillBtn").onclick = () => ($("#langBackdrop").hidden = false);
  $("#langSheetClose").onclick = () => ($("#langBackdrop").hidden = true);
  $("#langBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "langBackdrop") $("#langBackdrop").hidden = true;
  });
  document.querySelectorAll(".lang-option[data-lang]").forEach((b) => {
    b.onclick = () => {
      lang = b.dataset.lang;
      applyStaticI18n();
      loadSettings();
      renderTabs();
      renderMenu();
      renderCartFab();
      $("#langBackdrop").hidden = true;
    };
  });

  // Currency sheet — just swaps the displayed symbol (no exchange-rate
  // conversion), same reset-per-load behavior as the language picker above.
  $("#currencyPillBtn").onclick = () => ($("#currencyBackdrop").hidden = false);
  $("#currencySheetClose").onclick = () => ($("#currencyBackdrop").hidden = true);
  $("#currencyBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "currencyBackdrop") $("#currencyBackdrop").hidden = true;
  });
  document.querySelectorAll(".lang-option[data-currency]").forEach((b) => {
    b.onclick = () => {
      currency = b.dataset.currency;
      applyStaticI18n();
      renderMenu();
      renderCartFab();
      $("#currencyBackdrop").hidden = true;
    };
  });

  // Party size: required before ordering. Kept on the table itself (server
  // side) since until payment everyone ordering from a table is treated as
  // the same party — this also feeds the soft "1인 1메뉴" reminder at
  // checkout and shows up on the kitchen ticket in admin.
  //
  // It must survive a page refresh / re-scan mid-visit (the same party
  // shouldn't be asked again just because their phone reloaded the page),
  // so on every load we first ask the server whether this table already
  // has one registered. It's tied to the table's orders as one bundled
  // unit, not tracked separately: the moment the table's last order is
  // paid or cancelled (one order paid off at a time, all of them via
  // admin's "전체 결제 완료", or a completed online payment), the server
  // clears it as a side effect of that same status change (see the PATCH
  // handler in src/routes/orders.js) — which is the real signal that this
  // party is done and the table is free for whoever scans it next.
  let adultsStep = 1;
  let childrenStep = 0;
  function renderPartySizeModal() {
    $("#partyAdultsVal").textContent = adultsStep;
    $("#partyChildrenVal").textContent = childrenStep;
    const total = adultsStep + childrenStep;
    // 합계를 적어준다. 두 줄로 나뉘어 있으면 "그래서 몇 명으로 들어갔지"가
    // 바로 안 보이는데, 이 숫자가 빌지와 결산에 그대로 들어가는 값이다.
    $("#partyTotalMsg").textContent = total > 0 ? t("partyTotalLabel").replace("{n}", total) : "";
    // 아무도 없는 인원수는 저장할 수 없다 — 서버도 막지만, 눌러본 뒤에
    // 알림창으로 알게 되는 것보다 버튼이 안 눌리는 편이 낫다.
    $("#partySizeConfirmBtn").disabled = total < 1;
  }
  function showPartySizeModal() {
    adultsStep = 1;
    childrenStep = 0;
    renderPartySizeModal();
    $("#partySizeBackdrop").hidden = false;
  }

  // Counter/takeout QR: instead of a headcount, every order needs the
  // customer's name — that's what staff call out at pickup, alongside the
  // auto-assigned pickup number the server stamps onto the order (see
  // src/routes/orders.js). Kept in sessionStorage (not localStorage) so it
  // survives an accidental reload mid-order but never leaks into the next
  // browser session — and cleared outright the moment an order goes through
  // (see #submitOrderBtn), so every counter order asks again from scratch.
  const COUNTER_NAME_KEY = "hgk_counter_name";
  // Phone number requested alongside the name (2026-09 피드백) so staff can
  // reach a takeout customer if there's an issue with their order — kept in
  // the same sessionStorage-per-visit pattern as the name above.
  const COUNTER_PHONE_KEY = "hgk_counter_phone";
  // 이 기기에서 마지막으로 등록한 카운터 손님("이름|번호"). 위 두 개와 달리
  // localStorage 다 — 탭을 새로 열어도 「앞 손님이 누구였나」는 알아야
  // 주문 기록을 끊을지 이어갈지 판단할 수 있다. 아래 #counterNameConfirmBtn.
  const COUNTER_LAST_KEY = "hgk_counter_last";
  function showCounterNameModal() {
    $("#counterNameInput").value = "";
    $("#counterPhoneInput").value = "";
    $("#counterNameBackdrop").hidden = false;
    setTimeout(() => $("#counterNameInput").focus(), 50);
  }
  /**
   * 이 자리 손님이 다른 자리로 옮겨졌는가 — 옮겨졌으면 새 자리로 데려다준다.
   *
   * 2026-09-10 사장님: "이미 손님이 해당 qr 코드로 되어있잖아. 그럼 qr 코드
   * 이미 들어가있다면 이동을 도와드리겠다고 하고 확인 버튼만 있게 해줘."
   *
   * 「아까 여기서 시킨 그 손님」에게만 보여준다. 5분 뒤 이 자리에 새로 앉은
   * 손님에게 "자리가 옮겨졌어요" 가 뜨면 그게 더 큰 혼란이다. 이 폰은 자기가
   * 넣은 주문 번호를 들고 있으니(localStorage), 서버가 알려준 옮긴 주문
   * 번호와 겹치는 게 있을 때만 뜬다.
   */
  /**
   * 이 폰이 「지금 이 자리에 앉아 있는 손님의 폰」 이라는 표시를 남긴다.
   *
   * 직원이 대신 넣어준 주문은 이 폰에 주문 번호가 없다(2026-09-10 사장님이
   * 실제로 그렇게 시험하셨다). 그때도 손님은 이 화면을 보고 있으므로,
   * 「언제 앉은 손님의 화면을 봤는가」 로는 알아볼 수 있다.
   */
  function rememberSeating(seatingStartedAt) {
    if (!seatingStartedAt) return;
    try {
      localStorage.setItem(SEAT_KEY, seatingStartedAt);
    } catch (e) {
      /* 저장이 막혀 있어도 주문 번호 쪽으로는 여전히 알아본다 */
    }
  }

  function checkMovedTable(moved) {
    if (movedNoticeShown) return true;
    if (!moved || !moved.to) return false;
    let myIds = [];
    let seenSeating = null;
    try {
      myIds = JSON.parse(localStorage.getItem(`hgk_orders_${tableNumber}`) || "[]");
      seenSeating = localStorage.getItem(SEAT_KEY);
    } catch (e) {
      myIds = [];
    }
    const ids = moved.order_ids || [];
    const mine =
      myIds.some((id) => ids.includes(id)) ||
      (!!moved.seating && seenSeating === moved.seating);
    if (!mine) return false;
    movedNoticeShown = true;

    // 사장님이 정한 문구(2026-09-10): "자리 이동을 요청하신 것 같아요!
    // 주문 링크 이동도 도와드릴께요 / 확인". 버튼은 「확인」 하나뿐이고,
    // 어느 자리로 가는지는 그 위에 크게 적는다 — 버튼에 번호를 넣으면
    // 문구가 길어져서 누를 것이 하나라는 게 흐려진다.
    $("#movedMsg").innerHTML =
      `${t("movedFrom")}<b class="moved-table">${escapeHtml(moved.to)}</b>`;
    const btn = $("#movedGoBtn");
    btn.textContent = t("movedGoBtn");
    btn.onclick = () => {
      // 주문 내역도 새 자리로 옮겨준다 — 안 그러면 새 자리에서 「내 주문」이
      // 비어 있고, 손님은 자기 주문이 사라진 줄 안다.
      try {
        const key = `hgk_orders_${moved.to}`;
        const existing = JSON.parse(localStorage.getItem(key) || "[]");
        localStorage.setItem(key, JSON.stringify([...new Set([...existing, ...ids])].slice(-10)));
      } catch (e) {
        /* 저장이 안 돼도 이동 자체는 되어야 한다 */
      }
      // 옛 자리의 표시는 지운다. 남겨두면 나중에 이 폰으로 그 자리를 다시
      // 열었을 때 지난 안내가 또 뜬다. 주문 번호도 옮겨간 자리로 「옮기는」
      // 것이지 복사가 아니다 — 옛 자리에 그대로 남겨두면 뒤로 가기 한 번에
      // 이미 확인한 안내가 다시 뜬다.
      try {
        localStorage.removeItem(SEAT_KEY);
        localStorage.removeItem(`hgk_orders_${tableNumber}`);
      } catch (e) {}
      // 서버에도 다 봤다고 알린다 — 그래야 옛 자리가 그 즉시 깨끗해진다
      // (2026-09-10 사장님: "그 즉시 그 자리는 빈 자리로"). 답을 기다리지
      // 않는다. 이동 자체가 이 요청 때문에 늦어지면 안 된다.
      try {
        fetch(`/api/tables/${encodeURIComponent(tableNumber)}/moved-ack`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: moved.to }),
          keepalive: true,
        }).catch(() => {});
      } catch (e) {}
      location.href = `/t/${encodeURIComponent(moved.to)}`;
    };
    $("#movedBackdrop").hidden = false;
    return true;
  }

  /**
   * 지금 물어볼 수 없어서 미뤄둔 질문 — "party"(인원수) 또는 "counter"(포장
   * 이름·전화).
   *
   * 2026-09-10 사장님: "주문 가능 시간이 아니면 인원수도 묻지 말아야 돼.
   * 안 그러면 인원수는 있는데 이상하게 돼."
   *
   * 실제로 이상해지는 방식은 이렇다. 영업이 끝난 뒤 QR 을 찍은 손님이
   * 인원수를 넣으면 그 자리에 party_size 가 박히고, 그 순간부터 관리자
   * 화면에는 아무도 없는 자리에 「👥 4인」 배지가 뜬다. 주문이 하나도 없으니
   * 결제로 지워질 일도 없어서, 다음 날 아침 첫 손님이 앉을 때까지 그대로
   * 남는다. 게다가 그 자리는 「손님이 앉아 있다」로 취급되므로 새로 온 손님
   * 에게는 인원수를 아예 안 묻게 된다 — 어제 밤 지나가던 사람이 넣은 숫자로
   * 오늘 장사를 하게 되는 것이다.
   *
   * 그래서 묻지 않고 들고만 있다가, 영업이 시작되면(1분마다 도는
   * refreshOrderingState → applyOrderingState) 그때 묻는다. 손님은 화면을
   * 그대로 둔 채 기다리기만 하면 된다.
   */
  let pendingSeatingPrompt = null;
  function askSeatingIfOpen() {
    if (!pendingSeatingPrompt) return;
    if (orderingClosed()) return;
    const which = pendingSeatingPrompt;
    pendingSeatingPrompt = null;
    if (which === "counter") showCounterNameModal();
    else showPartySizeModal();
  }

  async function initPartySize() {
    try {
      const res = await fetch(`/api/tables/${encodeURIComponent(tableNumber)}/party-size`);
      const data = await res.json();
      // 자리가 아예 없다(404). 네트워크가 끊긴 것과는 다르다 — 그건 아래
      // catch 로 가서 예전처럼 묻는다. 여기서만 화면을 잠근다.
      if (res.status === 404) {
        tableGone = true;
        applyOrderingState();
        return;
      }
      if (res.ok && data.realtime_channel) {
        realtimeChannelName = data.realtime_channel;
        initRealtimeTable();
      }
      // 인원수를 묻기 전에 확인한다. 옮겨간 손님에게 이 자리 인원수를
      // 물어보면, 그 손님은 옮긴 줄도 모르고 여기에 다시 자리를 잡는다.
      if (res.ok && checkMovedTable(data.moved_to)) return;
      if (res.ok && data.is_counter) {
        // No headcount at all for the counter — skip that modal entirely,
        // and set a dummy partySize so the belt-and-suspenders check in
        // #submitOrderBtn (below) doesn't mistake this for "not asked yet".
        isCounterTable = true;
        partySize = 1;
        $("#itemOrderTypeTabs").hidden = true;
        applyStaticI18n(); // re-render the badge now that we know this is the counter
        const savedName = (sessionStorage.getItem(COUNTER_NAME_KEY) || "").trim();
        const savedPhone = (sessionStorage.getItem(COUNTER_PHONE_KEY) || "").trim();
        if (savedName && savedPhone) {
          counterCustomerName = savedName;
          counterCustomerPhone = savedPhone;
        } else {
          // 인원수와 같은 이유로 영업시간 밖에서는 묻지 않는다 — 주문을 못
          // 넣는 화면에서 이름과 전화번호부터 받아두는 건 손님에게 곧
          // 주문이 된다는 뜻으로 읽힌다.
          pendingSeatingPrompt = "counter";
          askSeatingIfOpen();
        }
        return;
      }
      if (res.ok) hasPriorOrder = !!data.has_prior_order;
      if (res.ok) rememberSeating(data.seating_started_at);
      if (res.ok && data.party_size) {
        partySize = data.party_size;
        // 구분이 생기기 전에 앉은 손님이면 서버가 전부 어른으로 채워 보낸다.
        partyAdults = data.party_adults == null ? data.party_size : data.party_adults;
        partyChildren = data.party_children || 0;
        return; // already registered for this table's current party — don't ask again
      }
    } catch (e) {
      /* network error — fall through and ask, same as if none was registered */
    }
    pendingSeatingPrompt = "party";
    askSeatingIfOpen();
  }
  $("#counterNameConfirmBtn").onclick = () => {
    const name = $("#counterNameInput").value.trim();
    const phone = $("#counterPhoneInput").value.trim();
    if (!name) {
      alert(t("counterNameRequiredMsg"));
      return;
    }
    if (!phone) {
      alert(t("counterPhoneRequiredMsg"));
      return;
    }
    counterCustomerName = name.slice(0, 20);
    counterCustomerPhone = phone.slice(0, 20);
    // 앞 손님과 다른 분인가. 포장 카운터 화면은 기기 하나를 여러 손님이
    // 나눠 쓴다 — 직원이 전화 주문을 받을 때가 특히 그렇다. 이름과 번호가
    // 앞 손님과 다르면 이 기기에 쌓인 주문 기록(hgk_orders_*)을 끊는다.
    // 안 끊으면 「내역」에 남의 주문이 섞여 합계와 온라인 결제 금액까지
    // 그 사람 것이 더해지고, hasPriorOrder 가 계속 참이라 불판 첫 주문
    // 최소수량도 그냥 넘어간다.
    //
    // 같은 이름·번호면 한 분이 이어서 주문하는 것이므로 그대로 둔다 —
    // 방금 넣은 주문을 내역에서 못 보게 되면 온라인 결제를 못 한다.
    const counterWho = `${counterCustomerName}|${counterCustomerPhone}`;
    try {
      if (localStorage.getItem(COUNTER_LAST_KEY) !== counterWho) {
        localStorage.removeItem(`hgk_orders_${tableNumber}`);
        hasPriorOrder = false;
      }
      localStorage.setItem(COUNTER_LAST_KEY, counterWho);
    } catch (err) {
      /* 저장이 막힌 기기 — 기록만 못 끊는다. 주문 자체는 그대로 들어간다 */
    }
    try {
      sessionStorage.setItem(COUNTER_NAME_KEY, counterCustomerName);
      sessionStorage.setItem(COUNTER_PHONE_KEY, counterCustomerPhone);
    } catch (err) {
      /* 저장이 막힌 기기 */
    }
    $("#counterNameBackdrop").hidden = true;
    resetIdleTimer();
  };
  // 어른은 0까지 내려간다 — 아이만 앉는 자리는 없다시피 하지만, 어른 칸이
  // 1에서 안 내려가면 "아이 2명"을 넣으려던 손님이 3명으로 넣게 된다.
  // 대신 합계가 0이면 확인 버튼이 잠긴다(renderPartySizeModal).
  $("#partyAdultsMinus").onclick = () => {
    adultsStep = Math.max(0, adultsStep - 1);
    renderPartySizeModal();
  };
  $("#partyAdultsPlus").onclick = () => {
    adultsStep = Math.min(30, adultsStep + 1);
    renderPartySizeModal();
  };
  $("#partyChildrenMinus").onclick = () => {
    childrenStep = Math.max(0, childrenStep - 1);
    renderPartySizeModal();
  };
  $("#partyChildrenPlus").onclick = () => {
    childrenStep = Math.min(30, childrenStep + 1);
    renderPartySizeModal();
  };
  $("#partySizeConfirmBtn").onclick = async () => {
    const btn = $("#partySizeConfirmBtn");
    btn.disabled = true;
    try {
      const res = await fetch(`/api/tables/${encodeURIComponent(tableNumber)}/party-size`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adults: adultsStep, children: childrenStep }),
      });
      // fetch() only rejects on a network-level failure — a 4xx/5xx response
      // still resolves normally, so this must be checked explicitly.
      // Otherwise a save that actually failed server-side (table not found,
      // a transient error, etc.) would still close this modal and set
      // partySize locally, and the customer would only find out something
      // was wrong when order submission later gets rejected with
      // party_size_required and this same modal pops back up — confusing,
      // since they already thought they'd answered it once.
      if (!res.ok) throw new Error("save_failed");
      partyAdults = adultsStep;
      partyChildren = childrenStep;
      partySize = adultsStep + childrenStep;
      $("#partySizeBackdrop").hidden = true;
      resetIdleTimer();
    } catch (e) {
      alert(t("networkErrorMsg"));
    } finally {
      btn.disabled = false;
    }
  };

  // Security: if the phone sits untouched for too long, lock the page and
  // require re-scanning the table's QR code. This stops an old session
  // (customer who already left, or a stray phone) from placing surprise
  // orders onto a table long after the fact — re-scanning is trivial for an
  // actual customer, so there's no real cost to being strict about it.
  const IDLE_LIMIT_MS = 3 * 60 * 1000;
  const IDLE_WARNING_MS = IDLE_LIMIT_MS - 60 * 1000; // warn 1 minute before it locks
  let idleTimer = null;
  let idleWarningTimer = null;
  function lockSession() {
    hideIdleWarning();
    stopStatusPolling();
    $("#sessionLockBackdrop").hidden = false;
  }
  function showIdleWarning() {
    $("#idleWarningText").textContent = t("idleWarningMsg");
    $("#idleWarningBanner").hidden = false;
  }
  function hideIdleWarning() {
    $("#idleWarningBanner").hidden = true;
  }
  function resetIdleTimer() {
    hideIdleWarning();
    clearTimeout(idleTimer);
    clearTimeout(idleWarningTimer);
    idleWarningTimer = setTimeout(showIdleWarning, IDLE_WARNING_MS);
    idleTimer = setTimeout(lockSession, IDLE_LIMIT_MS);
  }
  // "확인" is marked [data-idle-ignore] so tapping it doesn't itself count as
  // activity — the countdown keeps running toward the lock exactly as it
  // was. "연장" (and any other normal interaction with the page) resets it
  // back to a fresh 3 minutes as usual.
  ["click", "touchstart", "keydown", "scroll", "input"].forEach((evt) => {
    document.addEventListener(
      evt,
      (e) => {
        if (e.target && e.target.closest && e.target.closest("[data-idle-ignore]")) return;
        resetIdleTimer();
      },
      { passive: true }
    );
  });
  $("#idleExtendBtn").onclick = () => resetIdleTimer();
  $("#idleAckBtn").onclick = () => hideIdleWarning();
  resetIdleTimer();

  applyStaticI18n();
  // 설정 → 메뉴 순서는 예전 그대로 둔다. 바뀐 것은 「인원수를 언제 묻는가」뿐이다.
  const settingsReady = loadSettings().catch(() => {});
  loadMenu();
  // checkPriorOrder() must run after initPartySize() resolves — it branches
  // on isCounterTable (see the comment inside checkPriorOrder), which
  // initPartySize() is what sets.
  // loadSettings() 를 먼저 기다린다 — 영업시간을 알기 전에 initPartySize() 가
  // 돌면 「지금 주문할 수 있는가」를 모르는 채로 인원수를 묻게 된다.
  // 설정을 못 받아온 경우에는 예전처럼 묻는다(기본값이 "열림"이다). 네트워크가
  // 잠깐 끊긴 것 때문에 앉아 계신 손님이 주문을 못 하게 되면 더 나쁘다.
  settingsReady.then(() => initPartySize()).then(checkPriorOrder);
})();
