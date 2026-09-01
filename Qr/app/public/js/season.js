// Swaps every <img data-taegeuk-seasonal> to the taegeuk artwork matching
// today's calendar season (public/images/taegeuk-<season>.png — 봄 벚꽃 /
// 여름 파라솔 / 가을 낙엽 / 겨울 눈, see public/images/taegeuk.png for the
// plain year-round mark) — or back to the plain mark when the admin has
// turned this off (Admin > 설정 > 손님 화면 상단 사진 > "계절에 맞게 태극
// 무늬 자동으로 바꾸기"). Callers (order.js / admin.js) call
// applyTaegeukSeason(enabled) once they know that setting, right after
// fetching /api/settings — this file doesn't fetch anything itself. Runs on
// the customer's own device clock. The QR code's own center logo
// (src/qr.js) is intentionally untouched by this — it always uses the plain
// taegeuk.png / whatever the admin uploaded as 매장 로고.
(function () {
  function currentSeason(date) {
    var m = (date || new Date()).getMonth() + 1; // 1-12
    if (m >= 3 && m <= 5) return "spring";
    if (m >= 6 && m <= 8) return "summer";
    if (m >= 9 && m <= 11) return "autumn";
    return "winter";
  }

  function applyTaegeukSeason(enabled) {
    var src = enabled === false ? "/images/taegeuk.png" : "/images/taegeuk-" + currentSeason() + ".png";
    var els = document.querySelectorAll("[data-taegeuk-seasonal]");
    for (var i = 0; i < els.length; i++) {
      els[i].src = src;
    }
  }

  window.currentTaegeukSeason = currentSeason;
  window.applyTaegeukSeason = applyTaegeukSeason;
})();
