# v1.2.2

Released: June 20, 2026

## Terry Vision
- Multi-photo support: scan multiple fridges, cupboards, or freezers per section
- Photos display in a horizontal scroll with camera/gallery buttons on the left
- Auto-remove photos when AI can't identify any items (with red error toast)
- "FROM YOUR RECIPES" — matches scanned ingredients against your saved recipes (top 3, expandable)
- "TERRY SUGGESTS" — AI-generated recipe ideas with "GENERATE MORE" button for fresh suggestions
- Match scores show how many of the recipe's ingredients you have (e.g. 5/7)

## Recipes
- New "URL" vs "MANUAL" mode when adding recipes — URL import shows dedicated input first, form appears after import with "MAKE EDITS" header
- Renamed "SCAN PHOTO" to "SCAN RECIPE" in add recipe menu

## Fixes
- Fixed Terry Vision camera crash (ActivityResultLauncher error on Android)
- Fixed URL import missing from new recipe screen
- Toast component now supports custom text color and duration
- Fixed hook ordering crash in TerryVisionScreen
