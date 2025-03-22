import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css'; // (필요한 경우 전역 스타일을 추가)
import './i18n'; // i18n 초기화

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
