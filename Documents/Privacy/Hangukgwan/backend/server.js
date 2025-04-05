// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 4000; // 3000 -> 4000 으로 변경 (React가 3000 사용함)

// CORS 설정 (frontend에서 오는 요청 허용)
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));

// JSON 요청 파싱
app.use(express.json());

// MongoDB 연결
require('./config/db');

// API 라우트 연결
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// 기본 경로 테스트
app.get('/', (req, res) => {
  res.send('서버가 정상적으로 작동중입니다.');
});

app.listen(port, () => {
  console.log(`서버가 http://localhost:${port} 에서 실행중입니다.`);
});
