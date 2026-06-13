const ko = {
  nav: {
    home: '홈',
    menu: '메뉴',
    about: '소개',
    locations: '위치',
    contact: '문의',
  },
  hero: {
    eyebrow: '신죽 · 대만',
    title: '한국관',
    romanized: 'HANGUKGWAN',
    tagline: '대만에서 만나는 정통 한국의 맛',
    cta: '메뉴 보기',
  },
  about: {
    label: '우리의 이야기',
    title: '정성껏 준비한\n한국의 맛',
    p1: '한국관은 신죽 지역에서 정통 한국 가정식을 선보이고 있습니다. 오랜 시간 이어진 한국의 전통 요리법을 바탕으로, 매일 신선한 재료로 음식을 정성껏 준비합니다.',
    p2: '삼성, TSMC 등 기업 임직원 여러분께 따뜻한 한국의 정과 맛을 전달하는 것이 저희의 사명입니다.',
  },
  menu: {
    label: '대표 메뉴',
    title: '정통의 맛을\n경험하세요',
    items: [
      { name: '김치찌개', desc: '깊고 진한 국물의 정통 김치찌개' },
      { name: '불고기', desc: '부드러운 양념 소불고기' },
      { name: '비빔밥', desc: '신선한 나물의 돌솥 비빔밥' },
      { name: '갈비탕', desc: '오래 끓인 진한 갈비탕' },
      { name: '잡채', desc: '고소한 참기름 잡채' },
      { name: '된장찌개', desc: '구수하고 깊은 된장찌개' },
    ],
  },
  values: {
    label: '한국관의 가치',
    title: '우리가 지키는 것들',
    items: [
      {
        title: '정통의 맛',
        desc: '대를 이어온 전통 레시피로 진정한 한국의 맛을 전달합니다.',
      },
      {
        title: '정성 서비스',
        desc: '모든 손님을 가족처럼 따뜻하게 맞이합니다.',
      },
      {
        title: '따뜻한 환대',
        desc: '고향의 따뜻함이 느껴지는 편안한 공간을 만들겠습니다.',
      },
    ],
  },
  locations: {
    label: '찾아오시는 길',
    title: '두 곳에서\n만나세요',
    main: {
      label: '본점',
      addr: '신죽현 죽북시 현정구로 135항 32호',
      addrZh: '新竹縣竹北市縣政九路135巷32號',
      hours: '화 – 일  11:00 – 14:00, 17:00 – 21:00',
      hoursNote: '매주 월요일 정기 휴무',
      mapCta: '지도에서 보기',
    },
    branch: {
      label: '직영점 (기업 전용)',
      addr: '신죽현 죽북시 태원1가 7호',
      addrZh: '新竹縣竹北市太元一街7號',
      hours: '기업 임직원 전용',
      hoursNote: '삼성 · TSMC 인근',
      mapCta: '지도에서 보기',
      note: '이 지점은 인근 기업 (삼성, TSMC 등) 임직원만 이용 가능합니다.',
    },
  },
  contact: {
    label: '문의하기',
    title: '궁금한 점이\n있으신가요?',
    namePlaceholder: '이름',
    phonePlaceholder: '연락처',
    messagePlaceholder: '메시지를 입력해 주세요',
    submit: '보내기',
    success: '감사합니다. 곧 연락 드리겠습니다.',
  },
  footer: {
    tagline: '대만에서 만나는 정통 한국의 맛',
    rights: '© 2025 한국관. All rights reserved.',
  },
}

export default ko

export interface TranslationsType {
  nav: {
    home: string
    menu: string
    about: string
    locations: string
    contact: string
  }
  hero: {
    eyebrow: string
    title: string
    romanized: string
    tagline: string
    cta: string
  }
  about: {
    label: string
    title: string
    p1: string
    p2: string
  }
  menu: {
    label: string
    title: string
    items: Array<{ name: string; desc: string }>
  }
  values: {
    label: string
    title: string
    items: Array<{ title: string; desc: string }>
  }
  locations: {
    label: string
    title: string
    main: {
      label: string
      addr: string
      addrZh: string
      hours: string
      hoursNote: string
      mapCta: string
    }
    branch: {
      label: string
      addr: string
      addrZh: string
      hours: string
      hoursNote: string
      mapCta: string
      note?: string
    }
  }
  contact: {
    label: string
    title: string
    namePlaceholder: string
    phonePlaceholder: string
    messagePlaceholder: string
    submit: string
    success: string
  }
  footer: {
    tagline: string
    rights: string
  }
}
