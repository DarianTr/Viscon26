# Viscon26

Next.js 16 app (App Router, TypeScript, Tailwind v4) holding both the frontend
and the backend.

## Run it

Needs Docker (for the local Postgres) and Node 20+.

```bash
npm install
cp .env.example .env.local
# Starts Postgres, applies migrations, and loads demo data
npm run db:setup
npm run dev
```

Log in as `tprazak` with password `stride` (an admin), or as any other seeded
handle with the same password. `/signup` creates new accounts.
Open http://localhost:3000.

Other scripts: `npm run build`, `npm start`, `npm run lint`.

## Run everything in Docker

One command builds the app and starts it with its database. Docker is the
only requirement:

```bash
docker compose up --build
```

To run it in the background instead, use `npm run docker:up`.

Then open http://localhost:3000. On first start it creates the tables and
loads the demo data. Later starts keep your data, because the seed only runs
on an empty database. Stop with `docker compose down`. Add `-v` to also delete
the data.

| Variable            | Default   | Purpose                                     |
| ------------------- | --------- | ------------------------------------------- |
| `APP_PORT`          | `3000`    | Port the app is published on                |
| `DB_PORT`           | `5432`    | Port Postgres is published on (localhost)   |
| `POSTGRES_PASSWORD` | `stride`  | Database password: change it on a server    |
| `SEED_DEMO_DATA`    | `true`    | `false` to start with an empty database     |
| `DEMO_USER_HANDLE`  | `tprazak` | Seeded admin user                           |
| `DEMO_PASSWORD`     | `stride`  | Password of every seeded user               |
| `KNOWLEDGE_PORT`    | `8000`    | Port the knowledge service is published on (localhost) |

Set them inline (`APP_PORT=8080 docker compose up --build`) or in a `.env`
file next to `docker-compose.yml`.

**CI/CD:** every push runs lint, typecheck and build in GitHub Actions, and
merging to `main` deploys to the VisCon VM. Setup is in
[`deploy/README.md`](deploy/README.md).

The same `Dockerfile` works on any host that builds from a repo, such as
Railway, Render or Fly.io. There, use a managed Postgres, set `DATABASE_URL`,
and run `npx drizzle-kit migrate` once (the image's `migrate` stage does this).

## Database

Postgres via [Drizzle ORM](https://orm.drizzle.team) and the `postgres` driver.

| Script                | What it does                                              |
| --------------------- | --------------------------------------------------------- |
| `npm run db:up`       | Start only Postgres in Docker, for `npm run dev`          |
| `npm run db:down`     | Stop it (data persists in a Docker volume)                |
| `npm run db:migrate`  | Apply migrations in `drizzle/`                            |
| `npm run db:seed`     | **Wipe** all tables and load demo data                    |
| `npm run db:set-password -- <handle> <pw> [--admin]` | Set a password, optionally make the user an admin |
| `npm run db:generate` | Write a new migration after editing `src/db/schema.ts`    |
| `npm run db:studio`   | Browse the data in Drizzle Studio                         |

To change the schema: edit `src/db/schema.ts`, run `db:generate`, review the
SQL it writes to `drizzle/`, then `db:migrate`. Commit the migration files.

The streak, weekly hours, totals, leaderboard and kudos counts are all
computed from rows (mainly `sessions`), never stored. A session is a plan
entry until `completed_at` is set; then it is an activity in the feed.
"Today" and "this week" are evaluated in `Europe/Zurich`.

## Auth and admin

Users log in at `/login` with their handle and password (or sign up at
`/signup`). Passwords are hashed with scrypt (`src/db/password.ts`). A login
creates a row in `auth_sessions` and an httpOnly cookie holding a random
token; only the token's SHA-256 is stored. Sessions last 30 days, and logging
out (on the Profile tab) deletes the row. `src/lib/auth.ts` has the helpers:
`getSessionUser()`, `requireUser()` and `requireAdmin()`.

- Pages call `getCurrentUser()`, which redirects to `/login` without a session.
- Every API route wrapped in `handle()` answers `401` without a session
  (`/api/health` stays public).
- The cookie is `Secure` in production, so serve the app over HTTPS there.

**Admin interface** at `/admin`, for users with `users.is_admin = true` (others
get a 404; admins see an "Admin" button on their profile):

- Browse any table, 50 rows per page.
- Insert, edit and delete rows. Values are edited as text and Postgres casts
  them to the column type, so write arrays as `{1,2}` and timestamps as
  `2026-10-12 09:00+02`. Tick "null" to store NULL. When inserting, blank
  fields get the column default.
- A SQL console that runs any statement directly. There's no undo.

To make someone an admin on a database that wasn't seeded, run
`npm run db:set-password -- <handle> <password> --admin`. In Docker:
`docker compose run --rm migrate npx tsx src/db/set-password.ts <handle> <password> --admin`.

For production, point `DATABASE_URL` at any hosted Postgres (Neon, Supabase,
RDS, …) and run `npm run db:migrate` against it. `next build` doesn't need a
database.

## Layout

```
src/
  app/
    (tabs)/               the five app tabs, sharing one shell
      layout.tsx          sidebar (desktop) + bottom tab bar (mobile)
      page.tsx            /           Today's tasks + focus timer
      plans/page.tsx      /plans      active training plan, plan catalogue
      calendar/page.tsx   /calendar   month view + day agenda
      community/page.tsx  /community  feed, your activities, leaderboard, friends and requests
      profile/page.tsx    /profile    stats, subjects, achievements, your posts
      profile/settings/   /profile/settings  edit profile, change password, delete account
    (auth)/               /login, /signup and their server actions (+ logout)
    admin/                /admin: table browser, row editor, SQL console
    layout.tsx            root layout (fonts, metadata, viewport)
    manifest.ts           web app manifest (installable on phones)
    globals.css           Tailwind entry + theme tokens (light/dark)
    api/
      health/route.ts     GET  /api/health
      items/route.ts      GET, POST  /api/items
      items/[id]/route.ts GET, PATCH, DELETE  /api/items/:id
      users/              CRUD  /api/users, /api/users/:id (+ /friend)
      tasks/              CRUD  /api/tasks, /api/tasks/:id (+ /kudos, /comments)
      people/route.ts     GET  /api/people  friend search
  db/
    schema.ts             tables (Drizzle) — source of truth for migrations
    index.ts              database client
    seed.ts               demo data
    password.ts           scrypt hashing (shared with the seed script)
    set-password.ts       CLI: set a password / make an admin
  components/
    tab-bar.tsx           tab navigation (bottom bar + sidebar)
    icons.tsx             inline SVG icon set
    ui/primitives.tsx     Card, Avatar, Ring, headers
    today/, community/, calendar-view.tsx   interactive tab pieces
    items-panel.tsx       example client component for the items API
  lib/
    auth.ts               sessions: login cookie, requireUser, requireAdmin
    admin.ts              generic table access for /admin
    queries.ts            reads for the pages (server-only)
    users.ts, tasks.ts    CRUD data layer for /api/users and /api/tasks
    mutations.ts          kudos, friends, comments (server-only)
    session-types.ts      session type labels/colours, formatting helpers
    store.ts              data layer for /api/items
    http.ts               shared error handling for route handlers
    api-client.ts         typed fetch wrapper used by the frontend
    types.ts              types shared by both sides
```

## API

| Method | Path             | Body                      | Response          |
| ------ | ---------------- | ------------------------- | ----------------- |
| GET    | `/api/health`    | –                         | `{ status, database, … }` (503 if the DB is down) |
| GET    | `/api/items`     | –                         | `{ items: [] }`   |
| POST   | `/api/items`     | `{ title }`               | `201 { item }`    |
| GET    | `/api/items/:id` | –                         | `{ item }`        |
| PATCH  | `/api/items/:id` | `{ title?, done? }`       | `{ item }`        |
| DELETE | `/api/items/:id` | –                         | `204`             |
| PUT / DELETE | `/api/tasks/:id/kudos` | –             | `204`             |
| GET    | `/api/tasks/:id/comments` | –                | `{ comments: [] }` |
| POST   | `/api/tasks/:id/comments` | `{ body }`       | `201 { comment }` |
| DELETE | `/api/tasks/:id/comments/:commentId` | –     | `204`             |
| POST   | `/api/tasks/:id/photos` | multipart `photo`  | `201 { photo }`   |
| DELETE | `/api/tasks/:id/photos/:photoId` | –         | `204`             |
| GET    | `/api/photos/:id` | –                        | the image         |
| PUT    | `/api/tasks/:id/tags` | `{ userIds }`        | `204`             |
| GET    | `/api/people?q=` | – (no `q`: friends and pending requests) | `{ people: [] }`  |
| PUT / DELETE | `/api/users/:id/friend` | –            | `{ status }`      |

Friendships are mutual: `PUT /api/users/:id/friend` sends a request (or
accepts theirs, if they asked first) and the other person has to accept before
you're friends. `DELETE` cancels, declines or unfriends. Each person in
`/api/people` has a `status`: `none`, `sent`, `received` or `friends`.

Only friends see each other's shared activities and leaderboard hours. Kudos
and comments work on activities you can see in your feed: your own, or shared
ones by friends. You can delete your own comments and any comment on your own
activities.

On your own completed sessions you can add up to 4 photos (JPEG, PNG or WebP,
at most 5 MB each; the app shrinks them before uploading) and tag up to 10
friends you studied with. Photos are stored in Postgres and served only to
people who can see the activity.

### Users and tasks

Full CRUD. A **task** is one row of the `sessions` table: a planned study
session, lecture or exam. It counts as done once `completedAt` is set.

| Method | Path              | Body / query                                                    | Response        |
| ------ | ----------------- | --------------------------------------------------------------- | --------------- |
| GET    | `/api/users`      | `?q=&limit=&offset=` (`q` searches name and handle)             | `{ users: [] }` |
| POST   | `/api/users`      | `{ handle, name, hue?, program?, weeklyGoalHours? }`            | `201 { user }`  |
| GET    | `/api/users/:id`  | –                                                               | `{ user }`      |
| PATCH  | `/api/users/:id`  | any of the POST fields                                          | `{ user }`      |
| DELETE | `/api/users/:id`  | – (also deletes their tasks, kudos, friendships)                    | `204`           |
| GET    | `/api/tasks`      | `?userId=&type=&done=&from=&to=&limit=&offset=`                 | `{ tasks: [] }` |
| POST   | `/api/tasks`      | `{ type, subject, title, scheduledAt, plannedMinutes, userId?, planId?, detail?, location?, note?, shared? }` | `201 { task }` |
| GET    | `/api/tasks/:id`  | –                                                               | `{ task }`      |
| PATCH  | `/api/tasks/:id`  | any POST field except `userId`, plus `done`, `actualMinutes`, `focus` | `{ task }` |
| DELETE | `/api/tasks/:id`  | –                                                               | `204`           |

- `type` is one of `deep`, `intervals`, `tempo`, `recovery`, `lecture`, `exam`.
- `scheduledAt`, `from` and `to` are ISO timestamps with an offset, e.g.
  `2026-10-12T09:00:00+02:00`. Lists are sorted by `scheduledAt`, with
  `limit` ≤ 500 (default 100).
- `PATCH { done: true }` marks a task complete; `actualMinutes` defaults to
  `plannedMinutes`. `{ done: false }` clears the completion.
- `POST /api/tasks` without `userId` creates the task for the current user.

With curl, pass the `session` cookie from a logged-in browser (DevTools →
Application → Cookies):

```bash
S='session=<value>'
curl -b $S 'localhost:3000/api/users?q=lena'
curl -b $S -X POST localhost:3000/api/tasks -H 'content-type: application/json' \
  -d '{"type":"deep","subject":"DiskMath","title":"Long block","scheduledAt":"2026-10-12T09:00:00+02:00","plannedMinutes":90}'
curl -b $S -X PATCH localhost:3000/api/tasks/<id> -H 'content-type: application/json' -d '{"done":true}'
```

Every endpoint except `/api/health` needs a login session (the cookie set by
`/login`) and returns `401` otherwise. There are no ownership checks yet: any
logged-in user can read or change any user or task. Add those before going
public.

Errors are always `{ error: string, details?: unknown }`: 400 on invalid
input or a reference to a missing record (e.g. an unknown `userId`), 404 on a
missing resource, 409 on a duplicate (e.g. a taken `handle`), 500 otherwise.

```bash
curl -b $S localhost:3000/api/items
curl -b $S -X POST localhost:3000/api/items -H 'content-type: application/json' -d '{"title":"ship it"}'
```

## Knowledge service

`services/knowledge/` is a separate Python service (FastAPI + NumPy/SciPy)
that estimates each learner's level on every topic from logged scores, with
uncertainty. It uses a multivariate Kalman filter with a decaying learning
trend, and MAP fits the noise of each assessment type. It shares the
Postgres database but keeps its tables in its own `knowledge` schema, so
Drizzle never sees them. `docker compose up` starts it. The app reaches it at
`KNOWLEDGE_URL`.

```bash
npm run db:up
cd services/knowledge
uv sync
DATABASE_URL=postgres://stride:stride@localhost:5432/stride uv run uvicorn knowledge.api:app --reload
# http://localhost:8000/docs for the interactive API
```

The model, API and tests are described in
[`services/knowledge/README.md`](services/knowledge/README.md).

## Adding to it

- **New page**: `src/app/<route>/page.tsx`.
- **New endpoint**: `src/app/api/<route>/route.ts` exporting `GET`/`POST`/… .
  Wrap the body in `handle()` from `@/lib/http` and validate input with zod.
- **New table**: add it to `src/db/schema.ts`, then `npm run db:generate` and
  `npm run db:migrate`. Reads go in `src/lib/queries.ts`, writes in
  `src/lib/mutations.ts`.

This project runs Next.js 16, which differs from older versions in places.
Version-matched docs ship with the install at `node_modules/next/dist/docs/`.
