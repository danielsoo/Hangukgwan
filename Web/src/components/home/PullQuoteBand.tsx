'use client'

import { useLanguage } from '@/context/LanguageContext'
import ImagePlaceholder from '@/components/ImagePlaceholder'

export default function PullQuoteBand() {
  const { tr } = useLanguage()
  return (
    <section style={{ background: 'var(--bg-alt)', borderTop: '1px solid var(--gold-a14)', borderBottom: '1px solid var(--gold-a14)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'stretch' }}>
        <div style={{ position: 'relative', minHeight: 'clamp(240px, 34vw, 420px)' }}>
          <ImagePlaceholder label="全幅照片 · A room or table photograph" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', padding: 'clamp(48px, 7vw, 90px) clamp(28px, 5vw, 72px)' }}>
          <p
            style={{
              maxWidth: '24ch',
              margin: 0,
              fontFamily: "'Newsreader', serif",
              fontStyle: 'italic',
              fontWeight: 300,
              fontSize: 'clamp(1.3rem, 3vw, 2.1rem)',
              lineHeight: 1.65,
              color: 'var(--ink)',
            }}
          >
            {tr.about.pull}
          </p>
        </div>
      </div>
    </section>
  )
}
