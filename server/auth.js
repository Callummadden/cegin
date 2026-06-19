const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readSecret } = require('./secrets');

const JWT_SECRET = readSecret('JWT_SECRET') || (() => {
  // Auto-generate and persist a JWT secret if none is set
  const generated = crypto.randomBytes(32).toString('base64');
  const secretDir = path.join(__dirname, 'secrets');
  const secretPath = path.join(secretDir, 'JWT_SECRET');
  try {
    fs.mkdirSync(secretDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(secretPath, generated + '\n', { mode: 0o600 });
    console.log('[auth] Auto-generated JWT_SECRET and saved to secrets/JWT_SECRET');
  } catch (e) {
    console.warn('[auth] Could not persist JWT_SECRET to file, using in-memory key:', e.message);
  }
  return generated;
})();
const JWT_EXPIRES = '30d';

// ─── Token helpers ──────────────────────────────────────────────────────────

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// ─── Middleware ──────────────────────────────────────────────────────────────

function authMiddleware(db) {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      // No token — allow through without user context (open/self-hosted mode)
      req.user = null;
      return next();
    }
    try {
      const decoded = verifyToken(header.slice(7));
      const user = db.getUserById(decoded.id);
      req.user = user || null;
      next();
    } catch (e) {
      // Invalid token — allow through without user context
      req.user = null;
      next();
    }
  };
}

// ─── Password hashing ───────────────────────────────────────────────────────

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

module.exports = {
  signToken,
  authMiddleware,
  hashPassword,
  comparePassword,
};
