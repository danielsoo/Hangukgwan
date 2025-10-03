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
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper as MuiPaper
} from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import PhoneIcon from '@mui/icons-material/PhoneInTalk';
import hangukgwanImg from '../assets/images/hangukgwan_front.png';

function StoreDetailPage() {
  const { t } = useTranslation();
  const { storeId } = useParams();
  const navigate = useNavigate();
  const [tabValue, setTabValue] = useState(0);

  // URL 파라미터가 1 또는 2라고 가정하고, i18n 리소스의 stores.store1 / stores.store2 에서 정보를 가져옵니다.
  const store = t(`stores.store${storeId}`, { returnObjects: true }) || t('stores.store1', { returnObjects: true });

  const handleTabChange = (event, newValue) => {
    setTabValue(newValue);
  };

  return (
    <Box
      sx={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: { xs: '90%', md: '80%' },
        maxWidth: 1000,
        maxHeight: '90vh',
        overflowY: 'auto',
        p: 3,
      }}
    >
      <Paper sx={{ p: 3, backgroundColor: 'rgba(255,255,255,0.9)' }}>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2 }}>
          {/* 왼쪽: 매장 정보 */}
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
            }}
          >
            <Typography variant="h3" sx={{ fontWeight: 'bold', mb: 1 }}>
              {store.name}
            </Typography>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <LocationOnIcon sx={{ color: 'primary.main' }} />
              <Typography
                variant="body1"
                sx={{
                  whiteSpace: 'normal',
                  textAlign: 'left'
                }}
              >
                {t('addressLabel')}: {store.address}
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <AccessTimeIcon sx={{ color: 'primary.main' }} />
              <Typography variant="body1">{store.status}</Typography>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <PhoneIcon sx={{ color: 'primary.main' }} />
              <Typography variant="body1">
                {t('phoneLabel')}: {store.phone}
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2 }}>
              <Button variant="contained" color="error">{t('orderPickup')}</Button>
              <Button variant="contained" color="error">{t('orderDelivery')}</Button>
              <Button variant="contained" color="error">{t('orderCatering')}</Button>
            </Box>

            <Box sx={{ mt: 1 }}>
              <Link href={store.mapUrl} target="_blank" underline="none" color="primary">
                {t('mapDirections')}
              </Link>
            </Box>

            <Typography variant="body2" sx={{ mt: 1 }}>
              Plus Code: {store.plusCode}
            </Typography>
          </Box>

          {/* 오른쪽: 매장 이미지 */}
          <Box sx={{ flex: 1, textAlign: 'center' }}>
            <Box
              component="img"
              src={hangukgwanImg}
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

        <Divider sx={{ my: 2 }} />

        {/* 탭 메뉴 */}
        <Tabs value={tabValue} onChange={handleTabChange} indicatorColor="primary" textColor="primary">
          <Tab label={t('storeDetailsTab')} />
          <Tab label={t('aboutUsTab')} />
          <Tab label={t('communityTab')} />
          <Tab label={t('careersTab')} />
        </Tabs>

        <Divider />

        {/* 탭 콘텐츠 */}
        <Box sx={{ p: 2 }}>
          {tabValue === 0 && (
            <Box>
              <Typography variant="h5" sx={{ mb: 2 }}>{t('hoursHeading')}</Typography>
              <TableContainer component={MuiPaper} sx={{ mb: 2 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell><strong>{t('hoursHeading')}</strong></TableCell>
                      <TableCell><strong>{t('serviceOptionsHeading')}</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {store.hours.map((h, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{h.day}</TableCell>
                        <TableCell>{h.time}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}
          {tabValue === 1 && (
            <Box>
              <Typography variant="h5" sx={{ mb: 2 }}>{t('aboutUsTab')}</Typography>
              <Typography variant="body1">{t('aboutUsContent')}</Typography>
            </Box>
          )}
          {tabValue === 2 && (
            <Box>
              <Typography variant="h5" sx={{ mb: 2 }}>{t('communityTab')}</Typography>
              <Typography variant="body1">{t('communityContent')}</Typography>
            </Box>
          )}
          {tabValue === 3 && (
            <Box>
              <Typography variant="h5" sx={{ mb: 2 }}>{t('careersTab')}</Typography>
              <Typography variant="body1">{t('careersContent')}</Typography>
            </Box>
          )}
        </Box>

        <Box sx={{ textAlign: 'center', mt: 3 }}>
          <Button variant="contained" color="error" onClick={() => navigate(-1)}>
            {t('goBack')}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}

export default StoreDetailPage;
