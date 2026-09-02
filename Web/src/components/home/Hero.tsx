'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/context/LanguageContext'
import { getStoreStatus } from '@/lib/storeStatus'
import { ORDER_URL } from '@/lib/config'
import ImagePlaceholder from '@/components/ImagePlaceholder'

export default function Hero() {
  const { tr, lang } = useLanguage()
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const status = now ? getStoreStatus(lang, now) : null

  return (
    <section style={{ position: 'relative', overflow: 'hidden', background: 'var(--bg)' }}>
      <div style={{ position: 'relative', height: 'clamp(260px, 46vh, 480px)' }}>
        <ImagePlaceholder label="店內夜景 · A low-lit interior photograph" />
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(to bottom, var(--scrim-45) 0%, var(--scrim-20) 40%, var(--scrim-90) 88%, var(--bg) 100%)',
            pointerEvents: 'none',
          }}
        />
      </div>
      <div
        aria-hidden="true"
        style={{ position: 'absolute', inset: 'clamp(14px, 2.2vw, 30px)', border: '1px solid var(--gold-a28)', pointerEvents: 'none' }}
      />

      <div
        style={{
          position: 'relative',
          marginTop: 'clamp(-70px, -7vw, -40px)',
          padding: '0 clamp(28px, 5vw, 60px) clamp(56px, 8vw, 96px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        <p
          style={{
            fontFamily: "'Newsreader', serif",
            fontSize: 'clamp(11px, 1.3vw, 13px)',
            letterSpacing: '0.4em',
            textTransform: 'uppercase',
            color: 'var(--accent)',
            margin: '0 0 clamp(28px, 4vw, 44px)',
          }}
        >
          {tr.hero.eyebrow}
        </p>
        <h1
          style={{
            fontFamily: "'Noto Serif TC', serif",
            fontWeight: 400,
            fontSize: 'clamp(3.3rem, 11.5vw, 8rem)',
            lineHeight: 1.05,
            letterSpacing: '0.1em',
            color: 'var(--ink)',
            margin: 0,
            textIndent: '0.1em',
          }}
        >
          韓國館
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(16px, 3vw, 28px)', margin: 'clamp(26px, 4vw, 38px) 0' }}>
          <span style={{ display: 'block', width: 'clamp(36px, 8vw, 86px)', height: 1, background: 'linear-gradient(to right, var(--gold-a0) 0%, var(--gold-a7) 100%)' }} />
          <span
            lang="ko"
            style={{ fontFamily: "'Noto Serif KR', serif", fontWeight: 500, fontSize: 'clamp(0.95rem, 2.2vw, 1.3rem)', letterSpacing: '0.3em', color: 'var(--gold)', whiteSpace: 'nowrap' }}
          >
            한국관
          </span>
          <span style={{ display: 'block', width: 'clamp(36px, 8vw, 86px)', height: 1, background: 'linear-gradient(to left, var(--gold-a0) 0%, var(--gold-a7) 100%)' }} />
        </div>
        <p style={{ maxWidth: '32ch', fontSize: 'clamp(1rem, 1.9vw, 1.22rem)', fontWeight: 300, lineHeight: 1.95, color: 'var(--ink-a78)', margin: '0 0 clamp(34px, 5vw, 50px)' }}>
          {tr.hero.tag}
        </p>

        {status && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 11, marginBottom: 'clamp(30px, 4vw, 44px)' }}>
            <span style={{ display: 'block', width: 6, height: 6, borderRadius: '50%', background: status.dot }} />
            <span style={{ fontSize: 12.5, letterSpacing: '0.14em', color: 'var(--ink-a66)' }}>{status.text}</span>
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 16 }}>
          <Link href="/menu/" className="hg-cta-solid" style={{ padding: '17px 38px', fontSize: 13, fontWeight: 500, letterSpacing: '0.2em' }}>
            {tr.hero.cta1}
          </Link>
          <a href={ORDER_URL} target="_blank" rel="noopener noreferrer" className="hg-cta-outline" style={{ padding: '17px 38px', fontSize: 13, letterSpacing: '0.2em' }}>
            {tr.hero.cta2}
          </a>
        </div>
      </div>
    </section>
  )
}
