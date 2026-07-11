// SPDX-License-Identifier: GPL-3.0-or-later
// Tests for db.js — CRUD operations with user_id scoping
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Use a throwaway SQLite DB so tests never touch the real recipes.db
const TEST_DB_PATH = path.join(__dirname, '.test-recipes.db');
process.env.DB_PATH = TEST_DB_PATH;
// Also set JWT_SECRET so auth.js (pulled in transitively) doesn't create secret files
process.env.JWT_SECRET = 'test-db-secret';

// db.js creates indexes (line 49-61) on tables that are defined later in the
// same file.  On a fresh DB this causes SQLITE_ERROR: no such table.
// Pre-create the tables that the index block references so the module loads.
const preDb = new Database(TEST_DB_PATH);
preDb.pragma('journal_mode = WAL');
preDb.exec(`
  CREATE TABLE IF NOT EXISTS recipe_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT, recipe_id INTEGER NOT NULL,
    image_url TEXT NOT NULL, position INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS meal_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    date TEXT NOT NULL, meal TEXT NOT NULL, recipe_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, date, meal)
  );
  CREATE TABLE IF NOT EXISTS scanned_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    item_name TEXT NOT NULL, scanned_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT, consumed INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS push_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE, device_name TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS cookbook_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    recipe_id INTEGER, recipe_title TEXT DEFAULT '',
    image_path TEXT DEFAULT '', date TEXT DEFAULT '',
    notes TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS chat_history (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
    title TEXT DEFAULT '', messages TEXT DEFAULT '[]',
    timestamp INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS dietary_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    name TEXT NOT NULL, needs TEXT DEFAULT '',
    notes TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS terry_vision_scans (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
    section TEXT NOT NULL, image_path TEXT NOT NULL,
    ingredients TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS shopping_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    items TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER NOT NULL, recipe_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, recipe_id)
  );
  CREATE TABLE IF NOT EXISTS cook_stats (
    user_id INTEGER PRIMARY KEY, total_cooks INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS cook_dates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    date TEXT NOT NULL, recipe_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, date, recipe_id)
  );
  CREATE TABLE IF NOT EXISTS activity_context (
    user_id INTEGER PRIMARY KEY, date TEXT,
    level TEXT DEFAULT '', description TEXT DEFAULT '',
    metrics TEXT DEFAULT '{}',
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);
preDb.close();

const dbModule = require('../db');

// ─── helpers ────────────────────────────────────────────────────────────────

function makeRecipe(overrides = {}) {
  return {
    title: 'Test Recipe',
    description: 'A delicious test dish',
    ingredients: ['flour', 'sugar', 'eggs'],
    steps: ['Mix', 'Bake'],
    tags: ['test', 'easy'],
    prep_minutes: 10,
    cook_minutes: 20,
    servings: 4,
    ...overrides,
  };
}

// Clean up after tests
after(() => {
  try { dbModule.db.close(); } catch {}
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + ext); } catch {}
  }
});

// ─── createRecipe ───────────────────────────────────────────────────────────

describe('createRecipe', () => {
  it('creates a recipe and returns it with an id', () => {
    const recipe = dbModule.createRecipe(makeRecipe(), 1);
    assert.ok(recipe.id, 'should have an id');
    assert.equal(recipe.title, 'Test Recipe');
    assert.equal(recipe.user_id, 1);
    assert.deepEqual(recipe.ingredients, ['flour', 'sugar', 'eggs']);
    assert.deepEqual(recipe.steps, ['Mix', 'Bake']);
    assert.deepEqual(recipe.tags, ['test', 'easy']);
  });

  it('defaults missing fields gracefully', () => {
    const recipe = dbModule.createRecipe({ title: 'Minimal' }, 0);
    assert.equal(recipe.title, 'Minimal');
    assert.equal(recipe.description, '');
    assert.deepEqual(recipe.ingredients, []);
    assert.deepEqual(recipe.steps, []);
    assert.deepEqual(recipe.tags, []);
    assert.equal(recipe.prep_minutes, 0);
    assert.equal(recipe.cook_minutes, 0);
    assert.equal(recipe.servings, 1);
  });

  it('stores ingredients/steps/tags as JSON arrays', () => {
    const recipe = dbModule.createRecipe(makeRecipe({ title: 'JSON Check' }), 1);
    // Verify raw row has JSON strings
    const raw = dbModule.db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipe.id);
    assert.equal(typeof raw.ingredients, 'string');
    assert.deepEqual(JSON.parse(raw.ingredients), ['flour', 'sugar', 'eggs']);
  });

  it('handles non-array ingredients gracefully', () => {
    const recipe = dbModule.createRecipe(makeRecipe({ ingredients: 'not-an-array' }), 0);
    assert.deepEqual(recipe.ingredients, []);
  });
});

// ─── getRecipe ──────────────────────────────────────────────────────────────

describe('getRecipe', () => {
  it('retrieves a recipe by id', () => {
    const created = dbModule.createRecipe(makeRecipe({ title: 'Fetch Me' }), 1);
    const fetched = dbModule.getRecipe(created.id);
    assert.equal(fetched.title, 'Fetch Me');
    assert.equal(fetched.id, created.id);
  });

  it('returns null for a non-existent id', () => {
    const result = dbModule.getRecipe(999999);
    assert.equal(result, null);
  });

  it('scopes by user_id when provided', () => {
    const created = dbModule.createRecipe(makeRecipe({ title: 'User Scoped' }), 5);
    // Same user can see it
    assert.ok(dbModule.getRecipe(created.id, 5));
    // Different user cannot
    assert.equal(dbModule.getRecipe(created.id, 6), null);
  });
});

// ─── updateRecipe ───────────────────────────────────────────────────────────

describe('updateRecipe', () => {
  it('updates allowed fields', () => {
    const created = dbModule.createRecipe(makeRecipe({ title: 'Original' }), 1);
    const updated = dbModule.updateRecipe(created.id, { title: 'Updated Title', servings: 8 }, 1);
    assert.equal(updated.title, 'Updated Title');
    assert.equal(updated.servings, 8);
    // Other fields unchanged
    assert.equal(updated.description, 'A delicious test dish');
  });

  it('returns null when recipe does not exist', () => {
    const result = dbModule.updateRecipe(999999, { title: 'Ghost' }, 1);
    assert.equal(result, null);
  });

  it('returns null when user_id does not match (ownership scoping)', () => {
    const created = dbModule.createRecipe(makeRecipe({ title: 'Protected' }), 3);
    const result = dbModule.updateRecipe(created.id, { title: 'Hacked' }, 4);
    assert.equal(result, null);
    // Original should be unchanged
    const original = dbModule.getRecipe(created.id, 3);
    assert.equal(original.title, 'Protected');
  });

  it('strips non-whitelisted fields (S2-14)', () => {
    const created = dbModule.createRecipe(makeRecipe({ title: 'Whitelist Test' }), 1);
    const updated = dbModule.updateRecipe(created.id, {
      title: 'Still Here',
      user_id: 999,          // should be stripped
      id: 12345,             // should be stripped
      created_at: 'never',   // should be stripped
    }, 1);
    assert.equal(updated.title, 'Still Here');
    assert.equal(updated.user_id, 1); // unchanged
    assert.notEqual(updated.id, 12345);
  });

  it('handles updating ingredients/steps/tags arrays', () => {
    const created = dbModule.createRecipe(makeRecipe({ title: 'Array Update' }), 1);
    const updated = dbModule.updateRecipe(created.id, {
      ingredients: ['new-ing-1', 'new-ing-2'],
      steps: ['Step 1', 'Step 2', 'Step 3'],
      tags: ['updated'],
    }, 1);
    assert.deepEqual(updated.ingredients, ['new-ing-1', 'new-ing-2']);
    assert.equal(updated.steps.length, 3);
    assert.deepEqual(updated.tags, ['updated']);
  });
});

// ─── deleteRecipe ───────────────────────────────────────────────────────────

describe('deleteRecipe', () => {
  it('deletes an existing recipe', () => {
    const created = dbModule.createRecipe(makeRecipe({ title: 'Delete Me' }), 1);
    const deleted = dbModule.deleteRecipe(created.id, 1);
    assert.equal(deleted, true);
    assert.equal(dbModule.getRecipe(created.id), null);
  });

  it('returns false for a non-existent recipe', () => {
    const result = dbModule.deleteRecipe(999999, 1);
    assert.equal(result, false);
  });

  it('returns false when user_id does not match (ownership scoping)', () => {
    const created = dbModule.createRecipe(makeRecipe({ title: 'Not Yours' }), 2);
    const result = dbModule.deleteRecipe(created.id, 3);
    assert.equal(result, false);
    // Recipe should still exist
    assert.ok(dbModule.getRecipe(created.id, 2));
    // Clean up
    dbModule.deleteRecipe(created.id, 2);
  });
});

// ─── listRecipes ────────────────────────────────────────────────────────────

describe('listRecipes', () => {
  // Set up test data
  before(() => {
    // Insert recipes for different users
    dbModule.createRecipe(makeRecipe({ title: 'Pasta Carbonara', tags: ['italian', 'pasta'] }), 10);
    dbModule.createRecipe(makeRecipe({ title: 'Chocolate Cake', tags: ['dessert', 'baking'] }), 10);
    dbModule.createRecipe(makeRecipe({ title: 'Caesar Salad', description: 'crisp romaine lettuce' }), 11);
    dbModule.createRecipe(makeRecipe({ title: 'Pasta Bolognese', tags: ['italian', 'meat'] }), 11);
  });

  it('lists all recipes when no userId provided', () => {
    const all = dbModule.listRecipes();
    assert.ok(all.length >= 4, `expected at least 4 recipes, got ${all.length}`);
  });

  it('scopes results to userId', () => {
    const user10 = dbModule.listRecipes(undefined, 10);
    const user11 = dbModule.listRecipes(undefined, 11);
    assert.ok(user10.length >= 2);
    assert.ok(user11.length >= 2);
    // No overlap
    const user10Ids = new Set(user10.map(r => r.id));
    for (const r of user11) {
      assert.ok(!user10Ids.has(r.id), `recipe ${r.id} should not appear for both users`);
    }
  });

  it('filters by search query (title match)', () => {
    const results = dbModule.listRecipes('Pasta', 10);
    assert.equal(results.length, 1);
    assert.equal(results[0].title, 'Pasta Carbonara');
  });

  it('filters by search query (description match)', () => {
    const results = dbModule.listRecipes('romaine', 11);
    assert.equal(results.length, 1);
    assert.equal(results[0].title, 'Caesar Salad');
  });

  it('filters by search query (tag match)', () => {
    const results = dbModule.listRecipes('dessert', 10);
    assert.equal(results.length, 1);
    assert.equal(results[0].title, 'Chocolate Cake');
  });

  it('search is scoped to userId', () => {
    // "Pasta" exists for both user 10 and 11
    const user10Pasta = dbModule.listRecipes('Pasta', 10);
    const user11Pasta = dbModule.listRecipes('Pasta', 11);
    assert.equal(user10Pasta.length, 1);
    assert.equal(user10Pasta[0].title, 'Pasta Carbonara');
    assert.equal(user11Pasta.length, 1);
    assert.equal(user11Pasta[0].title, 'Pasta Bolognese');
  });

  it('returns empty array for search with no matches', () => {
    const results = dbModule.listRecipes('zzz_nonexistent_zzz', 10);
    assert.deepEqual(results, []);
  });

  it('returns sorted by updated_at DESC', () => {
    const all = dbModule.listRecipes(undefined, 10);
    for (let i = 1; i < all.length; i++) {
      assert.ok(
        all[i - 1].updated_at >= all[i].updated_at,
        'recipes should be sorted by updated_at DESC'
      );
    }
  });
});

// ─── createUser / getUserByEmail / getUserById ──────────────────────────────

describe('User CRUD', () => {
  it('creates and retrieves a user by email', () => {
    const user = dbModule.createUser('testuser@cegin.test', 'hash123', 'Chef Test');
    assert.ok(user.id);
    assert.equal(user.email, 'testuser@cegin.test');
    assert.equal(user.display_name, 'Chef Test');

    const byEmail = dbModule.getUserByEmail('testuser@cegin.test');
    assert.equal(byEmail.id, user.id);
  });

  it('retrieves a user by id', () => {
    const user = dbModule.createUser('byid@cegin.test', 'hash456');
    const byId = dbModule.getUserById(user.id);
    assert.equal(byId.email, 'byid@cegin.test');
  });

  it('returns undefined for non-existent email', () => {
    assert.equal(dbModule.getUserByEmail('nope@nope.nope'), undefined);
  });

  it('returns undefined for non-existent id', () => {
    assert.equal(dbModule.getUserById(999999), undefined);
  });
});
