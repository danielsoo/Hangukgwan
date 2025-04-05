// src/components/Login.js
import React, { useState, useEffect } from 'react';
import { Box, Paper, Typography, TextField, Button, FormControlLabel, Checkbox, Link } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import PasswordField from './PasswordField';
import { useTranslation } from 'react-i18next';

function Login() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const savedEmail = localStorage.getItem('rememberedEmail');
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/auth/login', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (response.ok) {
        localStorage.setItem('token', data.token);
        if (rememberMe) {
          localStorage.setItem('rememberedEmail', email);
        } else {
          localStorage.removeItem('rememberedEmail');
        }
        navigate('/');
      } else {
        setMessage(data.message);
        setIsError(true);
      }
    } catch (error) {
      setMessage(t('serverConnectionError'));
      setIsError(true);
    }
  };

  return (
    <Box
      sx={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 3,
      }}
    >
      <Paper sx={{ width: 400, p: 3, borderRadius: 2 }}>
        <Typography variant="h5" align="center" gutterBottom>
          {t('login')}
        </Typography>
        <form onSubmit={handleLogin}>
          <TextField
            label={t('email')}
            variant="outlined"
            fullWidth
            margin="normal"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <PasswordField
            label={t('password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <FormControlLabel
            control={<Checkbox checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} color="primary" />}
            label={t('keepLoggedIn')}
          />
          <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} color="primary">
            {t('login')}
          </Button>
        </form>
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <Typography variant="body2" sx={{ mr: 1 }}>
            {t('noAccount')}
          </Typography>
          <Link href="/signup" variant="body2">
            {t('signup')}
          </Link>
        </Box>
        {message && (
          <Typography variant="body2" align="center" sx={{ mt: 2, color: isError ? 'error.main' : 'secondary.main' }}>
            {message}
          </Typography>
        )}
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
          <Link href="/forgot-password" variant="body2">
            {t('forgotPassword')}
          </Link>
        </Box>
      </Paper>
    </Box>
  );
}

export default Login;
