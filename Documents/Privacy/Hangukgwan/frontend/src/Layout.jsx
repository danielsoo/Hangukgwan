// src/Layout.jsx
import React from 'react';
import { Outlet } from 'react-router-dom';
import Header from './components/Header';

function Layout() {
  return (
    <div>
      <Header />
      {/* 헤더 높이가 125px이라고 가정 */}
      <main
        style={{
          marginTop: '125px', // 헤더 높이만큼 여백
          height: 'calc(100vh - 125px)', // 남은 화면 높이를 정확하게 할당하여 중앙 정렬 유지
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          zIndex: 2,
        }}
      >
        <Outlet />
      </main>
    </div>
  );
}

export default Layout;
