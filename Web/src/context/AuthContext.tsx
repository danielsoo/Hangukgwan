'use client'

// 홈페이지의 로그인 상태. 손님·직원·사장이 같은 계정 체계를 쓰고
// (Qr/app/src/accounts.js), user.isAdmin 하나로 헤더에 "관리자" 버튼을
// 보여줄지가 갈린다.
//
// API 경로는 전부 같은 오리진의 /api/... 를 쓴다. 이 사이트와 주문
// 시스템이 각각 다른 Vercel 프로젝트인 지금은 vercel.json 의 rewrite 가
// /api/* 를 주문 시스템으로 넘겨주고, 나중에 커스텀 도메인 하나로 합쳐도
// 코드는 그대로 동작한다(src/lib/config.ts 주석 참고).
//
// 인증은 서버가 내려주는 세션 쿠키로만 이뤄진다 — 토큰을 localStorage에
// 넣지 않는다. 쿠키는 httpOnly라 페이지에 끼어든 스크립트가 훔쳐갈 수 없다.
//
// ⚠️ 여기 isAdmin 은 화면을 어떻게 그릴지 정하는 힌트일 뿐이다. 실제 차단은
// 서버의 requireAdmin/requireOwner(Qr/app/src/auth.js)가 한다 — 브라우저에서
// 이 값을 조작해도 관리자 API는 열리지 않는다.

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

export interface AccountUser {
  id: string
  email: string | null
  name: string
  phone: string | null
  role: 'customer' | 'staff' | 'owner'
  isAdmin: boolean
  hasPassword: boolean
  hasGoogle: boolean
}

interface AuthContextValue {
  user: AccountUser | null
  loading: boolean
  methods: { email: boolean; google: boolean }
  /** 기존 비밀번호 로그인(관리자 전용)으로 들어온 세션 — 계정 정보는 없다 */
  legacyAdmin: boolean
  login: (email: string, password: string) => Promise<void>
  register: (input: { email: string; password: string; name: string; phone?: string }) => Promise<void>
  loginWithGoogle: () => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** 서버가 돌려주는 error 코드를 그대로 Error.message 로 던진다 — 화면에서
 *  언어별 문구로 바꾼다(locales 의 auth.errors). */
async function postJson(url: string, body?: unknown) {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    // 서버에 아예 닿지 못한 경우(네트워크가 끊겼거나, 로컬에서 홈페이지만
    // 띄워 API 주소가 안 맞거나). 이걸 그냥 server_error 로 뭉뚱그리면
    // 화면에는 "문제가 발생했습니다" 만 뜨고, 손님은 비밀번호를 다시
    // 치면서 몇 번이고 같은 화면을 보게 된다.
    throw new Error('network_error')
  }
  // API 자체가 없는 주소(로컬에서 홈페이지 포트로 보낸 경우)는 404 와
  // 함께 HTML 이 온다 — JSON 이 아니므로 아래 파싱이 비게 되고, 그러면
  // 원인이 화면에서 사라진다. 그 경우를 따로 알려준다.
  const contentType = res.headers.get('content-type') || ''
  if (!res.ok && !contentType.includes('application/json')) {
    throw new Error(res.status === 404 ? 'api_not_found' : 'network_error')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'server_error')
  return data
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AccountUser | null>(null)
  const [legacyAdmin, setLegacyAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [methods, setMethods] = useState({ email: true, google: false })

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/account/me', { credentials: 'same-origin' })
      const data = await res.json()
      setUser(data.user || null)
      setLegacyAdmin(!!data.legacyPasswordLogin)
    } catch {
      // 서버가 잠깐 안 되더라도 "로그인 안 됨"으로 두는 편이 낫다 — 어차피
      // 보호된 동작은 서버가 다시 막는다.
      setUser(null)
      setLegacyAdmin(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    fetch('/api/account/methods', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((m) => setMethods({ email: m.email !== false, google: !!m.google }))
      .catch(() => {})
  }, [refresh])

  const login = useCallback(async (email: string, password: string) => {
    const data = await postJson('/api/account/login', { email, password })
    setUser(data.user)
    setLegacyAdmin(false)
  }, [])

  const register = useCallback(async (input: { email: string; password: string; name: string; phone?: string }) => {
    const data = await postJson('/api/account/register', input)
    setUser(data.user)
    setLegacyAdmin(false)
  }, [])

  // 구글 로그인은 브라우저에서 Firebase로 본인 확인을 받은 뒤 그 ID 토큰을
  // 서버에 한 번만 넘긴다. 그 뒤로는 이 앱의 세션 쿠키가 신분증이라 화면
  // 어디서도 Firebase 토큰을 들고 다니지 않는다.
  const loginWithGoogle = useCallback(async () => {
    const { signInWithGooglePopup } = await import('@/lib/firebaseClient')
    const idToken = await signInWithGooglePopup()
    const data = await postJson('/api/account/google', { idToken })
    setUser(data.user)
    setLegacyAdmin(false)
  }, [])

  const logout = useCallback(async () => {
    await postJson('/api/account/logout')
    setUser(null)
    setLegacyAdmin(false)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, methods, legacyAdmin, login, register, loginWithGoogle, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}
