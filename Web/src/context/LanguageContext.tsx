'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import zhTW from '@/locales/zh-TW'
import ko from '@/locales/ko'
import en from '@/locales/en'
import type { TranslationsType } from '@/locales/types'

export type Language = 'zh-TW' | 'ko' | 'en'

const ORDER: Language[] = ['zh-TW', 'ko', 'en']

const translations: Record<Language, TranslationsType> = { 'zh-TW': zhTW, ko, en }

const langLabels: Record<Language, string> = {
  'zh-TW': '中文',
  ko: '한국어',
  en: 'EN',
}

const langTitles: Record<Language, string> = {
  'zh-TW': '切換語言 · 한국어 · EN',
  ko: '언어 변경 · 中文 · EN',
  en: 'Change language · 中文 · 한국어',
}

const STORAGE_KEY = 'hgw-lang'

/* <html lang> 에 넣을 표준 언어 태그 */
const HTML_LANG: Record<Language, string> = {
  'zh-TW': 'zh-Hant',
  ko: 'ko',
  en: 'en',
}

interface LanguageContextValue {
  lang: Language
  setLang: (lang: Language) => void
  cycleLang: () => void
  tr: TranslationsType
  langLabels: Record<Language, string>
  langLabel: string
  langTitle: string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>('zh-TW')

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY) as Language | null
      if (saved && translations[saved]) setLangState(saved)
    } catch {
      // localStorage unavailable — keep default
    }
  }, [])

  /* <html lang> 을 실제로 보고 있는 언어에 맞춘다.
     layout.tsx 는 lang="zh-Hant" 를 박아 두고 한 번도 바꾸지 않았다. 그래서
     한국어로 보고 있어도 브라우저·읽어주는 프로그램·CSS 의 :lang() 은 전부
     중국어로 알고 있었다. 줄바꿈 규칙(word-break)이 언어마다 다르기 때문에
     이게 그대로 화면 문제로 나왔다. */
  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = HTML_LANG[lang]
  }, [lang])

  const setLang = (next: Language) => {
    setLangState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignore
    }
  }

  const cycleLang = () => {
    const next = ORDER[(ORDER.indexOf(lang) + 1) % ORDER.length]
    setLang(next)
  }

  const tr = translations[lang]

  return (
    <LanguageContext.Provider
      value={{
        lang,
        setLang,
        cycleLang,
        tr,
        langLabels,
        langLabel: langLabels[lang],
        langTitle: langTitles[lang],
      }}
    >
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be inside LanguageProvider')
  return ctx
}
