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
  let cart = []; // { itemId, qty, option, spice, note, item }
  // 매장(dine-in) vs 포장(takeout) — see the .order-type-tabs pill at the top
  // of the page. Always starts at "dine_in" and is never persisted, same
  // reset-on-fresh-load behavior as lang/currency above — a customer sitting
  // at the table should never see a stale "takeout" selection from whoever
  // used this table before them.
  let orderType = "dine_in";
  let currentItem = null;
  let currentOption = null;
  let currentSpiceOption = null;
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
    $("#tableBadge").textContent = `${t("table")} ${tableNumber}`;
    $("#langPillLabel").textContent = LANG_PILL_LABEL[lang] || "Language";
    document.querySelectorAll(".lang-option").forEach((b) => {
      if (b.dataset.lang) b.classList.toggle("active", b.dataset.lang === lang);
      if (b.dataset.currency) b.classList.toggle("active", b.dataset.currency === currency);
    });
    $("#currencyPillLabel").textContent = CURRENCY_SYMBOL[currency] || "NT$";
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
    $("#itemPhoto").style.backgroundImage = item.photo_url ? `url('${item.photo_url}')` : "";
    $("#itemPhoto").textContent = item.photo_url ? "" : "";
    $("#itemName").textContent = nameFor(item);
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
    $("#itemNote").value = "";
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

    if (item.mix_options && item.options) {
      // e.g. 동판불고기: 牛/豬 get their own independent +/- counters instead
      // of a single radio choice, so a table can mix both in one line item.
      optWrap.hidden = true;
      qtyRow.hidden = true;
      mixWrap.hidden = false;
      $("#mixOptionsHint").textContent = t("mixOptionsHint");
      const opts = item.options.split(",").map((s) => s.trim());
      mixQty = {};
      // Default to 1 of each — meets the >=2 combined minimum by default,
      // whether or not this happens to be the table's first order.
      opts.forEach((opt) => (mixQty[opt] = 1));
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
          b.textContent = opt.trim();
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

  // Renders one +/- row per option for a mix_options item (see openItemSheet
  // above) into #mixOptionsList, wired to mutate the shared `mixQty` map.
  function renderMixOptions(opts) {
    const mixList = $("#mixOptionsList");
    mixList.innerHTML = "";
    opts.forEach((opt) => {
      const row = document.createElement("div");
      row.className = "mix-option-row";
      row.innerHTML = `
        <span class="mix-option-name">${opt}</span>
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
    if (currentItem.mix_options) {
      const totalQty = Object.values(mixQty).reduce((sum, q) => sum + q, 0);
      $("#addToCartPrice").textContent = money(currentItem.price * totalQty);
    } else {
      $("#addToCartPrice").textContent = money(currentItem.price * currentQty);
    }
  }

  $("#itemSheetClose").onclick = () => ($("#itemSheetBackdrop").hidden = true);
  $("#itemSheetBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "itemSheetBackdrop") $("#itemSheetBackdrop").hidden = true;
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
    const note = $("#itemNote").value.trim();
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
          cart.push({ itemId: currentItem.id, item: currentItem, qty: mixQty[opt], option: opt, spice: currentSpiceOption, note });
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
        note,
      });
    }
    $("#itemSheetBackdrop").hidden = true;
    renderCartFab();
  };

  function cartTotal() {
    return cart.reduce((sum, c) => sum + c.item.price * c.qty, 0);
  }
  function cartCount() {
    return cart.reduce((sum, c) => sum + c.qty, 0);
  }

  function renderCartFab() {
    const fab = $("#cartFab");
    if (cart.length === 0) {
      fab.hidden = true;
      return;
    }
    fab.hidden = false;
    $("#cartCount").textContent = cartCount();
    $("#cartTotal").textContent = money(cartTotal());
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
      if (c.note) metaParts.push(c.note);
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
        <div class="cart-item-right">${money(c.item.price * c.qty)}</div>
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
    $("#cartTotalBig").textContent = money(cartTotal());
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

  $("#submitOrderBtn").onclick = async () => {
    if (cart.length === 0) return;
    const btn = $("#submitOrderBtn");

    // Belt-and-suspenders: party size is required before an order can go
    // through, even if something let the modal get skipped/dismissed.
    if (!partySize) {
      showPartySizeModal();
      return;
    }

    if (partySize && cartCount() < partySize) {
      showToast((PARTY_WARNING[lang] || PARTY_WARNING.zh)(partySize));
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
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableNumber,
          items: cart.map((c) => ({ itemId: c.itemId, qty: c.qty, option: c.option, spice: c.spice, note: c.note })),
          note: $("#orderNote").value.trim(),
          orderType,
          lat: coords ? coords.lat : undefined,
          lng: coords ? coords.lng : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.error === "out_of_range") throw new Error("out_of_range");
        if (body.error === "location_required") throw new Error("location_required");
        if (body.error === "party_size_required") throw new Error("party_size_required");
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
  async function openHistory() {
    $("#historyTableLabel").textContent = `${t("table")} ${tableNumber}`;
    const list = $("#historyList");
    list.innerHTML = `<div class="loading">…</div>`;
    $("#historyTotalBig").textContent = money(0);
    $("#historyBackdrop").hidden = false;
    try {
      const res = await fetch(`/api/orders/table/${encodeURIComponent(tableNumber)}`);
      const ordersForTable = await res.json();
      renderHistory(ordersForTable);
    } catch (e) {
      list.innerHTML = `<div class="history-empty">${t("networkErrorMsg")}</div>`;
    }
  }

  function renderHistory(ordersForTable) {
    const list = $("#historyList");
    list.innerHTML = "";
    let total = 0;
    let anyItem = false;
    ordersForTable.forEach((o) => {
      o.items.forEach((it) => {
        anyItem = true;
        total += it.unit_price * it.qty;
        const name = it[`name_${lang}`] || it.name_zh || it.name_en || it.name_ko || "";
        const row = document.createElement("div");
        row.className = "history-item";
        row.innerHTML = `
          <span class="history-item-name">${name}${it.option_choice ? ` (${it.option_choice})` : ""}<span class="history-item-qty">x${it.qty}</span></span>
          <span class="history-item-price">${money(it.unit_price * it.qty)}</span>
        `;
        list.appendChild(row);
      });
    });
    if (!anyItem) {
      list.innerHTML = `<div class="history-empty">${t("noOrdersYet")}</div>`;
    }
    $("#historyTotalBig").textContent = money(total);
    $("#payOnlineBtn").hidden = !(onlinePaymentEnabled && total > 0);
  }

  $("#payOnlineBtn").onclick = () => {
    if (!confirm(t("payOnlineConfirm"))) return;
    location.href = `/api/payment/checkout?table=${encodeURIComponent(tableNumber)}`;
  };

  // Order-type tabs (매장/포장)
  document.querySelectorAll(".order-type-tab[data-type]").forEach((b) => {
    b.onclick = () => {
      orderType = b.dataset.type;
      document.querySelectorAll(".order-type-tab[data-type]").forEach((btn) => btn.classList.toggle("active", btn === b));
    };
  });

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
  // has one registered. It only gets cleared once the table is actually
  // settled (admin's "전체 결제 완료" or a completed online payment — see
  // src/routes/tables.js's DELETE /party-size, called from those two
  // places), which is the real signal that this party is done and the
  // table is free for whoever scans it next.
  let partySizeStep = 1;
  function showPartySizeModal() {
    partySizeStep = 1;
    $("#partySizeVal").textContent = partySizeStep;
    $("#partySizeBackdrop").hidden = false;
  }
  async function initPartySize() {
    try {
      const res = await fetch(`/api/tables/${encodeURIComponent(tableNumber)}/party-size`);
      const data = await res.json();
      if (res.ok && data.party_size) {
        partySize = data.party_size;
        return; // already registered for this table's current party — don't ask again
      }
    } catch (e) {
      /* network error — fall through and ask, same as if none was registered */
    }
    showPartySizeModal();
  }
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
      await fetch(`/api/tables/${encodeURIComponent(tableNumber)}/party-size`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partySize: partySizeStep }),
      });
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
  initPartySize();
  checkPriorOrder();
})();
