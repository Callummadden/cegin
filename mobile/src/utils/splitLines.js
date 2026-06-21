/**
 * Split a string by newlines and filter empty lines.
 * @param {string} text
 * @returns {string[]}
 */
export function splitLines(text) {
  if (!text) return [];
  return text.split('\n').map(s => s.trim()).filter(Boolean);
}
