// src/components/HeaderFixed.js
import React, { useState, useEffect } from 'react';
import { AppBar, Toolbar, Typography, Box, Button, IconButton, Menu, MenuItem } from '@mui/material';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import { useTranslation } from 'react-i18next';

function HeaderFixed() {
  const { t } = useTranslation();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userName, setUserName] = useState(t('defaultUser'));
  const [anchorEl, setAnchorEl] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      setIsLoggedIn(true);
      try {
        const decoded = jwtDecode(token);
        setUserName(decoded.userName || t('defaultUser'));
      } catch (err) {
        console.error('토큰 디코딩 에러:', err);
        setUserName(t('defaultUser'));
      }
    } else {
      setIsLoggedIn(false);
      setUserName(t('defaultUser'));
    }
  }, [location, t]);

  const handleMenuOpen = (event) => {
    setAnchorEl(event.currentTarget);
  };
  const handleMenuClose = () => {
    setAnchorEl(null);
  };
  const handleLogout = () => {
    localStorage.removeItem('token');
    setIsLoggedIn(false);
    setUserName(t('defaultUser'));
    handleMenuClose();
    navigate('/login');
  };

  return (
    <AppBar
      position="fixed"
      sx={{
        top: 0,
        zIndex: 1300,
        backgroundColor: '#fff',
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
      }}
    >
      <Toolbar sx={{ display: 'flex', alignItems: 'center', height: '64px' }}>
        {/* 왼쪽: 사이트 로고 */}
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          <Typography variant="h5" component={Link} to="/" sx={{ textDecoration: 'none', color: '#333', fontWeight: 'bold' }}>
            {t('siteName')}
          </Typography>
        </Box>
        {/* 중앙: 링크 (예: 채팅, 문서) */}
        <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 3 }}>
          <Typography variant="h6" component={Link} to="/chat" sx={{ color: '#333', textDecoration: 'none', fontSize: '1.2rem' }}>
            {t('chat')}
          </Typography>
          <Typography variant="h6" component={Link} to="/documents" sx={{ color: '#333', textDecoration: 'none', fontSize: '1.2rem' }}>
            {t('documents')}
          </Typography>
        </Box>
        {/* 오른쪽: 메뉴 */}
        <Box sx={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 2 }}>
          <Typography component={Link} to="/about" sx={{ color: '#333', textDecoration: 'none', fontSize: '1rem' }}>
            {t('about')}
          </Typography>
          <Typography component={Link} to="/contact" sx={{ color: '#333', textDecoration: 'none', fontSize: '1rem' }}>
            {t('contact')}
          </Typography>
          {isLoggedIn ? (
            <>
              <IconButton onClick={handleMenuOpen} sx={{ color: '#333' }}>
                <Typography variant="body1">{userName}</Typography>
              </IconButton>
              <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleMenuClose}>
                <MenuItem onClick={() => { handleMenuClose(); navigate('/profile-settings'); }}>
                  {t('profileSettings')}
                </MenuItem>
                <MenuItem onClick={handleLogout}>{t('logout')}</MenuItem>
              </Menu>
            </>
          ) : (
            <>
              <Button variant="contained" component={Link} to="/login" sx={{ borderRadius: '50px', textTransform: 'none', backgroundColor: '#2E7D32', '&:hover': { backgroundColor: '#1B5E20' } }}>
                {t('login')}
              </Button>
              <Button variant="contained" component={Link} to="/signup" sx={{ borderRadius: '50px', textTransform: 'none', backgroundColor: '#2E7D32', '&:hover': { backgroundColor: '#1B5E20' } }}>
                {t('signup')}
              </Button>
            </>
          )}
        </Box>
      </Toolbar>
    </AppBar>
  );
}

export default HeaderFixed;
