import React, { useState, useContext, useEffect } from 'react';
import { Box, Paper, Typography, TextField, Button, FormControlLabel, Checkbox, Link } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import PasswordField from './PasswordField';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../../contexts/AuthContext';

function Login() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const navigate = useNavigate();
  const { login } = useContext(AuthContext);

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
        if (rememberMe) {
          localStorage.setItem('rememberedEmail', email);
        } else {
          localStorage.removeItem('rememberedEmail');
        }
  
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
  
        login(data.user);        // ✅ 사용자 정보 컨텍스트에 반영
        navigate('/');           // ✅ 새로고침 없이 이동
      } else {
        setMessage(data.message || t('errors.loginFail'));
        setIsError(true);
      }
    } catch (error) {
      console.error('Login error:', error);
      setMessage(t('serverConnectionError'));
      setIsError(true);
    }
  };
  

  return (
    <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 3 }}>
      <Paper sx={{ width: 'min(92vw, 24rem)', p: 3, borderRadius: 2 }}>
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
            control={
              <Checkbox
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                color="primary"
              />
            }
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
