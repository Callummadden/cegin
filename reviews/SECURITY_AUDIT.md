# Cegin Server — Security Audit

**Audited:** 2026-07-11  
**Scope:** `/server/` — Express API, auth, DB, AI, uploads, WebSocket, Docker  
**Auditor:** Hermes Agent (automated code review)

---

## Executive Summary

The Cegin server is **well-engineered for a self-hosted project**. It already addresses many common web security pitfalls — parameterized SQL queries, field whitelisting, SSRF protection on the image proxy, Docker Compose secrets for API keys, non-root container user, and CORS origin reflection instead of wildcard. The findings below range from **low-severity nits to a few medium-severity issues** worth addressing before exposing the server beyond a trusted LAN.

| Severity | Count | Summary |
|----------|-------|---------|
| 🔴 High | 1 | Auth middleware silently allows unauthenticated access to all routes |
| 🟡 Medium | 4 | WebSocket no auth, user_id=0 fallback, model change endpoint, in-memory rate limiter |
| 🟢 Low | 5 | No email validation, 30-day JWT expiry, no CSRF, no Helmet, path traversal in uploads |
| ✅ Good | 10 | SQL injection safe, SSRF blocked, secrets management, field whitelist, bcrypt cost, etc. |

---

## 🔴 High Findings

### H-1: Auth middleware silently allows unauthenticated requests through

**File:** `auth.js:44–61`  
**Impact:** Any request without a valid Bearer token gets `req.user = null` and continues to the handler. There is no route that *requires* authentication — every route gracefully falls back to `user_id = 0` (the "anonymous" user).

This means:
- A network attacker (or anyone who can reach the server) can create/read/update/delete recipes, collections, meal plans, shopping lists, etc. as the `user_id=0` anonymous user.
- If the server is exposed beyond LAN, all data belonging to `user_id=0` is fully public.
- The `/api/ai/model` endpoint (see M-3) is completely unprotected — anyone can change the AI model.

**Evidence:**
```js
// auth.js:46-49
if (!header?.startsWith('Bearer ')) {
  req.user = null;
  return next(); // ← allows through
}
```

**Recommendation:**
- Add a `requireAuth` middleware that returns 401 when `req.user` is null.
- Apply it to all routes that modify state (POST/PUT/DELETE), or make auth mandatory globally and only exempt `/api/health` and `/api/auth/*`.
- At minimum, protect `/api/ai/model` and all write endpoints.

---

## 🟡 Medium Findings

### M-1: WebSocket has no authentication

**File:** `index.js:1120–1136`  
**Impact:** The `/ws` endpoint accepts any connection without verifying a JWT or any credential. Any client on the network can connect and receive real-time change broadcasts (recipe/collection/shopping-list change notifications).

While the data payload is minimal (just event type + action), it leaks information about when other users are making changes.

**Recommendation:**
- Require a JWT token as the first message or as a query parameter (`/ws?token=...`).
- Verify it with `verifyToken()` before accepting the connection.

### M-2: `user_id = 0` fallback creates a shared anonymous data bucket

**Files:** `index.js:646, 652, 660, 663, 677, 692, 702, 715, 729, 739, 749, 756, 766, ...` (many routes)  
**Impact:** When `req.user` is null, all these routes use `req.user?.id || 0`. This means all unauthenticated users share a single `user_id=0` data pool — they can see and overwrite each other's data.

**Recommendation:**
- See H-1: enforce authentication on write endpoints.
- If anonymous access is intentional for LAN-only use, document this clearly and consider making it opt-in via an env var (`ALLOW_ANONYMOUS=false`).

### M-3: AI model change endpoint is unprotected and has no validation

**File:** `index.js:227–236`  
**Impact:** `POST /api/ai/model` accepts any `model` string from the request body and calls `setTextModel(model)` / `setVisionModel(model)`. This:
1. Is reachable without auth (see H-1).
2. Sets the model name to an arbitrary string — no allowlist or validation.
3. Could be used to point the server at a different model (or a malicious endpoint if combined with provider URL changes, though `TEXT_BASE_URL` is env-only).

**Recommendation:**
- Require admin auth for this endpoint.
- Add model validation (allowlist or at minimum a regex check).
- Consider making this admin-only with a separate role/token.

### M-4: Rate limiter is in-memory (not shared across instances)

**File:** `index.js:62–80`  
**Impact:** The rate limiter uses a `Map()` in process memory. If the server is scaled to multiple containers (not currently the case, but worth noting), each instance has its own counter. Also, a server restart resets all counters.

For the current single-container self-hosted setup this is acceptable, but:
- The `RATE_LIMIT = 60` per minute on `/api/ai` is reasonable.
- No rate limiting exists on auth endpoints (`/api/auth/login`, `/api/auth/register`), enabling brute-force password attacks.

**Recommendation:**
- Add rate limiting to `/api/auth/login` and `/api/auth/register` (e.g., 5 attempts/min per IP).
- If multi-instance deployment is ever needed, switch to Redis-backed rate limiting.

---

## 🟢 Low Findings

### L-1: No email format validation on registration

**File:** `index.js:173–184`  
**Impact:** The register endpoint checks `typeof email === 'string'` and lowercases it, but doesn't validate email format. A user could register with `email: "not-an-email"`.

**Recommendation:** Add a basic regex or use a lightweight validator before `createUser()`.

### L-2: JWT tokens expire in 30 days with no revocation mechanism

**File:** `auth.js:25`  
**Impact:** `JWT_EXPIRES = '30d'` — if a token is compromised, it remains valid for 30 days. There's no token blacklist, refresh token rotation, or forced logout mechanism.

**Recommendation:**
- Reduce expiry to 7 days for better security/usability balance.
- Add a `/api/auth/logout` endpoint that could maintain a token blacklist (even a simple in-memory set for single-instance).

### L-3: No CSRF protection

**Impact:** The server uses `Authorization: Bearer` header for auth (not cookies), so CSRF is not a direct risk for the API. However, the CORS middleware reflects any origin in `ALLOWED_ORIGINS`. If the list includes `localhost` origins (default), a malicious local page could make authenticated requests.

**Risk:** Low — Bearer tokens in headers are not automatically sent by browsers.

### L-4: No security headers (Helmet.js)

**Impact:** No `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `Content-Security-Policy`, or `X-XSS-Protection` headers are set.

**Recommendation:** Add `helmet` middleware:
```js
const helmet = require('helmet');
app.use(helmet());
```

### L-5: Potential path traversal in upload filenames

**File:** `index.js:111–116` (`saveBase64Image`)  
**Impact:** The filename is generated server-side using `Date.now()` + random string, so path traversal via filename is not possible. However, the `dir` parameter is trusted from the caller. This is safe in current usage but worth noting.

**Also:** `index.js:974` — Terry Vision scan filename uses `scanId` from the request body (`req.body.id`):
```js
const scanId = id || `tv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const filename = `${scanId}.jpg`;
fs.writeFileSync(path.join(TERRY_VISION_DIR, filename), ...);
```
If `req.body.id` contains `../../etc/something`, this is a path traversal vulnerability.

**Recommendation:** Sanitize `scanId` by stripping non-alphanumeric characters:
```js
const scanId = (id || `tv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
  .replace(/[^a-zA-Z0-9_-]/g, '');
```

---

## ✅ What's Done Well

### SQL Injection — **No vulnerabilities found**

All database queries use `better-sqlite3` parameterized queries (`@param` or `?` placeholders). The LIKE clauses properly escape `%` and `_` with `ESCAPE '\\'`. No string concatenation in SQL.

**Files checked:** `db.js` (all 50+ queries)

### SSRF Protection on Image Proxy — **Solid**

**File:** `index.js:808–874`

The `/api/image-proxy` endpoint:
- Validates URL scheme (http/https only)
- Resolves DNS and blocks private IPs (127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, IPv6 loopback/link-local/ULA)
- Has a 10-second timeout via AbortController
- Caches responses to avoid re-fetching

### Secrets Management — **Well designed**

**File:** `secrets.js`

Three-tier priority: Docker Compose secrets → local `./secrets/` dir → env vars. The `.dockerignore` correctly excludes `.env`, `secrets/`, and `*.key`/`*.pem` files from the image.

### Field Whitelisting on Update — **Good**

**File:** `db.js:62–66` (`RECIPE_ALLOWED_FIELDS`)

`updateRecipe()` strips any fields not in the whitelist, preventing mass-assignment attacks.

### Docker Security — **Good**

- Runs as non-root user (`USER node`)
- Resource limits (512M memory, 1 CPU)
- Healthcheck configured
- Build deps removed in same layer
- `.dockerignore` excludes secrets and sensitive files

### Body Size Limits — **Path-aware**

Different routes get appropriate body limits (1MB default, 5MB for recipes/cookbook, 20MB for scan-fridge). This prevents large-body DoS.

### Password Hashing — **Appropriate**

bcrypt with cost factor 10 (`bcrypt.hash(password, 10)`).

### CORS — **Origin reflection, not wildcard**

Only origins in `ALLOWED_ORIGINS` env var get reflected. Default is localhost-only.

### Error Handler — **Sanitized**

The Express error handler (line 1104) returns generic "Internal server error" for 500s, only forwarding custom messages for known error statuses.

### WebSocket Stale Connection Cleanup — **Present**

Dead connections are terminated every 30 seconds via ping/pong.

---

## Recommendations Summary (Priority Order)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 1 | Add `requireAuth` middleware for write endpoints | Low | Blocks anonymous data access |
| 2 | Sanitize `scanId` in Terry Vision upload | Trivial | Prevents path traversal |
| 3 | Add rate limiting to auth endpoints | Low | Prevents brute-force |
| 4 | Add JWT auth to WebSocket | Medium | Prevents unauthorized event listening |
| 5 | Add `helmet` middleware | Trivial | Adds security headers |
| 6 | Validate email format on register | Trivial | Data quality |
| 7 | Add model allowlist or admin-only gate | Low | Prevents model tampering |
| 8 | Reduce JWT expiry, add logout | Medium | Limits compromised token window |
| 9 | Document anonymous access model | Low | User awareness |
| 10 | Consider `ALLOW_ANONYMOUS` env toggle | Low | Explicit opt-in |

---

## Files Audited

| File | Lines | Status |
|------|-------|--------|
| `index.js` | 1158 | 3 findings (H-1, M-3, L-5) |
| `auth.js` | 79 | 2 findings (H-1, L-2) |
| `db.js` | 1054 | ✅ No SQL injection found |
| `ai.js` | 1292 | ✅ API keys handled via secrets.js |
| `secrets.js` | 54 | ✅ Well designed |
| `notifications.js` | 173 | ✅ Clean |
| `cron.js` | 118 | ✅ Clean |
| `package.json` | 23 | ✅ Dependencies current |
| `Dockerfile` | 42 | ✅ Non-root, minimal |
| `docker-compose.yml` | 70 | ✅ Secrets, resource limits |
| `.dockerignore` | 38 | ✅ Excludes sensitive files |
| `.env.example` | 61 | ✅ No real secrets |
