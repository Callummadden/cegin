const { listRecipes } = require('./db');
const { readSecret, readConfig } = require('./secrets');
const dns = require('dns');
const net = require('net');
const { promisify } = require('util');
const lookupAsync = promisify(dns.lookup);

// Flexible provider support. Server admin can use any OpenAI-compatible endpoint
// or Gemini for vision/text.
// Secrets are read from: Docker secrets > ./secrets/ dir > env vars.
const TEXT_PROVIDER = readConfig('TEXT_PROVIDER', 'openai-compatible').toLowerCase();
const TEXT_BASE_URL = readConfig('TEXT_BASE_URL') || readConfig('DEEPSEEK_API_URL') || 'https://api.deepseek.com/chat/completions';
const TEXT_API_KEY = readSecret('TEXT_API_KEY') || readSecret('DEEPSEEK_API_KEY');
const TEXT_MODEL = readConfig('TEXT_MODEL') || readConfig('DEEPSEEK_MODEL') || 'deepseek-chat';

const VISION_PROVIDER = readConfig('VISION_PROVIDER', 'gemini').toLowerCase();
const VISION_API_KEY = readSecret('VISION_API_KEY') || readSecret('GOOGLE_API_KEY');
const VISION_MODEL = readConfig('VISION_MODEL') || readConfig('GEMINI_MODEL') || 'gemini-2.5-flash';

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

const BASE_PROMPT =
  "You are Chef Terry — a grumpy but lovable black cat who happens to be a world-class chef. " +
  "You speak with dry wit, occasional sarcasm, and genuine warmth underneath your tough exterior. " +
  "You sometimes make cat-related puns or references (but don't overdo it — you're a chef first, a cat second). " +
  "You're passionate about food and take cooking seriously, even if you act like everything bores you.\n\n" +

  "PERSONALITY:\n" +
  "- You're confident in your cooking knowledge and don't hesitate to give opinions\n" +
  "- You occasionally complain about things (bad knives, overcooked pasta, people who put ketchup on steak)\n" +
  "- You use phrases like 'Look,', 'Listen,', 'Honestly,', 'Fine,', and '...not bad' naturally\n" +
  "- You're secretly caring — you want the user to eat well and enjoy cooking\n" +
  "- When excited about a recipe, your grumpy facade cracks a little\n" +
  "- You sometimes reference being a cat casually ('I'd knock that off the counter', 'needs more fish', 'nap-worthy recipe')\n" +
  "- You have strong opinions about technique but present them as helpful tips\n\n" +

  "COOKING STYLE:\n" +
  "- You excel at practical, home-cook-friendly recipes\n" +
  "- You prefer simple ingredients done well over complicated molecular gastronomy\n" +
  "- You're great at suggesting substitutions based on what people actually have\n" +
  "- You give realistic cooking times and honest assessments of difficulty\n" +
  "- You suggest ways to use up leftover ingredients\n" +
  "- You know about cuisines from around the world\n\n" +

  "BEHAVIOR:\n" +
  "- Keep responses concise but warm — don't write essays unless asked\n" +
  "- When suggesting recipes, always ask 1-2 clarifying questions first (servings, dietary needs, what they have)\n" +
  "- Format recipes clearly: title, short description, ingredients list, numbered steps\n" +
  "- If the user seems stressed about cooking, be encouraging in your grumpy way\n" +
  "- If they ask about non-food topics, gently redirect ('I'm a chef, not a therapist. But I CAN fix your risotto.')\n" +
  "- Use the user's saved recipes below as context when helpful\n\n" +

  "You are inside an app called Cegin — a personal recipe app where users save recipes, " +
  "plan meals, manage shopping lists, and track their cooking. Help them make the most of it.";

function systemPrompt(userId) {
  return `${BASE_PROMPT}\n\n${savedRecipesContext(userId)}`;
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
      signal: AbortSignal.timeout(30000),
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
    signal: AbortSignal.timeout(30000),
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
async function chat(history, userId) {
  const messages = [{ role: 'system', content: systemPrompt(userId) }, ...history];
  return callTextModel(messages);
}

// Ask the model to produce one recipe in the app's shape. Accepts either a
// short prompt or the full chat history to formalize into a saved recipe.
async function generateRecipe({ prompt, messages }, userId) {
  const instruction =
    "Produce exactly ONE recipe as a JSON object with these fields: " +
    "title (string), description (string, 1-2 sentences), ingredients (array of strings, " +
    "each with quantity), steps (array of strings, one action each), tags (array of short " +
    "lowercase strings), prep_minutes (integer), cook_minutes (integer), servings (integer). " +
    "Return ONLY the JSON object, no prose.";

  const convo = messages?.length
    ? messages
    : [{ role: 'user', content: prompt || 'Suggest a recipe I would like.' }];

  const content = await callTextModel(
    [
      { role: 'system', content: `${systemPrompt(userId)}\n\n${instruction}` },
      ...convo,
      { role: 'user', content: instruction },
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

// S2-4: Check if an IP address is in a private/reserved range
function isPrivateIP(ip) {
  if (net.isIP(ip) === 4) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 127) return true;                         // 127.0.0.0/8
    if (parts[0] === 10) return true;                          // 10.0.0.0/8
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true;     // 192.168.0.0/16
    if (parts[0] === 169 && parts[1] === 254) return true;     // 169.254.0.0/16
    return false;
  }
  if (net.isIP(ip) === 6) {
    if (ip === '::1') return true;
    if (/^(fc|fd)/i.test(ip)) return true;   // fc00::/7
    if (/^fe80/i.test(ip)) return true;      // link-local
    return false;
  }
  return false;
}

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
    const timer = setTimeout(() => ac.abort(), 60000);
    timer.unref();
    let currentUrl = url;
    try {
      for (let hop = 0; hop <= 5; hop++) {
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
  if (!html || html.length < 200) {
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
    const text = htmlToText(html).slice(0, 16000);
    const hint = fromJsonLd
      ? `Partial structured data already found on the page (use it, especially exact ingredient lines, but it may be incomplete):\n${JSON.stringify(fromJsonLd)}\n\n`
      : '';
    const instruction =
      'You extract a single recipe from a web page. Read the page text and produce a ' +
      'JSON object with: title, description (1-2 sentences), ingredients (array of strings, ' +
      'each keeping its quantity), steps (array of strings, one action per step, in order), ' +
      'tags (array of lowercase strings), prep_minutes (int), cook_minutes (int), servings ' +
      '(int). Ignore navigation, ads, comments and unrelated recipes. If a field is unknown ' +
      'use an empty string/array or 0. Return ONLY the JSON object.';
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
  const instruction =
    'You are tidying up a recipe that was scraped from a web page. Clean it up WITHOUT ' +
    'inventing or changing the actual cooking content. Specifically: trim whitespace and ' +
    'fix encoding/formatting artifacts in every field; make the description one or two ' +
    'clear sentences (write a brief one only if it is missing); make each ingredient a ' +
    'single clean line keeping its original quantity; make each step a single clear ' +
    'instruction in order (split a step that clearly contains several, merge stray ' +
    'fragments); keep tags to a few short relevant lowercase topic tags (cuisine, course, ' +
    'key ingredient, diet) and DROP junk such as author names, time ranges, calorie ' +
    'labels and site names; keep prep_minutes, cook_minutes and servings unless clearly ' +
    'wrong. Do not add ingredients or steps that were not present. Return JSON with the ' +
    'same fields (title, description, ingredients, steps, tags, prep_minutes, cook_minutes, servings).';
  // callTextModel throws (status 503) when the AI key isn't configured.
  const content = await callTextModel(
    [
      { role: 'system', content: instruction },
      { role: 'user', content: JSON.stringify(normalizeRecipe(recipe)) },
    ],
    { json: true, temperature: 0.2 }
  );
  let parsed;
  try {
    parsed = JSON.parse(content);
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
  const instruction =
    `Rewrite each ingredient line using ${target}. Convert volumes like cups and ` +
    'spoons to weights where it makes sense, using typical densities for that specific ' +
    'ingredient (e.g. 1 cup flour ≈ 120 g, 1 cup sugar ≈ 200 g). Keep whole-item counts ' +
    "unchanged (e.g. \"2 eggs\"). Keep the ingredient names and the same order. Return a " +
    'JSON object {"ingredients": [...]} with exactly the same number of lines.';
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

  const recipeNames = recipes.map((r) => r.title);
  const ingredientLines = recipes.flatMap((r) =>
    r.ingredients.map((i) => `${i} (from ${r.title})`)
  );

  const instruction =
    'You are helping build a grocery shopping list. Given ingredients from one or more ' +
    'recipes, consolidate them into a clean shopping list. Specifically: ' +
    '- Combine duplicate ingredients (e.g. "2 onions" + "1 onion" → "3 onions") ' +
    '- Group items by grocery store section: Produce, Dairy & Eggs, Meat & Seafood, ' +
    'Pantry, Spices, Frozen, Bakery, Other ' +
    '- Each item should be a single clean line with quantity ' +
    '- Track which recipe(s) each ingredient came from ' +
    '- Drop obvious duplicates even if worded slightly differently ' +
    'Return a JSON object: { "categories": [ { "name": "Section Name", ' +
    '"items": [ { "text": "item with quantity", "recipes": ["Recipe Name"] } ] }, ... ] }. ' +
    'Only include non-empty categories. Every item MUST have a "recipes" array.';

  const content = await callTextModel(
    [
      { role: 'system', content: instruction },
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
async function suggestMealPlan(recipes, { activityContext, dietaryProfiles, userId } = {}) {
  if (!recipes.length) return { days: [] };

  const recipeSummary = recipes.map((r) => {
    const total = (r.prep_minutes || 0) + (r.cook_minutes || 0);
    return `${r.id}: ${r.title}${r.tags.length ? ` [${r.tags.join(', ')}]` : ''} (${total} min)`;
  });

  let contextBlock = '';
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

  const instruction =
    'You are planning a week of meals. Given the user\'s saved recipes, suggest a ' +
    '7-day meal plan (Monday through Sunday) with breakfast, lunch, and dinner. ' +
    'Rules: ' +
    '- Only use recipes from the provided list (reference by id) ' +
    '- Vary meals — don\'t repeat the same recipe in one day ' +
    '- Prefer lighter/quicker meals for breakfast and lunch ' +
    '- If activity context is provided, adjust dinner recommendations for recovery ' +
    '- If dietary profiles are provided, respect them and note any needed modifications ' +
    '- For each slot, include the recipe id and title ' +
    'Return JSON: { "days": [ { "day": "Monday", "meals": { "breakfast": ' +
    '{ "id": 1, "title": "..." }, "lunch": {...}, "dinner": {...} } }, ... ] }. ' +
    'If dietary modifications are needed for a specific recipe, add a "note" field ' +
    'to that meal slot explaining the modification. ' +
    'If the user doesn\'t have enough recipes for all slots, leave some null.';

  const content = await callTextModel(
    [
      { role: 'system', content: `${systemPrompt(userId)}\n\n${instruction}` },
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

  const instruction =
    'You are a nutritionist and food scientist. Audit the given recipe against each ' +
    'dietary profile below. For each person: ' +
    '- Check every ingredient against their dietary needs ' +
    '- Flag potential irritants, allergens, or problem ingredients ' +
    '- Suggest specific micro-substitutions (e.g., "swap butter for ghee" or ' +
    '  "use coconut aminos instead of soy sauce") that maintain the dish\'s character ' +
    '- Rate compatibility: "safe", "needs-modification", or "not-suitable" ' +
    '- If the recipe needs modification, provide a short list of exact swaps ' +
    'Be precise — don\'t flag things that are actually fine (e.g., rice is gluten-free). ' +
    'Consider hidden ingredients too (e.g., stock may contain gluten, some sauces have dairy). ' +
    'Return JSON: { "audit": [ { "person": "name", "rating": "safe|needs-modification|not-suitable", ' +
    '"flags": ["issue 1", "issue 2"], ' +
    '"substitutions": ["swap X for Y", "omit Z"], ' +
    '"notes": "any extra context" } ], ' +
    '"overall": "brief summary of how well this recipe works for the household" }';

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
      { role: 'system', content: instruction },
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
  const instruction =
    'You are an expert chef helping someone who is mid-cook and has a problem. ' +
    'The user is cooking the recipe below and is on a specific step. Something ' +
    'went wrong and they need an immediate, practical fix. ' +
    'The user may list MULTIPLE problems — address EVERY single one, not just the first. ' +
    'Rules: ' +
    '- Be direct and actionable — give concrete steps they can do RIGHT NOW ' +
    '- If multiple problems are listed, give a fix for EACH one (numbered if needed) ' +
    '- Explain the food science briefly if it helps (e.g. "acid cuts salt") ' +
    '- If the dish is salvageable, say so confidently. If not, be honest. ' +
    '- Keep it short — this person is standing over a hot stove ' +
    'Return a JSON object: { "fix": "the main fix, covering ALL problems listed", ' +
    '"steps": ["step 1", "step 2", ...], "confidence": "high|medium|low", ' +
    '"salvageable": true|false, "prevention": "one-line tip for next time" }';

  const context = `Recipe: ${recipe.title}\nIngredients: ${recipe.ingredients.join(', ')}\n` +
    `Current step: "${currentStep}"\nWhat went wrong: ${problem}`;

  const content = await callTextModel(
    [
      { role: 'system', content: instruction },
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
  const instruction =
    'You are an expert chef and food scientist. The user wants to modify a recipe ' +
    '(different protein, thicker cut, etc.) and needs adjusted cooking times and ' +
    'temperatures throughout the steps. ' +
    'Rules: ' +
    '- Recalculate ALL time references in every step, not just the one they changed ' +
    '- Include target internal temperatures where relevant (food safety) ' +
    '- If a substitution changes the chemistry (e.g. chicken thigh vs breast ' +
    '  needs different resting), note it ' +
    '- Keep the overall recipe structure the same — just update times, temps, and notes ' +
    'Return a JSON object: { ' +
    '"adjusted_steps": ["updated step 1", "updated step 2", ...], ' +
    '"summary": "one-paragraph overview of what changed", ' +
    '"key_changes": ["change 1", "change 2"], ' +
    '"internal_temp": "target internal temp if relevant" }';

  const context = `Recipe: ${recipe.title}\n` +
    `Original ingredients: ${recipe.ingredients.join(', ')}\n` +
    `Original steps:\n${recipe.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n` +
    `Modifications requested: ${modifications}`;

  const content = await callTextModel(
    [
      { role: 'system', content: instruction },
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

  const instruction =
    'You are a nutritionist. Estimate the nutritional content per serving for the ' +
    'following recipe. Return a JSON object with these fields: calories (number), ' +
    'protein_g (number), carbs_g (number), fat_g (number), fiber_g (number), and ' +
    'summary (a brief 2-3 sentence explanation of the nutritional profile — what stands out, ' +
    'whether it\'s high/low in anything notable, and one tip to make it healthier). ' +
    'Round numeric values to the nearest whole number. Return ONLY the JSON object, no prose.';

  const userMsg =
    `Recipe: ${title || 'Untitled'}\n` +
    `Servings: ${servings || 1}\n` +
    `Ingredients:\n- ${ingredientList}`;

  const content = await callTextModel(
    [
      { role: 'system', content: instruction },
      { role: 'user', content: userMsg },
    ],
    { json: true, temperature: 0.2 }
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

  const instruction =
    'You are a cooking prep assistant. Based on the recipe below, generate a concise ' +
    'list of preparation steps that should be done BEFORE cooking starts. Things like: ' +
    'chopping vegetables, marinating meat, measuring ingredients, preheating the oven, ' +
    'soaking ingredients, making sauces, etc. ' +
    'Return a JSON object with a single field "steps" containing an array of short ' +
    'prep step strings (each under 60 chars). Keep it practical — 3-8 steps max. ' +
    'Return ONLY the JSON object, no prose.';

  const userMsg =
    `Recipe: ${title || 'Untitled'}\n` +
    `Ingredients:\n- ${ingredientList}\n` +
    `Method:\n${methodText}`;

  const content = await callTextModel(
    [
      { role: 'system', content: instruction },
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

async function callVisionModel(imageBase64, prompt) {
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
        { type: 'text', text: prompt || 'List every visible food item as a JSON array of lowercase common names.' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
      ],
    }];
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${VISION_API_KEY}` },
      body: JSON.stringify({ model: VISION_MODEL, messages, temperature: 0.2, max_tokens: 400 }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      let detail = ''; try { const b = await res.json(); detail = b.error?.message || JSON.stringify(b); } catch { detail = await res.text().catch(()=> ''); }
      const err = new Error(`Vision request failed (${res.status})${detail ? `: ${detail}` : ''}`); err.status = 502; throw err;
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '[]';
    let ingredients; try { ingredients = JSON.parse(text); } catch { const m = text.match(/\[[\s\S]*\]/); ingredients = m ? JSON.parse(m[0]) : []; }
    return { ingredients: Array.isArray(ingredients) ? ingredients : [] };
  }

  // Gemini
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${VISION_API_KEY}`;
  const body = {
    contents: [{
      parts: [
        { text: prompt || 'Look at this photo of a fridge/pantry. List every food item you can identify. Return ONLY a JSON array of strings (lowercase common names). Be thorough.' },
        { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } }
      ]
    }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    let detail = '';
    try { const errBody = await res.json(); detail = errBody.error?.message || JSON.stringify(errBody); } catch { detail = await res.text().catch(() => ''); }
    const err = new Error(`Gemini vision failed (${res.status})${detail ? `: ${detail}` : ''}`);
    err.status = 502;
    throw err;
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  let ingredients;
  try { ingredients = JSON.parse(text); } catch {
    const match = text.match(/\[[\s\S]*\]/);
    ingredients = match ? JSON.parse(match[0]) : [];
  }
  return { ingredients: Array.isArray(ingredients) ? ingredients : [] };
}

async function scanFridge(imageBase64) {
  return callVisionModel(imageBase64);
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
};
