"""Is a label crop really the whole record?

The label finder (labels.py) looks for the label inside a record by its dark
grooves. A coloured, clear or picture disc has none, so in a photo of the whole
record it takes the disc's edge for the label's, and the whole disc ends up squeezed
into the middle of the platter. Some photos of black records go the same way.

A linear probe on the DINOv2 embedding of each crop tells the two apart, trained on
hand-marked crops (tests/disc-truth.json) and every other crop taken as a label:
most are, and the unmarked crops the probe rated most disc-like were all checked by
eye and were labels. Those crops are then drawn across the
whole platter instead of in the middle.

    .venv/bin/python -m identify.discs            # measure against tests/disc-truth.json
    .venv/bin/python -m identify.discs --prepare  # crops -> data/label-crops/*.jpg, to embed
    .venv/bin/python -m identify.discs --build    # data/discs.json: the crops that are discs
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

from identify.labels import _fit

ROOT = Path(__file__).resolve().parent.parent
LABELS = ROOT / 'public/labels'
CROPS = ROOT / 'data/label-crops'
EMBED = ROOT / 'data/label-crops-embed.json'
OUT = ROOT / 'data/discs.json'

# Measured over repeated 5-fold runs on the hand-marked crops: 87% of discs found,
# no label ever shown as a disc. A disc missed only stays small, as before; a label
# taken for a disc would cover the platter, so the bar is set high.
THRESHOLD = 0.8


def truth() -> dict[str, int]:
    t = json.loads((ROOT / 'identify/tests/disc-truth.json').read_text())
    return {**{k: 1 for k in t['disc']}, **{k: 0 for k in t['label']}}


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
        OUT.write_text(json.dumps({'threshold': THRESHOLD, 'discs': discs}))
        print(f'{len(discs)} of {len(crops)} label crops are the whole record')
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
