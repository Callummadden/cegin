import { getCustomAIConfig, getDeepSeekKey, getGoogleKey } from './config';

// ── Helpers ────────────────────────────────────────────────────────────────

function extractJson(text) {
  if (!text) return null;
  // Try to parse directly, or extract from markdown code blocks
  try { return JSON.parse(text); } catch {}
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    try { return JSON.parse(match[1].trim()); } catch {}
  }
  // Try to find the first { or [ and parse from there
  const start = text.search(/[\[{]/);
  if (start >= 0) {
    try { return JSON.parse(text.slice(start)); } catch {}
  }
  // Last resort: return null instead of raw string
  return null;
}

// ── Provider Adapters ──────────────────────────────────────────────────────

async function getProviderConfig(kind /* 'text' | 'vision' */) {
  const custom = await getCustomAIConfig();
  const cfg = custom[kind];

  if (cfg && cfg.apiKey && cfg.model) {
    return cfg;
  }

  // Fallback to legacy local keys (DeepSeek for text, Google for vision)
  if (kind === 'text') {
    const key = await getDeepSeekKey();
    if (key) {
      return {
        type: 'openai-compatible',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: key,
        model: 'deepseek-chat',
      };
    }
  }

  if (kind === 'vision') {
    const key = await getGoogleKey();
    if (key) {
      return {
        type: 'gemini',
        apiKey: key,
        model: 'gemini-2.5-flash',
      };
    }
  }

  return null;
}

async function callOpenAICompatible(config, messagesOrPrompt, options = {}) {
  const { json = false, temperature = 0.7, isVision = false } = options;

  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;

  let messages;
  if (Array.isArray(messagesOrPrompt)) {
    messages = messagesOrPrompt;
  } else {
    messages = [{ role: 'user', content: messagesOrPrompt }];
  }

  const body = {
    model: config.model,
    messages,
    temperature,
  };

  if (json) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AI error (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function callGemini(config, input, options = {}) {
  const { json = false, isVision = false } = options;

  const model = config.model || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;

  let contents;

  if (isVision && input.imageBase64) {
    contents = [{
      parts: [
        { text: input.text || 'Describe the image.' },
        {
          inline_data: {
            mime_type: 'image/jpeg',
            data: input.imageBase64,
          },
        },
      ],
    }];
  } else if (Array.isArray(input)) {
    // Separate system messages from conversation messages
    const systemMsgs = input.filter(m => m.role === 'system');
    const convoMsgs = input.filter(m => m.role !== 'system');
    // Map conversation messages: assistant->model, user->user
    contents = convoMsgs.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    // Pass system content via Gemini's systemInstruction field
    if (systemMsgs.length > 0) {
      options._systemInstruction = systemMsgs.map(m => m.content).join('\n');
    }
  } else {
    contents = [{ parts: [{ text: typeof input === 'string' ? input : JSON.stringify(input) }] }];
  }

  const generationConfig = {
    temperature: options.temperature ?? 0.7,
  };
  if (json) {
    generationConfig.responseMimeType = 'application/json';
  }

  const body = { contents, generationConfig };
  if (options._systemInstruction) {
    body.systemInstruction = { parts: [{ text: options._systemInstruction }] };
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini API error (${res.status}): ${text}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return text;
}

async function callTextModel(messages, options = {}) {
  const config = await getProviderConfig('text');
  if (!config) {
    throw new Error('No AI provider configured. Go to Settings → AI to set one up.');
  }

  if (config.type === 'gemini') {
    return callGemini(config, messages, options);
  }

  // default to openai-compatible
  return callOpenAICompatible(config, messages, options);
}

async function callVisionModel(imageBase64, prompt = 'List every food item you can identify in this photo.') {
  const config = await getProviderConfig('vision');
  if (!config) {
    throw new Error('No vision provider configured. Go to Settings → AI to set one up.');
  }

  if (config.type === 'gemini') {
    return callGemini(config, { imageBase64, text: prompt }, { isVision: true });
  }

  // OpenAI-compatible vision
  const visionMessage = {
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      {
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${imageBase64}`,
        },
      },
    ],
  };

  return callOpenAICompatible(config, [visionMessage], { temperature: 0.2 });
}

// ── Legacy direct functions (kept for compatibility during transition) ─────

async function deepseekChat(messages, { json = false } = {}) {
  const apiKey = await getDeepSeekKey();
  if (!apiKey) throw new Error('API key not configured. Add it in Settings.');
  const body = {
    model: 'deepseek-chat',
    messages,
    temperature: 0.7,
  };
  if (json) body.response_format = { type: 'json_object' };

  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DeepSeek API error (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// ── Exported Functions (now use user-chosen providers when configured) ─────

export async function chat(messages, dietaryProfiles) {
  // If dietary profiles are provided, inject a system message with them
  const msgs = [...messages];
  if (dietaryProfiles?.length) {
    const profileDescs = dietaryProfiles.map((p) => {
      let desc = p.name ? `${p.name}` : 'Someone';
      if (p.needs) desc += ` — dietary needs: ${p.needs}`;
      if (p.notes) desc += ` (notes: ${p.notes})`;
      return `- ${desc}`;
    });
    const systemMsg = {
      role: 'system',
      content:
        'DIETARY PROFILES (always respect these when suggesting recipes or meals):\n' +
        profileDescs.join('\n') +
        '\nWhen suggesting recipes, check ingredients against these profiles. ' +
        'If a recipe needs modification for someone, mention it. ' +
        'Do NOT ask about dietary needs if profiles are already provided — use them.',
    };
    // Insert system message at the beginning
    msgs.unshift(systemMsg);
  }
  const content = await callTextModel(msgs);
  return { reply: content };
}

export async function generateRecipe(promptOrMessages) {
  const instruction =
    "Produce exactly ONE recipe as a JSON object with these fields: " +
    "title, description, ingredients (array of strings), steps (array of strings), " +
    "tags (array of strings), prep_minutes (integer), cook_minutes (integer), servings (integer). " +
    "Return ONLY valid JSON, no extra text.";

  let convo;
  if (Array.isArray(promptOrMessages)) {
    convo = promptOrMessages;
  } else {
    convo = [{ role: 'user', content: promptOrMessages || 'Suggest a good recipe.' }];
  }

  const content = await callTextModel(
    [
      { role: 'system', content: instruction },
      ...convo,
    ],
    { json: true, temperature: 0.8 }
  );

  return extractJson(content);
}

export async function tidyRecipe(recipe) {
  const instruction = `Clean up this recipe JSON. Fix formatting, split run-on steps, remove junk tags. Return the cleaned JSON with the same shape.`;
  const content = await callTextModel(
    [
      { role: 'system', content: instruction },
      { role: 'user', content: JSON.stringify(recipe) },
    ],
    { json: true, temperature: 0.2 }
  );
  return extractJson(content);
}

export async function importFromUrl(url) {
  const instruction = `Import a recipe from this URL or description: ${url}. Return a clean JSON recipe.`;
  const content = await callTextModel(
    [
      { role: 'system', content: 'You are a helpful recipe importer. Return only valid JSON.' },
      { role: 'user', content: instruction },
    ],
    { json: true }
  );
  return extractJson(content);
}

export async function generateMealPlan(body = {}) {
  const recipes = body.recipes || [];
  const goal = body.goal || 'balanced';

  const recipeList = recipes.length
    ? recipes.map((r) => {
        const total = (r.prep_minutes || 0) + (r.cook_minutes || 0);
        const tags = r.tags?.length ? r.tags.join(', ') : 'none';
        const ingredients = r.ingredients?.slice(0, 8)?.join(', ') || 'unknown';
        return `- [${r.id}] "${r.title}" | tags: ${tags} | main ingredients: ${ingredients} | ${total}min | serves ${r.servings || '?'}`;
      }).join('\n')
    : '';

  const dietNote = body.dietaryProfiles?.length
    ? `\nDietary restrictions: ${body.dietaryProfiles.map((d) => `${d.name}: ${d.needs}${d.notes ? ' (' + d.notes + ')' : ''}`).join('; ')}`
    : '';

  const goalPrompts = {
    balanced: 'Create a balanced, varied week. Mix cuisines, proteins, and cooking methods. Lighter meals for breakfast, heartier for dinner.',
    protein: 'Prioritise high-protein meals. Favour recipes with meat, fish, eggs, legumes, or tofu. Aim for protein at every meal.',
    loss: 'Focus on lighter, lower-calorie meals. More vegetables, lean proteins, and smaller portions. Avoid heavy/creamy/fried recipes for lunch and dinner.',
    gain: 'Calorie-dense, filling meals. Prioritise carbs, healthy fats, and protein. Bigger portions, energy-dense ingredients.',
    quick: 'Prioritise fast recipes (under 30 min). Simple prep, minimal cooking. Good for busy days.',
    variety: 'Maximise diversity. Different cuisine each day, mix up proteins and cooking styles. Avoid repeating the same recipe within 3 days.',
  };

  const content = await callTextModel(
    [
      { role: 'system', content: `You are an expert meal planner. Assign recipes to meals for a full week (Monday-Sunday).

RULES:
- Available meal slots: breakfast, lunch, snack, dinner, dessert
- You do NOT need to fill every slot. Leave snack and dessert empty unless a recipe clearly fits.
- NEVER assign desserts, cakes, or sweet baking to breakfast/lunch/dinner. Desserts only go in the dessert slot.
- NEVER assign heavy pasta, roast dinners, or steak to breakfast. Breakfast should be lighter: eggs, oats, toast, smoothies, yoghurt, light meals.
- Match recipe tags and ingredients to the right meal. "Salad" → lunch. "Steak" → dinner. "Overnight oats" → breakfast.
- For snack, only use recipes that are genuinely snack-sized or snack-type.
- Do not repeat the same recipe more than twice in a week.
- If you have very few recipes, it's OK to repeat — just spread them across different meal types.
- Each recipe id must come from the provided list. Do not invent ids.

GOAL: ${goalPrompts[goal] || goalPrompts.balanced}

Return ONLY valid JSON:
{
  "days": [
    {
      "day": "Monday",
      "meals": {
        "breakfast": { "id": 1 },
        "lunch": { "id": 2 },
        "dinner": { "id": 3 }
      }
    }
  ]
}

Omit meal slots that have no good match (e.g. skip dessert if no dessert recipe exists).` },
      { role: 'user', content: `Here are the available recipes:
${recipeList}${dietNote}` },
    ],
    { json: true }
  );
  return extractJson(content);
}

export async function generateShoppingList(recipeIds) {
  const content = await callTextModel(
    [{ role: 'user', content: JSON.stringify({ recipe_ids: recipeIds }) }],
    { json: true }
  );
  return extractJson(content);
}

export async function auditRecipe(recipe, dietaryProfiles) {
  const content = await callTextModel(
    [{ role: 'user', content: JSON.stringify({ recipe, dietaryProfiles }) }],
    { json: true }
  );
  return extractJson(content);
}

export async function fixMistake(params) {
  const content = await callTextModel(
    [{ role: 'user', content: JSON.stringify(params) }],
    { json: true, temperature: 0.4 }
  );
  return extractJson(content);
}

export async function adjustCooking(params) {
  const content = await callTextModel(
    [{ role: 'user', content: JSON.stringify(params) }],
    { json: true }
  );
  return extractJson(content);
}

export async function estimateNutrition(params) {
  const content = await callTextModel(
    [{ role: 'user', content: JSON.stringify(params) }],
    { json: true }
  );
  return extractJson(content);
}

export async function generatePrepSteps(params) {
  const content = await callTextModel(
    [{ role: 'user', content: JSON.stringify(params) }],
    { json: true }
  );
  return extractJson(content);
}

export async function scanFridge(imageBase64) {
  const prompt = `Look at this photo of a fridge or pantry. List every food item you can identify. Return JSON: { "ingredients": ["item1", "item2", ...] }. Only return valid JSON.`;
  const result = await callVisionModel(imageBase64, prompt);
  return extractJson(result);
}

export async function status() {
  const custom = await getCustomAIConfig();
  const hasCustom = !!(custom.text || custom.vision);

  if (hasCustom) {
    const textModel = custom.text?.model || 'custom';
    const visionModel = custom.vision?.model || 'custom';
    return {
      configured: true,
      model: `Text: ${textModel} | Vision: ${visionModel}`,
    };
  }

  // Legacy fallback
  const hasDeepSeek = !!(await getDeepSeekKey());
  return {
    configured: hasDeepSeek,
    model: hasDeepSeek ? 'deepseek-chat (legacy device keys)' : 'not configured',
  };
}

// --- Missing wrappers for api.js direct calls + convertUnits ---

export async function convertUnits({ ingredients, system }) {
  const lines = Array.isArray(ingredients)
    ? ingredients.map((v) => String(v).trim()).filter(Boolean)
    : String(ingredients || '')
        .split('\n')
        .map((v) => v.trim())
        .filter(Boolean);
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

  const parsed = extractJson(content);
  const result = Array.isArray(parsed?.ingredients)
      ? parsed.ingredients.map((s) => String(s).trim()).filter(Boolean)
      : [];
  return result.length ? result : lines;
}

export async function shoppingList(recipeIds) {
  return generateShoppingList(recipeIds);
}

export async function mealPlan(body = {}) {
  return generateMealPlan(body);
}
