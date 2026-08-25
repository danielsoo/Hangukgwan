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
  let cart = []; // { itemId, qty, option, note, item }
  let currentItem = null;
  let currentOption = null;
  let currentQty = 1;
  let activeOrderId = null;
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
            <div class="item-price">${money(item.price)}${item.price_note ? `<span class="item-price-note">${item.price_note}</span>` : ""}</div>
            <div class="item-sub">${descFor(item) || [item.name_zh, item.name_ko, item.name_en].filter((n) => n && n !== nameFor(item)).join(" · ")}</div>
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
    currentQty = 1;
    currentOption = item.options ? item.options.split(",")[0].trim() : null;
    $("#itemPhoto").style.backgroundImage = item.photo_url ? `url('${item.photo_url}')` : "";
    $("#itemPhoto").textContent = item.photo_url ? "" : "";
    $("#itemName").textContent = nameFor(item);
    $("#itemSubNames").textContent = [item.name_zh, item.name_ko, item.name_en]
      .filter((n) => n && n !== nameFor(item))
      .join(" · ");
    $("#itemDesc").textContent = descFor(item);
    $("#itemNote").value = "";
    $("#qtyVal").textContent = "1";

    const optWrap = $("#itemOptions");
    const optList = $("#optionsList");
    optList.innerHTML = "";
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

    updateAddBtnPrice();
    $("#itemSheetBackdrop").hidden = false;
  }

  function updateAddBtnPrice() {
    if (!currentItem) return;
    $("#addToCartPrice").textContent = money(currentItem.price * currentQty);
  }

  $("#itemSheetClose").onclick = () => ($("#itemSheetBackdrop").hidden = true);
  $("#itemSheetBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "itemSheetBackdrop") $("#itemSheetBackdrop").hidden = true;
  });
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
    cart.push({
      itemId: currentItem.id,
      item: currentItem,
      qty: currentQty,
      option: currentOption,
      note: $("#itemNote").value.trim(),
    });
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
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableNumber,
          items: cart.map((c) => ({ itemId: c.itemId, qty: c.qty, option: c.option, note: c.note })),
          note: $("#orderNote").value.trim(),
          lat: coords ? coords.lat : undefined,
          lng: coords ? coords.lng : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.error === "out_of_range") throw new Error("out_of_range");
        if (body.error === "location_required") throw new Error("location_required");
        if (body.error === "party_size_required") throw new Error("party_size_required");
        throw new Error("submit_failed");
      }
      const order = await res.json();
      activeOrderId = order.id;
      saveOrderToHistory(order.id);
      cart = [];
      renderCartFab();
      $("#cartBackdrop").hidden = true;
      showConfirmation(order);
    } catch (e) {
      if (e.message === "out_of_range") alert(t("locationOutOfRangeMsg"));
      else if (e.message === "location_required") alert(t("locationRequiredMsg"));
      else if (e.message === "party_size_required") showPartySizeModal();
      else alert(t("submitFailed"));
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
})();
