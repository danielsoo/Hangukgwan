'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/context/LanguageContext'
import { useAuth } from '@/context/AuthContext'
import { AuthShell, Divider, Field, GoogleButton, Notice, SubmitButton, isPopupCancel, useAuthError } from '@/components/account/AuthShell'

export default function SignupPage() {
  const { tr } = useLanguage()
  const { register, loginWithGoogle, methods } = useAuth()
  const errorText = useAuthError()

  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await register(form)
      window.location.href = '/account/'
    } catch (err) {
      setError(errorText((err as Error).message))
      setBusy(false)
    }
  }

  // 구글은 가입과 로그인이 같은 동작이다 — 서버가 처음 보는 계정이면
  // 만들고, 아는 계정이면 로그인시킨다(accounts.findOrCreateGoogleUser).
  const onGoogle = async () => {
    setError('')
    setBusy(true)
    try {
      await loginWithGoogle()
      window.location.href = '/account/'
    } catch (err) {
      const msg = (err as Error).message
      if (!isPopupCancel(msg)) setError(errorText(msg))
      setBusy(false)
    }
  }

  return (
    <AuthShell title={tr.auth.signupTitle} subtitle={tr.auth.signupSubtitle}>
      <Notice>{error}</Notice>
      <form onSubmit={onSubmit}>
        <Field label={tr.auth.name} value={form.name} autoComplete="name" required disabled={busy} onChange={set('name')} />
        <Field label={tr.auth.email} type="email" value={form.email} autoComplete="email" required disabled={busy} onChange={set('email')} />
        <Field label={tr.auth.password} hint={tr.auth.passwordHint} type="password" value={form.password} autoComplete="new-password" minLength={8} required disabled={busy} onChange={set('password')} />
        <Field label={tr.auth.phoneOptional} type="tel" value={form.phone} autoComplete="tel" disabled={busy} onChange={set('phone')} />
        <SubmitButton busy={busy} type="submit">{busy ? tr.auth.submitting : tr.auth.signup}</SubmitButton>
      </form>

      {methods.google ? (
        <>
          <Divider label={tr.auth.or} />
          <GoogleButton onClick={onGoogle} busy={busy} label={tr.auth.continueWithGoogle} />
        </>
      ) : null}

      <p style={{ marginTop: 22, textAlign: 'center', fontSize: 'var(--fs-sm)', color: 'var(--ink-a6)' }}>
        {tr.auth.haveAccount}{' '}
        <Link href="/login/" className="hg-link-arrow" style={{ textDecoration: 'none' }}>{tr.auth.login}</Link>
      </p>
    </AuthShell>
  )
}
