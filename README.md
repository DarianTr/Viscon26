# Viscon26

👉 [Read the full, illustrated introdcution of this post](https://claude.ai/artifact/ExHNL8u1auEETgo8epHxVR)

Next.js 16 app (App Router, TypeScript, Tailwind v4) holding both the frontend
and the backend.

## Run it

Needs Docker (for the local Postgres) and Node 20+.

```bash
npm install
cp .env.example .env.local   # then set DEV_USER_ID to your email
# Starts Postgres, applies migrations, and creates the admin account
npm run db:setup
npm run dev
```

Open http://localhost:3000. You're logged in as `DEV_USER_ID`; on the first
visit you sign up with it. See [Logging in locally](#logging-in-locally).

Other scripts: `npm run build`, `npm start`, `npm run lint`.

## Run everything in Docker

One command builds the app and starts it with its database and the
knowledge service (grade forecasts; see [below](#knowledge-service)). Docker
is the only requirement:

```bash
docker compose up --build
```

To run it in the background instead, use `npm run docker:up`.

Then open http://localhost:3000. On first start it creates the tables and
the admin account; there is no demo data. Later starts keep your data. Stop
with `docker compose down`. Add `-v` to also delete
the data.

| Variable            | Default   | Purpose                                     |
| ------------------- | --------- | ------------------------------------------- |
| `APP_PORT`          | `3000`    | Port the app is published on                |
| `DB_PORT`           | `5432`    | Port Postgres is published on (localhost)   |
| `POSTGRES_PASSWORD` | `stride`  | Database password: change it on a server    |
| `ADMIN_HANDLE`      | `admin`   | Handle of the seeded admin                  |
| `ADMIN_EMAIL`       | `tprazak@ethz.ch` | Email (X-User-Id) that logs in as the admin |
| `ADMIN_NAME`        | `Admin`   | Name of the seeded admin                    |
| `DEV_USER_ID`, `DEV_USER_NAME` | – | Stand-in login without the proxy; never set on the VM |
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
| `npm run db:seed`     | Create the admin account if it doesn't exist              |
| `npm run db:reset`    | **Wipe** everything, migrate, refetch courses (VVZ), create the admin |
| `npm run db:generate` | Write a new migration after editing `src/db/schema.ts`    |
| `npm run db:studio`   | Browse the data in Drizzle Studio                         |

To change the schema: edit `src/db/schema.ts`, run `db:generate`, review the
SQL it writes to `drizzle/`, then `db:migrate`. Commit the migration files.

The streak, weekly hours, totals, leaderboard and kudos counts are all
computed from rows (mainly `sessions`), never stored. A session is a plan
entry until `completed_at` is set; then it is an activity in the feed.
"Today" and "this week" are evaluated in `Europe/Zurich`.

## Auth and admin

The app has no login of its own. The VIScon reverse proxy logs users in and
adds two headers to every request it forwards:

```
Browser ──HTTPS──► VIScon reverse proxy ──HTTP + headers──► app (VM :8080)
                   (ETH / edu-ID login)    X-User-Id:   jdoe@ethz.ch
                                           X-User-Name: J%C3%B6rg%20Doe
```

`src/lib/auth.ts` reads them on every request (no cookies, no tokens) and
matches `X-User-Id` against `users.email`:

- Known email → that user. `getSessionUser()`, `requireUser()`,
  `requireAdmin()` and the pages' `getCurrentUser()` all build on this.
- Unknown email → pages redirect to `/signup`, prefilled with a handle from
  the email (`jdoe@ethz.ch` → `jdoe`, or `jdoe2` if taken) and the decoded
  name. Submitting creates the `users` row with that email.
- Every API route wrapped in `handle()` answers `401` without a profile
  (`/api/health` stays public).

The headers can only be trusted while the app is reachable through the proxy
alone: don't open its port in `ufw` or set access control to "Disabled".

To hand an existing account (e.g. one made before the proxy login) to someone,
set its `email` to their X-User-Id in `/admin/users`.

### Logging in locally

There's no proxy on your machine, so when a request has no `X-User-Id`,
`DEV_USER_ID` and `DEV_USER_NAME` from `.env.local` stand in for the headers:

```bash
DEV_USER_ID=jdoe@ethz.ch
DEV_USER_NAME=Jörg Doe
```

Which account that is:

- **Your own:** an email without an account gets the signup page on the first
  visit, which creates one. To make it an admin:
  `update users set is_admin = true where handle = '<handle>';`
- **The admin:** `npm run db:seed` creates `@admin` for `tprazak@ethz.ch`
  (or `ADMIN_HANDLE`, `ADMIN_EMAIL`, `ADMIN_NAME` from `.env.local`). Set
  `DEV_USER_ID` to that email to log in as them.
- **An existing account:** link it once in the database:

  ```bash
  docker compose exec db psql -U stride stride \
    -c "update users set email = 'jdoe@ethz.ch' where handle = '<handle>';"
  ```

There's no logout: on the VM the proxy owns the login, and locally you switch
users by changing `DEV_USER_ID` and restarting `npm run dev`. Or send the
header for a single request; a real header always wins over `DEV_USER_ID`:

```bash
curl -H 'X-User-Id: someone@ethz.ch' localhost:3000/signup
```

Never set `DEV_USER_ID` on the VM.

**Admin interface** at `/admin`, for users with `users.is_admin = true` (others
get a 404; admins see an "Admin" button on their profile):

- Browse any table, 50 rows per page.
- Insert, edit and delete rows. Values are edited as text and Postgres casts
  them to the column type, so write arrays as `{1,2}` and timestamps as
  `2026-10-12 09:00+02`. Tick "null" to store NULL. When inserting, blank
  fields get the column default.
- A SQL console that runs any statement directly. There's no undo.

To make someone else an admin, have them sign up and run
`update users set is_admin = true where handle = '<handle>';` in the database
(on the VM: `docker compose -p viscon exec db psql -U stride stride`).

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
      profile/settings/   /profile/settings  edit profile, delete account
    (auth)/               /signup (first visit) and its server action; /login redirects to /
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
    seed.ts               creates the admin account
    reset.ts              wipes the database for `npm run db:reset`
  components/
    tab-bar.tsx           tab navigation (bottom bar + sidebar)
    icons.tsx             inline SVG icon set
    ui/primitives.tsx     Card, Avatar, Ring, headers
    today/, community/, calendar-view.tsx   interactive tab pieces
    items-panel.tsx       example client component for the items API
  lib/
    auth.ts               proxy login (X-User-Id), requireUser, requireAdmin
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
| GET    | `/api/challenges` | –                        | `{ received: [], sent: [] }` |
| POST   | `/api/challenges` | `{ sessionId, friendIds, message? }` | `201 { sent }` |
| PATCH  | `/api/challenges/:id` | `{ accept }`         | `204`             |
| DELETE | `/api/challenges/:id` | –                    | `204`             |
| PUT    | `/api/push/subscription` | a `PushSubscription` | `204`          |
| DELETE | `/api/push/subscription` | `{ endpoint }`    | `204`             |
| POST   | `/api/push/test` | –                         | `204`             |

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

### Challenges and push notifications

On your own completed session, ⚔️ challenges friends to match it (a hard mock
exam, a long problem set…), with an optional taunt. They answer under
Community → Challenges. Accepting adds a copy of the session to their Today
list; finishing it completes the challenge, and the challenger hears who won:
focus decides when both sessions were tracked, otherwise time. The challenger
can withdraw a challenge until it's answered.

Each step is pushed to the other person with Web Push, and stored in the
`notifications` table. Users turn push on per device under Profile → Settings
(`public/sw.js` is the service worker; on iPhone it needs the app on the home
screen). Push needs a VAPID key pair in `VAPID_PUBLIC_KEY` /
`VAPID_PRIVATE_KEY`, made with `npx web-push generate-vapid-keys`. Without the
keys, push is off and the rest still works.

For `npm run dev`, put the keys in `.env.local`; for `docker compose`, in `.env`
next to `docker-compose.yml` (compose doesn't read `.env.local`). Use the same
pair in both, or devices have to turn push on again after switching. Push
works on `http://localhost` without HTTPS. The container only sends outbound
requests to the browsers' push services, so it needs no extra ports.

**Daily nudges.** `src/instrumentation.ts` starts a timer on each server that
runs at 18:00 and 21:00 Zurich time. Everyone with push on who hasn't finished
a session that day gets one line, built from their friends' real numbers
("Lena did 3 sessions today. Where are you at?") or their streak at 21:00. The
tone is set in Settings: savage (default), gentle or off. Each nudge is
deduplicated in the database, so several servers or restarts never send it
twice. Set `NUDGES=off` to stop them on a server.

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

With curl against a local server, send the header the proxy would add:

```bash
S='X-User-Id: tprazak@ethz.ch'
curl -H "$S" 'localhost:3000/api/users?q=lena'
curl -H "$S" -X POST localhost:3000/api/tasks -H 'content-type: application/json' \
  -d '{"type":"deep","subject":"DiskMath","title":"Long block","scheduledAt":"2026-10-12T09:00:00+02:00","plannedMinutes":90}'
curl -H "$S" -X PATCH localhost:3000/api/tasks/<id> -H 'content-type: application/json' -d '{"done":true}'
```

Every endpoint except `/api/health` needs a signed-up user (via `X-User-Id`)
and returns `401` otherwise. There are no ownership checks yet: any
logged-in user can read or change any user or task. Add those before going
public.

Errors are always `{ error: string, details?: unknown }`: 400 on invalid
input or a reference to a missing record (e.g. an unknown `userId`), 404 on a
missing resource, 409 on a duplicate (e.g. a taken `handle`), 500 otherwise.

```bash
curl -H "$S" localhost:3000/api/items
curl -H "$S" -X POST localhost:3000/api/items -H 'content-type: application/json' -d '{"title":"ship it"}'
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

In the app, each custom plan has three knowledge pages, linked from the plan card:

| Page | What it shows |
| ---- | ------------- |
| `/plans/:id/forecast` | Predicted grade per subject (or the plan average) as a band: the estimated level so far, the projection to the exam date, the chance of reaching the target grade |
| `/plans/:id/topics` | Spider chart (one axis per subject, or per topic for one subject), plus a progress list of every topic grouped by subject (compared with a week ago or the exam-day forecast) |
| `/plans/:id/log` | Log a practice sheet, quiz, mock or exam (points or a grade), tick which of the subject's topics it covered, and delete data points |

A subject's topics are the real course topics when it matches a course
profile (`course_profiles`, filled by `npm run db:seed-courses` from the
ETH course catalogue (VVZ), by name or alias). Otherwise they're three
hardcoded fallback topics. The service always holds exactly the plan's
current topics (`syncTopics` prunes the rest), so switching to real topics
leaves no empty placeholders in the forecast. Each subject's exam covers its
topics equally, and the plan average weights subjects equally. Grades map linearly:
grade = 1 + 5 × score. These choices live in `src/lib/knowledge-topics.ts`.
The app talks to the service only from the server (`src/lib/knowledge.ts`),
after checking that the plan belongs to the user.

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
