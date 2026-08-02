'use client'

import { useLanguage } from '@/context/LanguageContext'
import { useScrollReveal } from '@/hooks/useScrollReveal'

const icons = [
  // Bowl / Taste
  <svg key="taste" className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3C7 3 3 7 3 12h18c0-5-4-9-9-9z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12c0 5 4 9 9 9s9-4 9-9" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v18" />
  </svg>,
  // Heart / Service
  <svg key="service" className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
  </svg>,
  // Home / Welcome
  <svg key="welcome" className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9.75L12 3l9 6.75V21H3V9.75z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 21V12h6v9" />
  </svg>,
]

export default function ValuesSection() {
  const { tr } = useLanguage()
  const { ref, visible } = useScrollReveal()

  const titleLines = tr.values.title.split('\n')

  return (
    <section
      id="values"
      ref={ref as React.RefObject<HTMLElement>}
      className="bg-ivory py-24 lg:py-36 px-6"
    >
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className={`text-center mb-16 reveal ${visible ? 'visible' : ''}`}>
          <p className="section-label mb-5">{tr.values.label}</p>
          <h2 className="font-serif text-4xl md:text-5xl text-charcoal leading-tight">
            {titleLines.map((line, i) => (
              <span key={i} className="block">
                {line}
              </span>
            ))}
          </h2>
        </div>

        {/* Cards */}
        <div className="grid md:grid-cols-3 gap-8 lg:gap-12">
          {tr.values.items.map((item, i) => (
            <div
              key={i}
              className={`reveal reveal-delay-${i + 1} ${visible ? 'visible' : ''} flex flex-col items-center text-center p-8 bg-cream border border-border hover:border-primary/30 hover:shadow-sm transition-all duration-300`}
            >
              <div className="text-primary mb-6">{icons[i]}</div>
              <h3 className="font-serif text-xl text-charcoal mb-4">{item.title}</h3>
              <div className="deco-rule mx-auto mb-4" />
              <p className="text-muted text-sm leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
