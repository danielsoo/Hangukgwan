'use client'

import { useLanguage } from '@/context/LanguageContext'
import ImagePlaceholder from '@/components/ImagePlaceholder'

export default function GroupPage() {
  const { tr } = useLanguage()
  const dishes = [
    { ko: '부대찌개', zh: '部隊鍋', price: 600, note: tr.group.d1, label: '부대찌개 部隊鍋' },
    { ko: '동판불고기', zh: '銅盤烤肉', price: 500, note: tr.group.d2, label: '동판불고기 銅盤烤肉' },
    { ko: '닭갈비', zh: '辣炒雞排', price: 600, note: tr.group.d3, label: '닭갈비 辣炒雞排' },
  ]

  return (
    <main>
      <section style={{ maxWidth: 1320, margin: '0 auto', padding: 'clamp(60px, 8vw, 110px) clamp(20px, 3.5vw, 48px) clamp(50px, 6vw, 84px)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'clamp(44px, 6vw, 92px)', alignItems: 'start' }}>
          <div>
            <p
              style={{
                fontFamily: "'Newsreader', serif",
                fontSize: 11.5,
                letterSpacing: '0.34em',
                textTransform: 'uppercase',
                color: 'var(--accent)',
                margin: '0 0 24px',
              }}
            >
              {tr.group.label}
            </p>
            <h1
              style={{
                fontFamily: "'Noto Serif TC', serif",
                fontWeight: 400,
                fontSize: 'clamp(2rem, 4.2vw, 3rem)',
                lineHeight: 1.5,
                letterSpacing: '0.05em',
                color: 'var(--ink)',
                margin: '0 0 30px',
                maxWidth: '19ch',
              }}
            >
              {tr.group.title}
            </h1>
            <span style={{ display: 'block', width: 56, height: 1, background: 'var(--gold)', marginBottom: 32 }} />
            <p style={{ fontSize: 16.5, lineHeight: 2.1, color: 'var(--ink-a75)', margin: '0 0 22px' }}>{tr.group.p1}</p>
            <p style={{ fontSize: 16.5, lineHeight: 2.1, color: 'var(--ink-a75)', margin: '0 0 38px' }}>{tr.group.p2}</p>
            <a
              href="tel:0366567994"
              className="hg-cta-solid"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 14, padding: '18px 34px', fontSize: 13.5, fontWeight: 500, letterSpacing: '0.14em' }}
            >
              {tr.group.cta} · 03 656 7994
            </a>
            <p style={{ fontSize: 13.5, color: 'var(--ink-a45)', margin: '18px 0 0' }}>{tr.group.ctaNote}</p>
          </div>
          <div style={{ display: 'grid', gap: 0, borderTop: '1px solid var(--gold-a28)' }}>
            {tr.group.rows.map((row) => (
              <div key={row.k} style={{ padding: '24px 4px', borderBottom: '1px solid var(--gold-a16)' }}>
                <p
                  style={{
                    fontFamily: "'Newsreader', serif",
                    fontSize: 11,
                    letterSpacing: '0.26em',
                    textTransform: 'uppercase',
                    color: 'var(--accent)',
                    margin: '0 0 10px',
                  }}
                >
                  {row.k}
                </p>
                <p style={{ fontSize: 15.5, lineHeight: 1.85, color: 'var(--ink-a82)', margin: 0 }}>{row.v}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ background: 'var(--bg-alt)', borderTop: '1px solid var(--gold-a14)' }}>
        <div style={{ maxWidth: 1320, margin: '0 auto', padding: 'clamp(64px, 8vw, 110px) clamp(20px, 3.5vw, 48px)' }}>
          <p
            style={{
              fontFamily: "'Newsreader', serif",
              fontSize: 11.5,
              letterSpacing: '0.34em',
              textTransform: 'uppercase',
              color: 'var(--accent)',
              margin: '0 0 24px',
            }}
          >
            {tr.group.dishesLabel}
          </p>
          <h2
            style={{
              fontFamily: "'Noto Serif TC', serif",
              fontWeight: 400,
              fontSize: 'clamp(1.7rem, 3.4vw, 2.4rem)',
              lineHeight: 1.55,
              letterSpacing: '0.05em',
              color: 'var(--ink)',
              margin: '0 0 clamp(44px, 6vw, 68px)',
              maxWidth: '24ch',
            }}
          >
            {tr.group.dishesTitle}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'clamp(30px, 4vw, 52px)' }}>
            {dishes.map((d) => (
              <div key={d.ko}>
                <div style={{ position: 'relative', aspectRatio: '4 / 3', marginBottom: 24 }}>
                  <ImagePlaceholder label={d.label} />
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
                  <h3 lang="ko" style={{ fontFamily: "'Noto Serif KR', serif", fontWeight: 500, fontSize: 20, color: 'var(--ink)', margin: 0 }}>
                    {d.ko}
                  </h3>
                  <span style={{ flex: 1, height: 1, background: 'var(--gold-a22)' }} />
                  <span style={{ fontFamily: "'Newsreader', serif", fontSize: 19, color: 'var(--gold)' }}>{d.price}</span>
                </div>
                <p style={{ fontSize: 14, lineHeight: 1.9, color: 'var(--ink-a5)', margin: '12px 0 0' }}>{d.note}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
