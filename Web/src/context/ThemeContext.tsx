'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'hgw-theme'

interface ThemeContextValue {
  theme: Theme
  /** 지금 값을 뒤집는다. 아이콘 하나짜리 토글용. */
  toggleTheme: () => void
  /** 원하는 값을 직접 고른다 — 설정 화면처럼 "밝게/어둡게"를 나란히 보여줄
   *  때는 뒤집기가 아니라 고르기여야 한다. */
  setTheme: (next: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light')
  else document.documentElement.removeAttribute('data-theme')
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)
      if (saved === 'light' || saved === 'dark') {
        setTheme(saved)
        applyTheme(saved)
      }
    } catch {
      // ignore — the anti-flash inline script in <head> already set the DOM attribute
    }
  }, [])

  const choose = (next: Theme) => {
    setTheme(next)
    applyTheme(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignore
    }
  }

  const toggleTheme = () => choose(theme === 'light' ? 'dark' : 'light')

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme: choose }}>{children}</ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be inside ThemeProvider')
  return ctx
}
