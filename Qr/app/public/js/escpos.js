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
    return o.order_type === "delivery" ? "배달" : "매장";
  }

  // Mirrors buildTicketHtml()'s own item-name preference (name_zh first —
  // this restaurant's real kitchen ticket has historically been in
  // Chinese, see the comment on buildTicketHtml in admin.js).
  function itemName(it) {
    return it.name_zh || it.name_ko || it.name_en || "";
  }

  function buildEscPosTicket(o, storeName) {
    const time = new Date(o.created_at.replace(" ", "T")).toLocaleString("ko-KR");
    let out = CMD.INIT;

    out += CMD.ALIGN_CENTER + CMD.BOLD_ON + `${storeName} 주방 주문서` + CMD.BOLD_OFF + "\n";
    out += CMD.ALIGN_LEFT + divider() + "\n";
    out += padLine(`테이블 ${o.table_number}번`, orderTypeLabel(o)) + "\n";
    out += time + "\n";
    out += divider() + "\n";

    o.items.forEach((it) => {
      const name = truncateToWidth(itemName(it), LINE_WIDTH - 6);
      out += CMD.BOLD_ON + padLine(name, `x${it.qty}`) + CMD.BOLD_OFF + "\n";
      const metaParts = [];
      if (it.option_choice) metaParts.push(it.option_choice);
      if (it.spice_choice) metaParts.push(it.spice_choice);
      if (metaParts.length) out += "  " + metaParts.join(" / ") + "\n";
      if (it.note) out += "  메모: " + it.note + "\n";
    });

    out += divider() + "\n";
    out += CMD.DOUBLE_ON + padLine("합계", `NT$${o.total}`, Math.floor(LINE_WIDTH / 2)) + CMD.DOUBLE_OFF + "\n";
    if (o.note) out += "주문 메모: " + o.note + "\n";
    out += CMD.ALIGN_CENTER + "인쇄: " + new Date().toLocaleString("ko-KR") + "\n";
    out += CMD.FEED_AND_CUT;
    return out;
  }

  window.buildEscPosTicket = buildEscPosTicket;
})();
