// src/pages/StoreDetailPage.jsx
import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
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
  const [tabValue, setTabValue] = useState(0);

  // 탭 전환 핸들러
  const handleTabChange = (event, newValue) => {
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
      description: "An original then, an original now. This store offers delicious menus."
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
      description: "This store specializes in quick service for office workers."
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
        display: 'flex',           // 수직 수평 중앙 정렬
        alignItems: 'center',
        justifyContent: 'center',
        overflowX: 'hidden',
        overflowY: 'auto',        // 세로 스크롤 가능 (콘텐츠 많을 때)
      }}
    >
      {/* 하나의 Paper로 전체를 감싸서 레이어 하나로 합침 */}
      <Paper
        sx={{
          width: '90%',
          maxWidth: 1000,
          p: 3,
          backgroundColor: 'rgba(255,255,255,0.9)', // 밝은 반투명 배경
        }}
      >
        {/* 상단 영역: 매장명, 주소, 상태, 전화번호, 버튼 등 */}
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2 }}>
          {/* 왼쪽: 매장 정보 */}
          <Box sx={{ flex: 1 }}>
            <Typography variant="h3" sx={{ fontWeight: 'bold', mb: 1 }}>
              {store.name}
            </Typography>
            {/* 주소 + 아이콘 */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <LocationOnIcon sx={{ color: 'primary.main' }} />
              <Typography variant="body1">{store.address}</Typography>
            </Box>
            {/* 상태 + 아이콘 */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <AccessTimeIcon sx={{ color: 'primary.main' }} />
              <Typography variant="body1">{store.status}</Typography>
            </Box>
            {/* 전화번호 + 아이콘 */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <PhoneIcon sx={{ color: 'primary.main' }} />
              <Typography variant="body1">{store.phone}</Typography>
            </Box>
            {/* 주문 버튼들 */}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2 }}>
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
            <Box sx={{ mt: 1 }}>
              <Link href={store.mapUrl} target="_blank" underline="none" color="primary">
                Map & Directions
              </Link>
            </Box>
          </Box>

          {/* 오른쪽: 매장 이미지 */}
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
              {store.description}
            </Typography>
          </Box>
        </Box>

        {/* 구분선 */}
        <Divider sx={{ my: 2 }} />

        {/* 탭 메뉴 */}
        <Tabs value={tabValue} onChange={handleTabChange} indicatorColor="primary" textColor="primary">
          <Tab label="Restaurant Details" />
          <Tab label="About Us" />
          <Tab label="Community" />
          <Tab label="Careers" />
        </Tabs>

        <Divider />

        {/* 탭 내용 */}
        <Box sx={{ p: 2 }}>
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
            </Box>
          )}
          {tabValue === 1 && (
            <Box>
              <Typography variant="h5" sx={{ mb: 2 }}>
                About Us
              </Typography>
              <Typography variant="body1">
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
                Join our team! We are hiring ...
              </Typography>
            </Box>
          )}
        </Box>

        {/* 뒤로 가기 버튼 */}
        <Box sx={{ textAlign: 'center', mt: 3 }}>
          <Button variant="contained" color="error" onClick={() => navigate(-1)}>
            Go Back
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}

export default StoreDetailPage;
