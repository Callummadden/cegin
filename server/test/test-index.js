// SPDX-License-Identifier: GPL-3.0-or-later
// Tests for index.js — health endpoint, CORS headers
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Use throwaway DB and secrets for tests
const TEST_DB_PATH = path.join(__dirname, '.test-index-recipes.db');
process.env.DB_PATH = TEST_DB_PATH;
process.env.JWT_SECRET = 'test-index-secret';

let server;
let baseUrl;

// ─── helpers ────────────────────────────────────────────────────────────────

function request(method, urlPath, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers,
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: data, json });
      });
    });
    req.on('error', reject);
    if (body) {
      const payload = JSON.stringify(body);
      req.setHeader('Content-Type', 'application/json');
      req.setHeader('Content-Length', Buffer.byteLength(payload));
      req.write(payload);
    }
    req.end();
  });
}

// ─── server lifecycle ───────────────────────────────────────────────────────

before(async () => {
  // Clean up stale DB files
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + ext); } catch {}
  }

  // db.js creates indexes on tables defined later — pre-create them for fresh DBs
  const Database = require('better-sqlite3');
  const preDb = new Database(TEST_DB_PATH);
  preDb.pragma('journal_mode = WAL');
  preDb.exec(`
    CREATE TABLE IF NOT EXISTS recipe_images (id INTEGER PRIMARY KEY AUTOINCREMENT, recipe_id INTEGER NOT NULL, image_url TEXT NOT NULL, position INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS meal_plans (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, date TEXT NOT NULL, meal TEXT NOT NULL, recipe_id INTEGER, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), UNIQUE(user_id, date, meal));
    CREATE TABLE IF NOT EXISTS scanned_items (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, item_name TEXT NOT NULL, scanned_at TEXT DEFAULT (datetime('now')), expires_at TEXT, consumed INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS push_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, device_name TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS cookbook_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, recipe_id INTEGER, recipe_title TEXT DEFAULT '', image_path TEXT DEFAULT '', date TEXT DEFAULT '', notes TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS chat_history (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT DEFAULT '', messages TEXT DEFAULT '[]', timestamp INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS dietary_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, needs TEXT DEFAULT '', notes TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS terry_vision_scans (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, section TEXT NOT NULL, image_path TEXT NOT NULL, ingredients TEXT NOT NULL DEFAULT '[]', created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS shopping_list (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, items TEXT NOT NULL DEFAULT '[]', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS favorites (user_id INTEGER NOT NULL, recipe_id INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (user_id, recipe_id));
    CREATE TABLE IF NOT EXISTS cook_stats (user_id INTEGER PRIMARY KEY, total_cooks INTEGER DEFAULT 0, updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS cook_dates (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, date TEXT NOT NULL, recipe_id INTEGER, created_at TEXT DEFAULT (datetime('now')), UNIQUE(user_id, date, recipe_id));
    CREATE TABLE IF NOT EXISTS activity_context (user_id INTEGER PRIMARY KEY, date TEXT, level TEXT DEFAULT '', description TEXT DEFAULT '', metrics TEXT DEFAULT '{}', updated_at TEXT DEFAULT (datetime('now')));
  `);
  preDb.close();

  // Checkpoint WAL so db.js sees the pre-created tables
  const checkDb = new Database(TEST_DB_PATH);
  checkDb.pragma('wal_checkpoint(TRUNCATE)');
  checkDb.close();

  // Intercept app.listen() to prevent binding to the real port.
  // Instead, we create our own test server on a random port (port 0).
  let app;
  const express = require('express');
  const originalCreateApp = express;
  const origListen = express.application.listen;
  express.application.listen = function (...args) {
    app = this; // capture the Express app
    // Return a dummy server — we'll create a real test server ourselves
    const dummy = new http.Server();
    dummy.unref();
    return dummy;
  };

  // Suppress console output during tests
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};

  try {
    require('../index');
  } catch (e) {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
    express.application.listen = origListen;
    throw e;
  }

  console.log = origLog;
  console.warn = origWarn;
  console.error = origError;
  express.application.listen = origListen;

  // Create a real test server from the captured app, on a random available port
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  if (server) {
    try { server.close(); } catch {}
  }
  // Clean up DB
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + ext); } catch {}
  }
});

// ─── health endpoint ────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('returns 200 with ok:true', async () => {
    const res = await request('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
  });

  it('includes version fields', async () => {
    const res = await request('GET', '/api/health');
    assert.ok(res.json.serverVersion, 'should have serverVersion');
    assert.ok(res.json.latestServerVersion, 'should have latestServerVersion');
    assert.ok(res.json.minClientVersion, 'should have minClientVersion');
    assert.ok(res.json.latestClientVersion, 'should have latestClientVersion');
  });
});

// ─── CORS headers ───────────────────────────────────────────────────────────

describe('CORS headers', () => {
  it('sets Access-Control-Allow-Methods on every response', async () => {
    const res = await request('GET', '/api/health');
    assert.ok(res.headers['access-control-allow-methods']);
    const methods = res.headers['access-control-allow-methods'];
    assert.ok(methods.includes('GET'));
    assert.ok(methods.includes('POST'));
    assert.ok(methods.includes('PUT'));
    assert.ok(methods.includes('DELETE'));
  });

  it('sets Access-Control-Allow-Headers', async () => {
    const res = await request('GET', '/api/health');
    const allowHeaders = res.headers['access-control-allow-headers'];
    assert.ok(allowHeaders);
    assert.ok(allowHeaders.includes('Content-Type'));
    assert.ok(allowHeaders.includes('Authorization'));
  });

  it('reflects allowed origin back in ACAO header', async () => {
    const res = await request('GET', '/api/health', {
      headers: { origin: 'http://localhost:3000' },
    });
    assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:3000');
  });

  it('does not reflect an unknown origin', async () => {
    const res = await request('GET', '/api/health', {
      headers: { origin: 'http://evil.example.com' },
    });
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  it('responds 204 to OPTIONS preflight', async () => {
    const res = await request('OPTIONS', '/api/health');
    assert.equal(res.status, 204);
  });
});

// ─── security headers (helmet) ──────────────────────────────────────────────

describe('Security headers (helmet)', () => {
  it('sets X-Content-Type-Options', async () => {
    const res = await request('GET', '/api/health');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  });

  it('sets X-Frame-Options', async () => {
    const res = await request('GET', '/api/health');
    assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
  });
});

// ─── auth route protection ──────────────────────────────────────────────────

describe('Auth-protected routes', () => {
  it('returns 401 for invalid token on protected route', async () => {
    const res = await request('GET', '/api/recipes', {
      headers: { authorization: 'Bearer invalid.token.here' },
    });
    assert.equal(res.status, 401);
    assert.ok(res.json.error);
  });

  it('allows access without token (open mode) on protected route', async () => {
    const res = await request('GET', '/api/recipes');
    // Should pass through auth middleware and return 200 (empty list)
    assert.equal(res.status, 200);
  });
});
