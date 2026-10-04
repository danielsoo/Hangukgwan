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

  const storeOfSheet = (name) => (String(name).includes("總店") ? "main" : String(name).includes("台元") ? "branch3" : null);

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

  function query() {
    const p = new URLSearchParams();
    const store = $("#ingStore") && $("#ingStore").value;
    if (store && store !== "all") p.set("store", store);
    if ($("#ingStart") && $("#ingStart").value) p.set("start", $("#ingStart").value);
    if ($("#ingEnd") && $("#ingEnd").value) p.set("end", $("#ingEnd").value);
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
    const alias = Object.entries(m.vendor_aliases || {})
      .map(([from, to]) => fmt("ingVendorAliasFmt", { from, to }))
      .join(" ");
    $("#ingMeta").textContent = m.total
      ? `${fmt("ingMetaFmt", { lines: m.total, first: m.first, last: m.last })}${alias ? "  ·  " + alias : ""}`
      : T("ingMetaNone");
    return m;
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
      $("#ingReload").onclick = () => loadSummary();
      $("#ingAllPeriod").onclick = () => {
        $("#ingStart").value = "";
        $("#ingEnd").value = "";
        loadSummary();
      };
      $("#ingStore").onchange = () => loadSummary();
    }
    await loadMeta();
    await loadSummary();
  }

  window.HG_INGREDIENTS = { load, findColumns, storeOfSheet, HEAD };
})();
