# Cegin Database Audit — `server/db.js`

**Auditor:** Hermes Agent  
**Date:** 2026-07-11  
**Engine:** better-sqlite3 (synchronous, single-connection)  
**DB file:** `recipes.db` (configurable via `DB_PATH` env var)

---

## 1. Schema Overview

| Table | PK | Purpose |
|---|---|---|
| `recipes` | `id` (int, auto) | Recipes with JSON-encoded ingredients/steps/tags |
| `collections` | `id` (int, auto) | Named collections with JSON `recipe_ids` |
| `recipe_images` | `id` (int, auto) | Multi-image support per recipe (FK → recipes) |
| `users` | `id` (int, auto) | Email + password_hash auth |
| `notification_subscriptions` | `id` (int, auto) | Per-user notification prefs |
| `push_tokens` | `id` (int, auto) | Expo push tokens per device |
| `meal_plans` | `id` (int, auto) | Date+meal → recipe mapping |
| `scanned_items` | `id` (int, auto) | Fridge scan items from Terry Vision |
| `cook_stats` | `user_id` (int) | Aggregated cooking stats |
| `cook_dates` | `id` (int, auto) | Cook streak tracking |
| `dietary_profiles` | `id` (text) | User dietary needs |
| `cookbook_entries` | `id` (text) | Kitchen log with photos |
| `shopping_list` | `id` (text) | Shopping list items |
| `favorites` | `(user_id, recipe_id)` | Composite PK |
| `chat_history` | `id` (text) | Terry chat conversations |
| `activity_context` | `user_id` (int) | Current activity level |
| `terry_vision_scans` | `id` (text) | Vision scan results |

**17 tables total.**

---

## 2. Strengths ✅

### 2.1 Pragmas
- **WAL mode enabled** — good for concurrent reads.
- **Foreign keys enabled** (`foreign_keys = ON`) — enforced at the SQLite level.

### 2.2 FK and CASCADE
- `recipe_images` has `FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE` — correct cascading delete.

### 2.3 Transaction usage
- **7 functions use `db.transaction()`**: `syncMealPlan`, `upsertDietaryProfiles`, `syncShoppingList`, `syncFavorites`, `syncChatHistory`, `recordCook` (implicitly via insert+date), `clearStats` (two deletes but no txn — see issue below).
- Sync operations correctly wrap delete-all + insert-many in a transaction.

### 2.4 Input sanitization
- LIKE queries use `ESCAPE '\\'` with `%` and `_` properly escaped (lines 73, 196).
- S2-14 field whitelist on `updateRecipe` prevents column injection.
- Parameterised queries used throughout — no SQL injection vectors found.

### 2.5 Upserts
- `meal_plans` uses `ON CONFLICT ... DO UPDATE` — clean upsert pattern.
- `cook_stats` uses `ON CONFLICT(user_id) DO UPDATE`.
- `activity_context` uses `ON CONFLICT(user_id) DO UPDATE`.
- `notification_subscriptions` uses manual check-then-insert/update (could be ON CONFLICT — see suggestions).

---

## 3. Issues & Findings

### 3.1 🔴 Missing Indexes (HIGH)

Only **2 indexes** exist on the entire database:
1. `recipes.id` (implicit PK)
2. `idx_collections_user_name` on `collections(user_id, name)` (UNIQUE)

**Missing indexes that would improve query performance:**

| Table | Suggested Index | Reason |
|---|---|---|
| `recipes` | `(user_id)` | Every `listRecipes`, `getRecipe`, `deleteRecipe`, `getDistinctCollections` filters on `user_id` |
| `recipes` | `(user_id, updated_at DESC)` | `listRecipes` always `ORDER BY updated_at DESC` |
| `recipe_images` | `(recipe_id)` | `getRecipeImages` filters on `recipe_id`; FK column without explicit index |
| `meal_plans` | `(user_id, date)` | `getMealPlan` and `getTodayMeals` filter on both; UNIQUE constraint covers this but only if used |
| `scanned_items` | `(user_id, consumed, expires_at)` | `getScannedItems`, `getExpiringItems`, `getExpiredItems` all filter on these |
| `push_tokens` | `(user_id)` | `getUserPushTokens` filters on `user_id` |
| `favorites` | `(user_id)` | Covered by composite PK, but `(user_id, recipe_id)` order matters |
| `cookbook_entries` | `(user_id)` | `getCookbookEntries` filters on `user_id` |
| `chat_history` | `(user_id, timestamp DESC)` | `getChatHistory` filters + orders on these |
| `dietary_profiles` | `(user_id)` | `getDietaryProfiles` filters on `user_id` |
| `terry_vision_scans` | `(user_id)` | `getTerryVisionScans` filters on `user_id` |
| `shopping_list` | `(user_id)` | `getShoppingList` filters on `user_id` |

> `meal_plans` has `UNIQUE(user_id, date, meal)` which acts as an index for the exact 3-column match but NOT for partial lookups like `WHERE user_id = ?` alone. SQLite can use a leftmost prefix of a composite index, so this index *does* help `getMealPlan` (filters on `user_id` only). However, `getTodayMeals` also joins on `recipes`, so a separate `(user_id, date)` index would be slightly more efficient.

### 3.2 🟡 JSON Columns Instead of Normalised Tables (MEDIUM)

Several columns store structured data as JSON strings:

| Table | Column | Actual Data |
|---|---|---|
| `recipes` | `ingredients` | Array of ingredient objects |
| `recipes` | `steps` | Array of step strings |
| `recipes` | `tags` | Array of tag strings |
| `collections` | `recipe_ids` | Array of integer IDs |
| `cook_stats` | `recipe_cook_counts` | Object of `{recipeId: {title, count}}` |
| `chat_history` | `messages` | Array of message objects |
| `activity_context` | `metrics` | Object |
| `terry_vision_scans` | `ingredients` | Array |

**Impact:**
- `searchByIngredients` does `LIKE` scans on the JSON `ingredients` column — full table scan for every ingredient in the list. No index can help.
- `collections.recipe_ids` as JSON means finding "which collections contain recipe X" requires scanning all collections.
- `tags LIKE` search in `listRecipes` also cannot be indexed.

**For an app with <10K recipes this is fine.** At scale, normalised `recipe_ingredients`, `recipe_tags`, and `collection_recipes` join tables would be better.

### 3.3 🟡 N+1 Query Patterns (MEDIUM)

| Function | Issue |
|---|---|
| `updateRecipe` (line 124) | Calls `getRecipe()` (SELECT), then UPDATE, then `getRecipe()` again — 3 queries for 1 update. Could be a single UPDATE … RETURNING. |
| `createRecipe` (line 119) | INSERT then SELECT to fetch back — 2 queries. `better-sqlite3` doesn't support RETURNING natively but `lastInsertRowid` + single fetch is acceptable. |
| `addRecipeToCollection` | Calls `getCollection` → modifies JSON → calls `updateCollection` (which calls `getCollection` again) — 3 reads + 1 write for a single add. |
| `removeRecipeFromCollection` | Same pattern — 3 reads + 1 write. |
| `recordCook` (line 637) | Calls `getStats` to read, then upserts — 2 queries. Acceptable. |
| `addRecipeImage` | SELECT MAX + INSERT + SELECT — 3 queries. Could use `COALESCE(MAX(position), -1) + 1` in a subquery. |
| `deleteRecipeImage` | 2 SELECTs before DELETE to check ownership. Could be a single `DELETE … WHERE id = ? AND recipe_id IN (SELECT id FROM recipes WHERE user_id = ?)`. |
| `getCookingStreak` | Fetches ALL cook dates into JS, iterates in a loop. Works fine for small datasets but could be done in SQL with window functions. |

### 3.4 🟡 Missing Transactions (MEDIUM)

| Function | Issue |
|---|---|
| `clearStats` (line 693) | Deletes from `cook_stats` and `cook_dates` without a transaction. If the process crashes between the two deletes, data will be inconsistent. |
| `addRecipeImage` | MAX + INSERT not wrapped in transaction — race condition possible if two inserts happen concurrently (low risk with better-sqlite3's synchronous model). |
| `deleteTerryVisionScans` | SELECT + DELETE without transaction. |
| `deleteCookbookEntry` | SELECT + DELETE without transaction. |
| `clearCookbookEntries` | SELECT + DELETE without transaction — if crash between, image cleanup loses track of orphaned files. |

### 3.5 🟡 updateRecipe Lacks user_id in WHERE (MEDIUM)

Line 137–159: The UPDATE statement uses `WHERE id = @id` but does **not** include `AND user_id = @userId`. This means:
1. `getRecipe(id, userId)` correctly scopes the read.
2. But the UPDATE itself doesn't scope — if the SELECT somehow returns the wrong row (edge case), the update targets by `id` alone.

The `existing` check on line 124 mitigates this (returns null if not found), but a belt-and-suspenders approach would add `AND user_id = @userId` to the WHERE clause.

### 3.6 🟡 updateCollection Lacks user_id in WHERE (MEDIUM)

Same pattern as updateRecipe — line 277: `WHERE id = @id` without user_id scoping. The existing check on line 273 mitigates but the UPDATE itself is not scoped.

### 3.7 🟢 Schema Migration Approach (LOW)

Migrations use `ALTER TABLE ADD COLUMN` in a try/catch loop (lines 32–45, 214–225). This is:
- **Idempotent** — safe to run multiple times.
- **No version tracking** — there's no `schema_version` table or migration version number.
- **Fragile for complex migrations** — if a future migration needs data transformation (not just ADD COLUMN), this pattern breaks.
- **No separate migration files** — migrations are embedded in `db.js`.

For a small app, this is pragmatic. For growth, consider a `schema_migrations` table and versioned migration files.

### 3.8 🟢 Data Integrity Notes (LOW)

- **No NOT NULL on user_id for most tables**: `recipes.user_id DEFAULT 0` allows orphaned rows (user_id=0). Collections, scanned_items, meal_plans all use `DEFAULT 0` instead of requiring a real user_id.
- **No FK constraints on user_id**: Only `recipe_images.recipe_id` has a FK. `recipes.user_id`, `meal_plans.user_id`, `scanned_items.user_id`, etc. have no FK to `users(id)`. Deleting a user leaves orphaned data everywhere.
- **No FK from meal_plans.recipe_id to recipes.id**: A meal plan could reference a deleted recipe.
- **collections.recipe_ids stores recipe IDs as JSON**: No referential integrity — can contain IDs of deleted recipes.
- **`recipe_images` position renumbering**: `addRecipeImage` appends MAX+1, but `deleteRecipeImage` doesn't renumber. Positions will have gaps (0, 1, 3, 5). Fine for ordering but worth noting.

### 3.9 🟢 Prepared Statement Caching (LOW)

better-sqlite3 caches prepared statements by SQL string, so the dynamic SQL in `searchByIngredients` (builds different SQL per ingredient count) will create a new prepared statement per unique ingredient count. Not a problem at low volume but worth noting for high-traffic scenarios.

### 3.10 🟢 `listRecipes` with userId=undefined (LOW)

Line 71: `userId ? ' AND user_id = @userId' : ''` — when userId is undefined/null/0, it returns ALL recipes across all users. The `0` case is intentional (legacy unscoped data) but could leak data if a request somehow passes `userId = 0` instead of a real user ID.

---

## 4. Optimisation Recommendations

### Quick Wins (low effort, high impact)

1. **Add `user_id` index on recipes:**
   ```sql
   CREATE INDEX IF NOT EXISTS idx_recipes_user_id ON recipes(user_id);
   ```
   This is the single highest-impact index — nearly every query filters on it.

2. **Add `recipe_id` index on recipe_images:**
   ```sql
   CREATE INDEX IF NOT EXISTS idx_recipe_images_recipe_id ON recipe_images(recipe_id);
   ```
   The FK column has no explicit index (SQLite doesn't auto-create indexes for FKs).

3. **Add composite indexes for common query patterns:**
   ```sql
   CREATE INDEX IF NOT EXISTS idx_scanned_items_user_consumed_expires
     ON scanned_items(user_id, consumed, expires_at);
   CREATE INDEX IF NOT EXISTS idx_chat_history_user_timestamp
     ON chat_history(user_id, timestamp DESC);
   CREATE INDEX IF NOT EXISTS idx_meal_plans_user_date
     ON meal_plans(user_id, date);
   ```

4. **Wrap `clearStats` in a transaction:**
   ```js
   const clearStats = db.transaction((userId) => {
     const uid = userId || 0;
     db.prepare('DELETE FROM cook_stats WHERE user_id = ?').run(uid);
     db.prepare('DELETE FROM cook_dates WHERE user_id = ?').run(uid);
   });
   ```

5. **Add `user_id` to UPDATE WHERE clauses** in `updateRecipe` and `updateCollection` for defense-in-depth.

### Medium Effort

6. **Use `INSERT OR REPLACE` or `ON CONFLICT` for `upsertNotificationSubscription`** instead of check-then-insert/update.

7. **Add FK constraints for user_id columns** (with CASCADE or SET NULL) if user deletion is a feature:
   ```sql
   -- Would require a migration to add FK constraints to existing tables
   -- Not trivial with ALTER TABLE (SQLite limitation)
   ```

8. **Reduce N+1 in collection operations**: `addRecipeToCollection` and `removeRecipeFromCollection` could use JSON functions or a single read-modify-write in a transaction.

### Long Term

9. **Normalise JSON columns** if dataset grows beyond ~10K recipes (ingredients, tags, steps → join tables).

10. **Add a `schema_migrations` table** for versioned, trackable migrations.

11. **Add `ON DELETE CASCADE` or `SET NULL`** for `meal_plans.recipe_id` → `recipes.id` to prevent dangling references.

---

## 5. Migration Scripts

**No separate migration files found.** All migrations are inline in `db.js`:
- Lines 32–45: Add `image_url`, `notes`, `collection`, `user_id` columns to `recipes`.
- Lines 214–225: Add `user_id` column and unique index to `collections`.

The pattern uses `try/catch` to silently ignore "duplicate column" errors. This is idempotent but has no version tracking.

---

## 6. Summary

| Category | Rating | Notes |
|---|---|---|
| SQL Injection Safety | ✅ Excellent | Parameterised queries + LIKE escaping everywhere |
| Index Coverage | 🔴 Poor | Only 1 user-created index; most user_id columns unindexed |
| Schema Design | 🟡 Adequate | JSON columns are pragmatic but limit queryability |
| Transaction Safety | 🟡 Mostly Good | 7 txn-wrapped functions, but 4–5 functions missing txns |
| Data Integrity | 🟡 Fair | FK only on recipe_images; no user_id FKs; orphan risk |
| N+1 Queries | 🟡 Some | updateRecipe, collection ops, addRecipeImage have extra round-trips |
| Migration System | 🟡 Basic | Inline try/catch; works but no versioning |
| Overall | 🟢 Good for current scale | Add the 5 indexes above and wrap multi-statement functions in txns |
