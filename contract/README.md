# API contract

This defines the types and routes shared by the phone app and the server. Every model is a zod schema, and its TypeScript type is inferred from it. The server validates requests and responses against these schemas at its edge. The app imports the types, and can validate what it receives.

## Conventions

- **One origin.** The app is served at `/` and the API under `/api`, so the session cookie is first-party and there's no CORS.
- **Sessions.** Signing in goes through Discogs OAuth on the server, which sets an httpOnly cookie. Discogs and Spotify tokens never reach the phone.
- **Errors.** Every error is `{ error: { code, message } }`, using the codes in `ErrorCode`. A `rate-limited` error carries `retryAfter` in seconds. An `invalid` error lists the failing `issues`.

## The collection

Placement needs every record, so the phone loads the whole index once (`GET /api/collection`). After that it only asks for what changed:

1. The index carries an opaque `cursor`.
2. `GET /api/collection/changes?since=<cursor>` returns the records added or changed, the ids removed, and a new cursor.
3. If the cursor is too old to answer, the server says `resync` and the phone loads the whole index again.

The index also gets an `ETag`, so reloading an unchanged collection costs a 304.

Detail that only one screen needs stays out of the index and loads when it's opened: a pressing's tracks, runouts and prices (`/api/releases/:id`), and an artist's page (`/api/artists/:id`). Release and artist data is shared between users, so it caches well.

## Your state

What you do on the phone is sent as **operations**, not as a copy of the state: take a record out, put it back, file it under a new name, move it to a shelf, change the unit.

- Each operation carries an `opId`. A batch resent after a dropped connection is applied only once.
- Operations set values rather than toggle them. For example, `setSorted` carries `sorted: true|false`, so replaying one is harmless.
- The phone keeps a queue while offline and sends it in order: `PATCH /api/state { ops }`.
- The server applies the ops in order and returns the new state with a `version`.
- When two phones disagree, the last operation applied wins. For one person's records, that's the right answer.

## Wants

A want is one pressing (`release`, kept in step with the Discogs want list) or any copy of an album (`master`, which Discogs doesn't have).
