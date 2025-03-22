// src/components/LanguageSwitcher.js
import React, { useState } from 'react';
import { Button, Menu, MenuItem } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { languages } from './languageData';

function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const [anchorEl, setAnchorEl] = useState(null);

  const currentLang = languages.find(lang => lang.code === i18n.language) || languages[0];

  const handleOpenMenu = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleCloseMenu = () => {
    setAnchorEl(null);
  };

  const handleChangeLanguage = (lng) => {
    i18n.changeLanguage(lng);
    handleCloseMenu();
  };

  return (
    <>
      <Button onClick={handleOpenMenu} sx={{ color: '#fff', textTransform: 'none' }}>
        <span style={{ marginRight: 8 }}>{currentLang.flag}</span>
        {currentLang.short}
      </Button>
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
