// src/components/Signup.js
import React, { useState } from 'react';
import { Box, Paper, Typography, TextField, Button, Link as MuiLink } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PasswordField from './PasswordField';
import SignupSuccess from './SignupSuccess';
import CountryCodeInput from './CountryCodeInput';

function Signup() {
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [countryCode, setCountryCode] = useState('+1');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);
  const navigate = useNavigate();

  const handleSignup = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setMessage(t('passwordsNotMatch'));
      setIsError(true);
      return;
    }
    try {
      const fullPhone = `${countryCode}${phone}`;
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName,
          lastName,
          phone: fullPhone,
          dob,
          email,
          password
        }),
      });
      const data = await response.json();
      if (response.ok) {
        setMessage(data.message);
        setIsError(false);
        setSignupSuccess(true);
      } else {
        setMessage(data.message);
        setIsError(true);
      }
    } catch (error) {
      setMessage(t('serverConnectionError'));
      setIsError(true);
    }
  };

  if (signupSuccess) {
    return (
      <Box sx={{ width: '100vw', minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: 'background.default' }}>
        <SignupSuccess userName={firstName} />
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100vw', minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: 'background.default' }}>
      <Paper sx={{ width: 400, p: 3, borderRadius: 2 }}>
        <Typography variant="h5" align="center" gutterBottom>
          {t('signup')}
        </Typography>
        <form onSubmit={handleSignup}>
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <TextField
              label={t('firstName')}
              variant="outlined"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              fullWidth
              required
            />
            <TextField
              label={t('lastName')}
              variant="outlined"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              fullWidth
              required
            />
          </Box>
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <CountryCodeInput value={countryCode} onChange={setCountryCode} />
            <TextField
              label={t('phoneNumber')}
              variant="outlined"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              fullWidth
              required
            />
          </Box>
          <TextField
            label={t('dateOfBirth')}
            type="date"
            variant="outlined"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            fullWidth
            required
            InputLabelProps={{ shrink: true }}
            sx={{ mb: 2 }}
          />
          <TextField
            label={t('email')}
            type="email"
            variant="outlined"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            fullWidth
            required
            sx={{ mb: 2 }}
          />
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <PasswordField
              label={t('password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fullWidth
              required
            />
            <PasswordField
              label={t('confirmPassword')}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              fullWidth
              required
            />
          </Box>
          <Button type="submit" variant="contained" fullWidth sx={{ mt: 1, mb: 2 }} color="primary">
            {t('signup')}
          </Button>
        </form>
        <Typography variant="body2" align="center" sx={{ color: isError ? 'error.main' : 'secondary.main' }}>
          {message}
        </Typography>
      </Paper>
    </Box>
  );
}

export default Signup;
