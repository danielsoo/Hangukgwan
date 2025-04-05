// src/components/Header.js
import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import logo from '../assets/images/hangukgwan_logo.png';
import LanguageSwitcher from './LanguageSwitcher';
import LocationModal from './LocationModal';
import '../styles/Header.css';
import { useTranslation } from 'react-i18next';

function Header() {
  const { t } = useTranslation();
  const [scrolled, setScrolled] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 80);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleLocationClick = (e) => {
    e.preventDefault();
    setModalOpen(true);
  };

  const handleModalClose = () => {
    setModalOpen(false);
  };

  const handleModalSubmit = async (locationData) => {
    if (locationData.lat && locationData.lng) {
      navigate('/location', { state: { lat: locationData.lat, lng: locationData.lng } });
    } else if (locationData.address) {
      navigate('/location', { state: { address: locationData.address } });
    }
    setModalOpen(false);
  };

  return (
    <header
      className={scrolled ? 'scrolled' : ''}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        zIndex: 1000,
        backgroundColor: scrolled ? 'rgba(0, 0, 0, 0.8)' : 'transparent', // 스크롤 시 검정/반투명, 없으면 투명
        transition: 'background-color 0.3s ease',
      }}
    >
      <div className="header-container">
        <NavLink to="/" className="logo">
          <img src={logo} alt={t('siteName')} />
        </NavLink>
        <nav className="main-nav">
          <NavLink to="/" end>{t('home')}</NavLink>
          <a href="/location" onClick={handleLocationClick} className="location-link">
            {t('location')}
          </a>
          <NavLink to="/menu">{t('menu')}</NavLink>
          <NavLink to="/contact">{t('contact')}</NavLink>
        </nav>
        <div className="right-menu">
          <div className="auth-links">
            <NavLink to="/login">{t('login')}</NavLink>
            <NavLink to="/signup">{t('signup')}</NavLink>
          </div>
          <LanguageSwitcher />
        </div>
      </div>
      <LocationModal
        open={modalOpen}
        onClose={handleModalClose}
        onSubmit={handleModalSubmit}
      />
    </header>
  );
}

export default Header;
