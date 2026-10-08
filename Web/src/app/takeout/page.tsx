'use client'

import { useEffect, useState } from 'react'
import { AuthShell, Notice } from '@/components/account/AuthShell'
import { useAuth } from '@/context/AuthContext'
import { useLanguage } from '@/context/LanguageContext'

export default function TakeoutGatePage() {
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const [error, setError] = useState('')

  useEffect(() => {
    if (loading) return
    if (!user) {
      window.location.replace('/login/?next=%2Ftakeout%2F')
      return
    }

    let cancelled = false
    fetch('/api/tables/counter-link', { credentials: 'same-origin' })
      .then(async (res) => {
        if (res.status === 401) {
          window.location.replace('/login/?next=%2Ftakeout%2F')
          return null
        }
        const data = await res.json().catch(() => ({}))
        if (!res.ok || typeof data.path !== 'string') throw new Error('takeout_unavailable')
        return data.path as string
      })
      .then((path) => {
        if (!cancelled && path) window.location.replace(path)
      })
      .catch(() => {
        if (!cancelled) setError(tr.auth.takeoutGateError)
      })

    return () => {
      cancelled = true
    }
  }, [loading, user, tr.auth.takeoutGateError])

  return (
    <AuthShell title={tr.auth.takeoutGateTitle} subtitle={tr.auth.takeoutGateBody}>
      <Notice>{error}</Notice>
      {!error ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--ink-a6)', fontSize: 'var(--fs-sm)' }}>
          <span className="hg-takeout-loader" aria-hidden="true" />
          <span>{tr.auth.loading}</span>
        </div>
      ) : (
        <button type="button" className="hg-cta-outline-gold" onClick={() => window.location.reload()} style={{ width: '100%', padding: '12px 18px', background: 'transparent', font: 'inherit', cursor: 'pointer' }}>
          {tr.hero.cta2}
        </button>
      )}
    </AuthShell>
  )
}
