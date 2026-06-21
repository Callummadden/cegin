# v1.3.0 — Local Nutrition Pipeline & Dietary Intelligence

## Summary

This release transforms Cegin from a recipe manager into a fully offline nutrition-aware cooking app. Every recipe now gets instant macro calculations, allergen warnings, and dietary audit suggestions — all powered by a 2.7MB local USDA database with 14,046 foods. No internet required for nutrition lookups.

### Local USDA Nutrition Engine
The biggest feature in this release. A bundled SQLite database containing 14,046 foods from the USDA SR Legacy and Foundation Foods datasets, with full macro data (calories, protein, carbs, fat, fiber) for every entry. The engine uses a 6-strategy search pipeline to match user-written ingredient lines to USDA foods: exact description match, starts-with matching, UK/AU/CA alias matching, FTS5 full-text search, de-pluralization fallback, and last-word fallback. Each food has per-unit gram weights (e.g., 1 cup oats = 81g, not a generic 240g), and the system handles metric volumes (ml/litre), colloquial units ("1 handful", "1 tin"), and count-based items ("2 carrots"). A UK-to-US translation dictionary with 80+ mappings ensures British recipes like "lamb mince" correctly match "ground lamb" in the American database. The entire pipeline runs locally on the device — no server calls, no API keys, no latency.

### Instant Allergen Detection
When a recipe loads, the app instantly checks every matched ingredient against a local allergen flags table (7,119 foods flagged). Colored badges appear at the top of the recipe: 🌾 GLUTEN, 🥛 DAIRY, 🥜 NUTS, 🫘 SOY, 🥚 EGGS, 🦐 SHELLFISH. This is completely offline and takes milliseconds — no AI call needed. The flags are based on USDA food categories, not AI guesses, so they're reliable for common whole ingredients.

### Terry's Dietary Suggestions
When the dietary audit identifies ingredients that conflict with a profile's needs, Terry now suggests specific substitutions with exact quantities (e.g., "swap 100g butter for 100g ghee"). A new "Apply Terry's Suggestions" button collects all substitutions and opens a picker modal where users can choose between multiple options (e.g., ghee or coconut oil) or add their own custom swaps. When applied, the AI modifies the recipe and opens the editor with Terry's changes highlighted in red — only the new/changed lines appear as red text above each field, and the highlighting clears once the user starts editing. A dark loading overlay with spinner shows while the AI processes. The original recipe image is preserved through the substitution flow.

### Pre-processing Pipeline
Before any ingredient line hits the database search, it passes through a multi-stage pre-processor. Compound lines like "For the sauce: 100g butter, 150g dark sugar, 200ml double cream" are split into separate items. Narrative prefixes ("For the filling:", "Toppings:") are stripped. Bracket weights are extracted — "1 tin coconut milk (400ml)" becomes "400ml coconut milk". Prep instructions are trimmed — "500g chicken thighs, diced" becomes "500g chicken thighs". Count-based items get estimated weights — "2 carrots" becomes 120g, "1 clove garlic" becomes 5g. This pre-processing ensures the maximum number of ingredients match the database, which is why nutrition accuracy jumped from ~50% to ~90%+ ingredient coverage.

### Dietary Audit Intelligence
The dietary audit now only audits for people in the Health & Diet profiles — Terry never invents names. When all profiles are safe, the audit auto-collapses into a compact green bar ("✓ DIETARY AUDIT — ALL SAFE") that users can tap to expand. The audit prompt now includes explicit instructions to use exact quantities in substitutions and to only return entries for the people listed in the profiles.

---

## 🧠 Local USDA Nutrition Engine
- **Bundled SQLite database** — 14,046 foods (SR Legacy + Foundation Foods), 14,630 unit conversions, 7,119 allergen flags, 3,396 global aliases — all offline at 2.7MB
- **6-strategy search pipeline** — exact match → starts-with → UK/AU/CA alias match → FTS5 full-text → de-pluralization fallback → last-word fallback
- **UK-to-US translation dictionary** — 80+ mappings: lamb mince→ground lamb, courgette→zucchini, plain flour→all-purpose flour, double cream→heavy cream, etc.
- **Global aliases column** — foods indexed with UK/AU/CA/CA synonyms for instant cross-locale matching
- **Per-food unit conversions** — exact USDA gram weights per cup/tbsp/tsp for each specific food (not generic densities)
- **Custom unit conversions** — 82 entries for produce ("1 medium banana"→120g), colloquial ("1 handful spinach"→30g), and tins/cans (400g)
- **Metric liquid volumes** — ml/litre handled as 1:1 gram equivalents
- **Atwater validation** — calories recalculated from macros if missing, with correct net-carb formula (fiber subtracted, not double-counted)
- **FTS5 protein preference** — when multiple foods match, prefers entries with actual protein data over sparse Foundation Foods entries

## 🥗 Instant Allergen Detection
- **Local allergen flags** — gluten, dairy, nuts, soy, eggs, shellfish detected instantly from USDA database (no API needed)
- **Colored badges** — 🌾 GLUTEN, 🥛 DAIRY, 🥜 NUTS, 🫘 SOY, 🥚 EGGS, 🦐 SHELLFISH displayed on recipe load
- **Batched queries** — allergen lookups chunked in groups of 20 to avoid SQLite parameter limits

## 🤖 Terry's Dietary Suggestions
- **"Apply Terry's Suggestions" button** — collects all audit substitutions and sends to AI to modify the recipe
- **Substitution picker modal** — when Terry suggests multiple options (e.g., "ghee or coconut oil"), user picks with radio buttons
- **Custom substitution entry** — user can type their own swaps and add them to the list
- **Quantified substitutions** — Terry now includes exact quantities in suggestions ("swap 100g butter for 100g ghee")
- **Change highlighting** — Terry's additions shown as red text above each field, with red banner "✏️ TERRY CHANGED: INGREDIENTS, STEPS"
- **Edit tracking** — red highlighting clears once user starts editing the field
- **Image preservation** — original recipe image preserved when applying suggestions
- **Loading overlay** — dark overlay with spinner and "Changes will be highlighted in red" while AI processes
- **Profile-only audits** — Terry only audits for people in Health & Diet profiles, never invents names

## 🔧 Pre-processing Pipeline
- **Compound line splitter** — "For the sauce: 100g butter, 150g dark sugar, 200ml double cream" → 3 separate items
- **Narrative prefix stripper** — removes "For the sauce:", "For the filling:", "Toppings:", etc.
- **Bracket weight extractor** — "1 tin coconut milk (400ml)" → "400ml coconut milk"he biggest feature in this release. A bundled SQLite database containing 14,046 foods from the USDA SR Legacy and Foundation Foods datasets, with full macro data (calories, protein, carbs, fat, fiber) for every entry. The engine uses a 6-strategy search pipeline to match user-written ingredient lines to USD
- **Prep-instruction stripper** — "500g chicken thighs, diced" → "500g chicken thighs" (strips comma + prep verbs)
- **Count-based produce weights** — "2 carrots"→120g, "2 potatoes"→340g, "1 clove garlic"→5g

## 🐛 Bug Fixes
- **Crash fix:** App reset no longer crashes — `clearFavorites` was missing from favorites module
- **Data fix:** Recipe updates no longer silently ignore `cookTime`/`prepTime`/`image` fields
- **Data fix:** Activity cache now properly clears when diet profiles are cleared
- **Import fixes:** Restored missing `AppState`, `useState`, `useMemo` imports that caused render errors
- **Food name fix:** Commas in food names no longer break FTS5 search syntax
- **Unit fix:** "tin" unit now correctly maps to 400g
- **Unit fix:** ml/litre units handled as 1:1 gram equivalents (was falling through to 100g default)
- **Count fix:** "2 carrots" without explicit unit now defaults to 60g per carrot (was 1g)
- **Fallback fix:** Count-based items (qty > 1, no unit) default to 100g per piece instead of 1g

## ⚡ Performance
- Favorites and chat history now use in-memory cache for instant reads
- Timer context value memoized — prevents unnecessary re-renders
- Cookbook screen no longer fires redundant duplicate fetches
- Version banner replaced 60s polling with focus-based re-check
- Dietary audit auto-collapses when all profiles are safe

## 🧹 Cleanup
- Removed ~360 lines of dead code, unused imports, and duplicate logic
- Extracted shared `SwipeableRow` component
- Extracted shared `fmtClock` and `parseTimerMins` utilities
- Refactored `scanRecipeImage` to reuse vision model dispatch
- Unified duplicate recipe card rendering branches
- Server: extracted `parseId`, `cookbookEntryToResponse`, `saveBase64Image` helpers
- Server: added `applySubstitutions` endpoint for Terry's suggestions
