import React, { useState } from 'react';
import { Box, Paper, TextField, Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (response.ok) {
        setMessage(`${t('emailSent')}: ${data.message}`);
        setIsError(false);
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
    <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 3 }}>
      <Paper
        elevation={6}
        sx={{
          width: 'min(92vw, 24rem)',
          p: 3,
          backgroundColor: 'rgba(255, 255, 255)',
          backdropFilter: 'blur(10px)',
          borderRadius: 2,
        }}
      >
        <Typography variant="h5" align="center" gutterBottom>
          {t('forgotPassword')}
        </Typography>
        <form onSubmit={handleForgotPassword}>
          <TextField label={t('enterEmail')} variant="outlined" fullWidth margin="normal" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" variant="contained" color="primary" fullWidth sx={{ mt: 2 }}>
            {t('resetPassword')}
          </Button>
        </form>
        <Typography variant="body2" align="center" sx={{ mt: 2, color: isError ? 'error.main' : 'inherit' }}>
          {message}
        </Typography>
      </Paper>
    </Box>
  );
}

export default ForgotPassword;
