# Cegin Performance Review

**Date:** 2026-07-11  
**Version:** 1.3.2  
**Scope:** Server (Node.js/Express/better-sqlite3) + Mobile (React Native/Expo)

---

## Executive Summary

Cegin is well-structured for a self-hosted recipe app. The codebase shows awareness of performance concerns (image proxy caching, WAL mode, debounced WebSocket, in-memory recipe cache on mobile). However, several areas could be improved at scale — particularly database indexing, image processing pipeline, and mobile bundle/loading strategy.

**Overall Risk Level:** Low-Medium (fine for single/family use; would need work for multi-tenant or high-traffic deployments)

---

## Server-Side Findings

### 1. Database — Missing Indexes 🔴 High Impact

The `recipes` table has **no indexes** beyond the primary key and the `collections(user_id, name)` unique index. Every query filtering by `user_id` does a full table scan.

**Affected queries:**
- `listRecipes()` — `WHERE user_id = @userId ORDER BY updated_at DESC`
- `getRecipe()` — `WHERE id = @id AND user_id = @userId`
- `searchByIngredients()` — multiple `LIKE` clauses with `user_id` filter
- `getDistinctCollections()` — `WHERE collection != '' AND user_id = @userId`

**Missing indexes:**
```sql
CREATE INDEX IF NOT EXISTS idx_recipes_user_id ON recipes(user_id);
CREATE INDEX IF NOT EXISTS idx_recipes_user_updated ON recipes(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_recipes_user_collection ON recipes(user_id, collection);
CREATE INDEX IF NOT EXISTS idx_meal_plans_user_date ON meal_plans(user_id, date);
CREATE INDEX IF NOT EXISTS idx_scanned_items_user ON scanned_items(user_id, consumed);
CREATE INDEX IF NOT EXISTS idx_shopping_list_user ON shopping_list(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_user ON chat_history(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_cookbook_entries_user ON cookbook_entries(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_terry_vision_user ON terry_vision_scans(user_id);
CREATE INDEX IF NOT EXISTS idx_recipe_images_recipe ON recipe_images(recipe_id, position);
CREATE INDEX IF NOT EXISTS idx_cook_dates_user ON cook_dates(user_id, cook_date DESC);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);
```

**Impact:** Fine for <100 recipes per user. Noticeably slow with hundreds of recipes and multiple users.

### 2. `SELECT *` Anti-Pattern 🟡 Medium Impact

Nearly every query uses `SELECT *`, pulling all columns including potentially large JSON text fields (`ingredients`, `steps`, `tags`, `recipe_cook_counts`, `messages`). For list views that only need `id`, `title`, `image_url`, and `tags`, this transfers significant unnecessary data.

**Examples:**
- `listRecipes()` returns full recipe bodies (ingredients, steps, etc.) when only metadata is needed for the list view
- `getChatHistory()` loads all 50 conversations with full message bodies, even though the list only shows titles
- `getStats()` + `getTopRecipes()` — `getTopRecipes` calls `getStats` which re-parses the entire `recipe_cook_counts` JSON just to sort a few entries

**Recommendation:** Add lightweight `SELECT id, title, image_url, tags, prep_minutes, cook_minutes, servings, collection, updated_at FROM recipes` variants for list endpoints.

### 3. `searchByIngredients()` — Dynamic SQL with LIKE 🟡 Medium Impact

```js
const likeClauses = ingredientList.map(
  (_, i) => `CASE WHEN ingredients LIKE @p${i} ESCAPE '\\' THEN 1 ELSE 0 END`
);
```

This builds a dynamic SQL string with N `LIKE` clauses on a JSON text column. Each clause does a full-text scan of the `ingredients` column (which is a JSON array stored as a string). With many ingredients, this becomes expensive.

**Recommendation:** For larger datasets, consider FTS5 virtual table for full-text search, or parse ingredients into a normalized junction table.

### 4. `syncMealPlan()` — Delete-and-Reinsert Pattern 🟡 Medium Impact

```js
const deleteOld = db.prepare('DELETE FROM meal_plans WHERE user_id = ?');
// ... then re-inserts everything
```

Every meal plan sync deletes all rows for the user and re-inserts them. This is wasteful when only one day changed. It's wrapped in a transaction (good), but still generates unnecessary write I/O.

**Same pattern in:** `syncShoppingList()`, `syncFavorites()`, `syncChatHistory()`, `syncDietaryProfiles()`

**Recommendation:** Use `INSERT OR REPLACE` or diff-based updates for these sync endpoints.

### 5. Image Processing (sharp) — On-the-Fly Resize ✅ Good, with caveats

The `/api/image-proxy` endpoint:
- Uses sharp with `lanczos3` kernel and `progressive: true` JPEG — good quality choices
- Caches to disk with MD5 hash key — good
- Sets 30-day `Cache-Control` — good
- Has SSRF protection (DNS resolution + private IP check) — excellent

**Concerns:**
- **No cache eviction:** The `image-cache` directory grows unboundedly. Over time, this accumulates orphaned files.
- **No size limit on fetched images:** A malicious URL could return a 100MB image, which sharp would load entirely into memory before resizing.
- **`fs.existsSync` for cache check:** Synchronous I/O in an async handler. Use `fs.promises.access` or try/catch `res.sendFile`.
- **`fs.writeFileSync` for cache write:** Blocking the event loop during disk write. Use `fs.promises.writeFile` or stream to disk.

### 6. `saveBase64Image()` — Synchronous File Write 🔴 High Impact

```js
function saveBase64Image(base64, dir) {
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, Buffer.from(base64, 'base64'));
  return filename;
}
```

This is called in the request handler for recipe create/update and cookbook entries. It blocks the Node.js event loop while writing potentially multi-MB images to disk. With a 5MB body limit, this blocks for the duration of the write.

**Recommendation:** Use `fs.promises.writeFile` and make the handler async, or use `fs.createWriteStream`.

### 7. WebSocket Overhead — ✅ Well-Managed

The WebSocket implementation is clean:
- Client-side debouncing (150ms) prevents rapid-fire UI updates
- Server-side dead connection cleanup every 30s with native `ping`/`pong`
- Client-side exponential backoff reconnection (1s → 30s cap)
- App foreground/background state management
- Messages are minimal JSON (`{type, action}`) — very low bandwidth

**Minor concern:** `broadcast()` iterates all clients and JSON.stringifies the same message per send. For many clients, pre-serializing once would save CPU. Not a real issue at typical scale.

### 8. Rate Limiter — In-Memory Map 🟡 Medium Impact

```js
const rateLimitMap = new Map();
```

The rate limiter is an in-memory Map, which:
- Doesn't survive server restarts (acceptable for self-hosted)
- Grows unboundedly between cleanup intervals (cleaned every 5 min — fine)
- Is per-process only (won't work if scaled to multiple instances — not a concern for self-hosted)

**Assessment:** Appropriate for the use case. No action needed.

### 9. AI Request Handling — No Streaming 🟡 Medium Impact

All AI endpoints (`/api/ai/chat`, `/api/ai/recipe`, etc.) wait for the full response before sending it to the client. The client has a 60-second timeout. For long AI responses, the user sees a spinner with no feedback.

**Recommendation:** Consider Server-Sent Events (SSE) or chunked transfer for the chat endpoint to stream tokens as they arrive.

### 10. `authMiddleware` — DB Query Per Request 🟡 Medium Impact

```js
const user = db.getUserById(decoded.id);
```

Every authenticated request hits the database to look up the user, even though the JWT already contains `id` and `email`. The user's `display_name` is the only extra field fetched.

**Recommendation:** Cache the user object in a short-lived in-memory cache (e.g., LRU with 60s TTL), or include `display_name` in the JWT claims.

---

## Mobile-Side Findings

### 1. All Screens Imported Eagerly — No Lazy Loading 🔴 High Impact

```js
// App.js
import RecipeListScreen from './src/screens/RecipeListScreen';
import RecipeDetailScreen from './src/screens/RecipeDetailScreen';
import EditRecipeScreen from './src/screens/EditRecipeScreen';
// ... 11 more screens
```

All 13 screens are imported statically at the top of `App.js`. This means the entire app's screen code (including heavy dependencies like `expo-image-picker`, `expo-audio`, `@infinitered/react-native-mlkit-text-recognition`, animated GIFs) is loaded at startup regardless of which screen the user navigates to.

**Impact:** Increases initial bundle parse time and memory usage. The `ScanRecipeScreen` imports ML kit text recognition, `AssistantScreen` imports multiple animated GIFs, and `CookModeScreen` imports audio players — all loaded even if the user never visits those screens.

**Recommendation:** Use `React.lazy()` with `Suspense` for screen components:
```js
const RecipeDetailScreen = React.lazy(() => import('./src/screens/RecipeDetailScreen'));
const ScanRecipeScreen = React.lazy(() => import('./src/screens/ScanRecipeScreen'));
// etc.
```

### 2. RecipeListScreen — 30+ useState Hooks 🟡 Medium Impact

The `RecipeListScreen` has approximately 22 `useState` calls and 8 `useEffect` calls. While individual state updates are fine, the combinatorial effect means:
- Every state change triggers a re-render that must check all 22 state values
- The `filtered` useMemo depends on 8 values (`[recipes, search, tab, favs, collections, selectedCollection, sortBy, cookCounts]`)
- The screen loads collections, favorites, stats, search history, view mode, and tutorial state on mount

**Mitigations already in place:**
- `useMemo` for styles, card backgrounds, tag tabs, and filtered list ✅
- `useCallback` for `load`, `changeTab`, `cycleViewMode` ✅
- `Image.clearMemoryCache()` on unmount ✅
- `getCachedRecipesSync()` for instant initial render ✅

**Remaining concerns:**
- `renderCard`, `renderListItem`, `renderGridItem`, `renderCompactItem` are defined inside the component — they recreate on every render. Consider extracting as memoized sub-components.
- `collections.filter(c => c.recipe_ids?.includes(item.id))` is called inside every card render, running `.includes()` on every collection for every visible card.

### 3. RecipeDetailScreen — Timer Interval Runs Forever 🟡 Medium Impact

```js
useEffect(() => {
  intervalRef.current = setInterval(() => {
    setTimers((prev) => { /* update running timers */ });
  }, 1000);
  return () => clearInterval(intervalRef.current);
}, []);
```

The 1-second interval runs continuously while the screen is mounted, even when no timers are active. Every tick creates a new object and triggers a React state update (even if `changed` is false and it returns `prev`, the comparison itself runs).

**Recommendation:** Only start the interval when a timer is running, and stop it when all timers are paused/done.

### 4. `offlineCache.js` — AsyncStorage JSON Parse on Every Cache Hit 🟡 Low Impact

```js
export async function getCachedRecipe(id) {
  const raw = await AsyncStorage.getItem(RECIPE_CACHE_KEY);
  const map = JSON.parse(raw);
  return map[id] || null;
}
```

Each `getCachedRecipe` call reads and parses the entire recipe cache from AsyncStorage, even to return a single recipe. The `_recipesCache` in-memory cache helps for `getCachedRecipes()` but `getCachedRecipe()` always hits AsyncStorage.

**Recommendation:** Use the `_recipesCache` in-memory map for single-recipe lookups too.

### 5. Image Handling — Good with Minor Gaps ✅

**Already in place:**
- `expo-image` with `contentFit="cover"` and `transition={300}` — efficient image component ✅
- Server-side image proxy with resize + caching ✅
- `recyclingKey` on list images for FlatList recycling ✅
- `Image.clearMemoryCache()` on screen unmount and app backgrounding ✅

**Gaps:**
- No `placeholder` prop on `<Image>` components — images flash from empty to loaded. Using `blurhash` or a solid color placeholder would improve perceived performance.
- `proxyImageUrlSync()` returns `null` if server URL not yet resolved — this can cause images to not render on first mount.

### 6. AssistantScreen — Animated GIFs Loaded at Import Time 🟡 Medium Impact

```js
const TERRY_THINKING = require('../../assets/terry-thinking.gif');
const TERRY_TALKING = require('../../assets/terry-talking.gif');
const TERRY_IDLE = require('../../assets/terry-idle.gif');
```

Three animated GIFs are loaded at import time. Even though this screen may never be visited, the GIFs are bundled and parsed. Animated GIFs are particularly expensive on React Native (full frame decode in memory).

**Recommendation:** Lazy-load these assets only when the Assistant screen mounts.

### 7. AsyncStorage as Primary Cache Backend 🟡 Medium Impact

AsyncStorage is used extensively for:
- Recipe cache (`cegin_recipe_cache`)
- Pending changes queue
- Search history, view mode
- Meal plan, favorites, shopping list
- Chat history
- Auth token

AsyncStorage is a key-value store backed by SQLite on Android and UserDefaults/SQLite on iOS. It serializes everything to strings. For the recipe cache, every write serializes the entire recipe map to JSON. With 100+ recipes including ingredients/steps/tags, this can be several hundred KB per write.

**Good news:** The app also has `localDb.js` (expo-sqlite) for proper local database operations, and uses it for offline mode. The dual AsyncStorage + localDb pattern adds complexity but provides fallback.

### 8. No `getItemLayout` on FlatList 🟡 Low Impact

The `RecipeListScreen` uses `FlatList` for grid/list/compact views but doesn't provide `getItemLayout`. This means FlatList can't optimize scroll-to-index or skip measurement for off-screen items.

**Recommendation:** If item heights are predictable (especially in list/compact mode), provide `getItemLayout` for better scroll performance.

### 9. Context Provider Nesting 🟡 Low Impact

```js
<SafeAreaProvider>
  <ThemeProvider>
    <AiProvider>
      <TimerProvider>
        <ToastProvider>
```

Five nested context providers. Each provider triggers re-renders for all consumers when its value changes. The `Theme`, `Ai`, `Timer`, and `Toast` contexts are all independent — this nesting is fine architecturally, but if any provider's value object changes reference on every render (without `useMemo`), it causes unnecessary re-renders downstream.

**Status:** Both `ThemeProvider` and `AiProvider` use `useMemo` for their context values ✅. This is correctly implemented.

### 10. `syncPendingChanges()` — Sequential Processing 🟡 Low Impact

```js
for (const change of changes) {
  try {
    switch (change.type) { ... }
  } catch { failed.push(change); }
}
```

Pending changes are synced one at a time sequentially. If there are many offline changes, this can be slow. Each one waits for the HTTP response before starting the next.

**Recommendation:** Batch independent changes where possible, or use `Promise.allSettled()` for parallel sync.

---

## Summary of Recommendations

### Quick Wins (Low effort, high impact)
1. **Add database indexes** — 12 `CREATE INDEX` statements, no code changes needed
2. **Make `saveBase64Image()` async** — change `writeFileSync` to `await writeFile`
3. **Add image placeholders** — add `placeholder` prop to `<Image>` components
4. **Use in-memory cache for `getCachedRecipe()`** — check `_recipesCache` first

### Medium Effort
5. **Lazy-load screens with `React.lazy()`** — wrap screen imports in App.js
6. **Add SELECT column lists** — create lightweight query variants for list endpoints
7. **Add image cache eviction** — periodic cleanup of files older than 30 days
8. **Cap fetched image size** — limit `resp.arrayBuffer()` to e.g. 10MB before sharp
9. **Stream AI responses** — SSE for chat endpoint

### Lower Priority
10. **Optimize `syncX()` delete-and-reinsert patterns** — use diff-based updates
11. **Cache auth user lookups** — LRU cache for `getUserById` in auth middleware
12. **Extract card render functions** — memoize list item components in RecipeListScreen
13. **Start/stop timer interval dynamically** — only run when timers are active
14. **Add `getItemLayout` to FlatLists** — for fixed-height item modes

---

## What's Already Done Well

- ✅ WAL mode enabled for SQLite concurrent reads
- ✅ Prepared statements used everywhere (no SQL injection, good perf)
- ✅ Image proxy with disk caching + 30-day Cache-Control
- ✅ WebSocket debouncing + exponential backoff reconnect
- ✅ In-memory recipe cache with sync fallback on mobile
- ✅ `Image.clearMemoryCache()` on unmount and backgrounding
- ✅ `useMemo`/`useCallback` used extensively in screens
- ✅ SSRF protection on image proxy
- ✅ `expo-image` for efficient image rendering
- ✅ Offline-first architecture with pending changes queue
- ✅ Rate limiting on AI routes
- ✅ Transaction wrapping for multi-row writes (meal plans, shopping list, etc.)
