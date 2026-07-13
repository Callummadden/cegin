// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/cmadzz/cegin
/**
 * Split a string by newlines and filter empty lines.
 * @param {string} text
 * @returns {string[]}
 */
export function splitLines(text) {
  if (!text) return [];
  return text.split('\n').map(s => s.trim()).filter(Boolean);
}
