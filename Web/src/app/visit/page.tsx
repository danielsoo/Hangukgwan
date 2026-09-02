'use client'

import { useLanguage } from '@/context/LanguageContext'
import { useTranslatedInfo } from '@/lib/useTranslatedInfo'
import ImagePlaceholder from '@/components/ImagePlaceholder'

export default function VisitPage() {
  const { tr } = useLanguage()
  const { mainMapUrl, branchMapUrl } = useTranslatedInfo()

  return (
    <main style={{ maxWidth: 1320, margin: '0 auto', padding: 'clamp(60px, 8vw, 110px) clamp(20px, 3.5vw, 48px) clamp(70px, 9vw, 120px)' }}>
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
        {tr.loc.label}
      </p>
      <h1
        style={{
          fontFamily: "'Noto Serif TC', serif",
          fontWeight: 400,
          fontSize: 'clamp(2rem, 4.4vw, 3.1rem)',
          lineHeight: 1.45,
          letterSpacing: '0.06em',
          color: 'var(--ink)',
          margin: '0 0 26px',
          maxWidth: '20ch',
        }}
      >
        {tr.loc.title}
      </h1>
      <p style={{ fontSize: 16, lineHeight: 2, color: 'var(--ink-a6)', margin: '0 0 clamp(48px, 6vw, 76px)', maxWidth: '52ch' }}>{tr.loc.intro}</p>

      <div style={{ display: 'grid', gap: 'clamp(48px, 6vw, 80px)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'clamp(32px, 5vw, 64px)', alignItems: 'start', paddingTop: 34, borderTop: '1px solid var(--gold-a28)' }}>
          <div style={{ position: 'relative', aspectRatio: '4 / 3' }}>
            <ImagePlaceholder label="本店 · Main restaurant" />
          </div>
          <div>
            <p style={{ fontFamily: "'Newsreader', serif", fontSize: 12.5, letterSpacing: '0.24em', color: 'var(--muted)', margin: '0 0 16px' }}>
              Nº 01 · {tr.loc.mainLabel}
            </p>
            <h2 style={{ fontFamily: "'Noto Serif TC', serif", fontWeight: 400, fontSize: 26, letterSpacing: '0.08em', color: 'var(--ink)', margin: '0 0 24px' }}>
              縣政九路本店
            </h2>
            <p style={{ fontSize: 16.5, color: 'var(--ink-a82)', margin: '0 0 4px' }}>新竹縣竹北市縣政九路135巷32號</p>
            <p style={{ fontFamily: "'Newsreader', serif", fontSize: 13.5, color: 'var(--ink-a38)', margin: '0 0 30px' }}>
              No. 32, Ln. 135, Xianzhengjiu Rd., Zhubei City, Hsinchu County
            </p>
            <div style={{ display: 'grid', gap: 12, padding: '26px 0', borderTop: '1px solid var(--gold-a16)', borderBottom: '1px solid var(--gold-a16)', marginBottom: 30 }}>
              <div style={{ display: 'flex', gap: 22, fontSize: 15 }}>
                <span style={{ color: 'var(--muted)', minWidth: '6.5em' }}>{tr.info.hours}</span>
                <span style={{ color: 'var(--ink-a82)' }}>11.00–14.00 · 17.00–21.00</span>
              </div>
              <div style={{ display: 'flex', gap: 22, fontSize: 15 }}>
                <span style={{ color: 'var(--muted)', minWidth: '6.5em' }}>{tr.info.closed}</span>
                <span style={{ color: 'var(--ink-a82)' }}>{tr.info.closedVal}</span>
              </div>
              <div style={{ display: 'flex', gap: 22, fontSize: 15 }}>
                <span style={{ color: 'var(--muted)', minWidth: '6.5em' }}>{tr.info.phoneLabel}</span>
                <a href="tel:0366567994">03-656-7994</a>
              </div>
              <div style={{ display: 'flex', gap: 22, fontSize: 15 }}>
                <span style={{ color: 'var(--muted)', minWidth: '6.5em' }}>{tr.info.min}</span>
                <span style={{ color: 'var(--ink-a82)' }}>NT$200 / {tr.info.perPerson}</span>
              </div>
              <div style={{ display: 'flex', gap: 22, fontSize: 15 }}>
                <span style={{ color: 'var(--muted)', minWidth: '6.5em' }}>{tr.info.booking}</span>
                <span style={{ color: 'var(--ink-a82)' }}>{tr.info.bookingVal}</span>
              </div>
            </div>
            <a href={mainMapUrl} target="_blank" rel="noopener noreferrer" className="hg-cta-outline-gold" style={{ display: 'inline-flex', alignItems: 'center', gap: 14, padding: '15px 30px', fontSize: 13, letterSpacing: '0.16em' }}>
              {tr.loc.mapCta} <span>→</span>
            </a>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'clamp(32px, 5vw, 64px)', alignItems: 'start', paddingTop: 34, borderTop: '1px solid var(--gold-a28)' }}>
          <div style={{ position: 'relative', aspectRatio: '4 / 3' }}>
            <ImagePlaceholder label="直營店 · Corporate branch" />
          </div>
          <div>
            <p style={{ fontFamily: "'Newsreader', serif", fontSize: 12.5, letterSpacing: '0.24em', color: 'var(--muted)', margin: '0 0 16px' }}>
              Nº 02 · {tr.loc.branchLabel}
            </p>
            <h2 style={{ fontFamily: "'Noto Serif TC', serif", fontWeight: 400, fontSize: 26, letterSpacing: '0.08em', color: 'var(--ink)', margin: '0 0 24px' }}>
              太元一街直營店
            </h2>
            <p style={{ fontSize: 16.5, color: 'var(--ink-a82)', margin: '0 0 4px' }}>新竹縣竹北市太元一街7號</p>
            <p style={{ fontFamily: "'Newsreader', serif", fontSize: 13.5, color: 'var(--ink-a38)', margin: '0 0 30px' }}>
              No. 7, Taiyuan 1st St., Zhubei City, Hsinchu County
            </p>
            <div style={{ display: 'grid', gap: 12, padding: '26px 0', borderTop: '1px solid var(--gold-a16)', borderBottom: '1px solid var(--gold-a16)', marginBottom: 26 }}>
              <div style={{ display: 'flex', gap: 22, fontSize: 15 }}>
                <span style={{ color: 'var(--muted)', minWidth: '6.5em' }}>{tr.loc.accessLabel}</span>
                <span style={{ color: 'var(--ink-a82)' }}>{tr.loc.branchAccess}</span>
              </div>
              <div style={{ display: 'flex', gap: 22, fontSize: 15 }}>
                <span style={{ color: 'var(--muted)', minWidth: '6.5em' }}>{tr.loc.nearby}</span>
                <span style={{ color: 'var(--ink-a82)' }}>Samsung · TSMC · 新竹科學園區</span>
              </div>
            </div>
            <p style={{ fontSize: 14, lineHeight: 2, color: 'var(--ink-a45)', margin: '0 0 30px', paddingLeft: 20, borderLeft: '1px solid var(--gold-a3)' }}>
              {tr.loc.branchNote}
            </p>
            <a href={branchMapUrl} target="_blank" rel="noopener noreferrer" className="hg-cta-outline-gold" style={{ display: 'inline-flex', alignItems: 'center', gap: 14, padding: '15px 30px', fontSize: 13, letterSpacing: '0.16em' }}>
              {tr.loc.mapCta} <span>→</span>
            </a>
          </div>
        </div>
      </div>
    </main>
  )
}
