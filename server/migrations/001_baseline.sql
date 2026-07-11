-- Baseline migration: documents the current Cegin schema as of v1.3.2
-- This is a snapshot of all CREATE TABLE / CREATE INDEX statements from db.js.
-- For existing databases that already have these tables, this migration uses
-- CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS so it is safe to run
-- on both fresh and pre-existing databases.

-- Pragmas (already set by runner, documented here for reference)
-- PRAGMA journal_mode = WAL;
-- PRAGMA foreign_keys = ON;

-- ─── 1. recipes ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  ingredients TEXT NOT NULL DEFAULT '[]',   -- JSON array
  steps TEXT NOT NULL DEFAULT '[]',         -- JSON array
  tags TEXT NOT NULL DEFAULT '[]',          -- JSON array
  prep_minutes INTEGER DEFAULT 0,
  cook_minutes INTEGER DEFAULT 0,
  servings INTEGER DEFAULT 1,
  image_url TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  collection TEXT DEFAULT '',
  user_id INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recipes_user_id ON recipes(user_id);
CREATE INDEX IF NOT EXISTS idx_recipes_user_updated ON recipes(user_id, updated_at DESC);

-- ─── 2. collections ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  recipe_ids TEXT NOT NULL DEFAULT '[]',    -- JSON array of recipe ids
  user_id INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_user_name ON collections(user_id, name);

-- ─── 3. recipe_images ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS recipe_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL,
  image_url TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recipe_images_recipe_id ON recipe_images(recipe_id);

-- ─── 4. users ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

-- ─── 5. notification_subscriptions ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  morning_digest INTEGER DEFAULT 1,
  perishable_alerts INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ─── 6. push_tokens ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS push_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  device_name TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens(user_id);

-- ─── 7. meal_plans ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meal_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  meal TEXT NOT NULL,
  recipe_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, date, meal)
);

CREATE INDEX IF NOT EXISTS idx_meal_plans_user_date ON meal_plans(user_id, date);

-- ─── 8. scanned_items ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scanned_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  scanned_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,
  consumed INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_scanned_items_user_consumed_expires ON scanned_items(user_id, consumed, expires_at);

-- ─── 9. cook_stats ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cook_stats (
  user_id INTEGER PRIMARY KEY,
  cook_count INTEGER DEFAULT 0,
  total_steps INTEGER DEFAULT 0,
  recipe_cook_counts TEXT DEFAULT '{}',     -- JSON object {recipeId: {title, count}}
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ─── 10. cook_dates ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cook_dates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  cook_date TEXT NOT NULL,
  UNIQUE(user_id, cook_date)
);

-- ─── 11. dietary_profiles ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dietary_profiles (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  needs TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dietary_profiles_user_id ON dietary_profiles(user_id);

-- ─── 12. cookbook_entries ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cookbook_entries (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  recipe_id INTEGER,
  recipe_title TEXT DEFAULT '',
  image_path TEXT DEFAULT '',
  date TEXT DEFAULT (datetime('now')),
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cookbook_entries_user_id ON cookbook_entries(user_id);

-- ─── 13. shopping_list ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shopping_list (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  checked INTEGER DEFAULT 0,
  category TEXT DEFAULT '',
  source TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_shopping_list_user_id ON shopping_list(user_id);

-- ─── 14. favorites ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL,
  recipe_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, recipe_id)
);

-- ─── 15. chat_history ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_history (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT DEFAULT '',
  messages TEXT DEFAULT '[]',               -- JSON array
  timestamp INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_history_user_timestamp ON chat_history(user_id, timestamp DESC);

-- ─── 16. activity_context ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS activity_context (
  user_id INTEGER PRIMARY KEY,
  date TEXT,
  level TEXT DEFAULT '',
  description TEXT DEFAULT '',
  metrics TEXT DEFAULT '{}',                -- JSON object
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ─── 17. terry_vision_scans ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS terry_vision_scans (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  section TEXT NOT NULL,
  image_path TEXT NOT NULL,
  ingredients TEXT NOT NULL DEFAULT '[]',   -- JSON array
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_terry_vision_scans_user_id ON terry_vision_scans(user_id);
