// src/App.js
import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

// 헤더와 페이지 컴포넌트 임포트
import Header from './components/Header'; 
import Home from './components/Home';
import Login from './components/Login';
import Signup from './components/Signup';
import ForgotPassword from './components/ForgotPassword';
import ParallaxSection from './components/ParallaxSection'; // 또는 그냥 div를 직접 사용해도 됩니다.
import './index.css';


function App() {
  return (
    <Router>
      <ParallaxSection />
      <Header />
      {/* 다른 콘텐츠들은 배경 위에 위치하도록 z-index 조정 */}
      <div style={{ position: 'relative', zIndex: 2 }}>
        {/* 각 페이지별 라우팅 */}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
        </Routes>
      </div>
      </Router>
  );
}

export default App;
