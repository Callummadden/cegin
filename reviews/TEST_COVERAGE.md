# Cegin Server — Test Coverage Summary

**Generated:** 2026-07-11  
**Framework:** Node.js built-in test runner (`node:test`) — zero extra dependencies  
**Run:** `npm run test:unit`

## Test Files

### test/test-auth.js — Auth Module (11 tests)

| Category | Tests | What's covered |
|----------|-------|----------------|
| signToken / verifyToken round-trip | 4 | Sign → verify round-trip, tampered token rejection, wrong-secret rejection, payload contents |
| authMiddleware | 6 | Missing header → pass-through (null user), non-Bearer header → pass-through, invalid token → 401, expired token → 401, valid token + deleted user → 401, valid token + existing user → req.user attached |
| hashPassword / comparePassword | 2 | Hash verifies correctly, wrong password rejects |

### test/test-db.js — Database CRUD (20 tests)

| Category | Tests | What's covered |
|----------|-------|----------------|
| createRecipe | 4 | Basic create + return, default fields, JSON storage of arrays, non-array input graceful handling |
| getRecipe | 3 | Fetch by id, non-existent id → null, user_id scoping |
| updateRecipe | 5 | Update allowed fields, non-existent → null, wrong user_id → null (S2-7), field whitelist stripping (S2-14), array field updates |
| deleteRecipe | 3 | Successful delete, non-existent → false, wrong user_id → false |
| listRecipes | 7 | All recipes (no filter), user_id scoping, title search, description search, tag search, search + user scoping, empty results, sort order (updated_at DESC) |
| User CRUD | 4 | Create + get by email, get by id, missing email → undefined, missing id → undefined |

### test/test-index.js — Express App (10 tests)

| Category | Tests | What's covered |
|----------|-------|----------------|
| GET /api/health | 2 | 200 + ok:true, version fields present |
| CORS headers | 5 | Allow-Methods set, Allow-Headers set, allowed origin reflected, unknown origin not reflected, OPTIONS preflight → 204 |
| Security headers | 2 | X-Content-Type-Options: nosniff, X-Frame-Options: SAMEORIGIN |
| Auth-protected routes | 2 | Invalid token → 401, no token → pass-through (open mode) |

## Coverage Gaps / Future Work

- **AI endpoints** — not tested (require API keys / external service mocks)
- **WebSocket** — not tested (needs ws client)
- **File upload / image processing** — not tested (sharp + filesystem)
- **Rate limiter** — not tested in isolation (would need timer mocking)
- **Collection CRUD** — not tested (follows same pattern as recipes)
- **Cookbook, meal plans, shopping list** — not tested

## Running

```bash
# All unit tests (no server needed, no external deps)
npm run test:unit

# Just auth tests
node --test test/test-auth.js

# Just DB tests
node --test test/test-db.js

# Just integration tests (starts Express server)
node --test test/test-index.js

# Original smoke tests (syntax check + module load)
npm test
```
