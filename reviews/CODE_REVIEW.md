# Cegin Code Review — v1.3.2

**Date:** 2026-07-11  
**Reviewer:** Hermes Agent (automated)  
**Scope:** `server/index.js`, `server/db.js`, `server/auth.js`, `server/ai.js`, `mobile/src/`

---

## Executive Summary

Cegin is a well-structured recipe app with a Node.js/Express + SQLite backend and a React Native/Expo mobile frontend. The codebase shows evidence of prior security hardening (SSRF protection, field whitelisting, escape clauses on LIKE, rate limiting). However, several issues remain across security, correctness, error handling, and code quality. The most critical are an **authentication bypass pattern** where invalid/missing tokens silently pass through, **user ID fallback to 0** which collapses multi-user isolation, and **unauthenticated WebSocket connections**.

---

## 🔴 Critical Issues

### 1. Auth middleware silently allows unauthenticated access
**File:** `server/auth.js:44-61`

```js
function authMiddleware(db) {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      req.user = null;
      return next(); // ← allows through
    }
    try {
      const decoded = verifyToken(header.slice(7));
      const user = db.getUserById(decoded.id);
      req.user = user || null;
      next();
    } catch (e) {
      req.user = null;
      next(); // ← invalid/expired token: silently allowed
    }
  };
}
```

**Problem:** An expired or tampered JWT does not reject the request — it silently sets `req.user = null` and continues. Combined with `req.user?.id || 0` fallbacks throughout the server, this means a stale token grants full access to user ID 0's data. There's no distinction between "no token provided" (open mode) and "bad token provided" (should be rejected).

**Recommendation:** Reject invalid tokens with 401. Only allow `req.user = null` when no Authorization header is present.

### 2. User ID fallback to 0 collapses multi-user isolation
**File:** `server/index.js` (throughout — lines 646, 652, 663, 677, 692, 702, 715, 729, etc.)

Nearly every route uses `req.user?.id || 0`. This means:
- Unauthenticated requests all share the same "user 0" data space
- If the JWT secret rotates or a token expires, the user silently falls into user 0's bucket
- All data created without auth (recipes, meal plans, shopping lists) is owned by user 0, visible to any unauthenticated caller

**Recommendation:** For authenticated routes, require `req.user` to be set and return 401 if not. Only use the `|| 0` fallback for explicitly public/open-mode endpoints.

### 3. WebSocket has no authentication
**File:** `server/index.js:1120-1158`

The WebSocket server accepts any connection without verifying identity. Any client on the network can connect to `/ws` and receive real-time change notifications for all data types. There's no per-user scoping of broadcast messages.

**Recommendation:** Require a JWT token on WS connection (via query param or first message), validate it, and scope broadcasts to the authenticated user's data.

### 4. API key exposed in Gemini model-list URL
**File:** `server/ai.js:63`

```js
url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
```

The API key is passed as a query parameter, which gets logged in server access logs, browser history, and intermediary proxies. While this is how Gemini's API works, the endpoint is publicly accessible (`/api/ai/models`) and the key is sent to the client indirectly through the response.

**Recommendation:** Cache the model list server-side (e.g., refresh hourly) rather than proxying the request with the live API key.

---

## 🟠 High-Priority Issues

### 5. Rate limiter uses in-memory Map — ineffective behind reverse proxy
**File:** `server/index.js:62-89`

The rate limiter keys on `req.ip`, but behind a reverse proxy (nginx, Cloudflare), `req.ip` will always be the proxy's IP unless `app.set('trust proxy', true)` is configured. All clients would share one rate limit bucket.

**Recommendation:** Add `app.set('trust proxy', 1)` when behind a proxy, and/or use `X-Forwarded-For` header parsing. Consider using `express-rate-limit` with a store for production.

### 6. Rate limit of 60 req/min is very generous for AI routes
**File:** `server/index.js:63`

60 requests per minute to AI endpoints means a user can rack up significant API costs in a short time. There's also no per-user rate limiting — only per-IP.

**Recommendation:** Add per-user rate limiting (keyed on `req.user?.id`) with a lower limit for AI endpoints (e.g., 10-15/min).

### 7. `setInterval` for rate limit cleanup is never cleaned up on server shutdown
**File:** `server/index.js:83-89`

While `cleanupTimer.unref()` is called (good), the WebSocket ping interval at line 1139 is not `.unref()`'d and there's no graceful shutdown handler to close the DB, WS server, or HTTP server.

**Recommendation:** Add a `process.on('SIGTERM', ...)` handler that closes the HTTP server, WebSocket server, and database cleanly.

### 8. `saveBase64Image` doesn't validate content
**File:** `server/index.js:111-116`

```js
function saveBase64Image(base64, dir) {
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, Buffer.from(base64, 'base64'));
  return filename;
}
```

No validation that the base64 content is actually an image. A malicious client could upload arbitrary binary data (or very large payloads) disguised as a "recipe image."

**Recommendation:** Validate the file magic bytes after decoding. Consider using sharp to verify it's a valid image before writing.

### 9. Image proxy SSRF — DNS rebinding vulnerability
**File:** `server/index.js:827-874`

The SSRF check resolves DNS once, then fetches. A DNS rebinding attack (where the DNS resolves to a public IP first, then a private IP for the actual request) can bypass this. Additionally, the proxy re-fetches on every request without deduplication — an attacker can cause the server to make many outbound requests.

**Recommendation:** Use a custom `fetch` agent that validates the resolved IP at connection time, or use a library like `got` with built-in SSRF protection.

### 10. `isPrivateIP` is duplicated in two files
**Files:** `server/index.js:808-825`, `server/ai.js:556-573`

The same SSRF protection function is copy-pasted in two files. This is a maintenance risk — a fix in one won't be applied to the other.

**Recommendation:** Extract to a shared utility module.

---

## 🟡 Medium-Priority Issues

### 11. No input length validation on recipe fields
**File:** `server/index.js:490-504`, `server/db.js`

Recipe `title`, `description`, `ingredients`, `steps`, etc. have no length limits. A client could send a multi-megabyte string as a recipe title. The 5MB body parser limit helps but doesn't prevent abuse of individual fields.

**Recommendation:** Add max-length validation on string fields (e.g., title ≤ 200 chars, description ≤ 2000 chars, ingredients array ≤ 100 items).

### 12. `syncMealPlan` deletes all then re-inserts
**File:** `server/db.js:503-527`

```js
const deleteOld = db.prepare('DELETE FROM meal_plans WHERE user_id = ?');
// ...
deleteOld.run(userId);
// then re-inserts everything
```

This is a destructive sync — if the insert fails partway through, data is lost. The `ON CONFLICT` upsert already exists but isn't used because of the delete-first approach.

**Recommendation:** Use the upsert without the delete, then delete any remaining rows that weren't in the new set.

### 13. Local DB search doesn't escape LIKE wildcards
**File:** `mobile/src/localDb.js:78`

```js
const q = `%${search.trim()}%`;
```

Unlike the server (which escapes `%` and `_`), the local SQLite search doesn't escape user input. Searching for `100%` would break the LIKE pattern.

**Recommendation:** Escape `%` and `_` in the search string, matching the server's approach.

### 14. `broadcast()` called after `res.json()`/`res.end()`
**File:** `server/index.js:504, 522, 533, 579, etc.`

In several routes, `broadcast()` is called *after* sending the response. While this works (it's async by nature), it means the WebSocket notification might arrive at other clients before the HTTP response reaches the originating client (race condition in multi-device scenarios).

**Recommendation:** Call `broadcast()` before sending the response, or after, but be consistent and document the intended order.

### 15. `updateRecipe` doesn't scope the WHERE clause by user_id
**File:** `server/db.js:137-161`

```js
db.prepare(`UPDATE recipes SET ... WHERE id = @id`).run({...});
```

While `getRecipe` checks ownership, the actual UPDATE statement doesn't include `AND user_id = @userId`. If the `getRecipe` check and `UPDATE` are not atomic (they aren't — two separate queries), a race condition could allow updating another user's recipe.

**Recommendation:** Add `AND user_id = @userId` to the UPDATE WHERE clause.

### 16. `deleteRecipe` inconsistency — falls through to delete all when no userId
**File:** `server/db.js:164-169`

```js
function deleteRecipe(id, userId) {
  if (userId) {
    return db.prepare('DELETE FROM recipes WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
  }
  return db.prepare('DELETE FROM recipes WHERE id = ?').run(id).changes > 0;
}
```

When `userId` is falsy (0 or null), the delete is unscoped — it will delete any recipe regardless of owner. This pattern repeats in `deleteCollection`, `getRecipe`, etc.

### 17. Missing `try/catch` in sync endpoints
**File:** `server/index.js:1022-1028`

```js
app.put('/api/shopping-list', (req, res) => {
  // ...
  res.json(dbModule.syncShoppingList(userId, items));
  broadcast('shopping_list', 'changed');
});
```

`syncShoppingList` can throw (DB errors, malformed data), but there's no error handler. The global error handler at line 1104 only catches errors forwarded via `next(e)`. An unhandled throw here will crash the request with a generic 500.

**Recommendation:** Wrap in try/catch or use express-async-errors.

### 18. Gemini vision model returns raw text, not JSON
**File:** `server/ai.js:1206-1207`

```js
const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
return text;
```

For Gemini vision, the function returns raw text. The caller `scanFridge` then tries to JSON.parse it, which works when Gemini returns JSON. But `callVisionModel` is also used by `scanRecipeImage` which calls `parseJsonSafe`. The OpenAI-compatible path returns JSON-stringified arrays while Gemini returns raw text — inconsistent contract.

### 19. `localAi.importFromUrl` sends URL as a prompt to the LLM
**File:** `mobile/src/localAi.js:272-282`

```js
export async function importFromUrl(url) {
  const instruction = `Import a recipe from this URL or description: ${url}. Return a clean JSON recipe.`;
```

The local AI import just sends the URL as text to the LLM — it doesn't actually fetch the page. This will produce hallucinated recipes since the LLM can't access URLs.

**Recommendation:** Either fetch the URL client-side (React Native fetch) and send the HTML, or disable this feature in local mode with a clear message.

---

## 🔵 Low-Priority / Code Quality

### 20. `parseJsonSafe` last-resort loop is O(n²)
**File:** `server/ai.js:26-31`

```js
for (let i = json.length; i > 0; i--) {
  if (json[i - 1] === '}' || json[i - 1] === ']') {
    try { return JSON.parse(json.slice(0, i)); } catch {}
  }
}
```

For a large malformed JSON string, this tries parsing at every `}` or `]` from the end. Each `JSON.parse` attempt is O(n), making this potentially very slow.

**Recommendation:** Use a streaming JSON parser or limit the number of attempts.

### 21. Magic numbers throughout
- `REQUEST_TIMEOUT = 8000` and `AI_REQUEST_TIMEOUT = 60000` in `api.js`
- `RATE_LIMIT = 60` in `index.js`
- `bodyParser1mb`, `bodyParser5mb`, `bodyParser20mb` body limits
- `60` recipe limit in `savedRecipesContext`
- `30000` ms WebSocket ping interval

**Recommendation:** Extract to a shared config file or environment variables.

### 22. `mobile/src/localDb.js` — sync functions that aren't async
The functions use `db.runSync()`, `db.getAllSync()`, etc. but are declared `async`. This is harmless but misleading — they'll resolve immediately but callers `await` them expecting async behavior.

### 23. Empty `catch {}` blocks
**Files:** `mobile/src/api.js` (lines 196, 225, 269, etc.), `mobile/src/localDb.js`

Many empty catch blocks silently swallow errors. While intentional for offline-first resilience, this makes debugging very difficult.

**Recommendation:** At minimum, log warnings in development mode.

### 24. `wsSync.js` — `activity_context` clears `dietCache`
**File:** `mobile/src/wsSync.js:38`

```js
activity_context: clearDietCache,
```

Activity context changes clear the dietary profiles cache instead of an activity context cache. This looks like a copy-paste error.

### 25. No request ID / correlation ID for logging
Server logs are timestamped but have no request correlation ID. In production, tracing a specific request through auth → handler → DB → AI call is difficult.

**Recommendation:** Add a middleware that generates a UUID per request and attaches it to `req` and all log calls.

### 26. `express.static` serves uploaded files without auth
**File:** `server/index.js:801, 950`

```js
app.use('/api/uploads/cookbook', express.static(UPLOADS_DIR));
app.use('/api/uploads/terry-vision', express.static(TERRY_VISION_DIR));
```

These static file routes are mounted before the auth middleware applies (express.static bypasses middleware). Anyone who knows or guesses a filename can access uploaded images.

**Recommendation:** Move these after auth middleware, or serve files through a route handler that checks auth.

### 27. Password minimum length of 6 is weak
**File:** `server/index.js:177`

A 6-character password minimum is below modern recommendations (NIST recommends 8+, many services use 12+).

### 28. No CSRF protection
The API uses Bearer tokens (not cookies), so CSRF is not directly applicable. However, if the app is ever accessed via a browser (web client), the lack of CSRF tokens and reliance on CORS alone could be insufficient.

---

## 🟢 Positives / Good Practices Observed

- **SSRF protection** on both the image proxy and URL import with DNS resolution checks and redirect following with re-validation
- **Field whitelisting** in `updateRecipe` (S2-14) prevents mass assignment
- **LIKE escape clauses** in server-side search queries
- **Foreign keys with CASCADE** enabled in SQLite
- **WAL mode** for better concurrent read performance
- **Body parser size limits** tailored per route
- **Rate limiting** on AI routes (even if imperfect)
- **Auto-generated JWT secret** with file persistence and proper permissions (0o600)
- **WebSocket dead connection cleanup** with ping/pong
- **Offline-first architecture** with pending change queue and temp ID remapping
- **CORS** properly reflects only allowed origins (not `*`)
- **Error handler middleware** at the end of the middleware stack
- **`abortSignal.timeout()`** on all external HTTP calls

---

## Summary of Recommendations (Priority Order)

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| 1 | 🔴 Critical | Auth bypass on invalid tokens | Reject bad tokens with 401 |
| 2 | 🔴 Critical | User ID 0 fallback | Require auth on protected routes |
| 3 | 🔴 Critical | Unauthenticated WebSocket | Add JWT verification on connect |
| 4 | 🔴 Critical | API key in proxy URL | Cache model list server-side |
| 5 | 🟠 High | Rate limiter behind proxy | Add `trust proxy` config |
| 6 | 🟠 High | Generous AI rate limits | Add per-user limits, lower thresholds |
| 7 | 🟠 High | No graceful shutdown | Add SIGTERM handler |
| 8 | 🟠 High | No image validation | Validate magic bytes |
| 9 | 🟠 High | DNS rebinding on proxy | Validate IP at connection time |
| 10 | 🟠 High | Duplicated `isPrivateIP` | Extract to shared module |
| 11 | 🟡 Medium | No field length limits | Add max-length validation |
| 12 | 🟡 Medium | Destructive meal plan sync | Use upsert pattern |
| 13 | 🟡 Medium | Local DB LIKE injection | Escape wildcards |
| 14 | 🟡 Medium | Race in broadcast timing | Standardize order |
| 15 | 🟡 Medium | UPDATE not user-scoped | Add user_id to WHERE |
| 16 | 🟡 Medium | Unscoped deletes | Always scope by user |
| 17 | 🟡 Medium | Missing try/catch in sync routes | Add error handling |
| 18 | 🟡 Medium | Inconsistent vision API contract | Standardize return format |
| 19 | 🟡 Medium | Local AI import hallucinates | Fetch URL client-side or disable |
| 20 | 🔵 Low | O(n²) JSON fallback | Limit attempts or use streaming parser |
| 21 | 🔵 Low | Magic numbers | Extract to config |
| 22 | 🔵 Low | Fake async functions | Remove async or use true async APIs |
| 23 | 🔵 Low | Silent error swallowing | Log in dev mode |
| 24 | 🔵 Low | Wrong cache clearer mapping | Fix wsSync mapping |
| 25 | 🔵 Low | No request IDs | Add correlation middleware |
| 26 | 🔵 Low | Static files bypass auth | Move after auth middleware |
| 27 | 🔵 Low | Weak password minimum | Increase to 8-12 chars |
| 28 | 🔵 Low | No CSRF protection | N/A for mobile; add if web client |
