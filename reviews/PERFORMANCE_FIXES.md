# Performance Fixes — Cegin Mobile

Three targeted optimizations to reduce initial bundle size, idle CPU usage, and unnecessary asset loading.

---

## 1. Lazy Screen Imports (`App.js`)

**Problem:** All 13 screens were eagerly imported at the top of `App.js`. Every screen's module (and its transitive dependencies — API clients, data modules, heavy components) was bundled into the initial JS bundle, even if the user never navigates to that screen.

**Fix:** Six less-frequently-used / heavier screens now use `React.lazy()` with dynamic `import()`:

| Screen | Reason |
|---|---|
| `AssistantScreen` | Large file (~1100 lines), AI chat, speech, animated GIFs |
| `TerryVisionScreen` | Camera/vision AI, heavy ML dependencies |
| `ScanRecipeScreen` | Camera + OCR pipeline |
| `MealPlannerScreen` | Complex calendar + recipe picker |
| `StatsScreen` | Charts, data aggregation |
| `CookbookScreen` | Image-heavy grid, swipeable rows |

Seven core screens remain eagerly imported (RecipeList, RecipeDetail, EditRecipe, Settings, CookMode, ShoppingList, Setup) since they're the primary navigation targets.

A `<Suspense>` boundary wraps the navigator with a themed loading spinner, so the first navigation to a lazy screen shows a brief loader instead of a blank screen.

**Files changed:** `mobile/App.js`

---

## 2. Conditional Timer Interval (`timerContext.js`)

**Problem:** A `setInterval` running every 500ms ticked continuously from app launch, even when zero timers were active. Each tick called `setTimers()` with a full object scan, causing unnecessary state reconciliation in the React tree.

**Fix:** Derived a `hasRunningTimers` memo from the timers state. The tick interval now:
- **Starts** only when at least one timer has `running: true` and an `endTime`
- **Stops** (via `clearInterval`) when all timers are paused, done, or cancelled
- **Restarts** automatically when a new timer starts (the `useMemo` dependency triggers the effect)

This eliminates the 500ms tick entirely during normal app usage (browsing recipes, editing, etc.) and only activates it when the user actually starts a cooking timer.

**Files changed:** `mobile/src/timerContext.js`

---

## 3. Lazy GIF Loading (`AssistantScreen.js`)

**Problem:** Three animated GIF assets (`terry-thinking.gif`, `terry-talking.gif`, `terry-idle.gif`) were loaded at module scope via top-level `require()`. While Metro bundles assets regardless, the module-level `require()` forces the asset module IDs to be resolved eagerly when the file is first imported, contributing to the initial module graph evaluation cost.

**Fix:** Replaced the three module-level `require()` constants with a lazy getter pattern (`getTerryGifs()`). The GIF assets are now resolved on first access — when `TerryAvatar` actually renders — rather than when `AssistantScreen.js` enters the module graph. A simple singleton cache (`_lazyGifs`) ensures the `require()` only executes once.

The four small PNG frames (`TERRY_FRAMES`) remain eagerly loaded since they're used in every message bubble avatar.

**Files changed:** `mobile/src/screens/AssistantScreen.js`

---

## Summary of Impact

| Optimization | Metric Improved |
|---|---|
| Lazy screen imports | Initial bundle size (6 screens deferred) |
| Conditional timer interval | Idle CPU / battery (500ms tick eliminated when no timers active) |
| Lazy GIF loading | Module evaluation cost (3 animated GIFs deferred until screen mounts) |
