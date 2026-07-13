// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/cmadzz/cegin
document.addEventListener('DOMContentLoaded', () => {
  if (window.CeginThemes) {
    CeginThemes.initThemeUI();

    const label = document.getElementById('theme-current-label');
    if (label) {
      const updateLabel = () => {
        const prefs = CeginThemes.loadPrefs();
        const palette = CeginThemes.PALETTES[prefs.palette];
        const mode = prefs.mode === 'system' ? 'System' : prefs.mode === 'light' ? 'Light' : 'Dark';
        let name = palette?.name || 'Open Flame';
        if (prefs.palette === 'oled' && CeginThemes.OLED_ACCENTS[prefs.oledAccent]) {
          name += ` · ${CeginThemes.OLED_ACCENTS[prefs.oledAccent].name}`;
        }
        label.textContent = `${name} (${mode})`;
      };
      updateLabel();
      document.addEventListener('click', (e) => {
        if (e.target.closest('[data-palette], [data-mode], [data-oled]')) {
          setTimeout(updateLabel, 0);
        }
      });
    }
  }
  const navToggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.nav-links');

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      navLinks.classList.toggle('open');
    });

    navLinks.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => navLinks.classList.remove('open'));
    });
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    },
    { threshold: 0.12 },
  );

  document.querySelectorAll('.feature-card, .mode-card, .stack-item, .deep-list li, .notif-card, .workflow-step, .screenshot-card, .step-card, .security-card, .changelog-card, .faq-item').forEach((el) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(16px)';
    el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    observer.observe(el);
  });

  const style = document.createElement('style');
  style.textContent = '.visible { opacity: 1 !important; transform: translateY(0) !important; }';
  document.head.appendChild(style);

  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxClose = document.getElementById('lightbox-close');
  const lightboxPrev = document.getElementById('lightbox-prev');
  const lightboxNext = document.getElementById('lightbox-next');

  if (lightbox && lightboxImg) {
    const lightboxButtons = Array.from(document.querySelectorAll('[data-lightbox]'));
    let currentIndex = -1;

    const updateArrows = () => {
      if (lightboxPrev) lightboxPrev.style.display = currentIndex > 0 ? '' : 'none';
      if (lightboxNext) lightboxNext.style.display = currentIndex < lightboxButtons.length - 1 ? '' : 'none';
    };

    const openLightbox = (src, alt, index) => {
      lightboxImg.src = src;
      lightboxImg.alt = alt || 'App screenshot';
      currentIndex = typeof index === 'number' ? index : lightboxButtons.findIndex(b => b.dataset.lightbox === src);
      lightbox.hidden = false;
      lightbox.classList.add('open');
      document.body.classList.add('theme-panel-open');
      updateArrows();
    };

    const closeLightbox = () => {
      lightbox.classList.remove('open');
      lightbox.hidden = true;
      lightboxImg.src = '';
      currentIndex = -1;
      document.body.classList.remove('theme-panel-open');
    };

    const goTo = (index) => {
      if (index < 0 || index >= lightboxButtons.length) return;
      const btn = lightboxButtons[index];
      const img = btn.querySelector('img');
      lightboxImg.src = btn.dataset.lightbox;
      lightboxImg.alt = img?.alt || 'App screenshot';
      currentIndex = index;
      updateArrows();
    };

    lightboxButtons.forEach((btn, i) => {
      btn.addEventListener('click', () => {
        const img = btn.querySelector('img');
        openLightbox(btn.dataset.lightbox, img?.alt, i);
      });
    });

    lightboxPrev?.addEventListener('click', () => goTo(currentIndex - 1));
    lightboxNext?.addEventListener('click', () => goTo(currentIndex + 1));

    lightboxClose?.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) closeLightbox();
    });
    document.addEventListener('keydown', (e) => {
      if (!lightbox.classList.contains('open')) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') goTo(currentIndex - 1);
      if (e.key === 'ArrowRight') goTo(currentIndex + 1);
    });
  }

  // Screenshot scroll arrows
  const showcase = document.getElementById('screenshot-showcase');
  if (showcase) {
    const scrollAmount = 500;
    document.querySelectorAll('[data-scroll]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dir = parseInt(btn.dataset.scroll, 10);
        showcase.scrollBy({ left: dir * scrollAmount, behavior: 'smooth' });
      });
    });
  }
});