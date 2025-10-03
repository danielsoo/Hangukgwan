// components/ContactCTASection.jsx
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import '../styles/ContactCTASection.css';

function ContactCTASection() {
  const { t } = useTranslation();
  const [form, setForm] = useState({ name: '', phone: '', message: '' });
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post('/api/contact', form);
      setSubmitted(true);
    } catch (error) {
      console.error('Contact form error:', error);
    }
  };

  return (
    <section className="contact-section">
      <div className="section-inner">
        <div className="contact-content">
          <h2>{t('contactSection.heading')}</h2>
          <p>{t('contactSection.description')}</p>
          {submitted ? (
            <p>✅ Thank you! We’ll be in touch soon.</p>
          ) : (
            <form onSubmit={handleSubmit} className="contact-form-grid">
              <div className="form-row">
                <input
                  type="text"
                  name="name"
                  placeholder={t('contactSection.namePlaceholder')}
                  value={form.name}
                  onChange={handleChange}
                  required
                />
                <input
                  type="tel"
                  name="phone"
                  placeholder={t('contactSection.phonePlaceholder')}
                  value={form.phone}
                  onChange={handleChange}
                  required
                />
              </div>
              <textarea
                name="message"
                placeholder={t('contactSection.messagePlaceholder')}
                value={form.message}
                onChange={handleChange}
                required
              />
              <button type="submit">{t('contactSection.submitButton')}</button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

export default ContactCTASection;
