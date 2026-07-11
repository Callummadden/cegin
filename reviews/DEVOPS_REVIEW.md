# Cegin Server — DevOps & Deployment Review

**Date:** 2026-07-11
**Version:** 1.3.2
**Stack:** Express 5 + better-sqlite3 + sharp + WebSocket (Node 24 Alpine)

---

## 1. Dockerfile ✅ Solid

**What's good:**
- `node:24-alpine` — minimal base image
- Build deps (`python3`, `make`, `g++`) installed and removed in the **same `RUN` layer** — prevents 300MB+ leaking into final image
- `COPY --chown=node:node . .` — avoids the classic EACCES crash loop with non-root `USER node`
- `ENV DB_PATH=/data/recipes.db` + `mkdir -p /data && chown` — clear data volume target
- `ENV TZ=Europe/London` — consistent date handling with client
- Health check uses `127.0.0.1` (not `localhost`) to avoid Alpine's IPv6 resolution issue
- `EXPOSE 3000` + `CMD ["node", "index.js"]` — clean, no shell wrapper

**Recommendations:**
- **Pin the Node version more tightly.** `node:24-alpine` floats on patch/minor. Use `node:24.2.0-alpine3.21` (or whatever the current version is) for reproducible builds, then bump explicitly.
- **Add `NODE_ENV=production`** as an explicit `ENV`. Currently set only if the user puts it in `.env`. The `debugLog()` guard already checks it, so production builds should always have it.
- **Consider `npm ci --ignore-scripts`** if no native modules need postinstall scripts (better-sqlite3 and sharp do, so this may not apply — verify).

---

## 2. docker-compose.yml ✅ Well-Structured

**What's good:**
- Docker Compose file-based secrets (`secrets:`) for `TEXT_API_KEY`, `VISION_API_KEY`, `JWT_SECRET` — never visible via `docker inspect` or `docker exec env`
- `env_file: .env` for non-secret config (provider, model, base URL)
- Resource limits: `memory: 512M`, `cpus: "1.0"` — prevents runaway AI requests from eating the VPS
- `restart: unless-stopped` — survives host reboots
- Named volume `cegin-data:/data` — SQLite persists across rebuilds
- Healthcheck mirrors Dockerfile config (consistent)

**Recommendations:**
- **Add logging configuration** to limit log growth on a VPS:
  ```yaml
  logging:
    driver: json-file
    options:
      max-size: "10m"
      max-file: "3"
  ```
- **Document the backup command** in the compose file comments (already partially there, but a `docker run --rm -v cegin-data:/data ...` one-liner would help).
- **Consider adding `GOOGLE_CLIENT_SECRET`** to the secrets block if Google OAuth is in use (referenced in `docker-patterns.md` but not in compose).

---

## 3. .dockerignore ✅ Comprehensive

Covers all the important exclusions:
- `node_modules/`, `.env`, `.env.*`, `secrets/`, `*.pem`, `*.key`
- Database files (`recipes.db*`, `*.sqlite*`)
- Logs, git, editor files, OS files
- Docker files themselves (Dockerfile, docker-compose.yml)

**No issues found.**

---

## 4. Build Process ⚠️ Manual

**Current workflow** (from skill):
```bash
docker build -t callum2254/cegin:latest -t callum2254/cegin:X.Y.Z .
docker push callum2254/cegin:latest
docker push callum2254/cegin:X.Y.Z
```

**Issues:**
- **No CI/CD pipeline.** No GitHub Actions, no automated builds. Everything is manual.
- **No automated testing before push.** The `npm test` script exists but isn't run in a pipeline.
- **Dual-tagging** (`latest` + version) is good practice — keep this.

**Recommendation — GitHub Actions for Docker:**
```yaml
# .github/workflows/docker.yml
name: Docker Build & Push
on:
  push:
    tags: ['v*']
    paths: ['server/**']
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          context: ./server
          push: true
          tags: |
            callum2254/cegin:latest
            callum2254/cegin:${{ github.ref_name }}
```

---

## 5. Environment Variable Handling ✅ Excellent

**Architecture:**
- `secrets.js` implements a 3-tier fallback: `/run/secrets/` → `./secrets/` → `process.env`
- `.env.example` is well-documented with provider options and clear "DO NOT PUT SECRETS HERE" warnings
- `auth.js` auto-generates `JWT_SECRET` if none is provided (and persists to `secrets/JWT_SECRET`)
- Non-secret config (provider, model, base URL) lives in `.env`; secrets in `secrets/` directory

**One concern:**
- `env_file: .env` in compose means if someone accidentally puts API keys in `.env`, they leak into the container's environment. The `.env.example` warns against this, but there's no runtime check. Consider adding a startup warning in `index.js`:
  ```js
  if (process.env.TEXT_API_KEY || process.env.VISION_API_KEY) {
    console.warn('[security] API keys found in environment — prefer Docker secrets');
  }
  ```

---

## 6. Health Checks ✅ Good

- **Dockerfile:** `HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3`
- **docker-compose.yml:** Same config (redundant but harmless — compose overrides Dockerfile)
- **Endpoint:** `GET /api/health` returns `{ ok, serverVersion, latestServerVersion, minClientVersion, latestClientVersion }`
- Version info enables client-side update prompts — nice touch

**No issues.** The health check is well-configured.

---

## 7. Logging ⚠️ Basic

**Current state:**
- `console.log()` for normal operations
- `console.error()` for errors
- `debugLog()` suppresses debug output when `NODE_ENV=production`
- Cron and notification modules log with `[cron]` and `[expo-push]` prefixes

**Issues:**
- **No structured logging.** JSON logs would be easier to parse with tools like `docker logs` + `jq` or any log aggregator.
- **No log rotation** at the Docker level (see compose recommendation above).
- **No request logging.** No morgan/winston/pino — you can't see which endpoints are being hit, response times, or status code distributions.

**Recommendation — add pino (lightweight):**
```bash
npm i pino pino-http
```
```js
const pino = require('pino');
const pinoHttp = require('pino-http');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
app.use(pinoHttp({ logger }));
```

---

## 8. Monitoring ❌ None

**Current state:**
- Health check endpoint exists (`/api/health`)
- No Prometheus metrics, no uptime monitoring, no alerting

**Recommendations:**
- **External uptime monitoring:** Use a free service (UptimeRobot, Better Stack) to ping `/api/health` every 5 minutes and alert on failure.
- **Docker stats:** `docker stats cegin-server` for ad-hoc resource monitoring.
- **Optional:** Add `/api/metrics` endpoint with `prom-client` if you want Prometheus/Grafana later.

---

## 9. CI/CD ❌ No Pipeline

**Current state:**
- No `.github/workflows/` directory
- All builds, tests, and Docker pushes are manual
- APK builds are manual (`expo prebuild` + Gradle)
- Docker Hub push is manual

**This is the biggest gap.** For a solo project it's acceptable, but:
- Builds aren't reproducible (no pinned base image)
- No automated testing gate before deploy
- Easy to forget a step (version bump, changelog, etc.)

---

## 10. npm Scripts ⚠️ Minimal

```json
{
  "start": "node index.js",
  "test": "node --check index.js && node -e 'require(\"./db\"); require(\"./auth\"); require(\"./ai\"); ...'",
  "test:full": "npm test && echo 'Run with server up for endpoint tests: curl ...'"
}
```

**Issues:**
- `test` is a syntax check + module load smoke test only — no actual test suite
- `test:full` is misleading — it just runs `npm test` then prints a message about curl
- **No `lint` script** (no ESLint configured)
- **No `dev` script** with auto-restart (e.g., `nodemon` or `node --watch`)

**Recommendations:**
```json
{
  "dev": "node --watch index.js",
  "lint": "eslint .",
  "test": "node --check index.js && node -e 'require(\"./db\"); require(\"./auth\"); require(\"./ai\"); console.log(\"✓ Modules OK\")'"
}
```
Node 22+ has built-in `--watch`, so no nodemon needed.

---

## 11. Security Review ✅ Strong

**What's good:**
- SSRF protection on `/api/image-proxy` — DNS resolution + private IP blocking (IPv4 and IPv6)
- Rate limiting on `/api/ai/*` routes (60 req/min per IP) with stale entry cleanup
- CORS properly configured with explicit origin allowlist (no wildcard reflection)
- JWT auth with 30-day expiry, bcrypt password hashing (cost 10)
- Non-root Docker user
- Body parser limits: 1MB default, 5MB for recipes/cookbook, 20MB for scan-fridge
- Secrets never in image layers (Docker Compose secrets)
- Auth middleware gracefully handles missing/invalid tokens (open mode for self-hosted)

**Minor concerns:**
- Rate limiter uses an in-memory `Map` — resets on container restart (fine for single-instance, won't scale)
- `ALLOWED_ORIGINS` defaults include `localhost` ports — fine for dev, should be overridden in production `.env`
- No CSRF protection (not needed for API-only with Bearer tokens)
- No request ID for tracing (helpful for debugging multi-device sync issues)

---

## 12. WebSocket ✅ Good

- Ping/pong keepalive every 30 seconds
- Dead connection cleanup (terminates stale clients)
- Broadcast function for real-time sync across devices
- Error handling on connection

**No issues.**

---

## 13. Cron Jobs ✅ Good

- Morning digest at 8:00 AM
- Perishable alerts at 8am, 2pm, 8pm
- Deduplication via date/hour bucket tracking
- Runs inside the Express process (no separate scheduler needed)
- Error handling with try/catch

**Minor:** If the container restarts during a window, the job re-runs on startup (`runMorningDigest().catch()` on `startCron`). This is correct behavior.

---

## Summary of Recommendations (Priority Order)

| Priority | Item | Effort |
|----------|------|--------|
| 🔴 High | Add GitHub Actions for Docker build + push | 1 hour |
| 🔴 High | Pin Node base image version | 5 min |
| 🟡 Medium | Add `NODE_ENV=production` to Dockerfile | 2 min |
| 🟡 Medium | Add log rotation to docker-compose.yml | 5 min |
| 🟡 Medium | Add request logging (pino-http) | 30 min |
| 🟡 Medium | Add external uptime monitoring | 15 min |
| 🟢 Low | Add ESLint + `lint` script | 30 min |
| 🟢 Low | Add `dev` script with `node --watch` | 2 min |
| 🟢 Low | Structured JSON logging | 1 hour |
| 🟢 Low | Startup warning if secrets in env vars | 5 min |

---

## Overall Assessment

**The deployment setup is above average for a self-hosted solo project.** The Dockerfile follows best practices (single-layer build deps, non-root user, health check). The secrets management via Docker Compose secrets with a 3-tier fallback is thoughtful. The `.dockerignore` is comprehensive.

The main gaps are the lack of CI/CD (everything is manual) and basic monitoring/logging. For a self-hosted recipe app these are acceptable trade-offs, but adding GitHub Actions would be the single highest-impact improvement — it automates the build, runs the smoke test, and prevents shipping a broken image.
