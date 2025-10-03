// components/ValuesSection.jsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import koreanFlavorsIcon from '../assets/images/korean_flavors.png';
import familyServiceIcon from '../assets/images/korean_flavors.png';
import warmWelcomeIcon from '../assets/images/korean_flavors.png';
import '../styles/ValuesSection.css';

const values = [
  {
    key: 'title1',
    image: koreanFlavorsIcon,
  },
  {
    key: 'title2',
    image: familyServiceIcon,
  },
  {
    key: 'title3',
    image: warmWelcomeIcon,
  },
];

function ValuesSection() {
  const { t } = useTranslation();

  return (
    <section className="values-section">
      <div className="section-inner">
        <div className="values-container expanded">
          {values.map((val, idx) => (
            <div className="value-box large" key={idx}>
              <img src={val.image} alt={t(`valuesSection.${val.key}`)} className="value-icon" />
              <h3>{t(`valuesSection.${val.key}`)}</h3>
              <p>{t(`valuesSection.desc${idx + 1}`)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default ValuesSection;
