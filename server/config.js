// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/cmadzz/cegin

/**
 * Centralised configuration — all tuneable constants in one place.
 * Values can be overridden via environment variables where noted.
 */

module.exports = {
  // --- Rate Limiting (AI routes) ---
  RATE_LIMIT: 60,                          // requests per minute
  RATE_WINDOW: 60_000,                     // 1 minute in ms
  RATE_LIMIT_CLEANUP_INTERVAL: 300_000,    // 5 minutes in ms

  // --- Rate Limiting (Auth routes) ---
  AUTH_RATE_LIMIT: 10,                     // login attempts per minute
  AUTH_RATE_WINDOW: 60_000,                // 1 minute in ms

  // --- Body Parser Limits ---
  BODY_LIMIT_SMALL: '1mb',                 // default
  BODY_LIMIT_MEDIUM: '5mb',                // cookbook / recipe save
  BODY_LIMIT_LARGE: '20mb',                // scan-fridge

  // --- Image Proxy ---
  IMAGE_PROXY_DEFAULT_WIDTH: 600,
  IMAGE_PROXY_MAX_WIDTH: 1200,
  IMAGE_PROXY_FETCH_TIMEOUT: 10_000,       // 10s
  IMAGE_CACHE_MAX_AGE: 2_592_000,          // 30 days (seconds, for Cache-Control)

  // --- WebSocket ---
  WS_PING_INTERVAL: 30_000,                // 30s dead-connection probe

  // --- Server ---
  PORT: parseInt(process.env.PORT, 10) || 3000,

  // --- Client / Server Version Matrix ---
  MIN_CLIENT_VERSION: '1.1.5',
  LATEST_CLIENT_VERSION: '1.4.0',
  LATEST_SERVER_VERSION: '1.4.0',

  // --- AI Service Timeouts ---
  AI_REQUEST_TIMEOUT: 30_000,              // text/vision model call
  AI_IMPORT_TIMEOUT: 60_000,               // web page fetch for recipe import
  AI_MODEL_FETCH_TIMEOUT: 10_000,          // /models listing
  AI_SCAN_RECIPE_TIMEOUT: 45_000,          // recipe image scan (heavier)
  AI_IMPORT_TEXT_LIMIT: 16_000,            // max chars of page text sent to AI
  AI_IMPORT_MAX_REDIRECTS: 5,              // redirect hops when importing
  AI_IMPORT_MIN_HTML_LENGTH: 200,          // reject pages with less content
};
