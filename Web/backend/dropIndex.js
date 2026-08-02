// dropIndex.js
require('dotenv').config(); // 환경 변수 로드
const mongoose = require('mongoose');

const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/test';

const options = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
};

mongoose.connect(mongoURI, options)
  .then(() => {
    console.log("MongoDB에 성공적으로 연결되었습니다.");
    // 'users' 컬렉션에서 'username_1' 인덱스를 삭제합니다.
    mongoose.connection.db.collection('users').dropIndex('username_1', (err, result) => {
      if (err) {
        console.error("인덱스 삭제 실패:", err);
      } else {
        console.log("인덱스가 성공적으로 삭제되었습니다:", result);
      }
      mongoose.connection.close(() => {
        console.log("MongoDB 연결 종료.");
        process.exit();
      });
    });
  })
  .catch(err => {
    console.error("MongoDB 연결 실패:", err);
    process.exit(1);
  });
