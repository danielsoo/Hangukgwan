'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLanguage } from '@/context/LanguageContext'
import { useAuth } from '@/context/AuthContext'
import SettingsControls from './SettingsControls'

const NAV: { href: string; key: 'home' | 'menu' | 'about' | 'loc' | 'group' }[] = [
  { href: '/', key: 'home' },
  { href: '/menu/', key: 'menu' },
  { href: '/about/', key: 'about' },
  { href: '/visit/', key: 'loc' },
  { href: '/group/', key: 'group' },
]

// 헤더 안의 글자는 전부 이 크기다 — 사장님: "글자 크기는 헤더들 다 같게."
// 사이트 전체 글자 단계(globals.css 의 --fs-*)에서 같은 값을 가져다 쓴다.
const TEXT = 'var(--fs-sm)'

export default function Header() {
  const { tr } = useLanguage()
  const { user, loading, legacyAdmin } = useAuth()
  const pathname = usePathname()

  // 한 번에 하나만 열린다 — 설정과 메뉴가 겹쳐 있으면 어느 것을 닫는 건지
  // 알 수 없다.
  const [open, setOpen] = useState<null | 'menu' | 'settings'>(null)
  const headerRef = useRef<HTMLElement>(null)

  // 페이지를 옮기면 닫는다. 열어둔 채로 넘어가면 새 페이지 위에 판이 덮여
  // 있어서 "눌렀는데 아무 일이 없다" 처럼 보인다.
  useEffect(() => { setOpen(null) }, [pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    // 판 바깥을 누르면 닫힌다 — 열어놓고 빠져나올 길이 여럿 있어야 한다.
    const onDown = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) setOpen(null)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  // 관리자 버튼은 owner/staff 계정에만. 기존 비밀번호 로그인으로 관리자
  // 화면에 들어가 있는 세션(legacyAdmin)도 같은 취급 — 계정 정보는 없지만
  // 관리자인 건 맞으니 버튼은 보여준다.
  const isAdmin = !!user?.isAdmin || legacyAdmin

  const accountLink = (
    <Link
      href={user ? '/account/' : '/login/'}
      className="hg-member-btn"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        height: 'var(--hdr-btn-h)',
        padding: '0 clamp(10px, 2.4vw, 16px)',
        fontSize: TEXT,
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
        flexShrink: 1,
        minWidth: 0,
        maxWidth: 170,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        textDecoration: 'none',
      }}
    >
      <span style={{ display: 'block', width: 6, height: 6, border: '1px solid var(--accent)', borderRadius: '50%', flexShrink: 0 }} />
      {user ? user.name || tr.member.nav : tr.auth.login}
    </Link>
  )

  return (
    <header
      ref={headerRef}
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 60,
        background: 'var(--bg-a86)',
        backdropFilter: 'blur(14px)',
        borderBottom: '1px solid var(--gold-a18)',
      }}
    >
      <div
        className="hg-header-bar"
        style={{
          maxWidth: 'var(--shell-max)',
          margin: '0 auto',
          padding: '0 var(--shell-pad)',
          minHeight: 62,
        }}
      >
        {/* 왼쪽 — 좁은 화면에서는 햄버거, 그리고 로고 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifySelf: 'start', minWidth: 0 }}>
          <button
            className={open === 'menu' ? 'hg-icon-btn hg-hamburger hg-icon-btn-on' : 'hg-icon-btn hg-hamburger'}
            onClick={() => setOpen((v) => (v === 'menu' ? null : 'menu'))}
            aria-expanded={open === 'menu'}
            aria-label={open === 'menu' ? '메뉴 닫기' : '메뉴 열기'}
            style={{ width: 'var(--hdr-btn-h)', height: 'var(--hdr-btn-h)', flexShrink: 0 }}
          >
            {/* 글자(☰ / ✕) 대신 직접 그린다 — 본문 서체(Noto Sans KR/TC)에
                ✕(U+2715) 자형이 없어서 열었을 때 빈 네모로 나왔다. */}
            <svg width="17" height="17" viewBox="0 0 17 17" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
              {open === 'menu' ? (
                <>
                  <line x1="3.5" y1="3.5" x2="13.5" y2="13.5" />
                  <line x1="13.5" y1="3.5" x2="3.5" y2="13.5" />
                </>
              ) : (
                <>
                  <line x1="2.5" y1="4.5" x2="14.5" y2="4.5" />
                  <line x1="2.5" y1="8.5" x2="14.5" y2="8.5" />
                  <line x1="2.5" y1="12.5" x2="14.5" y2="12.5" />
                </>
              )}
            </svg>
          </button>

          <Link href="/" className="hg-logo" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '11px 0', minWidth: 0 }}>
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 'calc(var(--fs-sm) * 2.15)',
                height: 'calc(var(--fs-sm) * 2.15)',
                border: '1px solid var(--gold-a55)',
                color: 'var(--gold)',
                fontFamily: "'Noto Serif TC', serif",
                fontSize: TEXT,
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              韓
            </span>
            <span
              className="hg-logo-word"
              style={{
                fontFamily: "'Noto Serif TC', serif",
                fontWeight: 400,
                fontSize: TEXT,
                letterSpacing: '0.14em',
                color: 'var(--ink2)',
                whiteSpace: 'nowrap',
              }}
            >
              韓國館
            </span>
          </Link>
        </div>

        {/* 가운데 — 내비게이션 (좁은 화면에서는 감추고 햄버거로) */}
        <nav className="hg-header-nav">
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href)
            return (
              <Link
                key={item.key}
                href={item.href}
                className="hg-nav-item"
                style={{
                  position: 'relative',
                  padding: '10px clamp(8px, 2.2vw, 15px)',
                  fontSize: TEXT,
                  fontWeight: 300,
                  letterSpacing: '0.06em',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  color: active ? 'var(--gold)' : undefined,
                }}
              >
                {tr.nav[item.key]}
                {active && (
                  <span
                    style={{
                      position: 'absolute',
                      left: 'clamp(8px, 2.2vw, 15px)',
                      right: 'clamp(8px, 2.2vw, 15px)',
                      bottom: 3,
                      height: 1,
                      background: 'var(--gold)',
                    }}
                  />
                )}
              </Link>
            )
          })}
        </nav>

        {/* 오른쪽 — 사장님: "헤더 오른쪽에는 설정 로그인 만 있으면 될 것 같아."
            언어와 밝기는 설정 안으로 들어갔다. 한 번 정하면 잘 안 바꾸는
            값이라 늘 자리를 차지할 이유가 없다.
            관리자 버튼은 관리자에게만 보이는 추가 항목이라 그 둘의 자리를
            건드리지 않도록 묶음의 맨 앞에 둔다. */}
        <div className="hg-header-right" style={{ display: 'flex', alignItems: 'center', gap: 'clamp(4px, 1.2vw, 10px)', minWidth: 0 }}>
          {!loading && isAdmin ? (
            <Link
              href="/account/"
              className="hg-cta-outline-gold"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '7px clamp(8px, 2.4vw, 13px)',
                fontSize: TEXT,
                letterSpacing: '0.04em',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                textDecoration: 'none',
              }}
            >
              {tr.auth.adminPage}
            </Link>
          ) : null}

          <button
            className={open === 'settings' ? 'hg-icon-btn hg-settings-btn hg-icon-btn-on' : 'hg-icon-btn hg-settings-btn'}
            onClick={() => setOpen((v) => (v === 'settings' ? null : 'settings'))}
            aria-expanded={open === 'settings'}
            aria-label={tr.settings.title}
            title={tr.settings.title}
            style={{ width: 'var(--hdr-btn-h)', height: 'var(--hdr-btn-h)', flexShrink: 0 }}
          >
            {/* 톱니 — 글자 ⚙ 는 서체에 따라 컬러 이모지로 튀거나 빈 네모가 된다. */}
            <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3.2" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>

          {/* 로그인 — 상태를 아직 모르는 동안(첫 /api/account/me 응답 전)에는
              아무것도 그리지 않는다. "로그인"이 잠깐 떴다가 이름으로 바뀌는
              깜빡임을 막기 위해서다. 좁은 화면에서는 햄버거 안으로 들어간다. */}
          {!loading ? <span className="hg-account-wide">{accountLink}</span> : null}
        </div>
      </div>

      {/* 설정 — 언어와 밝기.
          전에는 헤더 폭을 가득 채우는 띠였고, 내용이 껍데기 왼쪽 끝에서
          시작했다. 톱니바퀴는 오른쪽 끝에 있으니 2000px 모니터에서는 누른
          자리와 열린 자리가 1600px 넘게 떨어져 있었다 — 무엇이 열린 건지
          알 수 없다. 톱니바퀴 바로 아래에 붙는 작은 판으로 바꾼다. */}
      {open === 'settings' ? (
        <div className="hg-settings-anchor">
          <div className="hg-panel hg-settings-pop">
            <SettingsControls inset="16px" />
          </div>
        </div>
      ) : null}

      {/* 좁은 화면에서 펼쳐지는 메뉴 — 사장님: "햄버거 모양이 되면 메뉴들,
          로그인, 설정 이렇게 있으면 될 듯해." */}
      {open === 'menu' ? (
        <div className="hg-panel">
          <nav className="hg-menu-panel">
            {NAV.map((item) => {
              const active = item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href)
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  data-active={active ? 'true' : 'false'}
                  style={{ fontSize: 'var(--fs-base)' }}
                  onClick={() => setOpen(null)}
                >
                  {tr.nav[item.key]}
                </Link>
              )
            })}
          </nav>
          {!loading ? (
            <div className="hg-panel-sep" style={{ padding: '14px clamp(14px, 5vw, 28px)' }}>
              {accountLink}
            </div>
          ) : null}
          <div className="hg-panel-sep" style={{ paddingBottom: 8 }}>
            <p
              style={{
                margin: 0,
                padding: '14px clamp(14px, 5vw, 28px) 0',
                fontSize: 'var(--fs-xs)',
                letterSpacing: '0.1em',
                color: 'var(--muted)',
              }}
            >
              {tr.settings.title}
            </p>
            <SettingsControls inset="clamp(14px, 5vw, 28px)" />
          </div>
        </div>
      ) : null}
    </header>
  )
}
