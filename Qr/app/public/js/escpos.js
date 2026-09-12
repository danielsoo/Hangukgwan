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

  /**
   * 좌석번호 옆 인원 — 「(3-2)」 는 어른 3, 아이 2.
   *
   * 2026-09-10 사장님: "주문서 및 화면의 좌석번호 옆에 괄호넣고 인원수 나오게".
   * 관리자 화면(admin.js partyTag)과 같은 규칙이어야 한다 — 종이와 화면이
   * 다르게 적히면 주방과 홀이 서로 다른 숫자를 부른다.
   *
   * 아이가 0명이어도 (3-0). 자리가 늘 두 칸이어야 앞의 숫자를 어른으로 읽는다.
   * 어른/아이를 물어본 적 없는 손님은 총원만 (4).
   */
  function partyTag(o) {
    if (!o || !o.party_size) return "";
    if (o.party_adults == null) return ` (${o.party_size})`;
    return ` (${o.party_adults}-${o.party_children || 0})`;
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
  // 한 품목 라인의 금액(단가+애드온 합)×수량 — admin.js의 lineTotalOf()와
  // 동일한 계산식(이 파일은 admin.js와 별개로 로드되므로 그쪽 함수를 그냥
  // 가져다 쓸 수 없어 여기 따로 둔다).
  function lineTotalOf(it) {
    return (it.unit_price + (it.selected_addons || []).reduce((s, a) => s + a.price, 0)) * it.qty;
  }

  // 사장님 요청(2026-09-07): "주문서 2장인출 한장은 지금처럼 주방용, 다른
  // 한장은 각각의 가격이 나오게... 화면을 안보고 결제시도를 하게 됐을때
  // 가격이 나온 주문서를 보고 계산을 할 수 있도록. 할인이 들어가면 그
  // 안에 음료수같은 것은 제하는 부분도 있으니까 보다 명료해야함" —
  // priceCopy가 true면 품목마다 금액(단가×수량, 애드온 포함)을 한 줄 더
  // 붙이고, 할인 대상에서 제외되는 음료·주류(category_key === "drink" —
  // src/routes/orders.js의 discountEligibleTotal과 같은 기준)를 표시해서
  // 화면 없이 이 종이만 보고 계산해도 헷갈리지 않게 한다. admin.js의
  // buildTicketHtml()과 같은 설계 — 결제 시점 할인 자체는 미리 계산해
  // 찍지 않고 참고용 문구만 남긴다.
  // 테스터 모드로 넣은 주문인가(src/testMode.js). 빌지에 크게 찍어야 한다 —
  // 주방은 종이만 보고 움직이므로, 표시가 없으면 없는 손님의 음식을 만든다.
  // 인쇄 자체는 막지 않는다(사장님 선택): 프린터가 잘 도는지도 같이
  // 시험할 수 있어야 하니까.
  function isTestOrder(o) {
    return !!(o && o.test_session);
  }

  function buildEscPosTicket(o, storeName, opts) {
    const priceCopy = !!(opts && opts.priceCopy);
    // opts.discount — admin.js의 computeTicketDiscountInfo(o) 결과를 그대로
    // 넘겨받는다(이 파일은 admin.js의 테이블별 할인 상태를 모르므로).
    // { active:false } 아니면 { active:true, isPercent, rate?,
    // discountedTotal } — buildReceiptBodyHtml()과 완전히 같은 규칙.
    const discount = (opts && opts.discount) || { active: false };
    let hasDrinkItem = false;
    const time = new Date(o.created_at.replace(" ", "T")).toLocaleString("zh-TW");
    let out = CMD.INIT;

    if (isTestOrder(o)) {
      out += CMD.ALIGN_CENTER + CMD.BOLD_ON + "*** 테스트 / 測試 ***" + CMD.BOLD_OFF + "\n";
      out += CMD.ALIGN_CENTER + "이 주문은 만들지 마세요\n";
      out += CMD.ALIGN_CENTER + "請勿製作此訂單\n";
      out += CMD.ALIGN_LEFT + divider() + "\n";
    }

    out += CMD.ALIGN_CENTER + CMD.BOLD_ON + `${storeName} ${priceCopy ? "結帳單" : "廚房出單"}` + CMD.BOLD_OFF + "\n";
    out += CMD.ALIGN_LEFT + divider() + "\n";
    out += padLine(`桌號 ${o.table_number}${partyTag(o)}`, orderTypeLabel(o)) + "\n";
    out += time + "\n";
    out += divider() + "\n";

    o.items.forEach((it) => {
      const name = truncateToWidth(itemName(it), LINE_WIDTH - 6);
      out += CMD.BOLD_ON + padLine(name, `x${it.qty}`) + CMD.BOLD_OFF + "\n";
      if (it.option_choice) out += "  └ " + it.option_choice + "\n";
      if (it.spice_choice) out += "  └ " + it.spice_choice + "\n";
      // 부대찌개 포장 전용 조리 여부(不煮外帶/煮熟外帶) — priceCopy 여부와
      // 무관하게 항상 찍는다(주방이 조리 전에 확인해야 하는 정보라서).
      if (it.takeout_choice) out += "  └ " + it.takeout_choice + "\n";
      // Order type is chosen per dish now (see order_type on each item in
      // src/routes/orders.js), so one order can mix 內用/外帶 — 內用 is the
      // default and stays implicit, only 外帶 is called out per dish, same
      // as buildTicketHtml()'s HTML ticket in admin.js.
      if (it.order_type === "takeout") out += CMD.BOLD_ON + "  └ 外帶" + CMD.BOLD_OFF + "\n";
      // 品項別 요청사항(備註) 입력칸은 손님 주문 화면에서 완전히 제거됐고
      // 관리자 쪽에도 대신 입력할 곳이 없어서 다시는 채워지지 않는다 —
      // 렌더링을 지웠다(admin.js buildReceiptBodyHtml와 동일 처리).
      // priceCopy 전용 — 주방용 사본에는 안 넣는다. 할인이 걸려 있으면
      // (特約95折/VIP9折만, 재량 할인은 품목별로 안 나눔 — 위 admin.js
      // computeTicketDiscountInfo 주석 참고) 원가→할인가를 같이 찍는다.
      // 일반 텍스트 ESC/POS라 화면처럼 취소선은 못 그으니 화살표로 표시.
      if (priceCopy) {
        const amount = lineTotalOf(it);
        const isDrink = it.category_key === "drink";
        if (isDrink) hasDrinkItem = true;
        if (discount.active && discount.isPercent && !isDrink) {
          const discounted = amount - Math.round(amount * (1 - discount.rate));
          out += "  └ NT$" + amount + "→NT$" + discounted + "\n";
        } else {
          const mark = discount.active && discount.isPercent && isDrink ? "※" : "";
          out += "  └ NT$" + amount + mark + "\n";
        }
      }
    });

    if (priceCopy && discount.active && discount.isPercent && hasDrinkItem) {
      out += "※ 飲料/酒類恕不折扣\n";
    }
    out += divider() + "\n";
    if (priceCopy && discount.active) {
      out += CMD.DOUBLE_ON + padLine("合計", `NT$${o.total}→NT$${discount.discountedTotal}`, Math.floor(LINE_WIDTH / 2)) + CMD.DOUBLE_OFF + "\n";
    } else {
      out += CMD.DOUBLE_ON + padLine("合計", `NT$${o.total}`, Math.floor(LINE_WIDTH / 2)) + CMD.DOUBLE_OFF + "\n";
    }
    if (priceCopy) out += "※本單僅供結帳參考，實際折扣依系統結帳畫面為準\n";
    // 整單備註(o.note) 입력칸은 손님 주문 화면에서 완전히 제거됐다(커밋
    // e0f1b86) — 다시는 채워지지 않으므로 렌더링을 지웠다.
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
  // 사장님 요청(2026-09-07): "주문서 2장인출 한장은 지금처럼 주방용, 다른
  // 한장은 각각의 가격이 나오게" — opts.priceCopy는 buildEscPosTicket()과
  // 같은 의미(품목별 금액 + 음료·주류 표시, 참고용 문구), RawBT/앱 브릿지
  // 경로(tryPrintViaRawBt)에서 이 비트맵 방식을 쓴다.
  /**
   * 그려놓은 캔버스를 흑백 1비트로 바꿔 ESC/POS "GS v 0" 래스터 명령으로 싼다.
   *
   * 주문서와 자리 이동 빌지가 같은 코드를 쓴다. 아래 밴드 나누기는 값싼
   * 프린터가 큰 이미지를 통째로 버리는 문제(2026-09-09)를 피하려고 넣은
   * 것인데, 그 지식이 한 군데에만 있으면 나중에 만든 다른 빌지가 조용히
   * 같은 병에 걸린다.
   */
  function rasterCanvasToEscPos(canvas, ctx) {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const widthBytes = canvas.width / 8; // 576/8 = 72 exactly, no row padding needed
    const bytes = [];
    bytes.push(0x1b, 0x40); // ESC @ - init, same as CMD.INIT above

    // 비트맵을 통째로 GS v 0 한 번에 보내지 않고 가로로 잘라서 여러 번
    // 보낸다.
    //
    // 2026-09-09 사장님: "주문서 출력이 어떤 테이블은 고객, 주방용 2가지로,
    // 어쩔때는 주방만 나옴."
    //
    // 재보니 결제용 사본은 품목마다 금액 줄이 하나씩 더 붙어서 주방용보다
    // 항상 크다 — 품목 5개면 40KB 대 55KB, 10개면 59KB 대 87KB, 20개면
    // 96KB 대 149KB. 그런데 이걸 GS v 0 명령 하나에 전부 실어 보내고
    // 있었다. 이 프린터(XP-N160II)를 포함해 이 값싼 영수증 프린터들은
    // 입력 버퍼가 대개 64KB 안팎이라, 한 명령이 그보다 크면 프린터가
    // 그 이미지를 통째로 버린다. 주방용은 들어가고 결제용만 넘치는
    // 크기대라서, 정확히 "주방용만 나오는" 증상이 된다. 그리고 주문을
    // 많이 한 테이블일수록 잘 터지니 "어떤 테이블은" 처럼 보인다.
    //
    // 밴드 하나는 128줄(=128 × 72 = 9216바이트)이라 버퍼가 아무리 작아도
    // 안전하고, GS v 0 는 부를 때마다 그 높이만큼 종이를 밀기 때문에
    // 여러 번 나눠 보내도 이어 붙어 한 장으로 나온다 — 성숙한 ESC/POS
    // 라이브러리들이 전부 쓰는 방식이다.
    const BAND_ROWS = 128;
    for (let bandTop = 0; bandTop < canvas.height; bandTop += BAND_ROWS) {
      const bandRows = Math.min(BAND_ROWS, canvas.height - bandTop);
      bytes.push(0x1d, 0x76, 0x30, 0x00); // GS v 0, m=0 (normal size)
      bytes.push(widthBytes & 0xff, (widthBytes >> 8) & 0xff);
      bytes.push(bandRows & 0xff, (bandRows >> 8) & 0xff);
      for (let py = bandTop; py < bandTop + bandRows; py++) {
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
    }
    bytes.push(0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00); // feed + partial cut, same as CMD.FEED_AND_CUT above

      return new Uint8Array(bytes);
  }

  function buildEscPosRasterTicket(o, storeName, fontSizes, labelInfo, opts) {
    const fs = fontSizes || {};
    const sz = (k, d) => fs[k] || d;
    const wt = (k, d) => fs[k + "Weight"] || d;
    labelInfo = labelInfo || {};
    const tableLabel = labelInfo.tableLabel || `桌號 ${o.table_number}${partyTag(o)}`;
    const priceCopy = !!(opts && opts.priceCopy);
    // opts.discount — admin.js의 computeTicketDiscountInfo(o) 결과. 이
    // 비트맵도 흑백 1비트 인쇄라 화면의 회색 취소선을 그대로 재현하기
    // 어려워서, buildEscPosTicket()의 일반 텍스트 버전과 똑같이
    // "NT$원가→NT$할인가" 화살표 표기로 통일한다.
    const discount = (opts && opts.discount) || { active: false };
    let hasDrinkItem = false;

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

    // 테스터 모드 주문은 가게 이름보다 먼저, 제일 크게. 주방은 종이만 보고
    // 움직인다(isTestOrder 위 주석).
    if (isTestOrder(o)) {
      line("*** 테스트 / 測試 ***", sz("storeName", 17) + 4, 900, { align: "center" });
      line("이 주문은 만들지 마세요", sz("tableNo", 13), 700, { align: "center" });
      line("請勿製作此訂單", sz("tableNo", 13), 700, { align: "center" });
      divider();
    }

    // 알림 빌지 — 새 주문이 아니라 「이미 있는 주문에 무슨 일이 생겼다」를
    // 알리는 종이다(자리 이동, 품목 추가·취소). 주방은 종이만 보고 움직이므로
    // 무슨 종이인지가 맨 위에서 바로 읽혀야 한다. 새 주문 빌지와 헷갈리면
    // 요리를 처음부터 다시 만들게 된다.
    const notice = (opts && opts.notice) || null;
    if (notice) {
      if (notice.kind === "moved") {
        line("*** 자리 이동 / 換桌 ***", sz("storeName", 17) + 4, 900, { align: "center" });
        line(`${notice.from} → ${notice.to}`, sz("storeName", 17) + 8, 900, { align: "center" });
        line("음식은 새 자리로", sz("tableNo", 13), 700, { align: "center" });
        line("餐點請送到新桌號", sz("tableNo", 13), 700, { align: "center" });
      } else {
        line("*** 주문 변경 / 訂單異動 ***", sz("storeName", 17) + 4, 900, { align: "center" });
        line("아래 것만 반영하세요", sz("tableNo", 13), 700, { align: "center" });
        line("僅需處理以下項目", sz("tableNo", 13), 700, { align: "center" });
      }
      divider();
    }

    line(`${storeName} ${notice ? (priceCopy ? "通知單 · 結帳" : "通知單 · 廚房") : priceCopy ? "結帳單" : "廚房出單"}`, sz("storeName", 17), wt("storeName", 900), { align: "center" });
    divider();
    row(tableLabel, orderTypeLabel(o), sz("tableNo", 13), wt("tableNo", 700));
    if (labelInfo.phoneLine) line(labelInfo.phoneLine, sz("time", 13), wt("time", 700));
    line(new Date(o.created_at.replace(" ", "T")).toLocaleString("zh-TW"), sz("time", 13), wt("time", 700));
    divider();

    o.items.forEach((it) => {
      // 변경 빌지의 각 줄은 「추가」인지 「취소」인지가 품목 이름보다 먼저
      // 읽혀야 한다. 취소를 추가로 읽으면 만들지 말아야 할 것을 만든다.
      if (it.__delta === "-") line("[취소 / 取消]", sz("itemDetail", 13), 900);
      else if (it.__delta === "+") line("[추가 / 追加]", sz("itemDetail", 13), 900);
      row(itemName(it), `x${it.qty}`, sz("itemName", 16), wt("itemName", 900));
      if (it.option_choice) line("  └ " + it.option_choice, sz("itemDetail", 13), wt("itemDetail", 400));
      // 「基本」만 안 찍는다 — 평소대로라는 뜻이라 주방에 새로 알려줄 말이
      // 없다. 사장님이 써 넣은 「基本(中辣)」는 그대로 나간다
      // (public/js/spice.js isSilentOnTicket).
      if (it.spice_choice && !window.HG_SPICE.isSilentOnTicket(it.spice_choice)) line("  └ " + it.spice_choice, sz("itemDetail", 13), wt("itemDetail", 400));
      (it.selected_addons || []).forEach((a) => line("  └ +" + a.name, sz("itemDetail", 13), wt("itemDetail", 400)));
      // 부대찌개 포장 전용 조리 여부(不煮外帶/煮熟外帶) — priceCopy 여부와
      // 무관하게 항상 찍는다(주방이 조리 전에 확인해야 하는 정보라서).
      if (it.takeout_choice) line("  └ " + it.takeout_choice, sz("itemTakeout", 13), wt("itemTakeout", 900));
      if (it.order_type === "takeout") line("  └ 外帶", sz("itemTakeout", 13), wt("itemTakeout", 900));
      // priceCopy 전용 — 주방용 사본에는 안 넣는다. 할인이 걸려 있으면
      // (特約95折/VIP9折만, 위 admin.js computeTicketDiscountInfo 주석 참고)
      // 원가→할인가로 찍는다. 사장님 피드백(2026-09-08): "크기, 두께 전부
      // 설정할 수 있잖아 영수증. 거기에 금액 버전도 설정할 수 있게 해줘" —
      // 세부사항(itemDetail)과 같이 쓰던 크기·굵기를 admin.js
      // DEFAULT_TICKET_FONT_SIZES에 새로 추가한 itemPrice/itemPriceWeight로
      // 분리해서, 결제용 금액만 따로 크게/굵게 조절할 수 있게 한다.
      if (priceCopy) {
        const amount = lineTotalOf(it);
        const isDrink = it.category_key === "drink";
        if (isDrink) hasDrinkItem = true;
        if (discount.active && discount.isPercent && !isDrink) {
          const discounted = amount - Math.round(amount * (1 - discount.rate));
          line("  └ NT$" + amount + "→NT$" + discounted, sz("itemPrice", 13), wt("itemPrice", 700));
        } else {
          const mark = discount.active && discount.isPercent && isDrink ? "※" : "";
          line("  └ NT$" + amount + mark, sz("itemPrice", 13), wt("itemPrice", 700));
        }
      }
      y += 8; // small gap between items, echoing .item-row's CSS padding
    });

    if (priceCopy && discount.active && discount.isPercent && hasDrinkItem) {
      line("※ 飲料/酒類恕不折扣", sz("itemDetail", 13), wt("itemDetail", 400));
    }
    divider();
    if (notice) {
      row("주문번호 / 單號", `#${o.id}`, sz("total", 16), wt("total", 900), { gapAfter: 6 });
      // 주방용에는 합계를 안 찍는다. 이 종이에 적힌 것은 주문 전체가 아니라
      // 바뀐 부분 뿐이라, 합계를 같이 두면 「이만큼만 받으면 되는」 것으로
      // 읽힌다.
      //
      // 결제용에는 반대로 꼭 있어야 한다 — 품목이 늘거나 빠지면 받을 돈이
      // 바뀌고, 그 새 금액을 알려주는 종이가 이것 하나뿐이다. 위의 줄들은
      // 바뀐 부분이고 이 숫자는 주문 전체라서, 라벨로 분명히 갈라 둔다.
      if (priceCopy) {
        divider();
        if (discount.active) {
          row("변경 후 전체 / 異動後合計", `NT$${o.total}→NT$${discount.discountedTotal}`, sz("total", 16), wt("total", 900), { gapAfter: 6 });
        } else {
          row("변경 후 전체 / 異動後合計", `NT$${o.total}`, sz("total", 16), wt("total", 900), { gapAfter: 6 });
        }
      }
    } else if (priceCopy && discount.active) {
      row("合計", `NT$${o.total}→NT$${discount.discountedTotal}`, sz("total", 16), wt("total", 900), { gapAfter: 6 });
    } else {
      row("合計", `NT$${o.total}`, sz("total", 16), wt("total", 900), { gapAfter: 6 });
    }
    if (priceCopy) line("※本單僅供結帳參考，實際折扣依系統結帳畫面為準", sz("orderNote", 11), wt("orderNote", 400), { align: "center" });
    // 整單備註(o.note) 입력칸은 손님 주문 화면에서 완전히 제거됐다(커밋
    // e0f1b86) — 다시는 채워지지 않으므로 렌더링을 지웠다. orderNote
    // 크기 설정 자체는 위 결제 참고 문구가 계속 쓰고 있어 그대로 둠.
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

    return rasterCanvasToEscPos(canvas, ctx);
  }

  /**
   * 자리 이동 빌지 — 2026-09-10 사장님: "자리이동하면 자리이동 빌지도 하나
   * 나왔으면 좋겠어."
   *
   * 주방과 홀에는 이미 옛 번호가 찍힌 주문서가 나가 있다. 화면에서만 바뀌면
   * 종이를 들고 다니는 사람은 그 사실을 모른다 — 그래서 종이도 한 장 나와야
   * 한다. 붙여두거나 옛 주문서 위에 얹어두는 용도라, 멀리서도 번호가 읽히게
   * 큰 글씨 두 개(옛 자리 → 새 자리)가 이 종이의 전부다.
   *
   * info = { from, to, at, partySize, partyAdults, partyChildren, note,
   *          orders: [{ id, time, summary }] }
   */
  function buildEscPosMoveSlip(info, storeName, sizes) {
    info = info || {};
    // 설정 > 인쇄 > 자리 이동 빌지에서 정한 크기·굵기(2026-09-10 사장님:
    // "이것도 설정 -> 인쇄 에서 수정할 수 있게 해줘"). 안 넘어오면 기본값 —
    // 이 파일은 서버 설정을 모르는 순수 함수로 남는다(주문서와 같은 규칙).
    const z = sizes || {};
    const sz = (k, d) => z[k] || d;
    const wt = (k, d) => z[k + "Weight"] || d;
    const orders = info.showOrders === false ? [] : info.orders || [];

    const measureCanvas = document.createElement("canvas");
    measureCanvas.width = RASTER_DOTS_WIDE;
    const mctx = measureCanvas.getContext("2d");
    const ops = [];
    let y = 24;
    const push = (op, px, gap) => {
      y += Math.round(px * PX_TO_DOTS);
      ops.push(Object.assign(op, { y }));
      y += gap;
    };
    const text = (t, px, weight, align, gap) => {
      mctx.font = rasterFont(px, weight);
      push({ type: "text", text: fitText(mctx, t, RASTER_DOTS_WIDE - RASTER_PAD * 2), px, weight, align }, px, gap);
    };
    const row = (l, r, px, weight, gap) => {
      mctx.font = rasterFont(px, weight);
      push({ type: "row", left: l, right: r, px, weight }, px, gap);
    };
    const divider = () => {
      y += 6;
      ops.push({ type: "divider", y });
      y += 14;
    };

    text(storeName || "한국관", sz("storeName", 13), wt("storeName", 400), "center", 10);
    text("자리 이동 · 換桌", sz("title", 20), wt("title", 700), "center", 16);
    divider();
    // 이 한 줄이 이 종이의 전부다. 멀리서 읽히게 제일 크게.
    text(`${info.from} → ${info.to}`, sz("tables", 34), wt("tables", 700), "center", 18);
    divider();
    row("시각 / 時間", info.at || "", sz("info", 13), wt("info", 400), 8);
    if (info.partySize) {
      // 어른(大)/아이(小)까지 적는다 — 옮긴 자리에서 아이 의자·아이 그릇을
      // 몇 개 옮겨야 하는지가 이 종이에 있어야 홀에서 다시 안 묻는다.
      // 구분이 생기기 전(2026-09-10)에 앉은 손님은 총원만 적는다.
      // 좌석번호 옆 표기(partyTag)와 같은 「(어른-아이)」 를 쓴다
      // (2026-09-10 사장님: "자리도 통일시켜줘"). 여기는 「인원 / 人數」 라는
      // 이름표가 앞에 있으므로 총원을 먼저 적는다.
      const detail = info.partyAdults == null ? "" : ` (${info.partyAdults}-${info.partyChildren || 0})`;
      row("인원 / 人數", `${info.partySize}${detail}`, sz("info", 13), wt("info", 400), 8);
    }
    if (info.note) row("", info.note, sz("info", 13), wt("info", 400), 8);
    if (orders.length) {
      divider();
      text(`옮긴 주문 / 移動訂單 ${orders.length}`, sz("orders", 13), 700, "left", 10);
      orders.forEach((o) => {
        row(`#${o.id} ${o.time || ""}`.trim(), o.summary || "", sz("orders", 13), wt("orders", 400), 6);
      });
    }
    divider();
    // 손님 폰에는 아직 옛 자리 화면이 떠 있다.
    text("손님은 새 자리 QR 로 주문", sz("footer", 14), wt("footer", 700), "center", 4);
    text("請客人改掃新桌號 QR", Math.max(8, sz("footer", 14) - 1), 400, "center", 10);

    const canvas = document.createElement("canvas");
    canvas.width = RASTER_DOTS_WIDE;
    canvas.height = y + 24;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    ctx.textBaseline = "alphabetic";
    ops.forEach((op) => {
      if (op.type === "divider") {
        ctx.fillRect(RASTER_PAD, op.y, canvas.width - RASTER_PAD * 2, 2);
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

    return rasterCanvasToEscPos(canvas, ctx);
  }

  window.buildEscPosTicket = buildEscPosTicket;
  window.buildEscPosRasterTicket = buildEscPosRasterTicket;
  window.buildEscPosMoveSlip = buildEscPosMoveSlip;
})();
