import type { TranslationsType } from './ko'

const zhCN: TranslationsType = {
  nav: {
    home: '首页',
    menu: '菜单',
    about: '关于',
    locations: '位置',
    contact: '联系',
  },
  hero: {
    eyebrow: '竹北 · 新竹',
    title: '한국관',
    romanized: '韩国馆',
    tagline: '在台湾品尝正宗韩国料理',
    cta: '查看菜单',
  },
  about: {
    label: '我们的故事',
    title: '用心料理的\n韩国滋味',
    p1: '韩国馆在新竹地区提供正宗的韩国家常料理。秉持代代相传的传统食谱，每天使用新鲜食材精心烹调每一道菜。',
    p2: '我们的使命是将韩国饮食文化的温暖，分享给三星、台积电等企业的员工及在地朋友。',
  },
  menu: {
    label: '招牌菜单',
    title: '体验正宗\n韩国美食',
    items: [
      { name: '김치찌개', desc: '泡菜锅 — 浓郁深邃的汤底' },
      { name: '불고기', desc: '烤牛肉 — 软嫩酱香牛肉' },
      { name: '비빔밥', desc: '石锅拌饭 — 新鲜蔬菜什锦饭' },
      { name: '갈비탕', desc: '牛排骨汤 — 慢炖排骨清汤' },
      { name: '잡채', desc: '杂菜 — 芝麻香拌粉条' },
      { name: '된장찌개', desc: '大酱锅 — 传统发酵豆酱汤' },
    ],
  },
  values: {
    label: '我们的理念',
    title: '我们坚守的原则',
    items: [
      {
        title: '正宗风味',
        desc: '代代相传的传统食谱，呈现最道地的韩国味道。',
      },
      {
        title: '用心服务',
        desc: '以家人般的温暖，迎接每一位来访的宾客。',
      },
      {
        title: '温馨款待',
        desc: '打造如家般舒适的用餐空间，让您感受韩国的温情。',
      },
    ],
  },
  locations: {
    label: '交通指引',
    title: '两个地点\n方便您选择',
    main: {
      label: '本店',
      addr: '竹北市县政九路135巷32号',
      addrZh: '新竹县竹北市县政九路135巷32号',
      hours: '周二 – 周日  11:00 – 14:00, 17:00 – 21:00',
      hoursNote: '每周一公休',
      mapCta: '查看地图',
    },
    branch: {
      label: '直营店（企业专属）',
      addr: '竹北市太元一街7号',
      addrZh: '新竹县竹北市太元一街7号',
      hours: '仅供企业员工使用',
      hoursNote: '毗邻三星 · 台积电',
      mapCta: '查看地图',
      note: '此分店仅供附近企业（三星、台积电等）员工使用。',
    },
  },
  contact: {
    label: '联系我们',
    title: '有任何问题\n或订位需求？',
    namePlaceholder: '您的姓名',
    phonePlaceholder: '联系电话',
    messagePlaceholder: '请输入您的信息...',
    submit: '发送信息',
    success: '感谢您！我们将尽快与您联系。',
  },
  footer: {
    tagline: '在台湾品尝正宗韩国料理',
    rights: '© 2025 韩国馆. All rights reserved.',
  },
}

export default zhCN
