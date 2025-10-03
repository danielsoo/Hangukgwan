// frontend/src/components/MainContent.js
import React from 'react';
import { Box, Typography } from '@mui/material';

function MainContent() {
  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h4">
        환영합니다, Hangukgwan에 오신 것을 환영합니다!
      </Typography>
      <Typography variant="body1" paragraph>
        Hangukgwan은 최신 기술과 창의적인 디자인을 결합한 통합 플랫폼입니다. 
        이곳에서는 다양한 서비스를 통해 사용자들이 손쉽게 정보를 공유하고 소통할 수 있습니다.
      </Typography>
      <Typography variant="body1" paragraph>
        우리의 목표는 안정적이고 확장 가능한 서비스를 제공하여, 여러분의 일상에 편리함과 즐거움을 더하는 것입니다.
        지속적인 업데이트와 개선을 통해 여러분의 기대를 뛰어넘는 경험을 선사할 것을 약속드립니다.
      </Typography>
      <Typography variant="body1" paragraph>
        지금 바로 Hangukgwan의 새로운 경험을 시작해보세요!
      </Typography>
    </Box>
  );
}

export default MainContent;
