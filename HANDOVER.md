# Handover — Record Crate

## October 2026: the phone app (start here)

The project is now a **static phone web app** in `app/`, meant for GitHub Pages at
`/record-crate/`. It covers only records Stu owns: find one (typing or camera), see
where it goes, keep a put-back list, and sort the shelves cube by cube. The "not in
my collection" / back-cover flow was deliberately dropped. The README describes the
app; this file's older sections describe the desktop app in `server/` + `src/`,
which is still how `data/` gets synced from Discogs.

- `npm run snapshot` turns `data/` into `public/` (collection, 360px covers,
  DINOv2 embeddings, model). `npm run dev` serves the app on :5178, and
  `app/phone.html` shows three iPhone-sized frames side by side (dev only).
- The pure modules moved to `shared/` and are used by both the app and the server.
- Recognition: DINOv2-small CLS embedding, full frame + centre 80% crop, max per
  record. The auto-accept rule (score ≥ 0.68 and lead ≥ 0.07) and its measurements
  are in `app/components/ScanView.tsx`; the harness is
  `identify/tests/phone_photos.py` + `bench_embed.mjs`.
- **Not yet validated on a real phone camera.** Everything is measured on
  synthetic photos and checked in desktop Chrome.

State of the project as of 2026-08-18, written for a session starting with no
prior context. The app is built and working; the open problem is at the bottom.

## Running it

```bash
npm run dev        # http://localhost:5177 — no passcode locally
npm test           # filing rules, shelf layout, catalogue-number matching
```

Stu (Discogs user `sachaigh`) is already authenticated — `data/auth.json` holds a
live OAuth token and `data/` has his real 607-record collection fully enriched
(sleeves, artists, master release years, some market prices). **Don't delete
`data/`** — re-syncing costs ~25 minutes of rate-limited crawling.

Two things exist for reaching it from a phone, both currently off:
`ACCESS_CODE=<value> npm run dev` puts a passcode in front of everything, and
`ngrok http 5177` exposes it. `vite.config.ts` already allowlists tunnel hosts,
and Express runs with `trust proxy` so the OAuth callback resolves as https.

## What it does

A local browser for a Discogs collection with four views: **Grid** (gallery),
**Crate** (coverflow), **Shelf** (the physical unit), **Filing** (sort-name
audit). Plus a "File a record" dialog that answers *where does this go?*

Three pieces carry most of the value, and each cost real debugging:

**Filing.** Records file under a proper sort name — `Dylan, Bob`, `Beatles, The`,
`Beethoven, Ludwig van`. Person-vs-group comes from Discogs' own artist data (a
`members` list means group, a `realname` means person), falling back to a
name-shape heuristic, with user overrides winning. Filing keys on the Discogs
**artist id** and uses the artist's **canonical name** — never the per-release
credit (`anv`), which is what scattered one artist across the shelf in two
places (久石 譲 vs Joe Hisaishi, Bowie vs David Bowie — 13 artists, 53 records).

**Ordering.** Within an artist, records sort by the year the album *first* came
out, from the Discogs **master release** — not the year of the pressing you own.
Without this, Gong's Radio Gnome trilogy scattered because two of them are 1984
reissues of 1973/74 albums.

**The unit.** `server/shelfmap.js` maps the collection onto physical cubes
(default 4 wide × 3 high). Lettered cubes are filled by a DP that minimises
squared deviation from the average *shelf width* — not headcount, and not the
usual minimax, which happily leaves one cube at 14 and another at 50. Records
carry a `width` (LP-equivalents, from disc count / gatefold / 180-gram) and a
`height` (7" stands short, box sets stand proud), both in `server/thickness.js`.
Letters stay whole unless one outgrows a cube.

`server/place.js` answers "where does this go" for an owned record or any Discogs
release, returning the cube and the two records to slide between.

## Architecture notes

Node + Express with Vite in middleware mode — one process, one port. **Vite only
hot-reloads the client; any change under `server/` needs a restart.** JSON file
store, atomic writes, no database. Discogs allows 60 req/min, so `discogs.js`
runs a token bucket with a two-level queue (interactive work overtakes the
background crawl). OAuth 1.0a uses PLAINTEXT signing — no signing library needed.

## Bugs already found and fixed (don't reintroduce)

- Filing by `anv` instead of the canonical artist name — split 13 artists.
- Sorting by pressing year instead of master year.
- The unit ordered cube contents by name only while the Grid ordered by name
  *then* year — two different orders for the same shelf, which made the
  placement advice wrong. Both now share `byFiling`.
- The detail panel cached its cube and didn't refetch when a record moved
  shelves, so it kept showing the old cube. Looked like the unit was misfiling.
- CJK names were surname-swapped (久石 譲 → 譲, 久石); they're already family-first.
- The Grid loaded 600px covers for 185px tiles — 126MB over a phone tunnel, and
  it crashed the tab. Now thumbs plus `content-visibility`.
- An LP with a bonus 7" was sized as a 7". Tallest component wins.

## Identifying a record from a photo

Goal: photograph a record, have the app say what it is and where it goes.
Records **already in the collection** are matched by their sleeve. Records
**not** in it — the "should I buy this / where would it go" case — are read off
the **back** cover, because the catalogue number printed there names the
pressing. Both paths land in the same `POST /place`.

The remaining gap is validation on real photographs; see the end of the
discovery pass below.

### Solved: recognising a sleeve you already own

`identify/covers.py` — ORB keypoints + RANSAC homography against an index built
from the cached covers (`data/cover-index.npz`, 18MB, rebuilt in ~8s). Run via
`.venv/bin/python -m identify.cli`. Measured on his real 607, with synthesised
phone-photo distortion (perspective, rotation, glare, blur, JPEG, noise):

| Condition | Top-1 | Time |
|---|---|---|
| Straight on, good light | 24/25 | 171ms |
| Moderate angle | 25/25 | 169ms |
| Steep angle + glare | 24/25 | 208ms |
| Angle + glare + soft focus | 22/25 | 197ms |
| Held-out records (not in index) | 0 false positives / 30 | |

The zero-false-positive result came from checking the homography is
*geometrically plausible* (a real sleeve maps its corners to a convex,
sanely-proportioned quad) — not from raising the inlier threshold. Before that,
Santana's *Caravanserai* matched This Heat at 39 inliers, "high" confidence.

Known limitation: wants the sleeve filling most of the frame. Deskewing every
photo first made all four conditions *worse* and doubled the time, so it's only
a fallback when the direct read comes back weak.

### Ruled out, with evidence

- **Barcodes** — most of his collection is 1970s prog/metal, predating them.
  `BarcodeDetector` is wired up and works, but rarely applies. Also absent from
  iOS Safari.
- **OCR of the *front* sleeve (tesseract 5.5.1, installed)** — on a Judas Priest
  sleeve it read "JUDAS PRET |" and invented catalogue numbers `NE 35` and
  `EEL 574` that aren't on the record. Front sleeve type is stylised,
  illustrated, hand-lettered. **This does not generalise to the back cover** —
  see the discovery pass below.
- **Visual pressing disambiguation** — Stu's call, and he's right: different
  pressings of an album share identical cover art, so no image method can tell
  a 1980 original from a 1984 reissue. But see below: this blocks the *buy*
  decision, not the *placement* one.
- **A cloud vision API** — he doesn't want the dependency. The `claude-api`
  skill route was started and reverted; `@anthropic-ai/sdk` has been uninstalled.
  No `ANTHROPIC_API_KEY` and no `ant` CLI on this machine.

### Constraints for whatever comes next

- Local / offline preferred; no paid API dependency.
- ~~Must distinguish **pressings**, not just albums.~~ Measured and withdrawn —
  see the discovery pass below. Placement is decided at album level.
- Python is available (`.venv` has OpenCV 5.0, numpy, Pillow; tesseract is on
  PATH). Node calls Python via `identify/cli.py`.

### Unexplored angles worth a discovery pass

- **The dead-wax matrix / runout etching** is the canonical pressing identifier
  and Discogs indexes it (`identifiers[]` — already captured in our cached
  release JSON). Reading etched metal from a macro photo is hard, but it's a
  constrained character set and the payoff is exact pressing identification.
- **The centre label** carries the catalogue number and differs between
  pressings far more than the sleeve does — a better OCR target than the cover.
- **Discogs monthly data dumps** (releases/labels XML) would allow fully offline
  lookup by catalogue number or barcode, no API round-trip.
- **Audio fingerprinting** — Chromaprint/AcoustID is local and free; play a few
  seconds and identify the recording, then narrow by what he owns. Identifies
  the recording rather than the pressing, but composes well with other signals.
- **A local vision model** (CLIP-class embeddings) against a downloaded cover
  corpus — heavier, and still can't separate identical-cover pressings.

## Discovery pass — 2026-08-18

Findings from a session spent testing the unexplored angles. Two of the
assumptions above turned out to be wrong, both in our favour.

**1. Placement does not depend on the pressing.** `placeRecord()` consumes only
`sortName`, `originalYear`, `shelf`, `height` and `width`. The first two are
identical across pressings by construction (canonical artist; master year). Both
pressings of each of the 9 twice-owned albums were run through it: **8 of 9 land
in the same cube.** The exception is Judas Priest *Invincible Shield* — one copy
is a 7", the other an LP, a format-class difference that is obvious in a photo.
Pressing identity still decides "do I already own *this* copy", shelf width and
price. It does not decide where the record goes.

**2. The OCR dead end was a resolution artefact, not a property of the method.**
The original test used stylised *front* covers. Re-tested on back covers, which
are set in plain type, using the 259 cached full-size secondaries: catno
recovered on 8.8%, title or artist on 28.8%. But those scans are 600px across a
12" sleeve — about 50 px/inch, so 8pt catalogue type renders ~5px tall. A
synthetic floor test (Arial / Times / Arial Narrow, 10 real catnos from the
collection) puts tesseract's requirement at ~16px:

| type size | read correctly |
|---|---|
| 8px | 0/30 |
| 10px | 1/30 |
| 12px | 18/30 |
| 16px | 27/30 |
| 30px | 30/30 |

That works back to **1700–2300px across a sleeve, i.e. 3–5 MP** for 6–8pt
catalogue type. Any phone clears it roughly threefold. The corroborating detail
is that on the same 600px scans the *large* type read perfectly ("HENRY COW")
while body text was soup — the signature of a resolution ceiling rather than a
failed method. Treat 8.8% / 28.8% as a floor depressed by two confounds: 7×
too little resolution, and a corpus where only about a third of the images are
text-bearing back covers at all (84/250 yielded anything identifying).

**3. The catalogue number is the practical identifier.** Across the 609 cached
releases: 752 distinct catnos, only 3 keys mapping to more than one release —
two of those being the same pressing genuinely owned twice, the third the
literal placeholder `NONE`. 7 of the 9 duplicate albums have different catnos
per pressing. Across all of Discogs, though, a catno is album-level:
`/database/search?catno=` returned the right album 3/3 for unowned records, but
312 / 4 / 80 candidates, because reissues and country variants share numbers.

**4. Everything downstream of a release id already works.** `POST /place`
already accepts a `releaseId`, fetches the release, pulls the master year and
returns a full placement plus `alreadyOwned`. Verified end to end for a record
he does not own: catno `K 50014` → Led Zeppelin *Houses Of The Holy* → cube
K–M, between *Led Zeppelin III* (1970) and *Physical Graffiti* (1975). **The
only missing link in the whole feature is photo → release id.**

**5. OCR errors at adequate resolution are shape confusions, not garbage** —
`MOSH079FDR`→`MOSHO79FDR`, `V2027`→`V2O27`, `SLS 50160`→`5L5 5016O`. A fixed
confusion table (O/0, I/1, S/5, B/8) absorbed 4 of 6; the misses were F→E and
S→9. Don't require a perfect read — match by edit distance against a known catno
list.

**6. The Discogs data dumps are not the free offline win they looked like** —
direct S3 access now returns 403, so that route needs auth work first.

**Not yet validated:** no test on a real phone photo of a real back cover. The
synthetic renders have no glare, perspective, wear, or text competing with
artwork. That is the next input needed, and it needs Stu holding a phone.

### What was then built on top of it

`identify/backcover.py` — reads a photographed back cover and returns
*candidates*, not answers: catalogue numbers ranked with a confidence, and the
lines of largest type for a fallback text search. Reached from
`POST /api/identify/back` (raw image bytes) via `server/identify.js`, and from
the "Read the back" button in the File a record dialog. Measured across four
photograph conditions in `identify/tests/README.md`.

Three things in it are load-bearing and easy to undo by accident:

- **Nothing downscales the photo.** `text.find_sleeve_quad` finds the sleeve on a
  900px copy but returns the corners in the original image's coordinates, so
  `backcover.flatten` warps at full resolution. The old `deskew()` resized to
  900px and warped into a 1000px box, which put the catalogue number below the
  readable threshold every time.
- **Words are clustered into visual lines before being read left to right.**
  Tesseract merges the artist and title into one line group on a
  perspective-corrected photo, and sorting that by x gives
  "JUDAS Sad Wings Of PRIEST Destiny".
- **Catalogue numbers are matched by lookalike characters and nothing else.**
  Labels number their releases in sequence, so K 50012 and K 50014 are two
  different Led Zeppelin records. A general edit distance reported that Stu
  already owned *Houses Of The Holy* when what he owns is the record filed next
  to it. Only shape confusions (O/0, S/5, B/8, E/F …) and a single dropped
  *letter* are forgiven — never a dropped digit. `test/identify.test.mjs` pins
  this down and runs in `npm test`.

## Layout

```
server/
  config.js     credentials + paths (reads the tab-separated .env as-is)
  discogs.js    OAuth 1.0a (PLAINTEXT) + rate-limited client
  store.js      JSON persistence, atomic writes
  classify.js   filing rules and shelf auto-sort
  thickness.js  how much shelf a record takes, and how tall it stands
  shelfmap.js   collection -> physical cubes (the balancing DP)
  place.js      "where does this record go"
  sync.js       collection pull
  enrich.js     background crawl: sleeves, artists, master years, prices
  records.js    the shape the UI renders, plus sort modes
  identify.js   spawns the Python reader; catalogue-number matching
  routes.js     HTTP API
identify/
  covers.py     ORB + homography sleeve matching (a sleeve you already own)
  backcover.py  reads a photographed back cover -> catalogue number candidates
  text.py       finding the sleeve in the frame, plus the older front-sleeve OCR
  cli.py        JSON bridge for the Node server
src/            React + TypeScript front end
test/           npm test — filing rules and shelf layout
data/           his collection, shelves, cached art (gitignored, do not delete)
```

Not a git repo. `npm test` covers filing, shelf layout and catalogue-number
matching; the image work is measured by the scripts in `identify/tests/`
(see the README there) rather than in the suite.
