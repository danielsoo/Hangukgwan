'use client'

import { useLanguage } from '@/context/LanguageContext'
import { ORDER_URL } from '@/lib/config'

export default function Footer() {
  const { tr } = useLanguage()

  return (
    <footer style={{ background: 'var(--bg)', borderTop: '1px solid var(--gold-a18)' }}>
      <div style={{ maxWidth: 1320, margin: '0 auto', padding: 'clamp(54px, 7vw, 84px) clamp(20px, 3.5vw, 48px) 40px' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            gap: 'clamp(32px, 4vw, 56px)',
            marginBottom: 54,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 18 }}>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 34,
                  height: 34,
                  border: '1px solid var(--gold-a5)',
                  color: 'var(--gold)',
                  fontFamily: "'Noto Serif TC', serif",
                  fontSize: 17,
                  lineHeight: 1,
                }}
              >
                韓
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
                <span style={{ fontFamily: "'Noto Serif TC', serif", fontSize: 18, letterSpacing: '0.16em', color: 'var(--ink2)' }}>韓國館</span>
                <span style={{ fontFamily: "'Newsreader', serif", fontSize: 10, letterSpacing: '0.34em', color: 'var(--muted)' }}>
                  HANGUKGWAN
                </span>
              </span>
            </div>
            <p style={{ fontSize: 14, color: 'var(--ink-a45)', margin: 0, maxWidth: '26ch' }}>{tr.footer.tag}</p>
          </div>

          <div>
            <p
              style={{
                fontFamily: "'Newsreader', serif",
                fontSize: 11,
                letterSpacing: '0.3em',
                textTransform: 'uppercase',
                color: 'var(--accent)',
                margin: '0 0 18px',
              }}
            >
              {tr.footer.storesLabel}
            </p>
            <p style={{ fontSize: 14, color: 'var(--ink-a75)', margin: '0 0 8px' }}>新竹縣竹北市縣政九路135巷32號</p>
            <p style={{ fontSize: 14, color: 'var(--ink-a45)', margin: 0 }}>新竹縣竹北市太元一街7號</p>
          </div>

          <div>
            <p
              style={{
                fontFamily: "'Newsreader', serif",
                fontSize: 11,
                letterSpacing: '0.3em',
                textTransform: 'uppercase',
                color: 'var(--accent)',
                margin: '0 0 18px',
              }}
            >
              {tr.info.hours}
            </p>
            <p style={{ fontFamily: "'Newsreader', serif", fontSize: 15, color: 'var(--ink-a75)', margin: '0 0 8px' }}>
              11.00–14.00 · 17.00–21.00
            </p>
            <p style={{ fontSize: 14, color: 'var(--ink-a45)', margin: 0 }}>{tr.info.closedVal}</p>
          </div>

          <div>
            <p
              style={{
                fontFamily: "'Newsreader', serif",
                fontSize: 11,
                letterSpacing: '0.3em',
                textTransform: 'uppercase',
                color: 'var(--accent)',
                margin: '0 0 18px',
              }}
            >
              {tr.info.phoneLabel}
            </p>
            <a href="tel:0366567994" style={{ fontFamily: "'Newsreader', serif", fontSize: 17, letterSpacing: '0.08em' }}>
              03 656 7994
            </a>
            <p style={{ margin: '12px 0 0' }}>
              <a href={ORDER_URL} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14 }}>
                {tr.footer.orderLink} →
              </a>
            </p>
          </div>
        </div>

        <div
          style={{
            paddingTop: 30,
            borderTop: '1px solid var(--gold-a14)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px 24px',
          }}
        >
          <p style={{ fontFamily: "'Newsreader', serif", fontSize: 12.5, letterSpacing: '0.06em', color: 'var(--ink-a35)', margin: 0 }}>
            © 2026 韓國館 Hangukgwan · Zhubei, Hsinchu
          </p>
          <p style={{ fontSize: 12.5, color: 'var(--ink-a35)', margin: 0 }}>{tr.footer.rights}</p>
        </div>
      </div>
    </footer>
  )
}
