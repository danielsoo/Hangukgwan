// src/pages/LocationPage.jsx
import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  List,
  ListItem,
  ListItemText,
  Divider
} from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import MyGoogleMap from '../components/MyGoogleMap';

function getDistanceInKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(deg2rad(lat1))*Math.cos(deg2rad(lat2))*Math.sin(dLon/2)**2;
  const c = 2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R*c;
}
function deg2rad(deg) { return deg*(Math.PI/180); }

function LocationPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const locationState = useLocation().state;
  const userLocation = locationState;

  const initialStores = [
    { id:1, name:"Zhubei Store 1", address:"No. 32, Lane 135, Xianzhengjiu Rd", lat:24.837717, lng:121.011698 },
    { id:2, name:"Zhubei Store 2", address:"No. 7, Taiyuan 1st St.", lat:24.827772, lng:121.002744 }
  ];
  const [stores, setStores] = useState(initialStores);

  useEffect(() => {
    if(userLocation?.lat && userLocation?.lng){
      setStores(prev => [...prev]
        .map(s=>({ ...s, distance:getDistanceInKm(userLocation.lat, userLocation.lng, s.lat, s.lng)}))
        .sort((a,b)=>a.distance-b.distance)
      );
    }
  }, [userLocation]);

  const handleStoreClick = id => navigate(`/stores/${id}`);
  const mapCenter = userLocation?.lat ? { lat:userLocation.lat, lng:userLocation.lng } : { lat:24.83, lng:121.005 };
  const mapZoom = 13;

  return (
    <Box
      sx={{
        position:'absolute',
        top:'50%',
        left:'50%',
        transform:'translate(-50%,-50%)',
        width:{ xs:'90%', md:'80%' },
        maxWidth:1200,
        maxHeight:'90vh',
        overflowY:'auto',
        p:3,
      }}
    >
      <Paper sx={{ p:3, display:'flex', flexDirection:{ xs:'column', md:'row' } }}>
        <Box sx={{ width:{ xs:'100%', md:'35%' }, pr:{ md:2 }, borderRight:{ md:'1px solid #ccc' } }}>
          <Typography variant="h6" sx={{ mb:2, fontWeight:'bold' }}>
            {t('ourLocations')}
          </Typography>
          <List>
            {stores.map(s=>(
              <Box key={s.id}>
                <ListItem button onClick={()=>handleStoreClick(s.id)}>
                  <ListItemText
                    primary={
                      <Box sx={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <Typography variant="subtitle1" sx={{ fontWeight:'bold', color:'error.main' }}>
                          {s.name}
                        </Typography>
                        {s.distance!=null && (
                          <Typography variant="caption" sx={{ color:'warning.light' }}>
                            {s.distance.toFixed(2)} {t('distanceUnit')}
                          </Typography>
                        )}
                      </Box>
                    }
                    secondary={
                      <Typography variant="body2" sx={{ color:'warning.main' }}>
                        {t('addressLabel')}: {s.address}
                      </Typography>
                    }
                  />
                </ListItem>
                <Divider />
              </Box>
            ))}
          </List>
        </Box>
        <Box sx={{ flex:1, pl:{ md:2 }, mt:{ xs:2, md:0 }, height:{ xs:'300px', md:'400px' } }}>
          <MyGoogleMap center={mapCenter} zoom={mapZoom} stores={stores} />
        </Box>
      </Paper>
    </Box>
  );
}

export default LocationPage;
