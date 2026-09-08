// 주문 시스템(Qr/app — 로그인, 관리자 화면, 테이블/카운터 주문)이 어디에
// 있는지.
//
// 2026-09-08부터 홈페이지와 주문 시스템은 **같은 주소**에서 서빙된다
// (Qr/app/src/site.js 주석에 배경 설명). 그래서 기본값이 절대 URL이 아니라
// 같은 출처의 경로다 — 링크를 눌러도 다른 도메인으로 넘어가지 않고, 세션
// 쿠키가 그대로 따라간다.
//
// 예전에는 여기가 'https://hangukgwan.vercel.app' 이었다. 그 탓에 헤더의
// 관리 버튼, 히어로의 QR 주문, 푸터 링크가 전부 홈페이지 밖으로 나갔고,
// 넘어간 쪽에서는 로그인 세션이 없어서 다시 로그인해야 했다.
//
// 나중에 관리자만 별도 도메인(예: admin.가게도메인)으로 떼어내고 싶으면
// NEXT_PUBLIC_QR_APP_URL 을 그 주소로 두면 된다 — 단, 그때는 두 주소가
// 같은 상위 도메인 아래에 있어야 로그인이 공유된다.
const QR_APP_BASE_URL = process.env.NEXT_PUBLIC_QR_APP_URL || ''

// "온라인 주문" — 매장 테이블이 아니라 포장 카운터.
export const ORDER_URL = `${QR_APP_BASE_URL}/t/COUNTER`

// 관리자 화면. 사장/직원 계정에만 링크를 보여준다(Header.tsx, account/page.tsx).
export const ADMIN_URL = `${QR_APP_BASE_URL}/admin`
