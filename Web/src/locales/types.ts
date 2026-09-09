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
  settings: {
    title: string
    language: string
    theme: string
    light: string
    dark: string
  }
  auth: {
    login: string
    logout: string
    signup: string
    myAccount: string
    adminPage: string
    loginTitle: string
    loginSubtitle: string
    signupTitle: string
    signupSubtitle: string
    email: string
    password: string
    passwordHint: string
    name: string
    phoneOptional: string
    continueWithGoogle: string
    or: string
    noAccount: string
    haveAccount: string
    submitting: string
    backHome: string
    accountTitle: string
    roleLabel: string
    roleCustomer: string
    roleStaff: string
    roleOwner: string
    loginMethods: string
    methodPassword: string
    methodGoogle: string
    profile: string
    save: string
    saved: string
    changePassword: string
    setPassword: string
    currentPassword: string
    newPassword: string
    passwordChanged: string
    adminHint: string
    loading: string
    vipTitle: string
    vipNone: string
    vipOneTimeNotice: string
    vipRegistered: string
    vipExpired: string
    vipDiscountLabel: string
    vipExpiryLabel: string
    ordersTitle: string
    ordersEmpty: string
    ordersTable: string
    ordersTakeout: string
    errors: {
      invalid_email: string
      weak_password: string
      name_required: string
      email_taken: string
      invalid_credentials: string
      wrong_current_password: string
      google_login_not_configured: string
      firebase_sdk_load_failed: string
      google_domain_not_authorized: string
      google_not_enabled: string
      google_popup_blocked: string
      network_failed: string
      card_number_required: string
      card_not_found: string
      card_already_claimed: string
      already_registered: string
      server_error: string
    }
  }
}
