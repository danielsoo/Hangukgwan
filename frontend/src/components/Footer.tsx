'use client'

import { useLanguage } from '@/context/LanguageContext'

export default function Footer() {
  const { tr } = useLanguage()

  return (
    <footer className="bg-charcoal border-t border-white/5 py-12 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Logo */}
          <div className="text-center md:text-left">
            <p className="font-serif text-lg text-cream tracking-wide">한국관</p>
            <p className="text-[10px] tracking-[0.3em] text-gold">HANGUKGWAN</p>
          </div>

          {/* Tagline */}
          <p className="text-muted text-xs tracking-wide text-center">
            {tr.footer.tagline}
          </p>

          {/* Rights */}
          <p className="text-muted text-xs text-center md:text-right">
            {tr.footer.rights}
          </p>
        </div>

        {/* Bottom line */}
        <div className="mt-8 pt-6 border-t border-white/5 flex flex-col md:flex-row items-center justify-center gap-2">
          <p className="text-white/20 text-xs text-center">
            新竹縣竹北市縣政九路135巷32號 · 新竹縣竹北市太元一街7號
          </p>
        </div>
      </div>
    </footer>
  )
}
