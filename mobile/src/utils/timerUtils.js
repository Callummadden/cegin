// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/cmadzz/cegin
/**
 * Shared timer utility functions used across CookModeScreen, RecipeDetailScreen, and GlobalTimerBar.
 */

/**
 * Format seconds into M:SS display string.
 * @param {number} secs - Seconds to format
 * @returns {string} Formatted time string (e.g., "5:30")
 */
export function fmtClock(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m + ':' + String(s).padStart(2, '0');
}

/**
 * Find ALL time mentions in a string. Returns an array of
 * { match, minutes, index, length } objects sorted by position.
 * Handles: '25 minutes', '1 hour', '10 mins', '1.5 hours',
 *          '30-40 minutes' (first number), '1 hour 30 minutes', etc.
 * @param {string} text - Text to search for timer patterns
 * @returns {Array<{match: string, minutes: number, index: number, length: number}>}
 */
export function findAllTimers(text) {
  if (!text) return [];
  const re = /(\d+(?:\.\d+)?)\s*(?:-\s*\d+(?:\.\d+)?)?\s*(hours?|hrs?|minutes?|mins?)\b/gi;
  const results = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const num = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    const minutes = (unit.startsWith('hour') || unit.startsWith('hr'))
      ? Math.round(num * 60)
      : Math.round(num);
    if (minutes > 0) {
      results.push({ match: m[0], minutes, index: m.index, length: m[0].length });
    }
  }
  return results;
}

/**
 * Parse timer references from text like "5 minutes", "10 min", "1h 30m", "1.5 hours".
 * Returns an array of all matched durations in minutes.
 * @param {string} text - Text to search for timer patterns
 * @returns {number[]} Array of timer values in minutes
 */
export function parseTimerMins(text) {
  return findAllTimers(text).map(t => t.minutes);
}
