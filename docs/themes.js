// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
/* Cegin website themes — synced from mobile/src/theme.js */
(function (global) {
  const PALETTES = {
    'open-flame': {
      name: 'Open Flame',
      preview: '#FF5A26',
      dark: {
        background: '#131010',
        surface: '#1C1715',
        surface2: '#231D19',
        border: '#2E2724',
        text: '#F6F1EA',
        text2: '#E2D9CF',
        textMuted: '#948A80',
        primary: '#FF5A26',
        primaryDark: '#CC4820',
        onPrimary: '#131010',
        danger: '#E5645B',
        success: '#7BC47F',
      },
      light: {
        background: '#F4EEE5',
        surface: '#FFFFFF',
        surface2: '#EAE2D5',
        border: '#DFD5C6',
        text: '#1D1510',
        text2: '#46392E',
        textMuted: '#8A7D70',
        primary: '#E04E14',
        primaryDark: '#C03F10',
        onPrimary: '#FFFFFF',
        danger: '#B3261E',
        success: '#2E7D32',
      },
    },
    ocean: {
      name: 'Ocean',
      preview: '#4FC3F7',
      dark: {
        background: '#0A1628',
        surface: '#111D33',
        surface2: '#162440',
        border: '#1E3050',
        text: '#E8EDF5',
        text2: '#C0CAD8',
        textMuted: '#6B7F99',
        primary: '#4FC3F7',
        primaryDark: '#29B6F6',
        onPrimary: '#0A1628',
        danger: '#EF5350',
        success: '#66BB6A',
      },
      light: {
        background: '#EBF2FA',
        surface: '#FFFFFF',
        surface2: '#D6E4F0',
        border: '#C4D4E6',
        text: '#0D1B2A',
        text2: '#2A3F56',
        textMuted: '#6B7F99',
        primary: '#0288D1',
        primaryDark: '#0277BD',
        onPrimary: '#FFFFFF',
        danger: '#C62828',
        success: '#2E7D32',
      },
    },
    forest: {
      name: 'Forest',
      preview: '#81C784',
      dark: {
        background: '#0E1510',
        surface: '#151E16',
        surface2: '#1A251C',
        border: '#243026',
        text: '#E8F0E9',
        text2: '#C4D4C6',
        textMuted: '#7A947D',
        primary: '#81C784',
        primaryDark: '#66BB6A',
        onPrimary: '#0E1510',
        danger: '#E57373',
        success: '#A5D6A7',
      },
      light: {
        background: '#ECF4ED',
        surface: '#FFFFFF',
        surface2: '#D8E8D9',
        border: '#C0D4C2',
        text: '#1B2E1D',
        text2: '#3A5239',
        textMuted: '#6B8A6E',
        primary: '#388E3C',
        primaryDark: '#2E7D32',
        onPrimary: '#FFFFFF',
        danger: '#C62828',
        success: '#2E7D32',
      },
    },
    berry: {
      name: 'Berry',
      preview: '#CE93D8',
      dark: {
        background: '#140E18',
        surface: '#1D1523',
        surface2: '#241A2C',
        border: '#322640',
        text: '#F0E8F5',
        text2: '#D4C4DE',
        textMuted: '#8E7A9E',
        primary: '#CE93D8',
        primaryDark: '#BA68C8',
        onPrimary: '#140E18',
        danger: '#EF5350',
        success: '#81C784',
      },
      light: {
        background: '#F5EDF8',
        surface: '#FFFFFF',
        surface2: '#E8D8EE',
        border: '#D4BEE0',
        text: '#1A0E20',
        text2: '#3D2A4A',
        textMuted: '#7A6288',
        primary: '#8E24AA',
        primaryDark: '#7B1FA2',
        onPrimary: '#FFFFFF',
        danger: '#C62828',
        success: '#2E7D32',
      },
    },
    midnight: {
      name: 'Midnight',
      preview: '#7986CB',
      dark: {
        background: '#0B0E1A',
        surface: '#121628',
        surface2: '#181D35',
        border: '#222845',
        text: '#E4E8F5',
        text2: '#BFC6DA',
        textMuted: '#6670A0',
        primary: '#7986CB',
        primaryDark: '#5C6BC0',
        onPrimary: '#0B0E1A',
        danger: '#EF5350',
        success: '#66BB6A',
      },
      light: {
        background: '#ECEEF5',
        surface: '#FFFFFF',
        surface2: '#D8DCE8',
        border: '#C0C6DA',
        text: '#0E1020',
        text2: '#2A2F48',
        textMuted: '#6670A0',
        primary: '#3949AB',
        primaryDark: '#303F9F',
        onPrimary: '#FFFFFF',
        danger: '#C62828',
        success: '#2E7D32',
      },
    },
    sakura: {
      name: 'Sakura',
      preview: '#F48FB1',
      dark: {
        background: '#180E12',
        surface: '#221519',
        surface2: '#2C1A20',
        border: '#3A2530',
        text: '#F5E8EE',
        text2: '#DEC0CE',
        textMuted: '#A07888',
        primary: '#F48FB1',
        primaryDark: '#EC407A',
        onPrimary: '#180E12',
        danger: '#EF5350',
        success: '#81C784',
      },
      light: {
        background: '#FBF0F4',
        surface: '#FFFFFF',
        surface2: '#F0D8E2',
        border: '#E0C0CE',
        text: '#201018',
        text2: '#4A2838',
        textMuted: '#8A6070',
        primary: '#C2185B',
        primaryDark: '#AD1457',
        onPrimary: '#FFFFFF',
        danger: '#C62828',
        success: '#2E7D32',
      },
    },
    oled: {
      name: 'OLED',
      preview: '#000000',
      dark: {
        background: '#000000',
        surface: '#0A0A0A',
        surface2: '#111111',
        border: '#1A1A1A',
        text: '#F0F0F0',
        text2: '#D0D0D0',
        textMuted: '#666666',
        primary: '#FF5A26',
        primaryDark: '#CC4820',
        onPrimary: '#000000',
        danger: '#FF4444',
        success: '#4ADE80',
      },
      light: {
        background: '#FFFFFF',
        surface: '#FFFFFF',
        surface2: '#F5F5F5',
        border: '#E0E0E0',
        text: '#111111',
        text2: '#333333',
        textMuted: '#888888',
        primary: '#E04E14',
        primaryDark: '#C03F10',
        onPrimary: '#FFFFFF',
        danger: '#DC2626',
        success: '#16A34A',
      },
    },
  };

  const OLED_ACCENTS = [
    { name: 'Ember', primary: '#FF5A26', onPrimary: '#000000' },
    { name: 'Sky', primary: '#38BDF8', onPrimary: '#000000' },
    { name: 'Mint', primary: '#34D399', onPrimary: '#000000' },
    { name: 'Violet', primary: '#A78BFA', onPrimary: '#000000' },
    { name: 'Rose', primary: '#FB7185', onPrimary: '#000000' },
    { name: 'Amber', primary: '#FBBF24', onPrimary: '#000000' },
    { name: 'Lime', primary: '#A3E635', onPrimary: '#000000' },
    { name: 'Fuchsia', primary: '#E879F9', onPrimary: '#000000' },
  ];

  const STORAGE = {
    palette: 'cegin_palette',
    mode: 'cegin_mode',
    oledAccent: 'cegin_oled_accent',
  };

  const DEFAULTS = {
    palette: 'open-flame',
    mode: 'dark',
    oledAccent: 0,
  };

  function resolveScheme(mode) {
    if (mode === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return mode === 'light' ? 'light' : 'dark';
  }

  function getColors(paletteKey, mode, oledAccent) {
    const palette = PALETTES[paletteKey] || PALETTES[DEFAULTS.palette];
    const scheme = resolveScheme(mode);
    let colors = { ...palette[scheme] };

    if (paletteKey === 'oled' && OLED_ACCENTS[oledAccent]) {
      colors.primary = OLED_ACCENTS[oledAccent].primary;
      colors.onPrimary = OLED_ACCENTS[oledAccent].onPrimary;
    }

    return { colors, scheme, palette };
  }

  function applyTheme(prefs) {
    const paletteKey = prefs.palette || DEFAULTS.palette;
    const mode = prefs.mode || DEFAULTS.mode;
    const oledAccent = Number.isFinite(prefs.oledAccent) ? prefs.oledAccent : DEFAULTS.oledAccent;
    const { colors, scheme } = getColors(paletteKey, mode, oledAccent);
    const root = document.documentElement;

    root.style.setProperty('--bg', colors.background);
    root.style.setProperty('--surface', colors.surface);
    root.style.setProperty('--surface2', colors.surface2);
    root.style.setProperty('--border', colors.border);
    root.style.setProperty('--text', colors.text);
    root.style.setProperty('--text2', colors.text2);
    root.style.setProperty('--text-muted', colors.textMuted);
    root.style.setProperty('--primary', colors.primary);
    root.style.setProperty('--primary-dark', colors.primaryDark);
    root.style.setProperty('--on-primary', colors.onPrimary);
    root.style.setProperty('--danger', colors.danger);
    root.style.setProperty('--success', colors.success);

    root.dataset.palette = paletteKey;
    root.dataset.scheme = scheme;
    root.dataset.mode = mode;

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', colors.background);

    return { paletteKey, mode, oledAccent, scheme, colors };
  }

  function loadPrefs() {
    try {
      return {
        palette: localStorage.getItem(STORAGE.palette) || DEFAULTS.palette,
        mode: localStorage.getItem(STORAGE.mode) || DEFAULTS.mode,
        oledAccent: parseInt(localStorage.getItem(STORAGE.oledAccent) ?? String(DEFAULTS.oledAccent), 10),
      };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function savePrefs(prefs) {
    try {
      localStorage.setItem(STORAGE.palette, prefs.palette);
      localStorage.setItem(STORAGE.mode, prefs.mode);
      localStorage.setItem(STORAGE.oledAccent, String(prefs.oledAccent));
    } catch {}
  }

  function initFromStorage() {
    return applyTheme(loadPrefs());
  }

  function paletteCardHTML(key, p) {
    const dark = p.dark;
    return `
      <button type="button" class="palette-card" data-palette="${key}" aria-label="${p.name} theme" aria-pressed="false">
        <span class="palette-preview" style="--preview-bg:${dark.background};--preview-surface:${dark.surface};--preview-primary:${dark.primary}"></span>
        <span class="palette-name">${p.name}</span>
      </button>`;
  }

  function oledAccentHTML() {
    return OLED_ACCENTS.map((accent, i) => `
      <button type="button" class="oled-accent" data-oled="${i}" style="--accent:${accent.primary}" title="${accent.name}" aria-label="${accent.name} accent"></button>
    `).join('');
  }

  function initThemeUI() {
    let prefs = loadPrefs();
    applyTheme(prefs);

    const panel = document.getElementById('theme-panel');
    const overlay = document.getElementById('theme-overlay');
    const openBtns = document.querySelectorAll('[data-theme-open]');
    const closeBtns = document.querySelectorAll('[data-theme-close]');
    const paletteGrids = document.querySelectorAll('[data-theme-palette-grid]');
    const modeGroups = document.querySelectorAll('[data-theme-mode-group]');
    const oledSections = document.querySelectorAll('[data-theme-oled-section]');
    const oledGrids = document.querySelectorAll('[data-theme-oled-grid]');

    if (!paletteGrids.length) return;

    function syncUI() {
      const scheme = resolveScheme(prefs.mode);

      document.querySelectorAll('[data-palette]').forEach((btn) => {
        const key = btn.dataset.palette;
        const palette = PALETTES[key];
        const colors = palette ? palette[scheme] : null;
        const preview = btn.querySelector('.palette-preview');

        if (colors && preview) {
          let primary = colors.primary;
          if (key === 'oled' && OLED_ACCENTS[prefs.oledAccent]) {
            primary = OLED_ACCENTS[prefs.oledAccent].primary;
          }
          preview.style.setProperty('--preview-bg', colors.background);
          preview.style.setProperty('--preview-surface', colors.surface);
          preview.style.setProperty('--preview-primary', primary);
        }

        const active = key === prefs.palette;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });

      document.querySelectorAll('[data-mode]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mode === prefs.mode);
      });

      oledSections.forEach((section) => {
        section.hidden = prefs.palette !== 'oled';
      });

      document.querySelectorAll('[data-oled]').forEach((btn) => {
        btn.classList.toggle('active', parseInt(btn.dataset.oled, 10) === prefs.oledAccent);
      });
    }

    function setTheme(next) {
      prefs = { ...prefs, ...next };
      applyTheme(prefs);
      savePrefs(prefs);
      syncUI();
    }

    const paletteHTML = Object.entries(PALETTES).map(([key, p]) => paletteCardHTML(key, p)).join('');

    paletteGrids.forEach((grid) => {
      grid.innerHTML = paletteHTML;
      grid.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-palette]');
        if (!btn) return;
        setTheme({ palette: btn.dataset.palette });
      });
    });

    modeGroups.forEach((group) => {
      group.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-mode]');
        if (!btn) return;
        setTheme({ mode: btn.dataset.mode });
      });
    });

    const oledHTML = oledAccentHTML();
    oledGrids.forEach((grid) => {
      grid.innerHTML = oledHTML;
      grid.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-oled]');
        if (!btn) return;
        setTheme({ palette: 'oled', oledAccent: parseInt(btn.dataset.oled, 10) });
      });
    });

    function openPanel() {
      if (panel) panel.classList.add('open');
      if (overlay) overlay.classList.add('open');
      document.body.classList.add('theme-panel-open');
    }

    function closePanel() {
      if (panel) panel.classList.remove('open');
      if (overlay) overlay.classList.remove('open');
      document.body.classList.remove('theme-panel-open');
    }

    openBtns.forEach((btn) => btn.addEventListener('click', openPanel));
    closeBtns.forEach((btn) => btn.addEventListener('click', closePanel));
    if (overlay) overlay.addEventListener('click', closePanel);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePanel();
    });

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', () => {
      if (prefs.mode === 'system') applyTheme(prefs);
    });

    syncUI();
  }

  global.CeginThemes = {
    PALETTES,
    OLED_ACCENTS,
    applyTheme,
    loadPrefs,
    savePrefs,
    initFromStorage,
    initThemeUI,
    resolveScheme,
  };
})(window);