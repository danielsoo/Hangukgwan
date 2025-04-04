// src/components/Header.js
import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import logo from '../assets/images/hangukgwan_logo.png';
import LanguageSwitcher from './LanguageSwitcher';
import LocationModal from './LocationModal';
import '../styles/Header.css';

function Header() {
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
    console.log("Location button clicked"); // 디버깅용
    setModalOpen(true);
  };

  const handleModalClose = () => {
    setModalOpen(false);
  };

  const handleModalSubmit = async (locationData) => {
    console.log("Location data received:", locationData); // 디버깅용
    if (locationData.lat && locationData.lng) {
      navigate('/location', { state: { lat: locationData.lat, lng: locationData.lng } });
    } else if (locationData.address) {
      // 주소 입력 시 geocoding 처리 (코드가 추가되어야 함)
      // 예: await geocodeAddress(...) 후 좌표를 얻어서 전달
      // 테스트로 그냥 navigate 해보겠습니다.
      navigate('/location', { state: { address: locationData.address } });
    }
    setModalOpen(false);
  };

  return (
    <header className={scrolled ? 'scrolled' : ''}>
      <div className="header-container">
        <NavLink to="/" className="logo">
          <img src={logo} alt="Hangukgwan Logo" />
        </NavLink>
        <nav className="main-nav">
          <NavLink to="/" end>Home</NavLink>
          <a href="/location" onClick={handleLocationClick} className="location-link">
            Location
          </a>
          <NavLink to="/menu">Menu</NavLink>
          <NavLink to="/contact">Contact</NavLink>
        </nav>
        <div className="right-menu">
          <div className="auth-links">
            <NavLink to="/login">Login</NavLink>
            <NavLink to="/signup">Signup</NavLink>
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
