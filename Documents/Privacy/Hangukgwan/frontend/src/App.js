// src/App.js
import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

// 헤더와 페이지 컴포넌트 임포트
import Header from './components/Header'; 
import Home from './components/Home';
import Login from './components/Login';
import Signup from './components/Signup';
import ForgotPassword from './components/ForgotPassword';

function App() {
  return (
    <Router>
      {/* 모든 페이지에 공통으로 표시될 고정 헤더 */}
      <Header />
      
      {/* 각 페이지별 라우팅 */}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
      </Routes>
    </Router>
  );
}

export default App;
