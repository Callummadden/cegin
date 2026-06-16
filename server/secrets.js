// =============================================================================
// Secret loading with Docker Compose secrets support.
//
// Priority order:
//   1. /run/secrets/<name>  (Docker Compose file-based secrets)
//   2. ./secrets/<name>     (local secrets directory for non-Docker setups)
//   3. env vars             (fallback — still works for quick dev/testing)
//
// This keeps the app working everywhere: Docker, bare metal, local dev.
// Docker secrets are the most secure — they're never visible via
// `docker inspect`, `docker exec env`, or image layer inspection.
// =============================================================================

const fs = require('fs');
const path = require('path');

const DOCKER_SECRETS_DIR = '/run/secrets';
const LOCAL_SECRETS_DIR = path.join(__dirname, 'secrets');

/**
 * Read a secret value by name.
 * Checks Docker secrets dir, then local secrets dir, then env vars.
 * Strips trailing whitespace/newlines from file-based secrets.
 */
function readSecret(name) {
  // 1. Docker Compose secrets (/run/secrets/<name>)
  const dockerPath = path.join(DOCKER_SECRETS_DIR, name);
  try {
    return fs.readFileSync(dockerPath, 'utf8').trim();
  } catch {}

  // 2. Local secrets directory (./secrets/<name>)
  const localPath = path.join(LOCAL_SECRETS_DIR, name);
  try {
    return fs.readFileSync(localPath, 'utf8').trim();
  } catch {}

  // 3. Environment variable fallback
  return process.env[name] || '';
}

/**
 * Read a config value (not sensitive — doesn't need file-based secrets).
 * Still checks Docker/local secrets dirs for consistency, but primarily
 * comes from env vars.
 */
function readConfig(name, defaultValue = '') {
  const secret = readSecret(name);
  if (secret) return secret;
  return process.env[name] || defaultValue;
}

module.exports = { readSecret, readConfig };
