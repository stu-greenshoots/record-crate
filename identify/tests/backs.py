"""
Generate back covers to read, and distort them into phone photos.

This is a *sanity check*, not a validation set. A rendered sleeve has clean type
on a flat ground, no wear, no shop lighting and no artwork competing with the
text, so a good score here means the pipeline is wired up correctly — it does not
mean it works in a record shop. Only real photographs can show that.

What it is genuinely good for is the resolution relationship, because that is
governed by glyph size in pixels and nothing else: see `sweep()`.

Needs Pillow (`.venv/bin/pip install Pillow`), which the reader itself does not.
"""
from __future__ import annotations

import random

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

# A 12" sleeve rendered at 200 px/inch, which is what a phone gets from arm's length.
PPI = 200
SLEEVE_IN = 12
SIDE = PPI * SLEEVE_IN

FONT = '/System/Library/Fonts/Supplemental/Arial.ttf'
FONT_BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'


def _pt(points: float) -> int:
    """Type size in points -> pixels at our rendering resolution."""
    return max(1, round(points / 72 * PPI))


def render(artist: str, title: str, catno: str, label: str, tracks: list[str],
           dark: bool = False) -> np.ndarray:
    """Lay out a plausible back cover: big title, small tracks, catno in a corner."""
    bg, fg = ((18, 18, 20), (232, 230, 226)) if dark else ((238, 235, 228), (24, 22, 20))
    img = Image.new('RGB', (SIDE, SIDE), bg)
    d = ImageDraw.Draw(img)

    big = ImageFont.truetype(FONT_BOLD, _pt(34))
    mid = ImageFont.truetype(FONT_BOLD, _pt(22))
    body = ImageFont.truetype(FONT, _pt(9))
    small = ImageFont.truetype(FONT, _pt(6.5))

    m = _pt(30)
    d.text((m, m), artist.upper(), font=big, fill=fg)
    d.text((m, m + _pt(46)), title, font=mid, fill=fg)

    # Two columns of tracks, the way a real sleeve sets a listing.
    y0 = m + _pt(86)
    half = (len(tracks) + 1) // 2
    for col, chunk in enumerate((tracks[:half], tracks[half:])):
        x = m + col * (SIDE - 2 * m) // 2
        for i, t in enumerate(chunk):
            d.text((x, y0 + i * _pt(15)), f"{col * half + i + 1}. {t}", font=body, fill=fg)

    # A credits block in the small type that fills the bottom of most sleeves.
    credits = [
        'Produced by the artist. Engineered at Trident Studios, London.',
        'All titles published by the label. Sleeve design and photography.',
        'Manufactured and distributed under exclusive licence.',
        f'{label}. All rights of the manufacturer reserved.',
    ]
    for i, line in enumerate(credits):
        d.text((m, SIDE - m - _pt(40) + i * _pt(9)), line, font=small, fill=fg)

    # The catalogue number, stranded in a corner in the smallest type on the sleeve.
    d.text((SIDE - m - _pt(90), SIDE - m - _pt(8)), catno, font=small, fill=fg)

    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)


def photograph(sleeve: np.ndarray, *, angle: float = 0.0, glare: bool = False,
               blur: int = 0, quality: int = 88, scale: float = 1.0,
               rng: random.Random | None = None) -> np.ndarray:
    """Turn a flat render into something like a hand-held photo of it."""
    rng = rng or random.Random(0)
    h, w = sleeve.shape[:2]

    if scale != 1.0:
        w, h = round(w * scale), round(h * scale)
        sleeve = cv2.resize(sleeve, (w, h), interpolation=cv2.INTER_AREA)

    # Sit the sleeve on a larger ground so there is a border to find it against.
    pad = round(max(w, h) * 0.12)
    frame = np.full((h + 2 * pad, w + 2 * pad, 3), 70, np.uint8)
    frame[pad:pad + h, pad:pad + w] = sleeve

    if angle:
        k = angle / 45.0
        src = np.float32([[pad, pad], [pad + w, pad], [pad + w, pad + h], [pad, pad + h]])
        shift = k * w * 0.14
        dst = np.float32([
            [pad + shift, pad + abs(shift) * 0.35],
            [pad + w - shift * 0.2, pad - abs(shift) * 0.1],
            [pad + w - shift * 0.6, pad + h + abs(shift) * 0.1],
            [pad + shift * 0.3, pad + h - abs(shift) * 0.35],
        ])
        frame = cv2.warpPerspective(
            frame, cv2.getPerspectiveTransform(src, dst),
            (frame.shape[1], frame.shape[0]), borderMode=cv2.BORDER_REPLICATE)

    if glare:
        gh, gw = frame.shape[:2]
        yy, xx = np.mgrid[0:gh, 0:gw]
        cx, cy = gw * rng.uniform(0.3, 0.7), gh * rng.uniform(0.2, 0.5)
        spot = np.exp(-(((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * (gw * 0.22) ** 2)))
        frame = np.clip(frame + (spot * 95)[..., None], 0, 255).astype(np.uint8)

    if blur:
        frame = cv2.GaussianBlur(frame, (blur * 2 + 1, blur * 2 + 1), 0)

    ok, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return cv2.imdecode(buf, cv2.IMREAD_COLOR) if ok else frame


SAMPLES = [
    ('Judas Priest', 'Sad Wings Of Destiny', 'GULP 1015', 'Gull Records',
     ['Victim Of Changes', 'The Ripper', 'Dreamer Deceiver', 'Deceiver',
      'Prelude', 'Tyrant', 'Genocide', 'Epitaph', 'Island Of Domination']),
    ('Dire Straits', 'Making Movies', '6359 034', 'Vertigo',
     ['Tunnel Of Love', 'Romeo And Juliet', 'Skateaway', 'Expresso Love',
      'Hand In Hand', 'Solid Rock', 'Les Boys']),
    ('Henry Cow', 'In Praise Of Learning', 'V2027', 'Virgin',
     ['War', 'Living In The Heart Of The Beast', 'Beginning: The Long March',
      'Beautiful As The Moon', 'Morning Star']),
    ('Gong', "Angel's Egg", 'OVED 15', 'Virgin',
     ['Other Side Of The Sky', 'Sold To The Highest Buddha', 'Castle In The Clouds',
      'Prostitute Poem', 'Givin My Luv To You', 'Selene', 'Flute Salad',
      'Oily Way', 'Outer Temple', 'Inner Temple']),
    ('Led Zeppelin', 'Houses Of The Holy', 'K 50014', 'Atlantic',
     ['The Song Remains The Same', 'The Rain Song', 'Over The Hills And Far Away',
      'The Crunge', 'Dancing Days', "D'yer Mak'er", 'No Quarter', 'The Ocean']),
]
