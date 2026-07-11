# DB Transaction Audit — `server/db.js`

**Date:** 2026-07-11
**File:** `server/db.js` (better-sqlite3)

## Summary

Wrapped 9 multi-statement operations in `db.transaction()` to guarantee atomicity. Each function performed multiple DB operations (SELECT+DELETE, SELECT+INSERT, SELECT+UPDATE) without a transaction, meaning a crash or concurrent write between statements could leave the database in an inconsistent state.

## Functions Fixed

### Priority targets (requested)

| # | Function | Operations | Pattern | Lines |
|---|----------|-----------|---------|-------|
| 1 | `addRecipeImage` | SELECT MAX + INSERT + SELECT | Max position then insert image | ~363 |
| 2 | `deleteRecipeImage` | SELECT + SELECT + DELETE | Ownership check via recipe then delete | ~380 |
| 3 | `deleteCookbookEntry` | SELECT + DELETE | Fetch entry for return value, then delete | ~821 |
| 4 | `clearCookbookEntries` | SELECT + DELETE | Fetch image paths (for cleanup), then delete all | ~831 |
| 5 | `deleteTerryVisionScan` | SELECT + DELETE | Verify ownership, then delete | ~1025 |
| 6 | `clearTerryVisionScans` | SELECT + DELETE | Fetch image paths (for cleanup), then delete all | ~1035 |

### Additional found during audit

| # | Function | Operations | Pattern | Lines |
|---|----------|-----------|---------|-------|
| 7 | `recordCook` | SELECT + INSERT/UPDATE + INSERT | Read stats, upsert cook_stats, insert cook_date | ~664 |
| 8 | `registerPushToken` | SELECT + UPDATE/INSERT | Check if token exists, upsert, then read back | ~504 |
| 9 | `upsertNotificationSubscription` | SELECT + UPDATE/INSERT | Check existing, update or insert, then read back | ~472 |

## Already correct (no changes needed)

These functions were already wrapped in transactions:

- `syncMealPlan` — DELETE + INSERT loop
- `upsertDietaryProfiles` — DELETE + INSERT loop
- `syncShoppingList` — DELETE + INSERT loop
- `syncFavorites` — DELETE + INSERT loop
- `syncChatHistory` — DELETE + INSERT loop
- `clearStats` — DELETE from two tables

## Not wrapped (single-statement, no fix needed)

Functions like `deleteRecipe`, `deleteCollection`, `clearShoppingList`, `clearFavorites`, `clearChatHistory`, `clearActivityContext`, `clearDietaryProfiles` all perform a single DELETE statement and don't need transactions.

## Notes

- **Pattern used:** `const txn = db.transaction(() => { ... return value; }); return txn();` — this is idiomatic for better-sqlite3 (synchronous API).
- **Risk addressed:** Without transactions, concurrent requests could read stale data between a SELECT and its paired DELETE/INSERT, or a crash between statements could leave orphaned data.
- **No breaking changes:** All function signatures and return values are unchanged.
