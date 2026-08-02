// src/components/CountryCodeInput.js
import React from 'react';
import { Autocomplete, TextField, Box, Typography } from '@mui/material';

const countryCodes = [
  { code: '+1', label: 'USA', flag: '🇺🇸' },
  { code: '+44', label: 'UK', flag: '🇬🇧' },
  { code: '+82', label: 'Korea', flag: '🇰🇷' },
  { code: '+886', label: 'Taiwan', flag: '🇹🇼' },
  { code: '+91', label: 'India', flag: '🇮🇳' },
  { code: '+81', label: 'Japan', flag: '🇯🇵' },
  { code: '+33', label: 'France', flag: '🇫🇷' },
  { code: '+49', label: 'Germany', flag: '🇩🇪' },
  { code: '+61', label: 'Australia', flag: '🇦🇺' },
  { code: '+86', label: 'China', flag: '🇨🇳' },
  // 추가 가능한 국가 코드들...
];

export default function CountryCodeInput({ value, onChange }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Autocomplete
        freeSolo
        options={countryCodes.map(option => option.code)}
        value={value}
        onChange={(event, newValue) => {
          onChange(newValue);
        }}
        onInputChange={(event, newInputValue) => {
          onChange(newInputValue);
        }}
        renderInput={(params) => (
          <TextField {...params} label="국가 코드" variant="outlined" />
        )}
        sx={{ width: 120 }}
      />
      <Typography variant="h5">
        {countryCodes.find(item => item.code === value)?.flag || ''}
      </Typography>
    </Box>
  );
}
