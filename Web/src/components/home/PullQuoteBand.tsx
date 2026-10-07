'use client'

import { useLanguage } from '@/context/LanguageContext'
import ImagePlaceholder from '@/components/ImagePlaceholder'

export default function PullQuoteBand() {
  const { tr } = useLanguage()
  return (
    <section style={{ background: 'var(--bg-alt)', borderTop: '1px solid var(--gold-a14)', borderBottom: '1px solid var(--gold-a14)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'stretch' }}>
        <div style={{ position: 'relative', minHeight: 'clamp(240px, 34vw, 420px)' }}>
          <ImagePlaceholder
            label="十種小菜 · Ten Korean side dishes"
            src="/images/editorial/banchan-ten-dishes.jpg"
            alt="검은 그릇에 정갈하게 담긴 한국관의 반찬 열 가지"
          />
        </div>
        {/* minWidth: 0 이 없으면 안의 글이 자기 칸보다 넓어져도 줄어들지
            않는다(flex 항목의 기본 최소폭은 내용 크기다). 800px 폭에서
            인용구가 오른쪽으로 12px 삐져나와 가로 스크롤이 걸렸다. */}
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, padding: 'clamp(48px, 7vw, 90px) clamp(28px, 5vw, 72px)' }}>
          <p
            style={{
              maxWidth: 'min(24ch, 100%)',
              margin: 0,
              fontFamily: "'Newsreader', serif",
              fontStyle: 'italic',
              fontWeight: 300,
              fontSize: 'var(--fs-title)',
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
