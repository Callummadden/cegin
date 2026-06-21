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
 * Parse timer references from text like "5 minutes", "10 min", "1h 30m".
 * @param {string} text - Text to search for timer patterns
 * @returns {number[]} Array of timer values in minutes
 */
export function parseTimerMins(text) {
  if (!text) return [];
  const matches = text.matchAll(/(\d+)\s*(minutes?|mins?|hours?|hrs?|h|m)/gi);
  const out = [];
  for (const m of matches) {
    const n = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    if (unit.startsWith('h')) out.push(n * 60);
    else out.push(n);
  }
  return out;
}
