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

  // 지점 이름(「본점」·「2호점」). /meta 가 주는 것을 담아 두고 한눈에 보기가 쓴다.
  const storeNames = {};
  const storeName = (k) => storeNames[k] || k;

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

  /**
   * 화면 아래 한 줄. `{ add: true }` 면 **덧붙인다.**
   *
   * 2026-10-05: 사진을 읽을 때 할 말이 여럿인데(몇 줄 채웠다 · 머리에서 업체를
   * 읽었다 · 표를 못 찾은 사진이 있다) 이 칸이 통째로 갈아끼우고 있었다 —
   * **마지막 한 줄만 보였다.** 「못 읽었다」가 조용히 지워지는 자리였다.
   */
  function logLine(html, opts) {
    const box = $("#ingImportLog");
    if (!box) return;
    if (html === "") { box.innerHTML = ""; box.hidden = true; return; }
    const add = opts && opts.add && box.innerHTML;
    box.hidden = false;
    box.innerHTML = add ? `${box.innerHTML}<br>${html}` : html;
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
      // 15만 줄이면 덩이가 200개 가까이 된다. 그중 하나가 네트워크 때문에
      // 한 번 실패했다고 3분짜리 작업을 처음부터 다시 하게 하지 않는다.
      //
      // 다시 보내도 안전하다 — 서버가 **그 날짜를 통째로 갈아끼우기** 때문에
      // 같은 덩이를 두 번 보내도 줄이 두 배가 되지 않는다.
      const send = async () => {
        if (!chunk.length) return;
        let lastErr = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
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
            return;
          } catch (e) {
            lastErr = e;
            // 잠깐 쉬고 다시. 서버가 숨 돌릴 틈을 준다.
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          }
        }
        throw lastErr || new Error("send_failed");
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

  // 「한눈에 보기」에서 고른 업체. 비어 있으면 전체.
  let onlyVendor = "";

  /** 큰 숫자 옆 네 칸. 결산·급여와 같은 모양(`stl-hero-side`). */
  function heroStats(s) {
    const perDay = s.days ? s.total / s.days : 0;
    const cells = [
      { label: T("ingStatDays"), value: money(s.days || 0) },
      { label: T("ingStatPerDay"), value: `NT$${money(Math.round(perDay))}` },
      { label: T("ingStatVendors"), value: money(s.vendors.length) },
      { label: T("ingStatItems"), value: money(s.items.length) },
    ];
    // 결산·급여와 **같은 칸 모양**을 쓴다(.stl-stat). 제 모양을 따로 만들면
    // 글자 크기와 줄 간격이 조금씩 어긋난다.
    $("#ingHeroStats").innerHTML = cells
      .map((c) => `<div class="stl-stat"><span class="stl-stat-label">${esc(c.label)}</span><span class="stl-stat-value">${esc(c.value)}</span></div>`)
      .join("");
  }

  /** 달마다 — 결산과 같은 막대 그래프. Chart.js 가 없으면 글자 막대로 내려간다. */
  let monthsChart = null;
  function renderMonths(s) {
    const canvas = $("#ingMonthsChart");
    if (!canvas || typeof Chart === "undefined") return;
    // 탭이 숨어 있을 때 그리면 높이가 0 이라 안 보인다 — 보일 때만 그린다.
    if (!canvas.offsetParent) return;
    if (monthsChart) monthsChart.destroy();
    monthsChart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: s.months.map((m) => m.month),
        datasets: [{ label: T("ingMonthsTitle"), data: s.months.map((m) => m.amount), backgroundColor: "#16213e", borderRadius: 4, maxBarThickness: 48 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `NT$${money(Math.round(c.parsed.y))}` } } },
        scales: { y: { beginAtZero: true, ticks: { callback: (v) => `NT$${money(v)}` } } },
      },
    });
  }

  /**
   * 업체별 한눈에 — 줄마다 지출·몫·마지막 매입일, 맨 밑에 합계.
   *
   * 줄을 누르면 **그 업체만** 본다(다시 누르면 전체). 업체가 스물이라
   * 막대만으로는 「이 업체가 뭘 얼마에 사는가」까지 못 본다.
   */
  function renderVendorTable(s) {
    const el = $("#ingVendorTable");
    if (!el) return;
    const head = [T("ingColVendor"), T("ingColLines"), T("ingColAmount"), T("ingColShare"), T("ingColLast")]
      .map((h) => `<th>${esc(h)}</th>`).join("");
    const body = s.vendors
      .map((v) => {
        const share = s.total ? Math.round((v.amount / s.total) * 1000) / 10 : 0;
        const on = onlyVendor === v.vendor;
        return `<tr data-ing-vendor="${esc(v.vendor)}" class="${on ? "is-on" : ""}" role="button" tabindex="0">
          <td>${esc(v.vendor)}</td>
          <td>${money(v.lines)}</td>
          <td class="is-total">NT$${money(Math.round(v.amount))}</td>
          <td>${share}%</td>
          <td>${esc(v.last_date || "")}</td>
        </tr>`;
      })
      .join("");
    const foot = s.vendors.length
      ? `<tfoot><tr><td>${esc(T("ingColTotal"))}</td><td>${money(s.lines)}</td>
         <td class="is-total">NT$${money(Math.round(s.total))}</td><td>100%</td><td>${esc(s.last || "")}</td></tr></tfoot>`
      : "";
    el.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}`;
    el.querySelectorAll("[data-ing-vendor]").forEach((tr) => {
      const go = () => {
        onlyVendor = onlyVendor === tr.dataset.ingVendor ? "" : tr.dataset.ingVendor;
        loadSummary();
      };
      tr.onclick = go;
      tr.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
    });
  }

  /**
   * 업체 칩 줄 — 「전체」와 업체들. 급여 탭의 사람 칩 줄과 같은 자리다.
   *
   * 2026-10-06 사장님: "어떤 업체에서 어떤 종류를 우리가 언제 샀고 이런
   * 것들? 업체별로 나눠서 볼 수도 있게 해줬으면 좋겠고"
   *
   * 한 업체를 고르면 집계가 그 업체만으로 바뀌므로, 칩 줄에 쓸 **전체 업체
   * 목록은 안 고른 상태에서 받아 둔 것**을 쓴다 — 그러지 않으면 고르는 순간
   * 다른 업체 칩이 사라져서 돌아올 길이 없어진다.
   */
  let allVendors = [];
  function renderVendorChips() {
    const el = $("#ingVendorChips");
    if (!el) return;
    const chips = [{ key: "", label: T("ingAllVendors") }].concat(
      allVendors.map((v) => ({ key: v.vendor, label: v.vendor }))
    );
    el.innerHTML = chips
      .map((c) => `<button type="button" class="ing-chip${onlyVendor === c.key ? " is-on" : ""}" data-ing-chip="${esc(c.key)}">${esc(c.label)}</button>`)
      .join("");
    el.querySelectorAll("[data-ing-chip]").forEach((b) => {
      b.onclick = () => { onlyVendor = b.dataset.ingChip; loadSummary(); };
    });
  }

  /**
   * 그 업체에서 **뭘 언제 샀나** — 날짜·품명·수량·단가·금액.
   *
   * 업체를 골랐을 때만 띄운다. 전체로 보면 15만 줄이라 화면이 멎는다.
   */
  async function loadRows() {
    const card = $("#ingRowsCard");
    if (!card) return;
    if (!onlyVendor) { card.hidden = true; return; }
    card.hidden = false;
    $("#ingRowsTitle").textContent = fmt("ingRowsTitleFmt", { vendor: onlyVendor });
    const res = await fetch(`/api/ingredients/rows?${query()}&vendor=${encodeURIComponent(onlyVendor)}&limit=300`);
    const data = res.ok ? await res.json() : { rows: [] };
    const rows = data.rows || [];
    $("#ingRowsNote").textContent = rows.length
      ? (data.truncated ? fmt("ingRowsTruncFmt", { n: rows.length }) : fmt("ingRowsCountFmt", { n: rows.length }))
      : T("ingEmpty");
    const head = [T("ingColDate"), T("ingColName"), T("ingColQty"), T("ingColPrice"), T("ingColAmount"), T("ingColStore")]
      .map((h) => `<th>${esc(h)}</th>`).join("");
    const body = rows
      .map((r) => `<tr>
        <td>${esc(r.date)}</td>
        <td class="is-name">${esc(r.name_ko ? `${r.name}  ${r.name_ko}` : r.name)}</td>
        <td>${money(r.qty)}${esc(r.unit || "")}</td>
        <td>${r.price ? `NT$${money(r.price)}` : ""}</td>
        <td class="is-total">NT$${money(Math.round(r.amount || 0))}</td>
        <td>${esc(storeName(r.store))}</td>
      </tr>`)
      .join("");
    $("#ingRowsTable").innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
  }

  async function loadSummary() {
    const q = query() + (onlyVendor ? `&vendor=${encodeURIComponent(onlyVendor)}` : "");
    const res = await fetch(`/api/ingredients/summary?${q}`);
    if (!res.ok) return;
    const s = await res.json();
    $("#ingTotal").textContent = `NT$${money(Math.round(s.total))}`;
    $("#ingTotalSub").textContent = s.first
      ? `${fmt("ingLinesFmt", { n: s.lines })} · ${s.first} ~ ${s.last}`
      : fmt("ingLinesFmt", { n: s.lines });
    heroStats(s);
    renderMonths(s);
    // 지점별은 「전체」로 보실 때만 뜻이 있다
    const sc = $("#ingStoresCard");
    if (sc) {
      const many = (s.stores || []).length > 1;
      sc.hidden = !many;
      if (many) bars($("#ingStores"), s.stores.map((x) => ({ key: x.store, label: storeName(x.store), value: x.amount, sub: fmt("ingLinesFmt", { n: x.lines }) })));
    }
    // 전체로 볼 때의 업체 목록을 담아 둔다 — 칩 줄이 이걸 쓴다
    if (!onlyVendor) allVendors = s.vendors;
    renderVendorChips();
    renderVendorTable(s);
    loadRows();
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
    for (const st of m.stores || []) storeNames[st.key] = st.name_ko || st.key;
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

  // ───────── 엑셀로 다시 받기 ─────────
  //
  // 2026-10-05 사장님: "인식해서 **엑셀에 기입하고** 우리 시스템에도 기입해서."
  //
  // 시스템에 쌓는 것만으로는 18년 써 오신 엑셀이 멈춘다. 같은 모양으로
  // 언제든 다시 받을 수 있어야 세무·거래처에 보내는 일이 안 끊긴다.
  //
  // 칸 차례는 **사장님 파일 그대로**다 — 받아서 열었을 때 쓰던 것과 같아야
  // 한다. 날짜는 글자("2026-10-05")로 적는다. 엑셀 일련번호로 적으면 서식을
  // 같이 넣어야 하고, 서식이 빠지면 「45658」로 보인다.
  const EXPORT_HEAD = ["날짜", "내  용", "수량", "단위", "단가", "금액", "업체명", "비  고", "월"];

  async function exportXlsx() {
    if (!window.HG_XLSX_WRITE) return logLine(esc(T("ingExportNoSupport")));
    logLine(esc(T("ingExportWorking")));
    let data;
    try {
      const res = await fetch(`/api/ingredients/export?${query()}`);
      if (!res.ok) throw new Error(`${res.status}`);
      data = await res.json();
    } catch (e) {
      return logLine(esc(T("ingExportFailed") + (e && e.message)));
    }
    const rows = data.rows || [];
    if (!rows.length) return logLine(esc(T("ingExportEmpty")));

    const sheets = (data.stores || []).map((s) => ({
      name: s.name_zh || s.name_ko,
      rows: [EXPORT_HEAD].concat(
        rows
          .filter((r) => r.store === s.key)
          .map((r) => [r.date, r.name, r.qty, r.unit, r.price, r.amount, r.vendor, r.name_ko, Number(String(r.month).slice(5, 7))])
      ),
    }));
    try {
      const bytes = await window.HG_XLSX_WRITE.writeXlsx(sheets);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      const first = rows[0].date;
      const last = rows[rows.length - 1].date;
      a.download = `한국관 식자재 ${first} ~ ${last}.xlsx`;
      a.click();
      // 바로 거두면 큰 파일에서 내려받기가 끊긴다.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      logLine(esc(fmt("ingExportDoneFmt", { n: rows.length })));
    } catch (e) {
      logLine(esc(T("ingExportFailed") + (e && e.message)));
    }
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

  const blankLine = () => ({ name: "", name_ko: "", qty: "", unit: "", price: "", amount: "", amountEdited: false, pic: null, unsure: false });
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

  /**
   * 그 칸을 종이에서 잘라낸 그림. **숫자 바로 밑에** 붙인다.
   *
   * 숫자 하나를 88% 로 읽으니 세 자리 금액은 68% 다. 그림이 옆에 있으면
   * 사장님이 종이를 다시 찾지 않고 눈으로 맞춰 보실 수 있다 — 하실 일이
   * 「치기」에서 「보기」로 바뀐다. 「틀린 값을 표시 없이 넣지 않는다」.
   */
  function pic(line, key) {
    const src = line.pic && line.pic[key];
    if (!src) return "";
    return `<img class="ing-pic" src="${esc(src)}" alt="" />`;
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
        <div class="ing-line${l.unsure ? " ing-line-unsure" : ""}" data-i="${i}">
          <span><input list="ingItemList" class="ing-in-name" value="${esc(l.name)}" placeholder="${esc(T("ingItemPh"))}" />${pic(l, "name")}</span>
          <span><input type="number" step="any" class="ing-in-qty" value="${esc(l.qty)}" />${pic(l, "qty")}</span>
          <span><input class="ing-in-unit" value="${esc(l.unit)}" /></span>
          <span><input type="number" step="any" class="ing-in-price" value="${esc(l.price)}" />${pic(l, "price")}</span>
          <span><input type="number" step="any" class="ing-in-amount" value="${esc(l.amount)}" />${pic(l, "amount")}</span>
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
      if ($("#ingItemList")) $("#ingItemList").innerHTML = "";
      renderLines();
      return;
    }
    const res = await fetch(`/api/ingredients/catalog?vendor=${encodeURIComponent(vendor)}&store=${encodeURIComponent(store)}`);
    catalog = res.ok ? await res.json() : { vendor, items: [] };
    $("#ingEntryHint").textContent = fmt("ingEntryHintFmt", { vendor: catalog.vendor || vendor, n: catalog.items.length });
    // 최근·자주 산 순으로 담는다 — 목록 맨 위가 손이 먼저 가는 자리다.
    if (!$("#ingItemList")) return;
    $("#ingItemList").innerHTML = catalog.items
      .map((i) => `<option value="${esc(i.name)}">${esc(i.name_ko ? `${i.name_ko} · ${i.unit || ""} · NT$${i.last_price}` : i.name)}</option>`)
      .join("");
    renderLines();
  }

  // 저장하는 동안 단추를 잠근다.
  //
  // 2026-10-06: 화면이 다시 그려지는 사이에 단추가 두 번 눌리는 일이 실제로
  // 났다(시험에서 잡혔다). 두 번째가 들어가면 「이미 2줄 있어요. 바꿀까요?」가
  // 뜨는데, 방금 자기가 넣은 것이라 **사장님은 영문을 모른다.**
  let saving = false;
  async function saveEntry() {
    if (saving) return;
    saving = true;
    const saveBtn = $("#ingEntrySave");
    if (saveBtn) saveBtn.disabled = true;
    try {
      await saveEntryInner();
    } finally {
      saving = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async function saveEntryInner() {
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
        // 대기함에서 온 것이면 그 줄도 마무리된다(서버가 사진을 지운다)
        body: JSON.stringify({ store, date, vendor, lines, inbox_id: attached ? attached.id : "" }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const got = await res.json();
      logLine(esc(fmt("ingEntrySavedFmt", { n: got.saved })));
      entryLines = [blankLine()];
      renderLines();
      if (attached) { detachPhoto(); await loadInbox(); }
      await loadCatalog();
      await loadSummary();
    } catch (e) {
      logLine(esc(T("ingEntrySaveFailed") + (e && e.message)));
    }
  }

  // ───────── 사진으로 넣기 ─────────
  //
  // 2026-10-05 사장님: "영수증을 올리면 가격 품목 어디서 언제 샀는지를 내가
  // 직접 타자로 쳐서 하나하나 입력하는 게 아니라 적용되도록."
  //
  // 급여의 출근 카드와 같은 길이다 — 📷 로 고르거나 **탭 아무 데나 끌어다
  // 놓아도** 된다(2026-10-04 사장님: "급여에서 사진 선택 말고도 드래그로 할
  // 수 있게 해줘"). 사진은 기기 밖으로 나가지 않는다.
  //
  // 읽은 값을 그냥 채우고 끝내지 않는다. **칸을 잘라낸 그림을 숫자 밑에**
  // 붙이고, 확실치 않은 줄은 노란 줄로 둔다. 숫자 하나를 88% 로 읽으니 세
  // 자리 금액은 68% 다 — 멀쩡해 보이는 채로 틀린 줄을 장부에 넣는 것이 제일
  // 나쁘다.
  //
  // 품명은 읽지 않는다(한자 손글씨다). 그 업체에서 보통 사는 것 목록으로
  // 고르시게 두고, 종이에서 잘라낸 그림을 옆에 붙인다.
  /**
   * 사진을 **표만 잘라 큼직하게** 만들어 보낸다.
   *
   * ── 왜 이렇게까지 하는가
   *
   * 2026-10-05 눈가림 시험에서 32줄 중 6줄을 틀렸다(81%). 그 여섯 줄을
   * **확대해서 다시 보니 다섯 줄이 읽혔다** — 단가 「90」을 80 으로, 금액
   * 「650」을 610 으로 본 것이 전부 해상도 탓이었다.
   *
   * 모델에 보내는 사진은 긴 쪽 1,568점이 한도다(그 위로는 저쪽에서 어차피
   * 줄인다). 그러니 **사진을 키울 수는 없고, 쓸데없는 데를 버려야** 한다:
   *
   *  1. 책상·스티로폼 같은 배경을 버리고 **표만** 남긴다. 사진에서 종이가
   *     60% 쯤 차지하므로 이것만으로 1.5배쯤 커진다.
   *  2. 줄이 많은 전표는 **위아래로 갈라** 두 장으로 보낸다. 각각 1,568점을
   *     쓰므로 글씨가 두 배로 커진다. 房信 전표는 17줄이라 이게 크다.
   *
   * 표를 못 찾으면 사진 전체를 그냥 보낸다 — 아무것도 안 보내는 것보다 낫다.
   */
  async function cropsForAi(file, opts) {
    const o = Object.assign({ side: 1568, pad: 0.03, splitRows: 9, minRows: 6, minCover: 0.25, header: false, headerSide: 1100 }, opts || {});
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
    if (!bmp) return [];

    // 표가 어디인지는 **기기 안에서 찾는다**(receipt-ocr.js). 사진 1,462장에서
    // 73% 를 찾는다 — 읽기는 못 해도 자리는 잘 찾는다.
    let box = null, rows = 0;
    try {
      const g = await window.HG_RECEIPT_READ.toGray(file, { maxSide: 1600 });
      const found = window.HG_RECEIPT.findReceipts(g.gray, g.w, g.h);
      if (found.length === 1 && found[0].grid.box) {
        const bx = found[0].grid.box;
        const grid = found[0].grid;
        // **자르기가 품목을 통째로 날릴 수 있다.** 大川食品行 처럼 가로로 긴
        // 전표에서 표를 네 줄로만 찾으면, 그 네 줄이 전표 **아래쪽 합계 칸**인
        // 경우가 있다 — 잘라 보내면 품목이 하나도 안 간다(12장 중 2장).
        //
        // 그래서 「표를 제대로 찾았다」고 볼 수 있을 때만 자른다: 줄이 넉넉하고
        // 사진의 꽤 넓은 자리를 차지해야 한다. 아니면 사진 전체를 보낸다 —
        // 조금 작게 보이는 것이 아예 안 보이는 것보다 낫다.
        const covers = ((bx.x1 - bx.x0) * (bx.y1 - bx.y0)) / (g.w * g.h);
        const n = grid.hLines.length - 1;
        if (n >= o.minRows && covers >= o.minCover) {
          const sc = bmp.width / g.w;     // 줄여서 찾았으니 원본 크기로 되돌린다
          box = { x0: bx.x0 * sc, y0: bx.y0 * sc, x1: bx.x1 * sc, y1: bx.y1 * sc };
          rows = n;
        }
      }
    } catch (e) { /* 못 찾으면 사진 전체를 쓴다 */ }

    const padX = bmp.width * o.pad, padY = bmp.height * o.pad;
    const area = box
      ? {
          x0: Math.max(0, box.x0 - padX), y0: Math.max(0, box.y0 - padY),
          x1: Math.min(bmp.width, box.x1 + padX), y1: Math.min(bmp.height, box.y1 + padY),
        }
      : { x0: 0, y0: 0, x1: bmp.width, y1: bmp.height };

    const pieces = [];
    const aw = area.x1 - area.x0, ah = area.y1 - area.y0;
    // 줄이 많으면 위아래로 가른다. 가운데를 조금 겹쳐 자른다 — 경계에 걸친
    // 줄이 양쪽에서 반씩 잘리면 아무 데서도 못 읽는다.
    const split = rows >= o.splitRows && ah > aw;
    const cuts = split
      ? [[0, 0.56], [0.44, 1]]
      : [[0, 1]];
    for (const [a, b] of cuts) {
      const sy = area.y0 + ah * a, sh = ah * (b - a);
      const sc = Math.min(1, o.side / Math.max(aw, sh));
      const w = Math.max(1, Math.round(aw * sc));
      const h = Math.max(1, Math.round(sh * sc));
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      const ctx = cv.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, area.x0, sy, aw, sh, 0, 0, w, h);
      pieces.push(cv.toDataURL("image/jpeg", 0.85));
    }
    // 업체·날짜·지점을 안 고르셨으면 **전표 머리**를 한 장 더 보낸다.
    //
    // 위에서 표만 잘라 보내므로 **가게 이름과 날짜가 잘려 나간다** — 그게
    // 바로 사장님이 파일 이름에 적어 넣으시던 것이다(2026-10-05). 표 위쪽
    // 띠를 작게 한 장 덧붙이면 그 타자가 없어진다. 머리는 글씨가 크고
    // 인쇄된 것이라 작게 보내도 읽힌다 — 400토큰쯤이다.
    // 표를 못 찾았으면 사진 전체를 이미 보냈다 — 머리도 그 안에 있다.
    if (o.header && box) {
      const top = Math.max(0, box.y0 - bmp.height * 0.01);
      const hh = Math.max(1, Math.min(top, bmp.height));
      const sc = Math.min(1, o.headerSide / Math.max(bmp.width, hh));
      const w = Math.max(1, Math.round(bmp.width * sc));
      const h = Math.max(1, Math.round(hh * sc));
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      const ctx = cv.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, 0, 0, bmp.width, hh, 0, 0, w, h);
      pieces.push(cv.toDataURL("image/jpeg", 0.85));
      pieces.headerPiece = true;
    }
    if (bmp.close) bmp.close();
    return pieces;
  }

  /**
   * 사진 한 장을 **서버를 거쳐 Claude 에게** 읽힌다.
   *
   * 키는 서버(Vercel 환경변수)에만 있다 — 화면에 두면 누구나 가져간다.
   * 키가 없거나(503) 실패하면 null 을 주고, 부르는 쪽이 **기기 안에서 읽는
   * 길**로 내려간다. 화면이 멈추지 않는 것이 중요하다.
   */
  async function readByAi(file) {
    const vendor = ($("#ingEntryVendor").value || "").trim();
    const store = $("#ingEntryStore").value || "";
    const date = $("#ingEntryDate").value || "";
    // 안 고르신 것이 있으면 전표 머리를 한 장 더 보내 **종이에서 읽는다**
    const images = await cropsForAi(file, { header: !(vendor && store && date) });
    if (!images.length) return null;
    let res;
    try {
      res = await fetch("/api/ingredients/read-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images, vendor, store, date,
          headerPiece: !!images.headerPiece,
        }),
      });
    } catch (e) { return null; }
    if (res.status === 503) return { off: true };
    if (res.status === 429) {
      const b = await res.json().catch(() => ({}));
      return { capped: true, calls: b.calls, cap: b.cap };
    }
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  }

  // 사장님이 손수 고치신 칸. 여기 든 칸은 사진이 덮지 않는다.
  const touched = new Set();
  let applying = false;
  function watchEntryFields() {
    for (const id of ["ingEntryVendor", "ingEntryDate", "ingEntryStore"]) {
      const el = $("#" + id);
      if (!el || el.dataset.hgWatch) continue;
      el.dataset.hgWatch = "1";
      const mark = () => { if (!applying) touched.add(id); };
      el.addEventListener("input", mark);
      el.addEventListener("change", mark);
    }
  }

  /**
   * 종이에서 읽은 **업체·날짜·지점**을 칸에 넣는다.
   *
   * 2026-10-05 사장님: "아빠가 파일 이름에 저런 정보를 안 넣으면 넌 그걸
   * 인식 못해?" — 영수증에는 가게 이름이 인쇄돼 있고 날짜가 머리에 적혀
   * 있고 지점은 「台元三店」 도장으로 보인다. 12장 중 업체 10 · 날짜 8 ·
   * 지점 12 를 맞혔다.
   *
   * **이미 적혀 있는 칸은 건드리지 않는다.** 특히 날짜가 그렇다 —
   * 사장님(2026-10-05): "장부날짜는 구매 날짜고 사진 날짜는 찍은 날짜일거야
   * 구매 날짜가 더 중요하지". 12장 중 2장이 종이 날짜와 장부 날짜가 달랐다
   * (주문서에 4/29 인데 물건은 5/1 에 왔다). 읽은 것은 **제안**이고 정하는
   * 것은 사장님이다.
   */
  function applyHead(head) {
    if (!head) return false;
    let did = false;
    const put = (sel, v) => {
      const el = $(sel);
      if (!el || !v) return;
      // 사장님이 손수 적으신 칸은 건드리지 않는다. 날짜 칸은 열 때 오늘로
      // 채워 두므로 「적혀 있다」만으로는 모자라다 — 손을 대셨는지를 본다.
      if (touched.has(el.id) || (el.tagName !== "SELECT" && (el.value || "").trim() && el.id !== "ingEntryDate")) return;
      if (el.tagName === "SELECT" && ![...el.options].some((o) => o.value === v)) return;
      if (el.value === v) return;
      applying = true;
      el.value = v;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      applying = false;
      did = true;
    };
    if (head.vendor) put("#ingEntryVendor", head.vendor);
    if (head.date) put("#ingEntryDate", head.date);
    if (head.store) put("#ingEntryStore", head.store);
    // 사장님이 적으신 날짜와 종이 날짜가 다르면 **말만 한다.** 사장님
    // (2026-10-05): "장부날짜는 구매 날짜고 … 구매 날짜가 더 중요하지".
    const dEl = $("#ingEntryDate");
    if (head.date && dEl && dEl.value && dEl.value !== head.date) {
      logLine(esc(fmt("ingPhotoDateDiffFmt", { paper: head.date, kept: dEl.value })), { add: true });
    }
    if (did) {
      const sEl = $("#ingEntryStore");
      logLine(esc(fmt("ingPhotoHeadFmt", {
        vendor: head.vendor || "?",
        date: head.date || "?",
        store: (sEl && sEl.selectedOptions[0] && sEl.selectedOptions[0].textContent) || "?",
      })), { add: true });
      // 읽은 상호가 장부 이름과 글자가 다르면 그렇다고 말한다
      if (head.vendor && head.vendor_text && head.vendor_text !== head.vendor) {
        logLine(esc(fmt("ingPhotoVendorAsFmt", { paper: head.vendor_text, as: head.vendor })), { add: true });
      }
    } else if (head.vendor_text && !head.vendor) {
      // 장부에 없는 업체다. 짐작해서 남의 업체로 넣지 않는다.
      logLine(esc(fmt("ingPhotoVendorUnknownFmt", { paper: head.vendor_text })), { add: true });
    }
    return did;
  }

  // ───────── 영수증 대기함 ─────────
  //
  // 2026-10-06 사장님: "아빠가 일단 사진을 올려주면 그걸 내가 다운받아서
  // 여기다가 칠거야 그럼 너가 급여처럼 인식해서 확실하거나 확실하지 않는 걸로
  // 나눠서 옆에 사진 보여주면서 맞는지 아빠가 오케이 하고 저장하게 하는거지.
  // 그게 또 전체 내역에서 볼수 있는 거고."

  let inbox = { items: [], ai_on: false };
  let attached = null;      // 지금 영수증 넣기에 붙어 있는 대기함 줄

  /**
   * 올릴 사진을 **줄여서** 보낸다.
   *
   * 폰 사진은 한 장에 3~5MB 다. 긴 쪽 1,600점이면 영수증 글씨는 그대로
   * 읽히면서 400KB 쯤으로 준다 — 한 달 221장이면 그 차이가 1GB 다.
   * 작은 미리보기(320점)는 목록에서 쓴다.
   */
  async function shrink(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
    if (!bmp) return null;
    const draw = (side, q) => {
      const sc = Math.min(1, side / Math.max(bmp.width, bmp.height));
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(bmp.width * sc));
      cv.height = Math.max(1, Math.round(bmp.height * sc));
      const ctx = cv.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
      return cv.toDataURL("image/jpeg", q);
    };
    const out = { name: file.name || "receipt.jpg", data: draw(1600, 0.82), thumb: draw(320, 0.7) };
    if (bmp.close) bmp.close();
    return out;
  }

  async function uploadToInbox(files) {
    const list = [...(files || [])].filter((f) => f && /^image\//.test(f.type));
    if (!list.length) return;
    const btn = $("#ingInboxAdd");
    if (btn) { btn.disabled = true; btn.textContent = T("ingInboxUploading"); }
    try {
      const images = [];
      for (const f of list) {
        const one = await shrink(f);
        if (one) images.push({ ...one, store: $("#ingEntryStore") ? $("#ingEntryStore").value : "" });
      }
      if (!images.length) return logLine(esc(T("ingInboxBadImages")));
      // 한 번에 열 장까지 — 더 많으면 나눠 보낸다
      for (let i = 0; i < images.length; i += 10) {
        const res = await fetch("/api/ingredients/inbox", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ images: images.slice(i, i + 10) }),
        });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          return logLine(esc(b.error === "inbox_full" ? fmt("ingInboxFullFmt", { max: b.max }) : T("ingInboxFailed")));
        }
      }
      logLine(esc(fmt("ingInboxAddedFmt", { n: images.length })));
      await loadInbox();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = T("ingInboxAdd"); }
    }
  }

  async function loadInbox() {
    const res = await fetch("/api/ingredients/inbox");
    if (!res.ok) return;
    inbox = await res.json();
    renderInbox();
  }

  function renderInbox() {
    const el = $("#ingInboxList");
    if (!el) return;
    const showSaved = $("#ingInboxShowSaved") && $("#ingInboxShowSaved").checked;
    const items = (inbox.items || []).filter((i) => showSaved || i.status !== "saved");
    const pending = (inbox.items || []).filter((i) => i.status !== "saved").length;
    const cnt = $("#ingInboxCount");
    if (cnt) cnt.textContent = pending ? fmt("ingInboxCountFmt", { n: pending }) : "";
    if (!items.length) {
      el.innerHTML = '<p class="ing-note">' + esc(T("ingInboxEmpty")) + "</p>";
      return;
    }
    el.innerHTML = items.map((i) => {
      const when = String(i.at || "").replace("T", " ").slice(0, 16);
      const badge = i.status === "saved" ? T("ingInboxSaved") : i.status === "read" ? T("ingInboxRead") : T("ingInboxNew");
      const read = i.read
        ? '<span class="ing-inbox-read">' + esc(fmt("ingInboxReadFmt", { n: i.read.rows, unsure: i.read.unsure })) + "</span>"
        : "";
      return (
        '<div class="ing-inbox-row' + (attached && attached.id === i.id ? " is-on" : "") + '" data-inbox="' + esc(i.id) + '">' +
        (i.thumb ? '<img class="ing-inbox-thumb" src="' + esc(i.thumb) + '" alt="" />' : '<div class="ing-inbox-thumb is-gone"></div>') +
        '<div class="ing-inbox-meta"><strong>' + esc(i.name || "—") + "</strong>" +
        '<span class="ing-inbox-when">' + esc(when) + '</span>' +
        '<span class="ing-inbox-badge is-' + esc(i.status) + '">' + esc(badge) + "</span>" + read +
        "</div>" +
        '<div class="ing-inbox-acts">' +
        (i.has_image
          ? '<a class="ing-inbox-btn" href="/api/ingredients/inbox/' + esc(i.id) + '/image?download=1" download>' + esc(T("ingInboxGet")) + "</a>" +
            '<button type="button" class="ing-inbox-btn" data-inbox-paste="' + esc(i.id) + '">' + esc(T("ingInboxPaste")) + "</button>"
          : "") +
        (i.read ? '<button type="button" class="ing-inbox-btn" data-inbox-use="' + esc(i.id) + '">' + esc(T("ingInboxUse")) + "</button>" : "") +
        '<button type="button" class="ing-inbox-btn is-del" data-inbox-del="' + esc(i.id) + '">' + esc(T("ingInboxDel")) + "</button>" +
        "</div>" +
        '<div class="ing-inbox-paste" id="paste-' + esc(i.id) + '" hidden>' +
        '<textarea rows="4" data-inbox-text="' + esc(i.id) + '" placeholder="' + esc(T("ingInboxPastePh")) + '"></textarea>' +
        '<button type="button" class="primary" data-inbox-go="' + esc(i.id) + '">' + esc(T("ingInboxPasteGo")) + "</button>" +
        "</div>" +
        "</div>"
      );
    }).join("");

    el.querySelectorAll("[data-inbox-paste]").forEach((b) => {
      b.onclick = () => {
        const box = $("#paste-" + b.dataset.inboxPaste);
        box.hidden = !box.hidden;
        if (!box.hidden) box.querySelector("textarea").focus();
      };
    });
    el.querySelectorAll("[data-inbox-go]").forEach((b) => { b.onclick = () => sendRead(b.dataset.inboxGo); });
    el.querySelectorAll("[data-inbox-use]").forEach((b) => { b.onclick = () => useRead(b.dataset.inboxUse); });
    el.querySelectorAll("[data-inbox-del]").forEach((b) => { b.onclick = () => delInbox(b.dataset.inboxDel); });
  }

  /** 붙여넣은 결과를 서버에 보내 **한 번 더 검사**하고, 표를 채운다. */
  async function sendRead(id) {
    const ta = document.querySelector('[data-inbox-text="' + id + '"]');
    const text = ta ? ta.value : "";
    if (!text.trim()) return;
    const res = await fetch("/api/ingredients/inbox/" + encodeURIComponent(id) + "/read", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return logLine(esc(T(b.error === "bad_json" || b.error === "bad_shape" || b.error === "no_rows" ? "ingInboxBadPaste" : "ingInboxFailed")));
    }
    const got = await res.json();
    await loadInbox();
    fillFromRead(id, got);
    if (got.more) logLine(esc(fmt("ingInboxMoreFmt", { n: got.more })));
  }

  /** 전에 붙여넣어 둔 결과를 다시 표에 올린다(서버가 들고 있다). */
  async function useRead(id) {
    const res = await fetch("/api/ingredients/inbox/" + encodeURIComponent(id) + "/read");
    if (!res.ok) return logLine(esc(T("ingInboxFailed")));
    fillFromRead(id, await res.json());
  }

  /** 읽은 결과를 영수증 넣기 표에 올린다 — 확실치 않은 줄은 노랗게. */
  function fillFromRead(id, got) {
    entryLines = [];
    for (const r of got.rows || []) {
      const line = blankLine();
      line.name = r.name || "";
      line.name_ko = r.name_ko || "";
      line.unit = r.unit || "";
      line.qty = r.qty === "" ? "" : r.qty;
      line.price = r.price === "" ? "" : r.price;
      line.amount = r.amount === "" ? "" : r.amount;
      line.amountEdited = true;              // 종이에 적힌 금액이다 — 다시 셈하지 않는다
      line.unsure = !r.sure || got.totalOk === false;
      entryLines.push(line);
    }
    if (!entryLines.length) entryLines.push(blankLine());
    renderLines();
    applyHead(got.head);
    attachPhoto(id);
    logLine(esc(fmt("ingPhotoReadFmt", { n: got.rows.length, unsure: got.unsure })));
    if (got.totalOk === false) logLine(esc(fmt("ingInboxTotalOffFmt", { paper: money(got.total), sum: money(Math.round(got.sum || 0)) })));
  }

  /** 그 사진을 표 옆에 붙인다. */
  function attachPhoto(id) {
    const item = (inbox.items || []).find((i) => i.id === id);
    attached = item || null;
    const box = $("#ingEntryPhoto");
    if (!box) return;
    const url = "/api/ingredients/inbox/" + encodeURIComponent(id) + "/image";
    box.hidden = !item || !item.has_image;
    if (!box.hidden) {
      $("#ingEntryPhotoImg").src = url;
      $("#ingEntryPhotoOpen").href = url;
    }
    const entry = document.querySelector(".ing-entry");
    if (entry) entry.classList.toggle("has-photo", !box.hidden);
    renderInbox();
  }

  function detachPhoto() {
    attached = null;
    const box = $("#ingEntryPhoto");
    if (box) box.hidden = true;
    const entry = document.querySelector(".ing-entry");
    if (entry) entry.classList.remove("has-photo");
    renderInbox();
  }

  async function delInbox(id) {
    const okGo = A().showConfirm ? await A().showConfirm(T("ingInboxDelAsk")) : confirm(T("ingInboxDelAsk"));
    if (!okGo) return;
    await fetch("/api/ingredients/inbox/" + encodeURIComponent(id), { method: "DELETE" });
    if (attached && attached.id === id) detachPhoto();
    await loadInbox();
  }

  let reading = false;

  async function readPhotos(files) {
    const list = [...(files || [])].filter((f) => f && /^image\//.test(f.type));
    if (!list.length) return;
    if (reading) return;
    const RR = window.HG_RECEIPT_READ;
    if (!RR) return logLine(esc(T("ingPhotoNoReader")));
    reading = true;
    logLine("");          // 지난 번 말은 치운다 — 아래 말들은 덧붙는다
    const btn = $("#ingPhotoBtn");
    if (btn) { btn.disabled = true; btn.textContent = T("ingPhotoReading"); }
    try {
      let added = 0, unsure = 0, noTable = 0, byAi = 0, aiOff = false, capped = null;
      for (const f of list) {
        // **먼저 Claude 에게 묻는다.** 기기 안에서 읽는 것보다 훨씬 잘 읽는다
        // (2026-10-05: 기기 안 22% — tools/README.md). 키가 없거나 실패하면
        // 아래의 기기 안 읽기로 내려간다.
        const ai = await readByAi(f);
        if (ai && ai.off) aiOff = true;
        else if (ai && ai.capped) capped = ai;
        else if (ai && Array.isArray(ai.rows) && ai.rows.length) {
          applyHead(ai.head);
          for (const r of ai.rows) {
            const line = blankLine();
            line.name = r.name || "";
            line.unit = r.unit || "";
            line.qty = r.qty === "" ? "" : r.qty;
            line.price = r.price === "" ? "" : r.price;
            line.amount = r.amount === "" ? "" : r.amount;
            line.amountEdited = true;
            // 인쇄된 合計와 더한 값이 다르면 그 영수증은 통째로 눈여겨본다
            line.unsure = !r.sure || ai.totalOk === false;
            entryLines.push(line);
            added++; byAi++;
            if (line.unsure) unsure++;
          }
          continue;
        }
        let got;
        try { got = await RR.readPhoto(f, { priceSet: priceSetOf() }); }
        catch (e) { noTable++; continue; }
        if (!got.receipts.length) { noTable++; continue; }
        for (const rec of got.receipts) {
          for (const r of rec.rows) {
            const line = blankLine();
            line.qty = r.qty == null ? "" : Math.round(r.qty * 1000) / 1000;
            line.price = r.price == null ? "" : r.price;
            line.amount = r.amount == null ? "" : r.amount;
            line.amountEdited = true;   // 종이에 적힌 금액이다 — 다시 셈하지 않는다
            line.pic = r.pic || null;
            line.unsure = !r.ok;
            entryLines.push(line);
            added++;
            if (!r.ok) unsure++;
          }
        }
      }
      // 빈 줄이 맨 앞에 남아 있으면 치운다
      entryLines = entryLines.filter((l, i) => i > 0 || String(l.name || "") !== "" || l.qty !== "" || l.amount !== "");
      if (!entryLines.length) entryLines.push(blankLine());
      renderLines();
      if (added) logLine(esc(fmt("ingPhotoReadFmt", { n: added, unsure })), { add: true });
      if (byAi) logLine(esc(fmt("ingPhotoByAiFmt", { n: byAi })), { add: true });
      if (aiOff) logLine(esc(T("ingPhotoAiOff")), { add: true });
      if (capped) logLine(esc(fmt("ingPhotoCapFmt", { cap: capped.cap })), { add: true });
      if (noTable) logLine(esc(fmt("ingPhotoNoTableFmt", { n: noTable })), { add: true });
      if (!added && !noTable) logLine(esc(T("ingPhotoNothing")), { add: true });
    } finally {
      reading = false;
      if (btn) { btn.disabled = false; btn.textContent = T("ingPhotoBtn"); }
    }
  }

  /** 그 업체가 전에 받은 단가들. 숫자가 흐릴 때 엉뚱한 값으로 가는 것을 막는다. */
  function priceSetOf() {
    if (!catalog.items || !catalog.items.length) return null;
    const out = new Set();
    for (const i of catalog.items) {
      if (i.last_price != null) out.add(Math.round(i.last_price));
      for (const p of i.prices || []) if (p != null) out.add(Math.round(p));
    }
    return out.size ? out : null;
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
      $("#ingExportBtn").onclick = () => exportXlsx();
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
      $("#ingPhotoBtn").onclick = () => $("#ingPhotoFile").click();
      $("#ingPhotoFile").onchange = (e) => {
        // **파일을 먼저 베껴 둔다.** `value = ""` 는 고른 파일 목록까지
        // 비우므로, FileList 를 그대로 들고 있으면 빈 목록이 넘어간다 —
        // 사진을 골라도 아무 일도 안 일어난다.
        const picked = [...(e.target.files || [])];
        e.target.value = "";
        uploadToInbox(picked);
      };
      // 탭 아무 데나 끌어다 놓아도 된다 — 급여와 같은 길이다.
      const zone = document.getElementById("tab-ingredients");
      if (zone) {
        zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("ing-drop"); });
        zone.addEventListener("dragleave", () => zone.classList.remove("ing-drop"));
        zone.addEventListener("drop", (e) => {
          e.preventDefault();
          zone.classList.remove("ing-drop");
          // 끌어다 놓으면 **대기함에 올린다**(2026-10-06). 그 자리에서 읽지 않는다 —
          // 키 없이 기기 안에서 읽으면 한 줄 통째로 22% 다.
          uploadToInbox(e.dataTransfer && e.dataTransfer.files);
        });
      }
      watchEntryFields();
      // 대기함 — 올리기·목록·사진 떼기
      if ($("#ingInboxAdd")) {
        $("#ingInboxAdd").onclick = () => $("#ingInboxFile").click();
        $("#ingInboxFile").onchange = (e) => {
          const files = [...(e.target.files || [])];   // value 를 비우면 목록도 비워진다 — 먼저 베낀다
          e.target.value = "";
          uploadToInbox(files);
        };
      }
      if ($("#ingInboxShowSaved")) $("#ingInboxShowSaved").onchange = () => renderInbox();
      if ($("#ingEntryPhotoClear")) $("#ingEntryPhotoClear").onclick = () => detachPhoto();
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
    await loadInbox();
  }

  window.HG_INGREDIENTS = { load, findColumns, storeOfSheet, HEAD, blankLine, warnHtml, readPhotos, priceSetOf, readByAi, cropsForAi };
})();
