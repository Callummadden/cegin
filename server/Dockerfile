# =============================================================================
# Cegin Server Dockerfile
# Self-hosted recipe + AI backend (Express + better-sqlite3)
# =============================================================================

FROM node:24-alpine

WORKDIR /app

# --- Dependency layer (cached unless package*.json changes) ---
# Install build deps, compile native modules, remove build deps — all in one
# layer so the 300MB+ of python3/make/g++ doesn't stick around.
COPY package*.json ./
RUN apk add --no-cache python3 make g++ tzdata \
    && npm ci --omit=dev \
    && apk del python3 make g++

# --- Application code ---
# .dockerignore keeps this layer clean (excludes node_modules, .env, db files, etc.)
COPY --chown=node:node . .

# Database lives on a Docker volume so it survives container restarts/rebuilds.
ENV DB_PATH=/data/recipes.db
# Use UK timezone so date functions match client-side dates
ENV TZ=Europe/London

# Prepare the data directory with correct ownership for the non-root user.
RUN mkdir -p /data && chown -R node:node /data

# Run as non-root user (security best practice).
USER node

# The app binds to 0.0.0.0:3000 (see index.js) so it is reachable from the host
# and from other containers / phones on the LAN.
EXPOSE 3000

CMD ["node", "index.js"]
