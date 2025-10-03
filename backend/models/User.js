const mongoose = require('mongoose');

// User 스키마 수정: firstName, lastName, 그리고 username (lastName+firstName) 필드를 저장합니다.
const UserSchema = new mongoose.Schema({
  firstName: { type: String, required: true },          // 사용자의 이름
  lastName: { type: String, required: true },           // 사용자의 성
  // username은 성과 이름을 공백 없이 합친 값으로 저장됩니다.
  username: { type: String, required: true },
  email: { type: String, required: true, unique: true },  // 이메일 고유
  phone: { type: String, required: true, unique: true },  // 전화번호 고유
  password: { type: String, required: true },           // 암호화된 비밀번호
  dob: { type: Date }                                    // 생년월일
}, {
  timestamps: true  // createdAt과 updatedAt 필드를 자동으로 관리
});

module.exports = mongoose.model('User', UserSchema);
