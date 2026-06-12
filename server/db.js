const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'recipes.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    ingredients TEXT NOT NULL DEFAULT '[]',
    steps TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    prep_minutes INTEGER DEFAULT 0,
    cook_minutes INTEGER DEFAULT 0,
    servings INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// ingredients/steps/tags are stored as JSON strings; parse on the way out
function rowToRecipe(row) {
  if (!row) return null;
  return {
    ...row,
    ingredients: JSON.parse(row.ingredients),
    steps: JSON.parse(row.steps),
    tags: JSON.parse(row.tags),
  };
}

function listRecipes(search) {
  let rows;
  if (search) {
    rows = db
      .prepare(
        `SELECT * FROM recipes
         WHERE title LIKE @q OR description LIKE @q OR tags LIKE @q
         ORDER BY updated_at DESC`
      )
      .all({ q: `%${search}%` });
  } else {
    rows = db.prepare('SELECT * FROM recipes ORDER BY updated_at DESC').all();
  }
  return rows.map(rowToRecipe);
}

function getRecipe(id) {
  return rowToRecipe(db.prepare('SELECT * FROM recipes WHERE id = ?').get(id));
}

function createRecipe(r) {
  const result = db
    .prepare(
      `INSERT INTO recipes (title, description, ingredients, steps, tags, prep_minutes, cook_minutes, servings)
       VALUES (@title, @description, @ingredients, @steps, @tags, @prep_minutes, @cook_minutes, @servings)`
    )
    .run({
      title: r.title,
      description: r.description ?? '',
      ingredients: JSON.stringify(r.ingredients ?? []),
      steps: JSON.stringify(r.steps ?? []),
      tags: JSON.stringify(r.tags ?? []),
      prep_minutes: r.prep_minutes ?? 0,
      cook_minutes: r.cook_minutes ?? 0,
      servings: r.servings ?? 1,
    });
  return getRecipe(result.lastInsertRowid);
}

function updateRecipe(id, r) {
  const existing = getRecipe(id);
  if (!existing) return null;
  const merged = { ...existing, ...r };
  db.prepare(
    `UPDATE recipes SET
       title = @title, description = @description, ingredients = @ingredients,
       steps = @steps, tags = @tags, prep_minutes = @prep_minutes,
       cook_minutes = @cook_minutes, servings = @servings,
       updated_at = datetime('now')
     WHERE id = @id`
  ).run({
    id,
    title: merged.title,
    description: merged.description,
    ingredients: JSON.stringify(merged.ingredients),
    steps: JSON.stringify(merged.steps),
    tags: JSON.stringify(merged.tags),
    prep_minutes: merged.prep_minutes,
    cook_minutes: merged.cook_minutes,
    servings: merged.servings,
  });
  return getRecipe(id);
}

function deleteRecipe(id) {
  return db.prepare('DELETE FROM recipes WHERE id = ?').run(id).changes > 0;
}

module.exports = { db, listRecipes, getRecipe, createRecipe, updateRecipe, deleteRecipe };
