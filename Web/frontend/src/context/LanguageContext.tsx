'use client'

import React, { createContext, useContext, useState, useCallback } from 'react'
import ko from '@/locales/ko'
import en from '@/locales/en'
import zhTW from '@/locales/zh-TW'
import zhCN from '@/locales/zh-CN'
import type { TranslationsType } from '@/locales/ko'

export type Language = 'ko' | 'en' | 'zh-TW' | 'zh-CN'

const translations: Record<Language, TranslationsType> = { ko, en, 'zh-TW': zhTW, 'zh-CN': zhCN }

const langLabels: Record<Language, string> = {
  ko: 'KO',
  en: 'EN',
  'zh-TW': '繁',
  'zh-CN': '简',
}

interface LanguageContextValue {
  lang: Language
  setLang: (lang: Language) => void
  tr: TranslationsType
  langLabels: Record<Language, string>
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Language>('ko')

  const tr = translations[lang]

  return (
    <LanguageContext.Provider value={{ lang, setLang, tr, langLabels }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be inside LanguageProvider')
  return ctx
}
