// ============================================================================
//  LocationModal.jsx
//  ────────────────────────────────────────────────────────────────────────────
//  • 사용자가 주소를 입력하거나 현재 위치를 이용해 레스토랑을 검색할 수 있는
//    모달 컴포넌트입니다.
//  • 변경 사항
//      1) 제목 영역 아이콘 제거 (요청 반영)
//      2) 하단 "현재 위치 사용" 버튼은 📍 아이콘 유지
//      3) TextField에 placeholder={t('enterAddressPlaceholder')} 추가
// ============================================================================

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
import LocationOnIcon from '@mui/icons-material/LocationOn';   // 📍 위치 아이콘
import { Autocomplete } from '@react-google-maps/api';
import { useTranslation } from 'react-i18next';

/**
 * LocationModal Component
 * ---------------------------------------------------------------------------
 * @param {boolean}   open     - Modal open state
 * @param {function}  onClose  - Callback to close the modal
 * @param {function}  onSubmit - Callback; returns { address } or { lat, lng }
 * ---------------------------------------------------------------------------
 */
function LocationModal({ open, onClose, onSubmit }) {
  const { t } = useTranslation();              // 🌐 다국어 훅
  const [address, setAddress] = useState('');  // 입력된 주소 상태
  const [autocomplete, setAutocomplete] = useState(null); // Google Autocomplete 인스턴스

  // ──────────────────────────────────────────────────────────────────────────
  // Google Places Autocomplete
  // ──────────────────────────────────────────────────────────────────────────
  const handleLoad = (autoC) => setAutocomplete(autoC); // Autocomplete 로드 시

  const handlePlaceChanged = () => {
    if (!autocomplete) return;
    const place = autocomplete.getPlace();
    if (place?.formatted_address) setAddress(place.formatted_address);
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Event Handlers
  // ──────────────────────────────────────────────────────────────────────────
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
      (position) => {
        const { latitude, longitude } = position.coords;
        onSubmit({ lat: latitude, lng: longitude });
        onClose();
      },
      (error) => {
        alert('Unable to retrieve your location.');
        console.error(error);
      },
    );
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onClose={onClose}>
      <Box sx={{ textAlign: 'center', p: 2 }}>
        {/* ---------- Title 영역 (아이콘 제거) ---------- */}
        <DialogTitle sx={{ textAlign: 'center', mb: 1 }}>
          <Typography variant="h5" component="span">
            {t('findRestaurant')}
          </Typography>
        </DialogTitle>

        {/* ---------- Input 영역 ---------- */}
        <DialogContent sx={{ minWidth: 300 }}>
          {typeof window !== 'undefined' && window.google ? (
            <Autocomplete onLoad={handleLoad} onPlaceChanged={handlePlaceChanged}>
              <TextField
                fullWidth
                label={t('enterAddress')}
                placeholder={t('enterAddressPlaceholder')}   // ← placeholder 다국어
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
              placeholder={t('enterAddressPlaceholder')}     // ← placeholder 다국어
              variant="outlined"
              margin="normal"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          )}

          {/* 현재 위치 사용 버튼 (왼쪽 정렬) */}
          <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
            <Button
              variant="text"
              onClick={handleUseCurrentLocation}
              sx={{ mt: 2, textTransform: 'none' }}
              startIcon={<LocationOnIcon />}  // 📍 아이콘 유지
            >
              {t('useCurrentLocation')}
            </Button>
          </Box>
        </DialogContent>

        {/* ---------- Action Buttons ---------- */}
        <DialogActions sx={{ justifyContent: 'center' }}>
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
