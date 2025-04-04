// src/utils/geocode.js
/**
 * geocodeAddress 함수
 * 주소를 입력받아 Google Geocoding API를 통해 위도(lat)와 경도(lng)를 반환합니다.
 *
 * @param {string} address - 사용자 입력 주소
 * @param {string} apiKey - Google Maps API 키
 * @returns {Promise<{lat: number, lng: number}>} 위도와 경도 객체
 * @throws {Error} Geocoding이 실패하거나 결과가 없을 경우 에러 발생
 */
export async function geocodeAddress(address, apiKey) {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status === 'OK' && data.results.length > 0) {
      const { lat, lng } = data.results[0].geometry.location;
      return { lat, lng };
    } else {
      throw new Error('Geocoding failed or no results found.');
    }
  }
  