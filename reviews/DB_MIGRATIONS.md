# Cegin Database Migration Strategy

## Overview

Cegin uses a file-based migration system for its SQLite database. Migrations are sequential `.sql` files in `server/migrations/`, tracked by a `schema_migrations` table that records which migrations have been applied.

## Quick Reference

```bash
# Apply all pending migrations
npm run migrate

# See what's applied vs pending
npm run migrate:status

# Preview without touching the database
npm run migrate:dry-run
```

## How It Works

1. The runner (`migrations/migrate.js`) scans `migrations/` for `.sql` files sorted by filename prefix (e.g. `001_`, `002_`, …).
2. It checks the `schema_migrations` table for already-applied versions.
3. Pending migrations run inside a transaction; on success the version is recorded.
4. If a migration fails, the transaction rolls back and the process exits with code 1.

## Creating a New Migration

1. Create a file: `migrations/002_my_change.sql` (increment the number).
2. Write the SQL for the change. Use `IF NOT EXISTS` / `IF EXISTS` guards where possible for safety.
3. Run `npm run migrate:dry-run` to verify it parses.
4. Run `npm run migrate` to apply.

## Migration Files

| Version | Name | Description |
|---------|------|-------------|
| 001 | `001_baseline` | Baseline snapshot of all 17 tables and indexes as of v1.3.2 |

## Current Schema (17 tables)

| # | Table | Purpose | Notable columns |
|---|-------|---------|-----------------|
| 1 | `recipes` | Core recipe storage | `ingredients`/`steps`/`tags` as JSON TEXT |
| 2 | `collections` | Named groups of recipes | `recipe_ids` as JSON TEXT |
| 3 | `recipe_images` | Multi-image support per recipe | FK → recipes with CASCADE |
| 4 | `users` | Auth accounts | Unique email |
| 5 | `notification_subscriptions` | Per-user notification prefs | One row per user |
| 6 | `push_tokens` | Expo push tokens per device | Unique token |
| 7 | `meal_plans` | Calendar meal assignments | Unique(user_id, date, meal) |
| 8 | `scanned_items` | Terry Vision fridge scans | Expires/consumed tracking |
| 9 | `cook_stats` | Per-user cooking aggregates | `recipe_cook_counts` as JSON |
| 10 | `cook_dates` | Cook-date log for streaks | Unique(user_id, cook_date) |
| 11 | `dietary_profiles` | Dietary needs per user | TEXT PK (client-generated) |
| 12 | `cookbook_entries` | Kitchen log with photos | TEXT PK |
| 13 | `shopping_list` | Synced shopping items | TEXT PK |
| 14 | `favorites` | User ↔ recipe favorites | Composite PK |
| 15 | `chat_history` | AI chat conversations | `messages` as JSON TEXT |
| 16 | `activity_context` | User activity level | `metrics` as JSON TEXT |
| 17 | `terry_vision_scans` | Vision scan results | `ingredients` as JSON TEXT |

## Known Schema Issues (from data review)

These are documented for future migrations — **not** addressed in the baseline:

- **JSON columns**: `ingredients`, `steps`, `tags` (recipes), `recipe_ids` (collections), `messages` (chat_history), `recipe_cook_counts` (cook_stats), `metrics` (activity_context), `ingredients` (terry_vision_scans) are all stored as JSON TEXT. They cannot be indexed; queries require full-text LIKE scans.
- **searchByIngredients**: Issues N `LIKE` scans against the JSON `ingredients` column per search term.
- **collections.recipe_ids**: Finding "which collections contain recipe X" requires scanning every row and parsing JSON.
- **No full-text search**: Title/description/tag search uses `LIKE` rather than SQLite FTS5.

## Files

```
server/migrations/
├── migrate.js          # Migration runner (Node.js, uses better-sqlite3)
└── 001_baseline.sql    # Baseline schema snapshot
```

## Integration Notes

- The runner uses the same `DB_PATH` env var as `db.js` (defaults to `server/recipes.db`).
- The `schema_migrations` table is checked at startup, so running `npm run migrate` before `npm start` ensures the schema is up to date.
- The baseline migration is idempotent (`CREATE TABLE IF NOT EXISTS`) — safe to run on both fresh and existing databases.
