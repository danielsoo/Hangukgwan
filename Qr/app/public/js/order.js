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
  let onlinePaymentEnabled = false;
  // True when this QR points at the counter's takeout-only order flow
  // instead of a real dine-in table (see the "포장 카운터" section in Admin >
  // 테이블 / QR 코드) — set once initPartySize() learns it from the server.
  // Skips the headcount prompt entirely and defaults every item to 포장.
  let isCounterTable = false;
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

  const PARTY_WARNING = {
    zh: (n) => `您點的餐點數量少於 ${n} 人份，需要再加點嗎？`,
    ko: (n) => `인원(${n}명)보다 주문한 메뉴 수가 적어요. 더 담으시겠어요?`,
    en: (n) => `Your order has fewer items than your party size (${n}). Feel free to add more if you'd like.`,
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

  function money(n) {
    return `${CURRENCY_SYMBOL[currency] || "NT$"}${n}`;
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

  async function loadSettings() {
    const res = await fetch("/api/settings");
    const s = await res.json();
    const lat = parseFloat(s.store_lat);
    const lng = parseFloat(s.store_lng);
    storeLat = Number.isNaN(lat) ? null : lat;
    storeLng = Number.isNaN(lng) ? null : lng;
    onlinePaymentEnabled = !!s.online_payment_enabled;
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
    if (isCounterTable) {
      const myIds = JSON.parse(localStorage.getItem(`hgk_orders_${tableNumber}`) || "[]");
      hasPriorOrder = myIds.length > 0;
      return;
    }
    try {
      const res = await fetch(`/api/orders/table/${encodeURIComponent(tableNumber)}`);
      const list = await res.json();
      hasPriorOrder = Array.isArray(list) && list.length > 0;
    } catch (e) {
      /* leave hasPriorOrder at its safe default (false = enforce minimum) */
    }
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
    const icons = (item.options || "")
      .split(",")
      .map((o) => o.trim())
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
    currentOption = item.options ? item.options.split(",")[0].trim() : null;
    currentSpiceOption = item.spice_options ? item.spice_options.split(",")[0].trim() : null;
    // A counter/takeout QR has no dine-in seat to speak of, so every item
    // defaults to 포장 there instead of the usual 매장 default — the toggle
    // itself is hidden for the same reason (see initPartySize below).
    currentOrderType = isCounterTable ? "takeout" : "dine_in";
    document.querySelectorAll("#itemOrderTypeTabs .order-type-tab[data-type]").forEach((b) => {
      b.classList.toggle("active", b.dataset.type === currentOrderType);
    });
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
      item.spice_options.split(",").forEach((opt, i) => {
        const b = document.createElement("button");
        b.textContent = opt.trim();
        if (i === 0) b.classList.add("active");
        b.onclick = () => {
          currentSpiceOption = opt.trim();
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
      $("#mixOptionsHint").textContent = t("mixOptionsHint");
      const opts = item.options.split(",").map((s) => s.trim());
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
      if (item.options) {
        optWrap.hidden = false;
        item.options.split(",").forEach((opt, i) => {
          const b = document.createElement("button");
          b.textContent = optionLabel(opt.trim());
          if (i === 0) b.classList.add("active");
          b.onclick = () => {
            currentOption = opt.trim();
            optList.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
            b.classList.add("active");
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
      const totalQty = Object.values(mixQty).reduce((sum, q) => sum + q, 0);
      $("#addToCartPrice").textContent = money((currentItem.price + addonsPrice) * totalQty);
    } else {
      $("#addToCartPrice").textContent = money((currentItem.price + addonsPrice) * currentQty);
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
          cart.push({ itemId: currentItem.id, item: currentItem, qty: mixQty[opt], option: opt, spice: currentSpiceOption, orderType: currentOrderType, addons: [...currentAddons] });
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
        orderType: currentOrderType,
        addons: [...currentAddons],
      });
    }
    $("#itemSheetBackdrop").hidden = true;
    renderCartFab();
  };

  function cartTotal() {
    return cart.reduce((sum, c) => sum + (c.item.price + addonsPriceFor(c.item, c.addons)) * c.qty, 0);
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
            <button data-act="remove" style="margin-left:8px;">${t("remove")}</button>
          </div>
        </div>
        <div class="cart-item-right">${money((c.item.price + addonsPriceFor(c.item, c.addons)) * c.qty)}</div>
      `;
      row.querySelector('[data-act="minus"]').onclick = () => {
        // No min_first_order_qty floor here either (see #qtyMinus above) —
        // the server re-checks the minimum at submit and shows an
        // explanatory alert (see #submitOrderBtn's grill_min_qty handling)
        // if the cart ends up under it.
        c.qty = Math.max(1, c.qty - 1);
        renderCart();
        renderCartFab();
      };
      row.querySelector('[data-act="plus"]').onclick = () => {
        c.qty = Math.min(20, c.qty + 1);
        renderCart();
        renderCartFab();
      };
      row.querySelector('[data-act="remove"]').onclick = () => {
        cart.splice(idx, 1);
        renderCart();
        renderCartFab();
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
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    });
  }

  // Blocking version of the old auto-dismissing toast (2026-09 피드백:
  // "인원수에 맞춰서 주문하라는 메시지창을 본인이 ok 누르고 닫을수 있도록") — the
  // customer must tap the button themselves to close it, instead of it
  // silently vanishing after 3.5s whether or not they saw it. Confirming
  // continues on to actually submit the order (this is a heads-up, not a
  // hard block on ordering less than the headcount).
  function showPartyWarningModal(onConfirm) {
    $("#partyWarningMsg").textContent = (PARTY_WARNING[lang] || PARTY_WARNING.zh)(partySize);
    $("#partyWarningBackdrop").hidden = false;
    $("#partyWarningConfirmBtn").onclick = () => {
      $("#partyWarningBackdrop").hidden = true;
      onConfirm();
    };
  }

  $("#submitOrderBtn").onclick = () => submitOrderFlow(false);

  async function submitOrderFlow(skipPartyWarning) {
    if (cart.length === 0) return;
    const btn = $("#submitOrderBtn");

    // Belt-and-suspenders: party size is required before an order can go
    // through, even if something let the modal get skipped/dismissed.
    if (!partySize) {
      showPartySizeModal();
      return;
    }
    // Same belt-and-suspenders idea for the counter's required pickup name.
    if (isCounterTable && !counterCustomerName) {
      showCounterNameModal();
      return;
    }

    if (!skipPartyWarning && !isCounterTable && partySize && cartCount() < partySize) {
      showPartyWarningModal(() => submitOrderFlow(true));
      return;
    }

    let coords = null;
    if (storeLat != null && storeLng != null) {
      try {
        coords = await getGeolocation();
      } catch (e) {
        alert(t("locationErrorMsg"));
        return;
      }
    }

    btn.disabled = true;
    btn.textContent = t("submitting");
    let grillMinBody = null;
    // Signed-in customers carry their Firebase ID token along so the server
    // can independently verify it and look up their linked VIP card itself
    // (see src/routes/orders.js) — the discount is never something the
    // client asserts. Harmless to always attempt this when signed in, even
    // with no card linked yet: the server just finds nothing and charges
    // full price, same as any other customer.
    const authHeaders = { "Content-Type": "application/json" };
    if (firebaseAuth && firebaseAuth.currentUser) {
      try {
        const idToken = await firebaseAuth.currentUser.getIdToken();
        authHeaders.Authorization = `Bearer ${idToken}`;
      } catch (e) {
        /* couldn't refresh the token — submit as a normal (non-VIP) order rather than blocking checkout over it */
      }
    }
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          tableNumber,
          // Each cart line carries its own orderType now (chosen per dish in
          // the item sheet) — see src/routes/orders.js, which validates and
          // stores order_type per item instead of once for the whole order.
          items: cart.map((c) => ({ itemId: c.itemId, qty: c.qty, option: c.option, spice: c.spice, orderType: c.orderType, addons: c.addons || [] })),
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
      cart = [];
      renderCartFab();
      $("#cartBackdrop").hidden = true;
      showConfirmation(order);
    } catch (e) {
      if (e.message === "out_of_range") alert(t("locationOutOfRangeMsg"));
      else if (e.message === "location_required") alert(t("locationRequiredMsg"));
      else if (e.message === "party_size_required") showPartySizeModal();
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
    } finally {
      btn.disabled = false;
      btn.textContent = t("placeOrder");
    }
  };

  function saveOrderToHistory(id) {
    const key = `hgk_orders_${tableNumber}`;
    const list = JSON.parse(localStorage.getItem(key) || "[]");
    list.push(id);
    localStorage.setItem(key, JSON.stringify(list.slice(-10)));
  }

  const STATUS_STEPS = ["new", "preparing", "served", "paid"];
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
    let anyItem = false;
    let anyVipDiscount = false;
    ordersForTable.forEach((o) => {
      o.items.forEach((it) => {
        anyItem = true;
        const name = it[`name_${lang}`] || it.name_zh || it.name_en || it.name_ko || "";
        const row = document.createElement("div");
        row.className = "history-item";
        const addonsSuffix = (it.selected_addons || []).length ? ` +${it.selected_addons.map((a) => a.name).join(", ")}` : "";
        row.innerHTML = `
          <span class="history-item-name">${name}${it.option_choice ? ` (${it.option_choice})` : ""}${addonsSuffix}<span class="history-item-qty">x${it.qty}</span></span>
          <span class="history-item-price">${money((it.unit_price + (it.selected_addons || []).reduce((s, a) => s + a.price, 0)) * it.qty)}</span>
        `;
        list.appendChild(row);
      });
      total += o.total;
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
  let partySizeStep = 1;
  function showPartySizeModal() {
    partySizeStep = 1;
    $("#partySizeVal").textContent = partySizeStep;
    $("#partySizeBackdrop").hidden = false;
  }

  // Counter/takeout QR: instead of a headcount, every order needs the
  // customer's name — that's what staff call out at pickup, alongside the
  // auto-assigned pickup number the server stamps onto the order (see
  // src/routes/orders.js). Kept in sessionStorage (not localStorage) so it's
  // asked fresh for a genuinely new visit but survives an accidental reload
  // of the same tab/visit.
  const COUNTER_NAME_KEY = "hgk_counter_name";
  // Phone number requested alongside the name (2026-09 피드백) so staff can
  // reach a takeout customer if there's an issue with their order — kept in
  // the same sessionStorage-per-visit pattern as the name above.
  const COUNTER_PHONE_KEY = "hgk_counter_phone";
  function showCounterNameModal() {
    $("#counterNameInput").value = "";
    $("#counterPhoneInput").value = "";
    $("#counterNameBackdrop").hidden = false;
    setTimeout(() => $("#counterNameInput").focus(), 50);
  }
  async function initPartySize() {
    try {
      const res = await fetch(`/api/tables/${encodeURIComponent(tableNumber)}/party-size`);
      const data = await res.json();
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
          showCounterNameModal();
        }
        return;
      }
      if (res.ok && data.party_size) {
        partySize = data.party_size;
        return; // already registered for this table's current party — don't ask again
      }
    } catch (e) {
      /* network error — fall through and ask, same as if none was registered */
    }
    showPartySizeModal();
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
    sessionStorage.setItem(COUNTER_NAME_KEY, counterCustomerName);
    sessionStorage.setItem(COUNTER_PHONE_KEY, counterCustomerPhone);
    $("#counterNameBackdrop").hidden = true;
    resetIdleTimer();
  };
  $("#partySizeMinus").onclick = () => {
    partySizeStep = Math.max(1, partySizeStep - 1);
    $("#partySizeVal").textContent = partySizeStep;
  };
  $("#partySizePlus").onclick = () => {
    partySizeStep = Math.min(30, partySizeStep + 1);
    $("#partySizeVal").textContent = partySizeStep;
  };
  $("#partySizeConfirmBtn").onclick = async () => {
    const btn = $("#partySizeConfirmBtn");
    btn.disabled = true;
    try {
      const res = await fetch(`/api/tables/${encodeURIComponent(tableNumber)}/party-size`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partySize: partySizeStep }),
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
      partySize = partySizeStep;
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
  loadSettings();
  loadMenu();
  // checkPriorOrder() must run after initPartySize() resolves — it branches
  // on isCounterTable (see the comment inside checkPriorOrder), which
  // initPartySize() is what sets.
  initPartySize().then(checkPriorOrder);
})();
