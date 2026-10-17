"""Find a record's centre label among its Discogs photos, and crop it to its circle.

Discogs doesn't say which photo is the label; they're all just "secondary". Two
separate questions:

  - which photo: a linear probe on DINOv2 embeddings, trained on hand-marked
    releases (tests/labels-truth.json), taking the first photo it's sure of;
  - where in it: circles found in the photo, checked for shape. A close-up has the
    label nearly filling the frame; a whole-record shot has it a third the size of
    the record, with grooves (dark, grey, low-contrast) between. The centre is
    nudged onto the spindle hole so the label doesn't wobble as it spins, and a
    hole a sixth of the disc or more means a CD, which is refused.

    .venv/bin/python -m identify.labels            # measure against tests/labels-truth.json
    .venv/bin/python -m identify.labels --build    # crop new releases' labels into public/labels/
    .venv/bin/python -m identify.labels --build --all   # redo every release
    npm run labels                                 # download, embed and crop: what a new album needs
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

WORK = 480


@dataclass
class Circle:
    """In the original photo's pixels."""

    cx: float
    cy: float
    r: float
    why: str


def _load(path: Path):
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        return None, 1.0
    h, w = img.shape[:2]
    s = WORK / max(h, w)
    small = cv2.resize(img, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
    return small, s


def _disk(r: float) -> np.ndarray:
    n = int(math.ceil(r))
    yy, xx = np.mgrid[-n : n + 1, -n : n + 1]
    k = (np.hypot(xx, yy) <= r).astype(np.float32)
    return k / k.sum()


def _ring(r0: float, r1: float) -> np.ndarray:
    n = int(math.ceil(r1))
    yy, xx = np.mgrid[-n : n + 1, -n : n + 1]
    d = np.hypot(xx, yy)
    k = ((d >= r0) & (d <= r1)).astype(np.float32)
    return k / k.sum()


def _holes(gray: np.ndarray, side: int):
    """Spindle-hole candidates near the middle: a small even disc that differs from
    the ring round it. Returns (score, x, y, radius), best first."""
    g = gray.astype(np.float32)
    h, w = g.shape
    out = []
    for rh in np.geomspace(side * 0.006, side * 0.05, 9):
        inner = cv2.filter2D(g, -1, _disk(rh * 0.75), borderType=cv2.BORDER_REFLECT)
        inner_sq = cv2.filter2D(g * g, -1, _disk(rh * 0.75), borderType=cv2.BORDER_REFLECT)
        ring = cv2.filter2D(g, -1, _ring(rh * 1.35, rh * 2.2), borderType=cv2.BORDER_REFLECT)
        ring_sq = cv2.filter2D(g * g, -1, _ring(rh * 1.35, rh * 2.2), borderType=cv2.BORDER_REFLECT)
        inner_sd = np.sqrt(np.maximum(0, inner_sq - inner * inner))
        ring_sd = np.sqrt(np.maximum(0, ring_sq - ring * ring))
        score = np.abs(inner - ring) / (inner_sd + 0.5 * ring_sd + 6)
        # Only the middle of the photo: labels are photographed centred.
        y0, y1 = int(h / 2 - side * 0.16), int(h / 2 + side * 0.16)
        x0, x1 = int(w / 2 - side * 0.16), int(w / 2 + side * 0.16)
        sub = score[y0:y1, x0:x1]
        for _ in range(3):
            iy, ix = np.unravel_index(np.argmax(sub), sub.shape)
            out.append((float(sub[iy, ix]), x0 + ix, y0 + iy, float(rh)))
            cv2.circle(sub, (int(ix), int(iy)), int(rh * 3), 0, -1)
    out.sort(reverse=True)
    return out


def _hough(gray, lo, hi):
    blur = cv2.GaussianBlur(gray, (5, 5), 1.5)
    found = cv2.HoughCircles(
        blur, cv2.HOUGH_GRADIENT_ALT, dp=1.5, minDist=4, param1=120, param2=0.6,
        minRadius=int(lo), maxRadius=int(hi),
    )
    return [] if found is None else [tuple(map(float, c)) for c in found[0]]


def _rim_at(gray, cx, cy, r, slack=3):
    h, w = gray.shape
    g = cv2.GaussianBlur(gray, (3, 3), 0.8).astype(np.float32)
    angles = np.linspace(0, 2 * math.pi, 180, endpoint=False)
    radii = np.arange(max(2.0, r * 0.75), r * 1.25, 1.0)
    xs = cx + np.outer(np.cos(angles), radii)
    ys = cy + np.outer(np.sin(angles), radii)
    ok = ((xs >= 0) & (xs < w - 1) & (ys >= 0) & (ys < h - 1)).all(axis=1)
    if ok.sum() < 30:
        return 0.0
    vals = cv2.remap(g, xs.astype(np.float32), ys.astype(np.float32), cv2.INTER_LINEAR)[ok]
    step = np.abs(np.diff(vals, axis=1))
    at = np.argmin(np.abs(radii[1:] - r))
    near = step[:, max(0, at - slack) : at + slack + 1].max(axis=1)
    typical = np.median(step, axis=1) + 2
    return float(((near > 2.5 * typical) & (near > 6)).mean())


def locate(path: Path) -> Circle | None:
    """Where the label is in a photo already known to show one."""
    img, s = _load(path)
    if img is None:
        return None
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    side = min(h, w)
    mid = lambda c: math.hypot(c[0] - w / 2, c[1] - h / 2) / side  # noqa: E731
    circles = [c for c in _hough(gray, side * 0.08, side * 0.62) if mid(c) < 0.18]
    scored = [(c, _rim_at(gray, *c)) for c in circles]
    scored = [(c, sup) for c, sup in scored if sup >= 0.45]

    # The whole record in shot: the label is the circle a third the size of the
    # record's edge, sharing its centre.
    for big, big_sup in sorted(scored, key=lambda t: -t[0][2]):
        if big[2] < side * 0.33:
            break
        for small, small_sup in scored:
            ratio = small[2] / big[2]
            if (
                0.26 <= ratio <= 0.42
                and math.hypot(small[0] - big[0], small[1] - big[1]) < big[2] * 0.05
                and _vinyl(img, small[0], small[1], small[2] * 1.15, big[2] * 0.9)
            ):
                return _centre_on_hole(gray, Circle(small[0] / s, small[1] / s, small[2] / s,
                                                    f'whole record, rim {small_sup:.2f}'), s)

    # A close-up: the label nearly fills the frame.
    close = [(c, sup) for c, sup in scored if c[2] >= side * 0.3 and mid(c) < 0.1]
    if close:
        c, sup = max(close, key=lambda t: t[1] + t[0][2] / side)
        return _centre_on_hole(gray, Circle(c[0] / s, c[1] / s, c[2] / s, f'close-up, rim {sup:.2f}'), s)
    # The whole record in shot but its edge out of frame or lost: a small circle in
    # the middle with grooves all round it.
    small = [
        (c, sup) for c, sup in scored
        if side * 0.1 <= c[2] < side * 0.3 and sup >= 0.6 and _vinyl(img, c[0], c[1], c[2] * 1.2, c[2] * 2.4)
    ]
    if small:
        c, sup = max(small, key=lambda t: t[1])
        return _centre_on_hole(gray, Circle(c[0] / s, c[1] / s, c[2] / s, f'record, rim {sup:.2f}'), s)
    # Most label close-ups are cropped to the label: the circle the frame holds.
    return _centre_on_hole(gray, Circle(w / 2 / s, h / 2 / s, side * 0.49 / s, 'the frame'), s)


def _vinyl(img, cx, cy, r0, r1):
    """Does the band between two radii look like a record's grooves round a label:
    dark, grey and low-contrast, unlike the label inside it? A label's own printed
    rings fail the first; a black label photographed close fails the second."""
    h, w = img.shape[:2]
    yy, xx = np.ogrid[:h, :w]
    d = np.hypot(xx - cx, yy - cy)
    band = (d >= r0) & (d <= r1)
    label = (d >= r0 * 0.3) & (d <= r0 * 0.75)
    if band.sum() < 50 or label.sum() < 20:
        return False
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    v = hsv[..., 2][band]
    grooves = float(np.median(v)) < 90 and float(np.median(hsv[..., 1][band])) < 70 and float(v.std()) < 55
    stands_out = (
        abs(float(np.median(hsv[..., 2][label])) - float(np.median(v))) > 40
        or float(np.median(hsv[..., 1][label])) - float(np.median(hsv[..., 1][band])) > 50
    )
    return grooves and stands_out


def _centre_on_hole(gray, c: Circle, s: float) -> Circle:
    """Nudge the centre onto the spindle hole when there clearly is one nearby, so the
    label doesn't wobble as it spins."""
    cx, cy, r = c.cx * s, c.cy * s, c.r * s
    h, w = gray.shape
    for score, hx, hy, rh in _holes(gray, min(h, w))[:6]:
        if score >= 3 and math.hypot(hx - cx, hy - cy) < r * 0.06 and 0.03 < rh / r < 0.12:
            return Circle(hx / s, hy / s, c.r, c.why + ', on the hole')
    return c


# ---------------------------------------------------------------------------
# Which photo is the label: a linear probe on the DINOv2 embeddings the app already
# uses for sleeves, trained on the hand-marked releases. Measured leave-one-release-
# out on those 60: at 0.7, 58 of 59 labels found, the one release without a label
# left blank, none wrong. CDs and inner sleeves score high too, but Discogs lists
# the labels before them, and the first label photo wins.

THRESHOLD = 0.7


def _fit(X, y, l2=1.0, steps=3000, lr=0.5):
    w = np.zeros(X.shape[1])
    b = 0.0
    weight = np.where(y == 1, (len(y) - y.sum()) / y.sum(), 1.0)
    weight /= weight.mean()
    for _ in range(steps):
        p = 1 / (1 + np.exp(-(X @ w + b)))
        e = (p - y) * weight
        w -= lr * (X.T @ e / len(y) + l2 * w / len(y))
        b -= lr * e.mean()
    return w, b


def _training(embed: dict, truth: dict):
    X, y, groups = [], [], []
    for rid, ok in truth.items():
        for key in sorted((k for k in embed if k.split('_')[0] == rid), key=lambda k: int(k.split('_')[1])):
            X.append(embed[key])
            y.append(int(int(key.split('_')[1]) in ok))
            groups.append(rid)
    return np.array(X), np.array(y, dtype=float), np.array(groups)


def classifier(embed: dict, truth: dict):
    X, y, _ = _training(embed, truth)
    w, b = _fit(X, y)
    return lambda v: float(1 / (1 + np.exp(-(np.asarray(v) @ w + b))))


def _cd_hole(path: Path, c: Circle) -> bool:
    """A hole a sixth of the disc or more: a CD, not a record."""
    img, s = _load(path)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    for score, hx, hy, rh in _holes(gray, min(gray.shape))[:6]:
        if score >= 3 and math.hypot(hx - c.cx * s, hy - c.cy * s) < c.r * s * 0.08 and rh / (c.r * s) > 0.16:
            return True
    return False


def choose(release_id: int, src: Path, embed: dict, prob) -> tuple[int, Circle, float] | None:
    keys = sorted((k for k in embed if k.split('_')[0] == str(release_id)), key=lambda k: int(k.split('_')[1]))
    for key in keys:
        p = prob(embed[key])
        if p < THRESHOLD:
            continue
        path = src / f'{key}.jpg'
        c = locate(path)
        if c and not _cd_hole(path, c):
            return int(key.split('_')[1]), c, p
    return None


def crop(path: Path, c: Circle, out: Path, size: int = 320):
    """The label alone, as a square WebP with everything outside the circle cleared."""
    from PIL import Image, ImageDraw

    im = Image.open(path).convert('RGB')
    # A hair inside the rim, so no vinyl or background shows round the edge.
    r = c.r * 0.97
    box = (round(c.cx - r), round(c.cy - r), round(c.cx + r), round(c.cy + r))
    square = im.crop(box).resize((size, size), Image.LANCZOS).convert('RGBA')
    mask = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    square.putalpha(mask.resize((size, size), Image.LANCZOS))
    square.save(out, 'WEBP', quality=80, method=6)


if __name__ == '__main__':
    import json
    import sys

    root = Path(__file__).resolve().parent.parent
    src = root / 'data/label-src'
    truth = json.loads((root / 'identify/tests/labels-truth.json').read_text())
    truth.pop('_about')
    embed = json.loads((root / 'data/label-src-embed.json').read_text())

    if '--build' in sys.argv:
        # Only releases not decided yet (new ones since the last run), unless --all,
        # which is for after the detector or the hand-marked set changes.
        out = root / 'public/labels'
        out.mkdir(parents=True, exist_ok=True)
        record = root / 'data/labels.json'
        everything = '--all' in sys.argv
        decided = {} if everything or not record.exists() else json.loads(record.read_text())
        prob = classifier(embed, truth)
        releases = sorted({k.split('_')[0] for k in embed})
        todo = [r for r in releases if r not in decided]
        for rid in todo:
            got = choose(int(rid), src, embed, prob)
            if got:
                n, c, p = got
                crop(src / f'{rid}_{n}.jpg', c, out / f'{rid}.webp')
                decided[rid] = {'photo': n, 'p': round(p, 3), 'how': c.why}
            else:
                decided[rid] = None
                (out / f'{rid}.webp').unlink(missing_ok=True)
        record.write_text(json.dumps(decided, indent=1))
        have = sum(1 for v in decided.values() if v)
        print(f'{len(todo)} looked at; {have} of {len(decided)} releases have a label')
        sys.exit(0)

    # Leave-one-release-out: each release judged by a probe that never saw it.
    X, y, groups = _training(embed, truth)
    right = wrong = missed = none_ok = 0
    for rid, ok in truth.items():
        m = groups == rid
        w, b = _fit(X[~m], y[~m])
        got = choose(int(rid), src, embed, lambda v: float(1 / (1 + np.exp(-(np.asarray(v) @ w + b)))))
        n = got[0] if got else None
        if n is None:
            verdict = 'ok (none)' if not ok else 'MISSED'
            none_ok += not ok
            missed += bool(ok)
        elif n in ok:
            verdict = 'ok'
            right += 1
        else:
            verdict = 'WRONG'
            wrong += 1
        if verdict != 'ok' or '-v' in sys.argv:
            print(f'{rid:>9} {verdict:10} got {n} want {ok} {got[1].why if got else ""}')
    print(f'\n{right} right, {none_ok} rightly none, {missed} missed, {wrong} WRONG of {len(truth)}')
    sys.exit(1 if wrong else 0)
