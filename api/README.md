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

## The production image

```sh
npm run api:build                                   # one bundled file, dist-api/main.mjs
docker compose --env-file api/compose.env --profile api up --build
```

`api/Dockerfile` bundles the API with esbuild onto `node:22-slim`. The image holds a single file and no `node_modules`, and builds for whichever architecture the host is, including the ARM VPS. The image has a healthcheck on `/api/health`, which answers 503 and names the culprit when Postgres or Redis is unreachable.

## Errors

Every failure comes back as `{ error: { code, message } }`, using the codes in `contract/models.ts`. Bad requests list their `issues`, and unexpected failures are logged but never echoed back.
