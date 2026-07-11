// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/Callummadden/cegin
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

// ALLOW_ANONYMOUS: when 'false', all routes require a valid JWT.
// Defaults to 'true' for backward compat with self-hosted open mode.
const ALLOW_ANONYMOUS = (process.env.ALLOW_ANONYMOUS ?? 'true').toLowerCase() !== 'false';

function authMiddleware(db) {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      if (ALLOW_ANONYMOUS) {
        // Open mode — allow through without user context
        req.user = null;
        return next();
      }
      return res.status(401).json({ error: 'Authentication required' });
    }
    try {
      const decoded = verifyToken(header.slice(7));
      const user = db.getUserById(decoded.id);
      if (!user) {
        // Token references a deleted user — reject
        return res.status(401).json({ error: 'User not found' });
      }
      req.user = user;
      next();
    } catch (e) {
      // Invalid or expired token — reject with 401
      return res.status(401).json({ error: 'Invalid or expired token' });
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
  verifyToken,
  authMiddleware,
  hashPassword,
  comparePassword,
  ALLOW_ANONYMOUS,
};
