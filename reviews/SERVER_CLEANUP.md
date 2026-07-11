# Server Cleanup — 2026-07-11

## Changes Made

### 1. Shared `isPrivateIP` utility (`server/utils.js`)

- **Created** `server/utils.js` — exports `isPrivateIP(ip)` for SSRF protection.
- **Removed** the duplicate definition from `server/index.js` (was ~lines 890–907).
- **Removed** the duplicate definition from `server/ai.js` (was ~lines 556–573).
- Both files now `require('./utils').isPrivateIP`.
- Removed unused `const net = require('net')` from `index.js` (only needed by `isPrivateIP`).

### 2. Centralised config (`server/config.js`)

- **Created** `server/config.js` — all tuneable constants in one place.
- Extracted from `index.js`:
  - `RATE_LIMIT`, `RATE_WINDOW`, `RATE_LIMIT_CLEANUP_INTERVAL`
  - `AUTH_RATE_LIMIT`, `AUTH_RATE_WINDOW`
  - `BODY_LIMIT_SMALL` (`'1mb'`), `BODY_LIMIT_MEDIUM` (`'5mb'`), `BODY_LIMIT_LARGE` (`'20mb'`)
  - `MIN_CLIENT_VERSION`, `LATEST_CLIENT_VERSION`, `LATEST_SERVER_VERSION`
  - `IMAGE_PROXY_DEFAULT_WIDTH`, `IMAGE_PROXY_MAX_WIDTH`, `IMAGE_PROXY_FETCH_TIMEOUT`, `IMAGE_CACHE_MAX_AGE`
  - `WS_PING_INTERVAL`
  - `PORT`
- Extracted from `ai.js`:
  - `AI_REQUEST_TIMEOUT`, `AI_IMPORT_TIMEOUT`, `AI_MODEL_FETCH_TIMEOUT`, `AI_SCAN_RECIPE_TIMEOUT`
  - `AI_IMPORT_TEXT_LIMIT`, `AI_IMPORT_MAX_REDIRECTS`, `AI_IMPORT_MIN_HTML_LENGTH`

### 3. Request ID middleware

- Added early in the middleware chain (after CORS, before rate limiter).
- Generates `crypto.randomUUID()` per request; respects incoming `X-Request-Id` header.
- Sets `X-Request-Id` response header on every response.
- Attaches `req.requestId` for use in logging and error responses.

### 4. Static file routes moved after auth

- Moved `express.static` for `/api/uploads/cookbook` and `/api/uploads/terry-vision` from deep in the route definitions (~lines 883, 1032) to immediately after the auth middleware (~line 200).
- This makes the auth-gated nature of static file serving explicit and auditable.
- Directory definitions (`UPLOADS_DIR`, `TERRY_VISION_DIR`) + `mkdirSync` moved alongside them.

## Files Created

| File | Purpose |
|---|---|
| `server/utils.js` | Shared `isPrivateIP` SSRF helper |
| `server/config.js` | Centralised constants |
| `SERVER_CLEANUP.md` | This document |

## Files Modified

| File | Changes |
|---|---|
| `server/index.js` | Imports from `utils.js` + `config.js`; removed `isPrivateIP` + `net` require; added request ID middleware; replaced 15+ magic numbers; moved static routes after auth |
| `server/ai.js` | Imports from `utils.js` + `config.js`; removed local `isPrivateIP` + `net` require; replaced 7 timeout/limit constants; removed `isPrivateIP` from exports |

## Verification

- `node --check` passes for all four server JS files.
