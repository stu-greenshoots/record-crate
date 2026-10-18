# Record Crate

**Where does this record go?** A phone app for keeping a vinyl collection in order.
Point the camera at a sleeve, or type a few letters, and it shows the cube, which
row and how far along, and the two records to slide it between. Take a record out
to play it and it waits in **Put back**, which then walks you round the unit in
order.

It's a static site — the collection is baked in, the sleeve recogniser runs on the
phone, and nothing needs a server. Add it to the home screen and it works offline.

## Using it

- **The turntable** (home) — find a record by typing an artist, album or catalogue
  number (`zep`, `k 50014`), or *Scan* and fill the square with the front cover.
  It goes on the platter with its real centre label, and the records either side
  of it on the shelf stand round it in a ring: spin the ring (or use the arrow
  keys) to walk along the shelf. Above the platter (beside it, on a landscape
  tablet) is where it goes: the cube, its place on the unit, and the records it
  slots between. *Take it out* puts it on the Put back list. Below, *Shelf* and
  *Filed as* fix a record that's filed wrong — a sort-name fix can cover every
  record by that artist. With nothing on the platter, the ring holds what you
  looked up last.
- **About this pressing** (on a record, under its details): first pressing or not.
  A first pressing is Discogs' main release for the album (their guidelines make it
  the original issue), or one with its country, catalogue number and year that isn't
  marked a repress. Otherwise it's a same-year pressing, a reissue, a repress, the
  first in its country or the first on vinyl. Also where it was pressed and cut; the
  run-out etchings, with a tick for the variant your copy has; how many people have
  and want it, prices, and the Discogs notes. A first pressing gets a badge on the
  turntable.
- **The dice** on the turntable puts a random record from the shelf on the platter.
  *Change* narrows what it picks from with the same choices as the Unit filter.
- **Artist pages** — tap the artist's name. Their studio and live albums from
  MusicBrainz (compilations and EPs listed too), the ones you have lit up with where
  they stand, the missing ones linked to Discogs, and members or bands to follow.
- **Stats** — the collection by decade, genre, style, label, players, engineers,
  producers, pressing, country and plant; rarest, most wanted, most valuable; artists
  you have every album by. Tap a row to see those records lit on the unit.
- **Put back** — everything that's out, grouped by cube in walking order, each
  with the nearest record still on the shelf to slot it next to. Tick them off.
- **Unit** — the whole unit drawn as spines coloured from the sleeves. Open a cube
  for its records in shelf order, with a checklist for sorting the real shelf to
  match. Type to find (artist, album, catalogue number), and filter by genre,
  style, year, label or people (anyone credited with
  playing on, engineering or producing a record): the matches glow on the shelves,
  each cube shows how many it holds, and a cube opens at its first match. More than
  one choice of a kind means any of them; different kinds must all hold. *Settings* (the cog) changes the unit's size, cube capacity and what each
  cube holds, and how the A–Z run is split: *Evenly* (balanced, a letter may run
  into the next cube), *Fill up* (each cube full before the next) or *By letter*
  (whole letters, you choose where each cube starts). *Shelves* renames shelves,
  adds new ones and picks which records stand on each.
- **New records** — the app checks Discogs a few seconds after opening (at most
  every six hours); Settings checks on demand.

What you do on the phone — what's out, ticks, layout, sort-name and shelf fixes —
is saved on that phone.

## How the camera works

The recogniser is [DINOv2-small](https://huggingface.co/Xenova/dinov2-small)
running in a web worker through transformers.js (ONNX Runtime, WebAssembly). Every
cover in the collection is embedded ahead of time (`public/data/embeddings.bin`,
466KB); a camera frame is embedded on the phone and compared with all of them.
The first scan downloads the model and runtime (~38MB) once; after that it's
cached.

Measured on synthetic phone photos of 60 of the real sleeves
(`identify/tests/phone_photos.py` + `bench_embed.mjs`):

| condition | right first time | in the top 5 |
| --- | --- | --- |
| straight on | 60/60 | 60/60 |
| moderate angle | 59/60 | 60/60 |
| angle + lamp glare | 57/60 | 60/60 |
| glare + soft focus | 58/60 | 59/60 |
| loosely framed, on a cluttered shelf | 59/60 | 60/60 |
| loosely framed, dim warm light, soft | 49/60 | 56/60 |

CLIP ViT-B/32 was clearly worse (26–60/60). The scanner only jumps to an answer
on its own when the top score is ≥ 0.68 *and* it leads the runner-up by ≥ 0.07
(or ≥ 0.06 on two frames running): across those photos plus 60 things that
aren't sleeves, that accepted 84% of right answers and nothing wrong. The rest
are one tap away. These are synthetic photos — real ones will differ.

Pressing doesn't matter for placement: where a record goes depends on the
artist's filing name and the year the album first came out, which are the same
for every pressing. So recognising the album from its cover is enough.

## Refreshing the snapshot

The app's data comes from the local Discogs mirror in `data/` (gitignored —
collection, artists, master years and cached covers, pulled by the original
desktop app in `server/` + `src/`).

```bash
npm run sync       # Discogs -> data/ (collection, artists, master years, covers)
node scripts/fetch-details.mjs   # album versions, prices, MusicBrainz discographies
npm run snapshot   # labels, then data/ -> public/data/collection.json, covers, embeddings, model
npm run deploy     # build and publish to the gh-pages branch
```

`snapshot` runs `npm run labels` first, which does only what's new: downloads new
releases' Discogs photos (`data/label-src/`), embeds them, picks each one's label
photo and crops it to `public/labels/<releaseId>.webp` (decisions in
`data/labels.json`). How it picks, and how well, is in `identify/labels.py`; after
changing the detector or `identify/tests/labels-truth.json`, measure with
`.venv/bin/python -m identify.labels` and redo everything with
`.venv/bin/python -m identify.labels --build --all`. A record with no label photo
gets a plain printed label.

`fetch-details.mjs` only fetches what's missing: each album's vinyl versions (for the
pressing verdicts, `shared/pressing.js`), price suggestions, and each artist's
MusicBrainz release groups and members (`shared/discography.js` matches them to your
records). The first run takes a couple of hours, mostly MusicBrainz at one call a
second; after that it's minutes. The export writes `public/pressings/` and
`public/artists/`, one small file each, fetched by the phone when needed.

The export also lists who's on each record, from the Discogs credits cached in
`data/releases/` (`shared/credits.js` decides which roles count). Releases without
cached credits are counted in the export log.

`sync` needs the Discogs login in `data/auth.json` (made by connecting once through
`npm run server`). Between snapshots, the app's own Discogs check files new purchases
on the phone using the same rules (the public collection API needs no login). The
camera learns their sleeves at the next snapshot.

## Development

```bash
npm install
npm run dev        # http://localhost:5178 — the phone app
npm test           # filing rules, shelf layout, matching, backups, credits, filters
npm run build      # -> dist-app/
```

```
app/          the phone app (React + TypeScript)
  store.ts      snapshot + on-phone state, where every record stands
  search.ts     type-to-find
  filter.ts     the Unit tab's filter (the matching itself is shared/filter.js)
  recognise*.ts the sleeve recogniser and its worker
  discogs.ts    catching up with new purchases from the phone
shared/       filing rules, shelf width/height, the unit layout solver, credits
              and filtering — used by
              both the app and the scripts
scripts/      export.mjs (snapshot), embed.mjs (recognition index), copy-ort.mjs,
              fetch-label-photos.py + embed-label-photos.mjs (label sources)
public/       the snapshot, covers, labels, model and service worker
server/, src/ the original desktop app and Discogs sync (see HANDOVER.md)
identify/     recognition experiments and measurements; labels.py (centre labels)
```

## Filing, briefly

Records file under a library-style sort name (`Dylan, Bob`, `Beatles, The`,
`Beethoven, Ludwig van`), using Discogs' own person/band data and the artist's
canonical name. Within an artist, by the year the album first came out. Cubes in
the A–Z run are balanced by shelf *width* (a gatefold double takes two slots),
breaking mid-letter when that evens things out. Named shelves — Heavy Rotation,
Screen & Play, Compilations, Singles — get their own cubes. See HANDOVER.md for
the reasoning and the bugs that shaped it.
