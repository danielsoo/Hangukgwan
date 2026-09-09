'use client'

// 내 계정 — 손님이든 관리자든 같은 화면을 보고, 관리자(owner/staff) 계정에만
// "관리자" 버튼이 하나 더 붙는다. 사장님 요청의 핵심.
//
// 여기서 VIP 카드 등록과 주문 내역까지 한 화면에서 처리한다. 셋 다 같은
// 세션 쿠키로 동작하므로 손님이 로그인을 여러 번 할 필요가 없다.
import { useCallback, useEffect, useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useAuth } from '@/context/AuthContext'
import { ADMIN_URL } from '@/lib/config'
import { AuthShell, Field, Notice, SectionTitle, SubmitButton, useAuthError } from '@/components/account/AuthShell'

interface Membership {
  card_number: string
  discount_percent: number
  issue_date: string
  expiry_date: string | null
  active: boolean
}

interface OrderItem {
  name_zh?: string
  name_ko?: string
  name_en?: string
  qty: number
}

interface OrderRow {
  id: number
  table_number: string
  pickup_number: string | null
  status: string
  total: number
  vip_discount_percent: number | null
  created_at: string
  items: OrderItem[]
}

async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, { credentials: 'same-origin', ...init })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'server_error')
  return data
}

export default function AccountPage() {
  const { tr, lang } = useLanguage()
  const { user, loading, logout, refresh } = useAuth()
  const errorText = useAuthError()

  const [loggingOut, setLoggingOut] = useState(false)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [profileMsg, setProfileMsg] = useState('')
  const [profileErr, setProfileErr] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [savingPw, setSavingPw] = useState(false)

  const [membership, setMembership] = useState<Membership | null>(null)
  const [cardNumber, setCardNumber] = useState('')
  const [cardErr, setCardErr] = useState('')
  const [savingCard, setSavingCard] = useState(false)

  const [orders, setOrders] = useState<OrderRow[]>([])

  useEffect(() => {
    if (user) {
      setName(user.name || '')
      setPhone(user.phone || '')
    }
  }, [user])

  // 정적 내보내기라 서버에서 미리 막을 수 없다. 로그인 여부는 브라우저에서
  // 확인한 뒤 넘긴다 — 편의를 위한 것이지 보안 장치가 아니다(실제 데이터는
  // 서버가 세션으로 막는다). loggingOut 중에는 가드를 쉬게 해야 로그아웃할 때
  // 홈이 아니라 로그인 화면으로 튕기는 일이 없다.
  useEffect(() => {
    if (!loading && !user && !loggingOut) window.location.href = '/login/'
  }, [loading, user, loggingOut])

  const loadCustomerData = useCallback(async () => {
    try {
      const m = await json('/api/members/me')
      setMembership(m.membership || null)
    } catch {
      setMembership(null)
    }
    try {
      const o = await json('/api/account/orders')
      setOrders(o.orders || [])
    } catch {
      setOrders([])
    }
  }, [])

  useEffect(() => {
    if (user) loadCustomerData()
  }, [user, loadCustomerData])

  const roleLabel = (role: string) =>
    role === 'owner' ? tr.auth.roleOwner : role === 'staff' ? tr.auth.roleStaff : tr.auth.roleCustomer

  const itemName = (it: OrderItem) =>
    (lang === 'ko' ? it.name_ko : lang === 'en' ? it.name_en : it.name_zh) || it.name_zh || it.name_ko || ''

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setProfileErr('')
    setProfileMsg('')
    setSavingProfile(true)
    try {
      await json('/api/account/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone }),
      })
      setProfileMsg(tr.auth.saved)
      await refresh()
    } catch (err) {
      setProfileErr(errorText((err as Error).message))
    } finally {
      setSavingProfile(false)
    }
  }

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwErr('')
    setPwMsg('')
    setSavingPw(true)
    try {
      await json('/api/account/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      setPwMsg(tr.auth.passwordChanged)
      setCurrentPassword('')
      setNewPassword('')
      await refresh()
    } catch (err) {
      setPwErr(errorText((err as Error).message))
    } finally {
      setSavingPw(false)
    }
  }

  const registerCard = async (e: React.FormEvent) => {
    e.preventDefault()
    setCardErr('')
    setSavingCard(true)
    try {
      const data = await json('/api/members/register-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardNumber }),
      })
      setMembership(data.membership || null)
      setCardNumber('')
    } catch (err) {
      setCardErr(errorText((err as Error).message))
    } finally {
      setSavingCard(false)
    }
  }

  if (loading || !user) {
    return (
      <AuthShell title={tr.auth.accountTitle}>
        <p style={{ color: 'var(--ink-a6)', fontSize: 'var(--fs-sm)', margin: 0, textAlign: 'center' }}>{tr.auth.loading}</p>
      </AuthShell>
    )
  }

  return (
    <AuthShell title={tr.auth.accountTitle} subtitle={user.email || undefined} wide>
      {/* 관리자에게만 — 손님 계정에는 아예 렌더링되지 않는다 */}
      {user.isAdmin ? (
        <div style={{ marginBottom: 28, padding: '16px 18px', border: '1px solid var(--gold-a3)', background: 'var(--scrim-20)' }}>
          <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--ink2)', lineHeight: 1.6 }}>{tr.auth.adminHint}</p>
          <a
            href={ADMIN_URL}
            className="hg-cta-outline-gold"
            style={{
              display: 'inline-block',
              marginTop: 14,
              padding: '9px 18px',
              fontSize: 'var(--fs-sm)',
              letterSpacing: '0.05em',
              textDecoration: 'none',
            }}
          >
            {tr.auth.adminPage} →
          </a>
        </div>
      ) : null}

      <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, margin: '0 0 30px', fontSize: 'var(--fs-sm)' }}>
        <dt style={{ color: 'var(--muted)' }}>{tr.auth.roleLabel}</dt>
        <dd style={{ margin: 0, textAlign: 'right', color: 'var(--ink2)' }}>{roleLabel(user.role)}</dd>
        <dt style={{ color: 'var(--muted)' }}>{tr.auth.loginMethods}</dt>
        <dd style={{ margin: 0, textAlign: 'right', color: 'var(--ink2)' }}>
          {[user.hasPassword ? tr.auth.methodPassword : null, user.hasGoogle ? tr.auth.methodGoogle : null].filter(Boolean).join(' · ')}
        </dd>
      </dl>

      {/* ---------- VIP 카드 ---------- */}
      <section style={{ borderTop: '1px solid var(--gold-a18)', paddingTop: 26, marginBottom: 30 }}>
        <SectionTitle>{tr.auth.vipTitle}</SectionTitle>
        {membership ? (
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, margin: 0, fontSize: 'var(--fs-sm)' }}>
            <dt style={{ color: 'var(--muted)' }}>{tr.member.cardLabel}</dt>
            <dd style={{ margin: 0, textAlign: 'right', color: 'var(--ink2)' }}>
              {membership.card_number}{' '}
              <span style={{ color: membership.active ? 'var(--status-open)' : 'var(--muted)' }}>
                {membership.active ? `· ${tr.auth.vipRegistered}` : `· ${tr.auth.vipExpired}`}
              </span>
            </dd>
            <dt style={{ color: 'var(--muted)' }}>{tr.auth.vipDiscountLabel}</dt>
            <dd style={{ margin: 0, textAlign: 'right', color: 'var(--ink2)' }}>{membership.discount_percent}%</dd>
            <dt style={{ color: 'var(--muted)' }}>{tr.auth.vipExpiryLabel}</dt>
            <dd style={{ margin: 0, textAlign: 'right', color: 'var(--ink2)' }}>{membership.expiry_date || '-'}</dd>
          </dl>
        ) : (
          <form onSubmit={registerCard}>
            <p style={{ color: 'var(--ink-a6)', fontSize: 'var(--fs-sm)', lineHeight: 1.6, margin: '0 0 14px' }}>{tr.member.cardHint}</p>
            {/* 등록은 되돌릴 수 없는 동작이라 누르기 전에 알려준다.
                되돌리는 건 사장님만 할 수 있다(Admin > 회원(VIP) > 등록해제). */}
            <Notice kind="info">{tr.auth.vipOneTimeNotice}</Notice>
            <Notice>{cardErr}</Notice>
            <Field
              label={tr.member.cardLabel}
              value={cardNumber}
              maxLength={30}
              required
              disabled={savingCard}
              onChange={(e) => setCardNumber(e.target.value)}
            />
            <SubmitButton busy={savingCard} type="submit">
              {savingCard ? tr.auth.submitting : tr.member.register}
            </SubmitButton>
          </form>
        )}
      </section>

      {/* ---------- 주문 내역 ---------- */}
      <section style={{ borderTop: '1px solid var(--gold-a18)', paddingTop: 26, marginBottom: 30 }}>
        <SectionTitle>{tr.auth.ordersTitle}</SectionTitle>
        {orders.length === 0 ? (
          <p style={{ color: 'var(--ink-a6)', fontSize: 'var(--fs-sm)', margin: 0 }}>{tr.auth.ordersEmpty}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {orders.map((o) => (
              <li key={o.id} style={{ borderBottom: '1px solid var(--gold-a12)', paddingBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 'var(--fs-sm)', color: 'var(--ink2)' }}>
                  <span>
                    {o.pickup_number ? `${tr.auth.ordersTakeout} ${o.pickup_number}` : `${tr.auth.ordersTable} ${o.table_number}`}
                    <span style={{ color: 'var(--muted)' }}> · {o.created_at}</span>
                  </span>
                  <span style={{ whiteSpace: 'nowrap' }}>
                    NT${o.total}
                    {o.vip_discount_percent ? <span style={{ color: 'var(--status-open)' }}> · -{o.vip_discount_percent}%</span> : null}
                  </span>
                </div>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginTop: 5 }}>
                  {o.items.map((it) => `${itemName(it)} ×${it.qty}`).join(', ')}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------- 내 정보 ---------- */}
      <form onSubmit={saveProfile} style={{ borderTop: '1px solid var(--gold-a18)', paddingTop: 26 }}>
        <SectionTitle>{tr.auth.profile}</SectionTitle>
        <Notice>{profileErr}</Notice>
        <Notice kind="ok">{profileMsg}</Notice>
        <Field label={tr.auth.name} value={name} required disabled={savingProfile} onChange={(e) => setName(e.target.value)} />
        <Field label={tr.auth.phoneOptional} type="tel" value={phone} disabled={savingProfile} onChange={(e) => setPhone(e.target.value)} />
        <SubmitButton busy={savingProfile} type="submit">{savingProfile ? tr.auth.submitting : tr.auth.save}</SubmitButton>
      </form>

      {/* ---------- 비밀번호 ---------- */}
      <form onSubmit={savePassword} style={{ borderTop: '1px solid var(--gold-a18)', paddingTop: 26, marginTop: 30 }}>
        {/* 구글로만 가입한 계정은 바꿀 기존 비밀번호가 없으니 "설정"이다 */}
        <SectionTitle>{user.hasPassword ? tr.auth.changePassword : tr.auth.setPassword}</SectionTitle>
        <Notice>{pwErr}</Notice>
        <Notice kind="ok">{pwMsg}</Notice>
        {user.hasPassword ? (
          <Field
            label={tr.auth.currentPassword}
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            required
            disabled={savingPw}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        ) : null}
        <Field
          label={tr.auth.newPassword}
          hint={tr.auth.passwordHint}
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={newPassword}
          required
          disabled={savingPw}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <SubmitButton busy={savingPw} type="submit">
          {savingPw ? tr.auth.submitting : user.hasPassword ? tr.auth.changePassword : tr.auth.setPassword}
        </SubmitButton>
      </form>

      <button
        type="button"
        onClick={async () => {
          setLoggingOut(true)
          try {
            await logout()
          } finally {
            window.location.href = '/'
          }
        }}
        className="hg-cta-outline"
        style={{
          width: '100%',
          marginTop: 30,
          padding: '11px 0',
          background: 'none',
          fontSize: 'var(--fs-sm)',
          fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        {tr.auth.logout}
      </button>
    </AuthShell>
  )
}
