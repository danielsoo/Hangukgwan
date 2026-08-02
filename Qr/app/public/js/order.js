(function () {
  const tableNumber = decodeURIComponent(location.pathname.split("/t/")[1] || "").trim();
  let lang = localStorage.getItem("hgk_lang") || "zh";
  let categories = [];
  let cart = []; // { itemId, qty, option, note, item }
  let currentItem = null;
  let currentOption = null;
  let currentQty = 1;
  let activeOrderId = null;
  let searchTerm = "";
  const socket = io();

  const $ = (sel) => document.querySelector(sel);
  const t = (key) => (I18N[lang] && I18N[lang][key]) || I18N.zh[key] || key;
  const LANG_PILL_LABEL = { zh: "中文", ko: "한국어", en: "English" };

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
      b.classList.toggle("active", b.dataset.lang === lang);
    });
  }

  function money(n) {
    return `$${n}`;
  }

  async function loadSettings() {
    const res = await fetch("/api/settings");
    const s = await res.json();
    $("#storeName").textContent = s[`store_name_${lang}`] || s.store_name_zh || "韓國館";
    $("#storeInfoName").textContent = s[`store_name_${lang}`] || s.store_name_zh || "韓國館";
    $("#infoHours").textContent = s.store_hours || "-";
    $("#infoPhone").textContent = s.store_phone || "-";
    $("#infoAddress").textContent = s.store_address_zh || "-";
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

  $("#submitOrderBtn").onclick = async () => {
    if (cart.length === 0) return;
    const btn = $("#submitOrderBtn");
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
        }),
      });
      if (!res.ok) throw new Error("submit_failed");
      const order = await res.json();
      activeOrderId = order.id;
      saveOrderToHistory(order.id);
      cart = [];
      renderCartFab();
      $("#cartBackdrop").hidden = true;
      showConfirmation(order);
    } catch (e) {
      alert(t("submitFailed"));
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
  $("#backToMenuBtn").onclick = () => ($("#confirmBackdrop").hidden = true);

  socket.on("order_updated", (order) => {
    if (order.id === activeOrderId) renderStatusTrack(order.status);
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
  document.querySelectorAll(".lang-option").forEach((b) => {
    b.onclick = () => {
      lang = b.dataset.lang;
      localStorage.setItem("hgk_lang", lang);
      applyStaticI18n();
      loadSettings();
      renderTabs();
      renderMenu();
      renderCartFab();
      $("#langBackdrop").hidden = true;
    };
  });

  applyStaticI18n();
  loadSettings();
  loadMenu();
})();
