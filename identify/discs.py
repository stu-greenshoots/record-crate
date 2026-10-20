"""Is a label crop really the whole record?

The label finder (labels.py) looks for the label inside a record by its dark
grooves. A coloured, clear or picture disc has none, so in a photo of the whole
record it takes the disc's edge for the label's, and the whole disc ends up squeezed
into the middle of the platter. Some photos of black records go the same way.

A linear probe on the DINOv2 embedding of each crop (every side's) tells the two
apart, trained on
hand-marked crops (tests/disc-truth.json) and every other crop taken as a label:
most are, and the unmarked crops the probe rated most disc-like were all checked by
eye and were labels. Those crops are then drawn across the
whole platter instead of in the middle, re-cropped round the label (public/discs/):
the disc's edge in a photo taken at an angle, or cut off by the frame, is a poor
guide to where the spindle is, and the record would wobble as it spins.

    .venv/bin/python -m identify.discs            # measure against tests/disc-truth.json
    .venv/bin/python -m identify.discs --prepare  # crops -> data/label-crops/*.jpg, to embed
    .venv/bin/python -m identify.discs --build    # data/discs.json: the crops that are discs
    .venv/bin/python -m identify.discs --build --all   # and re-crop every disc, after changing how
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

from identify.labels import Circle, _fit, _holes, _hough, _load, _rim_at, crop, locate

ROOT = Path(__file__).resolve().parent.parent
LABELS = ROOT / 'public/labels'
CROPS = ROOT / 'data/label-crops'
EMBED = ROOT / 'data/label-crops-embed.json'
OUT = ROOT / 'data/discs.json'
WHOLE = ROOT / 'public/discs'
SRC = ROOT / 'data/label-src'

# Measured over repeated 5-fold runs on the hand-marked crops: 87% of discs found,
# no label ever shown as a disc. A disc missed only stays small, as before; a label
# taken for a disc would cover the platter, so the bar is set high.
THRESHOLD = 0.8


def truth() -> dict[str, int]:
    t = json.loads((ROOT / 'identify/tests/disc-truth.json').read_text())
    return {**{k: 1 for k in t['disc'] + t['neither']}, **{k: 0 for k in t['label']}}


def neither() -> list[str]:
    return json.loads((ROOT / 'identify/tests/disc-truth.json').read_text())['neither']


def prepare():
    """Each crop flattened onto grey as a JPEG (the embedder doesn't do transparency),
    redone when the crop has changed, so its embedding is redone too."""
    from PIL import Image

    CROPS.mkdir(parents=True, exist_ok=True)
    embed = json.loads(EMBED.read_text()) if EMBED.exists() else {}
    have = set()
    for src in LABELS.glob('*.webp'):
        have.add(src.stem)
        out = CROPS / f'{src.stem}.jpg'
        if out.exists() and out.stat().st_mtime >= src.stat().st_mtime:
            continue
        im = Image.open(src).convert('RGBA')
        flat = Image.new('RGB', im.size, (128, 128, 128))
        flat.paste(im, (0, 0), im)
        flat.save(out, quality=90)
        embed.pop(src.stem, None)
    for old in CROPS.glob('*.jpg'):
        if old.stem not in have:
            old.unlink()
            embed.pop(old.stem, None)
    EMBED.write_text(json.dumps(embed))


# The label's size as a fraction of the record's: 4" on a 12" or 10", 3½" on a 7"
# (as shared/needle.js and the turntable draw it).
LABEL = {7: 0.5, 10: 0.4, 12: 0.357}


def inches() -> dict[str, int]:
    """Each release's record size, from the first vinyl in its Discogs formats."""
    out = {}
    for item in json.loads((ROOT / 'data/collection.json').read_text())['items']:
        vinyl = next((f for f in item['info'].get('formats') or [] if 'vinyl' in (f.get('name') or '').lower()), None)
        size = next((d[:-1] for d in (vinyl or {}).get('descriptions') or [] if d[:-1].isdigit() and d.endswith('"')), None)
        out[str(item['releaseId'])] = int(size) if size else 12
    return out


def centred(path: Path, size: int = 12) -> Circle | None:
    """The record in a photo, centred on its label: the circle a fifth to a half the
    size of the disc nearest the disc's middle, with the clearest edge.

    The label is also the ruler. Labels are a standard size, so the record is drawn at
    the size its label implies, and every record comes out the same size on the
    platter however the photo framed it. The disc's own edge, which an angle, a
    cut-off frame or a sleeve in shot can throw out, is only the fallback."""
    disc = locate(path)
    img, s = _load(path)
    if disc is None or img is None:
        return None
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    cx, cy, r = disc.cx * s, disc.cy * s, disc.r * s
    label = _label_on_black(img, cx, cy, r)
    if label:
        x, y, rr = label
        whole = rr / (LABEL[7] if size <= 7 else LABEL[10] if size <= 10 else LABEL[12])
        if 0.7 <= whole / r <= 1.3:
            return Circle(x / s, y / s, whole / s, 'the label on black vinyl')
    # The spindle hole, where there's a clear one, is the centre: a printed ring or
    # lettering on the label can't be mistaken for it. The label's edge is then the
    # ring round the hole with the sharpest step.
    for score, hx, hy, rh in _holes(gray, min(gray.shape))[:6]:
        if score >= 3 and math.hypot(hx - cx, hy - cy) < r * 0.3 and 0.01 < rh / r < 0.05:
            rims = [(_rim_at(gray, hx, hy, rr, slack=1), rr) for rr in np.arange(r * 0.2, r * 0.5, 1.0)]
            sup, rr = max(rims)
            if sup >= 0.45:
                whole = rr / (LABEL[7] if size <= 7 else LABEL[10] if size <= 10 else LABEL[12])
                if 0.8 <= whole / r <= 1.25:
                    return Circle(hx / s, hy / s, whole / s, 'on the hole, sized by its label')
            break
    best = None
    for x, y, rr in _hough(gray, r * 0.2, r * 0.5):
        off = math.hypot(x - cx, y - cy)
        if off > r * 0.2:
            continue
        score = _rim_at(gray, x, y, rr) - off / r
        if best is None or score > best[0]:
            best = (score, x, y, rr)
    if best is None or best[0] < 0.4:
        return disc
    _, x, y, rr = best
    whole = rr / (LABEL[7] if size <= 7 else LABEL[10] if size <= 10 else LABEL[12])
    # A "label" that implies a record far bigger or smaller than the one in the photo
    # was some other ring: centre on it, but keep the photo's own edge.
    if 0.8 <= whole / r <= 1.25:
        return Circle(x / s, y / s, whole / s, 'sized by its label')
    return Circle(x / s, y / s, (r - math.hypot(x - cx, y - cy)) / s, 'centred on the label')


def _label_on_black(img, cx, cy, r):
    """On black vinyl the label is the one big bright patch in the middle. Its outline,
    fitted with an ellipse (photos are often taken at an angle), gives the centre and
    the size, where printed rings and lettering would fool a circle finder.
    -> (x, y, radius) in working pixels, or None if the vinyl isn't black."""
    h, w = img.shape[:2]
    yy, xx = np.ogrid[:h, :w]
    d = np.hypot(xx - cx, yy - cy)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    band = (d > r * 0.6) & (d < r * 0.85)
    if band.sum() < 100 or np.median(hsv[..., 2][band]) > 70:
        return None
    # Brightness alone: in near-black pixels the colour is only noise.
    bright = ((hsv[..., 2] > 90) & (d < r * 0.9)).astype(np.uint8)
    bright = cv2.morphologyEx(bright, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n, labels, stats, centroids = cv2.connectedComponentsWithStats(bright)
    best = None
    for i in range(1, n):
        area = stats[i, cv2.CC_STAT_AREA]
        if not (math.pi * (r * 0.15) ** 2 < area < math.pi * (r * 0.55) ** 2):
            continue
        if math.hypot(centroids[i][0] - cx, centroids[i][1] - cy) > r * 0.3:
            continue
        if best is None or area > stats[best, cv2.CC_STAT_AREA]:
            best = i
    if best is None:
        return None
    contours, _ = cv2.findContours((labels == best).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    hull = cv2.convexHull(max(contours, key=len))
    if len(hull) < 5:
        return None
    (ex, ey), (a, b), _ = cv2.fitEllipse(hull)
    return ex, ey, max(a, b) / 2


def order(stem: str) -> tuple[int, int]:
    """A crop's release and side: 123 is side 1 (A), 123-2 the next side."""
    rid, _, side = stem.partition('-')
    return int(rid), int(side or 1)


def probe(embed: dict, marks: dict[str, int], skip=frozenset()):
    keys = [k for k in embed if k not in skip]
    w, b = _fit(np.array([embed[k] for k in keys]), np.array([marks.get(k, 0) for k in keys], dtype=float))
    return lambda v: float(1 / (1 + np.exp(-(np.asarray(v) @ w + b))))


if __name__ == '__main__':
    marks = truth()

    if '--prepare' in sys.argv:
        prepare()
        sys.exit(0)

    embed = json.loads(EMBED.read_text())
    if '--build' in sys.argv:
        p = probe(embed, marks)
        crops = {f.stem for f in LABELS.glob('*.webp')}
        # A hand mark outranks the probe.
        discs = sorted((k for k in embed if k in crops and marks.get(k, p(embed[k]) >= THRESHOLD)), key=order)
        drop = [k for k in neither() if k in discs]
        discs = [k for k in discs if k not in drop]
        WHOLE.mkdir(exist_ok=True)
        for old in WHOLE.glob('*.webp'):
            if old.stem not in discs:
                old.unlink()
        labels = json.loads((ROOT / 'data/labels.json').read_text())
        sizes = inches()
        for stem in discs:
            out = WHOLE / f'{stem}.webp'
            fresh = out.exists() and out.stat().st_mtime >= (LABELS / f'{stem}.webp').stat().st_mtime
            if fresh and '--all' not in sys.argv:
                continue
            rid, side = order(stem)
            d = labels[str(rid)]
            photo = SRC / f'{rid}_{d["photo"] if side == 1 else d["more"][side - 2]}.jpg'
            c = centred(photo, sizes.get(str(rid), 12))
            if c:
                crop(photo, c, out, size=480, inset=1.0)
        OUT.write_text(json.dumps({'threshold': THRESHOLD, 'discs': discs, 'drop': drop}))
        print(f'{len(discs)} of {len(crops)} label crops are the whole record, {len(drop)} are more than one')
        sys.exit(0)

    # Each marked crop judged by a probe that never saw it, five ways, three times.
    keys = [k for k in marks if k in embed]
    found = missed = wrong = 0
    for seed in range(3):
        fold = np.random.default_rng(seed).integers(0, 5, len(keys))
        for f in range(5):
            p = probe(embed, marks, skip={k for k, g in zip(keys, fold) if g == f})
            for k, g in zip(keys, fold):
                if g != f:
                    continue
                disc = p(embed[k]) >= THRESHOLD
                if marks[k] and disc:
                    found += 1
                elif marks[k]:
                    missed += 1
                elif disc:
                    wrong += 1
                    print(f'{k}: a label taken for a disc')
    print(f'{found} discs found, {missed} missed, {wrong} labels taken for discs (3 runs)')
    sys.exit(1 if wrong else 0)
