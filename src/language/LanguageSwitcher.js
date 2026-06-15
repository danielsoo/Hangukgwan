//src/language/LanguageSwitcher.js
// 이 컴포넌트는 사용자가 사이트의 언어를 선택할 수 있도록 버튼과 드롭다운 메뉴를 제공합니다.

import React, { useState } from 'react';
import { Button, Menu, MenuItem } from '@mui/material';
// languageData 파일이 같은 폴더 내에 있으므로 './languageData' 경로로 임포트합니다.
import { languages } from './languageData';
import { useTranslation } from 'react-i18next';

function LanguageSwitcher() {
  const { i18n } = useTranslation();
  // 드롭다운 메뉴의 기준 엘리먼트를 관리하는 상태
  const [anchorEl, setAnchorEl] = useState(null);

  // 현재 i18n의 언어 코드에 해당하는 언어 정보를 찾습니다.
  const currentLang = languages.find(lang => lang.code === i18n.language) || languages[0];

  // 언어 선택 메뉴를 열 때 호출되는 핸들러
  const handleOpenMenu = (event) => {
    setAnchorEl(event.currentTarget);
  };

  // 언어 선택 메뉴를 닫을 때 호출되는 핸들러
  const handleCloseMenu = () => {
    setAnchorEl(null);
  };

  // 선택한 언어로 변경하고 메뉴를 닫습니다.
  const handleChangeLanguage = (lng) => {
    i18n.changeLanguage(lng);
    handleCloseMenu();
  };

  return (
    <>
      {/* 현재 선택된 언어의 플래그와 짧은 표기를 표시하는 버튼 */}
      <Button onClick={handleOpenMenu} sx={{ color: '#fff', textTransform: 'none' }}>
        <span style={{ marginRight: 8 }}>{currentLang.flag}</span>
        {currentLang.short}
      </Button>
      {/* 드롭다운 메뉴 */}
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleCloseMenu}>
        {languages.map((lang) => (
          <MenuItem key={lang.code} onClick={() => handleChangeLanguage(lang.code)}>
            <span style={{ marginRight: 8 }}>{lang.flag}</span>
            {lang.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export default LanguageSwitcher;
