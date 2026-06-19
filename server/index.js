const express = require('express');
const fs = require('fs');
const path = require('path');
const { readSecret, readConfig } = require('./secrets');
const {
  listRecipes,
  getRecipe,
  createRecipe,
  updateRecipe,
  deleteRecipe,
  getDistinctCollections,
  searchByIngredients,
  listCollections,
  getCollection,
  createCollection,
  updateCollection,
  deleteCollection,
  addRecipeToCollection,
  removeRecipeFromCollection,
  getRecipeImages,
  addRecipeImage,
  deleteRecipeImage,
} = require('./db');
const ai = require('./ai');
const { signToken, authMiddleware, hashPassword, comparePassword } = require('./auth');
const dbModule = require('./db');
const { OAuth2Client } = require('google-auth-library');
const { startCron } = require('./cron');
const { sendPush } = require('./notifications');

const app = express();

// --- CORS (S2-1: only reflect allowed origins) ---
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:8081,http://localhost:19006')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// --- Rate limiter for AI routes (S2-2: short-circuit, S2-3: before body parser) ---
const rateLimitMap = new Map();
const RATE_LIMIT = 60; // requests per minute
const RATE_WINDOW = 60 * 1000; // 1 minute in ms

function rateLimiter(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetTime) {
    entry = { count: 0, resetTime: now + RATE_WINDOW };
    rateLimitMap.set(ip, entry);
  }
  // S2-2: Short-circuit — reject before incrementing if already at limit
  if (entry.count >= RATE_LIMIT) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  entry.count++;
  next();
}

// Clean up stale entries every 5 minutes
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetTime) rateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000);
cleanupTimer.unref();

// S2-3: Rate limiter early on /api/ai routes (before body parser)
app.use('/api/ai', rateLimiter);

// --- Body parsing (S2-11: path-aware to avoid stacking) ---
const bodyParser1mb = express.json({ limit: '1mb' });
const bodyParser20mb = express.json({ limit: '20mb' });

// S2-11: Single body parser middleware — 20mb for scan-fridge, 1mb for everything else
app.use((req, res, next) => {
  if (req.path === '/api/ai/scan-fridge') {
    return bodyParser20mb(req, res, next);
  }
  bodyParser1mb(req, res, next);
});

// --- Auth middleware applied to all non-auth, non-health routes ---
app.use('/api', (req, res, next) => {
  // Skip auth for /api/auth/* and /api/health and /api/ai/status
  if (
    req.path.startsWith('/auth/') ||
    req.path === '/health' ||
    req.path === '/ai/status'
  ) {
    return next();
  }
  return authMiddleware(dbModule)(req, res, next);
});

// OAuth callback routes (not under /api, no auth needed)
// These are already excluded since they're not under /api

// Health check — the app uses this to test the connection in Settings
app.get('/api/health', (req, res) => res.json({ ok: true }));

// --- Auth ---

app.post('/api/auth/register', async (req, res) => {
  const { email, password, displayName } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (typeof email !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Email and password must be strings' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const existing = dbModule.getUserByEmail(email.toLowerCase().trim());
  if (existing) return res.status(409).json({ error: 'Email already registered' });
  const hash = await hashPassword(password);
  const user = dbModule.createUser(email.toLowerCase().trim(), hash, displayName);
  const token = signToken(user);
  res.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name } });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (typeof email !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Email and password must be strings' });
  const user = dbModule.getUserByEmail(email.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const valid = await comparePassword(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  const token = signToken(user);
  res.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name } });
});

// Google OAuth redirect flow (server-side)
app.get('/auth/google/redirect', (req, res) => {
  const clientId = readConfig('GOOGLE_CLIENT_ID');
  if (!clientId) return res.status(503).json({ error: 'Google Sign-In not configured' });
  const redirectUri = encodeURIComponent(process.env.REDIRECT_URI || `${process.env.APP_URL || 'http://localhost:3000'}/auth/google/callback`);
  const scope = encodeURIComponent('openid email profile');
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&access_type=offline`;
  res.redirect(url);
});

// Google OAuth callback
app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No code provided');
  const clientId = readConfig('GOOGLE_CLIENT_ID');
  const clientSecret = readSecret('GOOGLE_CLIENT_SECRET');
  const redirectUri = process.env.REDIRECT_URI || `${process.env.APP_URL || 'http://localhost:3000'}/auth/google/callback`;
  try {
    // S2-5: URL-encode all body parameters
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
      signal: AbortSignal.timeout(30000), // S2-12
    });
    const tokens = await tokenResp.json();
    if (!tokens.access_token) return res.status(401).send('Token exchange failed');

    // Get user info
    const userResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(30000), // S2-12
    });
    const userinfo = await userResp.json();
    if (!userinfo.email) return res.status(401).send('Could not get email from Google');
    const email = userinfo.email.toLowerCase().trim();
    const name = userinfo.name || '';

    let user = dbModule.getUserByEmail(email);
    if (!user) {
      user = dbModule.createUser(email, 'google-auth', name);
    }

    const token = signToken(user);
    // S2-15: Use fragment (#) instead of query param, and encode the token
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    res.redirect(`${appUrl}/auth/callback#token=${encodeURIComponent(token)}`);
  } catch (e) {
    res.status(500).send('Authentication failed');
  }
});

app.post('/api/auth/google', async (req, res) => {
  const { idToken, accessToken } = req.body;
  if (!idToken && !accessToken) return res.status(400).json({ error: 'idToken or accessToken required' });
  try {
    let email, name;

    if (idToken) {
      // Native Google Sign-In — verify the ID token properly using google-auth-library
      const client = new OAuth2Client(readConfig('GOOGLE_CLIENT_ID'));
      const ticket = await client.verifyIdToken({ idToken, audience: readConfig('GOOGLE_CLIENT_ID') });
      const payload = ticket.getPayload();
      if (!payload.email) return res.status(401).json({ error: 'No email in token' });
      if (!payload.email_verified) return res.status(401).json({ error: 'Email not verified' });
      email = payload.email.toLowerCase().trim();
      name = payload.name || '';
    } else {
      // Web OAuth flow — verify access token via userinfo
      const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(30000), // S2-12
      });
      if (!resp.ok) return res.status(401).json({ error: 'Invalid Google token' });
      const payload = await resp.json();
      if (!payload.email) return res.status(401).json({ error: 'Could not get email from Google' });
      email = payload.email.toLowerCase().trim();
      name = payload.name || '';
    }

    let user = dbModule.getUserByEmail(email);
    if (!user) {
      user = dbModule.createUser(email, 'google-auth', name);
    }

    const token = signToken(user);
    res.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name } });
  } catch (e) {
    res.status(401).json({ error: 'Invalid Google token' });
  }
});

app.get('/api/auth/me', authMiddleware(dbModule), (req, res) => {
  const u = req.user;
  res.json({ id: u.id, email: u.email, displayName: u.display_name });
});

// --- AI assistant ---

// Lets the app know whether the AI features are available before showing them
app.get('/api/ai/status', (req, res) => {
  res.json({
    configured: ai.isConfigured(),
    textModel: ai.getTextModel(),
    visionModel: ai.getVisionModel(),
  });
});

// Fetch available models from the configured provider
app.get('/api/ai/models', async (req, res) => {
  const type = req.query.type === 'vision' ? 'vision' : 'text';
  try {
    const models = await ai.fetchAvailableModels(type);
    res.json({ models });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Change the active model at runtime
app.post('/api/ai/model', (req, res) => {
  const { type, model } = req.body;
  if (!model) return res.status(400).json({ error: 'model is required' });
  if (type === 'vision') {
    ai.setVisionModel(model);
  } else {
    ai.setTextModel(model);
  }
  res.json({ ok: true, textModel: ai.getTextModel(), visionModel: ai.getVisionModel() });
});

// Freeform cooking chat. Body: { messages: [{ role, content }], dietaryProfiles?: [...] }
app.post('/api/ai/chat', async (req, res) => {
  const messages = req.body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }
  try {
    const { dietaryProfiles } = req.body;
    const reply = await ai.chat(messages, req.user?.id, dietaryProfiles);
    res.json({ reply });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Turn a prompt or a conversation into a structured recipe (not saved yet).
// Body: { prompt } or { messages }
app.post('/api/ai/recipe', async (req, res) => {
  const { prompt, messages } = req.body;
  if (!prompt && !(Array.isArray(messages) && messages.length)) {
    return res.status(400).json({ error: 'prompt or messages is required' });
  }
  try {
    const recipe = await ai.generateRecipe({ prompt, messages }, req.user?.id);
    res.json({ recipe });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Import a recipe from a web page URL. Body: { url }
app.post('/api/ai/import', async (req, res) => {
  if (!req.body.url || !String(req.body.url).trim()) {
    return res.status(400).json({ error: 'url is required' });
  }
  try {
    const recipe = await ai.importFromUrl(String(req.body.url).trim());
    res.json({ recipe });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Clean up a recipe with the AI (manual "Clean up" button). Body: { recipe }
app.post('/api/ai/tidy', async (req, res) => {
  const { recipe } = req.body;
  if (!recipe || typeof recipe !== 'object') {
    return res.status(400).json({ error: 'recipe is required' });
  }
  try {
    const tidied = await ai.tidyRecipe(recipe);
    res.json({ recipe: tidied });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Convert ingredient measurements. Body: { ingredients: [...], system: 'metric'|'us' }
app.post('/api/ai/convert', async (req, res) => {
  const { ingredients, system } = req.body;
  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    return res.status(400).json({ error: 'ingredients array is required' });
  }
  try {
    const converted = await ai.convertUnits(ingredients, system);
    res.json({ ingredients: converted });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Smart shopping list: consolidate ingredients from multiple recipes.
// Body: { recipe_ids: [1, 2, 3] }
app.post('/api/ai/shopping-list', async (req, res) => {
  const { recipe_ids } = req.body;
  if (!Array.isArray(recipe_ids) || recipe_ids.length === 0) {
    return res.status(400).json({ error: 'recipe_ids array is required' });
  }
  try {
    // S2-16: Pass req.user?.id to getRecipe for ownership scoping
    const userId = req.user?.id;
    const recipes = recipe_ids.map(id => getRecipe(id, userId)).filter(Boolean);
    const result = await ai.consolidateShoppingList(recipes);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// AI meal plan suggestion based on saved recipes.
// Optional body: { activityContext: {...}, dietaryProfiles: [{ name, needs, notes }] }
app.post('/api/ai/meal-plan', async (req, res) => {
  try {
    // S2-16: Pass req.user?.id to listRecipes for ownership scoping
    const userId = req.user?.id;
    const recipes = listRecipes(undefined, userId);
    const { activityContext, dietaryProfiles } = req.body || {};
    const result = await ai.suggestMealPlan(recipes, { activityContext, dietaryProfiles, userId: req.user?.id });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Audit a recipe against dietary profiles. Body: { recipe, dietaryProfiles: [{ name, needs, notes }] }
app.post('/api/ai/audit-recipe', async (req, res) => {
  const { recipe, dietaryProfiles } = req.body;
  if (!recipe || !Array.isArray(dietaryProfiles) || dietaryProfiles.length === 0) {
    return res.status(400).json({ error: 'recipe and dietaryProfiles array are required' });
  }
  try {
    const result = await ai.auditRecipe(recipe, dietaryProfiles);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// "I Messed Up" — panic fix for mid-cook disasters.
// Body: { recipe: {...}, currentStep: "step text", problem: "what went wrong" }
app.post('/api/ai/fix-mistake', async (req, res) => {
  const { recipe, currentStep, problem } = req.body;
  if (!recipe || !currentStep || !problem) {
    return res.status(400).json({ error: 'recipe, currentStep, and problem are required' });
  }
  try {
    const result = await ai.fixMistake(recipe, currentStep, problem);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Adjust cooking times/temps for modifications (thicker cut, different protein, etc.)
// Body: { recipe: {...}, modifications: "description of changes" }
app.post('/api/ai/adjust-cooking', async (req, res) => {
  const { recipe, modifications } = req.body;
  if (!recipe || !modifications) {
    return res.status(400).json({ error: 'recipe and modifications are required' });
  }
  try {
    const result = await ai.adjustCooking(recipe, modifications);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Estimate nutrition per serving. Body: { title, ingredients, servings }
app.post('/api/ai/nutrition', async (req, res) => {
  const { title, ingredients, servings } = req.body;
  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    return res.status(400).json({ error: 'ingredients array is required' });
  }
  try {
    const nutrition = await ai.estimateNutrition({ title, ingredients, servings });
    res.json({ nutrition });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/ai/prep-steps', async (req, res) => {
  const { title, ingredients, steps } = req.body;
  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    return res.status(400).json({ error: 'ingredients array is required' });
  }
  try {
    const result = await ai.generatePrepSteps({ title, ingredients, steps });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Scan a fridge photo and return identified ingredients (Gemini Vision)
// Uses 20mb body limit — handled by path-aware body parser middleware (S2-11)
app.post('/api/ai/scan-fridge', async (req, res) => {
  const { image } = req.body; // base64 JPEG (no data: prefix)
  if (!image) {
    return res.status(400).json({ error: 'image is required (base64 JPEG)' });
  }
  try {
    const result = await ai.scanFridge(image);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// --- Recipes ---

app.get('/api/recipes', (req, res) => {
  // S2-7: Pass userId for ownership scoping
  res.json(listRecipes(req.query.search, req.user?.id));
});

app.get('/api/recipes/search', (req, res) => {
  const raw = req.query.ingredients;
  if (!raw || !String(raw).trim()) {
    return res.status(400).json({ error: 'ingredients query param is required (comma-separated)' });
  }
  const ingredientList = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  if (ingredientList.length === 0) {
    return res.status(400).json({ error: 'at least one ingredient is required' });
  }
  // S2-7: Pass userId for ownership scoping
  res.json(searchByIngredients(ingredientList, req.user?.id));
});

app.get('/api/recipes/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid recipe ID' });
  // S2-7: Pass userId for ownership scoping
  const recipe = getRecipe(id, req.user?.id);
  if (!recipe) return res.status(404).json({ error: 'Recipe not found' });
  res.json(recipe);
});

app.post('/api/recipes', (req, res) => {
  if (!req.body.title || !req.body.title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  // S2-7: Pass userId for ownership
  res.status(201).json(createRecipe(req.body, req.user?.id));
});

app.put('/api/recipes/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid recipe ID' });
  // S2-7: Pass userId for ownership scoping
  const recipe = updateRecipe(id, req.body, req.user?.id);
  if (!recipe) return res.status(404).json({ error: 'Recipe not found' });
  res.json(recipe);
});

app.delete('/api/recipes/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid recipe ID' });
  // S2-7: Pass userId for ownership scoping
  if (!deleteRecipe(id, req.user?.id)) {
    return res.status(404).json({ error: 'Recipe not found' });
  }
  res.status(204).end();
});

// --- Recipe collection names (distinct from recipes table) ---

app.get('/api/recipe-collections', (req, res) => {
  // S2-7: Pass userId for ownership scoping
  res.json(getDistinctCollections(req.user?.id));
});

// --- Collections ---

app.get('/api/collections', (req, res) => {
  // S2-7: Pass userId for ownership scoping
  res.json(listCollections(req.user?.id));
});

app.get('/api/collections/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid collection ID' });
  // S2-7: Pass userId for ownership scoping
  const col = getCollection(id, req.user?.id);
  if (!col) return res.status(404).json({ error: 'Collection not found' });
  res.json(col);
});

app.post('/api/collections', (req, res, next) => {
  if (!req.body.name || !req.body.name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  // S2-7: Pass userId for ownership; S2-9: createCollection now handles UNIQUE errors
  try {
    res.status(201).json(createCollection(req.body.name, req.user?.id));
  } catch (e) {
    next(e); // S2-10: Forward to error handler
  }
});

app.put('/api/collections/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid collection ID' });
  // S2-7: Pass userId for ownership scoping
  const col = updateCollection(id, req.body, req.user?.id);
  if (!col) return res.status(404).json({ error: 'Collection not found' });
  res.json(col);
});

app.delete('/api/collections/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid collection ID' });
  // S2-7: Pass userId for ownership scoping
  if (!deleteCollection(id, req.user?.id)) {
    return res.status(404).json({ error: 'Collection not found' });
  }
  res.status(204).end();
});

app.post('/api/collections/:id/recipes/:recipeId', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const recipeId = parseInt(req.params.recipeId, 10);
  if (isNaN(id) || isNaN(recipeId)) return res.status(400).json({ error: 'Invalid ID' });
  // S2-7: Pass userId for ownership scoping
  const col = addRecipeToCollection(id, recipeId, req.user?.id);
  if (!col) return res.status(404).json({ error: 'Collection not found' });
  res.json(col);
});

app.delete('/api/collections/:id/recipes/:recipeId', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const recipeId = parseInt(req.params.recipeId, 10);
  if (isNaN(id) || isNaN(recipeId)) return res.status(400).json({ error: 'Invalid ID' });
  // S2-7: Pass userId for ownership scoping
  const col = removeRecipeFromCollection(id, recipeId, req.user?.id);
  if (!col) return res.status(404).json({ error: 'Collection not found' });
  res.json(col);
});

// --- Recipe Images ---

app.get('/api/recipes/:id/images', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid recipe ID' });
  res.json(getRecipeImages(id, req.user?.id));
});

app.post('/api/recipes/:id/images', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid recipe ID' });
  if (!req.body.image_url) return res.status(400).json({ error: 'image_url is required' });
  const image = addRecipeImage(id, req.body.image_url, req.user?.id);
  if (!image) return res.status(404).json({ error: 'Recipe not found' });
  res.status(201).json(image);
});

app.delete('/api/images/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid image ID' });
  if (!deleteRecipeImage(id, req.user?.id)) {
    return res.status(404).json({ error: 'Image not found' });
  }
  res.status(204).end();
});

// --- Notification Settings ---

app.get('/api/notifications/settings', (req, res) => {
  const sub = dbModule.getNotificationSubscription(req.user.id);
  res.json(sub || { morning_digest: 1, perishable_alerts: 1 });
});

app.put('/api/notifications/settings', (req, res) => {
  const { morning_digest, perishable_alerts } = req.body;
  const sub = dbModule.upsertNotificationSubscription(req.user.id, {
    morning_digest: morning_digest !== undefined ? (morning_digest ? 1 : 0) : undefined,
    perishable_alerts: perishable_alerts !== undefined ? (perishable_alerts ? 1 : 0) : undefined,
  });
  res.json(sub);
});

// Register a push notification token (from expo-notifications)
app.post('/api/notifications/register', (req, res) => {
  const { token, deviceName } = req.body;
  if (!token) return res.status(400).json({ error: 'token is required' });
  const saved = dbModule.registerPushToken(req.user.id, token, deviceName);
  res.json(saved);
});

// Unregister a push token (e.g. on logout)
app.post('/api/notifications/unregister', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token is required' });
  dbModule.removePushToken(token);
  res.json({ ok: true });
});

// Test notification — sends a test push to this user's devices
app.post('/api/notifications/test', async (req, res) => {
  const tokens = dbModule.getUserPushTokens(req.user.id);
  if (tokens.length === 0) {
    return res.status(400).json({ error: 'No push tokens registered. Open the app and grant notification permission first.' });
  }
  const result = await sendPush(tokens, '🧪 Chef Terry Test', 'Notifications are working! 🎉');
  if (result.sent > 0) {
    res.json({ ok: true, message: `Test sent to ${result.sent} device(s)!` });
  } else {
    res.status(502).json({ error: 'Failed to send notification. Check Expo push service status.' });
  }
});

// --- Meal Plan Sync ---

app.get('/api/meal-plan', (req, res) => {
  const plan = dbModule.getMealPlan(req.user.id);
  res.json(plan);
});

app.post('/api/meal-plan/sync', (req, res) => {
  const { plan } = req.body;
  if (!plan || typeof plan !== 'object') {
    return res.status(400).json({ error: 'plan object is required' });
  }
  const synced = dbModule.syncMealPlan(req.user.id, plan);
  res.json(synced);
});

// --- Scanned Items ---

app.get('/api/scanned-items', (req, res) => {
  const includeConsumed = req.query.all === 'true';
  const items = dbModule.getScannedItems(req.user.id, includeConsumed);
  res.json(items);
});

app.post('/api/scanned-items', (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array is required' });
  }
  const created = [];
  for (const item of items) {
    const name = typeof item === 'string' ? item : item.name || item.item_name;
    const expiresAt = item.expires_at || item.expiresAt || null;
    if (name) {
      created.push(dbModule.addScannedItem(req.user.id, name, expiresAt));
    }
  }
  res.status(201).json(created);
});

app.put('/api/scanned-items/:id/consume', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid item ID' });
  if (!dbModule.markItemConsumed(id, req.user.id)) {
    return res.status(404).json({ error: 'Item not found' });
  }
  res.json({ ok: true });
});

// --- Cook Stats (kitchen log, streaks) ---

app.get('/api/stats', (req, res) => {
  const userId = req.user?.id || 0;
  const stats = dbModule.getStats(userId);
  const streak = dbModule.getCookingStreak(userId);
  const topRecipes = dbModule.getTopRecipes(userId, 5);
  res.json({ ...stats, streak, topRecipes });
});

app.post('/api/stats/record', (req, res) => {
  const userId = req.user?.id || 0;
  const { recipeId, recipeTitle, stepCount } = req.body;
  if (!recipeId) return res.status(400).json({ error: 'recipeId required' });
  const stats = dbModule.recordCook(userId, recipeId, recipeTitle || '', stepCount || 0);
  const streak = dbModule.getCookingStreak(userId);
  res.json({ ...stats, streak });
});

app.delete('/api/stats', (req, res) => {
  const userId = req.user?.id || 0;
  dbModule.clearStats(userId);
  res.json({ ok: true });
});

// --- Dietary Profiles ---

app.get('/api/dietary-profiles', (req, res) => {
  const userId = req.user?.id || 0;
  res.json(dbModule.getDietaryProfiles(userId));
});

app.put('/api/dietary-profiles', (req, res) => {
  const userId = req.user?.id || 0;
  const { profiles } = req.body;
  if (!Array.isArray(profiles)) return res.status(400).json({ error: 'profiles array required' });
  res.json(dbModule.upsertDietaryProfiles(userId, profiles));
});

app.delete('/api/dietary-profiles', (req, res) => {
  const userId = req.user?.id || 0;
  dbModule.clearDietaryProfiles(userId);
  res.json({ ok: true });
});

// --- Cookbook Entries (kitchen log with photos) ---

const UPLOADS_DIR = path.join(process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : '/data', 'uploads', 'cookbook');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Serve uploaded images
app.use('/api/uploads/cookbook', express.static(UPLOADS_DIR));

app.get('/api/cookbook', (req, res) => {
  const userId = req.user?.id || 0;
  const entries = dbModule.getCookbookEntries(userId);
  // Map DB fields to client fields
  res.json(entries.map(e => ({
    id: e.id,
    recipeId: e.recipe_id,
    recipeTitle: e.recipe_title,
    imageUri: e.image_path ? `/api/uploads/cookbook/${e.image_path}` : null,
    date: e.date,
    notes: e.notes,
  })));
});

app.post('/api/cookbook', (req, res) => {
  const userId = req.user?.id || 0;
  const { recipeId, recipeTitle, imageBase64, date, notes } = req.body;

  let imagePath = '';
  if (imageBase64) {
    // Save image to disk
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const filepath = path.join(UPLOADS_DIR, filename);
    const buffer = Buffer.from(imageBase64, 'base64');
    fs.writeFileSync(filepath, buffer);
    imagePath = filename;
  }

  const entry = dbModule.addCookbookEntry(userId, {
    id: req.body.id,
    recipeId,
    recipeTitle,
    imagePath,
    date,
    notes,
  });

  res.status(201).json({
    id: entry.id,
    recipeId: entry.recipe_id,
    recipeTitle: entry.recipe_title,
    imageUri: entry.image_path ? `/api/uploads/cookbook/${entry.image_path}` : null,
    date: entry.date,
    notes: entry.notes,
  });
});

app.put('/api/cookbook/:id', (req, res) => {
  const userId = req.user?.id || 0;
  const { id } = req.params;
  const { recipeTitle, imageBase64, notes, date } = req.body;

  let imagePath;
  if (imageBase64) {
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const filepath = path.join(UPLOADS_DIR, filename);
    const buffer = Buffer.from(imageBase64, 'base64');
    fs.writeFileSync(filepath, buffer);
    imagePath = filename;
  }

  const updated = dbModule.updateCookbookEntry(id, userId, {
    recipeTitle,
    imagePath,
    notes,
    date,
  });
  if (!updated) return res.status(404).json({ error: 'Entry not found' });

  res.json({
    id: updated.id,
    recipeId: updated.recipe_id,
    recipeTitle: updated.recipe_title,
    imageUri: updated.image_path ? `/api/uploads/cookbook/${updated.image_path}` : null,
    date: updated.date,
    notes: updated.notes,
  });
});

app.delete('/api/cookbook/:id', (req, res) => {
  const userId = req.user?.id || 0;
  const { id } = req.params;
  const deleted = dbModule.deleteCookbookEntry(id, userId);
  if (!deleted) return res.status(404).json({ error: 'Entry not found' });
  // Clean up image file
  if (deleted.image_path) {
    const filepath = path.join(UPLOADS_DIR, deleted.image_path);
    fs.unlink(filepath, () => {});
  }
  res.json({ ok: true });
});

app.delete('/api/cookbook', (req, res) => {
  const userId = req.user?.id || 0;
  const imagePaths = dbModule.clearCookbookEntries(userId);
  // Clean up image files
  for (const p of imagePaths) {
    fs.unlink(path.join(UPLOADS_DIR, p), () => {});
  }
  res.json({ ok: true });
});

// --- Shopping List ---

app.get('/api/shopping-list', (req, res) => {
  const userId = req.user?.id || 0;
  res.json(dbModule.getShoppingList(userId));
});

app.put('/api/shopping-list', (req, res) => {
  const userId = req.user?.id || 0;
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
  res.json(dbModule.syncShoppingList(userId, items));
});

app.delete('/api/shopping-list', (req, res) => {
  const userId = req.user?.id || 0;
  dbModule.clearShoppingList(userId);
  res.json({ ok: true });
});

// --- Favorites ---

app.get('/api/favorites', (req, res) => {
  const userId = req.user?.id || 0;
  res.json(dbModule.getFavorites(userId));
});

app.put('/api/favorites', (req, res) => {
  const userId = req.user?.id || 0;
  const { favorites } = req.body;
  if (!favorites || typeof favorites !== 'object') return res.status(400).json({ error: 'favorites object required' });
  res.json(dbModule.syncFavorites(userId, favorites));
});

app.delete('/api/favorites', (req, res) => {
  const userId = req.user?.id || 0;
  dbModule.clearFavorites(userId);
  res.json({ ok: true });
});

// --- Chat History ---

app.get('/api/chat-history', (req, res) => {
  const userId = req.user?.id || 0;
  res.json(dbModule.getChatHistory(userId));
});

app.put('/api/chat-history', (req, res) => {
  const userId = req.user?.id || 0;
  const { history } = req.body;
  if (!Array.isArray(history)) return res.status(400).json({ error: 'history array required' });
  res.json(dbModule.syncChatHistory(userId, history));
});

app.delete('/api/chat-history', (req, res) => {
  const userId = req.user?.id || 0;
  dbModule.clearChatHistory(userId);
  res.json({ ok: true });
});

// --- Activity Context ---

app.get('/api/activity-context', (req, res) => {
  const userId = req.user?.id || 0;
  res.json(dbModule.getActivityContext(userId));
});

app.put('/api/activity-context', (req, res) => {
  const userId = req.user?.id || 0;
  const { context } = req.body;
  if (!context) return res.status(400).json({ error: 'context required' });
  res.json(dbModule.syncActivityContext(userId, context));
});

app.delete('/api/activity-context', (req, res) => {
  const userId = req.user?.id || 0;
  dbModule.clearActivityContext(userId);
  res.json({ ok: true });
});

// S2-10: Express error handler middleware (must be last)
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  const message = status === 500 ? 'Internal server error' : (err.message || 'Internal server error');
  res.status(status).json({ error: message });
});

const PORT = process.env.PORT || 3000;
// 0.0.0.0 so the phone can reach it over the LAN
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Recipe server listening on http://0.0.0.0:${PORT}`);
  // Start Chef Terry's notification engine
  startCron();
});
