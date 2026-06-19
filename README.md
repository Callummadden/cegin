Cegin
A personal recipe app with an AI cooking assistant named Chef Terry.
[![Docker Image](https://img.shields.io/badge/docker-pull-blue.svg?logo=docker)](https://hub.docker.com/r/callum2254/cegin)
* **Store, search, and organize** your recipes
* **Import recipes** from any URL
* **Plan meals**, build smart shopping lists, scale ingredients, convert units
* **Chef Terry** — chat with an AI chef, get recipe suggestions, fix mistakes mid-cook, adjust cooking times on the fly
* **Terry Vision** — scan your fridge/pantry with your camera, get recipe suggestions from what you have
* **Push notifications** — proactive morning meal prep reminders and perishable ingredient alerts
* **Works offline** — Run everything on your phone (local mode) or against a self-hosted server
### Built with:
* **Server:** Node.js + Express + SQLite (Dockerized, ~376MB image)
* **Mobile:** Expo SDK 56 (React Native)
---
## Quick Start
### 1. Server (Docker)
```bash
cd server
cp .env.example .env
# Edit .env — set your provider type, base URL, and model name
```
Set up secrets (API keys and JWT secret — never in .env):
```bash
mkdir -p secrets && chmod 700 secrets
echo "sk-your-text-key"        > secrets/TEXT_API_KEY
echo "AIza-your-vision-key"    > secrets/VISION_API_KEY
echo "a-long-random-string"    > secrets/JWT_SECRET
chmod 600 secrets/*
```
Start the server:
```bash
docker compose up -d --build
```
The server will be available at http://YOUR_LAN_IP:3000 (binds to 0.0.0.0).
#### Minimum .env for AI features:
```env
TEXT_PROVIDER=openai-compatible
TEXT_BASE_URL=[https://api.deepseek.com/v1](https://api.deepseek.com/v1)
TEXT_MODEL=deepseek-v4-flash
```
> **Note:** The API key goes in secrets/TEXT_API_KEY, not in .env.
> 
#### Optional — vision (fridge scanning, photo import):
```env
VISION_PROVIDER=gemini
VISION_MODEL=gemini-2.5-flash
```
> **Note:** Vision key goes in secrets/VISION_API_KEY.
> 
### 2. Mobile App
 * **For users:** install the APK on your Android phone, then enter your server address in Settings.
 * **For development:**
```bash
  cd mobile
  npx expo start
```
 * Scan the QR code in Expo Go for quick testing
 * For push notifications and full native features, build a dev client or APK
> **Important:** Phone and server must be on the same Wi-Fi. The phone talks directly to your Docker container over LAN. No cloud.
> 
## Two Ways to Run
### Server Mode (recommended)
 * Central recipes + server-side AI
 * Works across multiple devices
 * Auth, collections, multi-image support
 * Push notifications (APK builds only)
### Local Mode (zero server)
 * Everything stored in SQLite on your phone
 * AI calls go directly from the device using keys you paste in Settings
 * Keys stored in OS secure storage (Android Keystore / iOS Keychain)
 * Great for testing or when you don't want to run Docker
> Switch modes anytime from Settings.
> 
## Chef Terry
Terry is a context-aware AI cooking assistant with personality. He knows your recipes, meal plan, shopping list, dietary profiles, and cooking history.
 * **Chat** — ask about recipes, get suggestions, convert units, troubleshoot cooking problems
 * **Mid-cook panic** — *"Something went wrong at step 3"* and Terry recalculates on the fly
 * **Meal planning** — AI-powered weekly meal plans based on your saved recipes and dietary needs
 * **Terry Vision** — snap a photo of your fridge, Terry identifies ingredients and suggests recipes
### Push notifications (dev builds):
 * **Morning Digest** — 8:00 AM, Terry tells you what's for dinner and what to prep
 * **Perishable Alerts** — every 6 hours, warns about expiring scanned items
## AI Providers
You're not locked into any provider. Change TEXT_BASE_URL and TEXT_MODEL in .env:

| Provider | Base URL | Example Model |
| :--- | :--- | :--- |
| **DeepSeek** | https://api.deepseek.com/v1 | deepseek-chat |
| **Groq** | https://api.groq.com/openai/v1 | llama-3.1-70b-versatile |
| **OpenAI** | https://api.openai.com/v1 | gpt-4o-mini |
| **OpenRouter** | https://openrouter.ai/api/v1 | anthropic/claude-sonnet-4 |
| **Ollama (local)** | http://host.docker.internal:11434/v1 | llama3.1 |

 * Vision can be configured independently (e.g. Gemini for vision, local model for chat).
 * The mobile app also supports **Custom AI Providers** (Settings → AI PROVIDERS) for direct device-to-provider calls, bypassing the server keys.
## Security
### Server (Docker)
 * API keys and JWT secret stored as Docker Compose secrets — mounted at /run/secrets/
 * Never visible via docker inspect, docker exec env, or image layers
 * secrets/ is in .gitignore and .dockerignore
 * Container runs as non-root user
 * Resource limits: 512MB RAM, 1 CPU
### Mobile (Local Mode)
 * API keys in expo-secure-store (Android Keystore / iOS Keychain)
 * Hardware-backed AES-256 encryption at rest
 * In Expo Go, falls back to AsyncStorage (unencrypted)
## Backups & Data
Recipes are in a plain SQLite file on a Docker volume.
```bash
# Backup
docker run --rm -v cegin-data:/data -v "$PWD":/backup \
  alpine cp /data/recipes.db /backup/recipes.db.bak
# Restore — reverse the cp direction
```
 * **Local mode:** data lives in the phone's SQLite (backed up with normal phone backups).
## Project Structure
```text
cegin/
├── server/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── .env.example
│   ├── index.js          # Express API (routes, auth, endpoints)
│   ├── db.js             # SQLite schema + CRUD (recipes, meals, scans, tokens)
│   ├── ai.js             # AI provider integration (DeepSeek, Gemini, etc.)
│   ├── auth.js           # JWT auth + password hashing
│   ├── notifications.js  # Expo Push notification sender
│   ├── cron.js           # Scheduled jobs (morning digest, perishable alerts)
│   └── secrets.js        # Secret loading (Docker secrets > ./secrets/ > env vars)
├── mobile/
│   ├── App.js
│   └── src/
│       ├── api.js              # Server API client + offline cache
│       ├── mealPlan.js         # Meal planner (syncs to server)
│       ├── notifications.js    # Push notification registration
│       ├── offlineCache.js     # Offline-first recipe cache
│       ├── localAi.js          # Local mode AI providers
│       ├── config.js           # Key storage (secure store)
│       └── screens/
│           ├── AssistantScreen.js    # Chef Terry chat
│           ├── TerryVisionScreen.js  # Fridge scanning
│           ├── MealPlannerScreen.js  # Weekly meal planning
│           ├── CookModeScreen.js     # Step-by-step cooking
│           ├── ShoppingListScreen.js
│           ├── RecipeListScreen.js
│           ├── RecipeDetailScreen.js
│           ├── EditRecipeScreen.js
│           ├── SettingsScreen.js
│           ├── CookbookScreen.js
│           ├── StatsScreen.js
│           └── SetupScreen.js
├── docs/                 # cegin.kitchen landing page (GitHub Pages)
├── LICENSE
└── README.md
```
## Development
### Server (Docker — recommended)
```bash
cd server
docker compose up --build
```
### Server (without Docker)
```bash
cd server
npm install
node index.js
```
### Mobile
```bash
cd mobile
npx expo start           # Expo Go for quick dev testing
```
For production builds (APK):
```bash
npx expo run:android     # Build and run on connected device
```
*Push notifications require a native build — they don't work in Expo Go. Start Metro for Expo Go with:*
```bash
EXPO_GO=1 npx expo start
```
*(This blocks expo-notifications from the bundle to prevent SDK 53+ crashes).*
## Common Issues
 * **Can't reach server from phone:** use the machine's LAN IP, not localhost. Check firewall.
 * **AI not working:** check TEXT_* / VISION_* in .env and that secrets/ files exist. Test at /api/health and /api/ai/status.
 * **Database disappears:** make sure the cegin-data Docker volume exists.
 * **Secrets not loading:** check ls -la secrets/ — files need mode 600.
 * **After changing .env or Dockerfile:** use docker compose up -d --build.
 * **better-sqlite3 build errors:** docker compose build --no-cache.
## License
MIT — see LICENSE.
Enjoy cooking with Terry. 🐱
```
```
