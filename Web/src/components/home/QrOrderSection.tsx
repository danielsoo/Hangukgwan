'use client'

import { useLanguage } from '@/context/LanguageContext'
import { ORDER_URL } from '@/lib/config'

export default function QrOrderSection() {
  const { tr } = useLanguage()
  return (
    <section style={{ background: 'var(--bg-alt)', borderTop: '1px solid var(--gold-a14)', borderBottom: '1px solid var(--gold-a14)' }}>
      <div
        style={{
          maxWidth: 'var(--shell-max)',
          margin: '0 auto',
          padding: 'clamp(64px, 8vw, 116px) var(--shell-pad)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 'clamp(40px, 6vw, 88px)',
          alignItems: 'center',
        }}
      >
        <div>
          <p
            style={{
              fontFamily: "'Newsreader', serif",
              fontSize: 'var(--fs-xs)',
              letterSpacing: '0.34em',
              textTransform: 'uppercase',
              color: 'var(--accent)',
              margin: '0 0 26px',
            }}
          >
            {tr.qr.label}
          </p>
          <h2
            style={{
              fontFamily: "'Noto Serif TC', serif",
              fontWeight: 400,
              fontSize: 'var(--fs-title)',
              lineHeight: 1.55,
              letterSpacing: '0.05em',
              color: 'var(--ink)',
              margin: '0 0 24px',
              maxWidth: 'min(18ch, 100%)',
            }}
          >
            {tr.qr.title}
          </h2>
          <p style={{ fontSize: 'var(--fs-base)', lineHeight: 2, color: 'var(--ink-a6)', margin: '0 0 36px', maxWidth: 'min(40ch, 100%)' }}>{tr.qr.body}</p>
          <a
            href={ORDER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hg-cta-solid"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 14, padding: '16px 34px', fontSize: 'var(--fs-sm)', fontWeight: 500, letterSpacing: '0.18em' }}
          >
            {tr.qr.cta} <span>→</span>
          </a>
        </div>
        <div style={{ display: 'grid', gap: 0, borderTop: '1px solid var(--gold-a16)' }}>
          {tr.qr.steps.map((step) => (
            <div key={step.n} style={{ display: 'flex', alignItems: 'baseline', gap: 24, padding: '26px 4px', borderBottom: '1px solid var(--gold-a16)' }}>
              <span style={{ fontFamily: "'Newsreader', serif", fontSize: 'var(--fs-base)', letterSpacing: '0.16em', color: 'var(--gold)', minWidth: '2.4em' }}>
                0{step.n}
              </span>
              <span style={{ fontSize: 'var(--fs-base)', color: 'var(--ink-a82)' }}>{step.text}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
