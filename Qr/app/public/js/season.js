// Swaps every <img data-taegeuk-seasonal> to the taegeuk artwork for a given
// season (public/images/taegeuk-<season>.png — 봄 벚꽃 / 여름 파라솔 / 가을
// 낙엽 / 겨울 눈, see public/images/taegeuk.png for the plain year-round
// mark). Callers (order.js / admin.js) call applyTaegeukSeason(mode) once
// they know the admin's setting, right after fetching /api/settings — this
// file doesn't fetch anything itself.
//
// mode is one of:
//   "auto"                        - pick the season from today's date
//   "spring" | "summer" | "autumn" | "winter"  - admin forced this one,
//                                    regardless of the real calendar month
//                                    (Admin > 설정 > 손님 화면 상단 사진)
//   "off" (or anything else)      - always show the plain taegeuk.png
//
// The QR code's own center logo (src/qr.js) is intentionally untouched by
// this — it always uses the plain taegeuk.png / whatever the admin uploaded
// as 매장 로고.
(function () {
  var SEASONS = ["spring", "summer", "autumn", "winter"];

  function currentSeason(date) {
    var m = (date || new Date()).getMonth() + 1; // 1-12
    if (m >= 3 && m <= 5) return "spring";
    if (m >= 6 && m <= 8) return "summer";
    if (m >= 9 && m <= 11) return "autumn";
    return "winter";
  }

  function applyTaegeukSeason(mode) {
    var season = mode === "auto" || !mode ? currentSeason() : SEASONS.indexOf(mode) !== -1 ? mode : null;
    var src = season ? "/images/taegeuk-" + season + ".png" : "/images/taegeuk.png";
    var els = document.querySelectorAll("[data-taegeuk-seasonal]");
    for (var i = 0; i < els.length; i++) {
      els[i].src = src;
    }
  }

  window.currentTaegeukSeason = currentSeason;
  window.applyTaegeukSeason = applyTaegeukSeason;
})();
