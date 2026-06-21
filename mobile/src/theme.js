// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { AppState, Platform, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateMaterialYouPalette, getDeviceAccentColor, isMaterialYouSupported } from './utils/materialYou';

const THEME_KEY = 'themeMode';
const PALETTE_KEY = 'themePalette';
const OLED_ACCENT_KEY = 'oledAccent';
const M3_SEED_KEY = 'materialYouSeed';

export const MONO = Platform.select({ ios: 'Courier New', android: 'monospace' });

// OLED accent presets
export const OLED_ACCENTS = [
  { name: 'Ember', primary: '#FF5A26', onPrimary: '#000000' },
  { name: 'Sky', primary: '#38BDF8', onPrimary: '#000000' },
  { name: 'Mint', primary: '#34D399', onPrimary: '#000000' },
  { name: 'Violet', primary: '#A78BFA', onPrimary: '#000000' },
  { name: 'Rose', primary: '#FB7185', onPrimary: '#000000' },
  { name: 'Amber', primary: '#FBBF24', onPrimary: '#000000' },
  { name: 'Lime', primary: '#A3E635', onPrimary: '#000000' },
  { name: 'Fuchsia', primary: '#E879F9', onPrimary: '#000000' },
];

// Material You seed color presets
export const M3_SEEDS = [
  { name: 'Violet', hex: '#6750A4' },
  { name: 'Teal', hex: '#006B5E' },
  { name: 'Blue', hex: '#0061A4' },
  { name: 'Green', hex: '#386A20' },
  { name: 'Red', hex: '#BA1A1A' },
  { name: 'Pink', hex: '#984061' },
  { name: 'Orange', hex: '#8B5000' },
  { name: 'Cyan', hex: '#006A6A' },
];

// ─── Theme palettes ──────────────────────────────────────────────────────

const palettes = {
  'open-flame': {
    name: 'Open Flame',
    dark: {
      background: '#131010',
      surface: '#1C1715',
      surface2: '#231D19',
      card: '#1C1715',
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
      card: '#FFFFFF',
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
  'ocean': {
    name: 'Ocean',
    dark: {
      background: '#0A1628',
      surface: '#111D33',
      surface2: '#162440',
      card: '#111D33',
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
      card: '#FFFFFF',
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
  'forest': {
    name: 'Forest',
    dark: {
      background: '#0E1510',
      surface: '#151E16',
      surface2: '#1A251C',
      card: '#151E16',
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
      card: '#FFFFFF',
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
  'berry': {
    name: 'Berry',
    dark: {
      background: '#140E18',
      surface: '#1D1523',
      surface2: '#241A2C',
      card: '#1D1523',
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
      card: '#FFFFFF',
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
  'midnight': {
    name: 'Midnight',
    dark: {
      background: '#0B0E1A',
      surface: '#121628',
      surface2: '#181D35',
      card: '#121628',
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
      card: '#FFFFFF',
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
  'sakura': {
    name: 'Sakura',
    dark: {
      background: '#180E12',
      surface: '#221519',
      surface2: '#2C1A20',
      card: '#221519',
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
      card: '#FFFFFF',
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
  'oled': {
    name: 'OLED',
    dark: {
      background: '#000000',
      surface: '#0A0A0A',
      surface2: '#111111',
      card: '#0A0A0A',
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
      card: '#FFFFFF',
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

export const THEME_LIST = [
  ...(isMaterialYouSupported() ? [{ key: 'material-you', name: 'Material You' }] : []),
  ...Object.entries(palettes).map(([key, p]) => ({ key, name: p.name })),
];

export const darkColors = palettes['open-flame'].dark;
export const lightColors = palettes['open-flame'].light;
export const colors = darkColors;

// ─── Context ─────────────────────────────────────────────────────────────

const ThemeContext = createContext({
  colors: darkColors,
  mode: 'dark',
  scheme: 'dark',
  palette: 'open-flame',
  oledAccent: 0,
  materialYouSeed: '#6750A4',
  setMode: () => {},
  setPalette: () => {},
  setOledAccent: () => {},
  setMaterialYouSeed: () => {},
});

export function ThemeProvider({ children }) {
  const systemScheme = useColorScheme() ?? 'dark';
  const [mode, setModeState] = useState('dark');
  const [palette, setPaletteState] = useState('open-flame');
  const [oledAccent, setOledAccentState] = useState(0);
  const [materialYouColors, setMaterialYouColors] = useState(null);
  const [materialYouSeed, setMaterialYouSeedState] = useState('#6750A4');

  // Load saved seed (used only as fallback if wallpaper detection fails)
  useEffect(() => {
    AsyncStorage.getItem(M3_SEED_KEY).then((s) => {
      if (s) setMaterialYouSeedState(s);
    });
  }, []);

  // Generate Material You palette — reads wallpaper accent color via native module
  const refreshMaterialYou = useCallback(async () => {
    if (!isMaterialYouSupported()) return;
    const accent = await getDeviceAccentColor();
    const seed = accent || materialYouSeed;
    const m3 = generateMaterialYouPalette(seed);
    setMaterialYouColors(m3);
  }, [materialYouSeed]);

  useEffect(() => {
    refreshMaterialYou();
    // Re-check on foreground (wallpaper may have changed)
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshMaterialYou();
    });
    return () => sub.remove();
  }, [refreshMaterialYou]);

  // Re-generate when system scheme changes (light/dark)
  useEffect(() => {
    if (palette === 'material-you') refreshMaterialYou();
  }, [systemScheme]);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(THEME_KEY),
      AsyncStorage.getItem(PALETTE_KEY),
      AsyncStorage.getItem(OLED_ACCENT_KEY),
    ]).then(([m, p, a]) => {
      if (m === 'light' || m === 'dark' || m === 'system') setModeState(m);
      if (p && (palettes[p] || p === 'material-you')) setPaletteState(p);
      // If no saved palette and Material You is available, auto-select it
      if (!p && isMaterialYouSupported()) {
        getDeviceAccentColor().then((accent) => {
          if (accent) setPaletteState('material-you');
        });
      }
      if (a && !isNaN(Number(a))) setOledAccentState(Number(a));
    });
  }, []);

  const setMode = useCallback((m) => {
    setModeState(m);
    AsyncStorage.setItem(THEME_KEY, m);
  }, []);

  const setPalette = useCallback((p) => {
    if (palettes[p] || p === 'material-you') {
      setPaletteState(p);
      AsyncStorage.setItem(PALETTE_KEY, p);
    }
  }, []);

  const setOledAccent = useCallback((idx) => {
    setOledAccentState(idx);
    AsyncStorage.setItem(OLED_ACCENT_KEY, String(idx));
  }, []);

  const scheme = mode === 'system' ? systemScheme : mode;
  let activeColors;

  if (palette === 'material-you' && materialYouColors) {
    activeColors = materialYouColors[scheme] ?? materialYouColors.dark;
  } else {
    activeColors = palettes[palette]?.[scheme] ?? darkColors;
  }

  // Apply OLED accent override
  if (palette === 'oled' && OLED_ACCENTS[oledAccent]) {
    const accent = OLED_ACCENTS[oledAccent];
    activeColors = { ...activeColors, primary: accent.primary, onPrimary: accent.onPrimary };
  }

  const setMaterialYouSeed = useCallback((hex) => {
    setMaterialYouSeedState(hex);
    AsyncStorage.setItem(M3_SEED_KEY, hex);
  }, []);

  const value = useMemo(
    () => ({ colors: activeColors, mode, scheme, palette, oledAccent, materialYouSeed, setMode, setPalette, setOledAccent, setMaterialYouSeed }),
    [scheme, mode, palette, oledAccent, activeColors, materialYouSeed],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
