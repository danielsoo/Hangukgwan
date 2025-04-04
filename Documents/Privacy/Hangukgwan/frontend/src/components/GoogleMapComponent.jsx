// src/components/GoogleMapComponent.jsx
import React from 'react';
import GoogleMapReact from 'google-map-react';
import { Box } from '@mui/material';

// 간단한 마커 컴포넌트 (원하는 스타일로 수정 가능)
const Marker = ({ text }) => (
  <Box sx={{ color: 'red', fontWeight: 'bold', transform: 'translate(-50%, -50%)' }}>
    {text}
  </Box>
);

function GoogleMapComponent({ center, zoom, stores }) {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <GoogleMapReact
        // 제공해주신 API 키 적용
        bootstrapURLKeys={{ key: 'AIzaSyAIt-n4dV362YKAlBHAaVTnbWdUNOwN9L0' }}
        defaultCenter={center}
        defaultZoom={zoom}
      >
        {/* 각 매장에 대해 마커 표시 */}
        {stores.map((store) => (
          <Marker
            key={store.id}
            lat={store.lat} // 매장 데이터에 위도 추가 필요
            lng={store.lng} // 매장 데이터에 경도 추가 필요
            text={store.name}
          />
        ))}
      </GoogleMapReact>
    </div>
  );
}

export default GoogleMapComponent;
