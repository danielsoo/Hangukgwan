// backend/controllers/authController.js
const User = require('../models/User');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

exports.register = async (req, res) => {
  // 프론트엔드에서 보낸 필드에 맞춰 데이터 추출
  const { firstName, lastName, email, password, phone, dob } = req.body;
  try {
    // 중복된 이메일이 있는지 먼저 체크
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: '이미 가입된 이메일입니다.' });
    }

    // firstName과 lastName을 합쳐 username 생성
    const username = `${firstName} ${lastName}`;
    
    // 비밀번호 암호화
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // User 모델에 추가 필드와 함께 저장
    const user = await User.create({ username, email, password: hashedPassword, phone, dob });
    
    res.status(201).json({ message: '회원가입 성공', user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: '회원가입 실패', error });
  }
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: '비밀번호가 일치하지 않습니다.' });

    // JWT 토큰 발행
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.status(200).json({ message: '로그인 성공', token });
  } catch (error) {
    res.status(500).json({ message: '로그인 실패', error });
  }
};
