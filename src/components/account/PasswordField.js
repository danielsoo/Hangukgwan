//src/components/account/PasswordField.js
// 이 컴포넌트는 비밀번호 입력 필드를 구현하며,
// 사용자가 입력한 비밀번호를 텍스트로 표시하거나 숨길 수 있도록 토글 기능을 제공합니다.

import React, { useState } from 'react';
import { TextField, IconButton, InputAdornment } from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';

function PasswordField({ label, value, onChange, ...props }) {
  // 비밀번호 보임 여부를 관리하는 상태입니다.
  const [showPassword, setShowPassword] = useState(false);

  // 비밀번호 보임 여부를 토글하는 함수입니다.
  const handleTogglePassword = () => {
    setShowPassword(prev => !prev);
  };

  return (
    <TextField
      label={label}                                  // 입력 필드의 라벨
      type={showPassword ? 'text' : 'password'}       // showPassword에 따라 입력 타입 결정
      value={value}                                  // 입력 값
      onChange={onChange}                            // 값 변경 이벤트 처리
      fullWidth                                      // 가로 전체 사용
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            {/* 아이콘 버튼 클릭 시 비밀번호 보임 토글 */}
            <IconButton onClick={handleTogglePassword} edge="end">
              {showPassword ? <VisibilityOff /> : <Visibility />}
            </IconButton>
          </InputAdornment>
        ),
      }}
      {...props}                                     // 추가 props 전달
    />
  );
}

export default PasswordField;
