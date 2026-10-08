const DEFAULT_RETURN_PATH = '/account/'

/** 로그인 뒤 돌아갈 곳은 이 사이트 안의 절대 경로만 받는다. `//evil.com` 과
 *  역슬래시는 브라우저에서 외부 주소로 정규화될 수 있어 받지 않는다. */
export function safeReturnPath(raw: string | null | undefined, fallback = DEFAULT_RETURN_PATH) {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback
  return raw
}

export function returnPathFromLocation(fallback = DEFAULT_RETURN_PATH) {
  if (typeof window === 'undefined') return fallback
  return safeReturnPath(new URLSearchParams(window.location.search).get('next'), fallback)
}

export function authHref(path: '/login/' | '/signup/', returnPath: string) {
  return returnPath === DEFAULT_RETURN_PATH ? path : `${path}?next=${encodeURIComponent(returnPath)}`
}
