// src/components/MyGoogleMap.jsx
import React from 'react';
import { GoogleMap, Marker } from '@react-google-maps/api';

/**
 * MyGoogleMap 컴포넌트
 * @param {object} center - 지도 중심 좌표 ({ lat, lng })
 * @param {number} zoom - 지도 줌 레벨
 * @param {array} stores - 매장 배열, 각 매장은 { id, lat, lng, name, ... } 형태
 */
function MyGoogleMap({ center, zoom, stores }) {
  const mapContainerStyle = {
    width: '100%',
    height: '100%',
  };

  return (
    <GoogleMap
      mapContainerStyle={mapContainerStyle}
      center={center}
      zoom={zoom}
    >
      {stores.map((store) => (
        <Marker
          key={store.id}
          position={{ lat: store.lat, lng: store.lng }}
        />
      ))}
    </GoogleMap>
  );
}

export default MyGoogleMap;
