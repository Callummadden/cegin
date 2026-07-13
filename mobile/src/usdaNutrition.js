// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/cmadzz/cegin
import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';

const DB_NAME = 'usda-nutrition.db';
const DB_VERSION = 7; // Bump when DB changes to force re-copy
let db = null;

/**
 * Open the USDA nutrition database.
 * Copies from assets to document directory on first use.
 */
async function getDb() {
  if (db) return db;

  try {
    const dbPath = `${FileSystem.documentDirectory}SQLite/${DB_NAME}`;
    const info = await FileSystem.getInfoAsync(dbPath);

    if (info.exists) {
      // Verify the DB has tables and correct version
      try {
        const testDb = await SQLite.openDatabaseAsync(dbPath);
        const tables = await testDb.getFirstAsync("SELECT name FROM sqlite_master WHERE type='table' AND name='allergens'");
        const ver = await testDb.getFirstAsync("SELECT COUNT(*) as c FROM nutrients WHERE calories > 0");
        const metaVer = await testDb.getFirstAsync("SELECT value FROM meta WHERE key = 'db_version'").catch(() => null);
        await testDb.closeAsync();
        const storedVersion = metaVer ? parseInt(metaVer.value, 10) : 0;
        if (!tables || !ver || ver.c < 1000 || storedVersion < DB_VERSION) {
          if (__DEV__) console.log('[USDA] DB stale or empty, deleting...');
          await FileSystem.deleteAsync(dbPath);
        }
      } catch (e) { if (__DEV__) console.warn('[USDA] DB validation failed, re-copying:', e.message);
        await FileSystem.deleteAsync(dbPath);
      }
    }

    const freshInfo = await FileSystem.getInfoAsync(dbPath);
    if (!freshInfo.exists) {
      if (__DEV__) console.log('[USDA] Copying nutrition DB from assets...');
      const asset = Asset.fromModule(require('../assets/usda-nutrition.db'));
      await asset.downloadAsync();
      if (__DEV__) console.log('[USDA] Asset URI:', asset.localUri);
      await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}SQLite`, { intermediates: true });
      await FileSystem.copyAsync({ from: asset.localUri, to: dbPath });
      if (__DEV__) console.log('[USDA] Copied to:', dbPath);
    }

    db = await SQLite.openDatabaseAsync(dbPath);
    if (__DEV__) console.log('[USDA] Database opened from:', dbPath);
    return db;
  } catch (e) {
    if (__DEV__) console.error('[USDA] Failed to open database:', e.message);
    return null;
  }
}

// UK-to-US translation — USDA uses American terminology
const UK_TO_US = {
  'mince': 'ground', 'minced': 'ground',
  'coriander': 'cilantro', 'aubergine': 'eggplant', 'courgette': 'zucchini',
  'spring onion': 'scallion', 'spring onions': 'scallions', 'rocket': 'arugula',
  'plain flour': 'all-purpose flour', 'caster sugar': 'superfine sugar',
  'icing sugar': 'powdered sugar', 'cornflour': 'cornstarch',
  'bicarbonate of soda': 'baking soda', 'double cream': 'heavy cream',
  'single cream': 'light cream', 'passata': 'tomato puree',
  'prawns': 'shrimp', 'gammon': 'ham', 'swede': 'rutabaga',
  'mangetout': 'snow peas', 'sweetcorn': 'corn',
  'chickpeas': 'garbanzo beans', 'broad beans': 'fava beans',
  'stock cube': 'broth', 'mixed herbs': 'italian seasoning',
  'natural yoghurt': 'yogurt, plain', 'greek yoghurt': 'yogurt, greek',
  'lamb mince': 'ground lamb', 'beef mince': 'ground beef',
  'pork mince': 'ground pork', 'turkey mince': 'ground turkey',
  'minced beef': 'ground beef', 'minced lamb': 'ground lamb',
  'sultanas': 'raisins', 'demerara sugar': 'sugar, raw',
  'dark sugar': 'brown sugar',
  'dark brown sugar': 'brown sugar',
  'light brown sugar': 'brown sugar',
  'muscovado sugar': 'brown sugar',
  'bicarbonate of soda': 'baking soda',
  'self-raising flour': 'self-rising flour',
  'strong flour': 'bread flour',
  'wholemeal flour': 'whole wheat flour',
  'cornflour': 'cornstarch',
  'double cream': 'heavy cream',
  'single cream': 'light cream',
  'clotted cream': 'heavy cream',
  'creme fraiche': 'sour cream',
  'fromage frais': 'cream cheese',
  'natural yoghurt': 'yogurt, plain',
  'greek yoghurt': 'yogurt, greek',
  'peppers': 'bell pepper',
  'red pepper': 'bell pepper, red',
  'green pepper': 'bell pepper, green',
  'yellow pepper': 'bell pepper, yellow',
  'prawns': 'shrimp',
  'king prawns': 'shrimp',
  'gammon': 'ham',
  'streaky bacon': 'bacon',
  'back bacon': 'bacon',
  'passata': 'tomato puree',
  'tomato puree': 'tomato paste',
  'mixed herbs': 'italian seasoning',
  'garlic granules': 'garlic powder',
  'capsicum': 'bell pepper',
  'red capsicum': 'bell pepper, red',
  'green capsicum': 'bell pepper, green',
  'yellow capsicum': 'bell pepper, yellow',
  'golden syrup': 'corn syrup',
  'desiccated coconut': 'shredded coconut',
  'digestive biscuit': 'graham cracker',
  'digestive biscuits': 'graham crackers',
  'butternut squash': 'winter squash',
  'pak choi': 'chinese cabbage',
  'bok choy': 'chinese cabbage',
  'semi-skimmed milk': 'milk, reduced fat',
  'skimmed milk': 'milk, nonfat',
  'full-fat milk': 'milk, whole',
  'scotch bonnet': 'habanero',
  'birdseye chili': 'thai chili',
  'birds eye chili': 'thai chili',
  'flat leaf parsley': 'parsley',
  'flat-leaf parsley': 'parsley',
  'eschalot': 'shallot',
  'eschalots': 'shallots',
  'mincemeat': 'ground meat',
  'puy lentils': 'lentils',
  'red lentils': 'lentils',
  'green lentils': 'lentils',
  'pudding rice': 'rice',
  'basmati rice': 'rice, basmati',
  'long grain rice': 'rice, long-grain',
  'vegetable oil': 'cooking oil',
  'sunflower oil': 'cooking oil',
  'rapeseed oil': 'canola oil',
};

function translateToUS(foodName) {
  const lower = foodName.toLowerCase().trim();
  if (UK_TO_US[lower]) return UK_TO_US[lower];
  let result = lower;
  for (const [uk, us] of Object.entries(UK_TO_US)) {
    if (result.includes(uk)) result = result.replace(uk, us);
  }
  return result;
}

// Density estimates (grams per cup) for common ingredient categories
// Preferred USDA search terms — defaults to mid-range fat when generic.
// Grains default to DRY/RAW — recipes almost always list purchase weight, not cooked yield.
const PREFERRED_TERMS = {
  milk: 'milk, reduced fat, fluid, 2%',
  yogurt: 'yogurt, plain, low fat',
  'greek yogurt': 'yogurt, greek, plain, lowfat',
  cheese: 'cheese, cheddar',
  chicken: 'chicken breast, raw, boneless, skinless',
  beef: 'beef, ground, 85% lean',
  rice: 'rice, white, long-grain, regular, raw',
  'white rice': 'rice, white, long-grain, regular, raw',
  'sushi rice': 'rice, white, short-grain, raw',
  'short-grain rice': 'rice, white, short-grain, raw',
  'short grain rice': 'rice, white, short-grain, raw',
  'basmati rice': 'rice, white, long-grain, regular, raw',
  'jasmine rice': 'rice, white, long-grain, regular, raw',
  pasta: 'pasta, dry, enriched',
  spaghetti: 'pasta, dry, enriched',
  noodles: 'pasta, dry, enriched',
  'rice noodles': 'noodles, japanese, soba, dry',
  bread: 'bread, whole wheat',
  egg: 'egg, whole, raw, fresh',
  eggs: 'egg, whole, raw, fresh',
  butter: 'butter, with salt',
  oil: 'oil, olive, salad or cooking',
  'olive oil': 'oil, olive, salad or cooking',
  // Chili oil rarely has its own FDC row — map to common cooking oil (never "oil, oat")
  'chili oil': 'oil, canola',
  'chilli oil': 'oil, canola',
  'sesame oil': 'oil, sesame, salad or cooking',
  'vegetable oil': 'oil, canola',
  'canola oil': 'oil, canola',
  'rapeseed oil': 'oil, canola',
  sugar: 'sugars, granulated',
  flour: 'flour, wheat, all-purpose, enriched, unbleached',
  oats: 'cereals, oats, regular and quick, not fortified, dry',
  'rolled oats': 'cereals, oats, regular and quick, not fortified, dry',
  honey: 'honey',
  'maple syrup': 'syrup, maple',
  salt: 'salt, table',
  onion: 'onions, raw',
  onions: 'onions, raw',
  'green onion': 'onions, spring or scallions (includes tops and bulb), raw',
  'green onions': 'onions, spring or scallions (includes tops and bulb), raw',
  'spring onion': 'onions, spring or scallions (includes tops and bulb), raw',
  'spring onions': 'onions, spring or scallions (includes tops and bulb), raw',
  scallion: 'onions, spring or scallions (includes tops and bulb), raw',
  scallions: 'onions, spring or scallions (includes tops and bulb), raw',
  garlic: 'garlic, raw',
  dashi: 'soup, stock, fish, home-prepared',
  banana: 'bananas, raw',
  berries: 'blueberries, raw',
  almonds: 'nuts, almonds',
  'peanut butter': 'peanut butter, smooth style, without salt',
  'chia seeds': 'seeds, chia seeds, dried',
  'lamb': 'lamb, ground, raw, lean',
  'lamb mince': 'lamb, ground, raw, lean',
  'beef mince': 'beef, ground, 85% lean',
  'minced beef': 'beef, ground, 85% lean',
  'minced lamb': 'lamb, ground, raw, lean',
  potatoes: 'potatoes, raw, flesh and skin',
  'potato': 'potatoes, raw, flesh and skin',
  tomato: 'tomatoes, red, ripe, canned, packed in tomato juice',
  tomatoes: 'tomatoes, red, ripe, canned, packed in tomato juice',
  'chopped tomatoes': 'tomatoes, red, ripe, canned, packed in tomato juice',
  chickpeas: 'chickpeas (garbanzo beans, bengal gram), mature seeds, canned, drained solids',
  'garbanzo beans': 'chickpeas (garbanzo beans, bengal gram), mature seeds, canned, drained solids',
  peas: 'peas, green, frozen, unprepared',
  'frozen peas': 'peas, green, frozen, unprepared',
  'stock': 'soup, stock, chicken, home-prepared',
  'lamb stock': 'soup, stock, beef, home-prepared',
  'beef stock': 'soup, stock, beef, home-prepared',
  'chicken stock': 'soup, stock, chicken, home-prepared',
  'carrot': 'carrots, raw',
  carrots: 'carrots, raw',
  bacon: 'pork, cured, bacon, unprepared',
  spinach: 'spinach, raw',
};

// Last-word fallback is dangerous for these (e.g. "chocolate chips" → potato chips)
const LAST_WORD_BLOCKLIST = new Set([
  'chips', 'oil', 'powder', 'sauce', 'paste', 'mix', 'stock', 'cream', 'milk',
  'juice', 'flour', 'sugar', 'salt', 'water', 'beans', 'peas', 'leaves', 'seeds',
  'nuts', 'meat', 'fish', 'cheese', 'butter', 'bread', 'rice', 'pasta', 'soup',
  'dressing', 'seasoning', 'extract', 'syrup', 'paste', 'puree', 'broth',
]);

const GRAMS_PER_CUP = {
  // Flours & powders
  flour: 120, 'all-purpose flour': 120, 'bread flour': 120, 'whole wheat flour': 120,
  'almond flour': 96, 'coconut flour': 112, 'cornstarch': 128, cocoa: 86,
  sugar: 200, 'brown sugar': 220, 'powdered sugar': 120, honey: 340,
  oats: 90, 'rolled oats': 90, 'steel cut oats': 180, rice: 185,
  salt: 288, baking_powder: 220, baking_soda: 288,
  // Liquids (ml ≈ g for water-based)
  water: 240, milk: 245, 'almond milk': 240, 'oat milk': 240, 'coconut milk': 240,
  cream: 240, 'heavy cream': 240, yogurt: 245, 'greek yogurt': 245,
  oil: 218, 'olive oil': 218, 'vegetable oil': 218, 'coconut oil': 218,
  maple_syrup: 312, 'maple syrup': 312, vanilla: 200, vinegar: 240,
  'soy sauce': 255, broth: 240, 'chicken broth': 240,
  // Fats
  butter: 227, margarine: 227, ghee: 227,
  // Produce (approximate, varies by cut)
  onion: 160, garlic: 140, tomato: 180, 'bell pepper': 150,
  carrot: 130, celery: 100, potato: 150, spinach: 30,
  // Nuts & seeds
  almonds: 140, walnuts: 120, pecans: 110, 'peanut butter': 258,
  'chia seeds': 168, flax: 150, 'sunflower seeds': 140,
  // Dairy
  cheese: 113, 'cream cheese': 232, 'sour cream': 230, eggs: 243,
  // Misc
  chocolate: 170, 'chocolate chips': 170, breadcrumbs: 112, pasta: 140,
};

// Known unit tokens (values are only used for recognition, not conversion)
const KNOWN_UNITS = new Set([
  'cup', 'cups', 'c',
  'tbsp', 'tablespoon', 'tablespoons', 'tbs', 'tbl', 'tbls',
  'tsp', 'teaspoon', 'teaspoons',
  'oz', 'ounce', 'ounces',
  'lb', 'lbs', 'pound', 'pounds',
  'g', 'gram', 'grams',
  'kg', 'kilogram', 'kilograms',
  'ml', 'milliliter', 'millilitre', 'milliliters', 'millilitres',
  'l', 'liter', 'litre', 'liters', 'litres',
  'pint', 'pints', 'quart', 'quarts', 'gallon', 'gallons',
  'stick', 'sticks',
  'tin', 'tins', 'can', 'cans',
  'pack', 'packs', 'package', 'packages', 'packet', 'packets',
  'clove', 'cloves',
  'handful', 'handfuls',
  'slice', 'slices',
  'piece', 'pieces',
  'bunch', 'bunches',
  'sprig', 'sprigs',
  'head', 'heads',
  'knob', 'knobs',
]);

/** Normalize unit aliases so conversion logic has one path per unit family. */
function normalizeUnit(unit) {
  const u = (unit || '').toLowerCase().replace(/\.$/, '');
  const map = {
    tablespoons: 'tbsp', tablespoon: 'tbsp', tbsp: 'tbsp', tbs: 'tbsp', tbl: 'tbsp', tbls: 'tbsp',
    teaspoons: 'tsp', teaspoon: 'tsp', tsp: 'tsp',
    cups: 'cup', cup: 'cup', c: 'cup',
    grams: 'g', gram: 'g', g: 'g',
    kilograms: 'kg', kilogram: 'kg', kg: 'kg',
    milliliters: 'ml', millilitres: 'ml', milliliter: 'ml', millilitre: 'ml', ml: 'ml',
    liters: 'l', litres: 'l', liter: 'l', litre: 'l', l: 'l',
    ounces: 'oz', ounce: 'oz', oz: 'oz',
    pounds: 'lb', pound: 'lb', lbs: 'lb', lb: 'lb',
    cans: 'can', can: 'can', tins: 'tin', tin: 'tin',
    packs: 'pack', pack: 'pack', packages: 'pack', package: 'pack', packets: 'pack', packet: 'pack',
    cloves: 'clove', clove: 'clove',
    sticks: 'stick', stick: 'stick',
    handfuls: 'handful', handful: 'handful',
    slices: 'slice', slice: 'slice',
    pieces: 'piece', piece: 'piece',
    bunches: 'bunch', bunch: 'bunch',
    sprigs: 'sprig', sprig: 'sprig',
    heads: 'head', head: 'head',
    knobs: 'knob', knob: 'knob',
    pints: 'pint', pint: 'pint',
    quarts: 'quart', quart: 'quart',
    gallons: 'gallon', gallon: 'gallon',
  };
  return map[u] || u;
}

/**
 * Parse quantity, unit, and food name from an ingredient line.
 * "2 cups all-purpose flour" → { qty: 2, unit: 'cups', food: 'all-purpose flour' }
 * "1/2 tsp vanilla" → { qty: 0.5, unit: 'tsp', food: 'vanilla' }
 */
function parseIngredient(ingredient) {
  if (!ingredient || typeof ingredient !== 'string') return { qty: 0, unit: '', food: '' };

  let s = resolveIngredientAlternatives(ingredient.trim());

  // Dual quantity: "170g ¾ cup sushi rice" or "170g 3/4 cup …" — prefer mass (g/kg/oz/lb)
  const dualMassFirst = s.match(
    /^([\d.]+)\s*(g|grams?|kg|oz|ounces?|lb|lbs|pounds?)\s+([\d./½¼¾⅓⅔\s]+)\s*(cups?|tbsp|tsp|ml|l)\b\s*(.*)$/i,
  );
  if (dualMassFirst) {
    return {
      qty: parseFloat(dualMassFirst[1]),
      unit: normalizeUnit(dualMassFirst[2]),
      food: resolveIngredientAlternatives(dualMassFirst[5] || ''),
      hasExplicitQty: true,
    };
  }
  const dualCupThenMass = s.match(
    /^([\d./½¼¾⅓⅔\s]+)\s*(cups?|tbsp|tsp)\s+\(?\s*([\d.]+)\s*(g|grams?|kg|ml|l)\s*\)?\s*(.*)$/i,
  );
  if (dualCupThenMass && /^(g|grams?|kg)$/i.test(dualCupThenMass[4])) {
    return {
      qty: parseFloat(dualCupThenMass[3]),
      unit: normalizeUnit(dualCupThenMass[4]),
      food: resolveIngredientAlternatives(dualCupThenMass[5] || ''),
      hasExplicitQty: true,
    };
  }

  // Parse quantity: handles "2", "1/2", "1 1/2", "½", "¼", "¾"
  const fracMap = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 0.333, '⅔': 0.667 };
  let qty = 0;

  // Replace unicode fractions — handles "½", "1½", "1 ½"
  for (const [frac, val] of Object.entries(fracMap)) {
    const idx = s.indexOf(frac);
    if (idx !== -1) {
      if (idx > 0 && /\d/.test(s[idx - 1])) {
        qty = parseFloat(s.slice(0, idx)) + val;
      } else {
        qty = val;
      }
      s = s.slice(idx + frac.length).trim();
      break;
    }
  }

  if (qty === 0) {
    // Try parsing number (possibly with decimal or trailing fraction)
    const numMatch = s.match(/^(\d+(?:\.\d+)?)\s*/);
    if (numMatch) {
      qty = parseFloat(numMatch[1]);
      s = s.slice(numMatch[0].length);
      // Check for trailing fraction "1/2"
      const fracMatch = s.match(/^(\d+)\/(\d+)\s*/);
      if (fracMatch) {
        qty += parseInt(fracMatch[1], 10) / parseInt(fracMatch[2], 10);
        s = s.slice(fracMatch[0].length);
      }
    } else {
      // Try simple fraction like "1/2"
      const fracMatch = s.match(/^(\d+)\/(\d+)\s*/);
      if (fracMatch) {
        qty = parseInt(fracMatch[1], 10) / parseInt(fracMatch[2], 10);
        s = s.slice(fracMatch[0].length);
      }
    }
  }

  // Parse unit — allow "400g chicken" (no space) and "2 tbsp oil"
  let unit = '';
  // Attached unit after number already consumed: remaining starts with unit letters
  const attachedUnit = s.match(/^(g|kg|ml|l|oz|lb|lbs|tbsp|tsp|tbs|cups?|c)\b\s*/i);
  const spacedUnit = s.match(/^([\w]+)\s+/);
  const unitMatch = attachedUnit || spacedUnit;
  if (unitMatch) {
    const candidate = unitMatch[1].toLowerCase();
    if (KNOWN_UNITS.has(candidate)) {
      unit = normalizeUnit(candidate);
      s = s.slice(unitMatch[0].length);
    }
  }

  // Strip leading "of " ("1 can of chickpeas")
  s = s.replace(/^of\s+/i, '');

  // Clean food name — also collapse any leftover "A or B" in the name fragment
  let food = s
    .replace(/^[\s,;:–—x×-]+/, '')
    .replace(/,?\s*(sifted|diced|chopped|minced|grated|shredded|peeled|crushed|ground|melted|softened|cooked|raw|fresh|frozen|canned|dried|optional|to taste|divided|thinly\s+sliced|finely\s+chopped)\s*$/i, '')
    .replace(/^(thinly\s+sliced|finely\s+chopped|roughly\s+chopped)\s+/i, '')
    .replace(/\(.*?\)\s*$/, '')
    .replace(/[\s,;:–—-]+$/, '')
    .trim();
  food = resolveIngredientAlternatives(food);

  // Keep qty=0 when truly missing so callers can skip open-ended lines
  return { qty, unit, food, hasExplicitQty: qty > 0, cleaned: `${qty || ''}${unit ? unit + ' ' : ''}${food}`.trim() };
}

/**
 * Convert parsed ingredient to estimated grams.
 */
async function estimateGramsFromDb(qty, unit, foodName, fdcId) {
  if (!fdcId || !unit) return estimateGrams(qty, unit, foodName);

  const d = await getDb();
  if (!d) return estimateGrams(qty, unit, foodName);

  const u = normalizeUnit(unit);
  // Map to common USDA unit_name values
  const unitNames = {
    cup: ['cup', 'cups'],
    tbsp: ['tablespoon', 'tbsp', 'tablespoons'],
    tsp: ['teaspoon', 'tsp', 'teaspoons'],
    oz: ['oz', 'ounce', 'ounces'],
    g: ['g', 'gram', 'grams'],
  }[u] || [u];

  try {
    for (const name of unitNames) {
      const row = await d.getFirstAsync(
        "SELECT gram_weight FROM unit_conversions WHERE fdc_id = ? AND LOWER(unit_name) = ? LIMIT 1",
        [fdcId, name]
      );
      if (row && row.gram_weight > 0) {
        return qty * row.gram_weight;
      }
    }
  } catch (e) { /* fall through */ }

  if (foodName) {
    try {
      const foodLower = foodName.toLowerCase();
      for (const name of unitNames) {
        const customRow = await d.getFirstAsync(
          "SELECT gram_weight FROM custom_unit_conversions WHERE ? LIKE '%' || food_name || '%' AND LOWER(unit_name) = ? LIMIT 1",
          [foodLower, name]
        );
        if (customRow && customRow.gram_weight > 0) {
          return qty * customRow.gram_weight;
        }
      }
    } catch (e) { if (__DEV__) console.warn('[USDA] custom unit lookup error:', e.message); }
  }

  return estimateGrams(qty, unit, foodName);
}

function densityGramsPerCup(foodLower) {
  // Longest key match first so "olive oil" wins over "oil"
  const keys = Object.keys(GRAMS_PER_CUP).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (foodLower.includes(key.replace(/_/g, ' '))) return GRAMS_PER_CUP[key];
  }
  return null;
}

function estimateGrams(qty, unit, foodName) {
  const foodLower = (foodName || '').toLowerCase();
  const u = normalizeUnit(unit);

  // Direct weight/mass
  if (u === 'g') return qty;
  if (u === 'kg') return qty * 1000;
  if (u === 'oz') return qty * 28.35;
  if (u === 'lb') return qty * 453.6;

  // Metric liquids — adjust density for oils/syrups
  if (u === 'ml') {
    if (/\boil\b|olive oil|vegetable oil|canola|rapeseed|sunflower/.test(foodLower)) return qty * 0.91;
    if (/honey|syrup|molasses|treacle/.test(foodLower)) return qty * 1.4;
    if (/cream|butter/.test(foodLower)) return qty * 0.98;
    return qty; // water-like
  }
  if (u === 'l') return estimateGrams(qty * 1000, 'ml', foodName);

  // US volume
  if (u === 'cup') {
    const d = densityGramsPerCup(foodLower);
    return qty * (d ?? 240);
  }
  if (u === 'tbsp') {
    const d = densityGramsPerCup(foodLower);
    if (d != null) return qty * d / 16;
    if (/\boil\b/.test(foodLower)) return qty * 13.5;
    return qty * 15;
  }
  if (u === 'tsp') {
    const d = densityGramsPerCup(foodLower);
    if (d != null) return qty * d / 48;
    return qty * 5;
  }
  if (u === 'pint') return estimateGrams(qty * 473, 'ml', foodName);
  if (u === 'quart') return estimateGrams(qty * 946, 'ml', foodName);
  if (u === 'gallon') return estimateGrams(qty * 3785, 'ml', foodName);

  // Packaging / count units
  if (u === 'tin' || u === 'can') return qty * 400;
  if (u === 'pack') {
    if (/bacon/.test(foodLower)) return qty * 200;
    if (/butter/.test(foodLower)) return qty * 250;
    return qty * 250; // generic retail pack
  }
  if (u === 'stick') {
    // US butter stick ≈ 113g
    if (/butter|margarine/.test(foodLower)) return qty * 113;
    return qty * 100;
  }
  if (u === 'clove') {
    if (/garlic/.test(foodLower)) return qty * 5;
    return qty * 3;
  }
  if (u === 'handful') return qty * 30;
  if (u === 'slice') {
    if (/bread/.test(foodLower)) return qty * 30;
    if (/bacon|ham|cheese/.test(foodLower)) return qty * 20;
    return qty * 25;
  }
  if (u === 'piece') return qty * 50;
  if (u === 'bunch') return qty * 60;
  if (u === 'sprig') return qty * 2;
  if (u === 'head') {
    if (/garlic/.test(foodLower)) return qty * 40;
    if (/lettuce|cabbage/.test(foodLower)) return qty * 300;
    return qty * 200;
  }
  if (u === 'knob') return qty * 15; // ginger knob

  // Produce / count items by food name (with or without unit)
  // Garnish / alliums — small defaults when no unit (avoid "1 onion" = 150g for green onion)
  if (/\b(green onion|spring onion|scallion)/.test(foodLower)) return qty * 15;
  if (/\b(parsley|cilantro|coriander|basil|mint|dill|chives|herbs?)\b/.test(foodLower)) return qty * 5;
  if (foodLower.includes('egg')) return qty * 50;
  if (foodLower.includes('banana')) return qty * 120;
  if (foodLower.includes('apple')) return qty * 180;
  if (foodLower.includes('onion')) return qty * 150;
  if (foodLower.includes('carrot')) return qty * 60;
  if (foodLower.includes('potato')) return qty * 170;
  if (foodLower.includes('tomato')) return qty * 150;
  if (foodLower.includes('pepper') || foodLower.includes('capsicum')) return qty * 150;
  if (foodLower.includes('mushroom')) return qty * 20;
  if (foodLower.includes('zucchini') || foodLower.includes('courgette')) return qty * 200;
  if (foodLower.includes('cucumber')) return qty * 200;
  if (foodLower.includes('garlic')) return qty * 5;
  if (foodLower.includes('ginger')) return qty * 15;
  if (foodLower.includes('lemon') || foodLower.includes('lime')) return qty * 70;
  if (foodLower.includes('avocado')) return qty * 150;
  if (foodLower.includes('celery')) return qty * 40;
  if (foodLower.includes('stalk')) return qty * 40;
  // Oils/sauces with no unit — drizzle, not a bottle
  if (/\b(chili oil|chilli oil|sesame oil|olive oil|oil)\b/.test(foodLower) && !u) return Math.max(qty, 1) * 10;

  // No unit — pinch/dash vs rough count
  if (!u) {
    if (qty <= 0) return 0;
    if (qty <= 1) return 1; // pinch / "to taste"
    return qty * 100;
  }

  // Unknown unit — conservative 100g each
  return qty * 100;
}

const FOOD_CATEGORY_TAIL =
  /^(stock|broth|oil|flour|milk|cream|cheese|sugar|butter|sauce|juice|wine|vinegar|water|paste|mince|onion|pepper|extract|syrup|yoghurt|yogurt|beans|lentils|rice|pasta|dashi)$/i;

/**
 * Strip cookbook prose that breaks matching: page refs, "see recipe…", long asides.
 * Prefer concrete metric volumes when given in parentheses: (1.5 liters) → 1500ml.
 */
function stripCookbookNoise(line) {
  let s = line.trim();
  if (!s) return s;

  // Prefer explicit volume conversion in parens: "6 cups (1.5 liters) …" → "1500ml …"
  const volConv = s.match(
    /^(\d+(?:\.\d+)?)\s*cups?\s*\(\s*([\d.]+)\s*(l|liters?|litres?|ml|milliliters?|millilitres?)\s*\)\s*(.*)$/i,
  );
  if (volConv) {
    let ml = parseFloat(volConv[2]);
    const u = volConv[3].toLowerCase();
    if (u.startsWith('l') && !u.startsWith('ml')) ml *= 1000;
    s = `${Math.round(ml)}ml ${volConv[4]}`.trim();
  }

  // Drop parentheticals that are notes/pages/see-also (keep short pure unit conversions already handled)
  s = s.replace(/\([^)]*\bpage\b[^)]*\)/gi, ' ');
  s = s.replace(/\([^)]*\bsee\b[^)]*\)/gi, ' ');
  s = s.replace(/\([^)]*\bpp?\.\s*\d+[^)]*\)/gi, ' ');
  s = s.replace(/\([^)]*\bout of anything[^)]*\)/gi, ' ');
  // Remaining long parenthetical asides (>28 chars) — usually narrative
  s = s.replace(/\(([^)]{28,})\)/g, ' ');
  // "page 28" / "pp. 31" outside parens
  s = s.replace(/\bpages?\s+\d+\b/gi, ' ');
  s = s.replace(/\bpp?\.\s*\d+\b/gi, ' ');
  // "see basic stock…" style tails after food
  s = s.replace(/\bsee\b[\s\S]*$/i, ' ');
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s;
}

/**
 * Recipes often list alternatives: "chicken stock or beef stock", "butter/margarine".
 * Nutrition can only count one food — pick a single primary option (first alternative).
 */
function resolveIngredientAlternatives(line) {
  let s = stripCookbookNoise(line);
  if (!s) return line.trim();

  // Drop parenthetical alternatives: "(or beef)", "(or use water)"
  s = s.replace(/\(\s*or\b[^)]*\)/gi, '');
  s = s.replace(/\band\/or\b/gi, ' or ');

  // "X / Y" alternatives (not fractions like 1/2)
  if (s.includes('/') && !/\d+\s*\/\s*\d+/.test(s)) {
    const slashParts = s.split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean);
    if (
      slashParts.length === 2
      && slashParts[0].length < 48
      && slashParts[1].length < 48
      && !slashParts[0].includes('http')
    ) {
      s = slashParts[0];
    }
  }

  // "A or B or C" — take first option; recover shared category word (stock/oil/…)
  if (/\bor\b/i.test(s)) {
    const orParts = s.split(/\s+or\s+/i).map((p) => p.trim()).filter(Boolean);
    if (orParts.length >= 2) {
      const first = orParts[0];
      // Find a later part that carries a clean category noun (stock, oil, …)
      let category = null;
      for (let i = 1; i < orParts.length; i++) {
        // Strip leftover junk from alternative fragment for category detection
        const clean = orParts[i]
          .replace(/\(.*?\)/g, ' ')
          .replace(/\bpage\b.*$/i, '')
          .replace(/\s+/g, ' ')
          .trim();
        const words = clean.split(/\s+/).filter(Boolean);
        for (let w = words.length - 1; w >= 0; w--) {
          if (FOOD_CATEGORY_TAIL.test(words[w])) {
            category = words[w].toLowerCase();
            break;
          }
        }
        if (category) break;
      }

      if (/^[\d½¼¾⅓⅔]/.test(orParts[1])) {
        s = first; // "1 onion or 2 shallots"
      } else if (category && !first.toLowerCase().includes(category)) {
        s = `${first} ${category}`.replace(/\s+/g, ' ').trim();
      } else {
        s = first;
      }
    }
  }

  s = s.replace(/\s+or\s+(to taste|more|as needed|as required|similar)\s*$/i, '');
  s = s.replace(/,?\s*such as\b.*$/i, '');
  s = s.replace(/,?\s*e\.?g\.?\s+.*$/i, '');
  s = s.replace(/\boptional\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  s = s.replace(/[\s,;:–—-]+$/g, '').trim();

  return s || line.trim();
}

/** Section headers / non-ingredients — skip entirely for nutrition. */
function isIngredientHeader(line) {
  const s = (line || '').trim();
  if (!s) return true;
  // Ends with colon and no leading quantity → "Options for topping:", "For the sauce:"
  if (/^[A-Za-z].*:$/.test(s)) return true;
  if (/^(options?|toppings?|garnish|to serve|serving suggestions?|notes?|variations?)\b/i.test(s)) return true;
  if (/^(for the|to make the)\b/i.test(s) && !/\d/.test(s)) return true;
  // Bare labels with no amount and only 1–3 words ending in colon already handled
  return false;
}

/**
 * Pre-process ingredient lines: split compound lines and strip narrative prefixes.
 * "For the sauce: 100g butter, 150g dark sugar, 200ml double cream"
 * → ["100g butter", "150g dark sugar", "200ml double cream"]
 */
function preprocessIngredients(ingredients) {
  const result = [];
  for (const line of ingredients) {
    if (!line || typeof line !== 'string') continue;
    if (isIngredientHeader(line)) continue;
    let s = resolveIngredientAlternatives(line.trim());
    if (!s || isIngredientHeader(s)) continue;

    // Strip narrative prefixes
    s = s.replace(/^(?:for\s+(?:the\s+)?[\w\s]+[:.]?\s*)/i, '');
    s = s.replace(/^(?:toppings?|garnish|sauce|filling|dressing|marinade|glaze|icing|coating|crumble|crust|base|layer|stuffing|options?)[:.]?\s*/i, '');
    if (!s || isIngredientHeader(s)) continue;

    // "2 x 400g tins tomatoes" / "2x400g cans of chickpeas" → "800g tomatoes"
    const multiPack = s.match(/^(\d+(?:\.\d+)?)\s*[x×]\s*([\d.]+)\s*(g|kg|ml|l|oz|lb)\s*(?:tins?|cans?|packs?|packets?|jars?|bottles?)?\s*(?:of\s+)?(.+)$/i);
    if (multiPack) {
      const total = parseFloat(multiPack[1]) * parseFloat(multiPack[2]);
      const unit = multiPack[3].toLowerCase();
      const food = multiPack[4].replace(/^(?:of\s+)/i, '').trim();
      s = `${total}${unit} ${food}`;
    }

    // "2 tins of chopped tomatoes (400g each)" → use bracket weight * count
    const eachBracket = s.match(/^(\d+(?:\.\d+)?)\s*(?:tins?|cans?|packs?|jars?)\s+(?:of\s+)?(.+?)\s*\(([\d.]+)\s*(g|kg|ml|l|oz)\s*(?:each)?\)\s*$/i);
    if (eachBracket) {
      const total = parseFloat(eachBracket[1]) * parseFloat(eachBracket[3]);
      s = `${total}${eachBracket[4].toLowerCase()} ${eachBracket[2].trim()}`;
    }

    // Bracket weight extractor: "1 tin coconut milk (400ml)" -> "400ml coconut milk"
    const bracketMatch = s.match(/\(([\d.]+)\s*(ml|g|kg|oz|l|lb)\s*\)/i);
    if (bracketMatch && !multiPack && !eachBracket) {
      const bQty = bracketMatch[1];
      const bUnit = bracketMatch[2].toLowerCase();
      let food = s.replace(/\s*\([^)]+\)/, '').trim();
      food = food.replace(/^\d+(?:\.\d+)?[\s\/]*\d*\s*(?:tins?|cans?|packages?|packets?|boxes?|bags?|bottles?|jars?|sachets?|pots?|tubs?|blocks?|sticks?|slices?|pieces?|cloves?|sprigs?|bunches?|stalks?|heads?|bulbs?|knobs?|packs?)\s+(?:of\s+)?/i, '');
      s = `${bQty}${bUnit} ${food}`;
    }

    // "2 cans chopped tomatoes" / "2 tins of tomatoes" without bracket → N cans of X
    // Leave as-is for unit parser (can/tin now recognized)

    // Compound line splitter
    const hasCommaAndQuantity = /,\s*\d/.test(s);
    const hasAndQuantity = /\band\s+\d/.test(s);
    const hasCommaAndFraction = /,\s*[½¼¾⅓⅔]|\s+and\s+[½¼¾⅓⅔]/.test(s);

    let items = [];
    if (hasCommaAndQuantity || hasAndQuantity || hasCommaAndFraction) {
      const parts = s.split(/(?:,\s*(?=\d|[½¼¾⅓⅔])|\s+and\s+(?=\d|[½¼¾⅓⅔]))/);
      for (const part of parts) {
        const trimmed = part.trim().replace(/^and\s+/i, '');
        if (trimmed) items.push(trimmed);
      }
    } else {
      items.push(s);
    }

    // Prep-instruction stripper (runs AFTER compound splitter)
    for (let i = 0; i < items.length; i++) {
      items[i] = items[i].replace(/,\s*(diced|minced|chopped|grated|sliced|peeled|crushed|shredded|melted|softened|cooked|raw|fresh|frozen|canned|dried|sifted|beaten|whisked|mixed|combined|divided|trimmed|cubed|quartered|halved|torn|broken|crumbled|toasted|roasted|ground|packed|squeezed|strained|rinsed|drained)\s*$/i, '').trim();
    }

    result.push(...items);
  }
  return result;
}

/**
 * Parse an ingredient line into a searchable food name.
 */
function extractFoodName(ingredient) {
  if (!ingredient || typeof ingredient !== 'string') return '';

  let s = resolveIngredientAlternatives(ingredient).toLowerCase().trim();

  // Remove quantities
  s = s.replace(/^\d+[\s\/\\]*\d*[\s\/\\]*\d*\s*/, '');
  // Remove common units
  s = s.replace(/^(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|liters?|litres?|pints?|quarts?|gallons?|pinch(?:es)?|dash(?:es)?|cloves?|slices?|pieces?|cans?|packages?|bags?|bunches?|stalks?|sprigs?|sticks?|large|medium|small|whole)\s+/i, '');
  // Remove leading punctuation
  s = s.replace(/^[\s,;:–—-]+/, '');
  // Remove trailing prep notes
  s = s.replace(/,?\s*(sifted|diced|chopped|minced|grated|shredded|peeled|crushed|ground|melted|softened|cooked|raw|fresh|frozen|canned|dried|optional|to taste|divided)\s*$/i, '');
  s = s.replace(/\(.*?\)\s*$/, '');
  s = s.replace(/[\s,;:–—-]+$/, '');
  s = resolveIngredientAlternatives(s);

  return s.trim();
}

/**
 * Pick preferred USDA description based on food name + unit (dry vs cooked grains).
 */
function resolveSearchTerm(foodName, unit) {
  const q = foodName.toLowerCase().trim().replace(/,.*$/, '');
  const translated = translateToUS(q);
  const u = normalizeUnit(unit);
  const weightUnit = ['g', 'kg', 'oz', 'lb'].includes(u);
  const wantsCooked = /\b(cooked|boiled|steamed|ready.?to.?eat)\b/.test(q);
  const wantsDry = /\b(dry|dried|uncooked|raw)\b/.test(q) || (weightUnit && !wantsCooked);

  // Grains: recipes list dry weight by default — never map plain "rice" to noodles/black rice
  if (/\bsushi\b|\bshort[- ]?grain\b/.test(q) || /\bsushi\b|\bshort[- ]?grain\b/.test(translated)) {
    return 'rice, white, short-grain, raw';
  }
  if (/\brice noodle|rice vermicelli|pad thai noodle/.test(q)) {
    return PREFERRED_TERMS['rice noodles'] || PREFERRED_TERMS.noodles;
  }
  if (/\brice\b|basmati|jasmine|arborio/.test(translated) || /\brice\b|basmati|jasmine|arborio/.test(q)) {
    if (wantsCooked) return 'rice, white, long-grain, regular, cooked';
    if (/\bbasmati\b/.test(q)) return PREFERRED_TERMS['basmati rice'];
    if (/\bjasmine\b/.test(q)) return PREFERRED_TERMS['jasmine rice'];
    if (/\bblack rice|wild rice|brown rice\b/.test(q)) {
      // only use specialty rice when explicitly named
      return translated;
    }
    return 'rice, white, long-grain, regular, raw';
  }
  if (/\b(chili oil|chilli oil)\b/.test(q) || /\b(chili oil|chilli oil)\b/.test(translated)) {
    return 'oil, canola';
  }
  if (/\bsesame oil\b/.test(q)) return 'oil, sesame, salad or cooking';
  if (/\b(green onion|spring onion|scallion)/.test(q) || /\b(green onion|spring onion|scallion)/.test(translated)) {
    return PREFERRED_TERMS['green onion'];
  }
  if (/\bpasta\b|spaghetti|penne|fusilli|noodle|macaroni|linguine|tagliatelle/.test(translated) ||
      /\bpasta\b|spaghetti|penne|fusilli|noodle|macaroni/.test(q)) {
    if (wantsCooked) return 'pasta, cooked, enriched';
    return PREFERRED_TERMS.pasta; // dry
  }

  // Prefer exact preferred-term keys (longest first)
  const preferredKeys = Object.keys(PREFERRED_TERMS).sort((a, b) => b.length - a.length);
  for (const key of preferredKeys) {
    if (translated === key || q === key || translated.includes(key) || q.includes(key)) {
      return PREFERRED_TERMS[key];
    }
  }

  return PREFERRED_TERMS[translated] || PREFERRED_TERMS[q] || translated;
}

/**
 * Prefer FTS hits that match dry/raw when we asked for dry, etc.
 */
function pickBestHit(rows, searchTerm, queryHint = '') {
  if (!rows || rows.length === 0) return null;
  const term = (searchTerm || '').toLowerCase();
  const hint = (queryHint || term).toLowerCase();
  const wantRaw = /\braw\b|\bdry\b|unprepared|unenriched/.test(term);
  const wantCooked = /\bcooked\b/.test(term);
  const wantGrainRice = /\brice\b/.test(hint) && !/\bnoodle|vermicelli|pasta\b/.test(hint);
  const wantScallion = /\b(green onion|spring onion|scallion)/.test(hint);

  const scored = rows.map((r) => {
    const d = (r.description || '').toLowerCase();
    let score = 0;
    if (r.protein_g > 0 || r.calories > 0) score += 2;
    if (wantRaw && (/\braw\b|\bdry\b|unprepared/.test(d))) score += 5;
    if (wantRaw && /\bcooked\b|\bboiled\b/.test(d)) score -= 4;
    if (wantCooked && /\bcooked\b/.test(d)) score += 5;
    if (wantCooked && /\braw\b|\bdry\b/.test(d)) score -= 3;
    // Sushi/plain rice must not become noodles, crackers, snacks, or black/wild rice
    if (wantGrainRice) {
      if (/\bnoodle|pasta|vermicelli|soba|udon\b/.test(d)) score -= 12;
      if (/\bcracker|cake|cookie|snack|cereal|flour|bread|pudding|beverage|drink|milk\b/.test(d)) score -= 20;
      if (/\bblack|wild|brown\b/.test(d) && !/\bblack\b/.test(hint) && !/\bbrown\b/.test(hint)) score -= 10;
      if (/\brice\b/.test(d) && !/\bnoodle|cracker|cake|cookie\b/.test(d) && /\bwhite\b/.test(d)) score += 10;
      if (/\brice\b/.test(d) && !/\bnoodle|cracker|cake|cookie\b/.test(d) && /\braw\b/.test(d)) score += 8;
      if (/\brice\b/.test(d) && !/\bnoodle|cracker|cake\b/.test(d)) score += 4;
      if (/\bshort-grain|sushi\b/.test(d) || (/\bshort\b/.test(d) && /\bgrain\b/.test(d))) score += 6;
      if (/\bsushi\b/.test(hint) && /\bwhite\b/.test(d) && /\braw\b/.test(d)) score += 6;
    }
    if (wantScallion) {
      if (/\bscallion|spring|green\b/.test(d)) score += 8;
      if (/\bonions, raw\b/.test(d) && !/\bspring|scallion|green\b/.test(d)) score -= 6;
    }
    // Chili/sesame/olive oil — never "oil, oat" / random industrial oils unless asked
    if (/\boil\b/.test(hint)) {
      if (/\boat\b/.test(d) && !/\boat\b/.test(hint)) score -= 15;
      if (/\b(chili|chilli)\b/.test(hint) && /\b(vegetable|canola|corn|soybean|peanut|olive|sesame)\b/.test(d)) score += 5;
      if (/\bsesame\b/.test(hint) && /\bsesame\b/.test(d)) score += 10;
      if (/\bolive\b/.test(hint) && /\bolive\b/.test(d)) score += 10;
    }
    // Prefer shorter, more specific foundation-style names slightly
    score -= Math.min(d.length, 80) / 80;
    return { r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].r;
}

/**
 * Search for a food in the USDA database.
 * @param {string} query
 * @param {string} [unit] - helps dry vs cooked selection
 */
async function searchFood(query, unit = '') {
  const d = await getDb();
  if (!d || !query || query.length < 2) return null;

  const q = query.toLowerCase().trim().replace(/,.*$/, '');
  const translated = translateToUS(q);
  const searchTerm = resolveSearchTerm(q, unit);
  if (q !== translated && __DEV__) console.log('[USDA] UK->US:', q, '->', translated);
  if (__DEV__) console.log('[USDA] Search term:', q, '->', searchTerm, 'unit=', unit);

  const selectCols = 'f.fdc_id, f.description, n.calories, n.protein_g, n.carbs_g, n.fat_g, n.fiber_g';
  const join = 'FROM foods f JOIN nutrients n ON n.fdc_id = f.fdc_id';

  // Strategy 1: Exact description match on preferred/resolved term
  try {
    const exact = await d.getFirstAsync(
      `SELECT ${selectCols} ${join} WHERE LOWER(f.description) = ? LIMIT 1`, [searchTerm.toLowerCase()]);
    if (exact) { if (__DEV__) console.log('[USDA] Exact:', q, '->', exact.description); return exact; }
  } catch (e) { if (__DEV__) console.log('[USDA] Exact error:', e.message); }

  // Strategy 2: Description STARTS with preferred term or original query
  for (const term of [searchTerm, translated, q]) {
    if (!term || term.length < 2) continue;
    const prefix = term.split(',')[0].trim();
    try {
      const starts = await d.getAllAsync(
        `SELECT ${selectCols} ${join} WHERE LOWER(f.description) LIKE ? ORDER BY LENGTH(f.description) ASC LIMIT 8`,
        [prefix.toLowerCase() + '%']);
      const best = pickBestHit(starts, searchTerm, q);
      if (best) { if (__DEV__) console.log('[USDA] Starts:', q, '->', best.description); return best; }
    } catch (e) { if (__DEV__) console.log('[USDA] Starts error:', e.message); }
  }

  // Strategy 3: Alias match
  for (const term of [q, translated, searchTerm.split(',')[0]]) {
    if (!term || term.length < 2) continue;
    try {
      const aliasRows = await d.getAllAsync(
        `SELECT ${selectCols} ${join} WHERE LOWER(f.aliases) LIKE ? ORDER BY LENGTH(f.description) ASC LIMIT 8`,
        ['%' + term.toLowerCase() + '%']
      );
      const best = pickBestHit(aliasRows, searchTerm, q);
      if (best) { if (__DEV__) console.log('[USDA] Alias:', q, '->', best.description); return best; }
    } catch (e) { if (__DEV__) console.warn('[USDA] Alias search error:', e.message); }
  }

  // Strategy 4: FTS5
  const ftsQuery = searchTerm.replace(/,/g, ' ').replace(/[^\w\s%-]/g, ' ').replace(/\s+/g, ' ').trim();
  try {
    const ftsResults = await d.getAllAsync(
      `SELECT ${selectCols} FROM foods_fts JOIN foods f ON f.fdc_id = foods_fts.rowid JOIN nutrients n ON n.fdc_id = f.fdc_id WHERE foods_fts MATCH ? ORDER BY rank LIMIT 12`,
      [ftsQuery]);
    const best = pickBestHit(ftsResults, searchTerm, q);
    if (best) {
      if (__DEV__) console.log('[USDA] FTS:', q, '->', best.description, '(protein:', best.protein_g, ')');
      return best;
    }
  } catch (e) { if (__DEV__) console.log('[USDA] FTS error:', e.message); }

  // Strategy 5: De-pluralization (tomatoes → tomato, onions → onion)
  const singular = (translated || q).replace(/\b(\w{3,}?)(?:oes|es|s)\b/g, (_, stem) => {
    if (stem.endsWith('ss') || stem.endsWith('u')) return stem + 's'; // leave "grass", "citrus"-ish alone
    if (/\b(oes)$/.test(_)) return stem + 'o'; // tomatoes → tomato (stem tomat + o)
    return stem;
  });
  // Simpler reliable singularization for common produce plurals
  const simpleSingular = (translated || q)
    .replace(/\btomatoes\b/g, 'tomato')
    .replace(/\bonions\b/g, 'onion')
    .replace(/\beggs\b/g, 'egg')
    .replace(/\bpotatoes\b/g, 'potato')
    .replace(/\bcarrots\b/g, 'carrot')
    .replace(/\bpeppers\b/g, 'pepper')
    .replace(/\bcloves\b/g, 'clove');
  for (const term of [simpleSingular, singular]) {
    if (!term || term === (translated || q)) continue;
    try {
      const rows = await d.getAllAsync(
        `SELECT ${selectCols} ${join} WHERE LOWER(f.description) LIKE ? ORDER BY LENGTH(f.description) ASC LIMIT 8`,
        ['%' + term + '%']
      );
      const best = pickBestHit(rows, searchTerm, q);
      if (best) { if (__DEV__) console.log('[USDA] Singular:', q, '->', best.description); return best; }
    } catch (e) { if (__DEV__) console.warn('[USDA] Singular search error:', e.message); }
  }

  // Strategy 6: Last significant word — gated (blocklist + min length)
  const words = q.split(/\s+/).filter((w) => w.length >= 5 && !LAST_WORD_BLOCKLIST.has(w));
  const lastWord = words.length > 0 ? words[words.length - 1] : null;
  if (lastWord) {
    try {
      const rows = await d.getAllAsync(
        `SELECT ${selectCols} ${join} WHERE LOWER(f.description) LIKE ? ORDER BY LENGTH(f.description) ASC LIMIT 8`,
        [lastWord + '%']);
      const best = pickBestHit(rows, searchTerm, q);
      if (best) { if (__DEV__) console.log('[USDA] Last:', lastWord, '->', best.description); return best; }
    } catch (e) { if (__DEV__) console.log('[USDA] Last error:', e.message); }
  }

  if (__DEV__) console.log('[USDA] No match for:', query);
  return null;
}

/** Seasonings / to-taste lines that can be zeroed without flagging incomplete. */
function isNegligibleLine(line, foodName, qty, unit) {
  const s = `${line} ${foodName}`.toLowerCase();
  if (/\b(to taste|pinch|dash|seasoning|garnish|optional)\b/.test(s)) return true;
  if (!unit && qty <= 1 && /\b(salt|pepper|black pepper|white pepper|paprika|cumin|oregano|thyme|basil|parsley|chilli flakes|chili flakes|nutmeg|cinnamon)\b/.test(s)) {
    return true;
  }
  return false;
}

/**
 * Condiments / bowl toppings listed without an amount (e.g. "Soy sauce", "Chili oil").
 * Do NOT invent grams or AI-fill — that creates ghost calories (50g soy, 10g oil…).
 * User can drizzle and track separately; base recipe estimate stays the cooked batch.
 */
function isUnmeasuredCondimentOrTopping(foodName, hasExplicitQty, unit) {
  if (hasExplicitQty || (unit && unit.length > 0)) return false;
  const s = (foodName || '').toLowerCase().trim();
  if (!s) return false;
  return (
    /\b(soy sauce|shoyu|tamari|fish sauce|oyster sauce|chili oil|chilli oil|sesame oil|hot sauce|sriracha|vinegar|rice vinegar|mirin|sake|ketchup|mayo|mayonnaise|mustard|ponzu|miso paste|miso|furikake|nori|toasted sesame|sesame seeds|chili flakes|chilli flakes|gochujang|sambal|hot pepper|drizzle|dressing)\b/.test(s)
    || /^(oil|sauce|soy|tamari|shoyu|mirin|dashi powder)$/.test(s)
  );
}

/** Whole items often written without units: "2 onions", "1 egg" — NOT condiments */
function isCountProduce(foodName) {
  return /\b(egg|eggs|onion|onions|green onion|green onions|spring onion|scallion|scallions|garlic|banana|bananas|apple|apples|carrot|carrots|potato|potatoes|tomato|tomatoes|pepper|peppers|mushroom|mushrooms|avocado|lemon|lime|celery|courgette|zucchini|cucumber)\b/i.test(foodName || '');
}

function buildSkippedNoAmountLine(index, raw, foodName, cleaned) {
  return {
    id: makeLineId(raw, index),
    raw,
    cleaned: cleaned || foodName || raw,
    status: 'ignored',
    qty: null,
    unit: '',
    name: foodName || raw,
    fdc_id: null,
    fdc_description: 'No amount given — not counted (topping/condiment)',
    grams: 0,
    per100: emptyMacros(),
    ...emptyMacros(),
  };
}

function emptyMacros() {
  return { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
}

function scaleMacros(per100, grams) {
  const scale = (grams || 0) / 100;
  return {
    calories: (per100.calories || 0) * scale,
    protein_g: (per100.protein_g || 0) * scale,
    carbs_g: (per100.carbs_g || 0) * scale,
    fat_g: (per100.fat_g || 0) * scale,
    fiber_g: (per100.fiber_g || 0) * scale,
  };
}

function roundMacros(m) {
  return {
    calories: Math.round(m.calories || 0),
    protein_g: Math.round(m.protein_g || 0),
    carbs_g: Math.round(m.carbs_g || 0),
    fat_g: Math.round(m.fat_g || 0),
    fiber_g: Math.round(m.fiber_g || 0),
  };
}

function makeLineId(raw, index) {
  return `L${index}_${String(raw || '').slice(0, 40)}`;
}

function buildMatchedLine(index, raw, foodName, qty, unit, result, grams, cleaned) {
  const per100 = {
    calories: result.calories || 0,
    protein_g: result.protein_g || 0,
    carbs_g: result.carbs_g || 0,
    fat_g: result.fat_g || 0,
    fiber_g: result.fiber_g || 0,
  };
  const macros = scaleMacros(per100, grams);
  return {
    id: makeLineId(raw, index),
    raw,
    cleaned: cleaned || raw,
    status: 'matched', // matched | unmatched | ignored | ai | user
    qty: qty > 0 ? qty : null,
    unit: unit || '',
    name: foodName,
    fdc_id: result.fdc_id,
    fdc_description: result.description,
    grams: Math.round(grams),
    per100,
    ...roundMacros(macros),
  };
}

function buildUnmatchedLine(index, raw, foodName, qty, unit, cleaned) {
  return {
    id: makeLineId(raw, index),
    raw,
    cleaned: cleaned || foodName || raw,
    status: 'unmatched',
    qty: qty > 0 ? qty : null,
    unit: unit || '',
    name: foodName || raw,
    fdc_id: null,
    fdc_description: null,
    grams: 0,
    per100: emptyMacros(),
    ...emptyMacros(),
  };
}

/**
 * Sum linked lines and produce per-serving result.
 * Source of truth for display once lines are established.
 */
export function recomputeNutrition(lines, servings) {
  let s = Number(servings) > 0 ? Number(servings) : 0;
  const list = Array.isArray(lines) ? lines : [];

  const active = list.filter((l) => l && l.status !== 'ignored');
  const contributing = active.filter((l) => l.status === 'matched' || l.status === 'ai' || l.status === 'user');
  const unmatched = active.filter((l) => l.status === 'unmatched');

  const totals = emptyMacros();
  let totalGrams = 0;
  let massFromWeightUnits = 0;

  for (const line of contributing) {
    // Prefer stored line macros; if grams/per100 present, re-derive for consistency
    let m;
    if (line.per100 && line.grams > 0) {
      m = scaleMacros(line.per100, line.grams);
    } else {
      m = {
        calories: line.calories || 0,
        protein_g: line.protein_g || 0,
        carbs_g: line.carbs_g || 0,
        fat_g: line.fat_g || 0,
        fiber_g: line.fiber_g || 0,
      };
    }
    totals.calories += m.calories;
    totals.protein_g += m.protein_g;
    totals.carbs_g += m.carbs_g;
    totals.fat_g += m.fat_g;
    totals.fiber_g += m.fiber_g;
    totalGrams += line.grams || 0;
    if (['g', 'kg', 'ml', 'l', 'oz', 'lb'].includes(normalizeUnit(line.unit))) {
      massFromWeightUnits += line.grams || 0;
    }
  }

  // Atwater only if calories missing
  const atwater = (totals.protein_g * 4) + (totals.carbs_g * 4) + (totals.fat_g * 9);
  if (totals.calories === 0 && atwater > 0) totals.calories = atwater;

  const roundedTotals = roundMacros(totals);
  totalGrams = Math.round(totalGrams);

  const considered = contributing.length + unmatched.length;
  const matchRatio = considered > 0 ? contributing.length / considered : (contributing.length > 0 ? 1 : 0);
  const incomplete = contributing.length === 0 || unmatched.length > 0 || matchRatio < 0.85;

  const missingServings = !(s >= 1);
  if (missingServings) s = 1; // avoid /0; UI must block display as final
  if (s > 50) s = 50;

  const servingSizeG = s > 0 ? Math.round(totalGrams / s) : 0;
  const servingsSuspect =
    (Number(servings) === 1 && totalGrams > 900) ||
    (servingSizeG > 0 && (servingSizeG < 80 || servingSizeG > 1200) && totalGrams > 400);

  // Confidence 0–100
  let confidence = Math.round(matchRatio * 70);
  if (contributing.length >= 3) confidence += 5;
  if (totalGrams > 0 && massFromWeightUnits / totalGrams >= 0.6) confidence += 15;
  if (!incomplete) confidence += 10;
  if (missingServings || servingsSuspect) confidence -= 20;
  if (contributing.length === 0) confidence = 0;
  confidence = Math.max(0, Math.min(100, confidence));

  let confidenceLabel = 'Low';
  if (confidence >= 75) confidenceLabel = 'High';
  else if (confidence >= 50) confidenceLabel = 'Medium';

  const perServing = {
    calories: Math.round(roundedTotals.calories / s),
    protein_g: Math.round(roundedTotals.protein_g / s),
    carbs_g: Math.round(roundedTotals.carbs_g / s),
    fat_g: Math.round(roundedTotals.fat_g / s),
    fiber_g: Math.round(roundedTotals.fiber_g / s),
  };

  const hasAi = contributing.some((l) => l.status === 'ai');
  const hasUser = contributing.some((l) => l.status === 'user');
  let source = 'usda';
  if (hasAi && hasUser) source = 'mixed';
  else if (hasAi) source = 'usda+ai';
  else if (hasUser) source = 'usda+user';
  else if (contributing.length === 0) source = 'none';

  return {
    // Flat per-serving fields (UI compatibility)
    ...perServing,
    // Full structured payload
    lines: list,
    totals: roundedTotals,
    perServing,
    totalGrams,
    servingSizeG,
    servingsUsed: s,
    servingsMissing: missingServings,
    servingsSuspect,
    matched: contributing.filter((l) => l.status === 'matched').length,
    contributing: contributing.length,
    unmatchedCount: unmatched.length,
    total: considered,
    unmatchedSignificant: unmatched.map((l) => l.raw),
    matchRatio: Math.round(matchRatio * 100) / 100,
    incomplete,
    confidence,
    confidenceLabel,
    source,
    isFinal: !incomplete && !missingServings && !servingsSuspect && confidence >= 50,
  };
}

/**
 * Apply a USDA food hit to a line at given grams (user or search pick).
 */
export function applyFoodToLine(line, foodRow, grams) {
  const g = Math.max(0, Math.round(Number(grams) || 0));
  const per100 = {
    calories: foodRow.calories || 0,
    protein_g: foodRow.protein_g || 0,
    carbs_g: foodRow.carbs_g || 0,
    fat_g: foodRow.fat_g || 0,
    fiber_g: foodRow.fiber_g || 0,
  };
  const macros = roundMacros(scaleMacros(per100, g));
  return {
    ...line,
    status: line.status === 'matched' ? 'user' : 'user',
    fdc_id: foodRow.fdc_id,
    fdc_description: foodRow.description,
    grams: g,
    per100,
    ...macros,
  };
}

/**
 * Apply AI-estimated macros for a previously unmatched line (full-line totals, not per 100g).
 */
export function applyAiMacrosToLine(line, macros, grams = 0) {
  const m = roundMacros(macros || {});
  const g = Math.max(0, Math.round(Number(grams) || 0));
  // Derive synthetic per100 if grams known so later gram edits work
  const per100 = g > 0
    ? {
        calories: (m.calories / g) * 100,
        protein_g: (m.protein_g / g) * 100,
        carbs_g: (m.carbs_g / g) * 100,
        fat_g: (m.fat_g / g) * 100,
        fiber_g: (m.fiber_g / g) * 100,
      }
    : emptyMacros();
  return {
    ...line,
    status: 'ai',
    grams: g,
    per100,
    ...m,
    fdc_description: line.fdc_description || 'AI estimate',
  };
}

export async function estimateNutrition(ingredients) {
  try {
    const d = await getDb();
    if (!d) return null;

    const lines = [];
    const matched = [];
    const unmatched = [];
    const unmatchedSignificant = [];
    const processed = preprocessIngredients(ingredients);
    let index = 0;

    for (const line of processed) {
      if (isIngredientHeader(line)) continue;
      const parsed = parseIngredient(line);
      let { qty, unit, food, hasExplicitQty, cleaned } = parsed;
      const foodName = food || extractFoodName(line);
      const cleanedLabel = cleaned || [qty > 0 ? qty : '', unit, foodName].filter(Boolean).join(' ').trim() || line;
      if (!foodName) {
        unmatched.push(line);
        lines.push(buildUnmatchedLine(index++, line, line, qty, unit, cleanedLabel));
        continue;
      }

      if (isNegligibleLine(line, foodName, qty || 1, unit)) {
        continue;
      }

      if (isIngredientHeader(foodName) || (foodName.includes(':') && !/^\d/.test(foodName))) {
        continue; // skip headers entirely — do not AI-fill
      }

      // Ghost ingredients: "Soy sauce", "Chili oil" with no grams/ml — do not invent pours
      if (isUnmeasuredCondimentOrTopping(foodName, hasExplicitQty, unit)) {
        lines.push(buildSkippedNoAmountLine(index++, line, foodName, cleanedLabel));
        continue;
      }

      if (!hasExplicitQty && !unit) {
        // Only whole produce / alliums get a default count — never oils/sauces
        if (isCountProduce(foodName)) {
          qty = 1;
        } else {
          // Unknown no-amount food → ignore rather than AI-guess a pile of calories
          lines.push(buildSkippedNoAmountLine(index++, line, foodName, cleanedLabel));
          continue;
        }
      }

      const result = await searchFood(foodName, unit);
      if (result) {
        // Reject absurd mis-hits for grain rice (crackers, cakes)
        const desc = (result.description || '').toLowerCase();
        if (/\brice\b/i.test(foodName) && !/\bnoodle|vermicelli\b/i.test(foodName)
          && /\b(cracker|cake|cookie|snack|cereal)\b/.test(desc)) {
          if (__DEV__) console.log('[USDA] Rejected rice mis-hit:', result.description);
          // fall through to unmatched → AI gap only if has amount
        } else {
          const useQty = qty > 0 ? qty : 1;
          const grams = await estimateGramsFromDb(useQty, unit, foodName, result.fdc_id);
          if (!grams || grams <= 0) {
            unmatched.push(line);
            unmatchedSignificant.push(line);
            lines.push(buildUnmatchedLine(index++, line, foodName, qty, unit, cleanedLabel));
            continue;
          }
          if (__DEV__) console.log('[USDA] Scale:', line, '->', cleanedLabel, 'qty=' + useQty, 'unit=' + unit, 'grams=' + Math.round(grams), '→', result.description);
          const row = buildMatchedLine(index++, line, foodName, useQty, unit, result, grams, cleanedLabel);
          lines.push(row);
          matched.push({ input: line, food: result.description, grams: row.grams, ...result });
          continue;
        }
      }
      // Unmatched with a real amount → AI may fill; no-amount already skipped above
      unmatched.push(line);
      unmatchedSignificant.push(line);
      lines.push(buildUnmatchedLine(index++, line, foodName, qty, unit, cleanedLabel));
    }

    // Default servings=1 for raw engine; UI passes real servings into recomputeNutrition
    const base = recomputeNutrition(lines, 1);

    return {
      ...base,
      lines,
      matched,
      unmatched,
      unmatchedSignificant,
      processedCount: processed.length,
      // totals/totalGrams already from recompute at servings=1 (= full recipe totals)
    };
  } catch (e) {
    if (__DEV__) console.warn('[USDA] Nutrition lookup failed:', e.message);
    return null;
  }
}

/**
 * Link pre-structured ingredients (from AI normalize) to USDA rows.
 * items: [{ raw, include, qty, unit, food, role, grams?, reason? }]
 * This is the preferred path: AI understands cookbook English once; we only do math + FDC lookup.
 */
export async function linkStructuredIngredients(items) {
  const d = await getDb();
  if (!d) return null;

  const lines = [];
  const matched = [];
  let index = 0;

  for (const item of items || []) {
    const raw = item.raw || item.food || `item ${index}`;
    const foodName = (item.food || '').trim();
    const qty = Number(item.qty) > 0 ? Number(item.qty) : 0;
    const unit = normalizeUnit(item.unit || '');
    const cleaned = item.cleaned
      || [qty > 0 ? qty : '', unit, foodName].filter(Boolean).join(' ').trim()
      || raw;

    if (!item.include) {
      lines.push({
        id: makeLineId(raw, index++),
        raw,
        cleaned,
        status: 'ignored',
        qty: qty || null,
        unit: unit || '',
        name: foodName || raw,
        fdc_id: null,
        fdc_description: item.reason || 'Not counted (optional / no amount / topping)',
        grams: 0,
        per100: emptyMacros(),
        ...emptyMacros(),
      });
      continue;
    }

    if (!foodName) {
      lines.push(buildUnmatchedLine(index++, raw, raw, qty, unit, cleaned));
      continue;
    }

    // Prefer AI-provided grams when sensible
    let grams = Number(item.grams) > 0 ? Number(item.grams) : 0;
    const result = await searchFood(foodName, unit);

    if (result) {
      const desc = (result.description || '').toLowerCase();
      const badRice = /\brice\b/i.test(foodName) && !/\bnoodle|vermicelli\b/i.test(foodName)
        && /\b(cracker|cake|cookie|snack|cereal)\b/.test(desc);
      if (!badRice) {
        if (!grams) {
          const useQty = qty > 0 ? qty : 1;
          grams = await estimateGramsFromDb(useQty, unit, foodName, result.fdc_id);
        }
        if (grams > 0) {
          const row = buildMatchedLine(index++, raw, foodName, qty || null, unit, result, grams, cleaned);
          lines.push(row);
          matched.push({ input: raw, food: result.description, grams: row.grams, ...result });
          continue;
        }
      }
    }

    // Structured but no USDA hit — keep amount for optional AI macro fill
    if (qty > 0 || unit || grams > 0) {
      const uLine = buildUnmatchedLine(index++, raw, foodName, qty, unit, cleaned);
      if (grams > 0) uLine.grams = Math.round(grams);
      lines.push(uLine);
    } else {
      lines.push({
        id: makeLineId(raw, index++),
        raw,
        cleaned,
        status: 'ignored',
        qty: null,
        unit: '',
        name: foodName,
        fdc_id: null,
        fdc_description: 'No amount — not counted',
        grams: 0,
        per100: emptyMacros(),
        ...emptyMacros(),
      });
    }
  }

  return { lines, matched, processedCount: (items || []).length };
}

/**
 * Multi-hit food search for the picker UI.
 */
export async function searchFoodOptions(query, unit = '', limit = 8) {
  const d = await getDb();
  if (!d || !query || query.length < 2) return [];

  const q = query.toLowerCase().trim();
  const searchTerm = resolveSearchTerm(q, unit);
  const selectCols = 'f.fdc_id, f.description, n.calories, n.protein_g, n.carbs_g, n.fat_g, n.fiber_g';
  const join = 'FROM foods f JOIN nutrients n ON n.fdc_id = f.fdc_id';
  const seen = new Set();
  const out = [];

  const pushRows = (rows) => {
    for (const r of rows || []) {
      if (!r || seen.has(r.fdc_id)) continue;
      seen.add(r.fdc_id);
      out.push(r);
      if (out.length >= limit) return true;
    }
    return false;
  };

  try {
    const prefix = searchTerm.split(',')[0].trim().toLowerCase();
    const starts = await d.getAllAsync(
      `SELECT ${selectCols} ${join} WHERE LOWER(f.description) LIKE ? ORDER BY LENGTH(f.description) ASC LIMIT ?`,
      [prefix + '%', limit * 2]
    );
    if (pushRows(starts)) return out;
  } catch (e) { /* ignore */ }

  try {
    const ftsQuery = searchTerm.replace(/,/g, ' ').replace(/[^\w\s%-]/g, ' ').replace(/\s+/g, ' ').trim();
    const fts = await d.getAllAsync(
      `SELECT ${selectCols} FROM foods_fts JOIN foods f ON f.fdc_id = foods_fts.rowid JOIN nutrients n ON n.fdc_id = f.fdc_id WHERE foods_fts MATCH ? ORDER BY rank LIMIT ?`,
      [ftsQuery, limit * 2]
    );
    // score dry/cooked preference
    const scored = (fts || []).map((r) => ({ r, score: pickBestHit([r], searchTerm) ? 1 : 0 }));
    pushRows(scored.map((x) => x.r));
  } catch (e) { /* ignore */ }

  return out.slice(0, limit);
}

/** Fetch nutrient row by fdc_id */
export async function getFoodByFdcId(fdcId) {
  const d = await getDb();
  if (!d || !fdcId) return null;
  try {
    return await d.getFirstAsync(
      `SELECT f.fdc_id, f.description, n.calories, n.protein_g, n.carbs_g, n.fat_g, n.fiber_g
       FROM foods f JOIN nutrients n ON n.fdc_id = f.fdc_id WHERE f.fdc_id = ?`,
      [fdcId]
    );
  } catch {
    return null;
  }
}


/**
 * Get allergen flags for a list of fdc_ids.
 * Returns summary: { contains_gluten, contains_dairy, contains_nuts, contains_soy, contains_eggs, contains_shellfish }
 */
export async function getAllergens(fdcIds) {
  const d = await getDb();
  if (!d || !fdcIds.length) return null;

  const flags = { contains_gluten: false, contains_dairy: false, contains_nuts: false, contains_soy: false, contains_eggs: false, contains_shellfish: false };
  try {
    // Batch in chunks of 20 to avoid SQLite parameter limits
    for (let i = 0; i < fdcIds.length; i += 20) {
      const chunk = fdcIds.slice(i, i + 20);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = await d.getAllAsync(
        'SELECT * FROM allergens WHERE fdc_id IN (' + placeholders + ')', chunk
      );
      for (const row of rows) {
        if (row.contains_gluten) flags.contains_gluten = true;
        if (row.contains_dairy) flags.contains_dairy = true;
        if (row.contains_nuts) flags.contains_nuts = true;
        if (row.contains_soy) flags.contains_soy = true;
        if (row.contains_eggs) flags.contains_eggs = true;
        if (row.contains_shellfish) flags.contains_shellfish = true;
      }
    }
  } catch (e) { if (__DEV__) console.error('[USDA] Allergen error:', e.message); }
  return flags;
}

export function isAvailable() {
  return true; // DB is bundled in assets, always available
}

