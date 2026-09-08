// 구글 로그인용 Firebase 클라이언트 — npm 의존성으로 넣지 않고 필요한
// 순간에 CDN에서 불러온다. 주문 화면(public/js/order.js 의 loadFirebaseSdk)이
// 쓰는 방식과 똑같이 맞춘 것이고, 이유도 같다:
//
//  1) 홈페이지를 그냥 구경만 하는 사람(대부분)은 로그인 버튼을 누르지 않는다.
//     Firebase SDK는 수백 KB라, 번들에 정적으로 넣으면 모든 방문자가
//     안 쓸 코드를 내려받게 된다. 사장님이 예전에 지적한 "링크 타고
//     들어가는 속도가 느려" 문제와 같은 종류다.
//  2) 이 가게의 Firebase 설정은 서버 설정값(store.settings.firebase_web_config,
//     Admin > 설정 > 회원(VIP) 로그인)에 들어 있어서 빌드 시점에는 알 수 없다.
//     실행 시점에 /api/settings 에서 받아와야 한다.
//  3) 사장님이 Firebase 설정을 아직 안 끝냈으면 이 파일은 아무것도 하지
//     않고, 홈페이지는 이메일 로그인만으로 정상 동작한다.
//
// firebaseConfig(웹 config)는 비밀이 아니다 — 어느 Firebase 프로젝트에
// 요청하는지를 가리키는 이름표일 뿐이고, 실제 신뢰 판단은 서버가
// ID 토큰을 검증하면서 한다(src/firebaseAdmin.js).

const FIREBASE_VERSION = '10.14.1'

declare global {
  interface Window {
    firebase?: any
  }
}

let sdkPromise: Promise<void> | null = null
let authInstance: any = null

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = src
    el.onload = () => resolve()
    el.onerror = () => reject(new Error('firebase_sdk_load_failed'))
    document.head.appendChild(el)
  })
}

function loadSdk(): Promise<void> {
  if (window.firebase) return Promise.resolve()
  if (sdkPromise) return sdkPromise
  sdkPromise = loadScript(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app-compat.js`).then(() =>
    loadScript(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth-compat.js`)
  )
  return sdkPromise
}

async function getAuth() {
  if (authInstance) return authInstance

  const res = await fetch('/api/settings', { credentials: 'same-origin' })
  const settings = await res.json().catch(() => ({}))
  const raw = settings.firebase_web_config
  if (!raw) throw new Error('google_login_not_configured')

  let config: Record<string, unknown>
  try {
    config = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    throw new Error('google_login_not_configured')
  }

  await loadSdk()
  if (!window.firebase) throw new Error('firebase_sdk_load_failed')

  // 주문 화면이 같은 페이지에서 이미 초기화해뒀을 수도 있어서 재사용한다
  // (같은 프로젝트에 initializeApp을 두 번 부르면 예외가 난다).
  const fb = window.firebase
  if (!fb.apps || !fb.apps.length) fb.initializeApp(config)
  authInstance = fb.auth()
  return authInstance
}

/** 구글 팝업으로 로그인하고 Firebase ID 토큰을 돌려준다. 이 토큰은 서버로
 *  한 번 보내져 검증되고(POST /api/account/google), 그 뒤로는 이 앱의 세션
 *  쿠키가 신분증 역할을 한다. */
export async function signInWithGooglePopup(): Promise<string> {
  const auth = await getAuth()
  const provider = new window.firebase!.auth.GoogleAuthProvider()
  const result = await auth.signInWithPopup(provider)
  const idToken = await result.user.getIdToken()

  // 서버 세션이 생기고 나면 브라우저 쪽 Firebase 로그인 상태는 더 이상
  // 필요 없다. 남겨두면 로그아웃했을 때 한쪽만 끊겨서 "로그아웃했는데도
  // 구글 계정이 그대로 붙어 있는" 혼란이 생긴다.
  try {
    await auth.signOut()
  } catch {
    /* 정리 실패는 로그인 자체와 무관하므로 무시 */
  }

  return idToken
}
