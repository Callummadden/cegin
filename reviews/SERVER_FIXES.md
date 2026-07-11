# Server Fixes — `server/index.js`

## 1. Async image writes (`saveBase64Image`)

**Problem:** `fs.writeFileSync` blocked the event loop on every base64 image upload (recipes + cookbook).

**Fix:** Converted `saveBase64Image` to an async function using `fs.promises.writeFile`. All four caller routes were updated to `async` handlers with `await`:

| Route | Line (approx) |
|---|---|
| `POST /api/recipes` | ~526 |
| `PUT /api/recipes/:id` | ~543 |
| `POST /api/cookbook` | ~918 |
| `PUT /api/cookbook/:id` | ~937 |

## 2. WebSocket ping interval — `.unref()`

**Problem:** The 30-second dead-connection cleanup `setInterval` kept the Node process alive even after the HTTP server closed, preventing clean exits.

**Fix:** Stored the interval handle in `wsPingInterval` and called `.unref()` on it so it no longer prevents process exit.

## 3. Graceful shutdown (`SIGTERM` / `SIGINT`)

**Problem:** No shutdown handler — `SIGTERM` (Docker, systemd, Ctrl-C) would hard-kill the process without closing the database (risking WAL corruption) or draining WebSocket connections.

**Fix:** Added a `shutdown()` function registered on both `SIGTERM` and `SIGINT` that:

1. Closes the WebSocket server (`wss.close`)
2. Stops the HTTP server (`server.close`)
3. Closes the better-sqlite3 database (`dbModule.db.close`)
4. Force-exits after 5 seconds if shutdown stalls (timeout is `.unref()`'d)

## Files modified

- `server/index.js` — all three fixes above
