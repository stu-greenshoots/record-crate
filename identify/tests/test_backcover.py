"""
Can the back-cover reader recover a catalogue number and a title?

Run: .venv/bin/python -m identify.tests.test_backcover

These are rendered sleeves, not photographs — see backs.py. A pass here means the
pipeline is correctly wired and the resolution arithmetic holds; it says nothing
about wear, shop lighting or artwork printed behind the text.
"""
import random
import re
import sys

import cv2

sys.path.insert(0, '.')
from identify import backcover as B
from identify.tests import backs


def norm(s):
    return re.sub(r'[^A-Z0-9]', '', (s or '').upper())


CONFUSED = str.maketrans({'O': '0', 'I': '1', 'L': '1', 'S': '5', 'B': '8', 'Z': '2'})


def fuzzy(s):
    return norm(s).translate(CONFUSED)


def found_catno(result, truth):
    """Match the way the server will: loosely, against a known catalogue number."""
    got = [c['value'] for c in result.get('catalogueNumbers', [])]
    exact = any(norm(g) == norm(truth) for g in got)
    loose = any(fuzzy(g) == fuzzy(truth) for g in got)
    rank = next((i for i, g in enumerate(got) if fuzzy(g) == fuzzy(truth)), None)
    return exact, loose, rank


def found_title(result, artist, title):
    hay = norm(' '.join(p['text'] for p in result.get('phrases', [])))
    return norm(title) in hay, norm(artist) in hay


CONDITIONS = [
    ('flat on, good light', dict()),
    ('moderate angle', dict(angle=10, quality=82)),
    ('angle + glare', dict(angle=16, glare=True, quality=78)),
    ('angle + glare + soft focus', dict(angle=16, glare=True, blur=1, quality=72)),
]


def run():
    rng = random.Random(7)
    print(f"{'condition':<30} {'catno exact':>12} {'catno fuzzy':>12} {'title':>8} {'artist':>8}")
    print('-' * 74)
    for name, kw in CONDITIONS:
        ex = lo = ti = ar = 0
        ranks = []
        for artist, title, catno, label, tracks in backs.SAMPLES:
            sleeve = backs.render(artist, title, catno, label, tracks)
            photo = backs.photograph(sleeve, rng=rng, **kw)
            cv2.imwrite('/tmp/back.jpg', photo)
            r = B.read_back('/tmp/back.jpg')
            e, l, rank = found_catno(r, catno)
            t, a = found_title(r, artist, title)
            ex += e; lo += l; ti += t; ar += a
            if rank is not None:
                ranks.append(rank + 1)
        n = len(backs.SAMPLES)
        rank_note = f"  (median rank {sorted(ranks)[len(ranks)//2]})" if ranks else ''
        print(f"{name:<30} {ex:>8}/{n}    {lo:>8}/{n}   {ti:>4}/{n}  {ar:>4}/{n}{rank_note}")


def sweep():
    """
    The resolution relationship, which is the part that does transfer to real photos.

    Glyph size in pixels is what tesseract sees, so shrinking the capture is
    equivalent to photographing from further away.
    """
    print(f"\n{'px across sleeve':>18} {'catno read':>12}   effective")
    print('-' * 52)
    for scale in (0.25, 0.375, 0.5, 0.75, 1.0):
        ok = 0
        for artist, title, catno, label, tracks in backs.SAMPLES:
            sleeve = backs.render(artist, title, catno, label, tracks)
            photo = backs.photograph(sleeve, scale=scale, rng=random.Random(3))
            cv2.imwrite('/tmp/back.jpg', photo)
            r = B.read_back('/tmp/back.jpg')
            _, loose, _ = found_catno(r, catno)
            ok += loose
        across = round(backs.SIDE * scale)
        mp = (across * across) / 1e6
        print(f"{across:>18} {ok:>8}/{len(backs.SAMPLES)}   ~{mp:.1f} MP of sleeve")


if __name__ == '__main__':
    run()
    sweep()
