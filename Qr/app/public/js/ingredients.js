// 식자재 탭 — 「무엇을 · 얼마에 · 몇 개 샀나」.
//
// 2026-10-04 사장님: "gitignore 추가하고 가져오기부터 해줘, 사장님만 보이게."
//
// 규칙은 서버(src/ingredients.js)에 있고 여기는 보여주기만 한다. 문구와 금액
// 서식은 admin.js 의 것을 빌려 쓴다(window.HG_ADMIN) — 두 벌이 되면 언젠가
// 어긋나고, i18n 빠짐을 재는 시험도 admin.js 만 읽는다.
(function () {
  "use strict";
  const $ = (sel) => document.querySelector(sel);
  const A = () => window.HG_ADMIN || {};
  const T = (k) => (A().T ? A().T(k) : k);
  const money = (v) => (A().money ? A().money(v) : String(v));
  const esc = (v) => (A().escapeHtml ? A().escapeHtml(v) : String(v == null ? "" : v));
  const fmt = (key, vals) =>
    Object.entries(vals).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), T(key));

  // 엑셀 머리글 → 우리가 쓰는 이름. 사장님 엑셀은 「내  용」처럼 가운데
  // 공백이 들어가 있어서 띄어쓰기를 지우고 맞춘다.
  const HEAD = {
    날짜: "date",
    내용: "name",
    품명: "name",
    수량: "qty",
    단위: "unit",
    단가: "price",
    금액: "amount",
    업체명: "vendor",
    업체: "vendor",
    비고: "note",
  };
  const tidy = (s) => String(s == null ? "" : s).replace(/\s+/g, "").trim();

  /**
   * 머리글 줄을 찾아 칸 자리를 정한다.
   *
   * 자리를 B·C·D… 로 못 박지 않는 이유: 사장님이 엑셀에 칸을 하나 끼워 넣으면
   * 그 뒤가 전부 밀린다. 그러면 **단가 자리에 금액이 들어가도 화면은 멀쩡해
   * 보인다** — 숫자가 다 숫자라서. 머리글을 보고 맞추면 그런 일이 없다.
   */
  function findColumns(rows) {
    for (let i = 0; i < Math.min(rows.length, 60); i++) {
      const map = {};
      let hits = 0;
      (rows[i] || []).forEach((cell, c) => {
        const key = HEAD[tidy(cell)];
        if (key && map[key] === undefined) {
          map[key] = c;
          hits++;
        }
      });
      if (hits >= 5 && map.date !== undefined && map.name !== undefined) return { row: i, map };
    }
    return null;
  }

  // 엑셀 시트 이름 → 지점.
  //
  // 사장님 엑셀이 두 벌이고 시트 이름이 서로 다르다:
  //   「… 2025부터」  韓國館總店 / 韓國館台元三店
  //   「… -2025」     한국관본점 / 한국관2호점
  // 2025년 줄이 두 파일에서 100% 일치해 **2호점 = 台元三店** 임을 확인했다.
  //
  // 서버의 같은 규칙(src/ingredients.js storeOfSheetName)과 **글자 하나까지
  // 맞춰 둔다** — 어긋나면 한쪽은 넣고 한쪽은 못 읽는 시트가 생긴다.
  // test/ingredients.test.js 가 둘이 같은 답을 내는지 잰다.
  const storeOfSheet = (name) => {
    const s = String(name == null ? "" : name).normalize("NFC").trim();
    if (!s) return null;
    if (s.includes("總店") || s.includes("본점")) return "main";
    if (s.includes("台元") || s.includes("2호점") || s.includes("２호점")) return "branch3";
    return null;
  };

  // ───────── 가져오기 ─────────

  function logLine(html) {
    const box = $("#ingImportLog");
    if (!box) return;
    box.hidden = false;
    box.innerHTML = html;
  }

  async function importFile(file) {
    if (!file) return;
    logLine(esc(T("ingImportReading")));
    let book;
    try {
      book = await window.HG_XLSX.readXlsx(await file.arrayBuffer());
    } catch (e) {
      logLine(esc(T("ingImportFailed") + (e && e.message)));
      return;
    }

    // 시트마다 머리글을 따로 찾는다 — 두 지점 시트의 칸 자리가 같다는 보장이 없다.
    const batches = [];
    let totalLines = 0;
    for (const sheet of book.sheets) {
      const store = storeOfSheet(sheet.name);
      if (!store) continue;
      const found = findColumns(sheet.rows);
      if (!found) continue;
      const { row: headRow, map } = found;
      const rows = [];
      for (let i = headRow + 1; i < sheet.rows.length; i++) {
        const r = sheet.rows[i] || [];
        const pick = (k) => (map[k] === undefined ? "" : r[map[k]] || "");
        // 날짜와 품목이 둘 다 있어야 한 줄이다. 나머지 판단은 서버가 한다
        // (src/ingredients.js normalizeRow) — 규칙을 두 군데 두지 않는다.
        if (!pick("date") || !String(pick("name")).trim()) continue;
        rows.push({
          date: pick("date"), name: pick("name"), qty: pick("qty"), unit: pick("unit"),
          price: pick("price"), amount: pick("amount"), vendor: pick("vendor"), note: pick("note"),
        });
      }
      if (rows.length) {
        batches.push({ store, rows });
        totalLines += rows.length;
      }
    }
    if (!totalLines) {
      logLine(esc(T("ingImportNoSheet")));
      return;
    }

    const ok = A().showConfirm
      ? await A().showConfirm(fmt("ingImportConfirmFmt", { file: file.name, lines: totalLines }))
      : true;
    if (!ok) {
      logLine("");
      $("#ingImportLog").hidden = true;
      return;
    }

    let done = 0;
    let inserted = 0;
    let skipped = 0;
    for (const b of batches) {
      // 한 날짜를 두 덩이로 쪼개지 않는다. 서버는 받은 날짜를 통째로 지우고
      // 다시 넣으므로, 쪼개 보내면 뒤 덩이가 앞 덩이를 지워버린다.
      const byDate = new Map();
      for (const r of b.rows) {
        const d = String(r.date);
        if (!byDate.has(d)) byDate.set(d, []);
        byDate.get(d).push(r);
      }
      let chunk = [];
      const send = async () => {
        if (!chunk.length) return;
        const res = await fetch("/api/ingredients/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ store: b.store, rows: chunk }),
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const got = await res.json();
        inserted += got.inserted || 0;
        skipped += got.skipped || 0;
        done += chunk.length;
        logLine(esc(fmt("ingImportSendingFmt", { done, total: totalLines })));
        chunk = [];
      };
      try {
        for (const [, rows] of byDate) {
          if (chunk.length + rows.length > 800) await send();
          chunk = chunk.concat(rows);
        }
        await send();
      } catch (e) {
        logLine(esc(T("ingImportFailed") + (e && e.message)));
        return;
      }
    }
    logLine(esc(fmt("ingImportDoneFmt", { inserted, skipped })));
    await load();
  }

  // ───────── 보여주기 ─────────

  function bars(el, items, opts) {
    const max = items.reduce((m, x) => Math.max(m, x.value), 0) || 1;
    el.innerHTML = items.length
      ? items
          .map(
            (x) => `
      <div class="ing-bar${opts && opts.clickable ? " clickable" : ""}"${opts && opts.clickable ? ` data-ing-item="${esc(x.key)}" role="button" tabindex="0"` : ""}>
        <div class="ing-bar-label">${esc(x.label)}</div>
        <div class="ing-bar-track"><div class="ing-bar-fill" style="width:${Math.max(1, Math.round((x.value / max) * 100))}%"></div></div>
        <div class="ing-bar-value">NT$${money(Math.round(x.value))}</div>
        <div class="ing-bar-sub">${esc(x.sub || "")}</div>
      </div>`
          )
          .join("")
      : `<p class="ing-note">${esc(T("ingEmpty"))}</p>`;
  }

  // 「전체 기간」을 누르셨나. 2007년부터 15만 줄이라 일부러 누를 때만 본다
  // (src/routes/ingredients.js rangeQuery).
  let wantAll = false;

  function query() {
    const p = new URLSearchParams();
    const store = $("#ingStore") && $("#ingStore").value;
    if (store && store !== "all") p.set("store", store);
    if ($("#ingStart") && $("#ingStart").value) p.set("start", $("#ingStart").value);
    if ($("#ingEnd") && $("#ingEnd").value) p.set("end", $("#ingEnd").value);
    if (wantAll && !($("#ingStart") || {}).value && !($("#ingEnd") || {}).value) p.set("all", "1");
    return p.toString();
  }

  async function loadSummary() {
    const res = await fetch(`/api/ingredients/summary?${query()}`);
    if (!res.ok) return;
    const s = await res.json();
    $("#ingTotal").textContent = `NT$${money(Math.round(s.total))}`;
    $("#ingTotalSub").textContent = fmt("ingLinesFmt", { n: s.lines });
    bars($("#ingMonths"), s.months.map((m) => ({ key: m.month, label: m.month, value: m.amount })));
    bars($("#ingVendors"), s.vendors.map((v) => ({ key: v.vendor, label: v.vendor, value: v.amount, sub: fmt("ingLinesFmt", { n: v.lines }) })));
    bars(
      $("#ingItems"),
      s.items.slice(0, 40).map((i) => ({
        key: i.name,
        // 중국어 이름 옆에 사장님이 적어 두신 한국어 이름을 같이 보인다 —
        // 엑셀 2만 줄에 100% 채워져 있어서 따로 만들 필요가 없었다.
        label: i.name_ko ? `${i.name}  ${i.name_ko}` : i.name,
        value: i.amount,
        sub: `${money(Math.round(i.qty))}${i.unit || ""}`,
      })),
      { clickable: true }
    );
    $("#ingItems").querySelectorAll("[data-ing-item]").forEach((el) => {
      const go = () => showPrices(el.dataset.ingItem);
      el.onclick = go;
      el.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      };
    });
  }

  /** 한 품목의 단가가 언제 얼마였나. 선 하나와 줄 목록. */
  async function showPrices(name) {
    const block = $("#ingPriceBlock");
    $("#ingPriceTitle").textContent = fmt("ingPriceTitleFmt", { name });
    block.hidden = false;
    const res = await fetch(`/api/ingredients/prices?name=${encodeURIComponent(name)}&${query()}`);
    const data = res.ok ? await res.json() : { points: [] };
    const pts = data.points || [];
    if (!pts.length) {
      $("#ingPriceChart").innerHTML = "";
      $("#ingPriceRows").innerHTML = `<p class="ing-note">${esc(T("ingPriceNone"))}</p>`;
      return;
    }
    const lo = Math.min(...pts.map((p) => p.price));
    const hi = Math.max(...pts.map((p) => p.price));
    const span = hi - lo || 1;
    const W = 720;
    const H = 140;
    const x = (i) => (pts.length === 1 ? W / 2 : (i / (pts.length - 1)) * (W - 20) + 10);
    const y = (p) => H - 14 - ((p - lo) / span) * (H - 34);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
    $("#ingPriceChart").innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">
        <path d="${line}" fill="none" stroke="var(--brand, #c0392b)" stroke-width="2" />
        ${pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.price).toFixed(1)}" r="2.5" fill="var(--brand, #c0392b)"><title>${esc(p.date)} NT$${p.price}</title></circle>`).join("")}
        <text x="4" y="12" font-size="11" fill="#888">NT$${money(hi)}</text>
        <text x="4" y="${H - 2}" font-size="11" fill="#888">NT$${money(lo)}</text>
      </svg>`;
    // 최근 것이 위로 — 「지금 얼마인가」가 제일 궁금하다.
    $("#ingPriceRows").innerHTML = pts
      .slice()
      .reverse()
      .slice(0, 40)
      .map(
        (p) => `<div class="ing-row">
          <span>${esc(p.date)}</span>
          <span>${esc(p.vendor)}</span>
          <span>${money(p.qty)}${esc(p.unit || "")}</span>
          <strong>NT$${money(p.price)}</strong>
        </div>`
      )
      .join("");
  }

  async function loadMeta() {
    const res = await fetch("/api/ingredients/meta");
    if (!res.ok) return null;
    const m = await res.json();
    const sel = $("#ingStore");
    if (sel && sel.options.length <= 1) {
      for (const s of m.stores || []) {
        const o = document.createElement("option");
        o.value = s.key;
        o.textContent = `${s.name_ko} (${s.name_zh})`;
        sel.appendChild(o);
      }
    }
    // 넣는 칸의 지점은 「전체」가 없다 — 영수증은 한 지점의 것이다.
    const esel = $("#ingEntryStore");
    if (esel && !esel.options.length) {
      for (const s of m.stores || []) {
        const o = document.createElement("option");
        o.value = s.key;
        o.textContent = s.name_ko;
        esel.appendChild(o);
      }
    }
    const alias = Object.entries(m.vendor_aliases || {})
      .map(([from, to]) => fmt("ingVendorAliasFmt", { from, to }))
      .join(" ");
    $("#ingMeta").textContent = m.total
      ? `${fmt("ingMetaFmt", { lines: m.total, first: m.first, last: m.last })}${alias ? "  ·  " + alias : ""}`
      : T("ingMetaNone");
    return m;
  }

  // ───────── 영수증 넣기 ─────────
  //
  // 2026-10-04 사장님: "지금은 계속 종이를 보면서 엑셀에 기입하고 하는 과정이
  // 너무 귀찮아서."
  //
  // 치는 것을 줄이는 길은 둘이다:
  //   · 품목은 **그 업체에서 보통 사는 것** 중에서 고른다(가운데 8가지)
  //   · 금액은 수량 × 단가로 **저절로** 나온다 (2만 줄에서 예외 0)
  //
  // 지난 단가는 먼저 채워 넣되 **옆에 「지난번 얼마」를 늘 보여준다.** 단가가
  // 지난번과 같은 비율이 84.3% 였다 — 여섯 번에 한 번은 바뀐다. 바뀐 것을
  // 못 보고 지나가면 여섯 장에 한 장이 틀린 금액이 된다(사장님 지적).
  //
  // 목록에 없는 품목은 **그냥 적으면 된다.** 이 목록은 울타리가 아니라
  // 지름길이다.
  let entryLines = [];
  let catalog = { vendor: "", items: [] };

  const blankLine = () => ({ name: "", name_ko: "", qty: "", unit: "", price: "", amount: "", amountEdited: false });
  const knownOf = (name) => catalog.items.find((i) => i.name === String(name || "").trim()) || null;

  function recalc(line) {
    const q = Number(line.qty);
    const p = Number(line.price);
    if (!line.amountEdited && Number.isFinite(q) && Number.isFinite(p) && line.qty !== "" && line.price !== "") {
      line.amount = Math.round(q * p * 100) / 100;
    }
  }

  function warnHtml(line) {
    const known = String(line.name || "").trim() ? knownOf(line.name) : undefined;
    const bits = [];
    const q = Number(line.qty) || 0;
    const p = Number(line.price) || 0;
    const a = Number(line.amount) || 0;
    if (q && p && a && Math.abs(q * p - a) >= 0.5) {
      bits.push(`<span class="ing-warn">${esc(fmt("ingWarnMathFmt", { expected: money(Math.round(q * p * 100) / 100) }))}</span>`);
    }
    if (known && known.last_price != null && p && p !== known.last_price) {
      bits.push(`<span class="ing-warn">${esc(fmt("ingWarnPriceFmt", { last: money(known.last_price) }))}</span>`);
    } else if (known && known.last_price != null) {
      bits.push(`<span class="ing-hint">${esc(fmt("ingLastPriceFmt", { price: money(known.last_price), date: known.last_date }))}</span>`);
    }
    if (known === null && String(line.name || "").trim()) {
      bits.push(`<span class="ing-new">${esc(T("ingWarnNewItem"))}</span>`);
    }
    return bits.join(" ");
  }

  function renderLines() {
    const box = $("#ingEntryLines");
    if (!box) return;
    box.innerHTML = `
      <div class="ing-line ing-line-head">
        <span>${esc(T("ingColItem"))}</span><span>${esc(T("ingColQty"))}</span><span>${esc(T("ingColUnit"))}</span>
        <span>${esc(T("ingColPrice"))}</span><span>${esc(T("ingColAmount"))}</span><span></span>
      </div>
      ${entryLines
        .map(
          (l, i) => `
        <div class="ing-line" data-i="${i}">
          <span><input list="ingItemList" class="ing-in-name" value="${esc(l.name)}" placeholder="${esc(T("ingItemPh"))}" /></span>
          <span><input type="number" step="any" class="ing-in-qty" value="${esc(l.qty)}" /></span>
          <span><input class="ing-in-unit" value="${esc(l.unit)}" /></span>
          <span><input type="number" step="any" class="ing-in-price" value="${esc(l.price)}" /></span>
          <span><input type="number" step="any" class="ing-in-amount" value="${esc(l.amount)}" /></span>
          <span><button type="button" class="ing-x" title="${esc(T("ingRemoveLine"))}">✕</button></span>
          <div class="ing-line-warn">${warnHtml(l)}</div>
        </div>`
        )
        .join("")}`;

    box.querySelectorAll(".ing-line[data-i]").forEach((el) => {
      const i = Number(el.dataset.i);
      const L = entryLines[i];
      const bind = (sel, key, after) => {
        const input = el.querySelector(sel);
        if (!input) return;
        input.oninput = () => {
          L[key] = input.value;
          if (after) after();
        };
        // 다 치고 칸을 떠날 때 다시 그린다 — 글자마다 다시 그리면 커서가 튄다.
        input.onchange = () => {
          L[key] = input.value;
          if (after) after();
          renderLines();
          updateTotal();
        };
      };
      bind(".ing-in-name", "name", () => {
        const k = knownOf(L.name);
        // 고른 품목의 지난 단위·단가를 **먼저 채워** 준다. 종이와 다르면
        // 사장님이 고치시고, 그때 옆에 「지난번 얼마」가 뜬다.
        if (k) {
          if (!L.unit) L.unit = k.unit || "";
          if (L.price === "") L.price = k.last_price;
          if (!L.name_ko) L.name_ko = k.name_ko || "";
          recalc(L);
        }
      });
      bind(".ing-in-qty", "qty", () => recalc(L));
      bind(".ing-in-price", "price", () => recalc(L));
      bind(".ing-in-unit", "unit");
      const amt = el.querySelector(".ing-in-amount");
      if (amt) {
        amt.oninput = () => {
          L.amount = amt.value;
          L.amountEdited = true;
        };
        amt.onchange = () => {
          L.amount = amt.value;
          L.amountEdited = true;
          renderLines();
          updateTotal();
        };
      }
      el.querySelector(".ing-x").onclick = () => {
        entryLines.splice(i, 1);
        if (!entryLines.length) entryLines.push(blankLine());
        renderLines();
        updateTotal();
      };
    });
    updateTotal();
  }

  function updateTotal() {
    const sum = entryLines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    if ($("#ingEntryTotal")) $("#ingEntryTotal").textContent = `NT$${money(Math.round(sum * 100) / 100)}`;
  }

  async function loadCatalog() {
    const vendor = ($("#ingEntryVendor").value || "").trim();
    const store = $("#ingEntryStore").value || "";
    if (!vendor) {
      catalog = { vendor: "", items: [] };
      $("#ingEntryHint").textContent = T("ingEntryPickVendor");
      $("#ingItemList").innerHTML = "";
      renderLines();
      return;
    }
    const res = await fetch(`/api/ingredients/catalog?vendor=${encodeURIComponent(vendor)}&store=${encodeURIComponent(store)}`);
    catalog = res.ok ? await res.json() : { vendor, items: [] };
    $("#ingEntryHint").textContent = fmt("ingEntryHintFmt", { vendor: catalog.vendor || vendor, n: catalog.items.length });
    // 최근·자주 산 순으로 담는다 — 목록 맨 위가 손이 먼저 가는 자리다.
    $("#ingItemList").innerHTML = catalog.items
      .map((i) => `<option value="${esc(i.name)}">${esc(i.name_ko ? `${i.name_ko} · ${i.unit || ""} · NT$${i.last_price}` : i.name)}</option>`)
      .join("");
    renderLines();
  }

  async function saveEntry() {
    const store = $("#ingEntryStore").value;
    const date = $("#ingEntryDate").value;
    const vendor = ($("#ingEntryVendor").value || "").trim();
    if (!vendor) return logLine(esc(T("ingEntryNeedVendor")));
    if (!date) return logLine(esc(T("ingEntryNeedDate")));
    const lines = entryLines.filter((l) => String(l.name || "").trim() && (l.qty !== "" || l.amount !== ""));
    if (!lines.length) return logLine(esc(T("ingEntryNeedLine")));

    // 같은 날 같은 업체 영수증이 이미 있으면 **덮기 전에 묻는다.**
    const had = await fetch(`/api/ingredients/rows?start=${date}&end=${date}&vendor=${encodeURIComponent(vendor)}&store=${encodeURIComponent(store)}&limit=200`)
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .catch(() => ({ rows: [] }));
    if ((had.rows || []).length) {
      const ok = A().showConfirm
        ? await A().showConfirm(fmt("ingEntryReplaceFmt", { date, vendor, n: had.rows.length }))
        : true;
      if (!ok) return;
    }

    try {
      const res = await fetch("/api/ingredients/rows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store, date, vendor, lines }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const got = await res.json();
      logLine(esc(fmt("ingEntrySavedFmt", { n: got.saved })));
      entryLines = [blankLine()];
      renderLines();
      await loadCatalog();
      await loadSummary();
      await loadMeta();
    } catch (e) {
      logLine(esc(T("ingEntrySaveFailed") + (e && e.message)));
    }
  }

  async function loadVendorList() {
    const res = await fetch(`/api/ingredients/catalog?store=${encodeURIComponent($("#ingEntryStore").value || "")}`);
    if (!res.ok) return;
    const { vendors } = await res.json();
    $("#ingVendorList").innerHTML = (vendors || []).map((v) => `<option value="${esc(v.vendor)}"></option>`).join("");
  }

  let wired = false;
  async function load() {
    if (!wired) {
      wired = true;
      $("#ingImportBtn").onclick = () => $("#ingImportFile").click();
      $("#ingImportFile").onchange = (e) => {
        const f = e.target.files && e.target.files[0];
        e.target.value = "";
        importFile(f);
      };
      $("#ingReload").onclick = () => {
        wantAll = false;
        loadSummary();
      };
      $("#ingAllPeriod").onclick = () => {
        $("#ingStart").value = "";
        $("#ingEnd").value = "";
        wantAll = true;
        loadSummary();
      };
      $("#ingStore").onchange = () => loadSummary();

      // 영수증 넣기
      entryLines = [blankLine()];
      $("#ingEntryAdd").onclick = () => {
        entryLines.push(blankLine());
        renderLines();
      };
      $("#ingEntrySave").onclick = () => saveEntry();
      $("#ingEntryClear").onclick = () => {
        entryLines = [blankLine()];
        renderLines();
      };
      $("#ingEntryVendor").onchange = () => loadCatalog();
      $("#ingEntryStore").onchange = () => {
        loadVendorList();
        loadCatalog();
      };
      // 오늘 날짜로 시작한다 — 거의 늘 오늘 받은 영수증이다.
      if (!$("#ingEntryDate").value) $("#ingEntryDate").value = new Date().toISOString().slice(0, 10);
      renderLines();
    }
    await loadMeta();
    await loadVendorList();
    await loadSummary();
  }

  window.HG_INGREDIENTS = { load, findColumns, storeOfSheet, HEAD, blankLine, warnHtml };
})();
