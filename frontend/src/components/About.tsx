'use client'

import { useLanguage } from '@/context/LanguageContext'
import { useScrollReveal } from '@/hooks/useScrollReveal'

export default function About() {
  const { tr } = useLanguage()
  const { ref, visible } = useScrollReveal()

  const titleLines = tr.about.title.split('\n')

  return (
    <section
      id="about"
      ref={ref as React.RefObject<HTMLElement>}
      className="bg-cream py-24 lg:py-36 px-6"
    >
      <div className="max-w-6xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-24 items-center">
          {/* Left: heading */}
          <div className={`reveal ${visible ? 'visible' : ''}`}>
            <p className="section-label mb-6">{tr.about.label}</p>
            <h2 className="font-serif text-4xl md:text-5xl lg:text-6xl text-charcoal leading-tight mb-8">
              {titleLines.map((line, i) => (
                <span key={i} className="block">
                  {line}
                </span>
              ))}
            </h2>
            <div className="deco-rule" />
          </div>

          {/* Right: text */}
          <div className={`reveal reveal-delay-2 ${visible ? 'visible' : ''}`}>
            <p className="text-stone/80 text-base md:text-lg leading-relaxed mb-6">
              {tr.about.p1}
            </p>
            <p className="text-stone/80 text-base md:text-lg leading-relaxed">
              {tr.about.p2}
            </p>

            {/* Accent block */}
            <div className="mt-10 pl-5 border-l-2 border-primary">
              <p className="text-muted text-sm italic leading-relaxed">
                Samsung · TSMC · 新竹科學園區
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
