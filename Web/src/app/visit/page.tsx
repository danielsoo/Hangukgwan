'use client'

import { useLanguage } from '@/context/LanguageContext'
import { useTranslatedInfo } from '@/lib/useTranslatedInfo'
import { LOCATION_PHOTOS } from '@/lib/locationPhotos'
import ImagePlaceholder from '@/components/ImagePlaceholder'

export default function VisitPage() {
  const { tr } = useLanguage()
  const { mainMapUrl, branchMapUrl } = useTranslatedInfo()

  return (
    <main className="hg-visit-page">
      <section className="hg-visit-intro">
        <div>
          <p className="hg-visit-label">{tr.loc.label}</p>
          <h1>{tr.loc.title}</h1>
          <p className="hg-visit-lead">{tr.loc.intro}</p>
        </div>

        <nav className="hg-visit-directory" aria-label={tr.loc.title}>
          <a href="#main-store" className="hg-visit-directory-item">
            <span className="hg-visit-directory-number">01</span>
            <span>
              <strong>{tr.loc.mainLabel}</strong>
              <small>{tr.info.bookingVal}</small>
            </span>
            <span className="hg-visit-directory-arrow" aria-hidden="true">↓</span>
          </a>
          <a href="#branch-store" className="hg-visit-directory-item">
            <span className="hg-visit-directory-number">02</span>
            <span>
              <strong>{tr.loc.branchLabel}</strong>
              <small>{tr.loc.branchAccess}</small>
            </span>
            <span className="hg-visit-directory-arrow" aria-hidden="true">↓</span>
          </a>
        </nav>
      </section>

      <div className="hg-visit-list">
        <article id="main-store" className="hg-visit-card">
          <div className="hg-visit-photo">
            <ImagePlaceholder
              label="本店 · Main restaurant"
              src={LOCATION_PHOTOS.main.detail}
              alt="韓國館 縣政九路本店 외관"
            />
            <span className="hg-visit-photo-number" aria-hidden="true">01</span>
          </div>

          <div className="hg-visit-copy">
            <p className="hg-visit-eyebrow">Nº 01 · {tr.loc.mainLabel}</p>
            <h2>縣政九路本店</h2>
            <p className="hg-visit-address">新竹縣竹北市縣政九路135巷32號</p>
            <p className="hg-visit-address-en">No. 32, Ln. 135, Xianzhengjiu Rd., Zhubei City, Hsinchu County</p>

            <dl className="hg-visit-facts">
              <div className="hg-visit-fact">
                <dt>{tr.info.hours}</dt>
                <dd>11.00–14.00 · 17.00–21.00</dd>
              </div>
              <div className="hg-visit-fact">
                <dt>{tr.info.closed}</dt>
                <dd>{tr.info.closedVal}</dd>
              </div>
              <div className="hg-visit-fact">
                <dt>{tr.info.phoneLabel}</dt>
                <dd><a href="tel:0366567994">03-656-7994</a></dd>
              </div>
              <div className="hg-visit-fact">
                <dt>{tr.info.min}</dt>
                <dd>NT$200 / {tr.info.perPerson}</dd>
              </div>
              <div className="hg-visit-fact">
                <dt>{tr.info.booking}</dt>
                <dd>{tr.info.bookingVal}</dd>
              </div>
            </dl>

            <a href={mainMapUrl} target="_blank" rel="noopener noreferrer" className="hg-cta-outline-gold hg-visit-map-link">
              {tr.loc.mapCta} <span aria-hidden="true">↗</span>
            </a>
          </div>
        </article>

        <article id="branch-store" className="hg-visit-card hg-visit-card-reverse">
          <div className="hg-visit-photo">
            <ImagePlaceholder
              label="直營店 · Corporate branch"
              src={LOCATION_PHOTOS.branch.detail}
              alt="韓國館 太元一街直營店 매장 전경"
            />
            <span className="hg-visit-photo-number" aria-hidden="true">02</span>
          </div>

          <div className="hg-visit-copy">
            <p className="hg-visit-eyebrow">Nº 02 · {tr.loc.branchLabel}</p>
            <h2>太元一街直營店</h2>
            <p className="hg-visit-address">新竹縣竹北市太元一街7號</p>
            <p className="hg-visit-address-en">No. 7, Taiyuan 1st St., Zhubei City, Hsinchu County</p>

            <dl className="hg-visit-facts">
              <div className="hg-visit-fact">
                <dt>{tr.loc.accessLabel}</dt>
                <dd>{tr.loc.branchAccess}</dd>
              </div>
              <div className="hg-visit-fact">
                <dt>{tr.loc.nearby}</dt>
                <dd>Samsung · TSMC · 新竹科學園區</dd>
              </div>
            </dl>

            <p className="hg-visit-note">{tr.loc.branchNote}</p>
            <a href={branchMapUrl} target="_blank" rel="noopener noreferrer" className="hg-cta-outline-gold hg-visit-map-link">
              {tr.loc.mapCta} <span aria-hidden="true">↗</span>
            </a>
          </div>
        </article>
      </div>
    </main>
  )
}
