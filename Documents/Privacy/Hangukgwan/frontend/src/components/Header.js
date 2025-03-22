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
        <Link to="/" className="logo">
          <img src={logo} alt="Hangukgwan Logo" />
        </Link>
        <nav>
          <Link to="/">Home</Link>
          <Link to="/menu">Menu</Link>
          <Link to="/contact">Contact</Link>
        </nav>
      </div>
      {/* LanguageSwitcher를 헤더 컨테이너 밖, 화면 오른쪽에 고정 */}
      <div className="lang-switcher-absolute">
        <LanguageSwitcher />
      </div>
    </header>
  );
}

export default Header;
