# Deduplication Report — Cegin Mobile

**Date:** 2026-07-11
**Scope:** `mobile/src/` — screens and utilities

---

## Summary

Eliminated **3 categories of code duplication** across **5 screen files**, extracting shared logic into canonical utility modules. Net result: ~70 lines of duplicated code removed, replaced by imports from shared utilities.

---

## 1. `splitLines` — Inline copies removed

**Canonical source:** `src/utils/splitLines.js`

| File | Before | After |
|------|--------|-------|
| `screens/EditRecipeScreen.js` | Inline arrow function (line 120) | Removed — now uses `buildRecipeObject` from `recipeUtils.js` (which imports `splitLines` internally) |
| `screens/ScanRecipeScreen.js` | Inline arrow function (line 159) | Removed — now uses `buildRecipeObject` from `recipeUtils.js` |

**Difference:** The inline copies lacked the null guard (`if (!text) return []`) that the canonical version has. Using the canonical version is strictly safer.

---

## 2. `parseTimerMins` / `findAllTimers` — Inline copies removed

**Canonical source:** `src/utils/timerUtils.js`

| File | Before | After |
|------|--------|-------|
| `screens/RecipeDetailScreen.js` | Local `parseTimerMins` (lines 49–55) — single-match, decimal support | Imports `parseTimerMins` from `timerUtils`; caller adapted to extract `[0]` from array |
| `screens/CookModeScreen.js` | Local `findAllTimers` (lines 48–72) + `parseTimerMins` wrapper (lines 75–78) | Imports `findAllTimers` from `timerUtils`; `parseTimerMins` wrapper removed (unused) |

**Canonical improvements merged into `timerUtils.js`:**
- `findAllTimers` — moved from CookModeScreen to canonical export (was only local). Handles decimals (`1.5 hours`), ranges (`30-40 minutes`), compound times.
- `parseTimerMins` — now delegates to `findAllTimers` instead of using a separate, less capable regex (`\d+` → `\d+(?:\.\d+)?`).

**Caller adaptation in RecipeDetailScreen:**
```js
// Before: const timerMins = parseTimerMins(step);           // returned number|null
// After:  const allTimers = parseTimerMins(step);            // returns number[]
//         const timerMins = allTimers.length > 0 ? allTimers[0] : null;
```

---

## 3. `buildRecipe` pattern — Extracted to shared utility

**New file:** `src/utils/recipeUtils.js` — exports `buildRecipeObject()`

| File | Before | After |
|------|--------|-------|
| `screens/EditRecipeScreen.js` | 13-line inline `buildRecipe()` with manual trim/split/parseInt | Delegates to `buildRecipeObject()` — 13 lines → 13 lines (pass-through args, but logic is now shared) |
| `screens/ScanRecipeScreen.js` | 9-line inline `buildRecipe()` with manual trim/split/parseInt | Delegates to `buildRecipeObject()` with field name mapping (`instructions` → `steps`, `prepTime` → `prepMinutes`) |

**`buildRecipeObject` handles:**
- `splitLines()` for ingredients and steps
- Comma-split + trim + filter for tags
- `parseInt || 0` for prep/cook minutes
- `parseInt || 1` for servings
- Optional fields (description, imageUrl, notes, collection) via spread conditionals

---

## Files Modified

| File | Change |
|------|--------|
| `src/utils/timerUtils.js` | Added `findAllTimers` export; `parseTimerMins` now delegates to it (decimal support added) |
| `src/utils/recipeUtils.js` | **New file** — shared `buildRecipeObject` helper |
| `src/screens/EditRecipeScreen.js` | Removed inline `splitLines` and `buildRecipe`; imports `buildRecipeObject` from `recipeUtils` |
| `src/screens/ScanRecipeScreen.js` | Removed inline `splitLines` and `buildRecipe`; imports `buildRecipeObject` from `recipeUtils` |
| `src/screens/RecipeDetailScreen.js` | Removed local `parseTimerMins`; imports from `timerUtils`; caller adapted for array return |
| `src/screens/CookModeScreen.js` | Removed local `findAllTimers` + `parseTimerMins` (42 lines); imports `findAllTimers` from `timerUtils` |

## Files Unchanged

- `src/components/GlobalTimerBar.js` — only uses `fmtClock`, no duplication
- `src/utils/splitLines.js` — canonical source, unchanged

---

## Lines Removed (approximate)

| Screen | Lines removed |
|--------|--------------|
| EditRecipeScreen.js | ~13 (inline splitLines + buildRecipe body) |
| ScanRecipeScreen.js | ~13 (inline splitLines + buildRecipe body) |
| RecipeDetailScreen.js | ~8 (local parseTimerMins) |
| CookModeScreen.js | ~42 (local findAllTimers + parseTimerMins) |
| **Total** | **~76 lines** |

Lines added: ~48 (recipeUtils.js) + ~19 (timerUtils.js findAllTimers) = ~67 net utility code, but concentrated in shared modules instead of scattered across 5 screens.
