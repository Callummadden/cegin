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
        await testDb.closeAsync();
        if (!tables || !ver || ver.c < 1000) {
          console.log('[USDA] DB stale or empty, deleting...');
          await FileSystem.deleteAsync(dbPath);
        }
      } catch {
        await FileSystem.deleteAsync(dbPath);
      }
    }

    const freshInfo = await FileSystem.getInfoAsync(dbPath);
    if (!freshInfo.exists) {
      console.log('[USDA] Copying nutrition DB from assets...');
      const asset = Asset.fromModule(require('../assets/usda-nutrition.db'));
      await asset.downloadAsync();
      console.log('[USDA] Asset URI:', asset.localUri);
      await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}SQLite`, { intermediates: true });
      await FileSystem.copyAsync({ from: asset.localUri, to: dbPath });
      console.log('[USDA] Copied to:', dbPath);
    }

    db = await SQLite.openDatabaseAsync(dbPath);
    console.log('[USDA] Database opened from:', dbPath);
    return db;
  } catch (e) {
    console.error('[USDA] Failed to open database:', e.message);
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
// Preferred USDA search terms — defaults to mid-range fat when generic
const PREFERRED_TERMS = {
  milk: 'milk, reduced fat, fluid, 2%',
  yogurt: 'yogurt, plain, low fat',
  'greek yogurt': 'yogurt, greek, plain, lowfat',
  cheese: 'cheese, cheddar',
  chicken: 'chicken breast, raw, boneless, skinless',
  beef: 'beef, ground, 85% lean',
  rice: 'rice, white, long-grain, regular, cooked',
  pasta: 'pasta, cooked, enriched',
  bread: 'bread, whole wheat',
  egg: 'egg, whole, raw, fresh',
  eggs: 'egg, whole, raw, fresh',
  butter: 'butter, with salt',
  oil: 'oil, olive, salad or cooking',
  sugar: 'sugars, granulated',
  flour: 'flour, wheat, all-purpose, enriched, unbleached',
  oats: 'cereals, oats, regular and quick, not fortified, dry',
  'rolled oats': 'cereals, oats, regular and quick, not fortified, dry',
  honey: 'honey',
  'maple syrup': 'syrup, maple',
  salt: 'salt, table',
  onion: 'onions, raw',
  garlic: 'garlic, raw',
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
  tomato: 'tomatoes, raw, red, ripe',
  tomatoes: 'tomatoes, raw, red, ripe',
  peas: 'peas, green, frozen, unprepared',
  'frozen peas': 'peas, green, frozen, unprepared',
  'stock': 'broth, chicken',
  'lamb stock': 'broth, chicken',
  'beef stock': 'broth, chicken',
  'chicken stock': 'broth, chicken',
  'carrot': 'carrots, raw',
  carrots: 'carrots, raw',
};

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

// Unit conversions to grams
const UNIT_TO_GRAMS = {
  cup: 1, cups: 1, c: 1,
  tbsp: 0.0625, tablespoon: 0.0625, tablespoons: 0.0625,
  tsp: 0.0208, teaspoon: 0.0208, teaspoons: 0.0208,
  oz: 28.35, ounce: 28.35, ounces: 28.35,
  lb: 453.6, pound: 453.6, pounds: 453.6,
  g: 0.001, gram: 0.001, grams: 0.001,
  kg: 1, kilogram: 1,
  ml: 0.001, milliliter: 0.001, liter: 1,
  pint: 473, quart: 946, gallon: 3785,
  stick: 0.5, // sticks of butter
  tin: 4, // 1 tin ≈ 400g ≈ 4 cups (liquid) = ~113g each, ~0.5 cups
};

/**
 * Parse quantity, unit, and food name from an ingredient line.
 * "2 cups all-purpose flour" → { qty: 2, unit: 'cups', food: 'all-purpose flour' }
 * "1/2 tsp vanilla" → { qty: 0.5, unit: 'tsp', food: 'vanilla' }
 */
function parseIngredient(ingredient) {
  if (!ingredient || typeof ingredient !== 'string') return { qty: 0, unit: '', food: '' };

  let s = ingredient.trim();

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

  // Parse unit
  let unit = '';
  const unitMatch = s.match(/^([\w]+)\s+/);
  if (unitMatch) {
    const candidate = unitMatch[1].toLowerCase();
    if (UNIT_TO_GRAMS[candidate] !== undefined) {
      unit = candidate;
      s = s.slice(unitMatch[0].length);
    }
  }

  // Clean food name
  let food = s
    .replace(/^[\s,;:–—-]+/, '')
    .replace(/,?\s*(sifted|diced|chopped|minced|grated|shredded|peeled|crushed|ground|melted|softened|cooked|raw|fresh|frozen|canned|dried|optional|to taste|divided)\s*$/i, '')
    .replace(/\(.*?\)\s*$/, '')
    .replace(/[\s,;:–—-]+$/, '')
    .trim();

  return { qty: qty || 1, unit, food };
}

/**
 * Convert parsed ingredient to estimated grams.
 */
async function estimateGramsFromDb(qty, unit, foodName, fdcId) {
  if (!fdcId || !unit) return estimateGrams(qty, unit, foodName);

  const d = await getDb();
  if (!d) return estimateGrams(qty, unit, foodName);

  // Look up per-food gram weight for this unit
  const unitNorm = unit === 'cups' ? 'cup' : unit === 'tbsp' ? 'tablespoon' : unit === 'tsp' ? 'teaspoon' : unit;
  try {
    const row = await d.getFirstAsync(
      "SELECT gram_weight FROM unit_conversions WHERE fdc_id = ? AND unit_name = ? LIMIT 1",
      [fdcId, unitNorm]
    );
    if (row && row.gram_weight > 0) {
      return qty * row.gram_weight;
    }
  } catch (e) {}

  // Check custom unit conversions (produce, colloquial units)
  if (foodName) {
    try {
      const foodLower = foodName.toLowerCase();
      const customRow = await d.getFirstAsync(
        "SELECT gram_weight FROM custom_unit_conversions WHERE ? LIKE '%' || food_name || '%' AND unit_name = ? LIMIT 1",
        [foodLower, unitNorm]
      );
      if (customRow && customRow.gram_weight > 0) {
        return qty * customRow.gram_weight;
      }
    } catch (e) {}
  }

  // Fallback to generic estimate
  return estimateGrams(qty, unit, foodName);
}

function estimateGrams(qty, unit, foodName) {
  const foodLower = (foodName || "").toLowerCase();

  // Direct weight/mass units
  if (unit === 'g' || unit === 'gram' || unit === 'grams') return qty;
  if (unit === 'kg' || unit === 'kilogram' || unit === 'kilograms') return qty * 1000;
  if (unit === 'oz' || unit === 'ounce' || unit === 'ounces') return qty * 28.35;
  if (unit === 'lb' || unit === 'pound' || unit === 'pounds') return qty * 453.6;

  // Metric liquid volumes — 1ml ≈ 1g for cooking purposes
  if (unit === 'ml' || unit === 'milliliter' || unit === 'millilitre') return qty;
  if (unit === 'l' || unit === 'liter' || unit === 'litre') return qty * 1000;

  // Volume units — look up density from GRAMS_PER_CUP
  if (unit === 'cup' || unit === 'cups' || unit === 'c') {
    for (const [key, grams] of Object.entries(GRAMS_PER_CUP)) {
      if (foodLower.includes(key.replace(/_/g, ' '))) return qty * grams;
    }
    return qty * 240; // default: liquid density
  }
  if (unit === 'tablespoon' || unit === 'tbsp') {
    // Look up cup density and divide by 16
    for (const [key, grams] of Object.entries(GRAMS_PER_CUP)) {
      if (foodLower.includes(key.replace(/_/g, ' '))) return qty * grams / 16;
    }
    return qty * 15; // default: ~1 tbsp = 15g
  }
  if (unit === 'teaspoon' || unit === 'tsp') {
    for (const [key, grams] of Object.entries(GRAMS_PER_CUP)) {
      if (foodLower.includes(key.replace(/_/g, ' '))) return qty * grams / 48;
    }
    return qty * 5; // default: ~1 tsp = 5g
  }

  // Count-based: eggs, produce, tins/cans
  if (unit === 'tin' || unit === 'tins') return qty * 400;
  if (unit === 'can' || unit === 'cans') return qty * 400;
  if (foodLower.includes('egg')) return qty * 50;
  if (foodLower.includes('banana')) return qty * 120;
  if (foodLower.includes('apple')) return qty * 180;
  if (foodLower.includes('onion')) return qty * 150;
  if (foodLower.includes('carrot')) return qty * 60;
  if (foodLower.includes('potato')) return qty * 170;
  if (foodLower.includes('tomato')) return qty * 150;
  if (foodLower.includes('pepper')) return qty * 150;
  if (foodLower.includes('mushroom')) return qty * 20;
  if (foodLower.includes('zucchini') || foodLower.includes('courgette')) return qty * 200;
  if (foodLower.includes('cucumber')) return qty * 200;
  if (foodLower.includes('garlic')) return qty * 5;
  if (foodLower.includes('ginger')) return qty * 15;
  if (foodLower.includes('lemon') || foodLower.includes('lime')) return qty * 70;
  if (foodLower.includes('avocado')) return qty * 150;
  if (foodLower.includes('celery')) return qty * 40;
  if (foodLower.includes('stalk')) return qty * 40;

  // No unit — could be count-based or pinch/dash
  if (!unit || unit === '') {
    if (qty <= 1) return 1; // pinch/dash ≈ 1g
    return qty * 100; // count-based: assume ~100g per piece
  }

  // Fallback: 1 "unit" ≈ 100g
  return qty * 100;
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
    let s = line.trim();
    if (!s) continue;

    // Strip narrative prefixes
    s = s.replace(/^(?:for\s+(?:the\s+)?[\w\s]+[:.]?\s*)/i, '');
    s = s.replace(/^(?:toppings?|garnish|sauce|filling|dressing|marinade|glaze|icing|coating|crumble|crust|base|layer|stuffing)[:.]?\s*/i, '');

    // Bracket weight extractor: "1 tin coconut milk (400ml)" -> "400ml coconut milk"
    const bracketMatch = s.match(/\(([\d.]+)\s*(ml|g|kg|oz|l|lb)\s*\)/i);
    if (bracketMatch) {
      const qty = bracketMatch[1];
      const unit = bracketMatch[2].toLowerCase();
      // Remove the bracket and the leading quantity+unit
      let food = s.replace(/\s*\([^)]+\)/, '').trim();
      food = food.replace(/^\d+[\s\/\\]*\d*[\s\/\\]*\d*\s*(?:tins?|cans?|packages?|packets?|boxes?|bags?|bottles?|jars?|sachets?|pots?|tubs?|blocks?|sticks?|slices?|pieces?|cloves?|sprigs?|bunches?|stalks?|heads?|bulbs?|knobs?)\s+/i, '');
      s = qty + unit + ' ' + food;
    }

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
    // Strip trailing comma + prep verbs: "500g chicken thighs, diced" -> "500g chicken thighs"
    const prepVerbs = 'diced|minced|chopped|grated|sliced|peeled|crushed|shredded|melted|softened|cooked|raw|fresh|frozen|canned|dried|sifted|beaten|whisked|mixed|combined|divided|trimmed|cubed|quartered|halved|torn|broken|crumbled|toasted|roasted|ground|packed|squeezed|strained|rinsed|drained|pat\s+dry|patted\s+dry';
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

  let s = ingredient.toLowerCase().trim();

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

  return s.trim();
}

/**
 * Search for a food in the USDA database.
 */
async function searchFood(query) {
  const d = await getDb();
  if (!d || !query || query.length < 2) return null;

  const q = query.toLowerCase().trim().replace(/,.*$/, "");  // Strip trailing prep notes

  // Translate UK terms to US and check preferred terms
  const translated = translateToUS(q);
  const searchTerm = PREFERRED_TERMS[translated] || PREFERRED_TERMS[q] || translated;
  if (q !== translated) console.log('[USDA] UK->US:', q, '->', translated);

  // Strategy 1: Exact description match
  try {
    const exact = await d.getFirstAsync(
      "SELECT f.fdc_id, f.description, n.calories, n.protein_g, n.carbs_g, n.fat_g, n.fiber_g FROM foods f JOIN nutrients n ON n.fdc_id = f.fdc_id WHERE LOWER(f.description) = ? LIMIT 1", [searchTerm]);
    if (exact) { console.log('[USDA] Exact:', q, '->', exact.description); return exact; }
  } catch (e) { console.log('[USDA] Exact error:', e.message); }

  // Strategy 2: Description STARTS with query ("oats" matches "Oats, rolled")
  try {
    const starts = await d.getFirstAsync(
      "SELECT f.fdc_id, f.description, n.calories, n.protein_g, n.carbs_g, n.fat_g, n.fiber_g FROM foods f JOIN nutrients n ON n.fdc_id = f.fdc_id WHERE LOWER(f.description) LIKE ? ORDER BY LENGTH(f.description) ASC LIMIT 1", [q + '%']);
    if (starts) { console.log('[USDA] Starts:', q, '->', starts.description); return starts; }
  } catch (e) { console.log('[USDA] Starts error:', e.message); }

  // Strategy 3: Alias match (UK/AU/CA terms stored in aliases column)
  // Try both the original query AND the translated/preferred term
  for (const term of [q, translated, searchTerm]) {
    if (!term || term.length < 2) continue;
    try {
      const aliasExact = await d.getFirstAsync(
        'SELECT f.fdc_id, f.description, n.calories, n.protein_g, n.carbs_g, n.fat_g, n.fiber_g FROM foods f JOIN nutrients n ON n.fdc_id = f.fdc_id WHERE LOWER(f.aliases) LIKE ? ORDER BY LENGTH(f.description) ASC LIMIT 1',
        ['%' + term + '%']
      );
      if (aliasExact) { console.log('[USDA] Alias:', q, '(via', term, ')->', aliasExact.description); return aliasExact; }
    } catch (e) {}
  }

  // Strategy 4: FTS5 match (searches description + aliases)
  // Sanitize for FTS5: replace commas with spaces, wrap in quotes if multi-word
  const ftsQuery = searchTerm.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  try {
    const ftsResults = await d.getAllAsync(
      "SELECT f.fdc_id, f.description, n.calories, n.protein_g, n.carbs_g, n.fat_g, n.fiber_g FROM foods_fts JOIN foods f ON f.fdc_id = foods_fts.rowid JOIN nutrients n ON n.fdc_id = f.fdc_id WHERE foods_fts MATCH ? ORDER BY rank LIMIT 10", [ftsQuery]);
    if (ftsResults && ftsResults.length > 0) {
      // Prefer entries with complete nutrition (protein > 0)
      const withProtein = ftsResults.filter(r => r.protein_g > 0);
      const ftsResult = withProtein.length > 0 ? withProtein[0] : ftsResults[0];
      console.log('[USDA] FTS:', q, '->', ftsResult.description, '(protein:', ftsResult.protein_g, ')');
      return ftsResult;
    }
  } catch (e) { console.log('[USDA] FTS error:', e.message); }

  // Strategy 5: De-pluralization fallback — strip trailing "s" from words
  const singular = searchTerm.replace(/(\w)s/g, (m, w) => {
    // Don't de-pluralize words that end in "ss" (e.g., "grass") or short words
    if (w.endsWith('s') || w.length < 3) return m;
    return w;
  });
  if (singular !== searchTerm) {
    try {
      const singularResult = await d.getFirstAsync(
        "SELECT f.fdc_id, f.description, n.calories, n.protein_g, n.carbs_g, n.fat_g, n.fiber_g FROM foods f JOIN nutrients n ON n.fdc_id = f.fdc_id WHERE LOWER(f.description) LIKE ? ORDER BY LENGTH(f.description) ASC LIMIT 1",
        ['%' + singular + '%']
      );
      if (singularResult) { console.log('[USDA] Singular:', q, '(', singular, ')->', singularResult.description); return singularResult; }
    } catch (e) {}
  }

  // Strategy 6: Last significant word starts-with
  const words = q.split(/\s+/).filter(w => w.length > 2);
  const lastWord = words.length > 0 ? words[words.length - 1] : null;
  if (lastWord) {
    try {
      const last = await d.getFirstAsync(
        "SELECT f.fdc_id, f.description, n.calories, n.protein_g, n.carbs_g, n.fat_g, n.fiber_g FROM foods f JOIN nutrients n ON n.fdc_id = f.fdc_id WHERE LOWER(f.description) LIKE ? ORDER BY LENGTH(f.description) ASC LIMIT 1", [lastWord + '%']);
      if (last) { console.log('[USDA] Last:', lastWord, '->', last.description); return last; }
    } catch (e) { console.log('[USDA] Last error:', e.message); }
  }

  console.log('[USDA] No match for:', query);
  return null;
}
export async function estimateNutrition(ingredients) {
  try {
    const d = await getDb();
    if (!d) return null;

    const matched = [];
    const unmatched = [];
    const totals = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };

    // Pre-process: split compound lines and strip narrative prefixes
    const processed = preprocessIngredients(ingredients);

    for (const line of processed) {
      const { qty, unit, food } = parseIngredient(line);
      const foodName = food || extractFoodName(line);
      if (line.toLowerCase().includes('chicken')) console.log('[USDA] Chicken line:', line, '-> qty:', qty, 'unit:', unit, 'food:', foodName);
      if (!foodName) { unmatched.push(line); continue; }

      // Skip open-ended lines without quantities: "Toppings: berries, nuts, honey"
      // These have no measurable amount — can't calculate nutrition from them
      const hasQuantity = qty > 0 && (unit || line.match(/^\d/));
      const isHeader = foodName.includes(':') && !foodName.match(/^\d/);
      if (!hasQuantity && (isHeader || foodName.includes(','))) {
        unmatched.push(line);
        continue;
      }

      const result = await searchFood(foodName);
      if (result) {
        const grams = await estimateGramsFromDb(qty, unit, foodName, result.fdc_id);
        const scale = grams / 100;
        console.log('[USDA] Scale:', line, '->', foodName, 'qty='+qty, 'unit='+unit, 'grams='+Math.round(grams), 'scale='+scale.toFixed(2));
        matched.push({ input: line, food: result.description, grams: Math.round(grams), ...result });
        totals.calories += (result.calories || 0) * scale;
        totals.protein_g += (result.protein_g || 0) * scale;
        totals.carbs_g += (result.carbs_g || 0) * scale;
        totals.fat_g += (result.fat_g || 0) * scale;
        totals.fiber_g += (result.fiber_g || 0) * scale;
      } else {
        unmatched.push(line);
      }
    }

    // Round totals
    for (const k of Object.keys(totals)) totals[k] = Math.round(totals[k]);

    // Atwater validation: if calories=0 but macros exist, recalculate
    const atwater = (totals.protein_g * 4) + (totals.carbs_g * 4) + (totals.fat_g * 9) - (totals.fiber_g * 2);
    if (totals.calories === 0 && atwater > 0) {
      totals.calories = Math.round(atwater);
    }
    // If calories deviate >50% from Atwater, use Atwater as sanity check
    if (totals.calories > 0 && atwater > 0 && Math.abs(totals.calories - atwater) / atwater > 0.5) {
      totals.calories = Math.round(atwater);
    }

    return { matched, unmatched, totals, processedCount: processed.length };
  } catch (e) {
    console.warn('[USDA] Nutrition lookup failed:', e.message);
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
  } catch (e) { console.error('[USDA] Allergen error:', e.message); }
  return flags;
}

export function isAvailable() {
  return true; // DB is bundled in assets, always available
}

