"""Is a label crop really the whole record?

The label finder (labels.py) looks for the label inside a record by its dark
grooves. A coloured, clear or picture disc has none, so in a photo of the whole
record it takes the disc's edge for the label's, and the whole disc ends up squeezed
into the middle of the platter. Some photos of black records go the same way.

A linear probe on the DINOv2 embedding of each crop tells the two apart, trained on
hand-marked crops (tests/disc-truth.json) and every other crop taken as a label:
most are, and the unmarked crops the probe rated most disc-like were all checked by
eye and were labels. Those crops are then drawn across the
whole platter instead of in the middle, re-cropped round the label (public/discs/):
the disc's edge in a photo taken at an angle, or cut off by the frame, is a poor
guide to where the spindle is, and the record would wobble as it spins.

    .venv/bin/python -m identify.discs            # measure against tests/disc-truth.json
    .venv/bin/python -m identify.discs --prepare  # crops -> data/label-crops/*.jpg, to embed
    .venv/bin/python -m identify.discs --build    # data/discs.json: the crops that are discs
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

from identify.labels import Circle, _fit, _hough, _load, _rim_at, crop, locate

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


def centred(path: Path) -> Circle | None:
    """The record in a photo, centred on its label: the circle a fifth to a half the
    size of the disc nearest the disc's middle, with the clearest edge. The radius
    shrinks by as much as the centre moves, so the crop stays on the record."""
    disc = locate(path)
    img, s = _load(path)
    if disc is None or img is None:
        return None
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    cx, cy, r = disc.cx * s, disc.cy * s, disc.r * s
    best = None
    for x, y, rr in _hough(gray, r * 0.2, r * 0.5):
        off = math.hypot(x - cx, y - cy)
        if off > r * 0.2:
            continue
        score = _rim_at(gray, x, y, rr) - off / r
        if best is None or score > best[0]:
            best = (score, x, y)
    if best is None or best[0] < 0.4:
        return disc
    _, x, y = best
    return Circle(x / s, y / s, (r - math.hypot(x - cx, y - cy)) / s, 'centred on the label')


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
        discs = sorted((k for k in embed if k in crops and marks.get(k, p(embed[k]) >= THRESHOLD)), key=int)
        drop = [k for k in neither() if k in discs]
        discs = [k for k in discs if k not in drop]
        WHOLE.mkdir(exist_ok=True)
        for old in WHOLE.glob('*.webp'):
            if old.stem not in discs:
                old.unlink()
        labels = json.loads((ROOT / 'data/labels.json').read_text())
        for rid in discs:
            out = WHOLE / f'{rid}.webp'
            if out.exists() and out.stat().st_mtime >= (LABELS / f'{rid}.webp').stat().st_mtime:
                continue
            photo = SRC / f'{rid}_{labels[rid]["photo"]}.jpg'
            c = centred(photo)
            if c:
                crop(photo, c, out, size=480)
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
