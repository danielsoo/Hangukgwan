'use client'

// 로그인·회원가입·내 계정 화면이 공유하는 껍데기와 폼 조각들.
// 이 사이트는 CSS 변수(--bg/--ink/--gold-a18 …)와 hg-* 클래스로 라이트/다크
// 두 테마를 함께 쓰므로, 색을 직접 쓰지 않고 전부 변수로만 표현한다.
import Link from 'next/link'
import { useLanguage } from '@/context/LanguageContext'

export function AuthShell({
  title,
  subtitle,
  children,
  wide,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  wide?: boolean
}) {
  const { tr } = useLanguage()
  return (
    <main style={{ minHeight: '70vh', padding: 'clamp(32px, 8vw, 72px) clamp(14px, 4vw, 48px)' }}>
      <div style={{ maxWidth: wide ? 720 : 440, margin: '0 auto' }}>
        <h1
          style={{
            fontFamily: "'Newsreader', serif",
            fontSize: 'var(--fs-title)',
            color: 'var(--ink)',
            margin: 0,
            letterSpacing: '0.01em',
          }}
        >
          {title}
        </h1>
        {subtitle ? (
          <p style={{ color: 'var(--ink-a6)', fontSize: 'var(--fs-sm)', margin: '10px 0 0', lineHeight: 1.6 }}>{subtitle}</p>
        ) : null}
        <div
          style={{
            marginTop: 28,
            padding: 'clamp(20px, 5vw, 30px)',
            background: 'var(--panel)',
            border: '1px solid var(--gold-a18)',
          }}
        >
          {children}
        </div>
        <p style={{ marginTop: 22, fontSize: 'var(--fs-sm)' }}>
          <Link href="/" className="hg-link-arrow" style={{ textDecoration: 'none' }}>
            ← {tr.auth.backHome}
          </Link>
        </p>
      </div>
    </main>
  )
}

export function Field({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label style={{ display: 'block', marginBottom: 16 }}>
      <span
        style={{
          display: 'block',
          fontSize: 'var(--fs-xs)',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
          marginBottom: 7,
        }}
      >
        {label}
      </span>
      <input
        {...props}
        style={{
          width: '100%',
          padding: '11px 13px',
          background: 'var(--field)',
          border: '1px solid var(--gold-a22)',
          color: 'var(--ink)',
          fontSize: 'var(--fs-base)',
          fontFamily: 'inherit',
          outline: 'none',
        }}
      />
      {hint ? <span style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginTop: 6 }}>{hint}</span> : null}
    </label>
  )
}

export function SubmitButton({
  busy,
  children,
  ...props
}: { busy?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      disabled={busy || props.disabled}
      className="hg-cta-solid"
      style={{
        width: '100%',
        padding: '12px 0',
        border: 'none',
        fontSize: 'var(--fs-sm)',
        letterSpacing: '0.04em',
        fontFamily: 'inherit',
        opacity: busy || props.disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  )
}

export function Notice({ kind = 'error', children }: { kind?: 'error' | 'ok' | 'info'; children?: React.ReactNode }) {
  if (!children) return null
  const border = kind === 'error' ? 'var(--accent)' : kind === 'ok' ? 'var(--status-open)' : 'var(--gold-a3)'
  return (
    <p
      role={kind === 'error' ? 'alert' : undefined}
      style={{
        margin: '0 0 16px',
        padding: '10px 12px',
        borderLeft: `2px solid ${border}`,
        background: 'var(--scrim-20)',
        color: 'var(--ink2)',
        fontSize: 'var(--fs-sm)',
        lineHeight: 1.6,
      }}
    >
      {children}
    </p>
  )
}

export function GoogleButton({ onClick, busy, label }: { onClick: () => void; busy?: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="hg-cta-outline"
      style={{
        width: '100%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 9,
        padding: '11px 0',
        background: 'none',
        fontSize: 'var(--fs-sm)',
        fontFamily: 'inherit',
        cursor: 'pointer',
        opacity: busy ? 0.6 : 1,
      }}
    >
      <svg width="15" height="15" viewBox="0 0 18 18" aria-hidden="true">
        <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
        <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
        <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
        <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
      </svg>
      {label}
    </button>
  )
}

export function Divider({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
      <span style={{ flex: 1, height: 1, background: 'var(--gold-a18)' }} />
      <span style={{ fontSize: 'var(--fs-xs)', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</span>
      <span style={{ flex: 1, height: 1, background: 'var(--gold-a18)' }} />
    </div>
  )
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontSize: 'var(--fs-xs)',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--muted)',
        margin: '0 0 16px',
        fontWeight: 400,
      }}
    >
      {children}
    </h2>
  )
}

/** Firebase SDK 가 던지는 오류는 우리 서버의 코드가 아니라
 *  "Firebase: Error (auth/unauthorized-domain)." 같은 문장으로 온다.
 *  그중 설정이 덜 끝났을 때 실제로 마주치는 것들만 우리 문구로 옮긴다. */
const FIREBASE_ERRORS: Record<string, string> = {
  'auth/unauthorized-domain': 'google_domain_not_authorized',
  'auth/operation-not-allowed': 'google_not_enabled',
  'auth/popup-blocked': 'google_popup_blocked',
  'auth/network-request-failed': 'network_failed',
}

/** 서버가 준 error 코드를 현재 언어 문구로. 모르는 코드는 일반 오류로
 *  떨어뜨린다 — 사용자에게 영문 코드가 그대로 보이는 일이 없게.
 *
 *  2026-09-08: Firebase 설정을 끝내는 동안 실제로 겪은 문제 —
 *  승인된 도메인에 주소를 안 넣은 상태에서 구글 버튼을 누르면 화면에는
 *  "문제가 발생했습니다. 잠시 후 다시 시도해 주세요." 만 떴다. 무엇을
 *  해야 하는지는 브라우저 콘솔에만 있었고, 그건 사장님이 열어볼 곳이
 *  아니다. 설정이 덜 끝나서 나는 오류는 화면이 직접 알려줘야 한다. */
export function useAuthError() {
  const { tr } = useLanguage()
  return (code?: string | null) => {
    if (!code) return ''
    const errors = tr.auth.errors as unknown as Record<string, string>
    if (errors[code]) return errors[code]
    const fb = code.match(/auth\/[a-z-]+/i)
    if (fb && FIREBASE_ERRORS[fb[0]]) return errors[FIREBASE_ERRORS[fb[0]]] || errors.server_error
    return errors.server_error
  }
}

/** 구글 팝업을 사용자가 그냥 닫은 것은 오류가 아니라 취소다 — 빨간 경고를
 *  띄우면 뭔가 잘못된 줄 알게 된다.
 *
 *  popup-blocked 는 여기 넣지 않는다. 사용자가 닫은 게 아니라 브라우저가
 *  막은 것이고, 아무 말 없이 넘어가면 "버튼을 눌러도 아무 일이 없다" 가
 *  된다 — 팝업을 허용하라고 알려줘야 한다(google_popup_blocked). */
export function isPopupCancel(message: string) {
  return /popup-closed|popup_closed|cancelled|canceled/i.test(message)
}
