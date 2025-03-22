// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors'); // 추가
const app = express();
const port = process.env.PORT || 3000;

// CORS 적용
app.use(cors());

// JSON 요청 파싱
app.use(express.json());

// MongoDB 연결
require('./config/db');

// 라우트
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

app.get('/', (req, res) => {
  res.send('서버가 정상적으로 작동중입니다.');
});

app.listen(port, () => {
  console.log(`서버가 ${port}번 포트에서 실행중입니다.`);
});
