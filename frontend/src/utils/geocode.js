// src/utils/geocode.js (수정)
export async function geocodeAddress(address) {
  // CRA에서 proxy가 package.json에 "proxy": "http://localhost:4000" 로 되어 있다면
  const url = `/api/geocode?address=${encodeURIComponent(address)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Geocode request failed');
  }

  const data = await res.json();
  // { lat, lng, raw }
  return { lat: data.lat, lng: data.lng };
}
