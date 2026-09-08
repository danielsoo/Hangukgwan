// "이 요청을 보낸 손님이 누구인가" 를 한 곳에서 정한다.
//
// 손님을 알아보는 방법이 지금 두 가지다:
//   1. 홈페이지 통합 로그인 세션 (src/accounts.js, req.session.userId)
//      — 이메일이든 구글이든 계정 하나로 로그인한 상태.
//   2. Firebase ID 토큰 (Authorization: Bearer …)
//      — VIP 회원 기능을 처음 만들 때 쓰던 방식. 주문 화면(public/js/order.js)이
//        아직 이 방식으로 동작하고 있어서 그대로 살려둔다. 이걸 끊으면 이미
//        카드를 등록해 쓰고 계신 손님들의 할인이 그날로 멈춘다.
//
// 세션이 있으면 세션을 쓴다(더 최신이고, 이메일 가입자까지 포함한다).
// 세션이 없을 때만 토큰을 본다. 둘 다 없으면 null — 로그인 안 한 손님이고,
// 그건 오류가 아니라 가장 흔한 정상 상태다(대부분의 손님은 그냥 주문한다).
const accounts = require("./accounts");
const { verifyIdToken } = require("./firebaseAdmin");

/**
 * @returns {Promise<{accountId: string|null, googleUid: string|null, name: string, email: string|null} | null>}
 */
async function resolveCustomer(req) {
  if (req.session && req.session.userId) {
    const user = await accounts.findById(req.session.userId);
    if (user) {
      return {
        accountId: String(user._id),
        googleUid: user.google_uid || null,
        name: user.name || "",
        email: user.email || null,
      };
    }
  }

  const header = (req.headers && req.headers.authorization) || "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (idToken) {
    const firebaseUser = await verifyIdToken(idToken);
    if (firebaseUser) {
      // 이 구글 계정으로 이미 통합 계정이 만들어져 있으면 그 계정으로 취급한다
      // — 같은 사람인데 등록한 카드가 안 보이는 일이 없도록.
      const linked = await accounts.findByGoogleUid(firebaseUser.uid);
      return {
        accountId: linked ? String(linked._id) : null,
        googleUid: firebaseUser.uid,
        name: (linked && linked.name) || firebaseUser.name || "",
        email: (linked && linked.email) || firebaseUser.email || null,
      };
    }
  }

  return null;
}

module.exports = { resolveCustomer };
