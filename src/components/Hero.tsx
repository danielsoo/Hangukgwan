'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'

export default function Hero() {
  const { tr } = useLanguage()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 100)
    return () => clearTimeout(t)
  }, [])

  const scrollToMenu = () => {
    document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <section
      id="home"
      className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-charcoal"
    >
      {/* Background ghost character */}
      <div
        aria-hidden
        className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden"
      >
        <span
          className="font-serif text-[55vw] md:text-[38vw] text-white/[0.025] leading-none"
          style={{ userSelect: 'none' }}
        >
          韓
        </span>
      </div>

      {/* Decorative top line */}
      <div
        aria-hidden
        className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent"
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center text-center px-6 max-w-4xl mx-auto">
        {/* Eyebrow */}
        <p
          className={`section-label text-cream/50 mb-8 transition-all duration-700 ${
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
          style={{ transitionDelay: '0.1s' }}
        >
          — {tr.hero.eyebrow} —
        </p>

        {/* Main title */}
        <h1
          className={`font-serif text-[clamp(4rem,15vw,10rem)] leading-none text-cream tracking-tight mb-4 transition-all duration-700 ${
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
          }`}
          style={{ transitionDelay: '0.25s' }}
          lang="ko"
        >
          {tr.hero.title}
        </h1>

        {/* Romanized / translated name */}
        <p
          className={`text-[clamp(0.65rem,2.5vw,0.9rem)] tracking-[0.5em] text-gold font-medium mb-10 transition-all duration-700 ${
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
          style={{ transitionDelay: '0.4s' }}
        >
          {tr.hero.romanized}
        </p>

        {/* Thin divider */}
        <div
          className={`flex items-center gap-4 mb-10 transition-all duration-700 ${
            mounted ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ transitionDelay: '0.5s' }}
          aria-hidden
        >
          <span className="block w-16 h-px bg-cream/20" />
          <span className="block w-2 h-2 rounded-full bg-primary" />
          <span className="block w-16 h-px bg-cream/20" />
        </div>

        {/* Tagline */}
        <p
          className={`text-cream/70 text-base md:text-lg font-light mb-12 transition-all duration-700 ${
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
          style={{ transitionDelay: '0.55s' }}
        >
          {tr.hero.tagline}
        </p>

        {/* CTA */}
        <button
          onClick={scrollToMenu}
          className={`group relative px-10 py-4 border border-cream/30 text-cream text-sm tracking-[0.2em] uppercase hover:border-primary hover:text-primary transition-all duration-300 ${
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
          style={{ transitionDelay: '0.7s' }}
        >
          <span className="relative z-10">{tr.hero.cta}</span>
          <span
            aria-hidden
            className="absolute inset-0 bg-primary scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left opacity-10"
          />
        </button>
      </div>

      {/* Scroll indicator */}
      <div
        className={`absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 transition-all duration-700 ${
          mounted ? 'opacity-40' : 'opacity-0'
        }`}
        style={{ transitionDelay: '1s' }}
        aria-hidden
      >
        <div className="w-px h-12 bg-cream/50 animate-pulse" />
      </div>
    </section>
  )
}
