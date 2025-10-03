const User = require('../models/User');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// 회원가입 컨트롤러
exports.register = async (req, res) => {
  // i18next 미들웨어가 설정되어 있다면 req.t를 사용할 수 있습니다.
  const { t } = req;
  const { firstName, lastName, email, password, phone, dob } = req.body;
  
  // 필수 필드 체크
  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ message: t('errors.missingFields') });
  }

  try {
    // 이메일 중복 체크
    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({ message: t('errors.emailExists') });
    }
    
    // username은 lastName과 firstName을 공백 없이 합칩니다.
    const username = `${lastName}${firstName}`;
    
    // 비밀번호 암호화 (salt round: 10)
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // User 모델에 새 사용자 저장
    const user = await User.create({ 
      firstName, 
      lastName, 
      username,
      email, 
      phone, 
      dob, 
      password: hashedPassword 
    });
    
    res.status(201).json({ message: t('success.register'), user });
  } catch (error) {
    console.error('회원가입 에러:', error);
    res.status(500).json({ message: t('errors.registerFail'), error });
  }
};

// 로그인 컨트롤러
exports.login = async (req, res) => {
  const { t } = req;
  const { email, password } = req.body;
  
  // 필수 로그인 필드 체크
  if (!email || !password) {
    return res.status(400).json({ message: t('errors.missingLoginFields') });
  }
  
  try {
    // 이메일로 사용자 검색
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: t('errors.userNotFound') });
    }

    // 비밀번호 비교
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: t('errors.incorrectPassword') });
    }

    // JWT 토큰 발행 (유효기간 1시간)
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    // 로그인 성공 시 토큰과 함께 user 객체 반환
    res.status(200).json({ message: t('success.login'), token, user });
  } catch (error) {
    console.error('로그인 에러:', error);
    res.status(500).json({ message: t('errors.loginFail'), error });
  }
};
