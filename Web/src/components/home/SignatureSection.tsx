'use client'

import Link from 'next/link'
import { useLanguage } from '@/context/LanguageContext'
import ImagePlaceholder from '@/components/ImagePlaceholder'

const DISHES: { n: string; ko: string; zh: string; price: number; badge?: boolean }[] = [
  { n: '01', ko: '부대찌개', zh: '部隊鍋 · Army Stew · 3–4 人分食', price: 600, badge: true },
  { n: '02', ko: '돌솥비빔밥', zh: '石鍋拌飯 · Stone Pot Bibimbap', price: 230, badge: true },
  { n: '03', ko: '해물파전', zh: '海鮮煎餅 · Seafood Pancake · 現點現煎', price: 240, badge: true },
  { n: '04', ko: '삼겹살', zh: '生烤五花肉 · Pork Belly · 2 人份', price: 620 },
  { n: '05', ko: '닭갈비', zh: '辣炒雞排 · Spicy Chicken', price: 600 },
  { n: '06', ko: '순두부찌개', zh: '海鮮豆腐鍋 · Soft Tofu Stew', price: 240 },
  { n: '07', ko: '동판불고기', zh: '銅盤烤肉 · Bulgogi · 2 人份 · 牛 / 豬', price: 500 },
]

export default function SignatureSection() {
  const { tr } = useLanguage()
  return (
    <section style={{ background: 'var(--bg-alt)' }}>
      <div style={{ maxWidth: 1320, margin: '0 auto', padding: 'clamp(70px, 10vw, 140px) clamp(20px, 3.5vw, 48px)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'clamp(44px, 6vw, 96px)', alignItems: 'start' }}>
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
              {tr.sig.label}
            </p>
            <h2
              style={{
                fontFamily: "'Noto Serif TC', serif",
                fontWeight: 400,
                fontSize: 'clamp(1.9rem, 3.8vw, 2.9rem)',
                lineHeight: 1.5,
                letterSpacing: '0.05em',
                color: 'var(--ink)',
                margin: '0 0 30px',
                maxWidth: '18ch',
              }}
            >
              {tr.sig.title}
            </h2>
            <span style={{ display: 'block', width: 56, height: 1, background: 'var(--gold)', marginBottom: 30 }} />
            <p style={{ fontSize: 15, lineHeight: 1.95, color: 'var(--ink-a5)', margin: '0 0 40px', maxWidth: '40ch' }}>{tr.sig.note}</p>
            <div style={{ position: 'relative', aspectRatio: '4 / 5' }}>
              <ImagePlaceholder label="招牌菜特寫 · A signature dish, close up" />
            </div>
          </div>

          <div>
            <div style={{ display: 'grid', gap: 0 }}>
              {DISHES.map((d) => (
                <div key={d.n} className="hg-row-hover" style={{ padding: '26px 0', borderBottom: '1px solid var(--gold-a16)' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: "'Newsreader', serif", fontSize: 12.5, letterSpacing: '0.2em', color: 'var(--muted)', minWidth: '3.4em' }}>
                      Nº {d.n}
                    </span>
                    <h3 lang="ko" style={{ fontFamily: "'Noto Serif KR', serif", fontWeight: 500, fontSize: 'clamp(1.3rem, 2.4vw, 1.7rem)', color: 'var(--ink)', margin: 0 }}>
                      {d.ko}
                    </h3>
                    {d.badge && (
                      <span style={{ padding: '3px 9px', border: '1px solid var(--gold-a3)', fontSize: 10.5, letterSpacing: '0.16em', color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                        {tr.sig.badge}
                      </span>
                    )}
                    <span style={{ flex: 1, minWidth: 24, height: 1, background: 'var(--gold-a22)' }} />
                    <span style={{ fontFamily: "'Newsreader', serif", fontSize: 22, letterSpacing: '0.04em', color: 'var(--gold)' }}>{d.price}</span>
                  </div>
                  <p style={{ fontSize: 14.5, color: 'var(--ink-a55)', margin: '9px 0 0', paddingLeft: 'calc(3.4em + 18px)' }}>{d.zh}</p>
                </div>
              ))}
            </div>
            <Link
              href="/menu/"
              className="hg-link-arrow"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 12, marginTop: 38, fontFamily: "'Newsreader', serif", fontSize: 14, letterSpacing: '0.22em', textTransform: 'uppercase' }}
            >
              {tr.sig.all} <span>→</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
