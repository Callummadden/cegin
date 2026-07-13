// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/cmadzz/cegin

/**
 * Structured logging module.
 *
 * - JSON format in production (machine-parseable)
 * - Pretty colourised output in development
 * - Levels: error, warn, info, debug
 * - Every entry carries a requestId when available
 */

const isProduction = process.env.NODE_ENV === 'production';

const LEVEL_ORDER = { error: 0, warn: 1, info: 2, debug: 3 };
const LEVEL_LABELS = { error: 'ERROR', warn: 'WARN', info: 'INFO', debug: 'DEBUG' };

// Effective log level — set via LOG_LEVEL env, defaults to 'info' in prod, 'debug' in dev
const effectiveLevel = LEVEL_ORDER[process.env.LOG_LEVEL] ?? (isProduction ? 2 : 3);

const COLORS = {
  error: '\x1b[31m',   // red
  warn: '\x1b[33m',    // yellow
  info: '\x1b[36m',    // cyan
  debug: '\x1b[90m',   // gray
  reset: '\x1b[0m',
  dim: '\x1b[2m',
};

/**
 * Format a log entry for pretty-printing in dev.
 */
function formatPretty(level, message, meta, requestId) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const color = COLORS[level] || '';
  const label = LEVEL_LABELS[level];
  const rid = requestId ? ` ${COLORS.dim}[${requestId.slice(0, 8)}]${COLORS.reset}` : '';
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  return `${COLORS.dim}${ts}${COLORS.reset} ${color}${label}${COLORS.reset}${rid} ${message}${metaStr}`;
}

/**
 * Format a log entry as a JSON line (production).
 */
function formatJson(level, message, meta, requestId) {
  const entry = {
    time: new Date().toISOString(),
    level: LEVEL_LABELS[level],
    message,
  };
  if (requestId) entry.requestId = requestId;
  if (meta && Object.keys(meta).length > 0) Object.assign(entry, meta);
  return JSON.stringify(entry);
}

/**
 * Core log function.
 */
function log(level, message, meta, requestId) {
  if (LEVEL_ORDER[level] > effectiveLevel) return;

  const formatted = isProduction
    ? formatJson(level, message, meta, requestId)
    : formatPretty(level, message, meta, requestId);

  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(formatted + '\n');
}

/**
 * Create a logger with a bound requestId (e.g. from a request).
 * Falls back to plain logger calls when no request context exists.
 */
function createLogger(requestId) {
  return {
    error: (msg, meta) => log('error', msg, meta, requestId),
    warn:  (msg, meta) => log('warn', msg, meta, requestId),
    info:  (msg, meta) => log('info', msg, meta, requestId),
    debug: (msg, meta) => log('debug', msg, meta, requestId),
  };
}

// Top-level logger (no request context)
module.exports = {
  error: (msg, meta) => log('error', msg, meta),
  warn:  (msg, meta) => log('warn', msg, meta),
  info:  (msg, meta) => log('info', msg, meta),
  debug: (msg, meta) => log('debug', msg, meta),
  createLogger,
};
