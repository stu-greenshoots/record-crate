# API

This is the server the phone app will talk to once records move off GitHub Pages. It serves the routes in `contract/` and nothing else. Each route's method, path, access rule and schemas come from the contract's table, so the server and the app can't drift apart without a test failing.

## Running it locally

```sh
npm run api:services   # Postgres on :5433 and Redis on :6380, in Docker
npm run api:dev        # the API on :8787, restarting on change
curl localhost:8787/api/health
```

Locally it needs no configuration: it defaults to the Docker Compose services. In production it refuses to start without `DATABASE_URL` and `REDIS_URL`.

| Variable | Default | |
|---|---|---|
| `NODE_ENV` | `development` | In `production`, responses aren't checked against the contract. |
| `HOST`, `PORT` | `0.0.0.0`, `8787` | |
| `LOG_LEVEL` | `info` | Logs are pino JSON lines, each tagged with its request id. |
| `DATABASE_URL` | the Compose Postgres | |
| `REDIS_URL` | the Compose Redis | |
| `MIGRATE_ON_START` | `true` | |

## The database

Postgres, through [Kysely](https://kysely.dev): typed queries with no code generation. The schema lives in `api/db/migrations/`, and `api/db/types.ts` mirrors it.

- **A shared cache:** `releases`, `masters`, `artists`, `release_artists` and `media`. They're fetched once, whoever owns the record. A release's `summary` is its row in a collection index, and its `detail` is its pressing page. Both are shaped by the contract.
- **Per user:**
  - `users`, and `discogs_accounts`. An account can be `pending` before its first sign-in.
  - `owned` and `wanted`. Rows are marked removed rather than deleted, and every change takes the next `collection_seq`, which is what the phone's changes cursor counts.
  - `user_settings` (the default shelves and unit) and `user_state` (what's been done on the phone, with a version).
  - `applied_ops`, so a resent operation is applied once.

```sh
npm run db migrate        # bring the schema up to date
npm run db down           # undo the latest migration
npm run db seed           # load public/data's snapshot as its user's collection (safe to re-run)
```

The server migrates on start (`MIGRATE_ON_START`, default `true`), and Kysely's lock makes that safe. Migrations are listed in `api/db/index.ts` so they travel inside the bundle. Never edit one that has reached the VPS: add the next.

The database tests (`test/db.test.ts`) need the Compose Postgres. Each run creates a database of its own and drops it afterwards. Without Postgres they're skipped, with a warning.

## The production image

```sh
npm run api:build                                   # one bundled file, dist-api/main.mjs
docker compose --env-file api/compose.env --profile api up --build
```

`api/Dockerfile` bundles the API with esbuild onto `node:22-slim`. The image holds a single file and no `node_modules`, and builds for whichever architecture the host is, including the ARM VPS. The image has a healthcheck on `/api/health`, which answers 503 and names the culprit when Postgres or Redis is unreachable.

## Errors

Every failure comes back as `{ error: { code, message } }`, using the codes in `contract/models.ts`. Bad requests list their `issues`, and unexpected failures are logged but never echoed back.
