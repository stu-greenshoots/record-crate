"""Resize cached covers for the static bundle and report each one's average colour.

Called by scripts/export.mjs with a JSON list of {src, dst}; prints {dst: "rgb(...)"}.
"""
import json
import os
import sys

from PIL import Image

SIZE = 360  # enough for a sharp card on a phone and for matching against

jobs = json.load(open(sys.argv[1]))
colours = {}
for job in jobs:
    try:
        im = Image.open(job['src']).convert('RGB')
    except Exception:
        continue
    im.thumbnail((SIZE, SIZE), Image.LANCZOS)
    if not os.path.exists(job['dst']):
        im.save(job['dst'], 'JPEG', quality=82, optimize=True, progressive=True)
    r, g, b = im.resize((1, 1), Image.BOX).getpixel((0, 0))
    colours[job['dst']] = f'rgb({r},{g},{b})'
print(json.dumps(colours))
