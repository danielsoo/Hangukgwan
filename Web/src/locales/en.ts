import type { TranslationsType } from './ko'

const en: TranslationsType = {
  nav: {
    home: 'Home',
    menu: 'Menu',
    about: 'About',
    locations: 'Locations',
    contact: 'Contact',
  },
  hero: {
    eyebrow: 'ZHUBEI · HSINCHU',
    title: '한국관',
    romanized: 'HANGUKGWAN',
    tagline: 'Authentic Korean Dining in Taiwan',
    cta: 'View Menu',
  },
  about: {
    label: 'Our Story',
    title: 'Korean Flavors\nCrafted with Heart',
    p1: 'Hangukgwan has been bringing authentic Korean home-style cooking to the Hsinchu area. Rooted in traditional recipes passed down through generations, we prepare every dish fresh daily.',
    p2: 'Our mission is to share the warmth of Korean culinary culture with professionals from Samsung, TSMC, and the broader Hsinchu community.',
  },
  menu: {
    label: 'Signature Menu',
    title: 'Experience the\nAuthentic Taste',
    items: [
      { name: '김치찌개', desc: 'Kimchi Stew — rich, deep broth' },
      { name: '불고기', desc: 'Bulgogi — tender marinated beef' },
      { name: '비빔밥', desc: 'Bibimbap — stone pot mixed rice' },
      { name: '갈비탕', desc: 'Galbi Tang — slow-braised rib soup' },
      { name: '잡채', desc: 'Japchae — glass noodles with sesame' },
      { name: '된장찌개', desc: 'Doenjang Jjigae — soybean paste stew' },
    ],
  },
  values: {
    label: 'Our Values',
    title: 'What We Stand For',
    items: [
      {
        title: 'Authentic Taste',
        desc: 'Traditional recipes passed down through generations, delivering the true taste of Korea.',
      },
      {
        title: 'Heartfelt Service',
        desc: 'Every guest is welcomed as family — with warmth and genuine care.',
      },
      {
        title: 'Warm Welcome',
        desc: 'A cozy space that feels like home, no matter how far you are from Korea.',
      },
    ],
  },
  locations: {
    label: 'Find Us',
    title: 'Two Locations\nto Serve You',
    main: {
      label: 'Main Store',
      addr: 'No. 32, Ln. 135, Xianzhengjiu Rd., Zhubei City',
      addrZh: '新竹縣竹北市縣政九路135巷32號',
      hours: 'Tue – Sun  11:00 – 14:00, 17:00 – 21:00',
      hoursNote: 'Closed on Mondays',
      mapCta: 'View on Map',
    },
    branch: {
      label: 'Corporate Branch',
      addr: 'No. 7, Taiyuan 1st St., Zhubei City',
      addrZh: '新竹縣竹北市太元一街7號',
      hours: 'Corporate Employees Only',
      hoursNote: 'Near Samsung · TSMC',
      mapCta: 'View on Map',
      note: 'This location is exclusively accessible to employees of nearby corporate campuses (Samsung, TSMC, etc.).',
    },
  },
  contact: {
    label: 'Get in Touch',
    title: 'Have a Question\nor Reservation?',
    namePlaceholder: 'Your Name',
    phonePlaceholder: 'Phone Number',
    messagePlaceholder: 'Your message...',
    submit: 'Send Message',
    success: "Thank you! We'll be in touch shortly.",
  },
  footer: {
    tagline: 'Authentic Korean Dining in Taiwan',
    rights: '© 2025 Hangukgwan. All rights reserved.',
  },
}

export default en
