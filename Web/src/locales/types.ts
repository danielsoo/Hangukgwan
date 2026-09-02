export interface MenuCategory {
  zh: string
  ko: string
  en: string
  count: string
  range: string
}

export interface AboutValue {
  n: number
  t: string
  d: string
}

export interface QrStep {
  n: number
  text: string
}

export interface GroupRow {
  k: string
  v: string
}

export interface TranslationsType {
  nav: {
    home: string
    menu: string
    about: string
    loc: string
    group: string
  }
  hero: {
    eyebrow: string
    tag: string
    cta1: string
    cta2: string
  }
  info: {
    hours: string
    closed: string
    closedVal: string
    booking: string
    bookingVal: string
    min: string
    perPerson: string
    phoneLabel: string
  }
  member: {
    nav: string
    label: string
    title: string
    body: string
    google: string
    privacy: string
    signedIn: string
    cardLabel: string
    cardHint: string
    register: string
    doneCard: string
    doneBody: string
    doneCta: string
  }
  sig: {
    label: string
    badge: string
    title: string
    all: string
    note: string
  }
  qr: {
    label: string
    title: string
    body: string
    cta: string
    steps: QrStep[]
  }
  about: {
    label: string
    title: string
    p1: string
    p2: string
    p3: string
    more: string
    pull: string
    valuesLabel: string
    valuesTitle: string
    values: AboutValue[]
  }
  loc: {
    label: string
    title: string
    intro: string
    mainLabel: string
    branchLabel: string
    mapCta: string
    accessLabel: string
    branchAccess: string
    nearby: string
    branchNote: string
  }
  group: {
    label: string
    title: string
    p1: string
    p2: string
    cta: string
    ctaNote: string
    rows: GroupRow[]
    dishesLabel: string
    dishesTitle: string
    d1: string
    d2: string
    d3: string
  }
  menuPage: {
    label: string
    title: string
    intro: string
    catsTitle: string
    catsNote: string
    cta: string
    ctaNote: string
    cats: MenuCategory[]
  }
  footer: {
    tag: string
    storesLabel: string
    rights: string
    orderLink: string
  }
}
