// 화면이 실제로 기다린 시간. 손님 화면과 관리자 화면이 같이 쓴다.
//
// 2026-09-12 사장님: "그럼 모든 행동이 이제 다 로그로 남는거지?"
//
// 처음에는 관리자 화면에만 넣었다. 그런데 「영업에 지장」은 손님 쪽에서도
// 똑같이 생긴다 — QR 을 찍고 메뉴가 안 뜨거나, 주문 담기가 멎으면 그게
// 제일 크다. 게다가 느린 원인을 찾는 데 손님 쪽 숫자가 더 중요할 수도
// 있다: 태블릿은 가게 와이파이지만 손님 폰은 통신사 망이라, 같은 서버라도
// 걸리는 시간이 다르다.
//
// 그래서 재는 코드를 한 곳에 두고 양쪽이 부른다. 두 벌로 두면 한쪽만
// 고쳐져서 조용히 어긋난다.
//
// ── 무엇을 재나 ──────────────────────────────────────────────────────
//
//  1. /api 요청 하나하나 — 화면이 기다린 시간 (서버가 자기 시계로 못 보는
//     구간: 폰에서 서울까지, 연결 맺기, 함수가 깨어나는 시간이 여기 들어간다)
//  2. **누른 것 하나가 끝날 때까지** — 누른 순간부터, 그 사이 나간 요청이
//     전부 끝나고 화면을 한 번 더 그릴 때까지. 요청이 없었으면 그리는 시간만.
//
// 2번이 사람이 실제로 기다린 시간이다. 1번만 재면 「주문 담기」 한 번이
// 요청 세 줄로 흩어져서, 정작 기다린 시간이 어디에도 안 남는다.
//
// ── 어떻게 보내나 ────────────────────────────────────────────────────
//
// **따로 요청을 만들지 않는다.** 그러면 바쁠 때 요청이 더 늘어나는데,
// 하필 바쁠 때가 보려는 순간이다. 다음 요청의 헤더(X-Client-Timing)에 얹는다.
// 헤더에는 ASCII 만 담을 수 있어서 아닌 글자는 털어낸다 — 한 번이라도
// 섞이면 그 순간부터 그 기기의 모든 요청이 죽는다.
(function () {
  if (window.HG_TIMING) return; // 두 번 걸면 시간이 두 겹으로 세어진다

  var MAX_ENTRIES = 25;
  var MAX_BYTES = 1400;
  var ACTION_SETTLE_MS = 120; // 이만큼 조용하면 끝난 것으로 본다
  var ACTION_MAX_MS = 20000; // 영영 안 끝나는 것을 막는다

  var entries = [];
  var action = null;

  function ascii(s) {
    return String(s == null ? "" : s).replace(/[^\x20-\x7E]/g, "");
  }

  /** /api/orders/123 → /api/orders/:id — 숫자가 낀 주소를 한 줄로 모은다. */
  function routeOf(url) {
    return ascii(url)
      .split("?")[0]
      .split("/")
      .map(function (seg) {
        return /^\d+$/.test(seg) ? ":id" : seg;
      })
      .join("/");
  }

  function note(label, ms, status) {
    try {
      if (!label) return;
      entries.push(ascii(label) + "|" + Math.round(ms) + "|" + (status || 0));
      if (entries.length > MAX_ENTRIES) entries.shift();
    } catch (e) {
      // 재는 것이 화면을 막지 않는다.
    }
  }

  /** 다음 요청에 얹을 헤더 값. 담아둔 것은 가져가면서 비운다. */
  function header() {
    if (!entries.length) return null;
    var out = "";
    while (entries.length) {
      var next = out ? out + ";" + entries[0] : entries[0];
      if (next.length > MAX_BYTES) break;
      out = next;
      entries.shift();
    }
    return out || null;
  }

  // ── 누른 것 하나 ──────────────────────────────────────────────────
  function labelOfClick(el) {
    var node = el && el.closest
      ? el.closest("button, a, [data-tab], [data-pane], .tab-btn, .order-card, .menu-item, input[type=checkbox]")
      : null;
    if (!node) return null;
    var label;
    if (node.dataset && node.dataset.tab) label = "tab:" + node.dataset.tab;
    else if (node.dataset && node.dataset.pane) label = "pane:" + node.dataset.pane;
    else if (node.id) label = "#" + node.id;
    else if (node.className && typeof node.className === "string") label = "." + node.className.trim().split(/\s+/)[0];
    else label = node.tagName.toLowerCase();
    return ascii(label).slice(0, 60) || null;
  }

  function finishAction() {
    if (!action || action.done) return;
    action.done = true;
    var a = action;
    action = null;
    clearTimeout(a.settleTimer);
    note("click:" + a.label, Date.now() - a.t0, a.reqs);
  }

  function maybeFinishAction() {
    if (!action || action.done || action.inflight > 0) return;
    // 요청이 다 끝났다. 화면을 한 번 더 그릴 시간을 주고, 그 사이 새 요청이
    // 안 나가면 끝난 것으로 본다. 응답을 받고 **그 뒤에** 다음 요청을 보내는
    // 자리가 많아서(결제 완료 → 목록 새로고침), 여기서 끊으면 한 번의
    // 누름이 두 줄로 쪼개진다.
    clearTimeout(action.settleTimer);
    var a = action;
    a.settleTimer = setTimeout(function () {
      if (action !== a || a.done || a.inflight > 0) return;
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(finishAction);
      else finishAction();
    }, ACTION_SETTLE_MS);
  }

  function beginRequest() {
    if (!action || action.done) return null;
    clearTimeout(action.settleTimer);
    action.inflight++;
    action.reqs++;
    return action;
  }

  function endRequest(owner) {
    if (!owner || owner.done) return;
    owner.inflight--;
    if (action === owner) maybeFinishAction();
  }

  document.addEventListener(
    "click",
    function (e) {
      var label = labelOfClick(e.target);
      if (!label) return;
      // 앞엣것이 아직 안 끝났으면 거기서 끊는다 — 두 번 누른 것은 두 번이다.
      finishAction();
      action = { label: label, t0: Date.now(), inflight: 0, reqs: 0, done: false, settleTimer: null };
      var a = action;
      // 요청이 하나도 안 나가는 누름(탭 전환 등)도 끝이 있어야 한다.
      setTimeout(function () {
        if (action === a) maybeFinishAction();
      }, 0);
      setTimeout(function () {
        if (action === a) finishAction();
      }, ACTION_MAX_MS);
    },
    true // capture — 화면이 stopPropagation() 해도 놓치지 않는다
  );

  /**
   * window.fetch 를 감싸 /api 요청을 재게 한다.
   *
   * 관리자 화면은 자기 몫의 감싸기가 따로 있다(소켓 번호, 로그인 때 한 번에
   * 받아둔 답). 이것을 **먼저** 걸고 그 위에 감싸므로, 캐시로 끝난 요청은
   * 여기까지 오지 않는다 — 네트워크에 안 나갔으니 그게 맞다.
   */
  function installFetchWrapper() {
    if (window.__hgTimingFetch) return;
    window.__hgTimingFetch = true;
    var nativeFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      if (url.indexOf("/api/") !== 0) return nativeFetch(input, init);

      var t0 = Date.now();
      var owner = beginRequest();
      var route = routeOf(url);
      function done(status) {
        note(route, Date.now() - t0, status);
        endRequest(owner);
      }
      var opts = init;
      try {
        var h = header();
        if (h) {
          opts = Object.assign({}, init);
          var headers = new Headers(
            (init && init.headers) || (typeof input === "object" && input && input.headers) || undefined
          );
          headers.set("X-Client-Timing", h);
          opts.headers = headers;
        }
      } catch (e) {
        opts = init; // 헤더를 못 붙여도 요청 자체는 나가야 한다
      }
      return nativeFetch(input, opts).then(
        function (res) {
          done(res && res.status);
          return res;
        },
        function (err) {
          // 실패한 요청이야말로 오래 걸린다. 빠뜨리면 제일 나쁜 순간이 빠진다.
          done(0);
          throw err;
        }
      );
    };
  }

  window.HG_TIMING = { note: note, header: header, routeOf: routeOf, installFetchWrapper: installFetchWrapper };
  installFetchWrapper();
})();
