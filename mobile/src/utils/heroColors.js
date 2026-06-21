// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
// Theme-aware hero placeholder colors for recipe cards

// Blend two hex colors (0-1 ratio toward b)
export function blendColor(a, b, ratio) {
  if (!a || !a.startsWith('#') || a.length < 7) return b || '#000000';
  if (!b || !b.startsWith('#') || b.length < 7) return a || '#000000';
  const ah = parseInt(a.slice(1), 16);
  const bh = parseInt(b.slice(1), 16);
  const ar = (ah >> 16) & 0xff, ag = (ah >> 8) & 0xff, ab = ah & 0xff;
  const br = (bh >> 16) & 0xff, bg = (bh >> 8) & 0xff, bb = bh & 0xff;
  const rr = Math.round(ar + (br - ar) * ratio);
  const rg = Math.round(ag + (bg - ag) * ratio);
  const rb = Math.round(ab + (bb - ab) * ratio);
  return `#${((rr << 16) | (rg << 8) | rb).toString(16).padStart(6, '0')}`;
}

// Generate hero placeholder colors from the active theme
export function heroCardColors(colors) {
  const base = colors.surface2;
  const accent = colors.primary;
  return [
    blendColor(base, accent, 0.15),
    blendColor(base, accent, 0.08),
    blendColor(base, accent, 0.22),
    blendColor(base, colors.background, 0.3),
    blendColor(base, accent, 0.12),
    blendColor(accent, base, 0.75),
    blendColor(base, accent, 0.18),
  ];
}

// Hash a string to a consistent number
export function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
