'use client'

import { useLanguage } from '@/context/LanguageContext'
import { ORDER_URL } from '@/lib/config'
import ImagePlaceholder from '@/components/ImagePlaceholder'

const DISHES: { ko: string; zh: string; price: number; badge?: boolean; label: string }[] = [
  { ko: '부대찌개', zh: '部隊鍋 · Army Stew', price: 600, badge: true, label: '부대찌개 部隊鍋' },
  { ko: '돌솥비빔밥', zh: '石鍋拌飯 · Stone Pot Bibimbap', price: 230, badge: true, label: '돌솥비빔밥 石鍋拌飯' },
  { ko: '해물파전', zh: '海鮮煎餅 · Seafood Pancake', price: 240, badge: true, label: '해물파전 海鮮煎餅' },
  { ko: '삼겹살', zh: '生烤五花肉 · Pork Belly', price: 620, label: '삼겹살 生烤五花肉' },
  { ko: '닭갈비', zh: '辣炒雞排 · Spicy Chicken', price: 600, label: '닭갈비 辣炒雞排' },
  { ko: '순두부찌개', zh: '海鮮豆腐鍋 · Soft Tofu Stew', price: 240, label: '순두부찌개 海鮮豆腐鍋' },
]

export default function MenuPage() {
  const { tr } = useLanguage()

  return (
    <main style={{ maxWidth: 'var(--shell-max)', margin: '0 auto', padding: 'clamp(60px, 8vw, 110px) var(--shell-pad) clamp(70px, 9vw, 120px)' }}>
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
        {tr.menuPage.label}
      </p>
      <h1
        style={{
          fontFamily: "'Noto Serif TC', serif",
          fontWeight: 400,
          fontSize: 'var(--fs-display)',
          lineHeight: 1.45,
          letterSpacing: '0.06em',
          color: 'var(--ink)',
          margin: '0 0 26px',
          maxWidth: 'min(22ch, 100%)',
        }}
      >
        {tr.menuPage.title}
      </h1>
      <p style={{ fontSize: 'var(--fs-md)', lineHeight: 2, color: 'var(--ink-a6)', margin: '0 0 clamp(48px, 6vw, 76px)', maxWidth: 'min(52ch, 100%)' }}>
        {tr.menuPage.intro}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 'clamp(32px, 4vw, 52px)', marginBottom: 'clamp(60px, 8vw, 100px)' }}>
        {DISHES.map((d) => (
          <div key={d.ko}>
            <div style={{ position: 'relative', aspectRatio: '3 / 4', marginBottom: 22 }}>
              <ImagePlaceholder label={d.label} />
              {d.badge && (
                <span
                  style={{
                    position: 'absolute',
                    top: 12,
                    left: 12,
                    padding: '4px 10px',
                    background: 'var(--accent)',
                    color: 'var(--on-accent)',
                    fontSize: 'var(--fs-xs)',
                    letterSpacing: '0.16em',
                  }}
                >
                  {tr.sig.badge}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
              <h3 lang="ko" style={{ fontFamily: "'Noto Serif KR', serif", fontWeight: 500, fontSize: 'var(--fs-lg)', color: 'var(--ink)', margin: 0 }}>
                {d.ko}
              </h3>
              <span style={{ flex: 1, height: 1, background: 'var(--gold-a22)' }} />
              <span style={{ fontFamily: "'Newsreader', serif", fontSize: 'var(--fs-lg)', color: 'var(--gold)' }}>{d.price}</span>
            </div>
            <p style={{ fontSize: 'var(--fs-base)', color: 'var(--ink-a5)', margin: '8px 0 0' }}>{d.zh}</p>
          </div>
        ))}
      </div>

      <div style={{ borderTop: '1px solid var(--gold-a18)', paddingTop: 'clamp(48px, 6vw, 76px)' }}>
        <h2 style={{ fontFamily: "'Noto Serif TC', serif", fontWeight: 400, fontSize: 'var(--fs-title)', letterSpacing: '0.06em', color: 'var(--ink)', margin: '0 0 14px' }}>
          {tr.menuPage.catsTitle}
        </h2>
        <p style={{ fontSize: 'var(--fs-base)', color: 'var(--ink-a5)', margin: '0 0 44px', maxWidth: 'min(50ch, 100%)' }}>{tr.menuPage.catsNote}</p>
        <div style={{ display: 'grid', gap: 0, borderTop: '1px solid var(--gold-a16)' }}>
          {tr.menuPage.cats.map((cat) => (
            <div
              key={cat.en}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px 28px',
                padding: '24px 4px',
                borderBottom: '1px solid var(--gold-a16)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
                <span style={{ fontFamily: "'Noto Serif TC', serif", fontSize: 'var(--fs-lg)', letterSpacing: '0.08em', color: 'var(--ink)' }}>{cat.zh}</span>
                <span lang="ko" style={{ fontFamily: "'Noto Serif KR', serif", fontSize: 'var(--fs-base)', color: 'var(--gold)' }}>{cat.ko}</span>
                <span style={{ fontFamily: "'Newsreader', serif", fontSize: 'var(--fs-base)', letterSpacing: '0.1em', color: 'var(--ink-a42)' }}>{cat.en}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 24 }}>
                <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-a42)' }}>{cat.count}</span>
                <span style={{ fontFamily: "'Newsreader', serif", fontSize: 'var(--fs-md)', color: 'var(--ink2)' }}>{cat.range}</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '18px 30px', marginTop: 48 }}>
          <a
            href={ORDER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hg-cta-solid"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 14, padding: '16px 34px', fontSize: 'var(--fs-sm)', fontWeight: 500, letterSpacing: '0.18em' }}
          >
            {tr.menuPage.cta} <span>→</span>
          </a>
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-a5)', margin: 0 }}>{tr.menuPage.ctaNote}</p>
        </div>
      </div>
    </main>
  )
}
