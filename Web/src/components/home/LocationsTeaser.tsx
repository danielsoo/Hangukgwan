'use client'

import { useLanguage } from '@/context/LanguageContext'
import { useTranslatedInfo } from '@/lib/useTranslatedInfo'
import ImagePlaceholder from '@/components/ImagePlaceholder'

export default function LocationsTeaser() {
  const { tr } = useLanguage()
  const { mainMapUrl, branchMapUrl } = useTranslatedInfo()

  return (
    <section style={{ background: 'var(--bg)' }}>
      <div style={{ maxWidth: 1320, margin: '0 auto', padding: 'clamp(70px, 10vw, 130px) clamp(20px, 3.5vw, 48px)' }}>
        <div style={{ textAlign: 'center', marginBottom: 'clamp(44px, 6vw, 72px)' }}>
          <p
            style={{
              fontFamily: "'Newsreader', serif",
              fontSize: 11.5,
              letterSpacing: '0.34em',
              textTransform: 'uppercase',
              color: 'var(--accent)',
              margin: '0 0 22px',
            }}
          >
            {tr.loc.label}
          </p>
          <h2
            style={{
              fontFamily: "'Noto Serif TC', serif",
              fontWeight: 400,
              fontSize: 'clamp(1.85rem, 3.8vw, 2.8rem)',
              lineHeight: 1.5,
              letterSpacing: '0.06em',
              color: 'var(--ink)',
              margin: 0,
            }}
          >
            {tr.loc.title}
          </h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'clamp(36px, 5vw, 72px)' }}>
          <div>
            <div style={{ position: 'relative', aspectRatio: '16 / 10', marginBottom: 30 }}>
              <ImagePlaceholder label="本店 · Main restaurant" />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 20 }}>
              <span style={{ fontFamily: "'Newsreader', serif", fontSize: 12.5, letterSpacing: '0.2em', color: 'var(--muted)' }}>Nº 01</span>
              <h3 style={{ fontFamily: "'Noto Serif TC', serif", fontWeight: 400, fontSize: 23, letterSpacing: '0.08em', color: 'var(--ink)', margin: 0 }}>
                {tr.loc.mainLabel}
              </h3>
            </div>
            <p style={{ fontSize: 16, color: 'var(--ink-a8)', margin: '0 0 4px' }}>新竹縣竹北市縣政九路135巷32號</p>
            <p style={{ fontFamily: "'Newsreader', serif", fontSize: 13.5, color: 'var(--ink-a38)', margin: '0 0 26px' }}>
              No. 32, Ln. 135, Xianzhengjiu Rd., Zhubei City
            </p>
            <div style={{ display: 'grid', gap: 11, paddingTop: 24, borderTop: '1px solid var(--gold-a16)', marginBottom: 28 }}>
              <div style={{ display: 'flex', gap: 20, fontSize: 14.5 }}>
                <span style={{ color: 'var(--muted)', minWidth: '6em' }}>{tr.info.hours}</span>
                <span style={{ color: 'var(--ink-a8)' }}>11.00–14.00 · 17.00–21.00</span>
              </div>
              <div style={{ display: 'flex', gap: 20, fontSize: 14.5 }}>
                <span style={{ color: 'var(--muted)', minWidth: '6em' }}>{tr.info.closed}</span>
                <span style={{ color: 'var(--ink-a8)' }}>{tr.info.closedVal}</span>
              </div>
              <div style={{ display: 'flex', gap: 20, fontSize: 14.5 }}>
                <span style={{ color: 'var(--muted)', minWidth: '6em' }}>{tr.info.phoneLabel}</span>
                <a href="tel:0366567994">03-656-7994</a>
              </div>
            </div>
            <a
              href={mainMapUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 12, fontFamily: "'Newsreader', serif", fontSize: 13.5, letterSpacing: '0.22em', textTransform: 'uppercase' }}
            >
              {tr.loc.mapCta} <span>→</span>
            </a>
          </div>

          <div>
            <div style={{ position: 'relative', aspectRatio: '16 / 10', marginBottom: 30 }}>
              <ImagePlaceholder label="直營店 · Corporate branch" />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 20 }}>
              <span style={{ fontFamily: "'Newsreader', serif", fontSize: 12.5, letterSpacing: '0.2em', color: 'var(--muted)' }}>Nº 02</span>
              <h3 style={{ fontFamily: "'Noto Serif TC', serif", fontWeight: 400, fontSize: 23, letterSpacing: '0.08em', color: 'var(--ink)', margin: 0 }}>
                {tr.loc.branchLabel}
              </h3>
            </div>
            <p style={{ fontSize: 16, color: 'var(--ink-a8)', margin: '0 0 4px' }}>新竹縣竹北市太元一街7號</p>
            <p style={{ fontFamily: "'Newsreader', serif", fontSize: 13.5, color: 'var(--ink-a38)', margin: '0 0 26px' }}>
              No. 7, Taiyuan 1st St., Zhubei City
            </p>
            <div style={{ display: 'grid', gap: 11, paddingTop: 24, borderTop: '1px solid var(--gold-a16)', marginBottom: 22 }}>
              <div style={{ display: 'flex', gap: 20, fontSize: 14.5 }}>
                <span style={{ color: 'var(--muted)', minWidth: '6em' }}>{tr.loc.accessLabel}</span>
                <span style={{ color: 'var(--ink-a8)' }}>{tr.loc.branchAccess}</span>
              </div>
              <div style={{ display: 'flex', gap: 20, fontSize: 14.5 }}>
                <span style={{ color: 'var(--muted)', minWidth: '6em' }}>{tr.loc.nearby}</span>
                <span style={{ color: 'var(--ink-a8)' }}>Samsung · TSMC</span>
              </div>
            </div>
            <p style={{ fontSize: 13.5, lineHeight: 1.9, color: 'var(--ink-a4)', margin: '0 0 28px', paddingLeft: 20, borderLeft: '1px solid var(--gold-a3)' }}>
              {tr.loc.branchNote}
            </p>
            <a
              href={branchMapUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 12, fontFamily: "'Newsreader', serif", fontSize: 13.5, letterSpacing: '0.22em', textTransform: 'uppercase' }}
            >
              {tr.loc.mapCta} <span>→</span>
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
