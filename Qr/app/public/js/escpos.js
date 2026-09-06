// Builds a raw ESC/POS command string for the kitchen ticket, for direct
// silent printing via QZ Tray (see public/js/qz-tray.js + the "ESC/POS 자동
// 인쇄" setting in admin.js) — bypasses the browser's print dialog entirely,
// unlike printKitchenTicket()/buildTicketHtml() in admin.js which print
// through the OS's normal print pipeline. Same order data, same content
// (table/time/order type/items/meat-type/spice/total) as that HTML ticket,
// just rendered as ESC/POS control codes + plain text instead of HTML/CSS.
//
// IMPORTANT — this was written without a physical printer to test against.
// Two things are very likely to need on-site tuning once the real N160II
// (or whatever printer) is connected:
//   1) LINE_WIDTH below (how many normal-width characters fit per line —
//      commonly 42 or 48 for 80mm paper at the printer's default font, but
//      varies by model/firmware). If columns look too narrow/wide or wrap
//      oddly, adjust this constant.
//   2) Korean/Chinese character support. Most modern ESC/POS printers with
//      Windows/Android/iOS driver support (like the N160II) handle UTF-8
//      text fine, which is what this sends — but a few older firmwares
//      need an explicit code-page-select command first. If Hangul/Hanja
//      print as blank boxes or garbage, that's the symptom — check the
//      printer's own ESC/POS command reference for its Korean/Chinese
//      code page command and it can be added near ESC_INIT below.
//   3) The "└" character used below to mark meat-type/spice/note as a
//      detail line under a dish (e.g. "牛" printing under "石鍋拌飯"). This
//      is a standard Unicode box-drawing character, not CJK, so it's a
//      separate risk from (2) — if it prints as a blank box while the
//      Chinese text next to it prints fine, replace it with a plain
//      character the printer's font is guaranteed to have, like "-".
(function () {
  const ESC = "\x1B";
  const GS = "\x1D";

  const CMD = {
    INIT: ESC + "\x40",
    ALIGN_LEFT: ESC + "\x61\x00",
    ALIGN_CENTER: ESC + "\x61\x01",
    BOLD_ON: ESC + "\x45\x01",
    BOLD_OFF: ESC + "\x45\x00",
    DOUBLE_ON: GS + "\x21\x11", // double width + double height
    DOUBLE_OFF: GS + "\x21\x00",
    // Feed a few lines then partial-cut — the most broadly-compatible cut
    // sequence across ESC/POS printer brands (GS V 66 0).
    FEED_AND_CUT: "\n\n\n" + GS + "\x56\x42\x00",
  };

  // How many normal-width (Font A, non-double-width) characters fit on one
  // printed line. See the file-level comment above — this is the single
  // most likely thing to need adjusting once tested on the real printer.
  const LINE_WIDTH = 48;

  // Hangul, Hanja/CJK and fullwidth punctuation render as double-width
  // cells on virtually every ESC/POS thermal printer (same as on a
  // terminal) — padding by JS string length alone would misalign columns
  // whenever a line mixes Korean/Chinese with Latin text/digits, which
  // every line here does (e.g. "테이블 7번" + "매장").
  function isWideChar(codePoint) {
    return (
      (codePoint >= 0x1100 && codePoint <= 0x115f) || // Hangul Jamo
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf) || // CJK radicals ... Yi
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // Hangul syllables
      (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK compat ideographs
      (codePoint >= 0xff00 && codePoint <= 0xff60) || // fullwidth forms
      (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    );
  }

  function visualWidth(str) {
    let w = 0;
    for (const ch of str) w += isWideChar(ch.codePointAt(0)) ? 2 : 1;
    return w;
  }

  // Truncates `str` to at most `maxWidth` visual columns (cutting a wide
  // char cleanly rather than splitting it), used for the item name column
  // so a very long dish name can't push the quantity off the line.
  function truncateToWidth(str, maxWidth) {
    let w = 0;
    let out = "";
    for (const ch of str) {
      const cw = isWideChar(ch.codePointAt(0)) ? 2 : 1;
      if (w + cw > maxWidth) break;
      out += ch;
      w += cw;
    }
    return out;
  }

  // Lays `left` and `right` out on one line, right-edge-aligned, padding
  // with spaces in between based on VISUAL width (see above), not
  // str.length — e.g. padLine("테이블 7번", "매장") lines up "매장" against
  // the line's right edge correctly even though "테이블 7번" is Korean.
  function padLine(left, right, width) {
    width = width || LINE_WIDTH;
    const leftW = visualWidth(left);
    const rightW = visualWidth(right);
    const gap = Math.max(1, width - leftW - rightW);
    return left + " ".repeat(gap) + right;
  }

  function divider(width) {
    return "-".repeat(width || LINE_WIDTH);
  }

  function orderTypeLabel(o) {
    if (o.order_type === "mixed") return "混合";
    if (o.order_type === "takeout") return "外帶";
    if (o.order_type === "delivery") return "外送";
    return "內用";
  }

  // Mirrors buildTicketHtml()'s own item-name preference (name_zh first —
  // this restaurant's real kitchen ticket has historically been in
  // Chinese, see the comment on buildTicketHtml in admin.js).
  function itemName(it) {
    return it.name_zh || it.name_ko || it.name_en || "";
  }

  // All fixed labels on this ticket are Traditional Chinese, matching
  // buildTicketHtml() in admin.js — only dish names come from whichever
  // language that menu item actually has (name_zh preferred). Each
  // attribute (meat type, spice level, note) prints as its own "└"-marked
  // sub-line under the dish, same as the HTML ticket, so it reads clearly
  // as a *detail of that dish* and not a second item.
  function buildEscPosTicket(o, storeName) {
    const time = new Date(o.created_at.replace(" ", "T")).toLocaleString("zh-TW");
    let out = CMD.INIT;

    out += CMD.ALIGN_CENTER + CMD.BOLD_ON + `${storeName} 廚房出單` + CMD.BOLD_OFF + "\n";
    out += CMD.ALIGN_LEFT + divider() + "\n";
    out += padLine(`桌號 ${o.table_number}`, orderTypeLabel(o)) + "\n";
    out += time + "\n";
    out += divider() + "\n";

    o.items.forEach((it) => {
      const name = truncateToWidth(itemName(it), LINE_WIDTH - 6);
      out += CMD.BOLD_ON + padLine(name, `x${it.qty}`) + CMD.BOLD_OFF + "\n";
      if (it.option_choice) out += "  └ " + it.option_choice + "\n";
      if (it.spice_choice) out += "  └ " + it.spice_choice + "\n";
      // Order type is chosen per dish now (see order_type on each item in
      // src/routes/orders.js), so one order can mix 內用/外帶 — 內用 is the
      // default and stays implicit, only 外帶 is called out per dish, same
      // as buildTicketHtml()'s HTML ticket in admin.js.
      if (it.order_type === "takeout") out += CMD.BOLD_ON + "  └ 外帶" + CMD.BOLD_OFF + "\n";
      if (it.note) out += "  └ 備註：" + it.note + "\n";
    });

    out += divider() + "\n";
    out += CMD.DOUBLE_ON + padLine("合計", `NT$${o.total}`, Math.floor(LINE_WIDTH / 2)) + CMD.DOUBLE_OFF + "\n";
    if (o.note) out += "訂單備註：" + o.note + "\n";
    out += CMD.ALIGN_CENTER + "列印時間：" + new Date().toLocaleString("zh-TW") + "\n";
    out += CMD.FEED_AND_CUT;
    return out;
  }

  // ---------- Raster (bitmap) ticket, for RawBT ----------
  // On-site test (2026-09-06) showed this restaurant's actual printer
  // (DaiDai/芯燁 XP-N160II) does NOT print the UTF-8 Chinese text above
  // correctly — every Chinese character came out as a DIFFERENT, unrelated
  // (but valid) CJK glyph, while plain ASCII (digits, "NT$", times) printed
  // fine. That's the signature of a printer decoding our UTF-8 bytes with
  // its own built-in double-byte code page (Big5/GBK/etc.) instead of as
  // UTF-8 — exactly the risk flagged in this file's header comment above,
  // now confirmed on real hardware. Guessing the right code page and
  // re-encoding text for it is fragile (varies by printer/firmware batch),
  // so this renders the WHOLE ticket as a bitmap instead: draw it on an
  // offscreen <canvas> with a normal CJK-capable font, threshold to 1-bit
  // black/white, and send it as an ESC/POS "GS v 0" raster image. Pure
  // pixels — no code page involved — so it prints correctly no matter what
  // character sets the printer's firmware actually supports.
  //
  // Bonus: because this draws with real canvas fonts/sizes instead of the
  // printer's fixed built-in font, it can finally track the "빌지(주방
  // 티켓) 글자 크기·굵기" settings (ticketFontSizes/buildTicketHtml in
  // admin.js) that the browser-print ticket already honors — the ESC/POS
  // text path above can't do this at all (see its settings-card hint).
  //
  // Only wired up for RawBT (tryPrintViaRawBt in admin.js) for now — QZ
  // Tray's tryPrintViaEscPos still uses the plain-text buildEscPosTicket()
  // above, untouched, since that path hasn't been tested against real
  // hardware at all and this restaurant isn't currently using it.

  // Printer's printable width in dots. 576 is the standard for 80mm
  // thermal receipt printers at 203dpi (72mm printable area x 8 dots/mm) —
  // the same assumption LINE_WIDTH=48 above was quietly built on (48 chars
  // x 12px/char Font A = 576 dots). If real tickets come out cropped on one
  // side or with a big blank margin, check this constant first — some
  // printer/firmware combinations use a narrower printable area.
  const RASTER_DOTS_WIDE = 576;
  // Rough CSS-px -> printer-dot scale so the raster ticket's relative
  // proportions track the ticketFontSizes values (authored as CSS px for
  // the 96dpi browser-print ticket) instead of looking arbitrarily
  // smaller/bigger on the 203dpi printer. Not physically exact (203/96 ≈
  // 2.11) but close and a single easy spot to tune if real prints look off.
  const PX_TO_DOTS = 2;
  const RASTER_PAD = 24; // left/right margin, in dots

  function rasterFont(px, weight) {
    return `${weight >= 700 ? "bold " : ""}${Math.round(px * PX_TO_DOTS)}px "Noto Sans TC", "Noto Sans KR", sans-serif`;
  }

  // Shrinks `text` (adding "…") until it fits within `maxWidth` dots at
  // the canvas context's currently-set font — canvas has no equivalent of
  // the character-counting truncateToWidth() above, so this measures the
  // real rendered width via binary search instead.
  function fitText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let lo = 0,
      hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (ctx.measureText(text.slice(0, mid) + "…").width <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return lo <= 0 ? "" : text.slice(0, lo) + "…";
  }

  // `labelInfo` = { tableLabel, phoneLine } — precomputed by admin.js the
  // same way buildTicketHtml() derives them there (the counter-order /
  // pickup-number lookup needs the `tables` list, which this file
  // deliberately doesn't know about), so this stays a pure function of its
  // arguments, same as buildEscPosTicket() above.
  function buildEscPosRasterTicket(o, storeName, fontSizes, labelInfo) {
    const fs = fontSizes || {};
    const sz = (k, d) => fs[k] || d;
    const wt = (k, d) => fs[k + "Weight"] || d;
    labelInfo = labelInfo || {};
    const tableLabel = labelInfo.tableLabel || `桌號 ${o.table_number}`;

    // ---- pass 1: measure on a throwaway canvas at the real width, laying
    // out every line/row and accumulating the total height needed ----
    const measureCanvas = document.createElement("canvas");
    measureCanvas.width = RASTER_DOTS_WIDE;
    const mctx = measureCanvas.getContext("2d");

    const ops = []; // { type: 'text'|'row'|'divider', ..., y }
    let y = 28;

    function line(text, px, weight, opts) {
      opts = opts || {};
      mctx.font = rasterFont(px, weight);
      const maxWidth = RASTER_DOTS_WIDE - RASTER_PAD * 2;
      const align = opts.align || "left";
      const fitted = opts.noFit ? text : fitText(mctx, text, maxWidth);
      ops.push({ type: "text", text: fitted, px, weight, align, y });
      y += Math.round(px * PX_TO_DOTS * 1.4) + (opts.gapAfter || 0);
    }
    function row(left, right, px, weight, opts) {
      opts = opts || {};
      mctx.font = rasterFont(px, weight);
      const rightWidth = mctx.measureText(right).width;
      const leftMax = RASTER_DOTS_WIDE - RASTER_PAD * 2 - rightWidth - 16;
      const fittedLeft = fitText(mctx, left, leftMax);
      ops.push({ type: "row", left: fittedLeft, right, px, weight, y });
      y += Math.round(px * PX_TO_DOTS * 1.4) + (opts.gapAfter || 0);
    }
    function divider() {
      ops.push({ type: "divider", y });
      y += 20;
    }

    line(`${storeName} 廚房出單`, sz("storeName", 17), wt("storeName", 900), { align: "center" });
    divider();
    row(tableLabel, orderTypeLabel(o), sz("tableNo", 13), wt("tableNo", 700));
    if (labelInfo.phoneLine) line(labelInfo.phoneLine, sz("time", 13), wt("time", 700));
    line(new Date(o.created_at.replace(" ", "T")).toLocaleString("zh-TW"), sz("time", 13), wt("time", 700));
    divider();

    o.items.forEach((it) => {
      row(itemName(it), `x${it.qty}`, sz("itemName", 16), wt("itemName", 900));
      if (it.option_choice) line("  └ " + it.option_choice, sz("itemDetail", 13), wt("itemDetail", 400));
      if (it.spice_choice && it.spice_choice !== "基本") line("  └ " + it.spice_choice, sz("itemDetail", 13), wt("itemDetail", 400));
      (it.selected_addons || []).forEach((a) => line("  └ +" + a.name, sz("itemDetail", 13), wt("itemDetail", 400)));
      if (it.order_type === "takeout") line("  └ 外帶", sz("itemTakeout", 13), wt("itemTakeout", 900));
      if (it.note) line("  └ 備註：" + it.note, sz("itemNote", 13), wt("itemNote", 400));
      y += 8; // small gap between items, echoing .item-row's CSS padding
    });

    divider();
    row("合計", `NT${o.total}`, sz("total", 16), wt("total", 900), { gapAfter: 6 });
    if (o.note) line("訂單備註：" + o.note, sz("orderNote", 11), wt("orderNote", 400));
    line("列印時間：" + new Date().toLocaleString("zh-TW"), sz("printTime", 10), wt("printTime", 400), { align: "center" });

    const totalHeight = y + 24;

    // ---- pass 2: draw for real on a canvas sized to fit exactly ----
    const canvas = document.createElement("canvas");
    canvas.width = RASTER_DOTS_WIDE;
    canvas.height = totalHeight;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    ctx.textBaseline = "top";

    ops.forEach((op) => {
      if (op.type === "divider") {
        ctx.beginPath();
        ctx.setLineDash([6, 4]);
        ctx.moveTo(RASTER_PAD, op.y);
        ctx.lineTo(canvas.width - RASTER_PAD, op.y);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
        return;
      }
      if (op.type === "row") {
        ctx.font = rasterFont(op.px, op.weight);
        ctx.textAlign = "left";
        ctx.fillText(op.left, RASTER_PAD, op.y);
        ctx.textAlign = "right";
        ctx.fillText(op.right, canvas.width - RASTER_PAD, op.y);
        return;
      }
      ctx.font = rasterFont(op.px, op.weight);
      ctx.textAlign = op.align === "center" ? "center" : "left";
      ctx.fillText(op.text, op.align === "center" ? canvas.width / 2 : RASTER_PAD, op.y);
    });

    // ---- threshold to 1-bit + pack into ESC/POS "GS v 0" raster format ----
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const widthBytes = canvas.width / 8; // 576/8 = 72 exactly, no row padding needed
    const bytes = [];
    bytes.push(0x1b, 0x40); // ESC @ - init, same as CMD.INIT above
    bytes.push(0x1d, 0x76, 0x30, 0x00); // GS v 0, m=0 (normal size)
    bytes.push(widthBytes & 0xff, (widthBytes >> 8) & 0xff);
    bytes.push(canvas.height & 0xff, (canvas.height >> 8) & 0xff);
    for (let py = 0; py < canvas.height; py++) {
      const rowStart = py * canvas.width * 4;
      for (let bx = 0; bx < widthBytes; bx++) {
        let b = 0;
        for (let bit = 0; bit < 8; bit++) {
          const idx = rowStart + (bx * 8 + bit) * 4;
          // Luminance threshold — canvas only ever draws solid black on
          // solid white here, so this really just tests "was this pixel
          // touched by fillText/stroke", with a little anti-aliasing slop.
          const lum = img.data[idx] * 0.3 + img.data[idx + 1] * 0.59 + img.data[idx + 2] * 0.11;
          if (lum < 128) b |= 0x80 >> bit;
        }
        bytes.push(b);
      }
    }
    bytes.push(0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00); // feed + partial cut, same as CMD.FEED_AND_CUT above

    return new Uint8Array(bytes);
  }

  window.buildEscPosTicket = buildEscPosTicket;
  window.buildEscPosRasterTicket = buildEscPosRasterTicket;
})();
