'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/context/LanguageContext'
import { useAuth } from '@/context/AuthContext'
import { AuthShell, Divider, Field, GoogleButton, Notice, SubmitButton, isPopupCancel, useAuthError } from '@/components/account/AuthShell'

export default function LoginPage() {
  const { tr } = useLanguage()
  const { login, loginWithGoogle, methods } = useAuth()
  const errorText = useAuthError()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // 로그인 후에는 관리자든 손님이든 내 계정 화면으로 보낸다. 관리자는
  // 거기(그리고 헤더)에서 "관리자" 버튼을 보게 된다 — 로그인하자마자
  // 관리자 화면으로 튕겨버리면 손님으로서의 내 계정을 볼 방법이 없어진다.
  const done = () => {
    window.location.href = '/account/'
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(email, password)
      done()
    } catch (err) {
      setError(errorText((err as Error).message))
      setBusy(false)
    }
  }

  const onGoogle = async () => {
    setError('')
    setBusy(true)
    try {
      await loginWithGoogle()
      done()
    } catch (err) {
      const msg = (err as Error).message
      if (!isPopupCancel(msg)) setError(errorText(msg))
      setBusy(false)
    }
  }

  return (
    <AuthShell title={tr.auth.loginTitle} subtitle={tr.auth.loginSubtitle}>
      <Notice>{error}</Notice>
      <form onSubmit={onSubmit}>
        <Field label={tr.auth.email} type="email" value={email} autoComplete="email" required disabled={busy} onChange={(e) => setEmail(e.target.value)} />
        <Field label={tr.auth.password} type="password" value={password} autoComplete="current-password" required disabled={busy} onChange={(e) => setPassword(e.target.value)} />
        <SubmitButton busy={busy} type="submit">{busy ? tr.auth.submitting : tr.auth.login}</SubmitButton>
      </form>

      {methods.google ? (
        <>
          <Divider label={tr.auth.or} />
          <GoogleButton onClick={onGoogle} busy={busy} label={tr.auth.continueWithGoogle} />
        </>
      ) : null}

      <p style={{ marginTop: 22, textAlign: 'center', fontSize: 'var(--fs-sm)', color: 'var(--ink-a6)' }}>
        {tr.auth.noAccount}{' '}
        <Link href="/signup/" className="hg-link-arrow" style={{ textDecoration: 'none' }}>{tr.auth.signup}</Link>
      </p>
    </AuthShell>
  )
}
