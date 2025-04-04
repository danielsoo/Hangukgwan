// src/pages/StoreDetailPage.jsx
import React from 'react';
import { useParams } from 'react-router-dom';
import '../custom.css'; // custom CSS import

const storeData = {
  1: {
    name: "Zhubei Store 1",
    address: "No. 32, Lane 135, Xianzhengjiu Rd, Zhubei City, Hsinchu County, Taiwan 302",
    hours: [
      { day: "Tuesday – Sunday", time: "11AM–2PM, 5PM–9PM" },
      { day: "Monday", time: "Closed" },
    ],
    phone: "010-1234-5678",
    imageUrl: "https://via.placeholder.com/600x400?text=Store+Image",
  },
  2: {
    name: "Zhubei Store 2",
    address: "No. 7, Taiyuan 1st St., Zhubei City, Hsinchu County, Taiwan",
    hours: [
      { day: "Tuesday – Sunday", time: "11AM–2PM, 5PM–9PM" },
      { day: "Monday", time: "Closed" },
    ],
    phone: "010-9876-5432",
    imageUrl: "https://via.placeholder.com/600x400?text=Store+Image+2",
  },
};

function StoreDetailPage() {
  const { storeId } = useParams();
  const store = storeData[storeId];

  if (!store) {
    return (
      <div className="max-w-4xl mx-auto p-4 bg-gray-900 text-primary">
        <h2>Store information not found.</h2>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-8 bg-gray-900 text-primary">
      {/* 매장 헤더 영역 */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
        <div>
          {/* 매장 이름: custom 클래스 text-accent 사용 */}
          <h1 className="text-3xl font-bold text-accent">{store.name}</h1>
          {/* 매장 주소: custom 클래스 text-secondary 사용 */}
          <p className="text-secondary">{store.address}</p>
          <button className="mt-2 px-3 py-1 border border-primary rounded text-sm hover:bg-gray-800">
            Favorite this location
          </button>
        </div>
        <div className="space-x-2">
          <button className="bg-red-500 text-primary px-4 py-2 rounded">
            Order Pickup
          </button>
          <button className="bg-red-500 text-primary px-4 py-2 rounded">
            Order Delivery
          </button>
          <button className="bg-red-500 text-primary px-4 py-2 rounded">
            Order Catering
          </button>
        </div>
      </div>

      {/* 매장 대표 이미지 영역 */}
      <div className="w-full h-64 md:h-80 bg-gray-700 rounded overflow-hidden">
        <img
          src={store.imageUrl}
          alt={store.name}
          className="w-full h-full object-cover"
        />
      </div>

      {/* 탭 메뉴 */}
      <div className="border-b border-gray-700">
        <nav className="flex space-x-6">
          <button className="py-2 px-4 border-b-2 border-red-500 font-semibold">
            Restaurant Details
          </button>
          <button className="py-2 px-4 text-gray-300 hover:text-primary">
            About Us
          </button>
          <button className="py-2 px-4 text-gray-300 hover:text-primary">
            Community
          </button>
          <button className="py-2 px-4 text-gray-300 hover:text-primary">
            Careers
          </button>
        </nav>
      </div>

      {/* 상세 정보 영역 */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Hours</h2>
        <ul>
          {store.hours.map((h, idx) => (
            <li key={idx} className="flex justify-between">
              <span>{h.day}</span>
              <span>{h.time}</span>
            </li>
          ))}
        </ul>

        <h2 className="text-xl font-semibold">Service Options and Hours</h2>
        <p>Phone: {store.phone}</p>
      </div>
    </div>
  );
}

export default StoreDetailPage;
