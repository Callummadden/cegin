# Cegin REST API Documentation

Base URL: `http://YOUR_LAN_IP:3000/api`

All endpoints (except health, auth, and AI status) require authentication via JWT Bearer token:

```
Authorization: Bearer <your-jwt-token>
```

---

## Table of Contents

- [Health](#health)
- [Authentication](#authentication)
- [AI Assistant](#ai-assistant)
- [Recipes](#recipes)
- [Recipe Images](#recipe-images)
- [Recipe Collections (Legacy)](#recipe-collections-legacy)
- [Collections](#collections)
- [Notifications](#notifications)
- [Meal Plans](#meal-plans)
- [Scanned Items](#scanned-items)
- [Shopping List](#shopping-list)
- [Favorites](#favorites)
- [Chat History](#chat-history)
- [Dietary Profiles](#dietary-profiles)
- [Cookbook Entries](#cookbook-entries)
- [Terry Vision Scans](#terry-vision-scans)
- [Cook Stats](#cook-stats)
- [Activity Context](#activity-context)
- [Image Proxy](#image-proxy)
- [Static Files](#static-files)
- [WebSocket](#websocket)

---

## Health

### `GET /api/health`

Check server status and version info. No auth required.

**Response:**
```json
{
  "ok": true,
  "serverVersion": "1.4.0",
  "latestServerVersion": "1.4.0",
  "minClientVersion": "1.1.5",
  "latestClientVersion": "1.4.0"
}
```

---

## Authentication

### `POST /api/auth/register`

Register a new user. Rate limited to 10 requests/minute per IP.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword",
  "displayName": "Chef Name"
}
```

| Field | Type | Required | Description |
|:------|:-----|:---------|:------------|
| `email` | string | ✅ | User email (must be unique) |
| `password` | string | ✅ | Password (minimum 6 characters) |
| `displayName` | string | ❌ | Display name |

**Response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "displayName": "Chef Name"
  }
}
```

**Errors:**
- `400` — Email and password required, or password too short
- `409` — Email already registered
- `429` — Too many login attempts

---

### `POST /api/auth/login`

Log in with existing credentials. Rate limited to 10 requests/minute per IP.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "displayName": "Chef Name"
  }
}
```

**Errors:**
- `400` — Email and password required
- `401` — Invalid credentials
- `429` — Too many login attempts

---

### `GET /api/auth/me`

Get the currently authenticated user. Requires auth.

**Response (200):**
```json
{
  "id": 1,
  "email": "user@example.com",
  "displayName": "Chef Name"
}
```

---

## AI Assistant

All AI endpoints are rate limited to 60 requests/minute per IP.

### `GET /api/ai/status`

Check if AI is configured and which models are active. No auth required.

**Response:**
```json
{
  "configured": true,
  "textModel": "deepseek-chat",
  "visionModel": "gemini-2.5-flash"
}
```

---

### `GET /api/ai/models`

Fetch available models from the configured provider.

**Query Parameters:**
| Param | Type | Description |
|:------|:-----|:------------|
| `type` | string | `"text"` (default) or `"vision"` |

**Response:**
```json
{
  "models": ["deepseek-chat", "deepseek-reasoner"]
}
```

---

### `POST /api/ai/model`

Change the active AI model at runtime.

**Request Body:**
```json
{
  "type": "text",
  "model": "deepseek-reasoner"
}
```

| Field | Type | Required | Description |
|:------|:-----|:---------|:------------|
| `type` | string | ❌ | `"text"` (default) or `"vision"` |
| `model` | string | ✅ | Model identifier |

**Response:**
```json
{
  "ok": true,
  "textModel": "deepseek-reasoner",
  "visionModel": "gemini-2.5-flash"
}
```

---

### `POST /api/ai/chat`

Freeform cooking chat with Chef Terry.

**Request Body:**
```json
{
  "messages": [
    { "role": "user", "content": "How do I make a roux?" }
  ],
  "dietaryProfiles": [
    { "name": "Alice", "needs": "Gluten-free", "notes": "Celiac disease" }
  ]
}
```

| Field | Type | Required | Description |
|:------|:-----|:---------|:------------|
| `messages` | array | ✅ | Chat messages `[{ role, content }]` |
| `dietaryProfiles` | array | ❌ | Dietary context for the AI |

**Response:**
```json
{
  "reply": "A roux is a mixture of equal parts fat and flour..."
}
```

---

### `POST /api/ai/recipe`

Generate a structured recipe from a prompt or conversation.

**Request Body:**
```json
{
  "prompt": "A quick chicken stir fry for two"
}
```

*or*

```json
{
  "messages": [
    { "role": "user", "content": "I want something spicy with chicken" }
  ]
}
```

**Response:**
```json
{
  "recipe": {
    "title": "Spicy Chicken Stir Fry",
    "description": "...",
    "ingredients": ["500g chicken breast", "..."],
    "steps": ["Heat oil in a wok...", "..."],
    "tags": ["stir-fry", "spicy"],
    "prep_minutes": 15,
    "cook_minutes": 10,
    "servings": 2
  }
}
```

---

### `POST /api/ai/import`

Import a recipe from a web page URL.

**Request Body:**
```json
{
  "url": "https://example.com/recipes/chicken-curry"
}
```

**Response:** Same schema as `/api/ai/recipe`.

---

### `POST /api/ai/tidy`

Clean up and normalise a recipe with AI.

**Request Body:**
```json
{
  "recipe": { "title": "...", "ingredients": ["..."], "steps": ["..."] }
}
```

**Response:**
```json
{
  "recipe": { "title": "...", "ingredients": ["..."], "steps": ["..."] }
}
```

---

### `POST /api/ai/convert`

Convert ingredient measurements between metric and US units.

**Request Body:**
```json
{
  "ingredients": ["200g flour", "500ml milk"],
  "system": "us"
}
```

| Field | Type | Required | Description |
|:------|:-----|:---------|:------------|
| `ingredients` | array | ✅ | Array of ingredient strings |
| `system` | string | ❌ | `"metric"` or `"us"` (default: `"metric"`) |

**Response:**
```json
{
  "ingredients": ["1.5 cups flour", "2 cups milk"]
}
```

---

### `POST /api/ai/shopping-list`

Consolidate ingredients from multiple recipes into a smart shopping list.

**Request Body:**
```json
{
  "recipe_ids": [1, 2, 3]
}
```

**Response:**
```json
{
  "items": [
    { "name": "chicken breast", "quantity": "1kg", "category": "meat" },
    { "name": "onion", "quantity": "3", "category": "vegetables" }
  ]
}
```

---

### `POST /api/ai/meal-plan`

Generate an AI meal plan based on saved recipes.

**Request Body:**
```json
{
  "activityContext": { "weekType": "busy", "notes": "Working late Wednesday" },
  "dietaryProfiles": [{ "name": "Family", "needs": "No shellfish" }],
  "goal": "Quick weeknight dinners",
  "recipes": []
}
```

| Field | Type | Required | Description |
|:------|:-----|:---------|:------------|
| `activityContext` | object | ❌ | Context about the week |
| `dietaryProfiles` | array | ❌ | Dietary restrictions |
| `goal` | string | ❌ | Planning goal |
| `recipes` | array | ❌ | Specific recipes to use (if empty, uses all saved recipes) |

**Response:**
```json
{
  "plan": {
    "Monday": { "lunch": { "recipeId": 1, "title": "..." }, "dinner": { "recipeId": 2, "title": "..." } },
    "Tuesday": { ... }
  }
}
```

---

### `POST /api/ai/audit-recipe`

Audit a recipe against dietary profiles for allergen flags.

**Request Body:**
```json
{
  "recipe": { "title": "...", "ingredients": ["..."], "steps": ["..."] },
  "dietaryProfiles": [
    { "name": "Alice", "needs": "Gluten-free", "notes": "Celiac disease" }
  ]
}
```

**Response:**
```json
{
  "issues": [
    { "ingredient": "flour", "problem": "Contains gluten", "suggestion": "Use rice flour or almond flour" }
  ],
  "safe": false
}
```

---

### `POST /api/ai/apply-substitutions`

Apply dietary substitutions to a recipe.

**Request Body:**
```json
{
  "recipe": { "title": "...", "ingredients": ["200g flour", "..."] },
  "substitutions": ["Swap flour for almond flour"]
}
```

**Response:**
```json
{
  "recipe": { "title": "...", "ingredients": ["200g almond flour", "..."] }
}
```

---

### `POST /api/ai/fix-mistake`

Mid-cook panic fix — tell Terry what went wrong.

**Request Body:**
```json
{
  "recipe": { "title": "...", "steps": ["..."] },
  "currentStep": "Fry the onions until golden",
  "problem": "The onions burned and the pan is smoking"
}
```

**Response:**
```json
{
  "advice": "Don't panic! Turn off the heat immediately...",
  "revisedSteps": ["Discard burned onions...", "..."]
}
```

---

### `POST /api/ai/adjust-cooking`

Adjust cooking times/temps for modifications (thicker cut, different protein, etc.).

**Request Body:**
```json
{
  "recipe": { "title": "...", "steps": ["..."] },
  "modifications": "Using a 2-inch thick steak instead of 1-inch"
}
```

**Response:**
```json
{
  "adjustments": "Increase cooking time to 6 minutes per side...",
  "revisedSteps": ["..."]
}
```

---

### `POST /api/ai/nutrition`

Estimate nutrition per serving.

**Request Body:**
```json
{
  "title": "Chicken Stir Fry",
  "ingredients": ["500g chicken breast", "2 tbsp soy sauce", "1 cup rice"],
  "servings": 2
}
```

**Response:**
```json
{
  "calories": 450,
  "protein": "35g",
  "carbs": "40g",
  "fat": "12g",
  "fiber": "3g"
}
```

---

### `POST /api/ai/prep-steps`

Generate preparation/mise en place steps.

**Request Body:**
```json
{
  "title": "Chicken Stir Fry",
  "ingredients": ["500g chicken breast", "2 tbsp soy sauce"],
  "steps": ["Heat oil...", "Add chicken..."]
}
```

**Response:**
```json
{
  "prepSteps": ["Slice chicken into thin strips", "Measure out soy sauce", "..."]
}
```

---

### `POST /api/ai/scan-fridge`

Scan a fridge/pantry photo and identify ingredients (Gemini Vision). Max body size: 20 MB.

**Request Body:**
```json
{
  "image": "/9j/4AAQSkZJRg..."
}
```

| Field | Type | Required | Description |
|:------|:-----|:---------|:------------|
| `image` | string | ✅ | Base64-encoded JPEG (no `data:` prefix) |

**Response:**
```json
{
  "ingredients": [
    { "name": "chicken breast", "confidence": "high" },
    { "name": "broccoli", "confidence": "medium" }
  ],
  "suggestedRecipes": ["Chicken Stir Fry", "Chicken and Broccoli"]
}
```

---

### `POST /api/ai/scan-recipe`

Scan a recipe photo and extract structured data.

**Request Body:**
```json
{
  "image": "/9j/4AAQSkZJRg..."
}
```

**Response:** Same schema as `/api/ai/recipe`.

---

## Recipes

### `GET /api/recipes`

List all recipes for the authenticated user.

**Query Parameters:**
| Param | Type | Description |
|:------|:-----|:------------|
| `search` | string | Search in title, description, tags, and ingredients |

**Response:**
```json
[
  {
    "id": 1,
    "title": "Chicken Stir Fry",
    "description": "Quick weeknight dinner",
    "ingredients": ["500g chicken breast", "2 tbsp soy sauce"],
    "steps": ["Heat oil in a wok", "Add chicken and stir fry"],
    "tags": ["asian", "quick"],
    "prep_minutes": 15,
    "cook_minutes": 10,
    "servings": 2,
    "image_url": "",
    "notes": "",
    "collection": "Weeknight Dinners",
    "user_id": 1,
    "created_at": "2026-01-15T12:00:00",
    "updated_at": "2026-01-15T12:00:00"
  }
]
```

---

### `GET /api/recipes/search`

Search recipes by ingredients.

**Query Parameters:**
| Param | Type | Required | Description |
|:------|:-----|:---------|:------------|
| `ingredients` | string | ✅ | Comma-separated ingredient list |

**Response:** Array of matching recipes (same schema as above), ordered by match count.

---

### `GET /api/recipes/:id`

Get a single recipe by ID.

**Response:** Single recipe object (same schema as above).

**Errors:**
- `400` — Invalid recipe ID
- `404` — Recipe not found

---

### `POST /api/recipes`

Create a new recipe. Max body size: 5 MB.

**Request Body:**
```json
{
  "title": "Chicken Stir Fry",
  "description": "Quick weeknight dinner",
  "ingredients": ["500g chicken breast"],
  "steps": ["Heat oil", "Cook chicken"],
  "tags": ["asian"],
  "prep_minutes": 15,
  "cook_minutes": 10,
  "servings": 2,
  "image_url": "",
  "notes": "",
  "collection": "Weeknight Dinners"
}
```

| Field | Type | Required | Description |
|:------|:-----|:---------|:------------|
| `title` | string | ✅ | Recipe title |
| `description` | string | ❌ | Short description |
| `ingredients` | array | ❌ | Array of ingredient strings |
| `steps` | array | ❌ | Array of step strings |
| `tags` | array | ❌ | Array of tag strings |
| `prep_minutes` | number | ❌ | Prep time in minutes |
| `cook_minutes` | number | ❌ | Cook time in minutes |
| `servings` | number | ❌ | Number of servings |
| `image_url` | string | ❌ | Image URL or base64 data URI |
| `notes` | string | ❌ | Personal notes |
| `collection` | string | ❌ | Collection name |

**Response (201):** Created recipe object.

---

### `PUT /api/recipes/:id`

Update an existing recipe. Max body size: 5 MB.

**Request Body:** Same fields as POST (all optional except at least one).

**Response:** Updated recipe object.

**Errors:**
- `400` — Invalid recipe ID
- `404` — Recipe not found

---

### `DELETE /api/recipes/:id`

Delete a recipe.

**Response:** `204 No Content`

**Errors:**
- `400` — Invalid recipe ID
- `404` — Recipe not found

---

## Recipe Images

### `GET /api/recipes/:id/images`

Get all images for a recipe.

**Response:**
```json
[
  {
    "id": 1,
    "recipe_id": 1,
    "image_url": "https://example.com/photo.jpg",
    "position": 0,
    "created_at": "2026-01-15T12:00:00"
  }
]
```

---

### `POST /api/recipes/:id/images`

Add an image to a recipe.

**Request Body:**
```json
{
  "image_url": "https://example.com/photo.jpg"
}
```

**Response (201):** Created image object.

---

### `DELETE /api/images/:id`

Delete a recipe image.

**Response:** `204 No Content`

---

## Recipe Collections (Legacy)

These return the distinct `collection` string field from the recipes table.

### `GET /api/recipe-collections`

Get distinct collection names from recipes.

**Response:**
```json
["Weeknight Dinners", "Desserts", "Soups"]
```

---

## Collections

Full-featured named collections with recipe IDs.

### `GET /api/collections`

List all collections.

**Response:**
```json
[
  {
    "id": 1,
    "name": "Favourites",
    "recipe_ids": [1, 3, 5],
    "user_id": 1,
    "created_at": "2026-01-15T12:00:00"
  }
]
```

---

### `GET /api/collections/:id`

Get a single collection.

**Response:** Single collection object.

---

### `POST /api/collections`

Create a new collection.

**Request Body:**
```json
{
  "name": "Favourites"
}
```

**Response (201):** Created collection object.

**Errors:**
- `400` — Name required
- `409` — Collection name already exists

---

### `PUT /api/collections/:id`

Update a collection.

**Request Body:**
```json
{
  "name": "New Name",
  "recipe_ids": [1, 2, 3]
}
```

**Response:** Updated collection object.

---

### `DELETE /api/collections/:id`

Delete a collection.

**Response:**
```json
{ "ok": true }
```

---

### `POST /api/collections/:id/recipes/:recipeId`

Add a recipe to a collection.

**Response:** Updated collection object.

---

### `DELETE /api/collections/:id/recipes/:recipeId`

Remove a recipe from a collection.

**Response:** Updated collection object.

---

## Notifications

### `GET /api/notifications/settings`

Get notification subscription settings.

**Response:**
```json
{
  "morning_digest": 1,
  "perishable_alerts": 1
}
```

---

### `PUT /api/notifications/settings`

Update notification subscription settings.

**Request Body:**
```json
{
  "morning_digest": true,
  "perishable_alerts": false
}
```

**Response:** Updated settings object.

---

### `POST /api/notifications/register`

Register a push notification token.

**Request Body:**
```json
{
  "token": "ExponentPushToken[xxxxx]",
  "deviceName": "Pixel 8"
}
```

**Response:** Saved token object.

---

### `POST /api/notifications/unregister`

Unregister a push token (e.g. on logout).

**Request Body:**
```json
{
  "token": "ExponentPushToken[xxxxx]"
}
```

**Response:**
```json
{ "ok": true }
```

---

### `POST /api/notifications/test`

Send a test push notification to the current user's devices.

**Response:**
```json
{ "ok": true, "message": "Test sent to 1 device(s)!" }
```

---

## Meal Plans

### `GET /api/meal-plan`

Get the current user's meal plan.

**Response:**
```json
[
  {
    "id": 1,
    "user_id": 1,
    "date": "2026-01-15",
    "meal": "dinner",
    "recipe_id": 5,
    "created_at": "2026-01-15T12:00:00",
    "updated_at": "2026-01-15T12:00:00"
  }
]
```

---

### `POST /api/meal-plan/sync`

Sync the meal plan from the mobile app.

**Request Body:**
```json
{
  "plan": {
    "2026-01-15": { "lunch": 1, "dinner": 3 },
    "2026-01-16": { "dinner": 5 }
  }
}
```

**Response:** Synced meal plan array.

---

## Scanned Items

Items from Terry Vision fridge scans.

### `GET /api/scanned-items`

Get scanned items.

**Query Parameters:**
| Param | Type | Description |
|:------|:-----|:------------|
| `all` | string | `"true"` to include consumed items |

**Response:**
```json
[
  {
    "id": 1,
    "user_id": 1,
    "item_name": "chicken breast",
    "scanned_at": "2026-01-15T12:00:00",
    "expires_at": "2026-01-20T12:00:00",
    "consumed": 0
  }
]
```

---

### `POST /api/scanned-items`

Add scanned items.

**Request Body:**
```json
{
  "items": [
    { "name": "chicken breast", "expires_at": "2026-01-20" },
    { "name": "broccoli", "expires_at": "2026-01-18" }
  ]
}
```

*or simply:* `["chicken breast", "broccoli"]`

**Response (201):** Array of created items.

---

### `PUT /api/scanned-items/:id/consume`

Mark an item as consumed.

**Response:**
```json
{ "ok": true }
```

---

## Shopping List

### `GET /api/shopping-list`

Get the shopping list.

**Response:**
```json
[
  { "name": "chicken breast", "quantity": "500g", "checked": false },
  { "name": "soy sauce", "quantity": "2 tbsp", "checked": true }
]
```

---

### `PUT /api/shopping-list`

Replace the entire shopping list.

**Request Body:**
```json
{
  "items": [
    { "name": "chicken breast", "quantity": "500g", "checked": false }
  ]
}
```

**Response:** Updated shopping list.

---

### `DELETE /api/shopping-list`

Clear the shopping list.

**Response:**
```json
{ "ok": true }
```

---

## Favorites

### `GET /api/favorites`

Get the user's favourites.

**Response:** Favourites object (key-value map of recipe IDs).

---

### `PUT /api/favorites`

Replace favourites.

**Request Body:**
```json
{
  "favorites": { "1": true, "3": true, "5": false }
}
```

**Response:** Updated favourites object.

---

### `DELETE /api/favorites`

Clear all favourites.

**Response:**
```json
{ "ok": true }
```

---

## Chat History

### `GET /api/chat-history`

Get the Chef Terry chat history.

**Response:** Array of chat messages.

---

### `PUT /api/chat-history`

Replace chat history.

**Request Body:**
```json
{
  "history": [
    { "role": "user", "content": "How do I make a roux?" },
    { "role": "assistant", "content": "A roux is..." }
  ]
}
```

**Response:** Synced history array.

---

### `DELETE /api/chat-history`

Clear chat history.

**Response:**
```json
{ "ok": true }
```

---

## Dietary Profiles

### `GET /api/dietary-profiles`

Get dietary profiles.

**Response:**
```json
[
  { "name": "Alice", "needs": "Gluten-free", "notes": "Celiac disease" },
  { "name": "Bob", "needs": "Vegetarian", "notes": "" }
]
```

---

### `PUT /api/dietary-profiles`

Replace dietary profiles.

**Request Body:**
```json
{
  "profiles": [
    { "name": "Alice", "needs": "Gluten-free", "notes": "Celiac disease" }
  ]
}
```

**Response:** Updated profiles array.

---

### `DELETE /api/dietary-profiles`

Clear all dietary profiles.

**Response:**
```json
{ "ok": true }
```

---

## Cookbook Entries

Kitchen log entries with photos. Max body size: 5 MB.

### `GET /api/cookbook`

Get all cookbook entries.

**Response:**
```json
[
  {
    "id": "abc123",
    "recipeId": 1,
    "recipeTitle": "Chicken Stir Fry",
    "imageUri": "/api/uploads/cookbook/1234567890-abc.jpg",
    "date": "2026-01-15",
    "notes": "Turned out great!"
  }
]
```

---

### `POST /api/cookbook`

Create a cookbook entry.

**Request Body:**
```json
{
  "recipeId": 1,
  "recipeTitle": "Chicken Stir Fry",
  "imageBase64": "/9j/4AAQSkZJRg...",
  "date": "2026-01-15",
  "notes": "Turned out great!"
}
```

**Response (201):** Created entry.

---

### `PUT /api/cookbook/:id`

Update a cookbook entry.

**Request Body:** Same fields as POST (all optional).

**Response:** Updated entry.

---

### `DELETE /api/cookbook/:id`

Delete a single cookbook entry.

**Response:**
```json
{ "ok": true }
```

---

### `DELETE /api/cookbook`

Clear all cookbook entries for the current user.

**Response:**
```json
{ "ok": true }
```

---

## Terry Vision Scans

### `GET /api/terry-vision/scans`

Get all Terry Vision scans.

**Response:**
```json
[
  {
    "id": "tv_1234567890_abc",
    "section": "fridge",
    "imageUri": "/api/uploads/terry-vision/tv_1234567890_abc.jpg",
    "ingredients": ["chicken breast", "broccoli"],
    "created_at": "2026-01-15T12:00:00"
  }
]
```

---

### `POST /api/terry-vision/scans`

Upload a Terry Vision scan.

**Request Body:**
```json
{
  "section": "fridge",
  "imageBase64": "/9j/4AAQSkZJRg...",
  "ingredients": ["chicken breast", "broccoli"]
}
```

**Response (201):** Created scan object.

---

### `DELETE /api/terry-vision/scans/:id`

Delete a single scan.

**Response:**
```json
{ "ok": true }
```

---

### `DELETE /api/terry-vision/scans`

Clear all scans for the current user.

**Response:**
```json
{ "ok": true }
```

---

## Cook Stats

### `GET /api/stats`

Get cooking statistics, streak, and top recipes.

**Response:**
```json
{
  "totalCooks": 42,
  "totalSteps": 156,
  "streak": 7,
  "topRecipes": [
    { "recipeId": 1, "recipeTitle": "Chicken Stir Fry", "count": 8 }
  ]
}
```

---

### `POST /api/stats/record`

Record a completed cook session.

**Request Body:**
```json
{
  "recipeId": 1,
  "recipeTitle": "Chicken Stir Fry",
  "stepCount": 5
}
```

**Response:** Updated stats with streak.

---

### `DELETE /api/stats`

Clear all cooking stats for the current user.

**Response:**
```json
{ "ok": true }
```

---

## Activity Context

Context about the user's current activity/week for meal planning AI.

### `GET /api/activity-context`

**Response:** Activity context object.

---

### `PUT /api/activity-context`

**Request Body:**
```json
{
  "context": {
    "weekType": "busy",
    "notes": "Working late Wednesday and Thursday"
  }
}
```

**Response:** Synced context object.

---

### `DELETE /api/activity-context`

**Response:**
```json
{ "ok": true }
```

---

## Image Proxy

### `GET /api/image-proxy`

Proxy and resize external images with SSRF protection. Caches results for 30 days.

**Query Parameters:**
| Param | Type | Required | Description |
|:------|:-----|:---------|:------------|
| `url` | string | ✅ | Image URL (http/https only) |
| `w` | number | ❌ | Target width in pixels (default: 600, max: 1200) |

**Response:** Resized JPEG image.

**Errors:**
- `400` — Invalid URL, private/local address blocked
- `502` — Fetch failed

---

## Static Files

### `GET /api/uploads/cookbook/:filename`

Serve uploaded cookbook images.

### `GET /api/uploads/terry-vision/:filename`

Serve Terry Vision scan images.

---

## WebSocket

Connect to `ws://YOUR_LAN_IP:3000/ws?token=<jwt>` for real-time sync.

**Connection:**
```javascript
const ws = new WebSocket('ws://192.168.1.100:3000/ws?token=eyJ...');
```

**Incoming Messages (server → client):**
```json
{ "type": "recipes", "action": "changed" }
{ "type": "collections", "action": "changed" }
{ "type": "meal_plan", "action": "changed" }
{ "type": "shopping_list", "action": "changed" }
{ "type": "favorites", "action": "changed" }
{ "type": "chat_history", "action": "changed" }
{ "type": "dietary_profiles", "action": "changed" }
{ "type": "cookbook", "action": "changed" }
{ "type": "terry_vision", "action": "changed" }
{ "type": "stats", "action": "changed" }
{ "type": "activity_context", "action": "changed" }
{ "type": "scanned_items", "action": "changed" }
```

**Ping/Pong:**
```javascript
// Client sends:
ws.send(JSON.stringify({ type: 'ping' }));
// Server responds:
{ "type": "pong" }
```

Server pings clients every 30 seconds. Respond with pong to keep the connection alive.

---

## Error Responses

All error responses follow this format:

```json
{
  "error": "Human-readable error message"
}
```

Common HTTP status codes:
| Code | Meaning |
|:-----|:--------|
| `400` | Bad request / validation error |
| `401` | Not authenticated |
| `404` | Resource not found |
| `409` | Conflict (e.g. duplicate name) |
| `429` | Rate limit exceeded |
| `500` | Internal server error |
| `502` | Upstream fetch failed (image proxy) |
