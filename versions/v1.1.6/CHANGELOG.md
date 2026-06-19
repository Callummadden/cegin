# v1.1.6

Released: June 19, 2026

## Performance
- Reduced memory usage by ~35% (screens now unmount when navigated away)
- Image memory cache cleared on screen transitions and app backgrounding
- Stats, recipes, and cookbook load from cache instantly (no blank screens)
- Recipes page renders cached data on mount before fetching fresh data
- Removed unused google-signin dependency (-12MB bundle)

## Server
- Added image proxy with on-the-fly resizing (sharp)
- Added try/catch to meal-plan/sync endpoint (was returning silent 500)
- Bumped body limit for cookbook endpoints (image uploads)
- Hardened syncMealPlan against malformed data
- Stats cached to AsyncStorage for instant loads

## Fixes
- Fixed meal plan sync 500 errors
- Fixed 413 errors when uploading cookbook photos
- Fixed server cache not clearing when switching between servers
- Fixed stats not loading from local cache
