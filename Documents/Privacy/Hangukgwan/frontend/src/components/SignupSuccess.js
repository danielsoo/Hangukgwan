// src/components/SignupSuccess.js
import React from 'react';
import { Box, Typography, Paper } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

function SignupSuccess({ userName }) {
  return (
    <Paper elevation={3} sx={{ p: 3, textAlign: 'center', borderRadius: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
        <CheckCircleIcon sx={{ fontSize: 64, color: 'green' }} />
      </Box>
      <Typography variant="h5" sx={{ mb: 1 }}>
        회원가입 성공!
      </Typography>
      <Typography variant="body1" sx={{ mb: 2 }}>
        환영합니다, {userName}님! 로그인 후 Hangukgwan의 서비스를 이용해 주세요.
      </Typography>
    </Paper>
  );
}

export default SignupSuccess;
