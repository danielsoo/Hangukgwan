'use client'

import { useLanguage } from '@/context/LanguageContext'
import ImagePlaceholder from '@/components/ImagePlaceholder'

export default function AboutPage() {
  const { tr } = useLanguage()

  return (
    <main>
      <section style={{ maxWidth: 'var(--shell-max)', margin: '0 auto', padding: 'clamp(60px, 8vw, 110px) var(--shell-pad) clamp(50px, 6vw, 84px)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'clamp(44px, 6vw, 92px)', alignItems: 'center' }}>
          <div>
            <p
              style={{
                fontFamily: "'Newsreader', serif",
                fontSize: 'var(--fs-xs)',
                letterSpacing: '0.34em',
                textTransform: 'uppercase',
                color: 'var(--accent)',
                margin: '0 0 24px',
              }}
            >
              {tr.about.label}
            </p>
            <h1
              style={{
                fontFamily: "'Noto Serif TC', serif",
                fontWeight: 400,
                fontSize: 'var(--fs-display)',
                lineHeight: 1.5,
                letterSpacing: '0.05em',
                color: 'var(--ink)',
                margin: '0 0 30px',
                maxWidth: 'min(19ch, 100%)',
              }}
            >
              {tr.about.title}
            </h1>
            <span style={{ display: 'block', width: 56, height: 1, background: 'var(--gold)', marginBottom: 32 }} />
            <p style={{ fontSize: 'var(--fs-md)', lineHeight: 2.1, color: 'var(--ink-a75)', margin: '0 0 22px' }}>{tr.about.p1}</p>
            <p style={{ fontSize: 'var(--fs-md)', lineHeight: 2.1, color: 'var(--ink-a75)', margin: '0 0 22px' }}>{tr.about.p2}</p>
            <p style={{ fontSize: 'var(--fs-md)', lineHeight: 2.1, color: 'var(--ink-a75)', margin: 0 }}>{tr.about.p3}</p>
          </div>
          <div style={{ position: 'relative', aspectRatio: '4 / 5' }}>
            <ImagePlaceholder label="店內 · The room" />
          </div>
        </div>
      </section>

      <section style={{ background: 'var(--bg-alt)', borderTop: '1px solid var(--gold-a14)', borderBottom: '1px solid var(--gold-a14)' }}>
        <div style={{ maxWidth: 'var(--shell-max)', margin: '0 auto', padding: 'clamp(64px, 8vw, 110px) var(--shell-pad)' }}>
          <p
            style={{
              fontFamily: "'Newsreader', serif",
              fontSize: 'var(--fs-xs)',
              letterSpacing: '0.34em',
              textTransform: 'uppercase',
              color: 'var(--accent)',
              margin: '0 0 24px',
            }}
          >
            {tr.about.valuesLabel}
          </p>
          <h2
            style={{
              fontFamily: "'Noto Serif TC', serif",
              fontWeight: 400,
              fontSize: 'var(--fs-title)',
              lineHeight: 1.55,
              letterSpacing: '0.05em',
              color: 'var(--ink)',
              margin: '0 0 clamp(44px, 6vw, 68px)',
              maxWidth: 'min(24ch, 100%)',
            }}
          >
            {tr.about.valuesTitle}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'clamp(32px, 4vw, 64px)' }}>
            {tr.about.values.map((v) => (
              <div key={v.n} style={{ paddingTop: 26, borderTop: '1px solid var(--gold-a28)' }}>
                <p style={{ fontFamily: "'Newsreader', serif", fontSize: 'var(--fs-sm)', letterSpacing: '0.24em', color: 'var(--muted)', margin: '0 0 24px' }}>Nº 0{v.n}</p>
                <h3 style={{ fontFamily: "'Noto Serif TC', serif", fontWeight: 400, fontSize: 'var(--fs-lg)', letterSpacing: '0.08em', color: 'var(--ink)', margin: '0 0 18px' }}>
                  {v.t}
                </h3>
                <p style={{ fontSize: 'var(--fs-base)', lineHeight: 2, color: 'var(--ink-a55)', margin: 0 }}>{v.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ maxWidth: 'var(--shell-max)', margin: '0 auto', padding: 'clamp(60px, 8vw, 100px) var(--shell-pad)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'clamp(14px, 2vw, 24px)' }}>
          <div style={{ position: 'relative', aspectRatio: '1 / 1' }}>
            <ImagePlaceholder label="小菜 · Banchan" />
          </div>
          <div style={{ position: 'relative', aspectRatio: '1 / 1' }}>
            <ImagePlaceholder label="廚房 · Kitchen" />
          </div>
          <div style={{ position: 'relative', aspectRatio: '1 / 1' }}>
            <ImagePlaceholder label="座位 · Seating" />
          </div>
          <div style={{ position: 'relative', aspectRatio: '1 / 1' }}>
            <ImagePlaceholder label="細節 · Detail" />
          </div>
        </div>
      </section>
    </main>
  )
}
