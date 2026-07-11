// SPDX-License-Identifier: GPL-3.0-or-later
// Tests for auth.js — middleware, signToken/verifyToken round-trip
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Set JWT_SECRET before requiring auth so it doesn't auto-generate a file
process.env.JWT_SECRET = 'test-secret-key-for-unit-tests-do-not-use-in-prod';

const { signToken, verifyToken, authMiddleware, hashPassword, comparePassword } = require('../auth');

// ─── signToken / verifyToken round-trip ─────────────────────────────────────

describe('signToken / verifyToken', () => {
  it('round-trips a user payload through sign → verify', () => {
    const user = { id: 42, email: 'chef@cegin.test' };
    const token = signToken(user);
    const decoded = verifyToken(token);

    assert.equal(decoded.id, 42);
    assert.equal(decoded.email, 'chef@cegin.test');
    assert.ok(decoded.iat, 'should have issued-at');
    assert.ok(decoded.exp, 'should have expiry');
  });

  it('rejects a tampered token', () => {
    const token = signToken({ id: 1, email: 'a@b.c' });
    const tampered = token.slice(0, -5) + 'XXXXX';
    assert.throws(() => verifyToken(tampered), /invalid|malformed/i);
  });

  it('rejects a token signed with a different secret', () => {
    const jwt = require('jsonwebtoken');
    const foreignToken = jwt.sign({ id: 1, email: 'x@y.z' }, 'wrong-secret');
    assert.throws(() => verifyToken(foreignToken), /invalid|signature/i);
  });

  it('includes id and email in signed payload', () => {
    const token = signToken({ id: 99, email: 'test@example.com' });
    // Decode without verification to inspect payload
    const jwt = require('jsonwebtoken');
    const payload = jwt.decode(token);
    assert.equal(payload.id, 99);
    assert.equal(payload.email, 'test@example.com');
  });
});

// ─── authMiddleware ─────────────────────────────────────────────────────────

describe('authMiddleware', () => {
  // Minimal mock DB that knows about a single user
  const mockUser = { id: 7, email: 'user@test.com', display_name: 'Test Chef' };
  const mockDb = {
    getUserById(id) {
      if (id === mockUser.id) return mockUser;
      return undefined;
    },
  };

  /** Create a fake req/res/next triple and return them for assertion. */
  function makeCtx(headers = {}) {
    const req = { headers };
    const res = {
      _status: 200,
      _json: null,
      status(code) { this._status = code; return this; },
      json(body) { this._json = body; return this; },
    };
    let nextCalled = false;
    const next = () => { nextCalled = true; };
    return { req, res, next, get nextCalled() { return nextCalled; } };
  }

  const mw = authMiddleware(mockDb);

  it('passes through when no Authorization header is present', () => {
    const ctx = makeCtx({});
    mw(ctx.req, ctx.res, ctx.next);

    assert.ok(ctx.nextCalled, 'next() should be called');
    assert.equal(ctx.req.user, null, 'req.user should be null');
    assert.equal(ctx.res._status, 200, 'should not set error status');
  });

  it('passes through when Authorization header lacks Bearer prefix', () => {
    const ctx = makeCtx({ authorization: 'Token abc123' });
    mw(ctx.req, ctx.res, ctx.next);

    assert.ok(ctx.nextCalled, 'next() should be called');
    assert.equal(ctx.req.user, null);
  });

  it('returns 401 for an invalid/malformed token', () => {
    const ctx = makeCtx({ authorization: 'Bearer this.is.not.a.valid.jwt' });
    mw(ctx.req, ctx.res, ctx.next);

    assert.equal(ctx.res._status, 401);
    assert.match(ctx.res._json.error, /invalid|expired/i);
    assert.ok(!ctx.nextCalled, 'next() should NOT be called');
  });

  it('returns 401 for an expired token', () => {
    const jwt = require('jsonwebtoken');
    const expiredToken = jwt.sign(
      { id: mockUser.id, email: mockUser.email },
      process.env.JWT_SECRET,
      { expiresIn: '-1s' }  // already expired
    );
    const ctx = makeCtx({ authorization: `Bearer ${expiredToken}` });
    mw(ctx.req, ctx.res, ctx.next);

    assert.equal(ctx.res._status, 401);
    assert.match(ctx.res._json.error, /invalid|expired/i);
    assert.ok(!ctx.nextCalled);
  });

  it('returns 401 when token is valid but user no longer exists in DB', () => {
    const token = signToken({ id: 9999, email: 'ghost@test.com' }); // ID not in mockDb
    const ctx = makeCtx({ authorization: `Bearer ${token}` });
    mw(ctx.req, ctx.res, ctx.next);

    assert.equal(ctx.res._status, 401);
    assert.match(ctx.res._json.error, /not found/i);
    assert.ok(!ctx.nextCalled);
  });

  it('attaches user to req and calls next for a valid token + existing user', () => {
    const token = signToken(mockUser);
    const ctx = makeCtx({ authorization: `Bearer ${token}` });
    mw(ctx.req, ctx.res, ctx.next);

    assert.ok(ctx.nextCalled, 'next() should be called');
    assert.deepEqual(ctx.req.user, mockUser, 'req.user should be the DB user');
    assert.equal(ctx.res._status, 200, 'should not set error status');
  });
});

// ─── password hashing ───────────────────────────────────────────────────────

describe('hashPassword / comparePassword', () => {
  it('hashes a password and verifies it', async () => {
    const hash = await hashPassword('my-secret-pw');
    assert.ok(hash.startsWith('$2'), 'bcrypt hash prefix');
    assert.ok(await comparePassword('my-secret-pw', hash));
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct-password');
    assert.equal(await comparePassword('wrong-password', hash), false);
  });
});
