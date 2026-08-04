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
    if (!$("#floorPlanWrap").hidden && !floorPlanDragging) renderFloorPlan();
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
      ? `<button class="primary-btn pay-all-btn" style="padding:6px 14px;font-size:12px;">전체 결제 완료</button>`
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
    const footer = tableOrders.length
      ? `
        <div style="display:flex;justify-content:space-between;align-items:center;border-top:2px solid var(--ink);margin-top:4px;padding-top:12px;">
          <p style="font-size:15px;margin:0;">미결제 합계: <strong>$${unpaidTotal}</strong></p>
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
          if (!confirm(`테이블 ${label || tableNumber}의 미결제 주문 ${unpaidOrders.length}건을 모두 결제 완료로 처리하시겠습니까?`)) return;
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
          let bestWDelta = SNAP + 1;
          let bestH = null;
          let bestHGuide = null;
          let bestHDelta = SNAP + 1;
          siblings.forEach((s) => {
            const dW = Math.abs(w - s.width);
            if (dW < bestWDelta) {
              bestWDelta = dW;
              bestW = s.width;
              bestWGuide = null;
            }
            [s.left, s.left + s.width / 2, s.left + s.width].forEach((tx) => {
              const d = Math.abs(myLeft + w - tx);
              if (d < bestWDelta) {
                bestWDelta = d;
                bestW = tx - myLeft;
                bestWGuide = { x: tx, sib: s };
              }
            });
            const dH = Math.abs(h - s.height);
            if (dH < bestHDelta) {
              bestHDelta = dH;
              bestH = s.height;
              bestHGuide = null;
            }
            [s.top, s.top + s.height / 2, s.top + s.height].forEach((ty) => {
              const d = Math.abs(myTop + h - ty);
              if (d < bestHDelta) {
                bestHDelta = d;
                bestH = ty - myTop;
                bestHGuide = { y: ty, sib: s };
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
            }
          }
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
    el.innerHTML = `
      <button class="table-unassign" title="구역에서 빼기">✕</button>
      <span>${t.label || t.number}</span>${t.party_size ? `<span class="tb-party">👥${t.party_size}</span>` : ""}
    `;
    container.appendChild(el);

    el.querySelector(".table-unassign").onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`테이블 ${t.label || t.number}을(를) 이 구역에서 뺄까요? (테이블 자체는 삭제되지 않습니다)`)) return;
      await fetch(`/api/tables/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoneId: null }),
      });
      t.zone_id = null;
      renderFloorPlan();
    };

    const getSnapSiblings = () =>
      [...container.querySelectorAll(".table-block")]
        .filter((sib) => sib !== el)
        .map((sib) => ({ left: sib.offsetLeft, top: sib.offsetTop, width: sib.offsetWidth, height: sib.offsetHeight }));

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
    $("#addTableToZoneTitle").textContent = `"${zone.name}"에 테이블 추가`;
    const grid = $("#addTableToZoneGrid");
    grid.innerHTML = "";
    if (unplaced.length === 0) {
      grid.innerHTML = `<div class="table-picker-empty">배치할 수 있는 테이블이 없습니다.<br/>위에서 새 테이블을 먼저 추가해주세요.</div>`;
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
      el.innerHTML = `
        <span class="zone-label">${z.name}</span>
        <button class="zone-add-btn" title="테이블 추가">+ 테이블</button>
        <button class="zone-del" title="구역 삭제">✕</button>
      `;
      wrap.appendChild(el);

      el.querySelector(".zone-label").onclick = async () => {
        const name = prompt("구역 이름", z.name);
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
        if (!confirm(`"${z.name}" 구역을 삭제하시겠습니까? (구역 안 테이블은 삭제되지 않고 배치만 풀립니다)`)) return;
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
      // A zone can never be shrunk smaller than the tables already sitting
      // inside it — the floor for the resize is whichever is bigger: the
      // fixed minimum, or the bounding box of its current tables.
      const tablesInThisZone = tables.filter((t) => t.zone_id === z.id);
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
      body: JSON.stringify({ name: `구역 ${zones.length + 1}`, x: 20, y: 20, width: 300, height: 240 }),
    });
    const zone = await res.json();
    zones.push(zone);
    renderFloorPlan();
  };

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
      const body = await res.json().catch(() => ({}));
      if (body.error === "unlucky_number") {
        alert("숫자 '4'가 들어간 테이블 번호는 사용할 수 없습니다 (대만에서 불길한 숫자로 여겨져 제외됩니다).");
      } else {
        alert("이미 존재하는 테이블 번호입니다");
      }
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
    $("#s_store_address_ko").value = s.store_address_ko || "";
    $("#s_store_address_en").value = s.store_address_en || "";
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
    if (s.store_logo) {
      $("#logoPreview").style.backgroundImage = `url('${s.store_logo}')`;
    }
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

  $("#logoPhotoInput").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("photo", file);
    const msg = $("#logoMsg");
    const res = await fetch("/api/settings/logo", { method: "POST", body: fd });
    if (res.ok) {
      const data = await res.json();
      $("#logoPreview").style.backgroundImage = `url('${data.store_logo}')`;
      msg.style.color = "#1a8a44";
      msg.textContent = "로고가 업데이트되었습니다";
    } else {
      msg.style.color = "#b5232c";
      msg.textContent = "업로드 실패. 다시 시도해주세요";
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
