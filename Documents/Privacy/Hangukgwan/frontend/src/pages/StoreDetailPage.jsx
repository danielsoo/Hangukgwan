// src/pages/StoreDetailPage.jsx
import React, { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  Link,
  Divider,
  Tabs,
  Tab
} from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import PhoneIcon from '@mui/icons-material/PhoneInTalk';

function StoreDetailPage() {
  const { storeId } = useParams();
  const navigate = useNavigate();
  // 탭 선택 상태 관리
  const [tabValue, setTabValue] = useState(0);

  // 탭 변경 핸들러
  const handleChangeTab = (event, newValue) => {
    setTabValue(newValue);
  };

  // 예시 매장 데이터
  const storeData = {
    1: {
      name: "Happy Valley",
      address: "1938 N Atherton St, State College, PA 16803",
      status: "Closed – Opens today at 6:30am EDT",
      phone: "(814) 231-0900",
      imageUrl: "https://via.placeholder.com/600x400?text=Store+Image",
      mapUrl: "https://www.google.com/maps/place/Your+Store+Address",
      hours: [
        { day: "Monday - Thursday", time: "6:30 AM - 10:00 PM EDT" },
        { day: "Friday - Saturday", time: "6:30 AM - 10:00 PM EDT" },
        { day: "Sunday", time: "Closed" }
      ],
      description: "An original then, an original now. This store offers delicious menus.",
    },
    2: {
      name: "Zhubei Store 2",
      address: "No. 7, Taiyuan 1st St., Zhubei City, Hsinchu County, Taiwan",
      status: "Closed – Opens today at 9:00am",
      phone: "010-9876-5432",
      imageUrl: "https://via.placeholder.com/600x400?text=Store+Image+2",
      mapUrl: "https://www.google.com/maps/place/Your+Store+Address",
      hours: [
        { day: "Tuesday - Sunday", time: "11AM–2PM, 5PM–9PM" },
        { day: "Monday", time: "Closed" }
      ],
      description: "This store specializes in quick service for office workers.",
    }
  };

  // 해당 매장 데이터
  const store = storeData[storeId] || storeData[1];

  return (
    <Box
      sx={{
        width: '100vw',
        minHeight: '100vh',
        backgroundImage: 'url("/path/to/your/background.jpg")', // 실제 배경 이미지
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        overflowX: 'hidden',
        overflowY: 'auto', // 세로 스크롤 가능
      }}
    >
      {/* 상단 메인 정보 영역 */}
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* 상단 컨테이너: 좌측 정보 + 우측 이미지 */}
        <Paper
          sx={{
            width: '100%',
            maxWidth: 1200,
            p: 3,
            mb: 2,
            backgroundColor: 'rgba(255,255,255,0.9)',
            display: 'flex',
            flexDirection: { xs: 'column', md: 'row' },
            gap: 2,
          }}
        >
          {/* 좌측 정보 */}
          <Box sx={{ flex: 1 }}>
            {/* 즐겨찾기/상태 표시 (원하면 추가) */}
            <Typography variant="body2" sx={{ color: 'error.main' }}>
              {/* 예: ♥ Favorite this location */}
            </Typography>
            <Typography variant="h3" sx={{ fontWeight: 'bold', mb: 1 }}>
              {store.name}
            </Typography>
            {/* 주소 + 아이콘 */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <LocationOnIcon sx={{ color: 'primary.main' }} />
              <Typography variant="body1">{store.address}</Typography>
            </Box>
            {/* 상태(예: Closed - Opens today...) + 아이콘 */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <AccessTimeIcon sx={{ color: 'primary.main' }} />
              <Typography variant="body1">{store.status}</Typography>
            </Box>
            {/* 전화번호 + 아이콘 */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <PhoneIcon sx={{ color: 'primary.main' }} />
              <Typography variant="body1">{store.phone}</Typography>
            </Box>
            {/* 주문/버튼들 */}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 1 }}>
              <Button variant="contained" color="error">
                Order Pickup
              </Button>
              <Button variant="contained" color="error">
                Order Delivery
              </Button>
              <Button variant="contained" color="error">
                Order Catering
              </Button>
            </Box>
            {/* 지도 링크 */}
            <Box sx={{ mt: 2 }}>
              <Link href={store.mapUrl} target="_blank" underline="none" color="primary">
                Map & Directions
              </Link>
            </Box>
          </Box>

          {/* 우측 이미지 */}
          <Box sx={{ flex: 1, textAlign: 'center' }}>
            <Box
              component="img"
              src={store.imageUrl}
              alt={store.name}
              sx={{
                width: '100%',
                height: 'auto',
                maxHeight: 300,
                objectFit: 'cover',
                borderRadius: 2,
              }}
            />
            <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic' }}>
              {/* 예: "Restaurant Operator is responsible for content on this page..." */}
              {store.description}
            </Typography>
          </Box>
        </Paper>

        {/* 탭 메뉴 */}
        <Paper
          sx={{
            width: '100%',
            maxWidth: 1200,
            backgroundColor: 'rgba(255,255,255,0.9)',
          }}
        >
          <Tabs value={tabValue} onChange={handleChangeTab} indicatorColor="primary" textColor="primary">
            <Tab label="Restaurant Details" />
            <Tab label="About Us" />
            <Tab label="Community" />
            <Tab label="Careers" />
          </Tabs>

          <Divider />

          {/* 탭 내용 */}
          <Box sx={{ p: 3 }}>
            {tabValue === 0 && (
              <Box>
                <Typography variant="h5" sx={{ mb: 2 }}>
                  Hours
                </Typography>
                {store.hours.map((h, idx) => (
                  <Typography key={idx} variant="body1" sx={{ mb: 0.5 }}>
                    {h.day}: {h.time}
                  </Typography>
                ))}

                <Typography variant="h5" sx={{ mt: 3, mb: 2 }}>
                  Service Options and Hours
                </Typography>
                <Typography variant="body1">Phone: {store.phone}</Typography>
                {/* 필요에 따라 드라이브 스루, 배달, 테이크아웃 등의 옵션 표시 */}
              </Box>
            )}
            {tabValue === 1 && (
              <Box>
                <Typography variant="h5" sx={{ mb: 2 }}>
                  About Us
                </Typography>
                <Typography variant="body1">
                  {/* 회사/브랜드 소개 등 */}
                  We have been serving customers since ...
                </Typography>
              </Box>
            )}
            {tabValue === 2 && (
              <Box>
                <Typography variant="h5" sx={{ mb: 2 }}>
                  Community
                </Typography>
                <Typography variant="body1">
                  {/* 지역사회 활동, 기부, 행사 등 */}
                  Our store participates in local events ...
                </Typography>
              </Box>
            )}
            {tabValue === 3 && (
              <Box>
                <Typography variant="h5" sx={{ mb: 2 }}>
                  Careers
                </Typography>
                <Typography variant="body1">
                  {/* 채용 정보, 지원 방법 */}
                  Join our team! We are hiring ...
                </Typography>
              </Box>
            )}
          </Box>
        </Paper>
      </Box>
    </Box>
  );
}

export default StoreDetailPage;
