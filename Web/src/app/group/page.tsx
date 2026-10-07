'use client'

import { useLanguage } from '@/context/LanguageContext'
import ImagePlaceholder from '@/components/ImagePlaceholder'
import { useDishPhotos } from '@/lib/menuPhotos'

export default function GroupPage() {
  const { tr } = useLanguage()
  const photoOf = useDishPhotos()
  const dishes = [
    { n: '01', ko: '부대찌개', zh: '部隊鍋', price: 600, note: tr.group.d1, label: '부대찌개 部隊鍋' },
    { n: '02', ko: '동판불고기', zh: '銅盤烤肉', price: 500, note: tr.group.d2, label: '동판불고기 銅盤烤肉' },
    { n: '03', ko: '닭갈비', zh: '辣炒雞排', price: 600, note: tr.group.d3, label: '닭갈비 辣炒雞排' },
  ]

  return (
    <main>
      <section style={{ maxWidth: 'var(--shell-max)', margin: '0 auto', padding: 'clamp(60px, 8vw, 110px) var(--shell-pad) clamp(50px, 6vw, 84px)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'clamp(44px, 6vw, 92px)', alignItems: 'start' }}>
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
              {tr.group.label}
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
              {tr.group.title}
            </h1>
            <span style={{ display: 'block', width: 56, height: 1, background: 'var(--gold)', marginBottom: 32 }} />
            <p style={{ fontSize: 'var(--fs-md)', lineHeight: 2.1, color: 'var(--ink-a75)', margin: '0 0 22px' }}>{tr.group.p1}</p>
            <p style={{ fontSize: 'var(--fs-md)', lineHeight: 2.1, color: 'var(--ink-a75)', margin: '0 0 38px' }}>{tr.group.p2}</p>
            <a
              href="tel:0366567994"
              className="hg-cta-solid"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 14, padding: '18px 34px', fontSize: 'var(--fs-sm)', fontWeight: 500, letterSpacing: '0.14em' }}
            >
              {tr.group.cta} · 03 656 7994
            </a>
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-a45)', margin: '18px 0 0' }}>{tr.group.ctaNote}</p>
          </div>
          <div style={{ display: 'grid', gap: 0, borderTop: '1px solid var(--gold-a28)' }}>
            {tr.group.rows.map((row) => (
              <div key={row.k} style={{ padding: '24px 4px', borderBottom: '1px solid var(--gold-a16)' }}>
                <p
                  style={{
                    fontFamily: "'Newsreader', serif",
                    fontSize: 'var(--fs-xs)',
                    letterSpacing: '0.26em',
                    textTransform: 'uppercase',
                    color: 'var(--accent)',
                    margin: '0 0 10px',
                  }}
                >
                  {row.k}
                </p>
                <p style={{ fontSize: 'var(--fs-base)', lineHeight: 1.85, color: 'var(--ink-a82)', margin: 0 }}>{row.v}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="hg-group-menu">
        <div className="hg-group-menu-inner">
          <div className="hg-group-menu-head">
            <div>
              <p className="hg-group-menu-label">{tr.group.dishesLabel}</p>
              <h2>{tr.group.dishesTitle}</h2>
            </div>
            <div className="hg-group-menu-callout">
              <span>{tr.group.ctaNote}</span>
              <a href="tel:0366567994">{tr.group.cta} · 03 656 7994 <span aria-hidden="true">→</span></a>
            </div>
          </div>

          <div className="hg-group-dishes">
            {dishes.map((d) => (
              <article key={d.ko} className="hg-group-dish-card">
                <div className="hg-group-dish-photo">
                  <ImagePlaceholder label={d.label} src={photoOf(d.ko)} alt={`${d.ko} ${d.zh}`} />
                  <span className="hg-group-dish-number" aria-hidden="true">{d.n}</span>
                  <span className="hg-group-dish-zh">{d.zh}</span>
                </div>
                <div className="hg-group-dish-body">
                  <div className="hg-group-dish-title">
                    <h3 lang="ko">{d.ko}</h3>
                    <span aria-hidden="true" />
                    <strong>NT${d.price}</strong>
                  </div>
                  <p>{d.note}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
