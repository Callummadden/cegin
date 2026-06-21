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
  'prep_minutes', 'cook_minutes', 'servings', 'image_url', 'notes', 'collection',
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
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// ─── Push Tokens (Expo push notification tokens per device) ──────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS push_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    device_name TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
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
    UNIQUE(user_id, date, meal)
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
    consumed INTEGER DEFAULT 0
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
      if (!meals || typeof meals !== 'object') continue;
      for (const [meal, recipeId] of Object.entries(meals)) {
        const id = parseInt(recipeId, 10);
        if (id > 0) {
          upsert.run({ user_id: userId, date, meal, recipe_id: id });
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

// Format date as YYYY-MM-DD in local time (matches client-side formatDate)
function localDateStr(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTodayMeals(userId) {
  const today = localDateStr();
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

// ─── Cook Stats (kitchen log, streaks, cook counts) ─────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS cook_stats (
    user_id INTEGER PRIMARY KEY,
    cook_count INTEGER DEFAULT 0,
    total_steps INTEGER DEFAULT 0,
    recipe_cook_counts TEXT DEFAULT '{}',
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS cook_dates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    cook_date TEXT NOT NULL,
    UNIQUE(user_id, cook_date)
  )
`);

function getStats(userId) {
  const uid = userId || 0;
  const row = db.prepare('SELECT * FROM cook_stats WHERE user_id = ?').get(uid);
  if (!row) return { cookCount: 0, totalSteps: 0, recipeCookCounts: {} };
  let recipeCookCounts;
  try { recipeCookCounts = JSON.parse(row.recipe_cook_counts); } catch { recipeCookCounts = {}; }
  return { cookCount: row.cook_count, totalSteps: row.total_steps, recipeCookCounts };
}

function getCookDates(userId) {
  const uid = userId || 0;
  return db.prepare('SELECT cook_date FROM cook_dates WHERE user_id = ? ORDER BY cook_date DESC').all(uid).map(r => r.cook_date);
}

function recordCook(userId, recipeId, recipeTitle, stepCount) {
  const uid = userId || 0;
  const stats = getStats(uid);

  // Update stats
  const newCookCount = stats.cookCount + 1;
  const newTotalSteps = stats.totalSteps + (stepCount || 0);
  const counts = { ...stats.recipeCookCounts };
  if (!counts[recipeId]) counts[recipeId] = { title: recipeTitle, count: 0 };
  counts[recipeId].count += 1;
  counts[recipeId].title = recipeTitle;

  db.prepare(`
    INSERT INTO cook_stats (user_id, cook_count, total_steps, recipe_cook_counts, updated_at)
    VALUES (@user_id, @cook_count, @total_steps, @recipe_cook_counts, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      cook_count = @cook_count,
      total_steps = @total_steps,
      recipe_cook_counts = @recipe_cook_counts,
      updated_at = datetime('now')
  `).run({
    user_id: uid,
    cook_count: newCookCount,
    total_steps: newTotalSteps,
    recipe_cook_counts: JSON.stringify(counts),
  });

  // Record cook date
  const today = localDateStr();
  db.prepare('INSERT OR IGNORE INTO cook_dates (user_id, cook_date) VALUES (?, ?)').run(uid, today);

  return getStats(uid);
}

function getCookingStreak(userId) {
  const dates = getCookDates(userId);
  if (dates.length === 0) return 0;

  const today = localDateStr();
  const yesterday = localDateStr(new Date(Date.now() - 86400000));

  // Streak must include today or yesterday to be active
  if (dates[0] !== today && dates[0] !== yesterday) return 0;

  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1]);
    const curr = new Date(dates[i]);
    const diffDays = Math.round((prev - curr) / 86400000);
    if (diffDays === 1) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

function clearStats(userId) {
  const uid = userId || 0;
  db.prepare('DELETE FROM cook_stats WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM cook_dates WHERE user_id = ?').run(uid);
}

function getTopRecipes(userId, limit = 5) {
  const stats = getStats(userId);
  return Object.entries(stats.recipeCookCounts)
    .map(([id, { title, count }]) => ({ id, title, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// ─── Dietary Profiles ────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS dietary_profiles (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    needs TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

function getDietaryProfiles(userId) {
  const uid = userId || 0;
  return db.prepare('SELECT * FROM dietary_profiles WHERE user_id = ? ORDER BY created_at DESC').all(uid);
}

function upsertDietaryProfiles(userId, profiles) {
  const uid = userId || 0;
  const txn = db.transaction(() => {
    // Delete existing profiles for this user
    db.prepare('DELETE FROM dietary_profiles WHERE user_id = ?').run(uid);
    // Insert new ones
    const insert = db.prepare('INSERT INTO dietary_profiles (id, user_id, name, needs, notes) VALUES (?, ?, ?, ?, ?)');
    for (const p of profiles) {
      insert.run(p.id || `p${Date.now().toString(36)}`, uid, p.name || '', p.needs || '', p.notes || '');
    }
  });
  txn();
  return getDietaryProfiles(uid);
}

function clearDietaryProfiles(userId) {
  const uid = userId || 0;
  db.prepare('DELETE FROM dietary_profiles WHERE user_id = ?').run(uid);
}

// ─── Cookbook Entries (kitchen log with photos) ──────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS cookbook_entries (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    recipe_id INTEGER,
    recipe_title TEXT DEFAULT '',
    image_path TEXT DEFAULT '',
    date TEXT DEFAULT (datetime('now')),
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

function getCookbookEntries(userId) {
  const uid = userId || 0;
  return db.prepare('SELECT * FROM cookbook_entries WHERE user_id = ? ORDER BY date DESC').all(uid);
}

function addCookbookEntry(userId, entry) {
  const uid = userId || 0;
  const id = entry.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  db.prepare('INSERT INTO cookbook_entries (id, user_id, recipe_id, recipe_title, image_path, date, notes) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, uid, entry.recipeId || null, entry.recipeTitle || '', entry.imagePath || '', entry.date || new Date().toISOString(), entry.notes || ''
  );
  return db.prepare('SELECT * FROM cookbook_entries WHERE id = ?').get(id);
}

function updateCookbookEntry(id, userId, updates) {
  const uid = userId || 0;
  const existing = db.prepare('SELECT * FROM cookbook_entries WHERE id = ? AND user_id = ?').get(id, uid);
  if (!existing) return null;
  db.prepare('UPDATE cookbook_entries SET recipe_title = ?, image_path = ?, notes = ?, date = ? WHERE id = ?').run(
    updates.recipeTitle ?? existing.recipe_title,
    updates.imagePath ?? existing.image_path,
    updates.notes ?? existing.notes,
    updates.date ?? existing.date,
    id
  );
  return db.prepare('SELECT * FROM cookbook_entries WHERE id = ?').get(id);
}

function deleteCookbookEntry(id, userId) {
  const uid = userId || 0;
  const entry = db.prepare('SELECT * FROM cookbook_entries WHERE id = ? AND user_id = ?').get(id, uid);
  if (!entry) return null;
  db.prepare('DELETE FROM cookbook_entries WHERE id = ?').run(id);
  return entry;
}

function clearCookbookEntries(userId) {
  const uid = userId || 0;
  const entries = db.prepare("SELECT image_path FROM cookbook_entries WHERE user_id = ? AND image_path != ''").all(uid);
  db.prepare('DELETE FROM cookbook_entries WHERE user_id = ?').run(uid);
  return entries.map(e => e.image_path).filter(Boolean);
}

// ─── Shopping List ───────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS shopping_list (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    checked INTEGER DEFAULT 0,
    category TEXT DEFAULT '',
    source TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

function getShoppingList(userId) {
  const uid = userId || 0;
  return db.prepare('SELECT * FROM shopping_list WHERE user_id = ? ORDER BY created_at DESC').all(uid).map(r => ({
    id: r.id, text: r.text, checked: !!r.checked, category: r.category, source: r.source,
  }));
}

function syncShoppingList(userId, items) {
  const uid = userId || 0;
  const txn = db.transaction(() => {
    db.prepare('DELETE FROM shopping_list WHERE user_id = ?').run(uid);
    const insert = db.prepare('INSERT INTO shopping_list (id, user_id, text, checked, category, source) VALUES (?, ?, ?, ?, ?, ?)');
    for (const item of items) {
      insert.run(item.id, uid, item.text || '', item.checked ? 1 : 0, item.category || '', item.source || '');
    }
  });
  txn();
  return getShoppingList(uid);
}

function clearShoppingList(userId) {
  const uid = userId || 0;
  db.prepare('DELETE FROM shopping_list WHERE user_id = ?').run(uid);
}

// ─── Favorites ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER NOT NULL,
    recipe_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, recipe_id)
  )
`);

function getFavorites(userId) {
  const uid = userId || 0;
  const rows = db.prepare('SELECT recipe_id FROM favorites WHERE user_id = ?').all(uid);
  const map = {};
  for (const r of rows) map[r.recipe_id] = true;
  return map;
}

function syncFavorites(userId, favs) {
  const uid = userId || 0;
  const txn = db.transaction(() => {
    db.prepare('DELETE FROM favorites WHERE user_id = ?').run(uid);
    const insert = db.prepare('INSERT INTO favorites (user_id, recipe_id) VALUES (?, ?)');
    for (const [id, val] of Object.entries(favs)) {
      if (val) insert.run(uid, Number(id));
    }
  });
  txn();
  return getFavorites(uid);
}

function clearFavorites(userId) {
  const uid = userId || 0;
  db.prepare('DELETE FROM favorites WHERE user_id = ?').run(uid);
}

// ─── Chat History ───────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS chat_history (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT DEFAULT '',
    messages TEXT DEFAULT '[]',
    timestamp INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

function getChatHistory(userId) {
  const uid = userId || 0;
  const rows = db.prepare('SELECT * FROM chat_history WHERE user_id = ? ORDER BY timestamp DESC LIMIT 50').all(uid);
  return rows.map(r => {
    let messages;
    try { messages = JSON.parse(r.messages); } catch { messages = []; }
    return { id: r.id, title: r.title, messages, timestamp: r.timestamp };
  });
}

function syncChatHistory(userId, history) {
  const uid = userId || 0;
  const txn = db.transaction(() => {
    db.prepare('DELETE FROM chat_history WHERE user_id = ?').run(uid);
    const insert = db.prepare('INSERT INTO chat_history (id, user_id, title, messages, timestamp) VALUES (?, ?, ?, ?, ?)');
    for (const conv of history) {
      insert.run(conv.id, uid, conv.title || '', JSON.stringify(conv.messages || []), conv.timestamp || 0);
    }
  });
  txn();
  return getChatHistory(uid);
}

function clearChatHistory(userId) {
  const uid = userId || 0;
  db.prepare('DELETE FROM chat_history WHERE user_id = ?').run(uid);
}

// ─── Activity Context ──────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS activity_context (
    user_id INTEGER PRIMARY KEY,
    date TEXT,
    level TEXT DEFAULT '',
    description TEXT DEFAULT '',
    metrics TEXT DEFAULT '{}',
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

function getActivityContext(userId) {
  const uid = userId || 0;
  const row = db.prepare('SELECT * FROM activity_context WHERE user_id = ?').get(uid);
  if (!row) return null;
  let metrics;
  try { metrics = JSON.parse(row.metrics); } catch { metrics = {}; }
  return { date: row.date, level: row.level, description: row.description, metrics };
}

function syncActivityContext(userId, context) {
  const uid = userId || 0;
  db.prepare(`
    INSERT INTO activity_context (user_id, date, level, description, metrics, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      date = excluded.date, level = excluded.level,
      description = excluded.description, metrics = excluded.metrics,
      updated_at = datetime('now')
  `).run(uid, context.date || '', context.level || '', context.description || '', JSON.stringify(context.metrics || {}));
  return getActivityContext(uid);
}

function clearActivityContext(userId) {
  const uid = userId || 0;
  db.prepare('DELETE FROM activity_context WHERE user_id = ?').run(uid);
}

// ─── Terry Vision Scans ─────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS terry_vision_scans (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    section TEXT NOT NULL,
    image_path TEXT NOT NULL,
    ingredients TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

function getTerryVisionScans(userId) {
  const uid = userId || 0;
  return db.prepare('SELECT * FROM terry_vision_scans WHERE user_id = ? ORDER BY created_at ASC').all(uid);
}

function addTerryVisionScan(userId, { id, section, imagePath, ingredients }) {
  const uid = userId || 0;
  db.prepare('INSERT INTO terry_vision_scans (id, user_id, section, image_path, ingredients) VALUES (?, ?, ?, ?, ?)').run(
    id, uid, section, imagePath, JSON.stringify(ingredients || [])
  );
  return db.prepare('SELECT * FROM terry_vision_scans WHERE id = ?').get(id);
}

function deleteTerryVisionScan(userId, scanId) {
  const uid = userId || 0;
  const scan = db.prepare('SELECT * FROM terry_vision_scans WHERE id = ? AND user_id = ?').get(scanId, uid);
  if (scan) {
    db.prepare('DELETE FROM terry_vision_scans WHERE id = ?').run(scanId);
  }
  return scan;
}

function clearTerryVisionScans(userId) {
  const uid = userId || 0;
  const scans = db.prepare("SELECT image_path FROM terry_vision_scans WHERE user_id = ? AND image_path != ''").all(uid);
  db.prepare('DELETE FROM terry_vision_scans WHERE user_id = ?').run(uid);
  return scans;
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
  // Cook stats
  getStats, getCookDates, recordCook, getCookingStreak, clearStats, getTopRecipes,
  // Dietary profiles
  getDietaryProfiles, upsertDietaryProfiles, clearDietaryProfiles,
  // Cookbook entries
  getCookbookEntries, addCookbookEntry, updateCookbookEntry, deleteCookbookEntry, clearCookbookEntries,
  // Shopping list
  getShoppingList, syncShoppingList, clearShoppingList,
  // Favorites
  getFavorites, syncFavorites, clearFavorites,
  // Chat history
  getChatHistory, syncChatHistory, clearChatHistory,
  // Activity context
  getActivityContext, syncActivityContext, clearActivityContext,
  // Terry Vision scans
  getTerryVisionScans, addTerryVisionScan, deleteTerryVisionScan, clearTerryVisionScans,
  // Utils
  localDateStr,
};
