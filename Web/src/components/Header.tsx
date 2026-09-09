'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLanguage } from '@/context/LanguageContext'
import { useTheme } from '@/context/ThemeContext'
import { useAuth } from '@/context/AuthContext'

const NAV: { href: string; key: 'home' | 'menu' | 'about' | 'loc' | 'group' }[] = [
  { href: '/', key: 'home' },
  { href: '/menu/', key: 'menu' },
  { href: '/about/', key: 'about' },
  { href: '/visit/', key: 'loc' },
  { href: '/group/', key: 'group' },
]

// 헤더 안의 글자는 전부 이 크기다 — 사장님: "글자 크기는 헤더들 다 같게."
// 예전에는 로고 19px, 내비 12.5px, 버튼 12.5px, 전화 14px 로 제각각이라
// 두 줄이 서로 다른 화면처럼 보였다. 사이트 전체 글자 단계(globals.css 의
// --fs-*)에서 같은 값을 가져다 쓴다.
const TEXT = 'var(--fs-sm)'

export default function Header() {
  const { tr, cycleLang, langLabel, langTitle } = useLanguage()
  const { theme, toggleTheme } = useTheme()
  const { user, loading, legacyAdmin } = useAuth()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)

  // 페이지를 옮기면 닫는다. 열어둔 채로 넘어가면 새 페이지 위에 메뉴가
  // 덮여 있어서 "눌렀는데 아무 일이 없다" 처럼 보인다.
  useEffect(() => { setMenuOpen(false) }, [pathname])

  // Esc 로 닫기 — 열어놓고 빠져나올 길이 하나는 있어야 한다.
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  // 관리자 버튼은 owner/staff 계정에만. 기존 비밀번호 로그인으로 관리자
  // 화면에 들어가 있는 세션(legacyAdmin)도 같은 취급 — 계정 정보는 없지만
  // 관리자인 건 맞으니 버튼은 보여준다.
  const isAdmin = !!user?.isAdmin || legacyAdmin

  const themeTitle = theme === 'light' ? '切換為深色 · 어두운 화면으로 · Switch to dark' : '切換為淺色 · 밝은 화면으로 · Switch to light'

  return (
    <header
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
          maxWidth: 1320,
          margin: '0 auto',
          padding: '0 clamp(12px, 3vw, 48px)',
          minHeight: 62,
        }}
      >
        {/* 왼쪽 — 좁은 화면에서는 햄버거, 그리고 로고 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifySelf: 'start', minWidth: 0 }}>
        <button
          className="hg-icon-btn hg-hamburger"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-label={menuOpen ? '메뉴 닫기' : '메뉴 열기'}
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            width: 34,
            height: 34,
                        flexShrink: 0,
            lineHeight: 1,
          }}
        >
          {/* 글자(☰ / ✕) 대신 직접 그린다 — 본문 서체(Noto Sans KR/TC)에
              ✕(U+2715) 자형이 없어서 열었을 때 빈 네모로 나왔다. */}
          <svg width="17" height="17" viewBox="0 0 17 17" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            {menuOpen ? (
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
        <Link
          href="/"
          className="hg-logo"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '11px 0',
            minWidth: 0,
          }}
        >
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

        {/* 오른쪽 — 사장님 지정 순서: 가장 오른쪽부터 프로필, 밝기, 언어.
            관리자 버튼은 관리자에게만 보이는 추가 항목이라, 그 셋의 자리를
            건드리지 않도록 묶음의 맨 앞(가장 왼쪽)에 둔다. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(4px, 1.2vw, 10px)', minWidth: 0 }}>
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
            onClick={cycleLang}
            title={langTitle}
            className="hg-pill"
            style={{ padding: '7px clamp(6px, 2vw, 10px)', flexShrink: 0 }}
          >
            <span style={{ fontSize: TEXT, letterSpacing: '0.06em', color: 'var(--ink2)', whiteSpace: 'nowrap' }}>
              {langLabel}
            </span>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>▾</span>
          </button>

          <button
            onClick={toggleTheme}
            title={themeTitle}
            className="hg-icon-btn hg-theme-btn"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              fontSize: TEXT,
              lineHeight: 1,
              flexShrink: 0,
                          }}
          >
            {theme === 'light' ? '☾' : '☀'}
          </button>

          {/* 프로필 — 로그인 상태를 아직 모르는 동안(첫 /api/account/me 응답
              전)에는 아무것도 그리지 않는다. "로그인"이 잠깐 떴다가 이름으로
              바뀌는 깜빡임을 막기 위해서다. */}
          {!loading ? (
            <Link
              href={user ? '/account/' : '/login/'}
              className="hg-member-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '7px clamp(8px, 2.4vw, 14px)',
                fontSize: TEXT,
                letterSpacing: '0.04em',
                whiteSpace: 'nowrap',
                flexShrink: 1,
                minWidth: 0,
                maxWidth: 150,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                textDecoration: 'none',
              }}
            >
              <span style={{ display: 'block', width: 6, height: 6, border: '1px solid var(--accent)', borderRadius: '50%', flexShrink: 0 }} />
              {user ? user.name || tr.member.nav : tr.auth.login}
            </Link>
          ) : null}
        </div>
      </div>

      {/* 좁은 화면에서 펼쳐지는 메뉴 */}
      {menuOpen ? (
        <nav className="hg-menu-panel">
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href)
            return (
              <Link
                key={item.key}
                href={item.href}
                data-active={active ? 'true' : 'false'}
                style={{ fontSize: 'var(--fs-base)' }}
                onClick={() => setMenuOpen(false)}
              >
                {tr.nav[item.key]}
              </Link>
            )
          })}
        </nav>
      ) : null}
    </header>
  )
}
