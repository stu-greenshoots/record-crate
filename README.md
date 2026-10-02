# Record Crate

A local browser for a Discogs record collection. Signs in with Discogs OAuth, pulls
your collection down to disk, files it the way a person would file it, and lets you
flick through it like a real crate.

```bash
npm install
npm run dev      # http://localhost:5177
```

Then hit **Connect Discogs**. Nothing leaves your machine except calls to the Discogs API.

## How it files things

Records sort under a *filed-as* name, not the raw artist string:

| Artist | Filed as |
| --- | --- |
| Bob Dylan | Dylan, Bob |
| The Beatles | Beatles, The |
| Ludwig van Beethoven | Beethoven, Ludwig van |
| Fleetwood Mac | Fleetwood Mac |
| Various | Various Artists |

Working out whether an artist is a person or a band happens in three passes of
increasing confidence:

1. **Name shape** — instant, for every record. Two title-case words is probably a
   person; a leading article, an ampersand, or a word like "Orchestra" is a band.
2. **Discogs** — the background crawl fetches each artist. A `members` list means a
   group; a `realname` means a person. This corrects the guesses (Fleetwood Mac,
   Pink Floyd, Public Enemy) within a few minutes of the first sync.
3. **Your override** — always wins, and applies to every record by that artist.

The **Filing** tab lists every artist with the source of its filing, so guesses can be
audited in one pass. Anything still marked *best guess* is worth a glance.

`npm test` exercises the filing and shelf rules.

## Shelves

New records are auto-sorted onto shelves, most specific first: **Singles** (7"s and
maxi-singles) → **Screen & Play** (soundtracks, scores, game music) → **Compilations**
→ **Heavy Rotation** (metal styles) → **Main Shelf**.

Shelves are yours to change — rename by double-clicking, add with **+**, drag records
between them, or move a record from its detail panel. Re-running the auto-sort
(`POST /api/shelves/reclassify`) only touches records you haven't moved by hand.

## Order

The sort selector offers filed-as, artist-as-written, title, year, recently added and
market value. Drag any record in the shelf view and the current order is frozen into
**My own order**, which is then yours to rearrange freely.

## Views

- **Grid** — gallery with alphabetical run-in dividers, drag to reorder or re-shelve.
- **Crate** — coverflow. Arrow keys, scroll, or drag to flick; A–Z rail to jump; Enter opens.
- **Shelf** — the physical unit (see below).
- **Filing** — the sort-name audit table.

## Filing a record from a photo

*File a record* answers "where does this go?" for something in your hands.

Photograph the **front** and it matches against the sleeves you already own.
Photograph the **back** and it reads the sleeve: the catalogue number printed
there names one specific pressing, and it comes back with the pressings on
Discogs that carry it, so you pick the one you're holding. Either way you end up
with the cube and the two records to slide between — and it says so if you
already own it.

Fill the frame with the sleeve. A catalogue number is set in about 7pt, so it
needs roughly 1700px across the sleeve to be legible; below that the app tells
you the photo was too small rather than guessing.

## The unit

The **Shelf** view draws your actual furniture: a grid of cubes with every record
standing in it as a spine, coloured by averaging its sleeve art.

Cubes are either part of the **alphabetical run** — showing a letter range like
"C – E" — or hold named shelves. The default is a 4-wide, 3-tall unit: nine cubes of
alphabet running left to right, then Heavy Rotation, Screen & Play, and
Compilations + Singles filling out the bottom row. Change the dimensions, capacity,
or what any cube holds by clicking its label.

The unit is sized from the space available so the whole thing is visible at once,
down to a floor below which the spines stop being hoverable.

The letter ranges aren't fixed at 26/n. They're solved for: a dynamic program splits
the alphabet into consecutive runs minimising squared deviation from the average
load, with a steep penalty for exceeding a cube's capacity. Minimising the *largest*
cube — the usual approach — happily leaves one cube at 14 and another at 50 as long
as the peak is optimal; evening the loads is what makes a shelf look right. Ranges
shift as the collection grows.

Spine width comes from the cube's capacity rather than its contents, so a half-full
cube reads as half full, and the trailing records lean the way real ones do. Cubes
past capacity are flagged, as are records with nowhere to live. Searching highlights
matching spines in place, and any record's detail panel tells you which cube it
stands in.

Opening a record shows the sleeve (click to flip to the back scan), tracklist, credits,
notes, pressing details, community have/want, and what it's currently going for on the
marketplace.

## Layout

```
server/
  config.js     credentials + paths (reads the tab-separated .env as-is)
  discogs.js    OAuth 1.0a (PLAINTEXT) + rate-limited API client
  store.js      JSON persistence with atomic writes
  classify.js   filing rules and shelf auto-sort
  sync.js       collection pull
  enrich.js     background crawl for sleeves, artists and prices
  records.js    the shape the UI renders, plus sort modes
  routes.js     HTTP API
src/            React + TypeScript front end
data/           your collection, shelves and cached art (gitignored)
```

Discogs allows 60 requests/minute, so the client runs a token bucket a little under
that with a two-level queue — anything you're waiting on overtakes the background
crawl. After the first sync, sleeves and artist identities fill in over a few minutes.

Collection value is opt-in (one marketplace call per release) via the sidebar button,
and is the sum of the **lowest currently listed** price, so it reads as a floor rather
than an appraisal. Set `DISCOGS_CURRENCY` to change from GBP.
