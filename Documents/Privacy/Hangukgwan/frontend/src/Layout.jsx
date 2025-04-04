// src/Layout.jsx
import React from 'react';
import { Outlet } from 'react-router-dom';
import Header from './components/Header';

function Layout() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
      <Header />
      <main
        style={{
          marginTop: '125px',           // 헤더 높이만큼 여백
          minHeight: 'calc(100vh - 125px)', // 남은 화면 높이를 할당
          display: 'flex',
          flex: 1,
          alignItems: 'center',         // 수직 중앙 정렬
          justifyContent: 'center',     // 수평 중앙 정렬
          width: '100%',                // 전체 너비 사용
          textAlign: 'center'           // 텍스트도 중앙 정렬 (선택 사항)
        }}
      >
        <Outlet />
      </main>
    </div>
  );
}

export default Layout;
