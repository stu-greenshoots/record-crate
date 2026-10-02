# Recognition measurements

Not part of `npm test` — these need the server running and the cover index built,
and they take a few minutes.

```bash
npm run dev &                                   # needs the collection + cached art
.venv/bin/python -m identify.tests.manifest     # map records -> cached covers
.venv/bin/python -c "import identify.covers as c; \
  print(c.build_index('/tmp/manifest.json','data/cover-index.npz'))"

.venv/bin/python identify/tests/test_recognition.py      # can it find real sleeves
.venv/bin/python identify/tests/test_false_positives.py  # does it stay quiet otherwise
```

`test_recognition` synthesises phone photos from the real covers — perspective
warp, camera tilt, lamp glare, crop, blur, sensor noise, JPEG — across four
conditions. `test_false_positives` rebuilds the index with 30 records held out
and checks those come back empty rather than confidently wrong; that second one
is the important number, and the reason the plausibility check exists.

## Reading the back of a sleeve

```bash
.venv/bin/pip install Pillow                             # rendering only, not needed at runtime
.venv/bin/python -m identify.tests.test_backcover        # ~4 minutes
```

Renders plausible back covers, photographs them (perspective, glare, blur, JPEG)
and checks the catalogue number and the title come back. Measured 2026-08-18:

| condition | catno | title | artist |
|---|---|---|---|
| flat on, good light | 4/5 | 5/5 | 5/5 |
| moderate angle | 4/5 | 5/5 | 5/5 |
| angle + glare | 5/5 | 5/5 | 5/5 |
| angle + glare + soft focus | 4/5 | 5/5 | 5/5 |

The catalogue number came back ranked first in every case it was found at all.

**These are rendered sleeves, not photographs**, so treat the table as proof the
pipeline is wired up rather than as a field result — real sleeves are worn, lit
badly and printed over artwork.

The second half of the script is the part that does transfer, because it is
governed by glyph size alone:

| px across the sleeve | catno read |
|---|---|
| 600 | 0/5 |
| 900 | 0/5 |
| 1200 | 0/5 |
| 1800 | 4/5 |
| 2400 | 4/5 |

The cliff between 1200 and 1800px is why `read_back` reports `resolutionOk`, and
why nothing in the reader is allowed to downscale the photo before OCR.
