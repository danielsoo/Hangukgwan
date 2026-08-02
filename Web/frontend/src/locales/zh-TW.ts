import type { TranslationsType } from './ko'

const zhTW: TranslationsType = {
  nav: {
    home: '首頁',
    menu: '菜單',
    about: '關於',
    locations: '位置',
    contact: '聯絡',
  },
  hero: {
    eyebrow: '竹北 · 新竹',
    title: '한국관',
    romanized: '韓國館',
    tagline: '在台灣品嚐正宗韓國料理',
    cta: '查看菜單',
  },
  about: {
    label: '我們的故事',
    title: '用心料理的\n韓國滋味',
    p1: '韓國館在新竹地區提供正宗的韓國家常料理。秉持代代相傳的傳統食譜，每天使用新鮮食材精心烹調每一道菜。',
    p2: '我們的使命是將韓國飲食文化的溫暖，分享給三星、台積電等企業的員工及在地朋友。',
  },
  menu: {
    label: '招牌菜單',
    title: '體驗正宗\n韓國美食',
    items: [
      { name: '김치찌개', desc: '泡菜鍋 — 濃郁深邃的湯底' },
      { name: '불고기', desc: '烤牛肉 — 軟嫩醬香牛肉' },
      { name: '비빔밥', desc: '石鍋拌飯 — 新鮮蔬菜什錦飯' },
      { name: '갈비탕', desc: '牛排骨湯 — 慢燉排骨清湯' },
      { name: '잡채', desc: '雜菜 — 芝麻香拌粉條' },
      { name: '된장찌개', desc: '大醬鍋 — 傳統發酵豆醬湯' },
    ],
  },
  values: {
    label: '我們的理念',
    title: '我們堅守的原則',
    items: [
      {
        title: '正宗風味',
        desc: '代代相傳的傳統食譜，呈現最道地的韓國味道。',
      },
      {
        title: '用心服務',
        desc: '以家人般的溫暖，迎接每一位來訪的賓客。',
      },
      {
        title: '溫馨款待',
        desc: '打造如家般舒適的用餐空間，讓您遠離思鄉之苦。',
      },
    ],
  },
  locations: {
    label: '交通指引',
    title: '兩個地點\n方便您選擇',
    main: {
      label: '本店',
      addr: '竹北市縣政九路135巷32號',
      addrZh: '新竹縣竹北市縣政九路135巷32號',
      hours: '週二 – 週日  11:00 – 14:00, 17:00 – 21:00',
      hoursNote: '每週一公休',
      mapCta: '查看地圖',
    },
    branch: {
      label: '直營店（企業專屬）',
      addr: '竹北市太元一街7號',
      addrZh: '新竹縣竹北市太元一街7號',
      hours: '僅供企業員工使用',
      hoursNote: '鄰近三星 · 台積電',
      mapCta: '查看地圖',
      note: '此分店僅供附近企業（三星、台積電等）員工使用。',
    },
  },
  contact: {
    label: '聯絡我們',
    title: '有任何問題\n或訂位需求？',
    namePlaceholder: '您的姓名',
    phonePlaceholder: '聯絡電話',
    messagePlaceholder: '請輸入您的訊息...',
    submit: '送出訊息',
    success: '感謝您！我們將盡快與您聯繫。',
  },
  footer: {
    tagline: '在台灣品嚐正宗韓國料理',
    rights: '© 2025 韓國館. All rights reserved.',
  },
}

export default zhTW
