import React from 'react';
import { Box, Typography, Paper } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useTranslation } from 'react-i18next';

function SignupSuccess({ userName }) {
  const { t } = useTranslation();

  return (
    <Paper elevation={3} sx={{ p: 3, textAlign: 'center', borderRadius: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
        <CheckCircleIcon sx={{ fontSize: 64, color: 'green' }} />
      </Box>
      <Typography variant="h5" sx={{ mb: 1 }}>
        {t('signupSuccessTitle')}
      </Typography>
      <Typography variant="body1" sx={{ mb: 2 }}>
        {t('signupSuccessMessage', { userName })}
      </Typography>
    </Paper>
  );
}

export default SignupSuccess;
