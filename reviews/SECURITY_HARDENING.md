# Cegin Server — Security Hardening Summary

Last updated: 2026-07-11 (v1.3.3)

This document summarizes all security measures applied to `server/`.

---

## 1. Authentication & Authorization

### JWT Auth Middleware (`auth.js`)
- **Invalid/expired tokens return 401** — no silent pass-through.
- Missing tokens default to open mode (`req.user = null`) for self-hosted use.
- `verifyToken()` exported for WebSocket auth.
- Auto-generated JWT secret persisted to `secrets/JWT_SECRET` with `0600` perms.

### ALLOW_ANONYMOUS Env Var (`auth.js`)
- `ALLOW_ANONYMOUS=true` (default) — unauthenticated requests pass through with `req.user = null`. Backward compatible with self-hosted open mode.
- `ALLOW_ANONYMOUS=false` — all routes AND WebSocket connections require a valid JWT. Anonymous access returns 401 / closes WS with code 4001.
- Set in `.env` or `docker-compose.yml`.

### Auth Rate Limiting (`index.js`)
- `/api/auth/login` and `/api/auth/register`: **10 requests/min per IP**.
- Separate from the general AI rate limiter.
- Stale entries cleaned up every 5 minutes.

---

## 2. Input Validation

### Recipe Field Length Limits (`index.js`)
Applied on both `POST /api/recipes` and `PUT /api/recipes/:id`:

| Field         | Limit          |
|---------------|----------------|
| title         | 200 characters |
| description   | 2000 characters|
| notes         | 2000 characters|
| collection    | 100 characters |
| ingredients   | 100 array items|
| steps         | 100 array items|
| tags          | 20 array items |

Returns `400` with `{ error: "Validation failed", details: [...] }`.

### Email Format Validation (`index.js`)
- Register endpoint validates email against `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`.
- Max 254 characters (RFC 5321).
- Returns `400 { error: "Invalid email format" }`.

### Password Requirements
- Minimum 6 characters (enforced on register).

---

## 3. API Key Protection

### Gemini Model List Caching (`ai.js`)
- Model list fetched **server-side only** — API key never sent to client.
- Cached in memory for **1 hour** (`MODEL_CACHE_TTL`).
- Both text and vision model lists cached independently.
- Eliminates per-request exposure of `VISION_API_KEY` via the `/api/ai/models` endpoint.

### Secrets Management
- API keys loaded via: Docker secrets → `./secrets/` dir → env vars (in that order).
- Never logged or returned in API responses.

---

## 4. Security Headers

### Helmet Middleware (`index.js`)
- Applied globally via `helmet()`.
- Sets: `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `X-XSS-Protection`, etc.
- CSP disabled (mobile app doesn't need it).

---

## 5. Rate Limiting

### AI Routes (`index.js`)
- `/api/ai/*`: **60 requests/min per IP**.
- Applied before body parser to reject early.
- 429 response with descriptive message.

### Auth Routes (`index.js`)
- `/api/auth/*`: **10 requests/min per IP** (stricter).

---

## 6. SSRF Protection

### Image Proxy (`index.js`)
- URL scheme validated (http/https only).
- DNS resolution with private IP blocking (127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, ::1, fc/fd, fe80).
- `isPrivateIP()` extracted to shared `utils.js` module.
- 10-second timeout on upstream fetches.

---

## 7. Path Traversal Prevention

### scanId Sanitization (`index.js`)
- Terry Vision scan IDs sanitized: `.replace(/[^a-zA-Z0-9_-]/g, '')`.
- Prevents directory traversal via crafted scan IDs.

---

## 8. Database Security

### Parameterized Queries
- All SQL uses `better-sqlite3` parameterized queries (`?` and `@name` placeholders).
- No string concatenation in SQL.

### User-Scoped Queries (`db.js`)
- `getRecipe`, `updateRecipe`, `deleteRecipe`, `getCollection`, `updateCollection`, `deleteCollection` all include `AND user_id = @userId` in WHERE clause.
- Defense-in-depth against horizontal privilege escalation.

### Field Whitelisting (`db.js`)
- `updateRecipe` only accepts fields in `RECIPE_ALLOWED_FIELDS` set.
- Prevents mass assignment attacks.

### Performance Indexes (`db.js`)
- 11 indexes covering all common query patterns:
  - `idx_recipes_user_id`, `idx_recipes_user_updated`
  - `idx_recipe_images_recipe_id`, `idx_meal_plans_user_date`
  - `idx_scanned_items_user_consumed_expires`, `idx_push_tokens_user_id`
  - `idx_cookbook_entries_user_id`, `idx_chat_history_user_timestamp`
  - `idx_dietary_profiles_user_id`, `idx_terry_vision_scans_user_id`
  - `idx_shopping_list_user_id`

### WAL Mode
- `journal_mode = WAL` for concurrent reads without blocking.

---

## 9. WebSocket Security

### JWT Authentication (`index.js`)
- Token passed via query param: `/ws?token=<jwt>`.
- Invalid tokens close connection with code `4001`.
- When `ALLOW_ANONYMOUS=false`, connections without a token are also rejected.
- Dead connection cleanup every 30 seconds.

---

## 10. CORS

### Origin Whitelist (`index.js`)
- Only reflects `Origin` header if it matches `ALLOWED_ORIGINS`.
- Defaults: `http://localhost:3000`, `http://localhost:8081`, `http://localhost:19006`.
- Configurable via `ALLOWED_ORIGINS` env var (comma-separated).

---

## 11. Body Parser

### Path-Aware Limits (`index.js`)
- `/api/ai/scan-fridge`: 20 MB (photo upload).
- `/api/cookbook/*`, `POST/PUT /api/recipes`: 5 MB (base64 images).
- Everything else: 1 MB.
- Single middleware prevents stacking multiple parsers.

---

## Environment Variables Reference

| Variable           | Default                 | Description                                    |
|--------------------|-------------------------|------------------------------------------------|
| `ALLOW_ANONYMOUS`  | `true`                  | When `false`, all routes require JWT auth       |
| `ALLOWED_ORIGINS`  | `localhost:3000,8081..` | Comma-separated CORS origins                    |
| `PORT`             | `3000`                  | Server listen port                              |
| `DB_PATH`          | `/data/recipes.db`      | SQLite database path                            |
| `NODE_ENV`         | `production`            | Suppresses debug logging in production          |

---

## Files Modified

| File                | Changes                                                     |
|---------------------|-------------------------------------------------------------|
| `server/index.js`   | Field validation, email validation, ALLOW_ANONYMOUS import, WS auth |
| `server/auth.js`    | ALLOW_ANONYMOUS env var, conditional anonymous pass-through  |
| `server/ai.js`      | Model list caching (1-hour TTL), removed API key exposure    |
| `server/.env.example` | Documented ALLOW_ANONYMOUS                                 |
