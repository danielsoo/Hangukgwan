'use client'

import { useState, useEffect } from 'react'
import { useLanguage, type Language } from '@/context/LanguageContext'

const NAV_SECTIONS = ['about', 'menu', 'values', 'locations', 'contact'] as const

const sectionIds: Record<string, string> = {
  about: 'about',
  menu: 'menu',
  values: 'values',
  locations: 'locations',
  contact: 'contact',
}

export default function Navbar() {
  const { tr, lang, setLang, langLabels } = useLanguage()
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const scrollTo = (id: string) => {
    setMobileOpen(false)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  const langs = Object.keys(langLabels) as Language[]

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled
          ? 'bg-charcoal/95 backdrop-blur-md shadow-lg'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 lg:px-12 h-[72px] flex items-center justify-between">
        {/* Logo */}
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="flex flex-col items-start leading-none group"
        >
          <span className="font-serif text-xl text-cream tracking-wide group-hover:text-primary transition-colors duration-300">
            한국관
          </span>
          <span className="text-[10px] tracking-[0.3em] text-gold font-medium">
            HANGUKGWAN
          </span>
        </button>

        {/* Desktop Nav */}
        <nav className="hidden lg:flex items-center gap-8">
          {NAV_SECTIONS.map((key) => (
            <button
              key={key}
              onClick={() => scrollTo(sectionIds[key])}
              className="nav-link text-sm text-cream/80 hover:text-cream transition-colors duration-200"
            >
              {tr.nav[key as keyof typeof tr.nav]}
            </button>
          ))}
        </nav>

        {/* Language Switcher + Mobile Toggle */}
        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-1">
            {langs.map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`px-2.5 py-1 text-xs rounded transition-all duration-200 ${
                  lang === l
                    ? 'bg-primary text-white'
                    : 'text-cream/60 hover:text-cream/90'
                }`}
              >
                {langLabels[l]}
              </button>
            ))}
          </div>

          {/* Hamburger */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="lg:hidden flex flex-col justify-center gap-1.5 w-6 h-6"
            aria-label="Toggle menu"
          >
            <span
              className={`block w-full h-px bg-cream transition-all duration-300 ${
                mobileOpen ? 'rotate-45 translate-y-[8.5px]' : ''
              }`}
            />
            <span
              className={`block w-full h-px bg-cream transition-all duration-300 ${
                mobileOpen ? 'opacity-0' : ''
              }`}
            />
            <span
              className={`block w-full h-px bg-cream transition-all duration-300 ${
                mobileOpen ? '-rotate-45 -translate-y-[8.5px]' : ''
              }`}
            />
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      <div
        className={`lg:hidden bg-charcoal/98 backdrop-blur-md overflow-hidden transition-all duration-300 ${
          mobileOpen ? 'max-h-[400px] border-t border-white/10' : 'max-h-0'
        }`}
      >
        <div className="px-6 py-6 flex flex-col gap-5">
          {NAV_SECTIONS.map((key) => (
            <button
              key={key}
              onClick={() => scrollTo(sectionIds[key])}
              className="text-left text-cream/80 hover:text-cream text-base transition-colors"
            >
              {tr.nav[key as keyof typeof tr.nav]}
            </button>
          ))}
          <div className="flex items-center gap-2 pt-2 border-t border-white/10">
            {langs.map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`px-3 py-1.5 text-xs rounded transition-all duration-200 ${
                  lang === l
                    ? 'bg-primary text-white'
                    : 'text-cream/60 hover:text-cream/90'
                }`}
              >
                {langLabels[l]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  )
}
