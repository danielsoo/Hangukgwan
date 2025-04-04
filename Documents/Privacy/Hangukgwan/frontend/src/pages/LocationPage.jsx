// src/pages/LocationPage.jsx
import React from 'react';
import { Box, Paper, Typography, List, ListItem, ListItemText, Divider } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import MyGoogleMap from '../components/MyGoogleMap';

function LocationPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // 예시 매장 데이터에 위도와 경도 추가 (좌표는 예시입니다)
  const storeList = [
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
    // 추가 데이터 필요시 여기에 추가
  ];

  // 매장 항목 클릭 시 상세 페이지로 이동하는 함수
  const handleStoreClick = (id) => {
    navigate(`/stores/${id}`);
  };

  // 지도 중심 좌표와 줌 레벨 (필요에 따라 조정)
  const mapCenter = { lat: 24.83, lng: 121.005 };
  const mapZoom = 13;

  return (
    <Box
      sx={{
        width: '100vw',
        minHeight: '100vh',
        backgroundImage: 'url("/path/to/your/background.jpg")', // 배경 이미지 경로 수정
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Paper
        sx={{
          width: '80%',
          maxWidth: 1200,
          p: 3,
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
        }}
      >
        {/* 왼쪽 영역: 가게 리스트 */}
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
            {storeList.map((store) => (
              <Box key={store.id}>
                <ListItem button onClick={() => handleStoreClick(store.id)}>
                  <ListItemText
                    primary={store.name}
                    secondary={store.address}
                    primaryTypographyProps={{
                      color: 'error.main',
                      fontWeight: 'bold',
                    }}
                    secondaryTypographyProps={{
                      color: 'warning.main',
                    }}
                  />
                </ListItem>
                <Divider />
              </Box>
            ))}
          </List>
        </Box>

        {/* 오른쪽 영역: Google Maps */}
        <Box
          sx={{
            flex: 1,
            pl: { md: 2 },
            mt: { xs: 2, md: 0 },
            height: { xs: '300px', md: '400px' },
          }}
        >
          <MyGoogleMap center={mapCenter} zoom={mapZoom} stores={storeList} />
        </Box>
      </Paper>
    </Box>
  );
}

export default LocationPage;
