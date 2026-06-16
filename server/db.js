const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'recipes.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON'); // S2-8: Enable FK CASCADE

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
    image_url TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// Migrate: add columns if the table was created before they existed.
// Silently ignore 'duplicate column' errors, log anything else.
for (const stmt of [
  `ALTER TABLE recipes ADD COLUMN image_url TEXT DEFAULT ''`,
  `ALTER TABLE recipes ADD COLUMN notes TEXT DEFAULT ''`,
  `ALTER TABLE recipes ADD COLUMN collection TEXT DEFAULT ''`,
  `ALTER TABLE recipes ADD COLUMN user_id INTEGER DEFAULT 0`, // S2-7
]) {
  try {
    db.exec(stmt);
  } catch (e) {
    if (!/duplicate column/i.test(e.message)) {
      console.error('Migration error:', e.message);
    }
  }
}

// ingredients/steps/tags are stored as JSON strings; parse on the way out
function rowToRecipe(row) {
  if (!row) return null;
  let ingredients, steps, tags;
  try { ingredients = JSON.parse(row.ingredients); } catch { ingredients = []; }
  try { steps = JSON.parse(row.steps); } catch { steps = []; }
  try { tags = JSON.parse(row.tags); } catch { tags = []; }
  return {
    ...row,
    ingredients,
    steps,
    tags,
  };
}

// S2-14: Whitelist of allowed fields for updateRecipe
const RECIPE_ALLOWED_FIELDS = new Set([
  'title', 'description', 'ingredients', 'steps', 'tags',
  'cookTime', 'prepTime', 'servings', 'image',
  'prep_minutes', 'cook_minutes', 'image_url', 'notes', 'collection',
]);

// S2-7: listRecipes scoped by userId
function listRecipes(search, userId) {
  let rows;
  const userIdFilter = userId ? ' AND user_id = @userId' : '';
  if (search) {
    const escaped = search.replace(/%/g, '\\%').replace(/_/g, '\\_');
    rows = db
      .prepare(
        `SELECT * FROM recipes
         WHERE (title LIKE @q ESCAPE '\\' OR description LIKE @q ESCAPE '\\' OR tags LIKE @q ESCAPE '\\' OR ingredients LIKE @q ESCAPE '\\')${userIdFilter}
         ORDER BY updated_at DESC`
      )
      .all({ q: `%${escaped}%`, userId });
  } else {
    if (userId) {
      rows = db.prepare('SELECT * FROM recipes WHERE user_id = @userId ORDER BY updated_at DESC').all({ userId });
    } else {
      rows = db.prepare('SELECT * FROM recipes ORDER BY updated_at DESC').all();
    }
  }
  return rows.map(rowToRecipe);
}

// S2-7: getRecipe scoped by userId
function getRecipe(id, userId) {
  if (userId) {
    return rowToRecipe(db.prepare('SELECT * FROM recipes WHERE id = @id AND user_id = @userId').get({ id, userId }));
  }
  return rowToRecipe(db.prepare('SELECT * FROM recipes WHERE id = @id').get({ id }));
}

function createRecipe(r, userId) { // S2-7: accept userId
  const result = db
    .prepare(
      `INSERT INTO recipes (title, description, ingredients, steps, tags, prep_minutes, cook_minutes, servings, image_url, notes, collection, user_id)
       VALUES (@title, @description, @ingredients, @steps, @tags, @prep_minutes, @cook_minutes, @servings, @image_url, @notes, @collection, @user_id)`
    )
    .run({
      title: r.title,
      description: r.description ?? '',
      ingredients: JSON.stringify(Array.isArray(r.ingredients) ? r.ingredients : []),
      steps: JSON.stringify(Array.isArray(r.steps) ? r.steps : []),
      tags: JSON.stringify(Array.isArray(r.tags) ? r.tags : []),
      prep_minutes: r.prep_minutes ?? 0,
      cook_minutes: r.cook_minutes ?? 0,
      servings: r.servings ?? 1,
      image_url: r.image_url ?? '',
      notes: r.notes ?? '',
      collection: r.collection ?? '',
      user_id: userId || 0, // S2-7
    });
  return getRecipe(result.lastInsertRowid, userId);
}

// S2-7: updateRecipe scoped by userId; S2-14: whitelist fields
function updateRecipe(id, r, userId) {
  const existing = getRecipe(id, userId);
  if (!existing) return null;
  // S2-14: Strip any fields not in the whitelist
  const safe = {};
  for (const key of Object.keys(r)) {
    if (RECIPE_ALLOWED_FIELDS.has(key)) {
      safe[key] = r[key];
    }
  }
  const merged = { ...existing, ...safe };
  if (!Array.isArray(merged.ingredients)) merged.ingredients = [];
  if (!Array.isArray(merged.steps)) merged.steps = [];
  if (!Array.isArray(merged.tags)) merged.tags = [];
  db.prepare(
    `UPDATE recipes SET
       title = @title, description = @description, ingredients = @ingredients,
       steps = @steps, tags = @tags, prep_minutes = @prep_minutes,
       cook_minutes = @cook_minutes, servings = @servings,
       image_url = @image_url,
       notes = @notes, collection = @collection,
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
    image_url: merged.image_url ?? '',
    notes: merged.notes ?? '',
    collection: merged.collection ?? '',
  });
  return getRecipe(id, userId);
}

// S2-7: deleteRecipe scoped by userId
function deleteRecipe(id, userId) {
  if (userId) {
    return db.prepare('DELETE FROM recipes WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
  }
  return db.prepare('DELETE FROM recipes WHERE id = ?').run(id).changes > 0;
}

// S2-7: getDistinctCollections scoped by userId
function getDistinctCollections(userId) {
  const userIdFilter = userId ? ' AND user_id = @userId' : '';
  return db
    .prepare(`SELECT DISTINCT collection FROM recipes WHERE collection != ''${userIdFilter} ORDER BY collection`)
    .all({ userId })
    .map((r) => r.collection);
}

// S2-6: ESCAPE clause on LIKE; S2-7: userId scope
function searchByIngredients(ingredientList, userId) {
  if (!ingredientList || ingredientList.length === 0) return [];
  const userIdFilter = userId ? ` AND user_id = @userId` : '';
  const likeClauses = ingredientList.map(
    (_, i) => `CASE WHEN ingredients LIKE @p${i} ESCAPE '\\' THEN 1 ELSE 0 END`
  );
  const matchExpr = likeClauses.join(' + ');
  const sql = `
    SELECT *, (${matchExpr}) AS match_count
    FROM recipes
    WHERE (${matchExpr}) > 0${userIdFilter}
    ORDER BY match_count DESC, updated_at DESC
  `;
  const params = { userId };
  ingredientList.forEach((ing, i) => {
    const escaped = ing.trim().toLowerCase().replace(/%/g, '\\%').replace(/_/g, '\\_');
    params[`p${i}`] = `%${escaped}%`;
  });
  return db.prepare(sql).all(params).map(rowToRecipe);
}

// --- Collections ---

db.exec(`
  CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    recipe_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Migrate: add user_id column to collections
for (const stmt of [
  `ALTER TABLE collections ADD COLUMN user_id INTEGER DEFAULT 0`, // S2-7
]) {
  try {
    db.exec(stmt);
  } catch (e) {
    if (!/duplicate column/i.test(e.message)) {
      console.error('Migration error:', e.message);
    }
  }
}

// S2-7: listCollections scoped by userId
function listCollections(userId) {
  const userIdFilter = userId ? ' WHERE user_id = @userId' : '';
  return db.prepare(`SELECT * FROM collections${userIdFilter} ORDER BY name`).all({ userId }).map((row) => {
    let recipe_ids;
    try { recipe_ids = JSON.parse(row.recipe_ids); } catch { recipe_ids = []; }
    return { ...row, recipe_ids };
  });
}

// S2-7: getCollection scoped by userId
function getCollection(id, userId) {
  if (userId) {
    const row = db.prepare('SELECT * FROM collections WHERE id = @id AND user_id = @userId').get({ id, userId });
    if (!row) return null;
    let recipe_ids;
    try { recipe_ids = JSON.parse(row.recipe_ids); } catch { recipe_ids = []; }
    return { ...row, recipe_ids };
  }
  const row = db.prepare('SELECT * FROM collections WHERE id = ?').get(id);
  if (!row) return null;
  let recipe_ids;
  try { recipe_ids = JSON.parse(row.recipe_ids); } catch { recipe_ids = []; }
  return { ...row, recipe_ids };
}

// S2-9: Wrap in try/catch for UNIQUE constraint; S2-7: accept userId
function createCollection(name, userId) {
  try {
    const result = db.prepare('INSERT INTO collections (name, user_id) VALUES (@name, @user_id)').run({
      name: name.trim(),
      user_id: userId || 0,
    });
    return getCollection(result.lastInsertRowid, userId);
  } catch (e) {
    if (/UNIQUE constraint/i.test(e.message)) {
      const err = new Error('A collection with that name already exists.');
      err.status = 409;
      throw err;
    }
    throw e;
  }
}

// S2-7: updateCollection scoped by userId
function updateCollection(id, { name, recipe_ids }, userId) {
  const existing = getCollection(id, userId);
  if (!existing) return null;
  const trimmedName = name?.trim();
  try {
    db.prepare('UPDATE collections SET name = @name, recipe_ids = @recipe_ids WHERE id = @id').run({
      id,
      name: (trimmedName && trimmedName.length > 0) ? trimmedName : existing.name,
      recipe_ids: JSON.stringify(recipe_ids ?? existing.recipe_ids),
    });
  } catch (e) {
    if (/UNIQUE constraint/i.test(e.message)) {
      const err = new Error('A collection with that name already exists.');
      err.status = 409;
      throw err;
    }
    throw e;
  }
  return getCollection(id, userId);
}

// S2-7: deleteCollection scoped by userId
function deleteCollection(id, userId) {
  if (userId) {
    return db.prepare('DELETE FROM collections WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
  }
  return db.prepare('DELETE FROM collections WHERE id = ?').run(id).changes > 0;
}

// S2-7: addRecipeToCollection scoped by userId; S2-13: Number() coercion already present
function addRecipeToCollection(collectionId, recipeId, userId) {
  const col = getCollection(collectionId, userId);
  if (!col) return null;
  const numRecipeId = Number(recipeId);
  if (!col.recipe_ids.map(Number).includes(numRecipeId)) {
    col.recipe_ids.push(numRecipeId);
    return updateCollection(collectionId, { recipe_ids: col.recipe_ids }, userId);
  }
  return col;
}

// S2-7: removeRecipeFromCollection scoped by userId; S2-13: Number() coercion already present
function removeRecipeFromCollection(collectionId, recipeId, userId) {
  const col = getCollection(collectionId, userId);
  if (!col) return null;
  const numRecipeId = Number(recipeId);
  col.recipe_ids = col.recipe_ids.filter((id) => Number(id) !== numRecipeId);
  return updateCollection(collectionId, { recipe_ids: col.recipe_ids }, userId);
}

// --- Recipe Images ---

db.exec(`
  CREATE TABLE IF NOT EXISTS recipe_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL,
    image_url TEXT NOT NULL,
    position INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
  )
`);

function getRecipeImages(recipeId, userId) {
  if (userId) {
    const recipe = getRecipe(recipeId, userId);
    if (!recipe) return [];
  }
  return db.prepare('SELECT * FROM recipe_images WHERE recipe_id = ? ORDER BY position').all(recipeId);
}

function addRecipeImage(recipeId, imageUrl, userId) {
  if (userId) {
    const recipe = getRecipe(recipeId, userId);
    if (!recipe) return null;
  }
  const maxPos = db.prepare('SELECT MAX(position) as p FROM recipe_images WHERE recipe_id = ?').get(recipeId);
  const pos = (maxPos?.p ?? -1) + 1;
  const result = db.prepare('INSERT INTO recipe_images (recipe_id, image_url, position) VALUES (?, ?, ?)').run(recipeId, imageUrl, pos);
  return db.prepare('SELECT * FROM recipe_images WHERE id = ?').get(result.lastInsertRowid);
}

function deleteRecipeImage(id, userId) {
  if (userId) {
    const image = db.prepare('SELECT * FROM recipe_images WHERE id = ?').get(id);
    if (!image) return false;
    const recipe = getRecipe(image.recipe_id, userId);
    if (!recipe) return false;
  }
  return db.prepare('DELETE FROM recipe_images WHERE id = ?').run(id).changes > 0;
}

// ─── Users ─────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

function createUser(email, passwordHash, displayName) {
  const result = db.prepare(
    'INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)'
  ).run(email, passwordHash, displayName || '');
  return getUserById(result.lastInsertRowid);
}

function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// ─── Notification Subscriptions ───────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS notification_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    morning_digest INTEGER DEFAULT 1,
    perishable_alerts INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

// ─── Push Tokens (Expo push notification tokens per device) ──────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS push_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    device_name TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

// ─── Meal Plans (server-side sync from mobile) ───────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS meal_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    meal TEXT NOT NULL,
    recipe_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, date, meal),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE SET NULL
  )
`);

// ─── Scanned Items (from Terry Vision fridge scans) ─────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS scanned_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    scanned_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,
    consumed INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

// ─── Notification Subscriptions CRUD ─────────────────────────────────────

function getNotificationSubscription(userId) {
  return db.prepare('SELECT * FROM notification_subscriptions WHERE user_id = ?').get(userId);
}

function upsertNotificationSubscription(userId, { morning_digest, perishable_alerts }) {
  const existing = getNotificationSubscription(userId);
  if (existing) {
    db.prepare(`
      UPDATE notification_subscriptions SET
        morning_digest = COALESCE(@morning_digest, morning_digest),
        perishable_alerts = COALESCE(@perishable_alerts, perishable_alerts),
        updated_at = datetime('now')
      WHERE user_id = @user_id
    `).run({
      user_id: userId,
      morning_digest: morning_digest ?? null,
      perishable_alerts: perishable_alerts ?? null,
    });
  } else {
    db.prepare(`
      INSERT INTO notification_subscriptions (user_id, morning_digest, perishable_alerts)
      VALUES (@user_id, @morning_digest, @perishable_alerts)
    `).run({
      user_id: userId,
      morning_digest: morning_digest ?? 1,
      perishable_alerts: perishable_alerts ?? 1,
    });
  }
  return getNotificationSubscription(userId);
}

// ─── Push Tokens CRUD ────────────────────────────────────────────────────

function registerPushToken(userId, token, deviceName) {
  // Upsert — update if token exists, insert if new
  const existing = db.prepare('SELECT * FROM push_tokens WHERE token = ?').get(token);
  if (existing) {
    // Token already registered — update user_id in case they logged into a different account
    db.prepare('UPDATE push_tokens SET user_id = ?, device_name = COALESCE(?, device_name) WHERE token = ?')
      .run(userId, deviceName || null, token);
  } else {
    db.prepare('INSERT INTO push_tokens (user_id, token, device_name) VALUES (?, ?, ?)')
      .run(userId, token, deviceName || '');
  }
  return db.prepare('SELECT * FROM push_tokens WHERE token = ?').get(token);
}

function removePushToken(token) {
  return db.prepare('DELETE FROM push_tokens WHERE token = ?').run(token).changes > 0;
}

function getUserPushTokens(userId) {
  return db.prepare('SELECT token FROM push_tokens WHERE user_id = ?').all(userId).map(r => r.token);
}

// ─── Meal Plans CRUD ─────────────────────────────────────────────────────

function syncMealPlan(userId, plan) {
  // plan is { "2026-06-16": { breakfast: recipeId, dinner: recipeId }, ... }
  const upsert = db.prepare(`
    INSERT INTO meal_plans (user_id, date, meal, recipe_id, updated_at)
    VALUES (@user_id, @date, @meal, @recipe_id, datetime('now'))
    ON CONFLICT(user_id, date, meal) DO UPDATE SET
      recipe_id = @recipe_id, updated_at = datetime('now')
  `);
  const deleteOld = db.prepare('DELETE FROM meal_plans WHERE user_id = ?');

  const txn = db.transaction(() => {
    deleteOld.run(userId);
    for (const [date, meals] of Object.entries(plan || {})) {
      for (const [meal, recipeId] of Object.entries(meals)) {
        if (recipeId) {
          upsert.run({ user_id: userId, date, meal, recipe_id: recipeId });
        }
      }
    }
  });
  txn();
  return getMealPlan(userId);
}

function getMealPlan(userId) {
  const rows = db.prepare('SELECT * FROM meal_plans WHERE user_id = ? ORDER BY date').all(userId);
  const plan = {};
  for (const row of rows) {
    if (!plan[row.date]) plan[row.date] = {};
    plan[row.date][row.meal] = row.recipe_id;
  }
  return plan;
}

function getTodayMeals(userId) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return db.prepare(`
    SELECT mp.*, r.title, r.prep_minutes, r.cook_minutes, r.ingredients
    FROM meal_plans mp
    LEFT JOIN recipes r ON r.id = mp.recipe_id
    WHERE mp.user_id = ? AND mp.date = ?
  `).all(userId, today);
}

// ─── Scanned Items CRUD ──────────────────────────────────────────────────

function addScannedItem(userId, itemName, expiresAt) {
  const result = db.prepare(`
    INSERT INTO scanned_items (user_id, item_name, expires_at)
    VALUES (@user_id, @item_name, @expires_at)
  `).run({ user_id: userId, item_name: itemName, expires_at: expiresAt || null });
  return db.prepare('SELECT * FROM scanned_items WHERE id = ?').get(result.lastInsertRowid);
}

function getScannedItems(userId, includeConsumed = false) {
  const consumedFilter = includeConsumed ? '' : ' AND consumed = 0';
  return db.prepare(`SELECT * FROM scanned_items WHERE user_id = ?${consumedFilter} ORDER BY scanned_at DESC`).all(userId);
}

function markItemConsumed(id, userId) {
  return db.prepare('UPDATE scanned_items SET consumed = 1 WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

function getExpiringItems(userId, withinDays = 2) {
  // Items that expire within N days from now, not yet consumed
  return db.prepare(`
    SELECT * FROM scanned_items
    WHERE user_id = ?
      AND consumed = 0
      AND expires_at IS NOT NULL
      AND expires_at <= datetime('now', '+' || ? || ' days')
      AND expires_at >= datetime('now')
    ORDER BY expires_at ASC
  `).all(userId, withinDays);
}

function getExpiredItems(userId) {
  return db.prepare(`
    SELECT * FROM scanned_items
    WHERE user_id = ?
      AND consumed = 0
      AND expires_at IS NOT NULL
      AND expires_at < datetime('now')
    ORDER BY expires_at ASC
  `).all(userId);
}

// Get all users who have notification subscriptions with push tokens
function getSubscribedUsers() {
  return db.prepare(`
    SELECT ns.*, u.email, u.display_name,
      GROUP_CONCAT(pt.token) as push_tokens_csv
    FROM notification_subscriptions ns
    JOIN users u ON u.id = ns.user_id
    LEFT JOIN push_tokens pt ON pt.user_id = ns.user_id
    GROUP BY ns.user_id
    HAVING push_tokens_csv IS NOT NULL
  `).all().map(row => ({
    ...row,
    push_tokens: row.push_tokens_csv ? row.push_tokens_csv.split(',') : [],
  }));
}

module.exports = {
  db, listRecipes, getRecipe, createRecipe, updateRecipe, deleteRecipe,
  getDistinctCollections,
  searchByIngredients,
  listCollections, getCollection, createCollection, updateCollection, deleteCollection,
  addRecipeToCollection, removeRecipeFromCollection,
  getRecipeImages, addRecipeImage, deleteRecipeImage,
  createUser, getUserByEmail, getUserById,
  // Notifications
  getNotificationSubscription, upsertNotificationSubscription, getSubscribedUsers,
  registerPushToken, removePushToken, getUserPushTokens,
  // Meal plans
  syncMealPlan, getMealPlan, getTodayMeals,
  // Scanned items
  addScannedItem, getScannedItems, markItemConsumed, getExpiringItems, getExpiredItems,
};
