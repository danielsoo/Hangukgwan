// src/components/Home.js
import React from 'react';
import { Typography, Button } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import ParallaxSection from './ParallaxSection'; // 기존 배경 컴포넌트
import '../styles/Home.css';
import bibimbapImage from '../assets/images/bibimbab.png'; // 이미지 import

function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <>
      {/* 기존 배경을 설정하는 ParallaxSection */}
      <ParallaxSection />
      
      {/* 배경 위에 오버레이되는 콘텐츠 */}
      <div className="overlay-content">
        {/* 왼쪽 영역: 슬로건 */}
        <div className="overlay-left">
          <Typography variant="h3" sx={{ mb: 2 }}>
            {t('bibimbabSlogan')}
          </Typography>
          <Button variant="contained" color="primary" onClick={() => navigate('/menu')}>
            {t('menu')}
          </Button>
        </div>
        {/* 오른쪽 영역: 비빔밥 이미지 */}
        <div className="overlay-right">
          <img src={bibimbapImage} alt="Bibimbap" />
        </div>
      </div>
    </>
  );
}

export default Home;
