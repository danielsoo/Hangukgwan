// src/App.js
import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { LoadScript } from '@react-google-maps/api';

import ParallaxSection from './components/ParallaxSection';
import Layout from './Layout';  // 공통 Layout 컴포넌트
import Home from './components/Home';
import Login from './components/Login';
import Signup from './components/Signup';
import ForgotPassword from './components/ForgotPassword';
import LocationPage from './pages/LocationPage';
import StoreDetailPage from './pages/StoreDetailPage';
import './index.css';

const GOOGLE_MAPS_API_KEY = 'AIzaSyAIt-n4dV362YKAlBHAaVTnbWdUNOwN9L0';

function App() {
  return (
    <LoadScript googleMapsApiKey={GOOGLE_MAPS_API_KEY} libraries={['places']}>
      <Router>
        <ParallaxSection />
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/location" element={<LocationPage />} />
            <Route path="/stores/:storeId" element={<StoreDetailPage />} />
          </Route>
        </Routes>
      </Router>
    </LoadScript>
  );
}

export default App;
