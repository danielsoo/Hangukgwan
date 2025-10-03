// LocationModal.jsx (좌우 스크롤 제거 버전)

import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  TextField,
} from '@mui/material';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import { Autocomplete } from '@react-google-maps/api';
import { useTranslation } from 'react-i18next';

function LocationModal({ open, onClose, onSubmit }) {
  const { t } = useTranslation();
  const [address, setAddress] = useState('');
  const [autocomplete, setAutocomplete] = useState(null);

  const handleLoad = (ac) => setAutocomplete(ac);
  const handlePlaceChanged = () => {
    if (!autocomplete) return;
    const place = autocomplete.getPlace();
    if (place?.formatted_address) setAddress(place.formatted_address);
  };

  const handleSearch = () => {
    if (address.trim()) onSubmit({ address });
    onClose();
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords: { latitude, longitude } }) => {
        onSubmit({ lat: latitude, lng: longitude });
        onClose();
      },
      (err) => {
        alert('Unable to retrieve your location.');
        console.error(err);
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xs"                       // 1) 종이 폭을 360~384px 로 제한
      PaperProps={{ sx: { overflowX: 'hidden' } }}  // 2) 종이 내부 가로 스크롤 차단
    >
      <Box
        sx={{
          textAlign: 'center',
          p: 2,
          width: '100%',                  // 3) 종이 안에서 100% 사용
          maxWidth: '24rem',              //    단, 24rem(≈384px) 이상 확장 금지
          mx: 'auto',
        }}
      >
        {/* 제목 */}
        <DialogTitle sx={{ textAlign: 'center', mb: 1 }}>
          <Typography variant="h5">{t('findRestaurant')}</Typography>
        </DialogTitle>

        {/* 입력 영역 */}
        <DialogContent sx={{ px: 0 }}>
          {typeof window !== 'undefined' && window.google ? (
            <Autocomplete onLoad={handleLoad} onPlaceChanged={handlePlaceChanged}>
              <TextField
                fullWidth
                label={t('enterAddress')}
                placeholder={t('enterAddressPlaceholder')}
                variant="outlined"
                margin="normal"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </Autocomplete>
          ) : (
            <TextField
              fullWidth
              label={t('enterAddress')}
              placeholder={t('enterAddressPlaceholder')}
              variant="outlined"
              margin="normal"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          )}

          {/* 현재 위치 버튼 */}
          <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
            <Button
              variant="text"
              onClick={handleUseCurrentLocation}
              sx={{ mt: 2, textTransform: 'none' }}
              startIcon={<LocationOnIcon />}
            >
              {t('useCurrentLocation')}
            </Button>
          </Box>
        </DialogContent>

        {/* 액션 버튼 */}
        <DialogActions sx={{ justifyContent: 'center', px: 0 }}>
          <Button onClick={onClose} color="inherit">
            {t('cancel')}
          </Button>
          <Button variant="contained" onClick={handleSearch}>
            {t('search')}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

export default LocationModal;
