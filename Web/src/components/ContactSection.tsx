'use client'

import { useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useScrollReveal } from '@/hooks/useScrollReveal'

export default function ContactSection() {
  const { tr } = useLanguage()
  const { ref, visible } = useScrollReveal()
  const [form, setForm] = useState({ name: '', phone: '', message: '' })
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  const titleLines = tr.contact.title.split('\n')

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
    } catch {
      // Gracefully ignore if backend is unavailable
    } finally {
      setLoading(false)
      setSubmitted(true)
    }
  }

  return (
    <section
      id="contact"
      ref={ref as React.RefObject<HTMLElement>}
      className="bg-cream py-24 lg:py-36 px-6"
    >
      <div className="max-w-4xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-start">
          {/* Left: Heading */}
          <div className={`reveal ${visible ? 'visible' : ''}`}>
            <p className="section-label mb-6">{tr.contact.label}</p>
            <h2 className="font-serif text-4xl md:text-5xl text-charcoal leading-tight mb-8">
              {titleLines.map((line, i) => (
                <span key={i} className="block">
                  {line}
                </span>
              ))}
            </h2>
            <div className="deco-rule" />

            {/* Decorative large numeral */}
            <p
              className="mt-16 font-serif text-[8rem] leading-none text-charcoal/5 select-none"
              aria-hidden
            >
              文
            </p>
          </div>

          {/* Right: Form */}
          <div className={`reveal reveal-delay-2 ${visible ? 'visible' : ''}`}>
            {submitted ? (
              <div className="py-12 text-center">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-charcoal/80">{tr.contact.success}</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-8">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <input
                      type="text"
                      name="name"
                      placeholder={tr.contact.namePlaceholder}
                      value={form.name}
                      onChange={handleChange}
                      required
                      className="form-input"
                    />
                  </div>
                  <div>
                    <input
                      type="tel"
                      name="phone"
                      placeholder={tr.contact.phonePlaceholder}
                      value={form.phone}
                      onChange={handleChange}
                      required
                      className="form-input"
                    />
                  </div>
                </div>

                <div>
                  <textarea
                    name="message"
                    placeholder={tr.contact.messagePlaceholder}
                    value={form.message}
                    onChange={handleChange}
                    required
                    rows={5}
                    className="form-input resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-4 bg-charcoal text-cream text-sm tracking-[0.2em] uppercase hover:bg-primary transition-colors duration-300 disabled:opacity-60"
                >
                  {loading ? '...' : tr.contact.submit}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
