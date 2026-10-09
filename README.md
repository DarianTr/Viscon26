# Viscon26

Next.js 16 app (App Router, TypeScript, Tailwind v4) holding both the frontend
and the backend.

## Run it

```bash
npm install
npm run dev     # http://localhost:3000
```

Other scripts: `npm run build`, `npm start`, `npm run lint`.

## Layout

```
src/
  app/
    page.tsx              frontend — landing page
    layout.tsx            root layout (fonts, metadata)
    globals.css           Tailwind entry + theme tokens
    api/
      health/route.ts     GET  /api/health
      items/route.ts      GET, POST  /api/items
      items/[id]/route.ts GET, PATCH, DELETE  /api/items/:id
  components/
    items-panel.tsx       client component, talks to the API
  lib/
    store.ts              data layer (in-memory — swap for a real DB)
    http.ts               shared error handling for route handlers
    api-client.ts         typed fetch wrapper used by the frontend
    types.ts              types shared by both sides
```

## API

| Method | Path             | Body                      | Response          |
| ------ | ---------------- | ------------------------- | ----------------- |
| GET    | `/api/health`    | –                         | `{ status, … }`   |
| GET    | `/api/items`     | –                         | `{ items: [] }`   |
| POST   | `/api/items`     | `{ title }`               | `201 { item }`    |
| GET    | `/api/items/:id` | –                         | `{ item }`        |
| PATCH  | `/api/items/:id` | `{ title?, done? }`       | `{ item }`        |
| DELETE | `/api/items/:id` | –                         | `204`             |

Errors are always `{ error: string, details?: unknown }` — 400 on invalid
input, 404 on a missing item, 500 otherwise.

```bash
curl localhost:3000/api/items
curl -X POST localhost:3000/api/items -H 'content-type: application/json' -d '{"title":"ship it"}'
```

## Adding to it

- **New page**: `src/app/<route>/page.tsx`.
- **New endpoint**: `src/app/api/<route>/route.ts` exporting `GET`/`POST`/… .
  Wrap the body in `handle()` from `@/lib/http` and validate input with zod.
- **Real database**: replace the bodies in `src/lib/store.ts` — every function
  there is already async, so nothing else has to change. Put credentials in
  `.env.local` (see `.env.example`).

Note: the in-memory store resets whenever the server restarts.

This project runs Next.js 16, which differs from older versions in places.
Version-matched docs ship with the install at `node_modules/next/dist/docs/`.
