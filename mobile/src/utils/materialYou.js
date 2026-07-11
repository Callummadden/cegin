// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
import { Platform, NativeModules } from 'react-native';
import { themeFromSourceColor, argbFromHex, hexFromArgb } from '@material/material-color-utilities';

/**
 * Generate a Cegin-compatible color palette from a Material You seed color.
 */
export function generateMaterialYouPalette(seedHex) {
  const seed = argbFromHex(seedHex);
  const theme = themeFromSourceColor(seed);

  const mapScheme = (scheme) => {
    const g = (token) => hexFromArgb(scheme[token]);
    return {
      background: g('background'),
      surface: g('surface'),
      surface2: g('surfaceVariant'),
      card: g('surface'),
      border: g('outlineVariant'),
      text: g('onSurface'),
      text2: g('onSurfaceVariant'),
      textMuted: g('outline'),
      primary: g('primary'),
      primaryDark: g('primaryContainer'),
      onPrimary: g('onPrimary'),
      danger: g('error'),
      success: '#4ADE80',
    };
  };

  return {
    dark: mapScheme(theme.schemes.dark),
    light: mapScheme(theme.schemes.light),
  };
}

/**
 * Read the device's Material You accent color from the wallpaper.
 * Uses the native WallpaperColor module which calls Android's WallpaperManager.
 */
export async function getDeviceAccentColor() {
  if (Platform.OS !== 'android') return null;
  try {
    const color = await NativeModules.MaterialYouColor?.getAccentColor?.();
    if (color && color !== '#000000' && color !== '#FFFFFF') {
      return color;
    }
  } catch (_e) { if (__DEV__) console.warn(\'[materialYou] Caught error:\', _e.message); }
  return null;
}

/**
 * Check if the device supports Material You (Android 12+ / API 31+).
 */
export function isMaterialYouSupported() {
  return Platform.OS === 'android' && Platform.Version >= 31;
}
