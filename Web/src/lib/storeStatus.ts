import type { Language } from '@/context/LanguageContext'

export interface StoreStatus {
  text: string
  dot: string
}

const COPY: Record<Language, { open: string; close: string; until: string; from: string; mon: string }> = {
  'zh-TW': { open: '現在營業中', close: '目前休息中', until: '至', from: '起', mon: '每週一公休' },
  ko: { open: '영업 중', close: '영업 종료', until: '까지', from: '부터', mon: '월요일 휴무' },
  en: { open: 'Open now', close: 'Closed now', until: 'until', from: 'opens', mon: 'Closed Mondays' },
}

/** Mirrors the opening-hours logic from the approved design: Tue–Sun, 11:00–14:00 and 17:00–21:00, closed Mondays. */
export function getStoreStatus(lang: Language, now: Date = new Date()): StoreStatus {
  const L = COPY[lang]
  const day = now.getDay()
  const mins = now.getHours() * 60 + now.getMinutes()
  const lunch = mins >= 660 && mins < 840
  const dinner = mins >= 1020 && mins < 1260
  const open = day !== 1 && (lunch || dinner)

  if (day === 1) return { text: L.mon, dot: 'var(--muted)' }

  if (open) {
    const end = lunch ? '14:00' : '21:00'
    const text = lang === 'en' ? `${L.open} · ${L.until} ${end}` : `${L.open} · ${end}${L.until}`
    return { text, dot: 'var(--status-open)' }
  }

  const next = mins < 660 ? '11:00' : mins < 1020 ? '17:00' : '11:00'
  const text = lang === 'en' ? `${L.close} · ${L.from} ${next}` : `${L.close} · ${next}${L.from}`
  return { text, dot: 'var(--gold)' }
}
