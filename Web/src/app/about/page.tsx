'use client'

import { useLanguage } from '@/context/LanguageContext'
import ImagePlaceholder from '@/components/ImagePlaceholder'

export default function AboutPage() {
  const { tr } = useLanguage()

  return (
    <main>
      <section style={{ maxWidth: 'var(--shell-max)', margin: '0 auto', padding: 'clamp(60px, 8vw, 110px) var(--shell-pad) clamp(50px, 6vw, 84px)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'clamp(44px, 6vw, 92px)', alignItems: 'center' }}>
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
              {tr.about.label}
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
              {tr.about.title}
            </h1>
            <span style={{ display: 'block', width: 56, height: 1, background: 'var(--gold)', marginBottom: 32 }} />
            <p style={{ fontSize: 'var(--fs-md)', lineHeight: 2.1, color: 'var(--ink-a75)', margin: '0 0 22px' }}>{tr.about.p1}</p>
            <p style={{ fontSize: 'var(--fs-md)', lineHeight: 2.1, color: 'var(--ink-a75)', margin: '0 0 22px' }}>{tr.about.p2}</p>
            <p style={{ fontSize: 'var(--fs-md)', lineHeight: 2.1, color: 'var(--ink-a75)', margin: 0 }}>{tr.about.p3}</p>
          </div>
          <div
            style={{
              position: 'relative',
              aspectRatio: '4 / 5',
              overflow: 'hidden',
              border: '1px solid var(--gold-a22)',
              background: 'var(--bg-alt)',
            }}
          >
            <ImagePlaceholder
              label="韓國館總店 · Hangukgwan main restaurant"
              src="/images/locations/main-exterior-building-vertical.jpg"
              alt="밤에 불이 켜진 한국관 본점 건물과 붉은 간판"
              objectPosition="center"
            />
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(to bottom, transparent 55%, var(--scrim-65) 100%)',
                pointerEvents: 'none',
              }}
            />
            <p
              style={{
                position: 'absolute',
                left: 'clamp(18px, 3vw, 34px)',
                bottom: 'clamp(18px, 3vw, 30px)',
                margin: 0,
                fontFamily: "'Noto Serif TC', serif",
                fontSize: 'var(--fs-sm)',
                letterSpacing: '0.18em',
                color: 'var(--ink)',
              }}
            >
              韓國館 · 竹北總店
            </p>
          </div>
        </div>
      </section>

      <section style={{ background: 'var(--bg-alt)', borderTop: '1px solid var(--gold-a14)', borderBottom: '1px solid var(--gold-a14)' }}>
        <div style={{ maxWidth: 'var(--shell-max)', margin: '0 auto', padding: 'clamp(64px, 8vw, 110px) var(--shell-pad)' }}>
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
            {tr.about.valuesLabel}
          </p>
          <h2
            style={{
              fontFamily: "'Noto Serif TC', serif",
              fontWeight: 400,
              fontSize: 'var(--fs-title)',
              lineHeight: 1.55,
              letterSpacing: '0.05em',
              color: 'var(--ink)',
              margin: '0 0 clamp(44px, 6vw, 68px)',
              maxWidth: 'min(24ch, 100%)',
            }}
          >
            {tr.about.valuesTitle}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'clamp(32px, 4vw, 64px)' }}>
            {tr.about.values.map((v) => (
              <div key={v.n} style={{ paddingTop: 26, borderTop: '1px solid var(--gold-a28)' }}>
                <p style={{ fontFamily: "'Newsreader', serif", fontSize: 'var(--fs-sm)', letterSpacing: '0.24em', color: 'var(--muted)', margin: '0 0 24px' }}>Nº 0{v.n}</p>
                <h3 style={{ fontFamily: "'Noto Serif TC', serif", fontWeight: 400, fontSize: 'var(--fs-lg)', letterSpacing: '0.08em', color: 'var(--ink)', margin: '0 0 18px' }}>
                  {v.t}
                </h3>
                <p style={{ fontSize: 'var(--fs-base)', lineHeight: 2, color: 'var(--ink-a55)', margin: 0 }}>{v.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ maxWidth: 'var(--shell-max)', margin: '0 auto', padding: 'clamp(60px, 8vw, 100px) var(--shell-pad)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'clamp(14px, 2vw, 24px)' }}>
          <div style={{ position: 'relative', aspectRatio: '1 / 1' }}>
            <ImagePlaceholder
              label="炒鍋 · Wok cooking"
              src="/images/editorial/kitchen-wok-flame.jpg"
              alt="강한 불 위에서 웍으로 음식을 볶는 한국관 주방"
            />
          </div>
          <div style={{ position: 'relative', aspectRatio: '1 / 1' }}>
            <ImagePlaceholder
              label="備料 · Ingredient preparation"
              src="/images/editorial/kitchen-chopping.jpg"
              alt="둥근 나무 도마에서 채소를 손질하는 모습"
            />
          </div>
          <div style={{ position: 'relative', aspectRatio: '1 / 1' }}>
            <ImagePlaceholder
              label="米飯 · Fresh rice"
              src="/images/editorial/kitchen-rice.jpg"
              alt="갓 지은 흰쌀밥을 주걱으로 푸는 모습"
            />
          </div>
          <div style={{ position: 'relative', aspectRatio: '1 / 1' }}>
            <ImagePlaceholder
              label="小菜 · Banchan plating"
              src="/images/editorial/kitchen-banchan-plating.jpg"
              alt="작은 검은 그릇에 반찬을 정갈하게 담는 모습"
            />
          </div>
        </div>
      </section>
    </main>
  )
}
