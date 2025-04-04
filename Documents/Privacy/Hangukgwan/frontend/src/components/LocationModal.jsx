// src/components/LocationModal.jsx
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
import RestaurantIcon from '@mui/icons-material/Restaurant';
import { Autocomplete } from '@react-google-maps/api';

/**
 * LocationModal 컴포넌트
 * @param {boolean} open - 모달 열림 상태
 * @param {function} onClose - 모달 닫기 함수
 * @param {function} onSubmit - 주소 또는 현재 위치 정보를 받아 처리하는 함수
 */
function LocationModal({ open, onClose, onSubmit }) {
  const [address, setAddress] = useState('');
  const [autocomplete, setAutocomplete] = useState(null);

  // Autocomplete 로드 시 호출
  const handleLoad = (autoC) => {
    setAutocomplete(autoC);
  };

  // Autocomplete 결과가 변경되면, 선택한 주소를 state에 저장
  const handlePlaceChanged = () => {
    if (autocomplete) {
      const place = autocomplete.getPlace();
      if (place.formatted_address) {
        setAddress(place.formatted_address);
      }
    }
  };

  // Search 버튼 클릭 시, 입력한 주소를 onSubmit에 전달 후 모달 닫기
  const handleSearch = () => {
    if (address.trim()) {
      onSubmit({ address });
    }
    onClose();
  };

  // "Use My Current Location" 버튼 클릭 시, 현재 위치 정보를 onSubmit에 전달
  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        onSubmit({ lat: latitude, lng: longitude });
        onClose();
      },
      (error) => {
        alert("Unable to retrieve your location.");
        console.error(error);
      }
    );
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <Box sx={{ textAlign: 'center', p: 2 }}>
        {/* 다이얼로그 제목 영역 */}
        <DialogTitle sx={{ textAlign: 'center', mb: 1 }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center' }}>
            <RestaurantIcon fontSize="large" sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h5" component="span">
              Find a Restaurant
            </Typography>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ minWidth: 300 }}>
          {typeof window !== 'undefined' && window.google ? (
            <Autocomplete onLoad={handleLoad} onPlaceChanged={handlePlaceChanged}>
              <TextField
                fullWidth
                label="Enter address, city, or zip code"
                variant="outlined"
                margin="normal"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </Autocomplete>
          ) : (
            <TextField
              fullWidth
              label="Enter address, city, or zip code"
              variant="outlined"
              margin="normal"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          )}
          <Button
            variant="text"
            onClick={handleUseCurrentLocation}
            sx={{ mt: 2, textTransform: 'none' }}
            startIcon={<RestaurantIcon />}
          >
            Use My Current Location
          </Button>
        </DialogContent>

        <DialogActions sx={{ justifyContent: 'center' }}>
          <Button onClick={onClose} color="inherit">
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSearch}>
            Search
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

export default LocationModal;
