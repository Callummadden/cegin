const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { readSecret } = require('./secrets');

const JWT_SECRET = readSecret('JWT_SECRET');
if (!JWT_SECRET) throw new Error('JWT_SECRET is required. Set it in .env, secrets/ dir, or Docker secrets.');
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
