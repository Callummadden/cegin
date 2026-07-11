# Cegin Architecture

**Version:** 1.3.2
**Server:** Node.js + Express + better-sqlite3 (Dockerized)
**Mobile:** Expo SDK 56 (React Native)
**AI:** OpenAI-compatible / Gemini (pluggable providers)

---

## 1. High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         MOBILE APP (Expo/React Native)                 │
│                                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌─────────┐ │
│  │ 13       │  │ API      │  │ Offline  │  │ Meal Plan │  │ Local   │ │
│  │ Screens  │  │ Client   │  │ Cache    │  │ Module    │  │ AI/DB   │ │
│  │          │  │ (api.js) │  │ (AsyncSt)│  │           │  │ (local) │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬─────┘  └────┬────┘ │
│       │              │             │               │              │      │
│       └──────────────┴─────────────┴───────────────┴──────────────┘      │
│                                    │                                     │
│                        ┌───────────┴───────────┐                        │
│                        │   Pending Changes Q    │                        │
│                        │   (AsyncStorage)       │                        │
│                        └───────────┬───────────┘                        │
└────────────────────────────────────┼────────────────────────────────────┘
                                     │ HTTP/REST + WebSocket
                    ┌────────────────┼────────────────┐
                    │    LAN (0.0.0.0:3000)           │
                    │                                  │
┌───────────────────┼──────────────────────────────────┼───────────────────┐
│                   ▼          SERVER (Docker)          ▼                   │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                    Express Middleware Stack                         │  │
│  │  Helmet → CORS → Rate Limiter → Auth → Body Parser (1/5/20 MB)   │  │
│  └────────────────────────────┬───────────────────────────────────────┘  │
│                               │                                          │
│  ┌────────────┐  ┌────────────┴────────────┐  ┌──────────────────────┐  │
│  │ Auth       │  │    REST API Routes      │  │ WebSocket Server     │  │
│  │ (JWT/      │  │                         │  │ /ws?token=<jwt>      │  │
│  │  bcrypt)   │  │ /api/recipes            │  │                      │  │
│  │            │  │ /api/collections        │  │ broadcast(type,      │  │
│  │            │  │ /api/meal-plan          │  │        action)       │  │
│  │            │  │ /api/shopping-list      │  │                      │  │
│  │            │  │ /api/ai/*               │  │ ping/pong keepalive  │  │
│  │            │  │ /api/cookbook           │  │ 30s dead conn cleanup│  │
│  │            │  │ /api/stats              │  │                      │  │
│  │            │  │ /api/notifications      │  │                      │  │
│  └────────────┘  └───────────┬─────────────┘  └──────────┬───────────┘  │
│                              │                            │              │
│  ┌───────────────────────────┴────────────────────────────┴───────────┐  │
│  │                     db.js  (better-sqlite3)                        │  │
│  │                                                                    │  │
│  │  WAL mode │ FK CASCADE ON │ 17 tables │ 11 indexes                │  │
│  │  Prepared statements │ Transactions │ JSON-in-columns             │  │
│  └─────────────────────────────────┬──────────────────────────────────┘  │
│                                    │                                     │
│  ┌─────────────────────────────────┴──────────────────────────────────┐  │
│  │                      ai.js  (AI Integration)                       │  │
│  │                                                                    │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │  │
│  │  │ Text LLM     │  │ Vision LLM   │  │ System Prompt Builder    │ │  │
│  │  │ (chat, gen,  │  │ (scan-fridge,│  │ (Chef Terry personality, │ │  │
│  │  │  import,     │  │  scan-recipe,│  │  saved recipes context,  │ │  │
│  │  │  mid-cook)   │  │  photo OCR)  │  │  dietary profiles,       │ │  │
│  │  └──────┬───────┘  └──────┬───────┘  │  action blocks)          │ │  │
│  │         │                 │           └──────────────────────────┘ │  │
│  └─────────┼─────────────────┼────────────────────────────────────────┘  │
└────────────┼─────────────────┼──────────────────────────────────────────┘
             │                 │
             ▼                 ▼
   ┌──────────────────┐ ┌──────────────────┐
   │  Text AI Provider│ │ Vision AI        │
   │                  │ │ Provider         │
   │  DeepSeek        │ │                  │
   │  Groq            │ │  Gemini          │
   │  OpenAI          │ │  (configurable)  │
   │  OpenRouter      │ │                  │
   │  Ollama (local)  │ │                  │
   │  Any OpenAI-     │ │                  │
   │  compatible API  │ │                  │
   └──────────────────┘ └──────────────────┘

   ┌──────────────────┐ ┌──────────────────┐
   │  Docker Secrets  │ │  Expo Push       │
   │  /run/secrets/   │ │  Notifications   │
   │  TEXT_API_KEY    │ │  (APN/FCM)       │
   │  VISION_API_KEY  │ │                  │
   │  JWT_SECRET      │ │  Morning Digest  │
   └──────────────────┘ │  Perishable Alert│
                        └──────────────────┘
```

---

## 2. Data Flow — Key Operations

### 2.1 Create Recipe

```
Mobile                          Server
──────                          ──────
User fills EditRecipeScreen
         │
         ▼
api.createRecipe(recipe)
         │
    ┌────┴────┐
    │ Online? │
    └────┬────┘
    Yes  │  No
    │    │    │
    │    │    ├── Generate temp ID: `local_${Date.now()}`
    │    │    ├── Cache recipe in AsyncStorage (offlineCache)
    │    │    ├── Mirror to localDb (SQLite on device)
    │    │    ├── Add to pending changes queue
    │    │    └── Return local recipe with temp ID
    │    │
    ▼    │
POST /api/recipes
    │    │
    ▼    │
db.createRecipe(r, userId)
    │    │
    ├── JSON.stringify ingredients[], steps[], tags[]
    ├── INSERT with user_id = req.user?.id || 0
    ├── broadcast('recipe', 'created') via WebSocket
    └── Return recipe with server-assigned ID
         │
         ▼
    Cache response, mirror to localDb
```

**Offline sync (when connectivity returns):**
1. `syncPendingChanges()` iterates the pending queue
2. POST each `create` change to `/api/recipes`
3. On success: `remapTempId(tempId, serverId)` — updates recipe cache, meal plan references, and favorites map
4. Failed items stay in queue for next sync attempt

### 2.2 Meal Plan Sync

```
Mobile                              Server
──────                              ──────
MealPlannerScreen
User assigns recipe → day/meal
         │
         ▼
mealPlan.setMeal(date, meal, recipeId)
         │
    Update in-memory _cache
    Save to AsyncStorage (KEY: 'cegin_meal_plan')
         │
         ▼
api.syncMealPlan(plan)           PUT /api/meal-plan/sync
         │                              │
         │                              ▼
         │                   db.syncMealPlan(userId, plan)
         │                              │
         │                   Transaction:
         │                   1. DELETE all meal_plans WHERE user_id
         │                   2. UPSERT each entry (user_id, date, meal, recipe_id)
         │                              │
         │                   broadcast('meal_plan', 'synced')
         │                              │
         ▼                              ▼
    Return full plan from server
    (plan = { "2026-07-11": { dinner: 42, lunch: 17 } })
```

**Note:** The server uses a destructive sync (delete-all then re-insert) wrapped in a transaction. This is safe within a single SQLite transaction but means the full plan is sent each time.

### 2.3 AI Assistant (Chef Terry)

```
Mobile                              Server
──────                              ──────
AssistantScreen
User types message
         │
         ▼
api.aiChat(messages, dietaryProfiles)
         │
    ┌────┴──────────────────────┐
    │ Custom AI provider set?   │
    │ OR local mode?            │
    └────┬──────────────────────┘
    Yes  │  No
    │    │    │
    ▼    │    ▼
localAi.chat()   POST /api/ai/chat
    │    │              │
    │    │    ┌─────────┴──────────┐
    │    │    │ rateLimiter check  │
    │    │    │ (60 req/min per IP)│
    │    │    └─────────┬──────────┘
    │    │              │
    │    │    db.getChatHistory(userId)  ← context
    │    │    db.listRecipes(userId)     ← saved recipes summary
    │    │    db.getDietaryProfiles(userId) ← dietary needs
    │    │              │
    │    │    systemPrompt(userId, dietaryProfiles)
    │    │              │
    │    │    ┌─────────┴──────────┐
    │    │    │ callTextModel()    │
    │    │    │                    │
    │    │    │ Provider routing:  │
    │    │    │ gemini → Gemini API│
    │    │    │ openai-compatible  │
    │    │    │  → DeepSeek/Groq/  │
    │    │    │    OpenAI/Ollama   │
    │    │    └─────────┬──────────┘
    │    │              │
    │    │    Parse response (parseJsonSafe)
    │    │    Extract action blocks if present
    │    │              │
    │    │    ┌─────────┴──────────┐
    │    │    │ Execute actions:   │
    │    │    │ • add_shopping     │
    │    │    │ • add_meal         │
    │    │    │ • save_recipe      │
    │    │    └────────────────────┘
    │    │              │
    ▼    ▼              ▼
  Response to user
```

**System prompt includes:**
- Chef Terry personality (grumpy black cat chef)
- Summary of user's saved recipes (up to 60)
- Dietary profiles for all household members
- Action block format for autonomous operations (shopping list, meal plan, recipe save)

### 2.4 Shopping List Sync

```
Mobile                              Server
──────                              ──────
ShoppingListScreen
User adds/checks/deletes items
         │
         ▼
api.syncShoppingList(items)    PUT /api/shopping-list/sync
         │                              │
         │                              ▼
         │                   db.syncShoppingList(userId, items)
         │                              │
         │                   Transaction:
         │                   1. DELETE all WHERE user_id
         │                   2. INSERT each item (id, text, checked, category, source)
         │                              │
         │                   broadcast('shopping_list', 'synced')
         │                              │
         ▼                              ▼
    Return server list
```

**AI-generated shopping lists:** Terry can generate shopping lists from recipe IDs via `POST /api/ai/shopping-list`, which extracts and deduplicates ingredients.

---

## 3. Authentication Flow

### 3.1 JWT Authentication

```
┌──────────┐                    ┌──────────┐
│  Mobile   │                    │  Server   │
└─────┬────┘                    └─────┬────┘
      │                               │
      │  POST /api/auth/register      │
      │  { email, password, name }    │
      │──────────────────────────────►│
      │                               │  hashPassword(password) → bcrypt(10)
      │                               │  db.createUser(email, hash, name)
      │                               │  signToken({ id, email })
      │                               │  JWT expires in 30 days
      │  { token, user }              │
      │◄──────────────────────────────│
      │                               │
      │  Store token in AsyncStorage  │
      │  as 'cegin_auth_token'        │
      │                               │
      │  Subsequent requests:         │
      │  Authorization: Bearer <jwt>  │
      │──────────────────────────────►│
      │                               │  authMiddleware:
      │                               │    No header → req.user = null (open mode)
      │                               │    Valid JWT → req.user = user object
      │                               │    Invalid/expired → 401 rejected
      │                               │    User deleted → 401 rejected
```

### 3.2 Open Mode (No Authentication)

When no `Authorization` header is present, the middleware sets `req.user = null` and allows the request through. Routes fall back to `userId = 0`:

```js
const userId = req.user?.id || 0;
```

This means:
- All unauthenticated requests share the "user 0" data space
- Single-user self-hosted setups work without any login
- Multi-user setups require registration + login

### 3.3 Token Refresh

There is no explicit token refresh endpoint. Tokens expire after **30 days** (`JWT_EXPIRES = '30d'`). When a token expires:
- The server returns 401
- The mobile app treats it as offline/invalid and falls back to cached data
- The user must re-authenticate via login

### 3.4 Password Security

- Passwords hashed with **bcrypt** (cost factor 10)
- JWT secret: read from Docker secrets → `./secrets/JWT_SECRET` → auto-generated and persisted

---

## 4. Offline-First Strategy

### 4.1 Three-Tier Cache Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Mobile App                          │
│                                                      │
│  Tier 1: In-Memory (_recipesCache, _cache)          │
│  ──────────────────────────────────────────────     │
│  • Instant reads, zero latency                       │
│  • Populated on first getCachedRecipes() call        │
│  • Lost on app restart                               │
│                                                      │
│  Tier 2: AsyncStorage (JSON)                         │
│  ──────────────────────────────────────────────     │
│  • Key: 'cegin_recipe_cache' → { id: recipe, ... }  │
│  • Key: 'cegin_meal_plan' → { date: { meal: id } }  │
│  • Key: 'cegin_pending_changes' → [ ...changes ]    │
│  • Key: 'cegin_favorites' → { recipeId: true }      │
│  • Survives app restart                              │
│                                                      │
│  Tier 3: Local SQLite (expo-sqlite)                  │
│  ──────────────────────────────────────────────     │
│  • Full relational queries (LIKE search, JOINs)      │
│  • Mirrored from server responses                    │
│  • Used for offline search and local mode            │
│  • Used as last-resort fallback                      │
└─────────────────────────────────────────────────────┘
```

### 4.2 Cache-First Loading Pattern

```js
// Recipe list loading (simplified from api.js)
async listRecipes(search) {
  // 1. Return cached data instantly
  const cached = await getCachedRecipes();
  if (cached.length > 0) {
    // 2. Refresh from server in background (fire-and-forget)
    fetchFromServer(search)
      .then(data => { cacheRecipes(data); mirrorToLocalDb(data); })
      .catch(() => setOnline(false));
    return cached;  // instant return
  }

  // 3. No cache — must fetch from server
  try {
    const data = await fetchFromServer(search);
    cacheRecipes(data);
    mirrorToLocalDb(data);
    return data;
  } catch {
    // 4. Server unreachable — try localDb
    return localDb.listRecipes(search);
  }
}
```

### 4.3 Pending Changes Queue

When the device is offline, mutations are queued in AsyncStorage:

```
Pending change structure:
{
  type: 'create' | 'update' | 'delete' | 'create_collection' | 'delete_collection',
  data: { ... },           // for create/update
  id: serverId,            // for update/delete
  tempId: 'local_...',     // for offline-created recipes
  timestamp: Date.now()
}
```

**Sync process (`syncPendingChanges`):**
1. Check online status (2s ping to `/api/health`)
2. Iterate pending changes in order
3. Replay each mutation against the server
4. On success: remove from queue
5. On failure: keep in queue for next attempt
6. All succeed: `clearPendingChanges()`

### 4.4 Temp ID Remapping

When an offline-created recipe is synced to the server:

```js
async function remapTempId(tempId, serverId) {
  // 1. Update recipe cache: map[tempId] → map[serverId]
  // 2. Update meal plan: replace tempId references with serverId
  // 3. Update favorites: remap key from tempId to serverId
}
```

This ensures that offline-created recipes integrate cleanly with server data once connectivity is restored.

### 4.5 Online Detection

```js
// Pings /api/health with a 2-second timeout
// Cached for 5 seconds (CHECK_COOLDOWN) to avoid spam
// Set online=true on any successful API call
// Set offline on any network failure
```

---

## 5. WebSocket Sync Protocol

### 5.1 Connection

```
ws://SERVER:3000/ws?token=<JWT>

Protocol: JSON messages over WebSocket
Keepalive: Server pings every 30s, expects pong
Dead connection cleanup: 30s interval, terminates stale clients
```

### 5.2 Authentication

The server validates the JWT from the `token` query parameter on connection:

```js
wss.on('connection', (ws, req) => {
  const token = new URL(req.url, 'http://localhost').searchParams.get('token');
  if (token) {
    const decoded = verifyToken(token);
    ws.userId = decoded.id;
  }
  // In open mode (no auth), anonymous connections are allowed
});
```

### 5.3 Message Format

**Server → Client (broadcast):**
```json
{ "type": "recipe", "action": "created" }
{ "type": "recipe", "action": "updated" }
{ "type": "recipe", "action": "deleted" }
{ "type": "meal_plan", "action": "synced" }
{ "type": "shopping_list", "action": "synced" }
{ "type": "collection", "action": "created" }
{ "type": "cookbook", "action": "changed" }
{ "type": "activity_context", "action": "changed" }
```

**Client → Server:**
```json
{ "type": "ping" }  →  { "type": "pong" }
```

### 5.4 Usage Pattern

The WebSocket is used for **cross-device notification** — when device A creates a recipe, device B receives a broadcast and can trigger a data refresh. The actual data is transferred via REST, not WebSocket.

---

## 6. Database Schema Overview

### 6.1 Entity Relationship Diagram

```
┌──────────────┐       ┌──────────────────┐       ┌──────────────────┐
│    users     │       │    recipes       │       │  recipe_images   │
├──────────────┤       ├──────────────────┤       ├──────────────────┤
│ id (PK)      │◄──┐   │ id (PK)          │◄──────│ recipe_id (FK)   │
│ email (UNQ)  │   │   │ user_id (FK)     │       │ id (PK)          │
│ password_hash│   │   │ title            │       │ image_url        │
│ display_name │   │   │ description      │       │ position         │
│ created_at   │   │   │ ingredients(JSON)│       │ created_at       │
└──────────────┘   │   │ steps (JSON)     │       └──────────────────┘
                   │   │ tags (JSON)      │
                   │   │ prep_minutes     │       ┌──────────────────┐
                   │   │ cook_minutes     │       │  collections     │
                   │   │ servings         │       ├──────────────────┤
                   │   │ image_url        │       │ id (PK)          │
                   │   │ notes            │       │ user_id          │
                   │   │ collection       │       │ name (UNQ/user)  │
                   │   │ created_at       │       │ recipe_ids(JSON) │
                   │   │ updated_at       │       │ created_at       │
                   │   └──────────────────┘       └──────────────────┘
                   │
                   │   ┌──────────────────┐       ┌──────────────────┐
                   ├───│   meal_plans     │       │  shopping_list   │
                   │   ├──────────────────┤       ├──────────────────┤
                   │   │ id (PK)          │       │ id (PK)          │
                   │   │ user_id          │       │ user_id          │
                   │   │ date             │       │ text             │
                   │   │ meal             │       │ checked          │
                   │   │ recipe_id        │       │ category         │
                   │   │ created_at       │       │ source           │
                   │   │ updated_at       │       │ created_at       │
                   │   │ UNIQUE(user,     │       └──────────────────┘
                   │   │   date, meal)    │
                   │   └──────────────────┘
                   │
                   │   ┌──────────────────┐       ┌──────────────────┐
                   ├───│   favorites      │       │  chat_history    │
                   │   ├──────────────────┤       ├──────────────────┤
                   │   │ user_id (PK)     │       │ id (PK)          │
                   │   │ recipe_id (PK)   │       │ user_id          │
                   │   │ created_at       │       │ title            │
                   │   └──────────────────┘       │ messages (JSON)  │
                   │                               │ timestamp        │
                   │   ┌──────────────────┐       │ created_at       │
                   ├───│  cook_stats      │       └──────────────────┘
                   │   ├──────────────────┤
                   │   │ user_id (PK)     │       ┌──────────────────┐
                   │   │ cook_count       │       │  cook_dates      │
                   │   │ total_steps      │       ├──────────────────┤
                   │   │ recipe_cook_     │       │ id (PK)          │
                   │   │   counts (JSON)  │       │ user_id          │
                   │   │ updated_at       │       │ cook_date (UNQ/  │
                   │   └──────────────────┘       │   user)          │
                   │                               └──────────────────┘
                   │
                   │   ┌──────────────────┐       ┌──────────────────┐
                   ├───│ scanned_items    │       │push_tokens       │
                   │   ├──────────────────┤       ├──────────────────┤
                   │   │ id (PK)          │       │ id (PK)          │
                   │   │ user_id          │       │ user_id          │
                   │   │ item_name        │       │ token (UNQ)      │
                   │   │ scanned_at       │       │ device_name      │
                   │   │ expires_at       │       │ created_at       │
                   │   │ consumed         │       └──────────────────┘
                   │   └──────────────────┘
                   │
                   │   ┌──────────────────┐       ┌──────────────────┐
                   ├───│ dietary_profiles │       │notif_subscriptions│
                   │   ├──────────────────┤       ├──────────────────┤
                   │   │ id (PK)          │       │ id (PK)          │
                   │   │ user_id          │       │ user_id (UNQ)    │
                   │   │ name             │       │ morning_digest   │
                   │   │ needs            │       │ perishable_alerts│
                   │   │ notes            │       │ created_at       │
                   │   │ created_at       │       │ updated_at       │
                   │   │ updated_at       │       └──────────────────┘
                   │   └──────────────────┘
                   │
                   │   ┌──────────────────┐       ┌──────────────────┐
                   ├───│ cookbook_entries │       │activity_context  │
                   │   ├──────────────────┤       ├──────────────────┤
                   │   │ id (PK)          │       │ user_id (PK)     │
                   │   │ user_id          │       │ date             │
                   │   │ recipe_id        │       │ level            │
                   │   │ recipe_title     │       │ description      │
                   │   │ image_path       │       │ metrics (JSON)   │
                   │   │ date             │       │ updated_at       │
                   │   │ notes            │       └──────────────────┘
                   │   │ created_at       │
                   │   └──────────────────┘       ┌──────────────────┐
                   │                               │terry_vision_scans│
                   └───────────────────────────────├──────────────────┤
                                                   │ id (PK)          │
                                                   │ user_id          │
                                                   │ section          │
                                                   │ image_path       │
                                                   │ ingredients(JSON)│
                                                   │ created_at       │
                                                   └──────────────────┘
```

### 6.2 Table Summary

| # | Table | PK | Purpose |
|---|-------|-----|---------|
| 1 | `recipes` | `id` (autoincrement) | Core recipe data; JSON columns for ingredients, steps, tags |
| 2 | `recipe_images` | `id` (autoincrement) | Multiple images per recipe (FK → recipes, CASCADE delete) |
| 3 | `collections` | `id` (autoincrement) | Named recipe groups; JSON array of recipe IDs |
| 4 | `users` | `id` (autoincrement) | User accounts; email/password auth |
| 5 | `meal_plans` | `id` (autoincrement) | Weekly meal planning; UNIQUE(user, date, meal) |
| 6 | `shopping_list` | `id` (text) | Shopping items; text PK for client-generated IDs |
| 7 | `favorites` | `(user_id, recipe_id)` | Many-to-many; composite PK |
| 8 | `cook_stats` | `user_id` | Per-user cooking statistics and recipe cook counts |
| 9 | `cook_dates` | `id` (autoincrement) | Cooking streak tracking; UNIQUE(user, cook_date) |
| 10 | `scanned_items` | `id` (autoincrement) | Terry Vision fridge scan results with expiry tracking |
| 11 | `push_tokens` | `id` (autoincrement) | Expo push notification tokens per device |
| 12 | `notification_subscriptions` | `id` (autoincrement) | Per-user notification preferences (UNIQUE on user_id) |
| 13 | `chat_history` | `id` (text) | Chef Terry conversation history; JSON messages array |
| 14 | `dietary_profiles` | `id` (text) | Household dietary needs/restrictions |
| 15 | `cookbook_entries` | `id` (text) | Kitchen log with photos and notes |
| 16 | `activity_context` | `user_id` | Current user activity state for AI context |
| 17 | `terry_vision_scans` | `id` (text) | Fridge/pantry scan history with identified ingredients |

### 6.3 Indexes

```sql
idx_recipes_user_id                         ON recipes(user_id)
idx_recipes_user_updated                    ON recipes(user_id, updated_at DESC)
idx_recipe_images_recipe_id                 ON recipe_images(recipe_id)
idx_meal_plans_user_date                    ON meal_plans(user_id, date)
idx_scanned_items_user_consumed_expires     ON scanned_items(user_id, consumed, expires_at)
idx_push_tokens_user_id                     ON push_tokens(user_id)
idx_cookbook_entries_user_id                ON cookbook_entries(user_id)
idx_chat_history_user_timestamp             ON chat_history(user_id, timestamp DESC)
idx_dietary_profiles_user_id                ON dietary_profiles(user_id)
idx_terry_vision_scans_user_id              ON terry_vision_scans(user_id)
idx_shopping_list_user_id                   ON shopping_list(user_id)
idx_collections_user_name (UNIQUE)          ON collections(user_id, name)
```

### 6.4 Key Design Decisions

- **JSON-in-columns**: `ingredients`, `steps`, `tags` in recipes are stored as JSON strings and parsed on read via `rowToRecipe()`. This avoids JOIN tables for array data but prevents SQL-level filtering on individual items.
- **WAL mode**: Write-Ahead Logging enables concurrent reads during writes, critical for the server handling simultaneous REST requests and WebSocket broadcasts.
- **Foreign keys ON**: `recipe_images` has `ON DELETE CASCADE` — deleting a recipe automatically removes its images.
- **Text primary keys**: `shopping_list`, `chat_history`, `dietary_profiles`, `cookbook_entries`, and `terry_vision_scans` use client-generated text IDs (timestamps + random) to support offline-first creation without ID conflicts.

---

## 7. Security Model

### 7.1 What's Protected

| Layer | Protection | Details |
|-------|-----------|---------|
| **API keys** | Docker secrets | Mounted at `/run/secrets/`, never in env/image layers. Files: `TEXT_API_KEY`, `VISION_API_KEY`, `JWT_SECRET` |
| **Secret loading** | 3-tier fallback | Docker secrets → `./secrets/` directory (mode 600) → environment variables |
| **Passwords** | bcrypt(10) | Hashed server-side, never stored in plaintext |
| **JWT tokens** | 30-day expiry | Signed with `JWT_SECRET`; invalid/expired tokens return 401 |
| **Rate limiting** | 60 req/min per IP | Applied to `/api/ai/*` routes only; in-memory Map with 5-minute cleanup |
| **HTTP headers** | Helmet | Security headers (no CSP for mobile apps) |
| **CORS** | Origin allowlist | Only reflects configured `ALLOWED_ORIGINS` |
| **Body size** | Path-aware limits | 1MB default, 5MB for recipes/cookbook, 20MB for fridge scan |
| **SSRF protection** | IP validation | `isPrivateIP()` blocks requests to private/reserved ranges on image proxy |
| **SQL injection** | Prepared statements | All queries use `better-sqlite3` prepared statements with parameter binding |
| **LIKE injection** | Escape clause | `%` and `_` escaped in search queries on server side |
| **Input validation** | Field whitelisting | `RECIPE_ALLOWED_FIELDS` set strips unknown fields on recipe update |
| **Container** | Non-root, resource limits | 512MB RAM, 1 CPU |
| **Mobile keys** | Secure Store | API keys in `expo-secure-store` (Android Keystore, AES-256) |

### 7.2 What's Open / Known Gaps

| Area | Status | Details |
|------|--------|---------|
| **Open mode** | By design | No auth required for single-user self-hosted setups; all data under `user_id = 0` |
| **WebSocket auth** | JWT via query param | Token is validated on connection; anonymous allowed in open mode |
| **Token refresh** | Not implemented | 30-day tokens; no refresh endpoint; user must re-login on expiry |
| **Image upload validation** | No content check | `saveBase64Image` doesn't verify magic bytes; arbitrary binary accepted |
| **DNS rebinding** | Partial protection | SSRF check resolves DNS once then fetches; rebinding attack possible |
| **Per-user rate limiting** | Not implemented | Rate limiter keys on IP only; behind reverse proxy all clients share one bucket |
| **Input length limits** | Not enforced | No max-length on string fields (title, description, etc.); mitigated by 5MB body limit |
| **Meal plan sync** | Destructive | Delete-all then re-insert; safe within transaction but sends full plan each time |

### 7.3 Network Topology

```
┌─────────────┐       LAN (Wi-Fi)        ┌──────────────┐
│  Phone      │◄─────────────────────────►│  Docker Host │
│  (Expo APK) │   HTTP :3000 + WS /ws    │              │
└─────────────┘                           │  ┌──────────┐│
                                          │  │ Container││
Internet                                  │  │ (Node.js)││
   │                                      │  └────┬─────┘│
   │  AI API calls only                   │       │      │
   │  (DeepSeek, Gemini, etc.)            │  ┌────▼─────┐│
   ▼                                      │  │ SQLite   ││
┌──────────────────┐                      │  │ (volume) ││
│  AI Providers    │◄─────────────────────│  └──────────┘│
└──────────────────┘                      └──────────────┘
```

**No cloud.** The phone talks directly to the Docker container over LAN. AI API calls are the only outbound traffic from the server. The mobile app can also bypass the server entirely for AI by using custom provider keys stored locally.

---

## Appendix: Project Structure

```
cegin/
├── server/
│   ├── index.js          # Express API (routes, auth middleware, WS server, ~1214 lines)
│   ├── db.js             # SQLite schema, migrations, CRUD for all 17 tables (~1099 lines)
│   ├── ai.js             # AI provider integration, Chef Terry prompt (~1292 lines)
│   ├── auth.js           # JWT sign/verify, bcrypt, auth middleware (~83 lines)
│   ├── notifications.js  # Expo Push notification sender
│   ├── cron.js           # Scheduled jobs (morning digest, perishable alerts)
│   ├── secrets.js        # Secret loading (Docker secrets > ./secrets/ > env vars)
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── .env.example
├── mobile/
│   ├── App.js
│   └── src/
│       ├── api.js              # Server API client + offline cache + sync (~754 lines)
│       ├── offlineCache.js     # AsyncStorage cache + pending changes queue
│       ├── mealPlan.js         # Meal planner (local + server sync)
│       ├── localDb.js          # Local SQLite (expo-sqlite) for offline/local mode
│       ├── localAi.js          # Local mode AI (direct device-to-provider)
│       ├── config.js           # Key storage (secure store), server URL, app mode
│       ├── notifications.js    # Push notification registration
│       └── screens/
│           ├── RecipeListScreen.js
│           ├── RecipeDetailScreen.js
│           ├── EditRecipeScreen.js
│           ├── CookbookScreen.js
│           ├── MealPlannerScreen.js
│           ├── CookModeScreen.js
│           ├── AssistantScreen.js
│           ├── TerryVisionScreen.js
│           ├── ShoppingListScreen.js
│           ├── StatsScreen.js
│           ├── SettingsScreen.js
│           └── SetupScreen.js
└── docs/                 # cegin.kitchen landing page (GitHub Pages)
```
