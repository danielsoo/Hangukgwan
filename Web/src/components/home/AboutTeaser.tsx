'use client'

import Link from 'next/link'
import { useLanguage } from '@/context/LanguageContext'
import ImagePlaceholder from '@/components/ImagePlaceholder'

export default function AboutTeaser() {
  const { tr } = useLanguage()
  return (
    <section className="hg-about-teaser">
      <div className="hg-about-teaser-inner">
        <div className="hg-about-teaser-grid">
          <div className="hg-editorial-portrait hg-editorial-portrait-about">
            <ImagePlaceholder
              label="廚房備料 · Kitchen preparation"
              src="/images/editorial/kitchen-chopping.jpg"
              alt="한국관 주방에서 채소를 손질하는 모습"
            />
            <span className="hg-editorial-caption" aria-hidden="true">每日現做 · MADE EACH MORNING</span>
          </div>
          <div className="hg-about-teaser-copy">
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
              {tr.about.label}
            </p>
            <h2
              style={{
                fontFamily: "'Noto Serif TC', serif",
                fontWeight: 400,
                fontSize: 'var(--fs-display)',
                lineHeight: 1.55,
                letterSpacing: '0.05em',
                color: 'var(--ink)',
                margin: '0 0 30px',
                maxWidth: 'min(19ch, 100%)',
              }}
            >
              {tr.about.title}
            </h2>
            <span style={{ display: 'block', width: 56, height: 1, background: 'var(--gold)', marginBottom: 30 }} />
            <p style={{ fontSize: 'var(--fs-md)', lineHeight: 2.05, color: 'var(--ink-a72)', margin: '0 0 22px' }}>{tr.about.p1}</p>
            <p style={{ fontSize: 'var(--fs-md)', lineHeight: 2.05, color: 'var(--ink-a72)', margin: '0 0 36px' }}>{tr.about.p2}</p>
            <Link
              href="/about/"
              className="hg-link-arrow"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 12, fontFamily: "'Newsreader', serif", fontSize: 'var(--fs-base)', letterSpacing: '0.22em', textTransform: 'uppercase' }}
            >
              {tr.about.more} <span>→</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
