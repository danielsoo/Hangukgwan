'use client'

// 언어와 화면 밝기 — 헤더의 "설정" 안쪽과 햄버거 메뉴 안쪽에서 같이 쓴다.
//
// 2026-09-09 사장님: "언어와 밝기는 설정에서 바꿀 수 있게 해줘. 그래서 헤더
// 오른쪽에는 설정 로그인 만 있으면 될 것 같아."
//
// 예전에는 언어 알약과 밝기 버튼이 헤더에 그냥 나와 있었다. 손님이 헤더에서
// 가장 자주 쓰는 건 메뉴와 로그인이고, 언어·밝기는 한 번 정하면 잘 안 바꾸는
// 값이라 늘 자리를 차지할 이유가 없다.
//
// 언어는 돌려막기(cycleLang) 대신 세 개를 다 보여주고 고르게 한다 — 원하는
// 언어가 나올 때까지 버튼을 여러 번 누르게 하는 건 고르는 게 아니다.
import { useLanguage } from '@/context/LanguageContext'
import { useTheme } from '@/context/ThemeContext'
import type { Language } from '@/context/LanguageContext'

const LANGS: Language[] = ['ko', 'zh-TW', 'en']

function Row({ label, inset, children }: { label: string; inset: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: `12px ${inset}` }}>
      <p
        style={{
          margin: '0 0 8px',
          fontSize: 'var(--fs-xs)',
          letterSpacing: '0.1em',
          color: 'var(--muted)',
        }}
      >
        {label}
      </p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{children}</div>
    </div>
  )
}

function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={active ? 'hg-choice hg-choice-on' : 'hg-choice'}
      style={{
        padding: '7px 12px',
        fontSize: 'var(--fs-sm)',
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

/** `inset` 은 좌우 여백이다. 이 판은 헤더 아래에 붙으므로 헤더 안쪽 글자와
 *  같은 세로선에서 시작해야 한다 — 안 맞으면 판이 따로 노는 것처럼 보인다.
 *  데스크톱 설정 판과 햄버거 메뉴는 여백이 서로 다르므로 부르는 쪽이 준다. */
export default function SettingsControls({ inset }: { inset: string }) {
  const { tr, lang, setLang, langLabels } = useLanguage()
  const { theme, setTheme } = useTheme()

  return (
    <>
      <Row label={tr.settings.language} inset={inset}>
        {LANGS.map((l) => (
          <Choice key={l} active={lang === l} onClick={() => setLang(l)}>
            {langLabels[l]}
          </Choice>
        ))}
      </Row>
      <Row label={tr.settings.theme} inset={inset}>
        <Choice active={theme === 'light'} onClick={() => setTheme('light')}>
          {tr.settings.light}
        </Choice>
        <Choice active={theme === 'dark'} onClick={() => setTheme('dark')}>
          {tr.settings.dark}
        </Choice>
      </Row>
    </>
  )
}
