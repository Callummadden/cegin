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

  if (lightbox && lightboxImg) {
    const openLightbox = (src, alt) => {
      lightboxImg.src = src;
      lightboxImg.alt = alt || 'App screenshot';
      lightbox.hidden = false;
      lightbox.classList.add('open');
      document.body.classList.add('theme-panel-open');
    };

    const closeLightbox = () => {
      lightbox.classList.remove('open');
      lightbox.hidden = true;
      lightboxImg.src = '';
      document.body.classList.remove('theme-panel-open');
    };

    document.querySelectorAll('[data-lightbox]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const img = btn.querySelector('img');
        openLightbox(btn.dataset.lightbox, img?.alt);
      });
    });

    lightboxClose?.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) closeLightbox();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && lightbox.classList.contains('open')) closeLightbox();
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