'use client'

import { useLanguage } from '@/context/LanguageContext'
import { useScrollReveal } from '@/hooks/useScrollReveal'

const cardAccents = [
  'border-primary/30',
  'border-gold/30',
  'border-white/10',
  'border-primary/20',
  'border-gold/20',
  'border-white/10',
]

export default function SignatureMenu() {
  const { tr } = useLanguage()
  const { ref, visible } = useScrollReveal()

  const titleLines = tr.menu.title.split('\n')

  return (
    <section
      id="menu"
      ref={ref as React.RefObject<HTMLElement>}
      className="bg-charcoal py-24 lg:py-36 px-6"
    >
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className={`text-center mb-16 reveal ${visible ? 'visible' : ''}`}>
          <p className="section-label text-primary/80 mb-5">{tr.menu.label}</p>
          <h2 className="font-serif text-4xl md:text-5xl text-cream leading-tight">
            {titleLines.map((line, i) => (
              <span key={i} className="block">
                {line}
              </span>
            ))}
          </h2>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-white/5">
          {tr.menu.items.map((item, i) => (
            <div
              key={i}
              className={`reveal reveal-delay-${Math.min(i + 1, 5)} ${visible ? 'visible' : ''} group relative bg-charcoal hover:bg-stone transition-colors duration-300 p-8 md:p-10 border ${cardAccents[i]}`}
            >
              {/* Number */}
              <span className="text-xs tracking-widest text-muted mb-6 block">
                0{i + 1}
              </span>

              {/* Dish name in Korean */}
              <h3
                className="font-serif text-3xl md:text-4xl text-cream mb-3 group-hover:text-gold transition-colors duration-300"
                lang="ko"
              >
                {item.name}
              </h3>

              {/* Thin divider */}
              <div className="w-8 h-px bg-primary mb-4 group-hover:w-16 transition-all duration-300" />

              {/* Description */}
              <p className="text-cream/50 text-sm leading-relaxed">
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
