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
