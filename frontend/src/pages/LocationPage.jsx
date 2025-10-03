import React, { useState, useEffect } from 'react';
import { Box, Paper, Typography, List, ListItem, ListItemText, Divider } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import MyGoogleMap from '../components/MyGoogleMap';

function getDistanceInKm(lat1, lon1, lat2, lon2) {
  const R = 6371;  // 지구 반지름 (km)
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

function LocationPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const locationState = useLocation().state;  // { lat, lng } 또는 { address }
  const [userLocation, setUserLocation] = useState(locationState);

  // i18n 리소스에 정의된 실제 매장 정보를 참조하기 위해 키를 full path로 지정
  const initialStores = [
    {
      id: 1,
      nameKey: 'stores.store1.name',
      addressKey: 'stores.store1.address',
      lat: 24.837717,
      lng: 121.011698,
    },
    {
      id: 2,
      nameKey: 'stores.store2.name',
      addressKey: 'stores.store2.address',
      lat: 24.827772,
      lng: 121.002744,
    },
  ];

  const [stores, setStores] = useState(initialStores);

  useEffect(() => {
    if (userLocation?.lat && userLocation?.lng) return;
    if (!userLocation?.address) return;
    if (!window.google) return;

    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ address: userLocation.address }, (results, status) => {
      if (status === 'OK' && results[0]) {
        const { lat, lng } = results[0].geometry.location;
        setUserLocation({ lat: lat(), lng: lng() });
      } else {
        console.error('Geocoding failed:', status);
      }
    });
  }, [userLocation]);

  useEffect(() => {
    if (userLocation?.lat && userLocation?.lng) {
      setStores((prev) =>
        prev
          .map((s) => ({
            ...s,
            distance: getDistanceInKm(userLocation.lat, userLocation.lng, s.lat, s.lng),
          }))
          .sort((a, b) => a.distance - b.distance),
      );
    }
  }, [userLocation]);

  const handleStoreClick = (id) => navigate(`/stores/${id}`);

  const mapCenter = userLocation?.lat
    ? { lat: userLocation.lat, lng: userLocation.lng }
    : { lat: 24.83, lng: 121.005 };
  const mapZoom = 13;

  return (
    <Box
      sx={{
        width: '100%',
        height: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        overflowY: 'auto',
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      }}
    >
      <Paper sx={{ p: 3, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, width: '100%', maxWidth: 1200 }}>
        {/* 매장 리스트 */}
        <Box
          sx={{
            width: { xs: '100%', md: '35%' },
            pr: { md: 2 },
            borderRight: { md: '1px solid #ccc' },
            mb: { xs: 2, md: 0 },
          }}
        >
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
            {t('ourLocations')}
          </Typography>
          <List>
            {stores.map((s) => (
              <Box key={s.id}>
                <ListItem button onClick={() => handleStoreClick(s.id)}>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 'bold', color: 'error.main' }}>
                          {t(s.nameKey)}
                        </Typography>
                        {s.distance != null && (
                          <Typography variant="caption" sx={{ color: 'warning.light' }}>
                            {s.distance.toFixed(2)} {t('distanceUnit')}
                          </Typography>
                        )}
                      </Box>
                    }
                    secondary={
                      <Typography
                        variant="body2"
                        sx={{
                          color: 'warning.main',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {t(s.addressKey)}
                      </Typography>
                    }
                  />
                </ListItem>
                <Divider />
              </Box>
            ))}
          </List>
        </Box>

        {/* 지도 */}
        <Box
          sx={{
            height: { xs: '300px', md: '400px' },
            width: '100%',
            transition: 'height 0.3s ease-in-out',
            overflow: 'hidden',
          }}
        >
          <MyGoogleMap center={mapCenter} zoom={mapZoom} stores={stores} />
        </Box>
      </Paper>
    </Box>
  );
}

export default LocationPage;
