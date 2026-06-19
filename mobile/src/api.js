import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  isOnline,
  setOnline,
  cacheRecipes,
  getCachedRecipes,
  cacheRecipe,
  getCachedRecipe,
  addPendingChange,
  getPendingChanges,
  clearPendingChanges,
} from './offlineCache';
import { getServerUrl, setServerUrl, getAppMode, hasCustomAI } from './config';
import * as localDb from './localDb';
import * as localAi from './localAi';

export { getServerUrl, setServerUrl };

const REQUEST_TIMEOUT = 8000; // 8s — long enough for slow mobile, short enough to feel responsive
const AI_REQUEST_TIMEOUT = 60000; // 60s — AI responses can take a while depending on the model

async function request(path, options = {}) {
  const base = await getServerUrl();
  if (!base) {
    throw new Error('No server configured. Set the server URL in Settings.');
  }
  const headers = { 'Content-Type': 'application/json' };
  const controller = new AbortController();
  const isAI = path.startsWith('/ai/') || path.startsWith('/ai?');
  const timeout = isAI ? AI_REQUEST_TIMEOUT : REQUEST_TIMEOUT;
  const timer = setTimeout(() => controller.abort(), timeout);
  const url = `${base}/api${path}`;
  try {
    console.log(`[API] ${options.method || 'GET'} ${url}`);
    const res = await fetch(url, {
      ...options,
      headers: { ...headers, ...options.headers },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      console.error(`[API] ${res.status} ${url}: ${errorText}`);
      let message = `Request failed (${res.status})`;
      try {
        const body = JSON.parse(errorText);
        if (body.error) message = body.error;
      } catch {}
      throw new Error(message);
    }
    if (res.status === 204) return null;
    return res.json();
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      console.error(`[API] Timeout ${url}`);
      throw new Error('Server unreachable — working offline');
    }
    console.error(`[API] Error ${url}:`, e.message);
    throw e;
  }
}

// Fast online check — reuses the 2s ping from offlineCache
async function checkOnline() {
  const online = await isOnline();
  if (!online) throw new Error('Offline — using cached data');
}

// ── Sync pending changes ─────────────────────────────────────────────────────

export async function syncPendingChanges() {
  const online = await isOnline();
  if (!online) return;

  const changes = await getPendingChanges();
  if (changes.length === 0) return;

  const failed = [];
  for (const change of changes) {
    try {
      switch (change.type) {
        case 'create':
          await request('/recipes', { method: 'POST', body: JSON.stringify(change.data) });
          break;
        case 'update':
          await request(`/recipes/${change.id}`, { method: 'PUT', body: JSON.stringify(change.data) });
          break;
        case 'delete':
          await request(`/recipes/${change.id}`, { method: 'DELETE' });
          break;
        case 'create_collection':
          await request('/collections', { method: 'POST', body: JSON.stringify(change.data) });
          break;
        case 'delete_collection':
          await request(`/collections/${change.id}`, { method: 'DELETE' });
          break;
      }
    } catch {
      failed.push(change);
    }
  }

  if (failed.length === 0) {
    await clearPendingChanges();
  } else {
    // Keep only the ones that failed — use offlineCache functions
    await clearPendingChanges();
    for (const change of failed) {
      await addPendingChange(change);
    }
  }
}

// ── Mirror server data to localDb for offline access ────────────────────────

async function mirrorRecipesToLocalDb(recipes) {
  try {
    for (const recipe of recipes) {
      await mirrorSingleRecipeToLocalDb(recipe);
    }
  } catch {}
}

async function mirrorSingleRecipeToLocalDb(recipe) {
  try {
    const db = localDb.getDb ? localDb.getDb() : null;
    if (!db) return;
    const r = recipe;
    const now = new Date().toISOString();
    db.runSync(
      `INSERT OR REPLACE INTO recipes (id, title, description, ingredients, steps, tags, prep_minutes, cook_minutes, servings, image_url, notes, collection, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        r.id,
        r.title || '',
        r.description || '',
        typeof r.ingredients === 'string' ? r.ingredients : JSON.stringify(r.ingredients || []),
        typeof r.steps === 'string' ? r.steps : JSON.stringify(r.steps || []),
        typeof r.tags === 'string' ? r.tags : JSON.stringify(r.tags || []),
        r.prep_minutes || 0,
        r.cook_minutes || 0,
        r.servings || 0,
        r.image_url || '',
        r.notes || '',
        r.collection || '',
        r.created_at || now,
        r.updated_at || now,
      ],
    );
  } catch {}
}

// ── Wrapped API ──────────────────────────────────────────────────────────────

export const api = {
  health: async () => {
    const mode = await getAppMode();
    if (mode === 'local') return { status: 'ok', mode: 'local' };
    return request('/health');
  },

  listRecipes: async (search) => {
    const mode = await getAppMode();
    if (mode === 'local') return localDb.listRecipes(search);

    // Fast ping first (2s) — avoids 8s timeout on dead connections
    try {
      await checkOnline();
      const data = await request(`/recipes${search ? `?search=${encodeURIComponent(search)}` : ''}`);
      setOnline(true);
      await cacheRecipes(data);
      // Mirror to localDb so it's available offline
      await mirrorRecipesToLocalDb(data);
      return data;
    } catch (e) {
      setOnline(false);
      // Try AsyncStorage cache first (fast), then localDb
      const cached = await getCachedRecipes();
      if (cached.length > 0) return cached;
      const local = await localDb.listRecipes(search);
      if (local.length > 0) return local;
      // No cached data anywhere — tell the user they need a connection
      throw new Error('No recipes available offline. Connect to load recipes.');
    }
  },

  getRecipe: async (id) => {
    const mode = await getAppMode();
    if (mode === 'local') return localDb.getRecipe(id);

    try {
      await checkOnline();
      const data = await request(`/recipes/${id}`);
      setOnline(true);
      await cacheRecipe(data);
      await mirrorSingleRecipeToLocalDb(data);
      return data;
    } catch (e) {
      setOnline(false);
      // Try AsyncStorage cache, then localDb
      const cached = await getCachedRecipe(id);
      if (cached) return cached;
      try { return await localDb.getRecipe(id); } catch {}
      throw e;
    }
  },

  createRecipe: async (recipe) => {
    const mode = await getAppMode();
    if (mode === 'local') return localDb.createRecipe(recipe);

    try {
      const data = await request('/recipes', { method: 'POST', body: JSON.stringify(recipe) });
      setOnline(true);
      if (data) {
        await cacheRecipe(data);
        await mirrorSingleRecipeToLocalDb(data);
      }
      return data;
    } catch {
      setOnline(false);
      // Fall through to offline queue
    }
    // Offline: create in localDb + cache, queue for sync
    const tempId = `local_${Date.now()}`;
    const localRecipe = { ...recipe, id: tempId, created_at: new Date().toISOString() };
    await cacheRecipe(localRecipe);
    await localDb.createRecipe({ ...recipe, id: undefined }); // let SQLite assign id
    await addPendingChange({ type: 'create', data: recipe, tempId });
    return localRecipe;
  },

  updateRecipe: async (id, recipe) => {
    const mode = await getAppMode();
    if (mode === 'local') return localDb.updateRecipe(id, recipe);

    try {
      const data = await request(`/recipes/${id}`, { method: 'PUT', body: JSON.stringify(recipe) });
      setOnline(true);
      const result = data || { ...recipe, id };
      await cacheRecipe(result);
      await mirrorSingleRecipeToLocalDb(result);
      return result;
    } catch {
      setOnline(false);
      // Fall through to offline queue
    }
    // Offline: apply to cache + localDb, queue change
    const updated = { ...recipe, id };
    await cacheRecipe(updated);
    try { await localDb.updateRecipe(id, recipe); } catch {}
    await addPendingChange({ type: 'update', id, data: recipe });
    return updated;
  },

  deleteRecipe: async (id) => {
    const mode = await getAppMode();
    if (mode === 'local') return localDb.deleteRecipe(id);

    try {
      await request(`/recipes/${id}`, { method: 'DELETE' });
      setOnline(true);
      // Remove from AsyncStorage cache
      const raw = await AsyncStorage.getItem('cegin_recipe_cache');
      if (raw) {
        try {
          const map = JSON.parse(raw);
          delete map[id];
          await AsyncStorage.setItem('cegin_recipe_cache', JSON.stringify(map));
        } catch {}
      }
      // Remove from localDb
      try { await localDb.deleteRecipe(id); } catch {}
      return;
    } catch {
      setOnline(false);
    }
    // Offline: remove from cache + localDb, queue deletion
    const raw = await AsyncStorage.getItem('cegin_recipe_cache');
    if (raw) {
      try {
        const map = JSON.parse(raw);
        delete map[id];
        await AsyncStorage.setItem('cegin_recipe_cache', JSON.stringify(map));
      } catch {}
    }
    try { await localDb.deleteRecipe(id); } catch {}
    await addPendingChange({ type: 'delete', id });
  },



  // AI assistant
  // If the user has configured custom providers in Settings, we use them directly
  // (full freedom to use any model). Otherwise fall back to server or local mode.
  aiStatus: async () => {
    if ((await getAppMode()) === 'local' || (await hasCustomAI())) return localAi.status();
    return request('/ai/status');
  },
  aiModels: async (type = 'text') => {
    return request(`/ai/models?type=${type}`);
  },
  aiSetModel: async (type, model) => {
    return request('/ai/model', { method: 'POST', body: JSON.stringify({ type, model }) });
  },
  aiChat: async (messages, dietaryProfiles) => {
    if ((await getAppMode()) === 'local' || (await hasCustomAI())) return localAi.chat(messages, dietaryProfiles);
    return request('/ai/chat', { method: 'POST', body: JSON.stringify({ messages, dietaryProfiles }) });
  },
  aiRecipe: async (payload) => {
    if ((await getAppMode()) === 'local' || (await hasCustomAI())) return localAi.generateRecipe(payload);
    return request('/ai/recipe', { method: 'POST', body: JSON.stringify(payload) });
  },
  importRecipe: async (url) => {
    if ((await getAppMode()) === 'local' || (await hasCustomAI())) return localAi.importFromUrl(url);
    return request('/ai/import', { method: 'POST', body: JSON.stringify({ url }) });
  },
  tidyRecipe: async (recipe) => {
    if ((await getAppMode()) === 'local' || (await hasCustomAI())) return localAi.tidyRecipe(recipe);
    return request('/ai/tidy', { method: 'POST', body: JSON.stringify({ recipe }) });
  },
  convertUnits: async ({ ingredients, system }) => {
    if ((await getAppMode()) === 'local' || (await hasCustomAI())) return localAi.convertUnits({ ingredients, system });
    return request('/ai/convert', { method: 'POST', body: JSON.stringify({ ingredients, system }) });
  },
  aiShoppingList: async (recipeIds) => {
    if ((await getAppMode()) === 'local' || (await hasCustomAI())) return localAi.shoppingList(recipeIds);
    return request('/ai/shopping-list', { method: 'POST', body: JSON.stringify({ recipe_ids: recipeIds }) });
  },
  aiMealPlan: async (body = {}) => {
    if ((await getAppMode()) === 'local' || (await hasCustomAI())) return localAi.mealPlan(body);
    return request('/ai/meal-plan', { method: 'POST', body: JSON.stringify(body) });
  },

  // Nutrition estimation
  estimateNutrition: async ({ title, ingredients, servings }) => {
    if ((await getAppMode()) === 'local' || (await hasCustomAI())) return localAi.estimateNutrition({ title, ingredients, servings });
    return request('/ai/nutrition', { method: 'POST', body: JSON.stringify({ title, ingredients, servings }) });
  },

  generatePrepSteps: async ({ title, ingredients, steps }) => {
    if ((await getAppMode()) === 'local' || (await hasCustomAI())) return localAi.generatePrepSteps({ title, ingredients, steps });
    return request('/ai/prep-steps', { method: 'POST', body: JSON.stringify({ title, ingredients, steps }) });
  },

  // Fridge scan
  scanFridge: async (imageBase64) => {
    if ((await getAppMode()) === 'local' || (await hasCustomAI())) return localAi.scanFridge(imageBase64);
    return request('/ai/scan-fridge', { method: 'POST', body: JSON.stringify({ image: imageBase64 }) });
  },

  // Dietary audit
  auditRecipe: async ({ recipe, dietaryProfiles }) => {
    if ((await getAppMode()) === 'local' || (await hasCustomAI())) return localAi.auditRecipe(recipe, dietaryProfiles);
    return request('/ai/audit-recipe', { method: 'POST', body: JSON.stringify({ recipe, dietaryProfiles }) });
  },

  // Mid-cook AI features
  fixMistake: async ({ recipe, currentStep, problem }) => {
    if ((await getAppMode()) === 'local' || (await hasCustomAI())) return localAi.fixMistake({ recipe, currentStep, problem });
    return request('/ai/fix-mistake', { method: 'POST', body: JSON.stringify({ recipe, currentStep, problem }) });
  },
  adjustCooking: async ({ recipe, modifications }) => {
    if ((await getAppMode()) === 'local' || (await hasCustomAI())) return localAi.adjustCooking({ recipe, modifications });
    return request('/ai/adjust-cooking', { method: 'POST', body: JSON.stringify({ recipe, modifications }) });
  },

  // Collections
  listCollections: async () => {
    const mode = await getAppMode();
    if (mode === 'local') return localDb.listCollections();
    try {
      const data = await request('/collections');
      return data;
    } catch {
      // Offline fallback: try localDb
      try { return await localDb.listCollections(); } catch {}
      return [];
    }
  },
  listRecipeCollections: async () => {
    const mode = await getAppMode();
    if (mode === 'local') return localDb.listRecipeCollections();
    try {
      const data = await request('/recipe-collections');
      return data;
    } catch {
      try { return await localDb.listRecipeCollections(); } catch {}
      return [];
    }
  },
  createCollection: async (name) => {
    const mode = await getAppMode();
    if (mode === 'local') return localDb.createCollection(name);
    try {
      const data = await request('/collections', { method: 'POST', body: JSON.stringify({ name }) });
      // Mirror to localDb
      try { await localDb.createCollection(name); } catch {}
      return data;
    } catch {
      setOnline(false);
      // Offline: create locally + queue
      const local = await localDb.createCollection(name);
      await addPendingChange({ type: 'create_collection', data: { name } });
      return local;
    }
  },
  deleteCollection: async (id) => {
    const mode = await getAppMode();
    if (mode === 'local') return localDb.deleteCollection(id);
    try {
      await request(`/collections/${id}`, { method: 'DELETE' });
      try { await localDb.deleteCollection(id); } catch {}
    } catch {
      setOnline(false);
      try { await localDb.deleteCollection(id); } catch {}
      await addPendingChange({ type: 'delete_collection', id });
    }
  },
  addToCollection: async (id, recipeId) => {
    const mode = await getAppMode();
    if (mode === 'local') return localDb.addToCollection(id, recipeId);
    return request(`/collections/${id}/recipes/${recipeId}`, { method: 'POST' });
  },
  removeFromCollection: async (id, recipeId) => {
    const mode = await getAppMode();
    if (mode === 'local') return localDb.removeFromCollection(id, recipeId);
    return request(`/collections/${id}/recipes/${recipeId}`, { method: 'DELETE' });
  },

  // Recipe images
  getImages: async (recipeId) => {
    const mode = await getAppMode();
    if (mode === 'local') return localDb.getImages(recipeId);
    return request(`/recipes/${recipeId}/images`);
  },
  addImage: async (recipeId, imageUrl) => {
    const mode = await getAppMode();
    if (mode === 'local') return localDb.addImage(recipeId, imageUrl);
    return request(`/recipes/${recipeId}/images`, { method: 'POST', body: JSON.stringify({ image_url: imageUrl }) });
  },
  deleteImage: async (id) => {
    const mode = await getAppMode();
    if (mode === 'local') return localDb.deleteImage(id);
    return request(`/images/${id}`, { method: 'DELETE' });
  },

  // Notifications
  getNotificationSettings: async () => {
    return request('/notifications/settings');
  },
  updateNotificationSettings: async (settings) => {
    return request('/notifications/settings', { method: 'PUT', body: JSON.stringify(settings) });
  },
  registerPushToken: async (token, deviceName) => {
    return request('/notifications/register', { method: 'POST', body: JSON.stringify({ token, deviceName }) });
  },
  unregisterPushToken: async (token) => {
    return request('/notifications/unregister', { method: 'POST', body: JSON.stringify({ token }) });
  },
  testNotification: async () => {
    return request('/notifications/test', { method: 'POST' });
  },

  // Meal plan sync (server-side for cron notifications)
  getMealPlan: async () => {
    const mode = await getAppMode();
    if (mode === 'local') return {};
    return request('/meal-plan');
  },
  syncMealPlan: async (plan) => {
    const mode = await getAppMode();
    if (mode === 'local') return plan;
    return request('/meal-plan/sync', { method: 'POST', body: JSON.stringify({ plan }) });
  },

  // Cook stats (kitchen log, streaks)
  getStats: async () => {
    const mode = await getAppMode();
    if (mode === 'local') return null;
    return request('/stats');
  },
  recordCook: async (recipeId, recipeTitle, stepCount) => {
    const mode = await getAppMode();
    if (mode === 'local') return null;
    return request('/stats/record', { method: 'POST', body: JSON.stringify({ recipeId, recipeTitle, stepCount }) });
  },
  clearStats: async () => {
    const mode = await getAppMode();
    if (mode === 'local') return null;
    return request('/stats', { method: 'DELETE' });
  },

  // Dietary profiles
  getDietaryProfiles: async () => {
    const mode = await getAppMode();
    if (mode === 'local') return null;
    return request('/dietary-profiles');
  },
  syncDietaryProfiles: async (profiles) => {
    const mode = await getAppMode();
    if (mode === 'local') return null;
    return request('/dietary-profiles', { method: 'PUT', body: JSON.stringify({ profiles }) });
  },
  clearDietaryProfiles: async () => {
    const mode = await getAppMode();
    if (mode === 'local') return null;
    return request('/dietary-profiles', { method: 'DELETE' });
  },

  // Cookbook entries (kitchen log with photos)
  getCookbook: async () => {
    const mode = await getAppMode();
    if (mode === 'local') return null;
    return request('/cookbook');
  },
  addCookbookEntry: async (entry) => {
    const mode = await getAppMode();
    if (mode === 'local') return null;
    return request('/cookbook', { method: 'POST', body: JSON.stringify(entry) });
  },
  updateCookbookEntry: async (id, updates) => {
    const mode = await getAppMode();
    if (mode === 'local') return null;
    return request(`/cookbook/${id}`, { method: 'PUT', body: JSON.stringify(updates) });
  },
  deleteCookbookEntry: async (id) => {
    const mode = await getAppMode();
    if (mode === 'local') return null;
    return request(`/cookbook/${id}`, { method: 'DELETE' });
  },
  clearCookbook: async () => {
    const mode = await getAppMode();
    if (mode === 'local') return null;
    return request('/cookbook', { method: 'DELETE' });
  },

  // Shopping list
  getShoppingList: async () => {
    const mode = await getAppMode();
    if (mode === 'local') return null;
    return request('/shopping-list');
  },
  syncShoppingList: async (items) => {
    const mode = await getAppMode();
    if (mode === 'local') return null;
    return request('/shopping-list', { method: 'PUT', body: JSON.stringify({ items }) });
  },
  clearShoppingList: async () => {
    const mode = await getAppMode();
    if (mode === 'local') return null;
    return request('/shopping-list', { method: 'DELETE' });
  },

  // Favorites
  getFavorites: async () => {
    const mode = await getAppMode();
    if (mode === 'local') return null;
    return request('/favorites');
  },
  syncFavorites: async (favorites) => {
    const mode = await getAppMode();
    if (mode === 'local') return null;
    return request('/favorites', { method: 'PUT', body: JSON.stringify({ favorites }) });
  },
  clearFavorites: async () => {
    const mode = await getAppMode();
    if (mode === 'local') return null;
    return request('/favorites', { method: 'DELETE' });
  },

  // Chat history
  getChatHistory: async () => {
    const mode = await getAppMode();
    if (mode === 'local') return null;
    return request('/chat-history');
  },
  syncChatHistory: async (history) => {
    const mode = await getAppMode();
    if (mode === 'local') return null;
    return request('/chat-history', { method: 'PUT', body: JSON.stringify({ history }) });
  },
  clearChatHistory: async () => {
    const mode = await getAppMode();
    if (mode === 'local') return null;
    return request('/chat-history', { method: 'DELETE' });
  },

  // Activity context
  getActivityContext: async () => {
    const mode = await getAppMode();
    if (mode === 'local') return null;
    return request('/activity-context');
  },
  syncActivityContext: async (context) => {
    const mode = await getAppMode();
    if (mode === 'local') return null;
    return request('/activity-context', { method: 'PUT', body: JSON.stringify({ context }) });
  },
  clearActivityContext: async () => {
    const mode = await getAppMode();
    if (mode === 'local') return null;
    return request('/activity-context', { method: 'DELETE' });
  },

  // Scanned items (from Terry Vision fridge scans)
  getScannedItems: async (all = false) => {
    const mode = await getAppMode();
    if (mode === 'local') return [];
    return request(`/scanned-items${all ? '?all=true' : ''}`);
  },
  addScannedItems: async (items) => {
    const mode = await getAppMode();
    if (mode === 'local') return items;
    return request('/scanned-items', { method: 'POST', body: JSON.stringify({ items }) });
  },
  markItemConsumed: async (id) => {
    const mode = await getAppMode();
    if (mode === 'local') return { ok: true };
    return request(`/scanned-items/${id}/consume`, { method: 'PUT' });
  },
};
