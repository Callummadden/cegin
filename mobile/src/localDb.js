import * as SQLite from 'expo-sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';

let _db = null;

export function getDb() {
  if (!_db) {
    _db = SQLite.openDatabaseSync('cegin.db');
    _db.execSync(`
      CREATE TABLE IF NOT EXISTS recipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL DEFAULT '',
        description TEXT DEFAULT '',
        ingredients TEXT DEFAULT '[]',
        steps TEXT DEFAULT '[]',
        tags TEXT DEFAULT '[]',
        prep_minutes INTEGER DEFAULT 0,
        cook_minutes INTEGER DEFAULT 0,
        servings INTEGER DEFAULT 0,
        image_url TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        collection TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        recipe_ids TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS favorites (
        recipe_id INTEGER PRIMARY KEY
      );
      CREATE TABLE IF NOT EXISTS images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id INTEGER NOT NULL,
        uri TEXT NOT NULL DEFAULT '',
        type TEXT DEFAULT 'photo',
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
  }
  return _db;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function parseJsonFields(row) {
  if (!row) return row;
  const out = { ...row };
  for (const key of ['ingredients', 'steps', 'tags']) {
    if (typeof out[key] === 'string') {
      try { out[key] = JSON.parse(out[key]); } catch { out[key] = []; }
    }
  }
  return out;
}

function stringifyJsonFields(recipe) {
  const out = { ...recipe };
  for (const key of ['ingredients', 'steps', 'tags']) {
    if (out[key] !== undefined && typeof out[key] !== 'string') {
      out[key] = JSON.stringify(out[key]);
    }
  }
  return out;
}

// ── Recipes ────────────────────────────────────────────────────────────────

export async function listRecipes(search) {
  const db = getDb();
  let rows;
  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    rows = db.getAllSync(
      `SELECT * FROM recipes WHERE title LIKE ? OR description LIKE ? OR ingredients LIKE ? ORDER BY updated_at DESC`,
      [q, q, q],
    );
  } else {
    rows = db.getAllSync('SELECT * FROM recipes ORDER BY updated_at DESC');
  }
  return rows.map(parseJsonFields);
}

export async function getRecipe(id) {
  const db = getDb();
  const row = db.getFirstSync('SELECT * FROM recipes WHERE id = ?', [id]);
  if (!row) throw new Error('Recipe not found');
  return parseJsonFields(row);
}

export async function createRecipe(recipe) {
  const db = getDb();
  const r = stringifyJsonFields(recipe);
  const now = new Date().toISOString();
  const result = db.runSync(
    `INSERT INTO recipes (title, description, ingredients, steps, tags, prep_minutes, cook_minutes, servings, image_url, notes, collection, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      r.title || '',
      r.description || '',
      r.ingredients || '[]',
      r.steps || '[]',
      r.tags || '[]',
      r.prep_minutes || 0,
      r.cook_minutes || 0,
      r.servings || 0,
      r.image_url || '',
      r.notes || '',
      r.collection || '',
      now,
      now,
    ],
  );
  return getRecipe(result.lastInsertRowId);
}

export async function updateRecipe(id, recipe) {
  const db = getDb();
  const r = stringifyJsonFields(recipe);
  const now = new Date().toISOString();
  db.runSync(
    `UPDATE recipes SET title=?, description=?, ingredients=?, steps=?, tags=?, prep_minutes=?, cook_minutes=?, servings=?, image_url=?, notes=?, collection=?, updated_at=? WHERE id=?`,
    [
      r.title ?? '',
      r.description ?? '',
      r.ingredients ?? '[]',
      r.steps ?? '[]',
      r.tags ?? '[]',
      r.prep_minutes ?? 0,
      r.cook_minutes ?? 0,
      r.servings ?? 0,
      r.image_url ?? '',
      r.notes ?? '',
      r.collection ?? '',
      now,
      id,
    ],
  );
  return getRecipe(id);
}

export async function deleteRecipe(id) {
  const db = getDb();
  db.runSync('DELETE FROM recipes WHERE id = ?', [id]);
}

// ── Favorites ──────────────────────────────────────────────────────────────

export async function getFavorites() {
  const db = getDb();
  const rows = db.getAllSync('SELECT recipe_id FROM favorites');
  const map = {};
  for (const row of rows) {
    map[row.recipe_id] = true;
  }
  return map;
}

export async function addFavorite(id) {
  const db = getDb();
  db.runSync('INSERT OR IGNORE INTO favorites (recipe_id) VALUES (?)', [id]);
}

export async function removeFavorite(id) {
  const db = getDb();
  db.runSync('DELETE FROM favorites WHERE recipe_id = ?', [id]);
}

// ── Collections ────────────────────────────────────────────────────────────

export async function listCollections() {
  const db = getDb();
  const rows = db.getAllSync('SELECT * FROM collections ORDER BY name ASC');
  return rows.map((row) => {
    const out = { ...row };
    if (typeof out.recipe_ids === 'string') {
      try { out.recipe_ids = JSON.parse(out.recipe_ids); } catch { out.recipe_ids = []; }
    }
    return out;
  });
}

export async function createCollection(name) {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db.runSync(
    'INSERT INTO collections (name, recipe_ids, created_at) VALUES (?, ?, ?)',
    [name, '[]', now],
  );
  return { id: result.lastInsertRowId, name, recipe_ids: [], created_at: now };
}

export async function deleteCollection(id) {
  const db = getDb();
  db.runSync('DELETE FROM collections WHERE id = ?', [id]);
}

export async function addRecipeToCollection(collectionId, recipeId) {
  const db = getDb();
  const row = db.getFirstSync('SELECT recipe_ids FROM collections WHERE id = ?', [collectionId]);
  if (!row) throw new Error('Collection not found');
  let ids = [];
  try { ids = JSON.parse(row.recipe_ids); } catch {}
  if (!ids.includes(recipeId)) {
    ids.push(recipeId);
    db.runSync('UPDATE collections SET recipe_ids = ? WHERE id = ?', [JSON.stringify(ids), collectionId]);
  }
  return { id: collectionId, recipe_ids: ids };
}

export async function removeRecipeFromCollection(collectionId, recipeId) {
  const db = getDb();
  const row = db.getFirstSync('SELECT recipe_ids FROM collections WHERE id = ?', [collectionId]);
  if (!row) throw new Error('Collection not found');
  let ids = [];
  try { ids = JSON.parse(row.recipe_ids); } catch {}
  ids = ids.filter((id) => id !== recipeId);
  db.runSync('UPDATE collections SET recipe_ids = ? WHERE id = ?', [JSON.stringify(ids), collectionId]);
  return { id: collectionId, recipe_ids: ids };
}

// ── Collection aliases (api.js uses shorter names) ───────────────────────

export { addRecipeToCollection as addToCollection };
export { removeRecipeFromCollection as removeFromCollection };

// ── Recipe Collections (alternate list name) ──────────────────────────────

export async function listRecipeCollections() {
  return listCollections();
}

// ── Images ────────────────────────────────────────────────────────────────

export async function getImages(recipeId) {
  const db = getDb();
  return db.getAllSync('SELECT * FROM images WHERE recipe_id = ? ORDER BY created_at DESC', [recipeId]);
}

export async function addImage(recipeId, uri, type) {
  const db = getDb();
  const result = db.runSync(
    'INSERT INTO images (recipe_id, uri, type) VALUES (?, ?, ?)',
    [recipeId, uri, type || 'photo'],
  );
  return { id: result.lastInsertRowId, recipe_id: recipeId, uri, type: type || 'photo' };
}

export async function deleteImage(imageId) {
  const db = getDb();
  db.runSync('DELETE FROM images WHERE id = ?', [imageId]);
}

// Auth removed — app is open source, no login required.
