// src/components/Header.js
import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
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
        <NavLink to="/" className="logo">
          <img src={logo} alt="Hangukgwan Logo" />
        </NavLink>

        {/* 중앙: 내비게이션 (Home / Menu / Contact) */}
        <nav className="main-nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) => (isActive ? 'active-link' : '')}
          >
            Home
          </NavLink>
          <NavLink
            to="/menu"
            className={({ isActive }) => (isActive ? 'active-link' : '')}
          >
            Menu
          </NavLink>
          <NavLink
            to="/contact"
            className={({ isActive }) => (isActive ? 'active-link' : '')}
          >
            Contact
          </NavLink>
        </nav>

        {/* 오른쪽: 로그인/사인업 + 언어 스위처 */}
        <div className="right-menu">
          <div className="auth-links">
            <NavLink
              to="/login"
              className={({ isActive }) => (isActive ? 'active-link' : '')}
            >
              Login
            </NavLink>
            <NavLink
              to="/signup"
              className={({ isActive }) => (isActive ? 'active-link' : '')}
            >
              Signup
            </NavLink>
          </div>
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}

export default Header;
