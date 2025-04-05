// src/i18n.js
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const resources = {
  /* ---------------- English (en) ---------------- */
  en: {
    translation: {
      /* Global */
      siteName: 'Hangukgwan',
      ourLocations: 'Our Locations',
      restaurantName: 'Hangukgwan',
      home: 'Home',
      about: 'About',
      contact: 'Contact',
      login: 'Login',
      signup: 'Sign Up',
      logout: 'Logout',
      profileSettings: 'Profile Settings',
      chat: 'Chat',
      documents: 'Documents',
      menu: 'Menu',
      location: 'Location',
      defaultUser: 'User',
      firstName: 'First Name',
      lastName: 'Last Name',
      phoneNumber: 'Phone Number',
      dateOfBirth: 'Date of Birth',
      email: 'Email',
      password: 'Password',
      confirmPassword: 'Confirm Password',
      passwordsNotMatch: 'Passwords do not match.',
      serverConnectionError: 'Error: Could not connect to server',
      keepLoggedIn: 'Keep me logged in',
      noAccount: "Don't have an account?",
      forgotPassword: 'Forgot Password?',
      emailSent: 'Email sent',
      resetPassword: 'Reset Password',
      enterEmail: 'Enter your email',
      manageProfile: 'Manage your account settings and view your profile information.',
      viewProfileDetails: 'View Profile Details',
      bibimbabSlogan: 'Experience the warmth and flavor of Korea in every bowl.',
      signupSuccessTitle: 'Signup Successful!',
      signupSuccessMessage: 'Welcome, {{userName}}! Please log in to enjoy our services.',

      /* LocationModal */
      findRestaurant: 'Find a Restaurant',
      enterAddress: 'Enter address, city, or zip code',
      enterAddressPlaceholder: 'Enter a location',
      useCurrentLocation: 'Use My Current Location',
      cancel: 'Cancel',
      search: 'Search',

      /* StoreDetailPage & LocationPage UI Keys */
      addressLabel: 'Address',
      phoneLabel: 'Phone',
      distanceUnit: 'km',
      orderPickup: 'Order Pickup',
      orderDelivery: 'Order Delivery',
      orderCatering: 'Order Catering',
      mapDirections: 'Map & Directions',
      storeDetailsTab: 'Restaurant Details',
      aboutUsTab: 'About Us',
      communityTab: 'Community',
      careersTab: 'Careers',
      hoursHeading: 'Hours',
      serviceOptionsHeading: 'Service Options and Hours',
      goBack: 'Go Back',
      aboutUsContent: 'We have been serving customers since ...',
      communityContent: 'Our store participates in local events ...',
      careersContent: 'Join our team! We are hiring ...',

      /* Actual Store Data */
      stores: {
        1: {
          name: 'Hangukgwan',
          address: 'No. 32, Lane 135, Xianzhengjiu Rd, Zhubei City, Hsinchu County, Taiwan 302',
          status: 'Open – Today 11 AM–2 PM, 5 PM–9 PM',
          phone: '+886 3656 7994',
          plusCode: 'R2H5+7P Zhubei City, Hsinchu County, Taiwan',
          imageUrl: 'https://via.placeholder.com/600x400?text=Hangukgwan',
          mapUrl: 'https://goo.gl/maps/…',
          hours: [
            { day: 'Sunday',    time: '11 AM–2 PM, 5–9 PM' },
            { day: 'Monday',    time: 'Closed' },
            { day: 'Tuesday',   time: '11 AM–2 PM, 5–9 PM' },
            { day: 'Wednesday', time: '11 AM–2 PM, 5–9 PM' },
            { day: 'Thursday',  time: '11 AM–2 PM, 5–9 PM' },
            { day: 'Friday',    time: '11 AM–2 PM, 5–9 PM' },
            { day: 'Saturday',  time: '11 AM–2 PM, 5–9 PM' },
          ],
          description: 'Authentic Korean cuisine served in a modern atmosphere.'
        }
      }
    },
  },

  /* ---------------- Korean (ko) ---------------- */
  ko: {
    translation: {
      /* Global */
      siteName: '한국관',
      ourLocations: '매장 목록',
      restaurantName: '한국관',
      home: '홈',
      about: '소개',
      contact: '문의하기',
      login: '로그인',
      signup: '회원가입',
      logout: '로그아웃',
      profileSettings: '프로필 설정',
      chat: '채팅',
      documents: '문서',
      menu: '메뉴',
      location: '위치',
      defaultUser: '사용자',
      firstName: '이름',
      lastName: '성',
      phoneNumber: '전화번호',
      dateOfBirth: '생년월일',
      email: '이메일',
      password: '비밀번호',
      confirmPassword: '비밀번호 확인',
      passwordsNotMatch: '비밀번호가 일치하지 않습니다.',
      serverConnectionError: '서버와 연결할 수 없습니다.',
      keepLoggedIn: '로그인 상태 유지',
      noAccount: '계정이 없으신가요?',
      forgotPassword: '비밀번호 찾기',
      emailSent: '이메일 발송 완료',
      resetPassword: '비밀번호 재설정',
      enterEmail: '이메일을 입력하세요',
      manageProfile: '계정 설정을 관리하고 프로필 정보를 확인하세요.',
      viewProfileDetails: '프로필 상세보기',
      bibimbabSlogan: '한 그릇에 담긴 정성과 풍미, 비빔밥 한 그릇에 담긴 한국의 따뜻한 정을 느껴보세요.',
      signupSuccessTitle: '회원가입 성공!',
      signupSuccessMessage: '환영합니다, {{userName}}님! 로그인 후 한국관의 서비스를 이용해 주세요.',

      /* LocationModal */
      findRestaurant: '식당 찾기',
      enterAddress: '주소, 도시 또는 우편번호 입력',
      enterAddressPlaceholder: '주소를 입력하세요',
      useCurrentLocation: '현재 위치 사용',
      cancel: '취소',
      search: '검색',

      /* StoreDetailPage & LocationPage UI Keys */
      addressLabel: '주소',
      phoneLabel: '전화',
      distanceUnit: 'km',
      orderPickup: '매장 픽업',
      orderDelivery: '배달 주문',
      orderCatering: '케이터링 주문',
      mapDirections: '지도 & 길찾기',
      storeDetailsTab: '매장 상세',
      aboutUsTab: '회사 소개',
      communityTab: '커뮤니티',
      careersTab: '채용 정보',
      hoursHeading: '영업 시간',
      serviceOptionsHeading: '서비스 옵션 및 시간',
      goBack: '뒤로 가기',
      aboutUsContent: '저희는 고객에게 최고의 서비스를 제공해 왔습니다...',
      communityContent: '저희 매장은 지역 행사에 참여합니다...',
      careersContent: '저희 팀에 합류하세요! 채용 중입니다...',

      /* Actual Store Data */
      stores: {
        1: {
          name: '한국관',
          address: 'No. 32號, Lane 135, Xianzhengjiu Rd, Zhubei City, Hsinchu County, Taiwan 302',
          status: '영업 중 – 오늘 오전 11시–오후 2시, 오후 5시–9시',
          phone: '+886 3656 7994',
          plusCode: 'R2H5+7P 북륜리, 주베이시, 신주현, 대만',
          imageUrl: 'https://via.placeholder.com/600x400?text=한국관',
          mapUrl: 'https://goo.gl/maps/…',
          hours: [
            { day: '일요일',    time: '오전 11시–오후 2시, 오후 5시–9시' },
            { day: '월요일',    time: '휴무' },
            { day: '화요일',    time: '오전 11시–오후 2시, 오후 5시–9시' },
            { day: '수요일',    time: '오전 11시–오후 2시, 오후 5시–9시' },
            { day: '목요일',    time: '오전 11시–오후 2시, 오후 5시–9시' },
            { day: '금요일',    time: '오전 11시–오후 2시, 오후 5시–9시' },
            { day: '토요일',    time: '오전 11시–오후 2시, 오후 5시–9시' },
          ],
          description: '모던한 분위기에서 즐기는 정통 한식 전문점.'
        }
      }
    },
  },

  /* ---------------- Chinese ‑ Simplified (zh) ---------------- */
  zh: {
    translation: {
      /* Global */
      siteName: '韩国馆',
      ourLocations: '门店列表',
      restaurantName: '韩国馆',
      home: '主页',
      about: '关于',
      contact: '联系方式',
      login: '登录',
      signup: '注册',
      logout: '退出登录',
      profileSettings: '个人资料设置',
      chat: '聊天',
      documents: '文件',
      menu: '菜单',
      location: '位置',
      defaultUser: '用户',
      firstName: '名字',
      lastName: '姓氏',
      phoneNumber: '电话号码',
      dateOfBirth: '出生日期',
      email: '电子邮件',
      password: '密码',
      confirmPassword: '确认密码',
      passwordsNotMatch: '密码不匹配。',
      serverConnectionError: '无法连接服务器。',
      keepLoggedIn: '保持登录状态',
      noAccount: '没有账户？',
      forgotPassword: '忘记密码？',
      emailSent: '邮件已发送',
      resetPassword: '重置密码',
      enterEmail: '请输入您的电子邮件',
      manageProfile: '管理您的账户设置并查看您的个人资料信息。',
      viewProfileDetails: '查看个人资料详情',
      bibimbabSlogan: '一碗拌饭，品尝韩国的温情与风味。',
      signupSuccessTitle: '注册成功！',
      signupSuccessMessage: '欢迎，{{userName}}！请登录以享受我们的服务。',

      /* LocationModal */
      findRestaurant: '查找餐厅',
      enterAddress: '输入地址、城市或邮政编码',
      enterAddressPlaceholder: '输入地点',
      useCurrentLocation: '使用我的当前位置',
      cancel: '取消',
      search: '搜索',

      /* UI Keys */
      addressLabel: '地址',
      phoneLabel: '电话',
      distanceUnit: '公里',
      orderPickup: '到店自取',
      orderDelivery: '外卖订单',
      orderCatering: '餐饮订购',
      mapDirections: '地图 & 路线',
      storeDetailsTab: '餐厅详情',
      aboutUsTab: '关于我们',
      communityTab: '社区',
      careersTab: '招聘信息',
      hoursHeading: '营业时间',
      serviceOptionsHeading: '服务选项及时间',
      goBack: '返回',
      aboutUsContent: '我们一直在为顾客提供优质服务……',
      communityContent: '我们的门店参与当地活动……',
      careersContent: '加入我们的团队！我们正在招聘……',

      /* Store Data */
      stores: {
        1: {
          name: '韩国馆',
          address: 'No. 32号, Lane 135, Xianzhengjiu Rd, 竹北市, 新竹县, 台湾 302',
          status: '营业中 – 今日 11:00–14:00、17:00–21:00',
          phone: '+886 3656 7994',
          plusCode: 'R2H5+7P 竹北市, 新竹县, 台湾',
          imageUrl: 'https://via.placeholder.com/600x400?text=韩国馆',
          mapUrl: 'https://goo.gl/maps/…',
          hours: [
            { day: '周日', time: '11:00–14:00、17:00–21:00' },
            { day: '周一', time: '休息' },
            { day: '周二', time: '11:00–14:00、17:00–21:00' },
            { day: '周三', time: '11:00–14:00、17:00–21:00' },
            { day: '周四', time: '11:00–14:00、17:00–21:00' },
            { day: '周五', time: '11:00–14:00、17:00–21:00' },
            { day: '周六', time: '11:00–14:00、17:00–21:00' },
          ],
          description: '现代氛围中的正宗韩式料理专门店。'
        }
      }
    },
  },

  /* ---------------- Chinese ‑ Traditional (zh‑TW) ---------------- */
  'zh-TW': {
    translation: {
      /* Global */
      siteName: '韓國館',
      ourLocations: '門市列表',
      restaurantName: '韓國館',
      home: '首頁',
      about: '關於',
      contact: '聯繫方式',
      login: '登入',
      signup: '註冊',
      logout: '登出',
      profileSettings: '個人資料設定',
      chat: '聊天',
      documents: '文件',
      menu: '菜單',
      location: '位置',
      defaultUser: '用戶',
      firstName: '名字',
      lastName: '姓氏',
      phoneNumber: '電話號碼',
      dateOfBirth: '出生日期',
      email: '電子郵件',
      password: '密碼',
      confirmPassword: '確認密碼',
      passwordsNotMatch: '密碼不匹配。',
      serverConnectionError: '無法連接到服務器。',
      keepLoggedIn: '保持登入狀態',
      noAccount: '沒有帳戶？',
      forgotPassword: '忘記密碼？',
      emailSent: '郵件已發送',
      resetPassword: '重設密碼',
      enterEmail: '請輸入您的電子郵件',
      manageProfile: '管理您的帳戶設定並查看您的個人資料信息。',
      viewProfileDetails: '查看個人資料詳情',
      bibimbabSlogan: '一碗拌飯，感受韓國的溫暖與風味。',
      signupSuccessTitle: '註冊成功！',
      signupSuccessMessage: '歡迎，{{userName}}！請登入以享受我們的服務。',

      /* LocationModal */
      findRestaurant: '尋找餐廳',
      enterAddress: '輸入地址、城市或郵遞區號',
      enterAddressPlaceholder: '輸入地點',
      useCurrentLocation: '使用我的目前位置',
      cancel: '取消',
      search: '搜尋',

      /* UI Keys */
      addressLabel: '地址',
      phoneLabel: '電話',
      distanceUnit: '公里',
      orderPickup: '到店自取',
      orderDelivery: '外送訂單',
      orderCatering: '餐飲訂購',
      mapDirections: '地圖 & 路線',
      storeDetailsTab: '餐廳詳情',
      aboutUsTab: '關於我們',
      communityTab: '社區',
      careersTab: '招募資訊',
      hoursHeading: '營業時間',
      serviceOptionsHeading: '服務選項及時間',
      goBack: '返回',
      aboutUsContent: '我們一直在為顧客提供優質服務……',
      communityContent: '我們的門市參與在地活動……',
      careersContent: '加入我們的團隊！我們正在招募……',

      /* Store Data */
      stores: {
        1: {
          name: '韓國館',
          address: 'No. 32號, Lane 135, Xianzhengjiu Rd, 竹北市, 新竹縣, 台灣 302',
          status: '營業中 – 今天 11:00–14:00、17:00–21:00',
          phone: '+886 3656 7994',
          plusCode: 'R2H5+7P 北崙里, 竹北市, 新竹縣, 台灣',
          imageUrl: 'https://via.placeholder.com/600x400?text=韓國館',
          mapUrl: 'https://goo.gl/maps/…',
          hours: [
            { day: '週日', time: '11:00–14:00、17:00–21:00' },
            { day: '週一', time: '休息' },
            { day: '週二', time: '11:00–14:00、17:00–21:00' },
            { day: '週三', time: '11:00–14:00、17:00–21:00' },
            { day: '週四', time: '11:00–14:00、17:00–21:00' },
            { day: '週五', time: '11:00–14:00、17:00–21:00' },
            { day: '週六', time: '11:00–14:00、17:00–21:00' },
          ],
          description: '現代氛圍中的正宗韓式料理專門店。'
        }
      }
    },
  },

  /* ---------------- Japanese (ja) ---------------- */
  ja: {
    translation: {
      /* Global */
      siteName: '韓国館',
      ourLocations: '店舗一覧',
      restaurantName: '韓国館',
      home: 'ホーム',
      about: '紹介',
      contact: '連絡先',
      login: 'ログイン',
      signup: 'サインアップ',
      logout: 'ログアウト',
      profileSettings: 'プロフィール設定',
      chat: 'チャット',
      documents: 'ドキュメント',
      menu: 'メニュー',
      location: 'ロケーション',
      defaultUser: 'ユーザー',
      firstName: '名前',
      lastName: '姓',
      phoneNumber: '電話番号',
      dateOfBirth: '生年月日',
      email: 'メールアドレス',
      password: 'パスワード',
      confirmPassword: 'パスワード確認',
      passwordsNotMatch: 'パスワードが一致しません。',
      serverConnectionError: 'サーバーに接続できません。',
      keepLoggedIn: 'ログイン状態を維持する',
      noAccount: 'アカウントがありませんか？',
      forgotPassword: 'パスワードをお忘れですか？',
      emailSent: 'メール送信完了',
      resetPassword: 'パスワード再設定',
      enterEmail: 'メールアドレスを入力してください',
      manageProfile: 'アカウント設定を管理し、プロフィール情報を確認してください。',
      viewProfileDetails: 'プロフィール詳細を表示',
      bibimbabSlogan: '一杯のビビンバに、韓国の温かさと風味を感じてください。',
      signupSuccessTitle: '登録成功！',
      signupSuccessMessage: 'ようこそ、{{userName}}さん！ログインして韓国館のサービスをご利用ください。',

      /* LocationModal */
      findRestaurant: 'レストランを探す',
      enterAddress: '住所、都市、郵便番号を入力',
      enterAddressPlaceholder: '場所を入力してください',
      useCurrentLocation: '現在地を使用',
      cancel: 'キャンセル',
      search: '検索',

      /* StoreDetailPage & LocationPage UI Keys */
      addressLabel: '住所',
      phoneLabel: '電話番号',
      distanceUnit: 'km',
      orderPickup: '店舗受取',
      orderDelivery: 'デリバリー注文',
      orderCatering: 'ケータリング注文',
      mapDirections: '地図＆ルート',
      storeDetailsTab: '店舗詳細',
      aboutUsTab: '会社概要',
      communityTab: 'コミュニティ',
      careersTab: '採用情報',
      hoursHeading: '営業時間',
      serviceOptionsHeading: 'サービスオプションと営業時間',
      goBack: '戻る',

      /* Store Data */
      stores: {
        1: {
          name: '韓国館',
          address: 'No. 32号, Lane 135, Xianzhengjiu Rd, 竹北市, 新竹県, 台湾 302',
          status: '営業中 – 本日 11:00–14:00、17:00–21:00',
          phone: '+886 3656 7994',
          plusCode: 'R2H5+7P 竹北市, 新竹県, 台湾',
          imageUrl: 'https://via.placeholder.com/600x400?text=韓国館',
          mapUrl: 'https://goo.gl/maps/…',
          hours: [
            { day: '日曜日', time: '11:00–14:00、17:00–21:00' },
            { day: '月曜日', time: '休業' },
            { day: '火曜日', time: '11:00–14:00、17:00–21:00' },
            { day: '水曜日', time: '11:00–14:00、17:00–21:00' },
            { day: '木曜日', time: '11:00–14:00、17:00–21:00' },
            { day: '金曜日', time: '11:00–14:00、17:00–21:00' },
            { day: '土曜日', time: '11:00–14:00、17:00–21:00' },
          ],
          description: 'モダンな雰囲気で楽しむ本格韓国料理専門店。'
        }
      }
    },
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    lng: 'zh-TW',
    fallbackLng: 'zh-TW',
    debug: true,
    interpolation: { escapeValue: false },
  });

export default i18n;
