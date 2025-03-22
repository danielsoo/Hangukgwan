// // src/components/Header.js
// import React, { useState, useEffect } from 'react';
// import { Link } from 'react-router-dom';
// import logo from '../assets/images/hangukgwan_logo.png';
// import LanguageSwitcher from './LanguageSwitcher';
// import '../styles/Header.css';

// function Header() {
//   const [scrolled, setScrolled] = useState(false);

//   useEffect(() => {
//     const handleScroll = () => {
//       setScrolled(window.scrollY > 80);
//     };
//     window.addEventListener('scroll', handleScroll);
//     return () => window.removeEventListener('scroll', handleScroll);
//   }, []);

//   return (
//     <header className={scrolled ? 'scrolled' : ''}>
//       <div className="header-container">
//         <Link to="/" className="logo">
//           <img src={logo} alt="Hangukgwan Logo" />
//         </Link>
//         <nav>
//           <Link to="/">Home</Link>
//           <Link to="/menu">Menu</Link>
//           <Link to="/contact">Contact</Link>
//         </nav>
//       </div>
//       {/* 로그인/사인업 영역 */}
//       <div className="auth-links">
//         <Link to="/login">Login</Link>
//         <Link to="/signup">Signup</Link>
//       </div>
//       {/* LanguageSwitcher를 헤더 컨테이너 밖, 화면 오른쪽에 고정 */}
//       <div className="lang-switcher-absolute">
//         <LanguageSwitcher />
//       </div>
//     </header>
//   );
// }

// export default Header;

// src/components/Header.js
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import logo from '../assets/images/hangukgwan_logo.png';
import LanguageSwitcher from './LanguageSwitcher';
import '../styles/Header.css';

function Header() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 80);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header className={scrolled ? 'scrolled' : ''}>
      <div className="header-container">
        {/* 왼쪽: 로고 */}
        <Link to="/" className="logo">
          <img src={logo} alt="Hangukgwan Logo" />
        </Link>

        {/* 중앙: 내비게이션 (Home / Menu / Contact) */}
        <nav className="main-nav">
          <Link to="/">Home</Link>
          <Link to="/menu">Menu</Link>
          <Link to="/contact">Contact</Link>
        </nav>

        {/* 오른쪽: 로그인/사인업 + 언어 스위처 */}
        <div className="right-menu">
          <div className="auth-links">
            <Link to="/login">Login</Link>
            <Link to="/signup">Signup</Link>
          </div>
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}

export default Header;
