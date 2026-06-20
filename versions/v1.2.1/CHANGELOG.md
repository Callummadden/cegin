# v1.2.1

Released: June 20, 2026

## Scan Recipe — Vision AI
- Added "Clean & Fix with Terry" button on Scan Recipe screen
- Sends the photo to your configured vision AI to extract recipe fields
- Auto-fills title, ingredients, instructions, time, servings, and tags
- Privacy note shown: photo is shared with your configured vision AI
- New server endpoint: POST /api/ai/scan-recipe

## Improvements
- Image URL text field replaced with Camera/Gallery buttons on manual recipe page
- "Clean up with AI" renamed to "Clean up with Terry"
- Help buttons (?) on Manual and Scan screens explain each section
- HISTORY button moved to far right in Terry chat header

## Fixes
- Fixed cookbook entries duplicating in server mode — was double-writing to local cache and WebSocket refresh
- Fixed delete/update cookbook entries also double-writing to cache
- Fixed scan recipe crashing app on startup — ML Kit native module now lazy-loaded
- Fixed expo-file-system deprecation error — switched to expo-image-manipulator base64
