// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/cmadzz/cegin
const { listRecipes } = require('./db');
const { readSecret, readConfig } = require('./secrets');
const config = require('./config');
const {
  BASE_PROMPT,
  DIETARY_PROFILES_SUFFIX,
  RECIPE_PARSE_PROMPT,
  IMPORT_RECIPE_PROMPT,
  TIDY_RECIPE_PROMPT,
  CONVERT_UNITS_PROMPT,
  CONSOLIDATE_SHOPPING_PROMPT,
  MEAL_PLAN_PROMPT,
  DIETARY_ANALYSIS_PROMPT,
  FIX_MISTAKE_PROMPT,
  ADJUST_COOKING_PROMPT,
  NUTRITION_PROMPT,
  PREP_STEPS_PROMPT,
  SCAN_FRIDGE_PROMPT_GEMINI,
  SCAN_FRIDGE_PROMPT_OPENAI,
  SCAN_RECIPE_PROMPT,
  SUBSTITUTION_PROMPT,
} = require('./prompts');
const dns = require('dns');
const { promisify } = require('util');
const lookupAsync = promisify(dns.lookup);
const { isPrivateIP } = require('./utils');

// Robust JSON parser for AI responses — fixes common LLM quirks
function parseJsonSafe(text) {
  // First try direct parse
  try { return JSON.parse(text); } catch {}
  // Extract JSON object/array from markdown fences or surrounding text
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!m) throw new Error('No JSON found in AI response');
  let json = m[1].trim();
  // Fix trailing commas before ] or }
  json = json.replace(/,\s*([\]}])/g, '$1');
  // Fix missing commas between array elements or object properties
  // (line ending with " or ] or } or number, followed by line starting with " or { or [)
  json = json.replace(/(["\d\]}])\s*\n\s*(["{\[])/g, '$1,\n$2');
  try { return JSON.parse(json); } catch {}
  // Last resort: try to find the largest valid JSON substring
  for (let i = json.length; i > 0; i--) {
    if (json[i - 1] === '}' || json[i - 1] === ']') {
      try { return JSON.parse(json.slice(0, i)); } catch {}
    }
  }
  throw new Error('Could not parse AI response as JSON');
}

// Flexible provider support. Server admin can use any OpenAI-compatible endpoint
// or Gemini for vision/text.
// Secrets are read from: Docker secrets > ./secrets/ dir > env vars.
const TEXT_PROVIDER = readConfig('TEXT_PROVIDER', 'openai-compatible').toLowerCase();
const TEXT_BASE_URL = readConfig('TEXT_BASE_URL') || readConfig('DEEPSEEK_API_URL') || 'https://api.deepseek.com/chat/completions';
const TEXT_API_KEY = readSecret('TEXT_API_KEY') || readSecret('DEEPSEEK_API_KEY');
let TEXT_MODEL = readConfig('TEXT_MODEL') || readConfig('DEEPSEEK_MODEL') || 'deepseek-chat';

const VISION_PROVIDER = readConfig('VISION_PROVIDER', 'gemini').toLowerCase();
const VISION_API_KEY = readSecret('VISION_API_KEY') || readSecret('GOOGLE_API_KEY');
let VISION_MODEL = readConfig('VISION_MODEL') || readConfig('GEMINI_MODEL') || 'gemini-2.5-flash';

// Allow runtime model changes from the app
function setTextModel(model) { TEXT_MODEL = model; }
function setVisionModel(model) { VISION_MODEL = model; }
function getTextModel() { return TEXT_MODEL; }
function getVisionModel() { return VISION_MODEL; }

// Server-side model list cache (avoids exposing API key on every request)
const MODEL_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const modelCache = { text: null, vision: null }; // { data, expiresAt }

// Fetch available models from the configured provider's API
async function fetchAvailableModels(type = 'text') {
  // Return cached result if fresh
  const cached = modelCache[type];
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const baseUrl = type === 'vision' ? null : TEXT_BASE_URL;
  const apiKey = type === 'vision' ? VISION_API_KEY : TEXT_API_KEY;

  if (!apiKey) throw new Error('No API key configured');

  let result;
  // For OpenAI-compatible providers, hit /models
  let url;
  if (type === 'vision') {
    // Gemini: list models via Google's API (key sent server-side only)
    url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(config.AI_MODEL_FETCH_TIMEOUT) });
    if (!res.ok) throw new Error(`Gemini API returned ${res.status}`);
    const data = await res.json();
    result = (data.models || [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => ({ id: m.name.replace('models/', ''), name: m.displayName || m.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } else {
    // OpenAI-compatible: normalize URL to hit /models
    url = baseUrl.replace(/\/chat\/completions$/i, '').replace(/\/+$/, '');
    if (!url.endsWith('/models')) url = `${url}/models`;

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(config.AI_MODEL_FETCH_TIMEOUT),
    });
    if (!res.ok) throw new Error(`API returned ${res.status}`);
    const data = await res.json();
    const models = data.data || data.models || [];
    result = models
      .map((m) => ({ id: m.id || m.name || '', name: m.id || m.name || '' }))
      .filter((m) => m.id)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  // Cache for 1 hour
  modelCache[type] = { data: result, expiresAt: Date.now() + MODEL_CACHE_TTL };
  return result;
}

function isConfigured() {
  return !!TEXT_API_KEY;
}

// A compact summary of the user's saved recipes, fed to the model so it can
// suggest things in the same spirit and answer questions about them.
function savedRecipesContext(userId) {
  const recipes = listRecipes(undefined, userId);
  if (recipes.length === 0) {
    return 'The user has no saved recipes yet.';
  }
  const lines = recipes.slice(0, 60).map((r) => {
    const tags = r.tags.length ? ` [${r.tags.join(', ')}]` : '';
    const ingredients = r.ingredients.slice(0, 8).join(', ');
    return `- ${r.title}${tags}${ingredients ? ` — ${ingredients}` : ''}`;
  });
  return `The user has ${recipes.length} saved recipe(s):\n${lines.join('\n')}`;
}

// BASE_PROMPT is imported from ./prompts.js

function systemPrompt(userId, dietaryProfiles) {
  let prompt = `${BASE_PROMPT}\n\n${savedRecipesContext(userId)}`;

  if (dietaryProfiles?.length) {
    const profileDescs = dietaryProfiles.map((p) => {
      let desc = p.name ? `${p.name}` : 'Someone';
      if (p.needs) desc += ` — dietary needs: ${p.needs}`;
      if (p.notes) desc += ` (notes: ${p.notes})`;
      return `- ${desc}`;
    });
    prompt +=
      '\n\nDIETARY PROFILES (always respect these when suggesting recipes or meals):\n' +
      profileDescs.join('\n') +
      '\n' + DIETARY_PROFILES_SUFFIX;
  }

  return prompt;
}

async function callTextModel(messages, { json = false, temperature = 0.7 } = {}) {
  if (!isConfigured()) {
    const err = new Error('AI is not configured. Set TEXT_API_KEY (or DEEPSEEK_API_KEY) on the server.');
    err.status = 503;
    throw err;
  }

  if (TEXT_PROVIDER === 'gemini') {
    // Gemini text call
    const model = TEXT_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${TEXT_API_KEY}`;
    // Separate system messages from conversation; Gemini uses systemInstruction for system prompts
    const systemMessages = messages.filter(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');
    const contents = nonSystemMessages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const systemInstruction = systemMessages.length
      ? { parts: [{ text: systemMessages.map(m => m.content).join('\n\n') }] }
      : undefined;

    const requestBody = {
      contents,
      generationConfig: {
        temperature,
        ...(json ? { responseMimeType: 'application/json' } : {}),
      },
    };
    if (systemInstruction) requestBody.systemInstruction = systemInstruction;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(config.AI_REQUEST_TIMEOUT),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Gemini request failed (${res.status}): ${text}`);
      err.status = 502;
      throw err;
    }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }

  // OpenAI-compatible (default, DeepSeek, Groq, OpenAI, Ollama, etc.)
  const res = await fetch(TEXT_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TEXT_API_KEY}`,
    },
    signal: AbortSignal.timeout(config.AI_REQUEST_TIMEOUT),
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages,
      temperature,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const bodyText = await res.text();
      try {
        const body = JSON.parse(bodyText);
        detail = body.error?.message || bodyText;
      } catch {
        detail = bodyText;
      }
    } catch {
      detail = '';
    }
    const err = new Error(`Text model request failed (${res.status})${detail ? `: ${detail}` : ''}`);
    err.status = 502;
    throw err;
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// Freeform chat. `history` is the conversation so far ([{ role, content }]).
async function chat(history, userId, dietaryProfiles) {
  const messages = [{ role: 'system', content: systemPrompt(userId, dietaryProfiles) }, ...history];
  return callTextModel(messages);
}

// Ask the model to produce one recipe in the app's shape. Accepts either a
// short prompt or the full chat history to formalize into a saved recipe.
async function generateRecipe({ prompt, messages }, userId) {
  const convo = messages?.length
    ? messages
    : [{ role: 'user', content: prompt || 'Suggest a recipe I would like.' }];

  const content = await callTextModel(
    [
      { role: 'system', content: `${systemPrompt(userId)}\n\n${RECIPE_PARSE_PROMPT}` },
      ...convo,
      { role: 'user', content: RECIPE_PARSE_PROMPT },
    ],
    { json: true, temperature: 0.8 }
  );

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const err = new Error('AI returned a malformed recipe. Try again.');
    err.status = 502;
    throw err;
  }
  return normalizeRecipe(parsed);
}

// --- Import a recipe from a web page ---

// ISO 8601 duration (e.g. "PT1H30M") -> minutes
function isoDurationToMinutes(value) {
  if (typeof value !== 'string') return 0;
  const m = value.match(/PT(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) return 0;
  return (parseInt(m[1] || 0, 10) * 60) + parseInt(m[2] || 0, 10);
}

// recipeInstructions can be a string, an array of strings, HowToStep objects,
// or HowToSection objects that nest steps. Flatten it all to a list of strings.
function flattenInstructions(instructions) {
  if (!instructions) return [];
  if (typeof instructions === 'string') {
    return instructions.split('\n').map((s) => s.trim()).filter(Boolean);
  }
  if (Array.isArray(instructions)) {
    return instructions.flatMap((step) => {
      if (typeof step === 'string') return [step.trim()];
      if (step?.itemListElement) return flattenInstructions(step.itemListElement);
      if (step?.text) return [String(step.text).trim()];
      return [];
    }).filter(Boolean);
  }
  return [];
}

function firstInteger(value, fallback) {
  if (Array.isArray(value)) value = value[0];
  const m = String(value ?? '').match(/\d+/);
  return m ? parseInt(m[0], 10) : fallback;
}

function collectTags(node) {
  const out = [];
  const push = (v) => {
    if (Array.isArray(v)) v.forEach(push);
    else if (typeof v === 'string') v.split(',').forEach((t) => out.push(t.trim()));
  };
  push(node.keywords);
  push(node.recipeCategory);
  push(node.recipeCuisine);
  return out.filter(Boolean);
}

// Walk parsed JSON-LD (object, array, or @graph) for an object typed Recipe.
function findRecipeNode(data) {
  if (!data || typeof data !== 'object') return null;
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findRecipeNode(item);
      if (found) return found;
    }
    return null;
  }
  const type = data['@type'];
  const isRecipe = Array.isArray(type) ? type.includes('Recipe') : type === 'Recipe';
  if (isRecipe) return data;
  if (data['@graph']) return findRecipeNode(data['@graph']);
  return null;
}

// The first parseable schema.org Recipe node on the page (raw, not normalized).
function extractJsonLdNode(html) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    let parsed;
    try {
      parsed = JSON.parse(match[1].trim());
    } catch {
      continue;
    }
    const node = findRecipeNode(parsed);
    if (node) return node;
  }
  return null;
}

function recipeFromJsonLdNode(node) {
  return normalizeRecipe({
    title: node.name,
    description: typeof node.description === 'string' ? node.description : '',
    ingredients: node.recipeIngredient || node.ingredients,
    steps: flattenInstructions(node.recipeInstructions),
    tags: collectTags(node),
    prep_minutes: isoDurationToMinutes(node.prepTime),
    cook_minutes: isoDurationToMinutes(node.cookTime),
    servings: firstInteger(node.recipeYield, 1),
    image_url: extractJsonLdImage(node),
  });
}

// Pull the best (largest) image URL from a JSON-LD Recipe node.
// The `image` field can be a string, an array of strings/objects, or an object.
// When it's an array, entries may carry width/height — pick the biggest.
function extractJsonLdImage(node) {
  const img = node.image;
  if (!img) return '';
  if (typeof img === 'string') return img;
  if (typeof img === 'object' && !Array.isArray(img)) return img.url || img.contentUrl || '';

  if (!Array.isArray(img)) return '';

  // Collect all URLs with optional dimensions
  const candidates = [];
  for (const entry of img) {
    if (typeof entry === 'string' && entry) {
      candidates.push({ url: entry, w: 0, h: 0 });
    } else if (entry && typeof entry === 'object') {
      const url = entry.url || entry.contentUrl || '';
      if (!url) continue;
      const w = parseInt(entry.width, 10) || 0;
      const h = parseInt(entry.height, 10) || 0;
      candidates.push({ url, w, h });
    }
  }
  if (!candidates.length) return '';
  if (candidates.length === 1) return candidates[0].url;

  // Score by pixel area (biggest first); entries without dimensions get a URL-based guess
  const urlScore = (url) => {
    const u = url.toLowerCase();
    // Penalize obvious thumbnails
    if (/\b(thumb|thumbnail|icon|tiny|mini|small|sq|square)\b/.test(u)) return 100;
    // Penalize tiny dimension patterns in URLs like -150x150, _100x100, /100x100/
    const dim = u.match(/[-_/](\d{2,3})x(\d{2,3})[-_/]/);
    if (dim) return parseInt(dim[1], 10) * parseInt(dim[2], 10);
    return 0; // no hint — unknown
  };
  candidates.sort((a, b) => {
    const areaA = a.w * a.h || urlScore(a.url);
    const areaB = b.w * b.h || urlScore(b.url);
    // Prefer entries with explicit dimensions over URL guesses
    if (a.w * a.h && !(b.w * b.h)) return -1;
    if (!(a.w * a.h) && b.w * b.h) return 1;
    return areaB - areaA;
  });
  return candidates[0].url;
}

// Fallback: pull the largest og:image from HTML <meta> tags.
// Sites can list multiple og:image sets with different sizes:
//   <meta property="og:image" content="https://...small.jpg">
//   <meta property="og:image:width" content="300">
//   <meta property="og:image:height" content="200">
//   <meta property="og:image" content="https://...large.jpg">
//   <meta property="og:image:width" content="1200">
//   <meta property="og:image:height" content="800">
// We collect all og:image URLs with their dimensions and return the biggest.
function extractOgImage(html) {
  const re = /<meta[^>]+(?:property|name)=["']og:image(?::(width|height))?["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
  const reRev = /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image(?::(width|height))?["'][^>]*>/gi;

  // Collect in order: image, width, height repeat
  const raw = [];
  let m;
  while ((m = re.exec(html)) !== null) raw.push({ kind: m[1] || 'image', value: m[2].trim() });
  while ((m = reRev.exec(html)) !== null) raw.push({ kind: m[2] || 'image', value: m[1].trim() });

  // Group into sets: each "image" starts a new set, width/height attach to the current one
  const sets = [];
  for (const { kind, value } of raw) {
    if (kind === 'image') {
      sets.push({ url: value, w: 0, h: 0 });
    } else if (kind === 'width' && sets.length) {
      sets[sets.length - 1].w = parseInt(value, 10) || 0;
    } else if (kind === 'height' && sets.length) {
      sets[sets.length - 1].h = parseInt(value, 10) || 0;
    }
  }

  if (!sets.length) {
    // Final fallback: twitter:image (usually just one, no size metadata)
    const tw = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
    return tw ? tw[1].trim() : '';
  }

  if (sets.length === 1) return sets[0].url;

  // Pick the biggest by pixel area
  sets.sort((a, b) => (b.w * b.h) - (a.w * a.h));
  return sets[0].url;
}

function safeCodePoint(cp) {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&deg;/g, '°')
    .replace(/&frac12;/g, '½')
    .replace(/&frac14;/g, '¼')
    .replace(/&frac34;/g, '¾')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)));
}

// Strip a page to readable text but KEEP block/list structure as newlines, so the
// model can still see "Ingredients" headings and bulleted lists.
function htmlToText(html) {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|h[1-6]|ul|ol|li|tr|table)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

// Prefer exact JSON-LD fields; let the AI fill whatever the page didn't expose.
function mergeRecipe(jsonLd, aiResult) {
  if (!jsonLd) return aiResult;
  if (!aiResult) return jsonLd;
  const pick = (a, b) => (a && a.length ? a : b);
  return {
    title: jsonLd.title && jsonLd.title !== 'Untitled recipe' ? jsonLd.title : aiResult.title,
    description: jsonLd.description || aiResult.description,
    ingredients: pick(jsonLd.ingredients, aiResult.ingredients),
    steps: pick(jsonLd.steps, aiResult.steps),
    tags: pick(jsonLd.tags, aiResult.tags),
    prep_minutes: jsonLd.prep_minutes || aiResult.prep_minutes,
    cook_minutes: jsonLd.cook_minutes || aiResult.cook_minutes,
    servings: jsonLd.servings && jsonLd.servings !== 1 ? jsonLd.servings : aiResult.servings,
    image_url: jsonLd.image_url || aiResult.image_url || '',
  };
}

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};


async function importFromUrl(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    const err = new Error('That does not look like a valid URL.');
    err.status = 400;
    throw err;
  }
  if (!/^https?:$/.test(parsedUrl.protocol)) {
    const err = new Error('Only http(s) URLs are supported.');
    err.status = 400;
    throw err;
  }

  // S2-4: SSRF protection — resolve hostname and reject private/reserved IPs
  try {
    const { address } = await lookupAsync(parsedUrl.hostname);
    if (isPrivateIP(address)) {
      const err = new Error('Fetching from private/local addresses is not allowed.');
      err.status = 400;
      throw err;
    }
  } catch (e) {
    if (e.status) throw e;
    const err = new Error(`Could not resolve hostname: ${e.message}`);
    err.status = 400;
    throw err;
  }

  // Fetch the page. Some sites soft-block bots with a 4xx status but still send
  // the full recipe in the body, so we keep the body and only treat a fetch as
  // failed when there's effectively nothing to read.
  let html = '';
  let status = 0;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), config.AI_IMPORT_TIMEOUT);
    timer.unref();
    let currentUrl = url;
    try {
      for (let hop = 0; hop <= config.AI_IMPORT_MAX_REDIRECTS; hop++) {
        const res = await fetch(currentUrl, { headers: BROWSER_HEADERS, redirect: 'manual', signal: ac.signal });
        const loc = res.headers.get('location');
        if (loc && [301, 302, 303, 307, 308].includes(res.status)) {
          const nextUrl = new URL(loc, currentUrl);
          if (!/^https?:$/.test(nextUrl.protocol)) {
            const err = new Error('Only http(s) URLs are supported.'); err.status = 400; throw err;
          }
          try {
            const { address } = await lookupAsync(nextUrl.hostname);
            if (isPrivateIP(address)) { const err = new Error('Redirect to private/local address is not allowed.'); err.status = 400; throw err; }
          } catch (e) { if (e.status) throw e; const err = new Error(`Could not resolve redirect hostname: ${e.message}`); err.status = 400; throw err; }
          currentUrl = nextUrl.href;
          continue;
        }
        status = res.status;
        html = await res.text();
        break;
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    if (e.status) throw e;
    const err = new Error(`Could not reach that page: ${e.message}`);
    err.status = 502;
    throw err;
  }
  if (!html || html.length < config.AI_IMPORT_MIN_HTML_LENGTH) {
    const err = new Error(`Could not fetch the page (HTTP ${status}).`);
    err.status = 502;
    throw err;
  }

  // Structured recipe metadata embedded in the page. Free and exact when complete.
  const node = extractJsonLdNode(html);
  const fromJsonLd = node ? recipeFromJsonLdNode(node) : null;
  // og:image / twitter:image as a fallback for the photo (works even without JSON-LD).
  const ogImage = extractOgImage(html);
  const isComplete =
    fromJsonLd && fromJsonLd.title && fromJsonLd.ingredients.length && fromJsonLd.steps.length;
  if (isComplete) {
    if (!fromJsonLd.image_url && ogImage) fromJsonLd.image_url = ogImage;
    return fromJsonLd;
  }

  // Otherwise lean on the model: give it the page text (structure preserved) plus
  // any partial JSON-LD as a hint, and merge the result over the JSON-LD.
  let aiResult = null;
  if (isConfigured()) {
    const text = htmlToText(html).slice(0, config.AI_IMPORT_TEXT_LIMIT);
    const hint = fromJsonLd
      ? `Partial structured data already found on the page (use it, especially exact ingredient lines, but it may be incomplete):\n${JSON.stringify(fromJsonLd)}\n\n`
      : '';
    const instruction = IMPORT_RECIPE_PROMPT;
    try {
      const content = await callTextModel(
        [
          { role: 'system', content: instruction },
          { role: 'user', content: `${hint}URL: ${url}\n\nPAGE TEXT:\n${text}` },
        ],
        { json: true, temperature: 0.2 }
      );
      aiResult = normalizeRecipe(JSON.parse(content));
    } catch {
      aiResult = null;
    }
  }

  const merged = mergeRecipe(fromJsonLd, aiResult);
  if (!merged || (!merged.ingredients.length && !merged.steps.length)) {
    const blocked = status >= 400;
    const err = new Error(
      blocked
        ? `That site blocked the import (HTTP ${status}). Sites with strong bot protection can't be read this way — try another source or paste the recipe in manually.`
        : 'Could not find a recipe on that page.'
    );
    err.status = blocked ? 502 : 422;
    throw err;
  }
  // Final fallback: if neither JSON-LD nor the AI found an image, use og:image.
  if (!merged.image_url && ogImage) merged.image_url = ogImage;
  return merged;
}

// A clean-up pass over recipe data: fixes formatting artifacts and drops junk tags
// WITHOUT inventing or changing the actual cooking content. Triggered manually from
// the app (the "Clean up with AI" button), not automatically on import.
async function tidyRecipe(recipe) {
  // callTextModel throws (status 503) when the AI key isn't configured.
  const content = await callTextModel(
    [
      { role: 'system', content: TIDY_RECIPE_PROMPT },
      { role: 'user', content: JSON.stringify(normalizeRecipe(recipe)) },
    ],
    { json: true, temperature: 0.2 }
  );
  let parsed;
  try {
    parsed = parseJsonSafe(content);
  } catch {
    const err = new Error('The clean-up returned malformed data. Try again.');
    err.status = 502;
    throw err;
  }
  const tidied = normalizeRecipe(parsed);
  // Safety: never let the clean-up wipe the recipe out.
  return tidied.ingredients.length || tidied.steps.length ? tidied : normalizeRecipe(recipe);
}

// --- Convert ingredient measurements between unit systems ---

async function convertUnits(ingredients, system) {
  const lines = toStringArray(ingredients);
  if (!lines.length) return [];
  const target =
    system === 'us'
      ? 'US customary units (cups, fluid ounces, ounces, pounds; temperatures in °F)'
      : 'metric units (grams, milliliters, and °C)';
  const instruction = CONVERT_UNITS_PROMPT.replace('{target}', target);
  const content = await callTextModel(
    [
      { role: 'system', content: instruction },
      { role: 'user', content: JSON.stringify({ ingredients: lines }) },
    ],
    { json: true, temperature: 0.2 }
  );
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const err = new Error('Could not convert the units. Try again.');
    err.status = 502;
    throw err;
  }
  const result = toStringArray(parsed.ingredients);
  return result.length ? result : lines;
}

function toStringArray(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value.split('\n').map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

function toInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function normalizeRecipe(r) {
  return {
    title: String(r.title || '').trim() || 'Untitled recipe',
    description: String(r.description || '').trim(),
    ingredients: toStringArray(r.ingredients),
    steps: toStringArray(r.steps),
    tags: toStringArray(r.tags).map((t) => t.toLowerCase()),
    prep_minutes: toInt(r.prep_minutes, 0),
    cook_minutes: toInt(r.cook_minutes, 0),
    servings: toInt(r.servings, 1) || 1,
    image_url: String(r.image_url || '').trim(),
    notes: String(r.notes || '').trim(),
  };
}

// --- Smart Shopping List ---

// Takes an array of recipe objects, consolidates their ingredients using AI,
// removes duplicates, and groups by grocery store section.
async function consolidateShoppingList(recipes) {
  if (!recipes.length) return { categories: [] };

  const ingredientLines = recipes.flatMap((r) =>
    r.ingredients.map((i) => `${i} (from ${r.title})`)
  );

  const content = await callTextModel(
    [
      { role: 'system', content: CONSOLIDATE_SHOPPING_PROMPT },
      { role: 'user', content: `Recipes:\n${recipes.map((r) => `\n### ${r.title}\n${r.ingredients.join('\n')}`).join('\n')}` },
    ],
    { json: true, temperature: 0.2 }
  );

  try {
    return JSON.parse(content);
  } catch {
    return { categories: [{ name: 'All Items', items: ingredientLines.map((t) => ({ text: t, recipes: [] })) }] };
  }
}

// --- AI Meal Planner ---

// Suggests a 7-day meal plan (breakfast, lunch, dinner) using the user's saved recipes.
// Optionally accepts biometric/activity context to skew recommendations.
async function suggestMealPlan(recipes, { activityContext, dietaryProfiles, goal, userId } = {}) {
  if (!recipes.length) return { days: [] };

  const recipeSummary = recipes.map((r) => {
    const total = (r.prep_minutes || 0) + (r.cook_minutes || 0);
    return `${r.id}: ${r.title}${r.tags.length ? ` [${r.tags.join(', ')}]` : ''} (${total} min)`;
  });

  let contextBlock = '';
  if (goal) {
    contextBlock += '\n\nUSER GOAL: ' + goal + '\nOptimize the meal plan toward this goal (e.g., high-protein, balanced, low-carb, weight loss).';
  }
  if (activityContext) {
    contextBlock +=
      '\n\nUSER ACTIVITY CONTEXT:\n' +
      'The user\'s recent physical activity data is below. Use this to adjust meal ' +
      'recommendations — e.g., after high-exertion days, skew toward higher-protein ' +
      'and higher-carb recovery meals; on rest days, prefer lighter options.\n' +
      JSON.stringify(activityContext, null, 2);
  }
  if (dietaryProfiles?.length) {
    contextBlock +=
      '\n\nDIETARY PROFILES TO RESPECT:\n' +
      'These are household members with specific dietary needs. When planning meals, ' +
      'try to pick recipes that work for everyone, or note when a recipe may need ' +
      'modification for a specific person.\n' +
      dietaryProfiles.map((p) =>
        `- ${p.name}: ${p.needs}${p.notes ? ` (${p.notes})` : ''}`
      ).join('\n');
  }

  const content = await callTextModel(
    [
      { role: 'system', content: `${systemPrompt(userId)}\n\n${MEAL_PLAN_PROMPT}` },
      { role: 'user', content: `Available recipes:\n${recipeSummary.join('\n')}${contextBlock}` },
    ],
    { json: true, temperature: 0.7 }
  );

  try {
    return JSON.parse(content);
  } catch {
    return { days: [] };
  }
}

// --- Recipe Audit (Dietary Alignment) ---

// Audits a recipe against one or more dietary profiles. Flags potential issues
// and suggests micro-substitutions to make it fit.
async function auditRecipe(recipe, dietaryProfiles) {
  if (!dietaryProfiles?.length) {
    return { audit: [], overall: 'No dietary profiles provided.' };
  }

  const profileText = dietaryProfiles.map((p) =>
    `--- ${p.name} ---\nDietary needs: ${p.needs}${p.notes ? `\nAdditional notes: ${p.notes}` : ''}`
  ).join('\n\n');

  const context = `Recipe: ${recipe.title}\n` +
    `Ingredients: ${recipe.ingredients.join(', ')}\n` +
    `Steps: ${recipe.steps.join(' | ')}\n` +
    `Tags: ${recipe.tags.join(', ')}\n\n` +
    `DIETARY PROFILES:\n${profileText}`;

  const content = await callTextModel(
    [
      { role: 'system', content: DIETARY_ANALYSIS_PROMPT },
      { role: 'user', content: context },
    ],
    { json: true, temperature: 0.3 }
  );

  try {
    return JSON.parse(content);
  } catch {
    return {
      audit: dietaryProfiles.map((p) => ({
        person: p.name,
        rating: 'unknown',
        flags: [],
        substitutions: [],
        notes: 'Could not analyze. Try again.',
      })),
      overall: 'Analysis failed. Please retry.',
    };
  }
}

// --- "I Messed Up" Panic Fix ---

// Given the recipe context, the current step, and what went wrong, give a
// concrete culinary/chemical fix the cook can do right now.
async function fixMistake(recipe, currentStep, problem) {
  const context = `Recipe: ${recipe.title}\nIngredients: ${recipe.ingredients.join(', ')}\n` +
    `Current step: "${currentStep}"\nWhat went wrong: ${problem}`;

  const content = await callTextModel(
    [
      { role: 'system', content: FIX_MISTAKE_PROMPT },
      { role: 'user', content: context },
    ],
    { json: true, temperature: 0.4 }
  );

  try {
    return JSON.parse(content);
  } catch {
    return {
      fix: 'Could not parse AI response. Try describing the problem differently.',
      steps: [],
      confidence: 'low',
      salvageable: true,
      prevention: '',
    };
  }
}

// --- Intelligent Cook-Time Adjustment ---

// Recalculates cooking times and temps when the user changes the protein,
// cut thickness, or other variables.
async function adjustCooking(recipe, modifications) {
  const context = `Recipe: ${recipe.title}\n` +
    `Original ingredients: ${recipe.ingredients.join(', ')}\n` +
    `Original steps:\n${recipe.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n` +
    `Modifications requested: ${modifications}`;

  const content = await callTextModel(
    [
      { role: 'system', content: ADJUST_COOKING_PROMPT },
      { role: 'user', content: context },
    ],
    { json: true, temperature: 0.4 }
  );

  try {
    return JSON.parse(content);
  } catch {
    return {
      adjusted_steps: recipe.steps,
      summary: 'Could not parse AI response. Try again.',
      key_changes: [],
      internal_temp: '',
    };
  }
}

async function estimateNutrition(recipe) {
  const { title, ingredients, servings } = recipe;
  const ingredientList = Array.isArray(ingredients) ? ingredients.join('\n- ') : String(ingredients);

  const userMsg =
    `Recipe: ${title || 'Untitled'}\n` +
    `Servings: ${servings || 1}\n` +
    `Ingredients:\n- ${ingredientList}`;

  const content = await callTextModel(
    [
      { role: 'system', content: NUTRITION_PROMPT },
      { role: 'user', content: userMsg },
    ],
    { json: true, temperature: 0 }
  );

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const err = new Error('AI returned malformed nutrition data. Try again.');
    err.status = 502;
    throw err;
  }
  return {
    calories: Number(parsed.calories) || 0,
    protein_g: Number(parsed.protein_g) || 0,
    carbs_g: Number(parsed.carbs_g) || 0,
    fat_g: Number(parsed.fat_g) || 0,
    fiber_g: Number(parsed.fiber_g) || 0,
    summary: parsed.summary || '',
  };
}

async function generatePrepSteps(recipe) {
  const { title, ingredients, steps } = recipe;
  const ingredientList = Array.isArray(ingredients) ? ingredients.join('\n- ') : String(ingredients);
  const methodText = Array.isArray(steps) ? steps.join('\n') : String(steps);

  const userMsg =
    `Recipe: ${title || 'Untitled'}\n` +
    `Ingredients:\n- ${ingredientList}\n` +
    `Method:\n${methodText}`;

  const content = await callTextModel(
    [
      { role: 'system', content: PREP_STEPS_PROMPT },
      { role: 'user', content: userMsg },
    ],
    { json: true, temperature: 0.3 }
  );

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { steps: [] };
  }
  return { steps: Array.isArray(parsed.steps) ? parsed.steps : [] };
}

// ─── Fridge scan (flexible Vision) ─────────────────────────────────────────

async function callVisionModel(imageBase64, prompt, { timeout = config.AI_REQUEST_TIMEOUT, maxTokens = 400 } = {}) {
  if (!VISION_API_KEY) {
    const err = new Error('No vision API key configured. Set VISION_API_KEY (or GOOGLE_API_KEY).');
    err.status = 503;
    throw err;
  }

  if (VISION_PROVIDER === 'openai-compatible' || VISION_PROVIDER === 'openai') {
    const base = (readConfig('VISION_BASE_URL') || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const url = `${base}/chat/completions`;
    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: prompt || SCAN_FRIDGE_PROMPT_OPENAI },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
      ],
    }];
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${VISION_API_KEY}` },
      body: JSON.stringify({ model: VISION_MODEL, messages, temperature: 0.2, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) {
      let detail = ''; try { const b = await res.json(); detail = b.error?.message || JSON.stringify(b); } catch { detail = await res.text().catch(()=> ''); }
      const err = new Error(`Vision request failed (${res.status})${detail ? `: ${detail}` : ''}`); err.status = 502; throw err;
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '[]';
    let ingredients; try { ingredients = JSON.parse(text); } catch { const m = text.match(/\[[\s\S]*\]/); ingredients = m ? JSON.parse(m[0]) : []; }
    // Return as JSON string so callers can uniformly JSON.parse
    return JSON.stringify(Array.isArray(ingredients) ? ingredients : []);
  }

  // Gemini
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${VISION_API_KEY}`;
  const body = {
    contents: [{
      parts: [
        { text: prompt || SCAN_FRIDGE_PROMPT_GEMINI },
        { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } }
      ]
    }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) {
    let detail = '';
    try { const errBody = await res.json(); detail = errBody.error?.message || JSON.stringify(errBody); } catch { detail = await res.text().catch(() => ''); }
    const err = new Error(`Gemini vision failed (${res.status})${detail ? `: ${detail}` : ''}`);
    err.status = 502;
    throw err;
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return text;
}

async function scanFridge(imageBase64) {
  const text = await callVisionModel(imageBase64);
  let ingredients;
  try { ingredients = JSON.parse(text); } catch {
    const match = text.match(/\[[\s\S]*\]/);
    ingredients = match ? JSON.parse(match[0]) : [];
  }
  return { ingredients: Array.isArray(ingredients) ? ingredients : [] };
}

// ─── Scan recipe image with vision ────────────────────────────────────────

async function scanRecipeImage(imageBase64) {
  const rawText = await callVisionModel(imageBase64, SCAN_RECIPE_PROMPT, { timeout: config.AI_SCAN_RECIPE_TIMEOUT, maxTokens: 2500 });

  let parsed;
  try {
    parsed = parseJsonSafe(rawText);
  } catch {
    parsed = {};
  }
  return normalizeRecipe(parsed);
}

// Apply dietary substitutions to a recipe
async function applySubstitutions(recipe, substitutions) {
  const subList = substitutions.map((s, i) => (i + 1) + '. ' + s).join('\n');
  const context = 'Original recipe:\n' + JSON.stringify(normalizeRecipe(recipe)) + '\n\nSubstitutions to apply:\n' + subList;

  const content = await callTextModel(
    [
      { role: 'system', content: SUBSTITUTION_PROMPT },
      { role: 'user', content: context },
    ],
    { json: true, temperature: 0.3 }
  );

  let parsed;
  try {
    parsed = parseJsonSafe(content);
  } catch {
    const err = new Error('AI returned a malformed recipe. Try again.');
    err.status = 502;
    throw err;
  }
  return normalizeRecipe(parsed);
}

module.exports = {
  isConfigured,
  chat,
  generateRecipe,
  importFromUrl,
  tidyRecipe,
  convertUnits,
  consolidateShoppingList,
  suggestMealPlan,
  fixMistake,
  adjustCooking,
  auditRecipe,
  estimateNutrition,
  generatePrepSteps,
  scanFridge,
  scanRecipeImage,
  applySubstitutions,
  setTextModel,
  setVisionModel,
  getTextModel,
  getVisionModel,
  fetchAvailableModels,
};
