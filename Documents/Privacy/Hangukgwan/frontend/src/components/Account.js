// src/components/Account.js
import React, { useState, useEffect } from 'react';
import { Box, Paper, Typography, Button, Avatar } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

function Account() {
  const { t } = useTranslation();
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }
    fetch('/api/auth/profile', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then(res => res.json())
      .then(data => {
        if (data.user) {
          setUser(data.user);
        } else {
          navigate('/login');
        }
      })
      .catch(err => {
        console.error(err);
        navigate('/login');
      });
  }, [navigate, t]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/login');
  };

  if (!user) return null;

  const dobString = new Date(user.dob).toLocaleDateString();

  return (
    <Box sx={{ p: 3, backgroundColor: 'background.default', minHeight: '100vh' }}>
      <Paper sx={{ p: 3, maxWidth: 600, margin: '0 auto', borderRadius: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Avatar sx={{ bgcolor: 'secondary.main', width: 56, height: 56, mr: 2 }}>
            {user.name ? user.name.charAt(0).toUpperCase() : ''}
          </Avatar>
          <Typography variant="h5">
            {user.name}
          </Typography>
        </Box>
        <Typography variant="body1" sx={{ mb: 1 }}>
          {t('phoneNumber')}: {user.phone}
        </Typography>
        <Typography variant="body1" sx={{ mb: 1 }}>
          {t('dateOfBirth')}: {dobString}
        </Typography>
        <Typography variant="body1" sx={{ mb: 2 }}>
          {t('email')}: {user.email}
        </Typography>
        <Typography variant="body2" sx={{ mb: 4 }}>
          {t('manageProfile')}
        </Typography>
        <Button variant="contained" fullWidth sx={{ mb: 2 }} color="primary" onClick={() => navigate('/profile')}>
          {t('viewProfileDetails')}
        </Button>
        <Button variant="outlined" fullWidth onClick={handleLogout} sx={{ borderColor: 'primary.main', color: 'primary.main' }}>
          {t('logout')}
        </Button>
      </Paper>
    </Box>
  );
}

export default Account;
