// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/cmadzz/cegin
// Parse and scale ingredient quantities.
// "2 cups flour" × 2 → "4 cups flour"
// "1/2 tsp salt" × 2 → "1 tsp salt"
// "2 1/3 cups sugar" × 1.5 → "3 1/2 cups sugar"
// "pinch of salt" → unchanged (no number)

// Unicode fraction map
const FRACTIONS = {
  '½': 0.5, '⅓': 1/3, '⅔': 2/3, '¼': 0.25, '¾': 0.75,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1/6, '⅚': 5/6, '⅐': 1/7, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

// Try to parse a leading number (possibly with fraction) from an ingredient string.
// Returns { value, end } where end is the index after the matched text, or null.
function parseLeadingNumber(s) {
  // Unicode fraction alone: "½ cup"
  if (FRACTIONS[s[0]]) {
    return { value: FRACTIONS[s[0]], end: 1 };
  }

  // Match patterns like: "2", "2 1/2", "2½", "1/2", "2.5"
  // Also handle "2 ½" (space before unicode fraction)
  const m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/); // "2 1/2"
  if (m) return { value: parseInt(m[1]) + parseInt(m[2]) / parseInt(m[3]), end: m[0].length };
  // "2 ½" pattern: number followed by space + unicode fraction
  const mFrac = s.match(/^(\d+)\s+([\u00BC-\u00BE\u2150-\u215E])/);
  if (mFrac && FRACTIONS[mFrac[2]]) return { value: parseInt(mFrac[1]) + FRACTIONS[mFrac[2]], end: mFrac[0].length };

  const m2 = s.match(/^(\d+)\/(\d+)/); // "1/2"
  if (m2) {
    if (parseInt(m2[2]) === 0) return null;
    return { value: parseInt(m2[1]) / parseInt(m2[2]), end: m2[0].length };
  }

  const m3 = s.match(/^(\d+\.?\d*)/); // "2" or "2.5"
  if (m3) {
    let end = m3[0].length;
    // Check for trailing unicode fraction: "2½"
    if (end < s.length && FRACTIONS[s[end]]) {
      return { value: parseFloat(m3[1]) + FRACTIONS[s[end]], end: end + 1 };
    }
    return { value: parseFloat(m3[1]), end };
  }

  return null;
}

// Format a number nicely: avoid "2.0000000001", show fractions for common values
function formatQuantity(n) {
  if (n === 0) return '0';
  if (Number.isInteger(n)) return String(n);

  // Common fractions
  const FRACS = [
    [0.125, '⅛'], [0.25, '¼'], [1/3, '⅓'], [0.375, '⅜'],
    [0.5, '½'], [0.625, '⅝'], [2/3, '⅔'], [0.75, '¾'], [0.875, '⅞'],
  ];

  const whole = Math.floor(n);
  const frac = n - whole;

  for (const [val, sym] of FRACS) {
    if (Math.abs(frac - val) < 0.03) {
      return whole > 0 ? `${whole}${sym}` : sym;
    }
  }

  // Fall back to decimal, trim trailing zeros
  return n % 1 === 0 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, '');
}

// Scale a single ingredient line by the given ratio.
export function scaleIngredient(line, ratio) {
  if (ratio === 1) return line;
  const trimmed = line.trim();
  const parsed = parseLeadingNumber(trimmed);
  if (!parsed) return line; // no number found, return unchanged

  const scaled = parsed.value * ratio;
  const rest = trimmed.slice(parsed.end);
  return `${formatQuantity(scaled)}${rest}`;
}

// Scale an array of ingredient lines.
export function scaleIngredients(ingredients, fromServings, toServings) {
  if (fromServings === toServings || !fromServings) return ingredients;
  const ratio = toServings / fromServings;
  return ingredients.map((line) => scaleIngredient(line, ratio));
}
