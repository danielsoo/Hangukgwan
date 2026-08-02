// src/components/account/ProfileMenu.js
// 사용자가 로그인한 후 헤더 오른쪽에 표시될 프로필 메뉴 컴포넌트입니다.
// 버튼을 클릭하면 드롭다운 메뉴가 열리며, 주문 내역, 즐겨찾기, 설정, 로그아웃 옵션을 제공합니다.

import React from 'react';
// Material-UI 컴포넌트: Button, Menu, MenuItem를 임포트합니다.
import { Button, Menu, MenuItem } from '@mui/material';
// i18n 번역을 위해 useTranslation 훅을 임포트합니다.
import { useTranslation } from 'react-i18next';

function ProfileMenu({ userName, onLogout }) {
  // t 함수로 다국어 번역을 사용할 수 있도록 설정합니다.
  const { t } = useTranslation();
  // 드롭다운 메뉴가 열릴 기준이 되는 앵커 엘리먼트를 상태로 관리합니다.
  const [anchorEl, setAnchorEl] = React.useState(null);

  // 사용자 이름 버튼 클릭 시 호출되는 이벤트 핸들러입니다.
  // 클릭한 버튼을 기준으로 드롭다운 메뉴의 위치를 지정하기 위해 anchorEl 상태에 저장합니다.
  const handleClick = (event) => {
    setAnchorEl(event.currentTarget);
  };

  // 드롭다운 메뉴를 닫을 때 호출되는 이벤트 핸들러입니다.
  // anchorEl 상태를 null로 설정하여 메뉴를 닫습니다.
  const handleClose = () => {
    setAnchorEl(null);
  };

  return (
    <div>
      {/* 사용자 이름을 보여주는 버튼입니다.
          버튼 클릭 시 handleClick 함수를 호출하여 드롭다운 메뉴가 열립니다. */}
      <Button onClick={handleClick} color="inherit">
        {userName || t('defaultUser')}
      </Button>

      {/* Material-UI의 Menu 컴포넌트를 사용하여 드롭다운 메뉴를 구현합니다.
          anchorEl이 null이 아니면 메뉴가 열리며, anchorEl에 따라 위치가 결정됩니다. */}
      <Menu
        anchorEl={anchorEl}               // 메뉴의 기준 위치를 제공하는 앵커 엘리먼트
        open={Boolean(anchorEl)}          // anchorEl이 존재하면 메뉴를 열도록 설정
        onClose={handleClose}             // 메뉴를 닫을 때 호출되는 콜백 함수
        keepMounted                      // 메뉴가 닫혔을 때도 DOM에 남겨두어 성능 최적화
      >
        {/* "내 주문 내역" 메뉴 항목 */}
        <MenuItem onClick={handleClose}>
          {t('myOrders')}
        </MenuItem>
        {/* "즐겨찾기" 메뉴 항목 */}
        <MenuItem onClick={handleClose}>
          {t('favorites')}
        </MenuItem>
        {/* "설정" 메뉴 항목 */}
        <MenuItem onClick={handleClose}>
          {t('settings')}
        </MenuItem>
        {/* "로그아웃" 메뉴 항목
            클릭 시 먼저 메뉴를 닫고, 상위 컴포넌트에서 전달받은 onLogout 함수를 호출합니다. */}
        <MenuItem
          onClick={() => {
            handleClose();
            onLogout();
          }}
        >
          {t('logout')}
        </MenuItem>
      </Menu>
    </div>
  );
}

export default ProfileMenu;
