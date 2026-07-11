# Final Code Review — Cegin Project

**Reviewed:** 2026-07-11
**Scope:** `server/` and `mobile/src/`
**Reviewer:** Automated code review (Hermes Agent)

---

## 1. Verification of Previous Fixes

### ✅ Auth Middleware (`server/auth.js`, `server/index.js:186-200`)
- **Status:** Properly applied.
- `authMiddleware(dbModule)` is applied to all `/api` routes via `app.use('/api', ...)`.
- Exemptions correctly cover: `/api/auth/*`, `/api/health`, `/api/ai/status` (plus `/health`, `/ai/status` inside mount).
- Token verification uses `verifyToken()` and fetches full user from DB via `getUserById(decoded.id)`.
- Returns 401 for: missing token (when `ALLOW_ANONYMOUS=false`), invalid/expired token, deleted user.
- `ALLOW_ANONYMOUS` defaults to `'true'` for backward compat, configurable via env var.

### ✅ Database Indexes (`server/db.js:49-61`)
- **Status:** Properly applied.
- 11 performance indexes created on all tables with `user_id` columns:
  - `idx_recipes_user_id`, `idx_recipes_user_updated` (composite)
  - `idx_recipe_images_recipe_id`
  - `idx_meal_plans_user_date` (composite)
  - `idx_scanned_items_user_consumed_expires` (composite)
  - `idx_push_tokens_user_id`, `idx_cookbook_entries_user_id`
  - `idx_chat_history_user_timestamp` (composite)
  - `idx_dietary_profiles_user_id`, `idx_terry_vision_scans_user_id`
  - `idx_shopping_list_user_id`
- All use `CREATE INDEX IF NOT EXISTS` — idempotent and safe.

### ✅ Helmet Security Headers (`server/index.js:47-50`)
- **Status:** Properly applied.
- `helmet()` is the first middleware after app creation.
- Sensible config for a mobile backend: `contentSecurityPolicy: false`, `crossOriginEmbedderPolicy: false`.
- `helmet@^8.2.0` in `package.json`.

### ✅ WebSocket Auth (`server/index.js:1187-1204`)
- **Status:** Server-side properly implemented.
- JWT extracted from query param `/ws?token=<jwt>`.
- Token verified via `verifyToken(token)`.
- Invalid token → `ws.close(4001, 'Invalid token')`.
- Missing token when `!ALLOW_ANONYMOUS` → `ws.close(4001, 'Authentication required')`.
- `ws.userId` set for downstream use.

### ⚠️ WebSocket Client Auth (`mobile/src/wsSync.js:84-104`)
- **Status:** ISSUE — Token NOT passed by the mobile client.
- Line 87: `const wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws';` — no `?token=` appended.
- The auth token is available in AsyncStorage (`cegin_auth_token`) — used by `api.js:32` for HTTP requests — but `wsSync.js` never reads it.
- **Impact:** When `ALLOW_ANONYMOUS=false`, ALL WebSocket connections from the mobile app will be rejected with `4001`. Real-time sync will silently fail.
- **Fix required:** Read token from AsyncStorage and append to WS URL:
  ```js
  const token = await AsyncStorage.getItem('cegin_auth_token').catch(() => null);
  const wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws' + (token ? `?token=${token}` : '');
  ```

### ✅ scanId Sanitization (`server/index.js:1033-1034`)
- **Status:** Properly applied.
- ```js
  const scanId = (id || `tv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
    .replace(/[^a-zA-Z0-9_-]/g, '');
  ```
- Strips all non-alphanumeric characters except `_` and `-`, preventing path traversal.

---

## 2. New Module Verification

### ✅ `server/config.js`
- **Status:** Properly imported and used.
- Contains all tuneable constants: rate limits, body parser limits, image proxy settings, WS ping interval, AI timeouts, version matrix.
- Imported in: `index.js` (line 36), `ai.js` (line 6).
- No hardcoded magic numbers remain in the importing files (they use `config.*`).

### ✅ `server/utils.js`
- **Status:** Properly imported and used.
- Exports `isPrivateIP()` — checks both IPv4 and IPv6 private/reserved ranges.
- Imported in: `index.js` (line 35), `ai.js` (line 29).
- Used for SSRF protection in: image proxy (`index.js:904`), recipe import (`ai.js:556, 589`).

### ✅ `server/prompts.js`
- **Status:** Properly imported and used.
- Exports all 17 AI prompt strings.
- Imported in: `ai.js` (lines 7-25).
- All prompt strings are cleanly centralized; `ai.js` contains only logic, no inline prompts.

### ✅ `server/secrets.js`
- Clean 3-tier secret loading: Docker secrets → local `./secrets/` dir → env vars.
- `readConfig()` for non-sensitive values, `readSecret()` for API keys.
- Properly imported in `auth.js` and `ai.js`.

### ✅ `server/notifications.js` and `server/cron.js`
- Notification engine: Expo Push API integration with `sendPush()`, `sendMorningDigest()`, `sendPerishableAlert()`.
- Cron scheduler: morning digest (8 AM), perishable alerts (8am/2pm/8pm).
- Properly integrated in `index.js` — `startCron()` called on server start.

---

## 3. Issues Found

### 🔴 Critical: WebSocket Client Missing Auth Token
- **File:** `mobile/src/wsSync.js:87`
- **Issue:** WS connection URL doesn't include the JWT token. Server requires it when `ALLOW_ANONYMOUS=false`.
- **Impact:** Real-time sync breaks entirely for authenticated deployments.
- **Fix:** Add token to WS URL (see section 1 above).

### 🟡 Medium: Missing Database Indexes on Two Tables
- **File:** `server/db.js`
- **Issue:** `favorites` table and `activity_context` table have `user_id` columns but no index.
- `favorites` has a composite PK `(user_id, recipe_id)` which already indexes `user_id`, so this is actually OK.
- `activity_context` has `user_id` as `PRIMARY KEY`, so also OK.
- **Status:** False alarm — both tables are covered by their primary key structure. ✅

### 🟡 Medium: Rate Limiter Off-By-One
- **File:** `server/index.js:89-92`
- **Issue:** The check `if (entry.count >= RATE_LIMIT)` runs BEFORE `entry.count++`, so a client can make `RATE_LIMIT` (60) requests, then get blocked on request 61. This is actually correct behavior (allows exactly 60, blocks the 61st). No issue here.
- **Status:** Correct. ✅

### 🟡 Medium: Broadcast Events Not User-Scoped
- **File:** `server/index.js:1234-1242`
- **Issue:** `broadcast()` sends to ALL connected clients regardless of user. When one user creates a recipe, all other connected users get the notification and may refresh unnecessarily.
- **Impact:** Minor — no data leak (the notification only says "recipes changed", not the content), but causes unnecessary re-fetches for other users.
- **Suggestion:** Tag broadcasts with `userId` and filter on the client or server side.

### 🟢 Low: Unused Import
- **File:** `server/index.js:33`
- **Issue:** `const crypto = require('crypto');` is imported and used for `crypto.randomUUID()` in the request ID middleware and `crypto.createHash('md5')` in the image proxy. Actually used. ✅

### 🟢 Low: Static File Serving After Auth Middleware
- **File:** `server/index.js:205-209`
- **Status:** Correctly ordered — `express.static()` for `/api/uploads/cookbook` and `/api/uploads/terry-vision` is placed AFTER the auth middleware on line 187. This means static file access requires authentication. ✅

---

## 4. Consistency Checks

### ✅ License Headers
- All server files have `SPDX-License-Identifier: GPL-3.0-or-later` header.
- All mobile files have the same header.

### ✅ User Scoping (S2-7)
- All DB functions that access user data accept and use `userId` parameter.
- All route handlers pass `req.user?.id` to DB functions.
- Consistent pattern: `req.user?.id || 0` for backward compat with anonymous mode.

### ✅ Field Whitelist (S2-14)
- `RECIPE_ALLOWED_FIELDS` in `db.js` restricts which fields `updateRecipe` will accept.
- Prevents mass-assignment attacks via recipe update endpoints.

### ✅ Input Validation
- Field length limits defined in `FIELD_LIMITS` (title: 200, description: 2000, etc.).
- Email validation with regex + length check (254 chars max).
- Password minimum 6 characters.
- Recipe ID parsing with `parseId()` returns `null` for non-numeric input.

### ✅ Error Handling
- Express error handler middleware at `index.js:1166-1171` (last middleware).
- All AI route handlers have try/catch with proper status codes.
- AI functions return structured error responses (status 503 for unconfigured, 502 for API failures).

### ✅ Graceful Shutdown (`server/index.js:1244-1273`)
- Handles both `SIGTERM` and `SIGINT`.
- Closes WebSocket server, HTTP server, and database.
- Force-exit after 5s timeout.

### ✅ DB Pragmas
- `journal_mode = WAL` — write-ahead logging for better concurrency.
- `foreign_keys = ON` — cascade deletes on `recipe_images`.

### ✅ CORS (`server/index.js:52-67`)
- Origin-reflecting CORS (not wildcard `*`).
- Only reflects origins in `ALLOWED_ORIGINS` list.
- Configurable via env var.

---

## 5. Mobile Code Quality

### ✅ Error Boundary (`mobile/src/components/ErrorBoundary.js`)
- Class component with `getDerivedStateFromError` and `componentDidCatch`.
- Shows user-friendly error UI with retry button.
- Uses theme colors for consistent styling.

### ✅ Accessibility Labels
- 50+ `accessibilityLabel` props across key screens:
  - `BottomNav.js`, `EditRecipeScreen.js`, `MealPlannerScreen.js`, `ShoppingListScreen.js`, `CookbookScreen.js`, `CookModeScreen.js`

### ✅ Offline Support (`mobile/src/api.js`)
- Multi-tier cache: AsyncStorage cache → localDb → server.
- Pending change queue for offline creates/updates/deletes.
- Temp ID remapping when offline-created recipes sync to server.
- Background refresh pattern for recipe lists.

### ✅ WebSocket Sync (`mobile/src/wsSync.js`)
- Exponential backoff reconnection (1s → 30s cap).
- App state listener: reconnects on foreground.
- Ping/pong keepalive with 15s intervals.
- Debounced notifications (150ms) to avoid rapid-fire updates.
- **Except:** Missing auth token in WS URL (see critical issue above).

---

## 6. Summary

| Category | Status |
|---|---|
| Auth middleware | ✅ Properly applied |
| DB indexes | ✅ 11 indexes on all user_id columns |
| Helmet | ✅ Applied with sensible config |
| WS auth (server) | ✅ JWT verification, close on failure |
| WS auth (client) | 🔴 Token NOT passed — breaks authenticated WS |
| scanId sanitization | ✅ Path traversal prevented |
| config.js module | ✅ Imported in index.js and ai.js |
| utils.js module | ✅ Imported in index.js and ai.js |
| prompts.js module | ✅ Imported in ai.js |
| User scoping | ✅ All routes pass userId |
| Field validation | ✅ Length limits, type checks, email validation |
| Error handling | ✅ Global error handler, per-route try/catch |
| Graceful shutdown | ✅ SIGTERM/SIGINT handling |
| CORS | ✅ Origin-reflecting, configurable |
| Mobile offline | ✅ Multi-tier cache, pending changes |
| Accessibility | ✅ Labels on interactive elements |
| Error boundaries | ✅ Class component with retry |

### Action Items

1. **🔴 Critical — Fix WS auth in mobile client** (`wsSync.js:87`): Read JWT from AsyncStorage and append as query param to WS URL.
2. **🟢 Optional — User-scoped broadcasts**: Filter WS broadcast events by userId to avoid unnecessary re-fetches across users.
