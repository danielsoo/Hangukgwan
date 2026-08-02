(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  let categories = [];
  let orders = [];
  let tables = [];
  let editingItemId = null;
  let editingItemPhotoUrl = null;
  let selectedPhotoFile = null;
  let soundOn = true;
  let pollTimer = null;
  let knownOrderIds = new Set();
  let openTableNumber = null;

  // ---------- Auth ----------
  async function checkAuth() {
    const res = await fetch("/api/auth/me");
    const data = await res.json();
    if (data.isAdmin) showDashboard();
    else showLogin();
  }

  function showLogin() {
    $("#loginScreen").hidden = false;
    $("#dashboard").hidden = true;
  }

  async function showDashboard() {
    $("#loginScreen").hidden = true;
    $("#dashboard").hidden = false;
    await Promise.all([loadOrders(), loadMenu(), loadTables(), loadSettings()]);
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
      showDashboard();
    } else {
      $("#loginError").textContent = "비밀번호가 올바르지 않습니다. 다시 시도해주세요";
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
      $$(".admin-tabs button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      $$(".tab-panel").forEach((p) => (p.hidden = true));
      $(`#tab-${btn.dataset.tab}`).hidden = false;
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
    if (openTableNumber) openTableDetail(openTableNumber);

    if (!isFirstLoad && newlyArrived.length > 0) {
      newlyArrived.forEach((o) => flashNewOrder(o.id));
      if (soundOn) playBeep();
    }
  }

  const STATUS_LABEL = { new: "신규 주문", preparing: "조리 중", served: "서빙 완료", paid: "결제 완료", cancelled: "취소됨" };
  const NEXT_STATUS = { new: "preparing", preparing: "served", served: "paid" };
  const NEXT_LABEL = { new: "조리 시작", preparing: "서빙 완료로 변경", served: "결제 완료로 변경" };

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
      .map((it) => `${it.name_ko || it.name_zh} x${it.qty}${it.option_choice ? `(${it.option_choice})` : ""}`)
      .join("<br/>");
    card.innerHTML = `
      <div class="order-card-top"><span>테이블 ${o.table_number}</span><span class="order-card-time">${time}</span></div>
      <div class="order-card-items">${itemsHtml}</div>
      <div class="order-card-total">$${o.total}</div>
      <div class="order-card-actions" id="actions-${o.id}"></div>
    `;
    const actions = card.querySelector(`#actions-${o.id}`);
    if (NEXT_STATUS[o.status]) {
      const btn = document.createElement("button");
      btn.className = "primary";
      btn.textContent = NEXT_LABEL[o.status];
      btn.onclick = (e) => {
        e.stopPropagation();
        updateOrderStatus(o.id, NEXT_STATUS[o.status]);
      };
      actions.appendChild(btn);
    }
    if (o.status !== "cancelled" && o.status !== "paid") {
      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = "취소";
      cancelBtn.onclick = (e) => {
        e.stopPropagation();
        if (confirm("이 주문을 취소하시겠습니까?")) updateOrderStatus(o.id, "cancelled");
      };
      actions.appendChild(cancelBtn);
    }
    card.onclick = () => openOrderDetail(o);
    return card;
  }

  function flashNewOrder(id) {
    setTimeout(() => {
      const el = document.querySelector(`.order-card[data-order-id="${id}"]`);
      if (el) el.classList.add("flash");
    }, 50);
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
            <span>${it.name_ko || it.name_zh} ${it.option_choice ? `(${it.option_choice})` : ""} x${it.qty}${it.note ? `<br/><small style="color:#999;">메모: ${it.note}</small>` : ""}</span>
            <span>$${it.unit_price * it.qty}</span>
          </div>`
      )
      .join("");
    $("#orderDetailBody").innerHTML = `
      <h2>테이블 ${o.table_number}</h2>
      <p style="color:#999;font-size:13px;">${time} · 상태: ${STATUS_LABEL[o.status]}</p>
      ${itemsHtml}
      ${o.note ? `<p style="margin-top:10px;"><strong>메모:</strong>${o.note}</p>` : ""}
      <div style="text-align:right;font-weight:800;font-size:18px;margin-top:10px;">합계 $${o.total}</div>
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
      block.innerHTML = `<h3>${c.name_ko || c.name_zh}</h3>`;
      const table = document.createElement("table");
      table.className = "item-table";
      table.innerHTML = `
        <thead><tr><th></th><th>코드</th><th>이름</th><th>가격</th><th>상태</th></tr></thead>
        <tbody></tbody>
      `;
      const tbody = table.querySelector("tbody");
      c.items.forEach((item) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${item.photo_url ? `<span class="item-row-photo" style="background-image:url('${item.photo_url}')"></span>` : `<span class="photo-missing-badge" title="사진을 추가해주세요">사진<br>없음</span>`}</td>
          <td>${item.code || ""}</td>
          <td>${item.name_ko || item.name_zh}</td>
          <td>$${item.price}</td>
          <td><span class="availability-pill ${item.available ? "on" : "off"}">${item.available ? "판매 중" : "품절"}</span></td>
        `;
        tr.onclick = () => openItemModal(item);
        tbody.appendChild(tr);
      });
      block.appendChild(table);
      wrap.appendChild(block);
    });
  }

  function populateCategorySelect() {
    const sel = $("#f_category_id");
    sel.innerHTML = categories.map((c) => `<option value="${c.id}">${c.name_ko || c.name_zh}</option>`).join("");
  }

  $("#addItemBtn").onclick = () => openItemModal(null);

  function openItemModal(item) {
    editingItemId = item ? item.id : null;
    editingItemPhotoUrl = item ? item.photo_url : null;
    selectedPhotoFile = null;
    $("#itemModalTitle").textContent = item ? "메뉴 수정" : "메뉴 추가";
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
      alert("메뉴 이름을 입력하세요");
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
    if (!confirm("이 메뉴를 삭제하시겠습니까? 되돌릴 수 없습니다.")) return;
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
      .sort((a, b) => new Date(b.created_at.replace(" ", "T")) - new Date(a.created_at.replace(" ", "T")));
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
        ? `<div class="table-order-badge active">주문 ${unpaid.length}건 · $${unpaid.reduce((s, o) => s + o.total, 0)}</div>`
        : `<div class="table-order-badge empty">비어있음</div>`;
      const partyBadge = t.party_size ? `<div class="table-party-badge">👥 ${t.party_size}인</div>` : "";
      chip.innerHTML = `<button class="del-btn" title="삭제">✕</button><div class="num">${t.label || t.number}</div>${partyBadge}${badge}`;
      chip.querySelector(".del-btn").onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`테이블 ${t.number}을(를) 삭제하시겠습니까?`)) return;
        await fetch(`/api/tables/${t.id}`, { method: "DELETE" });
        loadTables();
      };
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
    const partyText = table && table.party_size ? ` · 👥 ${table.party_size}인` : "";
    const payAllBtn = unpaidOrders.length
      ? `<button class="primary-btn" id="payAllBtn" style="padding:6px 14px;font-size:12px;">전체 결제 완료</button>`
      : "";
    const header = `
      <h2>테이블 ${label || tableNumber}${partyText}</h2>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:-6px;">
        <p style="color:var(--muted);font-size:13px;margin:0;">현재 미결제 합계: <strong>$${unpaidTotal}</strong></p>
        ${payAllBtn}
      </div>
    `;
    const body = tableOrders.length
      ? tableOrders.map((o) => renderTableOrderBlock(o)).join("")
      : `<p style="color:var(--muted);padding:20px 0;text-align:center;">아직 주문이 없습니다.</p>`;
    $("#tableDetailBody").innerHTML = header + body;
    $("#tableDetailBody")
      .querySelectorAll("[data-advance-id]")
      .forEach((btn) => {
        btn.onclick = async () => {
          await updateOrderStatus(parseInt(btn.dataset.advanceId, 10), btn.dataset.advanceTo);
          await loadOrders();
          openTableDetail(tableNumber, label);
        };
      });
    const payAll = $("#payAllBtn");
    if (payAll) {
      payAll.onclick = async () => {
        if (!confirm(`테이블 ${label || tableNumber}의 미결제 주문 ${unpaidOrders.length}건을 모두 결제 완료로 처리하시겠습니까?`)) return;
        await Promise.all(unpaidOrders.map((o) => updateOrderStatus(o.id, "paid")));
        await loadOrders();
        openTableDetail(tableNumber, label);
      };
    }
    $("#tableDetailBackdrop").hidden = false;
  }

  function renderTableOrderBlock(o) {
    const time = new Date(o.created_at.replace(" ", "T")).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    const itemsHtml = o.items
      .map(
        (it) =>
          `<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;">
            <span>${it.name_ko || it.name_zh}${it.option_choice ? ` (${it.option_choice})` : ""} x${it.qty}${it.note ? `<br/><small style="color:var(--muted);">메모: ${it.note}</small>` : ""}</span>
            <span>$${it.unit_price * it.qty}</span>
          </div>`
      )
      .join("");
    const nextBtn = NEXT_STATUS[o.status]
      ? `<button class="primary-btn" style="padding:6px 12px;font-size:12px;" data-advance-id="${o.id}" data-advance-to="${NEXT_STATUS[o.status]}">${NEXT_LABEL[o.status]}</button>`
      : "";
    return `
      <div style="border-top:1px solid var(--line);padding:12px 0;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-weight:700;font-size:13px;">${time} · ${STATUS_LABEL[o.status]}</span>
          ${nextBtn}
        </div>
        ${itemsHtml}
        ${o.note ? `<p style="font-size:12px;color:var(--muted);margin:6px 0 0;">주문 메모: ${o.note}</p>` : ""}
        <div style="text-align:right;font-weight:700;font-size:13px;margin-top:4px;">소계 $${o.total}</div>
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

  $("#addTableBtn").onclick = async () => {
    const number = $("#newTableNumber").value.trim();
    const label = $("#newTableLabel").value.trim();
    if (!number) return alert("테이블 번호를 입력하세요");
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
      alert("이미 존재하는 테이블 번호입니다");
    }
  };

  // ---------- Settings ----------
  let currentStoreLat = "";
  let currentStoreLng = "";

  function renderLocationStatus() {
    const text = $("#locationStatusText");
    if (currentStoreLat && currentStoreLng) {
      text.textContent = `매장 위치 설정됨 (${parseFloat(currentStoreLat).toFixed(5)}, ${parseFloat(currentStoreLng).toFixed(5)}) — 이 반경 밖에서는 주문이 차단됩니다.`;
    } else {
      text.textContent = "아직 매장 위치가 설정되지 않았습니다 (위치 제한 꺼짐)";
    }
  }

  async function loadSettings() {
    const res = await fetch("/api/settings");
    const s = await res.json();
    $("#s_store_name_zh").value = s.store_name_zh || "";
    $("#s_store_name_ko").value = s.store_name_ko || "";
    $("#s_store_name_en").value = s.store_name_en || "";
    $("#s_store_phone").value = s.store_phone || "";
    $("#s_store_address_zh").value = s.store_address_zh || "";
    $("#s_store_hours").value = s.store_hours || "";
    $("#s_store_min_spend").value = s.store_min_spend || "";
    $("#s_store_notice").value = s.store_notice || "";
    $("#s_order_radius_m").value = s.order_radius_m || "200";
    currentStoreLat = s.store_lat || "";
    currentStoreLng = s.store_lng || "";
    renderLocationStatus();
    if (s.store_cover_photo) {
      $("#coverPreview").style.backgroundImage = `url('${s.store_cover_photo}')`;
    }
  }

  $("#saveSettingsBtn").onclick = async () => {
    const payload = {
      store_name_zh: $("#s_store_name_zh").value.trim(),
      store_name_ko: $("#s_store_name_ko").value.trim(),
      store_name_en: $("#s_store_name_en").value.trim(),
      store_phone: $("#s_store_phone").value.trim(),
      store_address_zh: $("#s_store_address_zh").value.trim(),
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
      msg.textContent = "이 브라우저는 위치 정보를 지원하지 않습니다.";
      msg.hidden = false;
      return;
    }
    msg.style.color = "#6b6357";
    msg.textContent = "위치 확인 중…";
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
        msg.textContent = "매장 위치가 저장되었습니다.";
        setTimeout(() => (msg.hidden = true), 3000);
      },
      (err) => {
        msg.style.color = "#b3261e";
        msg.textContent = "위치 확인 실패: 브라우저 위치 권한을 허용해주세요.";
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
    msg.textContent = "저장되었습니다";
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
      $("#coverPreview").style.backgroundImage = `url('${data.store_cover_photo}')`;
      msg.style.color = "#1a8a44";
      msg.textContent = "사진이 업데이트되었습니다";
    } else {
      msg.style.color = "#b5232c";
      msg.textContent = "업로드 실패. 다시 시도해주세요";
    }
    msg.hidden = false;
    setTimeout(() => (msg.hidden = true), 2000);
  };

  $("#changePwBtn").onclick = async () => {
    const currentPassword = $("#pw_current").value;
    const newPassword = $("#pw_new").value;
    const msg = $("#pwMsg");
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (res.ok) {
      msg.style.color = "#1a8a44";
      msg.textContent = "비밀번호가 변경되었습니다";
      $("#pw_current").value = "";
      $("#pw_new").value = "";
    } else {
      msg.style.color = "#b5232c";
      msg.textContent = "변경 실패. 현재 비밀번호가 맞는지 확인하세요 (새 비밀번호는 6자 이상)";
    }
    msg.hidden = false;
  };

  checkAuth();
})();
