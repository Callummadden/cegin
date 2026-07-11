# CI/CD Setup — Cegin

## Workflows

### 1. `ci.yml` — Continuous Integration
**Triggers:** push to `main`, PRs targeting `main`

| Job | What it does |
|-----|-------------|
| `server-test` | Installs server deps (`npm ci`), runs `npm test` (syntax check + core module load), runs unit tests |
| `syntax-check` | Runs `node --check` on every `.js` file in both `server/` and `mobile/` |

**Caching:** Uses `actions/setup-node` cache backed by `server/package-lock.json`.

---

### 2. `docker.yml` — Docker Build & Push
**Triggers:** tag push matching `v*` (e.g. `v1.3.2`)

| Step | Details |
|------|---------|
| Build | Builds `server/Dockerfile` using Docker Buildx |
| Push | Pushes to `callum2254/cegin` on Docker Hub |
| Tags | `1.3.2`, `1.3`, `abc1234` (semver + short SHA) |
| Cache | GitHub Actions cache (`type=gha`) for Docker layers |

**Required secrets:**
- `DOCKERHUB_USERNAME` — Docker Hub username
- `DOCKERHUB_TOKEN` — Docker Hub access token

---

### 3. `mobile.yml` — Mobile Build Verification
**Triggers:** tag push matching `v*`

| Step | Details |
|------|---------|
| Install | `npm ci` in `mobile/` |
| expo-doctor | Runs `npx expo-doctor` to validate Expo SDK compatibility |
| Build verify | Runs `npx expo export --platform web` to verify bundling succeeds |

**Caching:** Uses `actions/setup-node` cache backed by `mobile/package-lock.json`.

---

## Tagging & Release Flow

```
git tag v1.4.0
git push origin v1.4.0
```

This triggers:
1. **docker.yml** → builds & pushes `callum2254/cegin:1.4.0` to Docker Hub
2. **mobile.yml** → runs expo-doctor and verifies the mobile app bundles

## Adding Secrets

Go to **GitHub → Settings → Secrets and variables → Actions** and add:
- `DOCKERHUB_USERNAME` — your Docker Hub username (`callum2254`)
- `DOCKERHUB_TOKEN` — a Docker Hub access token (not your password)

## Files Created

```
.github/
  workflows/
    ci.yml          # CI: syntax + tests on push/PR
    docker.yml      # Docker build+push on tag
    mobile.yml      # Mobile verification on tag
CICD_SETUP.md       # This file
```
