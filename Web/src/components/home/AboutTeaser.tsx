'use client'

import Link from 'next/link'
import { useLanguage } from '@/context/LanguageContext'
import ImagePlaceholder from '@/components/ImagePlaceholder'

export default function AboutTeaser() {
  const { tr } = useLanguage()
  return (
    <section style={{ background: 'var(--bg)' }}>
      <div style={{ maxWidth: 1320, margin: '0 auto', padding: 'clamp(70px, 10vw, 140px) clamp(20px, 3.5vw, 48px)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'clamp(44px, 6vw, 96px)', alignItems: 'center' }}>
          <div style={{ position: 'relative', aspectRatio: '4 / 5' }}>
            <ImagePlaceholder label="廚房或老闆夫妻 · Kitchen or owners" />
          </div>
          <div>
            <p
              style={{
                fontFamily: "'Newsreader', serif",
                fontSize: 11.5,
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
                fontSize: 'clamp(1.85rem, 3.6vw, 2.75rem)',
                lineHeight: 1.55,
                letterSpacing: '0.05em',
                color: 'var(--ink)',
                margin: '0 0 30px',
                maxWidth: '19ch',
              }}
            >
              {tr.about.title}
            </h2>
            <span style={{ display: 'block', width: 56, height: 1, background: 'var(--gold)', marginBottom: 30 }} />
            <p style={{ fontSize: 16, lineHeight: 2.05, color: 'var(--ink-a72)', margin: '0 0 22px' }}>{tr.about.p1}</p>
            <p style={{ fontSize: 16, lineHeight: 2.05, color: 'var(--ink-a72)', margin: '0 0 36px' }}>{tr.about.p2}</p>
            <Link
              href="/about/"
              className="hg-link-arrow"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 12, fontFamily: "'Newsreader', serif", fontSize: 14, letterSpacing: '0.22em', textTransform: 'uppercase' }}
            >
              {tr.about.more} <span>→</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
