// backend/server.js
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const axios = require('axios');

// --- DB 연결 ---
// 네가 만든 db.js가 mongoose.connect 호출하면 그냥 require('./db') 해도 됨.
try {
  require('./db');
  console.log('db module loaded.');
} catch (err) {
  console.warn('db.js not found or failed to load. Make sure you have backend/db.js that connects to MongoDB.', err.message);
}

// --- express 앱 생성 ---
const app = express();

// --- 미들웨어 ---
app.use(cors()); // 개발중 모든 출처 허용. 배포시 origin 제한 권장
app.use(express.json()); // application/json body 파싱
app.use(express.urlencoded({ extended: true }));

// --- 간단한 i18n 안전 초기화 (i18next가 없거나 locales 파일 없을 때도 동작하게) ---
let i18nextAvailable = false;
try {
  const i18next = require('i18next');
  const Backend = require('i18next-fs-backend');
  const middleware = require('i18next-http-middleware');

  i18next
    .use(Backend)
    .use(middleware.LanguageDetector)
    .init({
      debug: false,
      fallbackLng: 'en',
      preload: ['en', 'ko', 'zh', 'ja'],
      backend: {
        loadPath: path.join(__dirname, 'locales/{{lng}}/translation.json'),
      },
      returnEmptyString: false,
    });

  app.use(middleware.handle(i18next));
  i18nextAvailable = true;
  console.log('i18next initialized.');
} catch (err) {
  // 안전하게 계속 동작하도록 req.t를 제공
  app.use((req, res, next) => {
    req.t = (k) => k; // 단순 키 반환
    next();
  });
  console.warn('i18next not available or failed to init. Continuing without translations.'); 
}

// --- 기존 auth 라우트(있는 경우 연결) ---
try {
  const authRouter = require('./routes/auth');
  if (authRouter) {
    app.use('/api/auth', authRouter);
    console.log('Auth router mounted at /api/auth');
  }
} catch (err) {
  console.warn('routes/auth.js not found. Skipping auth route. If you have it, place it at backend/routes/auth.js');
}

// --- geocode 라우트 (서버 프록시로 Google Geocoding 사용) ---
// GET /api/geocode?address=<주소>
const geocodeRouter = express.Router();

geocodeRouter.get('/', async (req, res) => {
  const address = req.query.address || req.body.address;
  if (!address) return res.status(400).json({ error: 'address query parameter or body.address is required' });

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY not set in server env' });

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
    const { data } = await axios.get(url);
    if (data.status === 'OK' && data.results && data.results.length > 0) {
      const { lat, lng } = data.results[0].geometry.location;
      return res.json({ lat, lng, raw: data.results[0] });
    } else {
      return res.status(400).json({ error: 'Geocoding failed', details: data });
    }
  } catch (err) {
    console.error('Geocoding error:', err.message || err);
    return res.status(500).json({ error: err.message || 'Geocoding request failed' });
  }
});

app.use('/api/geocode', geocodeRouter);
console.log('Geocode route mounted at /api/geocode');

// --- 헬스체크 ---
app.get('/api/health', (req, res) => res.json({ ok: true }));

// --- 정적 파일 서빙 (프로덕션에서 빌드된 React 앱을 제공) ---
if (process.env.NODE_ENV === 'production') {
  const buildPath = path.join(__dirname, '..', 'frontend', 'build'); // 프로젝트 구조에 따라 경로 조정
  app.use(express.static(buildPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(buildPath, 'index.html'));
  });
}

// --- 에러 핸들러 (간단한) ---
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// --- 서버 시작 ---
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`서버가 http://localhost:${PORT} 에서 실행중입니다.`);
});
