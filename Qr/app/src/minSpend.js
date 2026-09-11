// 1인당 최소 주문 금액(低消) — 얼마가 필요하고, 지금 얼마인가.
//
// 사장님(2026-09-11): "1인 1메뉴였었는데 그거 제외해주고 최소 주문금액
// 인당 200 대만 달러로 해줘. 주문금액이 인원수보다 적을때 나오는 안내문구를
// 이거로 바꿔주세요 — 大人及13歲以上兒童，每人低消200元；13歲以下免低消。"
//
// 예전 규칙은 「메뉴 개수 < 어른 수」(1인 1메뉴)였다. 이제 금액으로 센다.
//
// ── 규칙은 여기 한 곳뿐이다 ────────────────────────────────────────
//
// 손님 화면이 「얼마 필요한지」를 스스로 계산하면, 나중에 직원 화면이나
// 빌지에도 같은 계산이 한 번 더 적히게 되고 언젠가 한쪽만 고쳐진다. 그러면
// 손님 폰과 계산대가 서로 다른 금액을 말한다 — 돈 이야기라 그게 제일 나쁘다.
// 그래서 서버가 계산해서 내려보내고, 화면은 받아 적기만 한다.
//
// ── 누가 내는가 ────────────────────────────────────────────────────
//
// 어른만 센다. 사장님 문구대로 13세 이하는 免低消이고, 그래서 인원을 물을
// 때 어른 칸에 「13歲以上」이라고 적어두었다(public/order.html). 어른/아이
// 구분이 생기기 전에 앉으신 손님은 전부 어른으로 본다 — 그게 그때의
// 저장 방식이고, 0으로 두면 그 자리만 低消가 통째로 사라진다.

/** 1인당 금액. 설정이 비었거나 말이 안 되면 0 — 0이면 이 규칙을 안 쓴다. */
function perPerson(settings) {
  const n = parseInt((settings && settings.store_min_spend) || "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 低消를 내는 인원 (어른). */
function payingCount(table) {
  if (!table || !table.party_size) return 0;
  const adults = table.party_adults;
  return adults == null ? table.party_size : adults;
}

/**
 * 이 자리가 채워야 할 금액. 0이면 안내하지 않는다.
 *
 * 포장 카운터는 0이다 — QR 을 모두가 같이 쓰는 자리라 「이 자리의 인원」도
 * 「이 자리가 지금까지 쓴 돈」도 남의 것이 섞인다.
 */
function requiredFor(settings, table) {
  if (!table || table.is_counter) return 0;
  return perPerson(settings) * payingCount(table);
}

/**
 * 이 착석에서 지금까지 주문한 금액. 취소한 것은 빼고, 결제한 라운드는 넣는다.
 *
 * 결제한 것을 빼면 안 된다 — 먼저 계산하고 더 시키는 손님이 그때마다
 * 처음부터 다시 低消를 채워야 한다.
 */
function spentSoFar(orders) {
  return (orders || [])
    .filter((o) => o && o.status !== "cancelled")
    .reduce((sum, o) => sum + (Number(o.total) || 0), 0);
}

/** 모자란 금액. 다 채웠으면 0. */
function shortfall(required, spent) {
  const gap = (Number(required) || 0) - (Number(spent) || 0);
  return gap > 0 ? gap : 0;
}

module.exports = { perPerson, payingCount, requiredFor, spentSoFar, shortfall };
