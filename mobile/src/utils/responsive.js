// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/cmadzz/cegin
import { useWindowDimensions } from 'react-native';

// Reference dimensions (Pixel 7 / typical modern Android)
const BASE_WIDTH = 412;
const BASE_HEIGHT = 915;

/**
 * Scale a value proportionally to screen width.
 * Good for: padding, margins, gaps, border radius, icon sizes.
 * Returns the same value on a 390px-wide screen, larger on tablets, smaller on compact phones.
 */
function scale(size, width) {
  return size * Math.min(width / BASE_WIDTH, 1);
}

/**
 * Scale a value with moderated factor (0.3).
 * Good for: font sizes — avoids getting too large on tablets or too small on tiny phones.
 */
function fontScale(size, width) {
  return size + (scale(size, width) - size) * 0.3;
}

/**
 * Responsive hook — use in any screen component.
 *
 * Usage:
 *   const { s, fs, width, height } = useResponsive();
 *   padding: s(20)        // scales linearly
 *   fontSize: fs(14)      // scales moderately
 *   width: width * 0.5    // percentage-based
 */
export function useResponsive() {
  const { width, height } = useWindowDimensions();

  return {
    s: (size) => scale(size, width),
    fs: (size) => fontScale(size, width),
    width,
    height,
  };
}
