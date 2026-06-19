# v1.1.3

Released: TBD

## Changes

### Setup
- Existing server users skip the rest of setup after entering server IP — if the server has recipes, the app goes straight to the home screen

### Server Sync
- Dietary profiles now sync to the Docker server in server mode
- Kitchen log (cookbook) entries now sync to the Docker server
- Kitchen log photos upload to server and persist across reinstalls
- Shopping list now syncs to the Docker server
- Favorites now sync to the Docker server
- Chat history now syncs to the Docker server
- Activity context now syncs to the Docker server
- Version badge in Settings now reads from app.json dynamically

### Data Management
- Data section in Settings now shows device-only or device+server descriptions based on mode
- "Delete All Data" clears server data too when in server mode
- resetApp() clears all server endpoints (shopping list, favorites, chat history, activity context)

### Previous (v1.1.2)
- Kitchen log, cooking streaks, and cook counts now sync to the Docker server
