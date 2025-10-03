// src/components/Header.js
import React, { useContext, useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import logo from '../assets/images/hangukgwan_logo_final.png';
import LanguageSwitcher from '../language/LanguageSwitcher';
import LocationModal from './LocationModal';
import '../styles/Header.css';
import { useTranslation } from 'react-i18next';
import ProfileMenu from './account/ProfileMenu';
import { AuthContext } from '../contexts/AuthContext';

function Header() {
  const { t, i18n } = useTranslation();
  const [scrolled, setScrolled] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { user, logout } = useContext(AuthContext);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 80);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleLocationClick = (e) => {
    e.preventDefault();
    e.currentTarget.blur();
    setModalOpen(true);
  };

  const handleModalClose = () => setModalOpen(false);

  const handleModalSubmit = (locationData) => {
    if (locationData.lat && locationData.lng) {
      navigate('/location', { state: { lat: locationData.lat, lng: locationData.lng } });
    } else if (locationData.address) {
      navigate('/location', { state: { address: locationData.address } });
    }
    setModalOpen(false);
  };

  // 언어에 따라 사용자 이름 표시 방식 설정
  const displayName = user
    ? (i18n.language === 'en'
        ? user.firstName || user.username || t('defaultUser')
        : (user.firstName && user.lastName)
            ? `${user.lastName}${user.firstName}`
            : user.username || t('defaultUser'))
    : '';

  return (
    <header className={scrolled ? 'scrolled' : ''}>
      <div className="header-container">
        <NavLink to="/" className="logo">
          <img src={logo} alt={t('siteName')} width="125" height="100" />
        </NavLink>

        <nav className={`main-nav${menuOpen ? ' open' : ''}`}>
          <NavLink to="/" end>{t('home')}</NavLink>
          <a href="/location" onClick={handleLocationClick}>{t('location')}</a>
          <NavLink to="/menu">{t('menu')}</NavLink>
          <NavLink to="/contact">{t('contact')}</NavLink>
        </nav>

        <div className="right-menu">
          {user ? (
            <ProfileMenu userName={displayName} onLogout={logout} />
          ) : (
            <div className="auth-links">
              <NavLink to="/login">{t('login')}</NavLink>
              <NavLink to="/signup">{t('signup')}</NavLink>
            </div>
          )}
          <LanguageSwitcher />
        </div>

        <button
          className={`menu-toggle${menuOpen ? ' open' : ''}`}
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      <LocationModal open={modalOpen} onClose={handleModalClose} onSubmit={handleModalSubmit} />
    </header>
  );
}

export default Header;
