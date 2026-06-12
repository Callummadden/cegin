# Recipe App

A personal recipe collection: a React Native (Expo) mobile app that talks to a
Dockerized Express + SQLite server on your local network.

```
recipe-app/
├── server/   # Express + SQLite REST API, runs in Docker
└── mobile/   # Expo (React Native) app
```

## Server

```bash
cd server
docker compose up -d --build
```

Listens on port 3000. Recipes are stored in SQLite on the `recipe-data` Docker
volume, so they survive rebuilds. The container restarts automatically unless
stopped.

### API

| Method | Path                        | Description                          |
| ------ | --------------------------- | ------------------------------------ |
| GET    | `/api/health`               | Health check                         |
| GET    | `/api/recipes?search=q`     | List recipes, optional search        |
| GET    | `/api/recipes/:id`          | Get one recipe                       |
| POST   | `/api/recipes`              | Create (requires `title`)            |
| PUT    | `/api/recipes/:id`          | Update (partial updates OK)          |
| DELETE | `/api/recipes/:id`          | Delete                               |

Recipe shape: `title`, `description`, `ingredients` (array), `steps` (array),
`tags` (array), `prep_minutes`, `cook_minutes`, `servings`.

## Mobile app

```bash
cd mobile
npx expo start
```

Install **Expo Go** on your phone (App Store / Play Store), make sure the phone
is on the same Wi-Fi as this machine, then scan the QR code that `expo start`
prints.

First run: tap the ⚙️ icon (top right) → enter the server URL
(`http://192.168.1.205:3000` for this machine) → **Save & test connection**.

## Notes

- The phone talks straight to the server over the LAN, so both the Expo dev
  server and port 3000 must be reachable — open them in the firewall if your
  phone can't connect.
- To back up recipes: `docker run --rm -v server_recipe-data:/data -v "$PWD":/backup alpine cp /data/recipes.db /backup/`
