// src/components/MyGoogleMap.jsx
import React from 'react';
import { GoogleMap, LoadScript, Marker } from '@react-google-maps/api';

// MyGoogleMap 컴포넌트: 지도 컨테이너 스타일, 중심 좌표, 줌 레벨, 매장 데이터(stores)를 props로 받음
function MyGoogleMap({ center, zoom, stores }) {
  // 지도 컨테이너의 스타일을 지정합니다.
  const mapContainerStyle = {
    width: '100%',
    height: '100%',
  };

  return (
    // LoadScript는 Google Maps API 키를 로드합니다.
    <LoadScript googleMapsApiKey="AIzaSyAIt-n4dV362YKAlBHAaVTnbWdUNOwN9L0">
      {/* GoogleMap 컴포넌트에 지도 스타일, 중심, 줌 레벨을 적용합니다. */}
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={center}
        zoom={zoom}
      >
        {/* 각 매장에 대해 Marker 컴포넌트를 사용하여 마커를 표시합니다. */}
        {stores.map((store) => (
          <Marker
            key={store.id}
            position={{ lat: store.lat, lng: store.lng }}
          />
        ))}
      </GoogleMap>
    </LoadScript>
  );
}

export default MyGoogleMap;
