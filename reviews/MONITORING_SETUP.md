# Cegin Server — Monitoring & Structured Logging Setup

Added in v1.3.5. Covers error monitoring, structured logging, health checks, and request tracking.

## What Was Added

### 1. Structured Logger (`server/logger.js`)

Zero-dependency logging module with four levels: `error`, `warn`, `info`, `debug`.

| Environment | Format | Example |
|-------------|--------|---------|
| Development | Colourised, human-readable | `2026-07-11 17:29:40 INFO [abc12345] Recipe server listening` |
| Production  | JSON (one object per line) | `{"time":"2026-07-11T17:29:43Z","level":"INFO","message":"...","requestId":"..."}` |

**Features:**
- Every entry can carry a `requestId` (first 8 chars shown in dev for readability)
- `createLogger(requestId)` returns a request-scoped logger bound to a UUID
- Errors go to stderr, everything else to stdout
- Configurable via `LOG_LEVEL` env var (defaults: `debug` in dev, `info` in prod)
- Zero dependencies — uses only `process.stdout`/`process.stderr`

**Usage:**
```js
const logger = require('./logger');

// Top-level (no request context)
logger.info('Server started', { port: 3000 });
logger.error('DB connection failed', { error: err.message });

// Request-scoped (automatically set up by middleware)
req.log.info('Processing recipe', { recipeId: 42 });
```

### 2. Request Logging Middleware

Every HTTP request is logged after completion with:
- Method, path, status code, duration (ms)
- IP address
- Request ID (for correlation)

Status-based level mapping:
- `2xx`/`3xx` → `info`
- `4xx` → `warn`
- `5xx` → `error`

### 3. Health Check Endpoint (`GET /api/health/detailed`)

Returns comprehensive server status. No authentication required.

**Response fields:**
| Field | Description |
|-------|-------------|
| `ok` | `true` if DB is reachable, `false` otherwise |
| `uptime` | Seconds since server start |
| `uptimeFormatted` | Human-readable (e.g. "2d 5h 30m 12s") |
| `serverVersion` | Current server version |
| `database.status` | `"ok"` or `"error"` (tests with `SELECT 1`) |
| `websocket.activeConnections` | Current number of connected WS clients |
| `memory.rss` / `memory.heapUsed` | Process memory (human-readable + raw bytes) |
| `timestamp` | ISO 8601 response timestamp |

**Example response:**
```json
{
  "ok": true,
  "uptime": 3600,
  "uptimeFormatted": "1h 0m 0s",
  "serverVersion": "1.3.2",
  "database": { "status": "ok", "path": "recipes.db" },
  "websocket": { "activeConnections": 3 },
  "memory": {
    "rss": "85.2 MB",
    "heapUsed": "42.1 MB",
    "heapTotal": "60.0 MB",
    "external": "5.3 MB",
    "rssBytes": 89391104,
    "heapUsedBytes": 44158976
  },
  "timestamp": "2026-07-11T17:30:00.000Z"
}
```

### 4. Improved Global Error Handler

The Express error handler now:
- Logs full error with stack trace in **development**
- Logs sanitized error (message only, no stack) in **production**
- Includes the `requestId` in every error log entry
- Still returns generic "Internal server error" to clients for 500s

## What Changed in `index.js`

| Area | Before | After |
|------|--------|-------|
| `debugLog()` | Dev-only `console.log` wrapper | Replaced with `logger.debug()` |
| Request ID middleware | Set `req.requestId` only | Also creates `req.log` (request-scoped logger) |
| Request logging | None | Logs method, path, status, duration after every request |
| Health check | Version info only at `/api/health` | New `/api/health/detailed` with DB, WS, memory, uptime |
| Error handler | `console.error(err)` | Structured log with request ID, full stack in dev, sanitized in prod |
| Shutdown logging | `console.log`/`console.error` | All through logger |
| WS logging | `debugLog`/`console.error` | `logger.debug`/`logger.error` |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `debug` (dev) / `info` (prod) | Minimum log level: `error`, `warn`, `info`, `debug` |
| `NODE_ENV` | unset | Set to `production` for JSON output and error sanitization |

## Files Modified

- `server/logger.js` — **new** — structured logging module
- `server/index.js` — integrated logger, request logging middleware, health check, improved error handler
- `MONITORING_SETUP.md` — **new** — this file

## No New Dependencies

The logger uses only Node.js built-ins (`process.stdout`, `process.stderr`, `process.hrtime`). No `pino`, `winston`, or other logging libraries needed.
