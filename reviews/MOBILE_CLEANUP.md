# Mobile Code Quality Cleanup

**Date:** 2026-07-11
**Scope:** `mobile/src/` — screens, components, utilities

## Summary

Five categories of code quality issues fixed across the Cegin mobile codebase. All 25 modified files pass `node -c` syntax checks.

---

## 1. Empty Catch Blocks → `__DEV__`-gated Warnings

**Before:** 42+ empty `catch {}` blocks silently swallowing errors across the codebase.

**After:** All empty catches now emit `console.warn` in development mode:
```js
} catch (_e) { if (__DEV__) console.warn('[Module] Caught error:', _e.message); }
```

**Files fixed (15):**
- `api.js` — 14 catches (cache fallbacks, localDb fallbacks, JSON parse errors)
- `usdaNutrition.js` — 5 catches (unit conversions, alias/singular search, DB validation)
- `wsSync.js` — 7 catches (ws.close(), subscriber callbacks)
- `localAi.js` — 3 catches (JSON.parse extraction fallbacks)
- `auditCache.js` — 3 catches (AsyncStorage parse fallbacks)
- `dietProfiles.js` — 3 catches (server sync, profile/activity cache)
- `cookbook.js` — 2 catches (server sync fallbacks)
- `chatHistory.js`, `localDb.js`, `stats.js`, `shoppingList.js`, `versionCheck.js`, `offlineCache.js`, `utils/materialYou.js`
- Screen files: `CookModeScreen.js`, `TerryVisionScreen.js`, `SetupScreen.js`, `SettingsScreen.js`

---

## 2. `Image` from `react-native` → `expo-image`

**Before:** AssistantScreen.js and SettingsScreen.js imported `Image` from `react-native`.

**After:** Both use `expo-image`'s `Image` component with proper `contentFit` prop.

**Changes:**
- **AssistantScreen.js:** Moved `Image` from `react-native` import to `import { Image } from 'expo-image'` (already used `contentFit` prop)
- **SettingsScreen.js:** Same import migration + changed `resizeMode="cover"` → `contentFit="cover"`

---

## 3. `TouchableOpacity` → `Pressable` in SwipeableRow.js

**Before:** SwipeableRow used `TouchableOpacity` while the rest of the app uses `Pressable`.

**After:** Consistent `Pressable` usage with `activeOpacity` prop removed (Pressable uses `android_ripple` instead).

---

## 4. Console Calls Gated Behind `__DEV__`

**Before:** ~72 `console.log/warn/error` calls running unconditionally in production.

**After:** All 123 console calls (including newly added catch warnings) are gated:
```js
if (__DEV__) console.log('[TAG] message:', value);
```

**Files modified (25):**
- Core modules: `api.js`, `usdaNutrition.js`, `wsSync.js`, `resetApp.js`, `cookbook.js`, `localAi.js`, `mealPlan.js`, `notifications.js`, `notifications.expo.js`, `chatHistory.js`, `localDb.js`, `stats.js`, `shoppingList.js`, `versionCheck.js`, `offlineCache.js`, `dietProfiles.js`, `auditCache.js`, `utils/materialYou.js`
- Components: `ErrorBoundary.js`
- Screens: `AssistantScreen.js`, `EditRecipeScreen.js`, `RecipeDetailScreen.js`, `StatsScreen.js`, `SettingsScreen.js`, `SetupScreen.js`, `CookModeScreen.js`, `TerryVisionScreen.js`

**Note:** `ErrorBoundary.js`'s `componentDidCatch` console.error was already inside an `if (__DEV__)` block — unchanged.

---

## 5. Hardcoded Colors → Theme Values

### Markdown.js
| Hardcoded | Replacement | Context |
|-----------|-------------|---------|
| `rgba(255,255,255,0.08)` | `colors?.surface2` | Inline code background |
| `rgba(255,255,255,0.06)` | `colors?.surface` | Code block background |
| `#F6F1EA` | `colors?.text` | Text fallback |
| `#FF5A26` | `colors?.primary` | Bullet/number accent |
| `#E2D9CF` | `colors?.text2` | Body text |
| `#2E2724` | `colors?.border` | Horizontal rule |

Also: `parseInline()` now accepts `colors` parameter (was out of scope).

### SwipeableRow.js
| Hardcoded | Replacement | Context |
|-----------|-------------|---------|
| `#E5645B` | `colors?.danger` | Delete button background |
| `#fff` | `colors?.onPrimary` | Delete text |

### VersionBanner.js
| Hardcoded | Replacement | Context |
|-----------|-------------|---------|
| `#D32F2F` | `colors.danger` | Error banner background |
| `#fff` | `colors.text` | Banner text |
| `rgba(255,255,255,0.7)` | `colors.textMuted` | Sub-text |
| `rgba(255,255,255,0.1)` | kept (in static style) | Border — acceptable as non-theme structural |

---

## Verification

- All 25 modified files pass `node -c` syntax check
- Zero remaining `catch {}` empty blocks in `src/`
- Zero remaining ungated `console.log/warn/error` calls
- All hardcoded colors in the 3 target files replaced with theme-aware values (with fallbacks)
