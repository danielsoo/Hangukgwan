import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import logo from '../assets/images/hangukgwan_logo_final.png';
import LanguageSwitcher from './LanguageSwitcher';
import LocationModal from './LocationModal';
import '../styles/Header.css';
import { useTranslation } from 'react-i18next';

function Header() {
  const { t } = useTranslation();
  const [scrolled, setScrolled] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

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

  return (
    <header className={scrolled ? 'scrolled' : ''}>
      <div className="header-container">
        {/* 로고 */}
        <NavLink to="/" className="logo">
          <img src={logo} alt={t('siteName')} width = "125" height = "100" />
        </NavLink>

        {/* 메인 내비 */}
        <nav className={`main-nav${menuOpen ? ' open' : ''}`}>
          <NavLink to="/" end>{t('home')}</NavLink>
          <a href="/location" onClick={handleLocationClick}>{t('location')}</a>
          <NavLink to="/menu">{t('menu')}</NavLink>
          <NavLink to="/contact">{t('contact')}</NavLink>
        </nav>

        {/* 오른쪽 메뉴: 항상 오른쪽 끝 */}
        <div className="right-menu">
          <div className="auth-links">
            <NavLink to="/login">{t('login')}</NavLink>
            <NavLink to="/signup">{t('signup')}</NavLink>
          </div>
          <LanguageSwitcher />
        </div>

        {/* 메뉴 토글 버튼 (모바일) */}
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

      {/* 모바일 내비 모달 */}
      <LocationModal
        open={modalOpen}
        onClose={handleModalClose}
        onSubmit={handleModalSubmit}
      />
    </header>
  );
}

export default Header;
