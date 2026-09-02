'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLanguage } from '@/context/LanguageContext'
import { useTheme } from '@/context/ThemeContext'
import { ORDER_URL } from '@/lib/config'

const NAV: { href: string; key: 'home' | 'menu' | 'about' | 'loc' | 'group' }[] = [
  { href: '/', key: 'home' },
  { href: '/menu/', key: 'menu' },
  { href: '/about/', key: 'about' },
  { href: '/visit/', key: 'loc' },
  { href: '/group/', key: 'group' },
]

export default function Header() {
  const { tr, cycleLang, langLabel, langTitle } = useLanguage()
  const { theme, toggleTheme } = useTheme()
  const pathname = usePathname()

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
        style={{
          maxWidth: 1320,
          margin: '0 auto',
          padding: '0 clamp(14px, 3vw, 48px)',
          minHeight: 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'clamp(10px, 2vw, 32px)',
        }}
      >
        <Link
          href="/"
          className="hg-logo"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'clamp(8px, 2vw, 12px)',
            padding: '11px 0',
            flexShrink: 0,
            minWidth: 0,
          }}
        >
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 'clamp(28px, 8vw, 34px)',
              height: 'clamp(28px, 8vw, 34px)',
              border: '1px solid var(--gold-a55)',
              color: 'var(--gold)',
              fontFamily: "'Noto Serif TC', serif",
              fontSize: 'clamp(14px, 4vw, 17px)',
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            韓
          </span>
          <span
            style={{
              fontFamily: "'Noto Serif TC', serif",
              fontWeight: 400,
              fontSize: 'clamp(15px, 4.4vw, 19px)',
              letterSpacing: '0.12em',
              color: 'var(--ink2)',
              whiteSpace: 'nowrap',
            }}
          >
            韓國館
          </span>
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(5px, 1.4vw, 16px)', flexShrink: 1, minWidth: 0 }}>
          <button
            onClick={cycleLang}
            title={langTitle}
            className="hg-pill"
            style={{ padding: '7px clamp(6px, 2vw, 10px)', flexShrink: 0, background: 'none' }}
          >
            <span style={{ fontSize: 'clamp(10.5px, 2.8vw, 12px)', letterSpacing: '0.06em', color: 'var(--ink2)', whiteSpace: 'nowrap' }}>
              {langLabel}
            </span>
            <span style={{ fontSize: 8, color: 'var(--muted)' }}>▾</span>
          </button>

          <a
            href={ORDER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hg-member-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '7px clamp(8px, 2.6vw, 14px)',
              fontSize: 'clamp(10.5px, 2.8vw, 12.5px)',
              letterSpacing: '0.04em',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            <span style={{ display: 'block', width: 6, height: 6, border: '1px solid var(--accent)', borderRadius: '50%', flexShrink: 0 }} />
            {tr.member.nav}
          </a>

          <button
            onClick={toggleTheme}
            title={themeTitle}
            className="hg-theme-btn"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 'clamp(28px, 7.5vw, 32px)',
              height: 'clamp(28px, 7.5vw, 32px)',
              fontSize: 13,
              lineHeight: 1,
              flexShrink: 0,
              background: 'none',
            }}
          >
            {theme === 'light' ? '☾' : '☀'}
          </button>

          <a
            href="tel:0366567994"
            className="hg-phone-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '8px clamp(9px, 2.6vw, 16px)',
              fontFamily: "'Newsreader', serif",
              fontSize: 'clamp(12px, 3.2vw, 14px)',
              letterSpacing: '0.04em',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            03 656 7994
          </a>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--gold-a12)' }}>
        <nav
          style={{
            maxWidth: 1320,
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexWrap: 'nowrap',
            overflowX: 'auto',
            padding: '0 clamp(6px, 2vw, 20px)',
          }}
        >
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href)
            return (
              <Link
                key={item.key}
                href={item.href}
                className="hg-nav-item"
                style={{
                  position: 'relative',
                  padding: '10px clamp(9px, 2.6vw, 15px)',
                  fontSize: 'clamp(11.5px, 3vw, 12.5px)',
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
                      left: 'clamp(9px, 2.6vw, 15px)',
                      right: 'clamp(9px, 2.6vw, 15px)',
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
      </div>
    </header>
  )
}
