// src/pages/LocationPage.jsx
import React, { useState, useEffect } from 'react';
import { Box, Paper, Typography, List, ListItem, ListItemText, Divider } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import MyGoogleMap from '../components/MyGoogleMap';

/**
 * Haversine 공식을 사용하여 두 좌표 사이의 거리를 km 단위로 계산하는 함수
 */
function getDistanceInKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // 지구 반지름 (km)
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
  const locationState = useLocation().state;
  // Header에서 전달한 사용자 위치 정보 (예: { lat, lng })
  const userLocation = locationState;

  // 초기 매장 데이터 (각 매장은 위도와 경도를 포함)
  const initialStores = [
    {
      id: 1,
      name: "Zhubei Store 1",
      address: "No. 32, Lane 135, Xianzhengjiu Rd, Zhubei City, Hsinchu County, Taiwan 302",
      lat: 24.837717,
      lng: 121.011698,
    },
    {
      id: 2,
      name: "Zhubei Store 2",
      address: "No. 7, Taiyuan 1st St., Zhubei City, Hsinchu County, Taiwan",
      lat: 24.827772,
      lng: 121.002744,
    },
    // 추가 매장 데이터를 여기에 넣을 수 있습니다.
  ];

  const [stores, setStores] = useState(initialStores);

  // userLocation이 있으면 각 매장과의 거리를 계산하여 store 데이터에 추가 및 정렬
  useEffect(() => {
    if (userLocation && userLocation.lat && userLocation.lng) {
      setStores(prevStores => {
        const updated = prevStores.map(store => {
          const distance = getDistanceInKm(
            userLocation.lat,
            userLocation.lng,
            store.lat,
            store.lng
          );
          return { ...store, distance };
        });
        // 가까운 순으로 정렬
        updated.sort((a, b) => a.distance - b.distance);
        return updated;
      });
    }
  }, [userLocation]);

  // 매장 클릭 시 해당 상세 페이지로 이동
  const handleStoreClick = (id) => {
    navigate(`/stores/${id}`);
  };

  // 지도 중심 좌표: 사용자 위치가 있으면 해당 위치 사용, 없으면 기본값 사용
  const mapCenter = userLocation && userLocation.lat && userLocation.lng
    ? { lat: userLocation.lat, lng: userLocation.lng }
    : { lat: 24.83, lng: 121.005 };
  const mapZoom = 13;

  return (
    // 전체 배경 Box: 배경 이미지로 채워서 중앙에 콘텐츠 배치
    <Box
      sx={{
        width: '100vw',
        minHeight: '100vh',
        backgroundImage: 'url("/path/to/your/background.jpg")', // 실제 배경 이미지 경로로 수정
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflowX: 'hidden', // 좌우 스크롤 숨김
      }}
    >
      <Paper
        sx={{
          width: '80%',
          maxWidth: 1200,
          p: 3,
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' }, // 반응형: 모바일은 세로, 데스크탑은 좌우 분할
        }}
      >
        {/* 왼쪽 영역: 매장 리스트 */}
        <Box
          sx={{
            width: { xs: '100%', md: '35%' },
            pr: { md: 2 },
            borderRight: { md: '1px solid #ccc' },
          }}
        >
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
            {t('Our Locations')}
          </Typography>
          <List>
            {stores.map((store) => (
              <Box key={store.id}>
                <ListItem button onClick={() => handleStoreClick(store.id)}>
                  <ListItemText
                    primary={
                      // 매장명은 그대로, 거리만 작은 글씨로 오른쪽 끝에 표시
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 'bold', color: 'error.main' }}>
                          {store.name}
                        </Typography>
                        {store.distance && (
                          <Typography variant="caption" sx={{ color: 'warning.light' }}>
                            {store.distance.toFixed(2)} km
                          </Typography>
                        )}
                      </Box>
                    }
                    secondary={
                      <Typography variant="body2" sx={{ color: 'warning.main' }}>
                        {store.address}
                      </Typography>
                    }
                  />
                </ListItem>
                <Divider />
              </Box>
            ))}
          </List>
        </Box>

        {/* 오른쪽 영역: 구글 지도 */}
        <Box
          sx={{
            flex: 1,
            pl: { md: 2 },
            mt: { xs: 2, md: 0 },
            height: { xs: '300px', md: '400px' },
          }}
        >
          <MyGoogleMap center={mapCenter} zoom={mapZoom} stores={stores} />
        </Box>
      </Paper>
    </Box>
  );
}

export default LocationPage;
