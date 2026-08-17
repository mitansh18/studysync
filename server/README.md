# StudySync Server

Express backend for StudySync.

## Setup

```
npm install
```

Copy `.env.example` to `.env` and adjust if needed.

## Run

```
npm run dev
```

Starts on http://localhost:5000 with auto-reload. Use `npm start` for a plain run.

## Endpoints

| Method | Route         | Description                |
| ------ | ------------- | -------------------------- |
| GET    | `/api`        | API root                   |
| GET    | `/api/health` | Health check               |

Unknown routes return HTTP 404 as JSON.

## Structure

```
src/
├── app.js                 # Express app config (no listen)
├── server.js              # Startup / listen
├── routes/                # Route definitions
├── controllers/           # Request handlers
├── middleware/            # 404 + centralized error handler
├── models/                # (empty, future)
└── services/              # (empty, future)
prisma/                    # (empty, future)
```
