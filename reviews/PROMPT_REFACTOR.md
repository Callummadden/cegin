# Prompt Refactor Summary

## What Changed

All AI prompt strings were extracted from `server/ai.js` into a new `server/prompts.js` module with named exports. Function signatures and behaviour are identical — only the location of the string constants changed.

## Files

| File | Lines Before | Lines After | Δ |
|------|-------------|-------------|---|
| `server/ai.js` | 1292 | 1143 | −149 |
| `server/prompts.js` | — | 264 | +264 (new) |

## Exported Prompts

| Export Name | Used By | Purpose |
|-------------|---------|---------|
| `BASE_PROMPT` | `systemPrompt()` | Chef Terry personality, cooking style, available actions |
| `DIETARY_PROFILES_SUFFIX` | `systemPrompt()` | Dietary profile instruction appended when profiles exist |
| `RECIPE_PARSE_PROMPT` | `generateRecipe()` | Produce one recipe as structured JSON |
| `IMPORT_RECIPE_PROMPT` | `importFromUrl()` | Extract a single recipe from scraped web page text |
| `TIDY_RECIPE_PROMPT` | `tidyRecipe()` | Clean up scraped recipe data without changing content |
| `CONVERT_UNITS_PROMPT` | `convertUnits()` | Rewrite ingredients in metric or US units (has `{target}` placeholder) |
| `CONSOLIDATE_SHOPPING_PROMPT` | `consolidateShoppingList()` | Merge ingredients into grouped grocery list |
| `MEAL_PLAN_PROMPT` | `suggestMealPlan()` | 7-day meal plan from saved recipes |
| `DIETARY_ANALYSIS_PROMPT` | `auditRecipe()` | Audit recipe against dietary profiles, flag issues |
| `FIX_MISTAKE_PROMPT` | `fixMistake()` | Mid-cook panic fix with food science |
| `ADJUST_COOKING_PROMPT` | `adjustCooking()` | Recalculate times/temps for recipe modifications |
| `NUTRITION_PROMPT` | `estimateNutrition()` | Per-serving nutrition estimation |
| `PREP_STEPS_PROMPT` | `generatePrepSteps()` | Pre-cook preparation checklist |
| `SCAN_FRIDGE_PROMPT_GEMINI` | `callVisionModel()` | Gemini vision: list fridge/pantry items |
| `SCAN_FRIDGE_PROMPT_OPENAI` | `callVisionModel()` | OpenAI vision: list visible food items |
| `SCAN_RECIPE_PROMPT` | `scanRecipeImage()` | Extract recipe from a photo of a cookbook/page |
| `SUBSTITUTION_PROMPT` | `applySubstitutions()` | Apply dietary substitutions to a recipe |

## How to Tune

1. Open `server/prompts.js`
2. Find the prompt constant you want to adjust
3. Edit the string — no need to touch `ai.js` logic at all

For `CONVERT_UNITS_PROMPT`, the `{target}` placeholder is replaced at runtime with the actual unit system description (metric or US customary).

## Notes

- All function signatures in `ai.js` are unchanged — this is a pure refactor
- The `systemPrompt()` function still builds the dynamic parts (saved recipes context, dietary profiles) locally; only the static template strings moved out
- `prompts.js` has zero dependencies — it's pure string constants with `module.exports`
