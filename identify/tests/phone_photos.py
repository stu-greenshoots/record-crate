"""Synthesise phone photos of sleeves for measuring the in-browser matcher.

Writes <out>/<condition>/<recordId>.jpg plus <out>/truth.json. The conditions add
one thing over test_recognition.py: a sleeve that does *not* fill the frame, sat
on a cluttered background, because the camera view only asks you to line the
sleeve up inside a square guide.

    .venv/bin/python identify/tests/phone_photos.py public/data/collection.json OUTDIR
"""
import json
import os
import random
import sys

import cv2
import numpy as np

random.seed(11)
np.random.seed(11)

snapshot = json.load(open(sys.argv[1]))
out = sys.argv[2]
root = os.path.dirname(os.path.dirname(os.path.abspath(sys.argv[1])))
recs = [r for r in snapshot['records'] if r.get('cover')]
N = int(os.environ.get('N', 60))
sample = random.sample(recs, N)
others = [r for r in recs if r not in sample]


def load(r, size=700):
    img = cv2.imread(os.path.join(root, r['cover']))
    return cv2.resize(img, (size, size))


def background(size):
    """A blurred mess of other sleeves and wood-ish noise — a shelf, a table."""
    bg = np.zeros((size, size, 3), np.uint8)
    for _ in range(4):
        tile = load(random.choice(others), random.randint(size // 2, size))
        x, y = random.randint(-size // 3, size // 2), random.randint(-size // 3, size // 2)
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(size, x + tile.shape[1]), min(size, y + tile.shape[0])
        bg[y0:y1, x0:x1] = tile[y0 - y:y1 - y, x0 - x:x1 - x]
    bg = cv2.GaussianBlur(bg, (31, 31), 0)
    wood = np.random.normal(0, 1, (size, size)).astype(np.float32)
    wood = cv2.GaussianBlur(wood, (1, 61), 0) * 40
    return np.clip(bg.astype(np.float32) * 0.6 + 50 + wood[..., None], 0, 255).astype(np.uint8)


def photo(r, angle, glare, blur, fill, rot=7, dim=1.0):
    size = 700
    img = load(r, size)
    s = int(size * fill)
    img = cv2.resize(img, (s, s))
    # Perspective — shot off-axis.
    d = int(s * angle / 100)
    src = np.float32([[0, 0], [s, 0], [s, s], [0, s]])
    dst = np.float32([[d, int(d * .4)], [s - int(d * .3), 0], [s, s - int(d * .5)], [int(d * .2), s]])
    off = (size - s) // 2
    jitter = lambda: random.randint(-off // 2, off // 2) if off > 4 else 0
    dst += np.float32([off + jitter(), off + jitter()])
    H = cv2.getPerspectiveTransform(src, dst)
    canvas = background(size) if fill < 0.98 else np.zeros((size, size, 3), np.uint8)
    warped = cv2.warpPerspective(img, H, (size, size), borderMode=cv2.BORDER_CONSTANT)
    mask = cv2.warpPerspective(np.full((s, s), 255, np.uint8), H, (size, size))
    if fill >= 0.98:
        warped = cv2.warpPerspective(img, H, (size, size), borderMode=cv2.BORDER_REPLICATE)
        mask[:] = 255
    canvas[mask > 0] = warped[mask > 0]
    M = cv2.getRotationMatrix2D((size / 2, size / 2), random.uniform(-rot, rot), 1.0)
    canvas = cv2.warpAffine(canvas, M, (size, size), borderMode=cv2.BORDER_REFLECT)
    if glare:
        ov = np.zeros_like(canvas, np.float32)
        cv2.circle(ov, (random.randint(150, 550), random.randint(150, 550)), 190, (255, 255, 255), -1)
        ov = cv2.GaussianBlur(ov, (221, 221), 0)
        canvas = np.clip(canvas.astype(np.float32) + ov * 0.55, 0, 255).astype(np.uint8)
    if dim != 1.0:
        # Warm, dim room light: lower exposure and a yellow cast.
        canvas = np.clip(canvas.astype(np.float32) * dim * np.float32([0.8, 0.95, 1.1]), 0, 255).astype(np.uint8)
    if blur:
        canvas = cv2.GaussianBlur(canvas, (7, 7), 0)
    canvas = np.clip(canvas.astype(np.int16) + np.random.normal(0, 7, canvas.shape), 0, 255).astype(np.uint8)
    return canvas


CONDITIONS = {
    'straight': dict(angle=3, glare=False, blur=False, fill=1.0),
    'angle': dict(angle=14, glare=False, blur=False, fill=1.0),
    'glare': dict(angle=22, glare=True, blur=False, fill=1.0),
    'soft': dict(angle=18, glare=True, blur=True, fill=1.0),
    'loose-frame': dict(angle=10, glare=False, blur=False, fill=0.75),
    'loose-dim': dict(angle=14, glare=False, blur=True, fill=0.7, dim=0.55),
}

truth = {}
for name, kw in CONDITIONS.items():
    os.makedirs(os.path.join(out, name), exist_ok=True)
    for r in sample:
        cv2.imwrite(os.path.join(out, name, f"{r['id']}.jpg"), photo(r, **kw), [cv2.IMWRITE_JPEG_QUALITY, 75])
for r in sample:
    truth[str(r['id'])] = r['releaseId']
json.dump({'conditions': list(CONDITIONS), 'truth': truth}, open(os.path.join(out, 'truth.json'), 'w'))
print(f'{N} sleeves x {len(CONDITIONS)} conditions -> {out}')
