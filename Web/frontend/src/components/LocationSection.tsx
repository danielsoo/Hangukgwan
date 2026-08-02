'use client'

import { useLanguage } from '@/context/LanguageContext'
import { useScrollReveal } from '@/hooks/useScrollReveal'

function MapPinIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

export default function LocationSection() {
  const { tr } = useLanguage()
  const { ref, visible } = useScrollReveal()

  const titleLines = tr.locations.title.split('\n')
  const { main, branch } = tr.locations

  const mainMapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(main.addrZh)}`
  const branchMapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(branch.addrZh)}`

  return (
    <section
      id="locations"
      ref={ref as React.RefObject<HTMLElement>}
      className="bg-stone py-24 lg:py-36 px-6"
    >
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className={`text-center mb-16 reveal ${visible ? 'visible' : ''}`}>
          <p className="section-label text-primary/80 mb-5">{tr.locations.label}</p>
          <h2 className="font-serif text-4xl md:text-5xl text-cream leading-tight">
            {titleLines.map((line, i) => (
              <span key={i} className="block">
                {line}
              </span>
            ))}
          </h2>
        </div>

        {/* Location Cards */}
        <div className="grid md:grid-cols-2 gap-6 lg:gap-10">
          {/* Main Store */}
          <div className={`reveal reveal-delay-1 ${visible ? 'visible' : ''} bg-charcoal border border-white/10 p-8 lg:p-10 hover:border-primary/30 transition-all duration-300 group`}>
            <div className="flex items-start justify-between mb-6">
              <div>
                <span className="text-xs tracking-widest text-gold uppercase block mb-2">01</span>
                <h3 className="font-serif text-2xl text-cream">{main.label}</h3>
              </div>
              <span className="w-2 h-2 rounded-full bg-primary mt-2 shrink-0" />
            </div>

            <div className="space-y-4 mb-8">
              <div className="flex items-start gap-3 text-cream/60 text-sm">
                <MapPinIcon />
                <div>
                  <p>{main.addr}</p>
                  <p className="text-cream/40 text-xs mt-0.5">{main.addrZh}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 text-cream/60 text-sm">
                <ClockIcon />
                <div>
                  <p>{main.hours}</p>
                  <p className="text-cream/40 text-xs mt-0.5">{main.hoursNote}</p>
                </div>
              </div>
            </div>

            <a
              href={mainMapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-xs tracking-widest uppercase text-primary hover:text-gold transition-colors duration-200 group-hover:gap-3"
            >
              {main.mapCta}
              <span aria-hidden>→</span>
            </a>
          </div>

          {/* Branch Store */}
          <div className={`reveal reveal-delay-2 ${visible ? 'visible' : ''} bg-charcoal border border-white/10 p-8 lg:p-10 hover:border-gold/30 transition-all duration-300 group`}>
            <div className="flex items-start justify-between mb-6">
              <div>
                <span className="text-xs tracking-widest text-gold uppercase block mb-2">02</span>
                <h3 className="font-serif text-2xl text-cream">{branch.label}</h3>
              </div>
              <span className="w-2 h-2 rounded-full bg-gold mt-2 shrink-0" />
            </div>

            <div className="space-y-4 mb-5">
              <div className="flex items-start gap-3 text-cream/60 text-sm">
                <MapPinIcon />
                <div>
                  <p>{branch.addr}</p>
                  <p className="text-cream/40 text-xs mt-0.5">{branch.addrZh}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 text-cream/60 text-sm">
                <ClockIcon />
                <div>
                  <p>{branch.hours}</p>
                  <p className="text-cream/40 text-xs mt-0.5">{branch.hoursNote}</p>
                </div>
              </div>
            </div>

            {branch.note && (
              <p className="text-cream/30 text-xs mb-8 pl-7 leading-relaxed border-l border-gold/20">
                {branch.note}
              </p>
            )}

            <a
              href={branchMapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-xs tracking-widest uppercase text-gold hover:text-primary transition-colors duration-200 group-hover:gap-3"
            >
              {branch.mapCta}
              <span aria-hidden>→</span>
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
