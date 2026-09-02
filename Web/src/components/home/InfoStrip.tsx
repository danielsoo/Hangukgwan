'use client'

import { useLanguage } from '@/context/LanguageContext'

function Cell({ label, children, border = true }: { label: string; children: React.ReactNode; border?: boolean }) {
  return (
    <div style={{ padding: 'clamp(30px, 4vw, 44px) 30px', borderRight: border ? '1px solid var(--gold-a14)' : undefined }}>
      <p
        style={{
          fontFamily: "'Newsreader', serif",
          fontSize: 11,
          letterSpacing: '0.3em',
          textTransform: 'uppercase',
          color: 'var(--accent)',
          margin: '0 0 14px',
        }}
      >
        {label}
      </p>
      {children}
    </div>
  )
}

export default function InfoStrip() {
  const { tr } = useLanguage()
  return (
    <section style={{ background: 'var(--bg)', borderBottom: '1px solid var(--gold-a14)' }}>
      <div
        style={{
          maxWidth: 1320,
          margin: '0 auto',
          padding: '0 clamp(20px, 3.5vw, 48px)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        }}
      >
        <Cell label={tr.info.hours}>
          <p style={{ fontFamily: "'Newsreader', serif", fontSize: 19, letterSpacing: '0.06em', color: 'var(--ink2)', margin: 0, lineHeight: 1.55 }}>
            11.00 – 14.00
            <br />
            17.00 – 21.00
          </p>
        </Cell>
        <Cell label={tr.info.closed}>
          <p style={{ fontSize: 15, color: 'var(--ink3)', margin: 0 }}>{tr.info.closedVal}</p>
        </Cell>
        <Cell label={tr.info.booking}>
          <p style={{ fontSize: 15, color: 'var(--ink3)', margin: 0 }}>{tr.info.bookingVal}</p>
        </Cell>
        <Cell label={tr.info.min} border={false}>
          <p style={{ fontSize: 15, color: 'var(--ink3)', margin: 0 }}>NT$200 / {tr.info.perPerson}</p>
        </Cell>
      </div>
    </section>
  )
}
