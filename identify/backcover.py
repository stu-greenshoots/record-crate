"""
Reading the back of a sleeve.

The front of a record sleeve is artwork — stylised, illustrated, often
hand-lettered — and OCR of it is a dead end, measured and abandoned. The back is
a different object: track listings, credits and a catalogue number, all set in
ordinary type by a typesetter who wanted them read.

Two measurements shape everything here (HANDOVER.md, discovery pass 2026-08-18):

1. Tesseract needs about 16px of type. A catalogue number is 6-8pt, so a 12"
   sleeve has to be captured at roughly 1700-2300px across — 3-5 MP. A phone
   clears that threefold, which is why this works at all, and why nothing in this
   module is ever allowed to downscale the photo before reading it.

2. What comes back at that resolution is not garbage but *shape confusions* —
   MOSH079FDR read as MOSHO79FDR, V2027 as V2O27. So this module's job is to
   produce candidate strings, not answers. Resolving them against Discogs'
   catalogue-number index is the caller's job, and it should match loosely.

The catalogue number matters because it is the one thing on a sleeve that names
a specific pressing. It is near-unique: across the 609 releases in the cached
collection there are 752 distinct catnos and 3 collisions.
"""

from __future__ import annotations

import csv
import io
import re
import subprocess
from dataclasses import dataclass, field

import cv2
import numpy as np

from .text import find_sleeve_quad

# A catalogue number is a short letter-ish prefix and a run of digits, sometimes
# split by a space or dash, sometimes with a trailing suffix: "SHVL 804",
# "6360 050", "MOSH079FDR", "K 56026", "V2027", "675 890-1".
CATNO = re.compile(
    r'^(?:'
    r'[A-Z]{1,4}[-. ]?[A-Z]{0,4}[-. ]?\d{2,6}(?:[-. ]?\d{1,4})?[A-Z]{0,4}'  # SHVL 804, S DGL 69014
    r'|\d{3,4}[-. ]\d{3,4}(?:[-. ]?\d{1,2})?'                # 6360 050, 675 890-1
    r')$'
)
BARCODE = re.compile(r'^\d{12,13}$')

# Punctuation Tesseract substitutes for small or worn letters.
GLYPH_SLIPS = str.maketrans({'$': 'S', '§': 'S', '£': 'E', '|': 'I', '¢': 'C', '€': 'E', '@': 'O'})

# Things shaped like a catalogue number that never are one.
NOT_A_CATNO = re.compile(
    r'^(?:'
    r'(?:19|20)\d{2}'                                        # a year
    r'|\d{1,2}[-. ]\d{2}'                                    # a track time
    r'|(?:SIDE|TRACK|BAND|VOL|NO|LP|EP|RPM|STEREO|MONO)[-. ]?\d{0,3}'
    r'|33[-. ]?13|45|78'                                     # speeds
    r')$'
)

# Words that are never part of an artist or album name, so a "big type" line made
# only of these is furniture rather than an identity.
FURNITURE = {
    'SIDE', 'ONE', 'TWO', 'STEREO', 'MONO', 'RECORDS', 'RECORD', 'LTD', 'INC',
    'MADE', 'IN', 'ENGLAND', 'USA', 'GERMANY', 'PRINTED', 'ALL', 'RIGHTS',
    'RESERVED', 'PRODUCED', 'BY', 'THE', 'AND', 'A', 'OF', 'LONG', 'PLAY',
}


@dataclass
class Read:
    """Everything one pass of the OCR saw, before any of it is resolved."""
    catnos: list[dict] = field(default_factory=list)
    barcodes: list[str] = field(default_factory=list)
    phrases: list[dict] = field(default_factory=list)
    lines: list[str] = field(default_factory=list)
    pixels_across: int = 0


def flatten(image: np.ndarray, max_side: int = 3600) -> np.ndarray:
    """
    Straighten the sleeve without throwing away resolution.

    Tesseract is trained on flat scanned pages, so removing the perspective of a
    hand-held photo is worth more than any parameter tuning. The warp target is
    sized from the sleeve as it was actually captured, not a fixed 1000px box —
    downscaling here would undo the only thing that makes the small type legible.
    """
    quad = find_sleeve_quad(image)
    if quad is None:
        return image

    # Size the output to the longest edge of the sleeve as photographed, so a
    # close-up stays sharp and a distant shot isn't upscaled into mush.
    edges = [np.linalg.norm(quad[i] - quad[(i + 1) % 4]) for i in range(4)]
    side = int(min(max(edges), max_side))
    if side < 400:
        return image

    target = np.float32([[0, 0], [side, 0], [side, side], [0, side]])
    return cv2.warpPerspective(
        image, cv2.getPerspectiveTransform(quad, target), (side, side),
        flags=cv2.INTER_CUBIC,
    )


def text_regions(grey: np.ndarray, limit: int = 45) -> list[tuple[int, int, int, int]]:
    """
    Find the patches of a sleeve that look like set type, as (x, y, w, h).

    This is the step that makes the whole thing work on a real photograph. Handed a
    whole sleeve, Tesseract's own layout analysis never isolates a catalogue number
    stranded in a corner of a painting — it reads the artwork as text and returns
    soup. Given the same number pre-cut as a line, it reads it correctly.

    Text is found by its texture rather than its shape: closely-spaced strokes give
    a dense run of local intensity gradient, which dilating horizontally joins into
    a word or a line, while a photograph or a flat ground does not.
    """
    scale = 1400 / max(grey.shape[:2])
    work = cv2.resize(grey, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else grey
    ratio = grey.shape[1] / work.shape[1]

    grad = cv2.morphologyEx(work, cv2.MORPH_GRADIENT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    _, binary = cv2.threshold(grad, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # Join neighbouring strokes into words and words into lines.
    joined = cv2.morphologyEx(
        binary, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (18, 3))
    )

    contours, _ = cv2.findContours(joined, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        if h < 7 or w < 12:
            continue                          # too small to be readable type
        if w / h > 60:
            continue                          # a rule or a border, not a word
        # A blob may be several lines stacked — a catalogue number above a logo
        # above "Estereo" — and Tesseract can only read one line at a time.
        for ly, lh in _split_into_lines(binary[y:y + h, x:x + w]):
            band = binary[y + ly:y + ly + lh, x:x + w]
            # How much of the band is actually stroke: type is sparse, texture is dense.
            ink = band.mean() / 255
            if not 0.04 < ink < 0.7:
                continue
            boxes.append((
                int(x * ratio), int((y + ly) * ratio),
                int(w * ratio), int(lh * ratio), w * lh,
            ))

    boxes.sort(key=lambda b: -b[4])
    return [b[:4] for b in boxes[:limit]]


def _split_into_lines(patch: np.ndarray) -> list[tuple[int, int]]:
    """
    Split a binary patch into horizontal bands of type, as (y, height).

    Rows carrying strokes stand out against the blank rows between lines, so the
    row-wise ink profile separates them without needing to know the type size.
    """
    if patch.shape[0] < 7:
        return [(0, patch.shape[0])]
    profile = patch.mean(axis=1) / 255
    threshold = max(0.02, profile.max() * 0.18)

    bands, start = [], None
    for i, value in enumerate(profile):
        if value >= threshold and start is None:
            start = i
        elif value < threshold and start is not None:
            if i - start >= 7:
                bands.append((start, i - start))
            start = None
    if start is not None and len(profile) - start >= 7:
        bands.append((start, len(profile) - start))

    # A single unbroken band means it was one line all along.
    return bands or [(0, patch.shape[0])]


def _tsv(image: np.ndarray, psm: int) -> list[dict]:
    """Run tesseract in TSV mode, which reports a box and a confidence per word."""
    ok, buf = cv2.imencode('.png', image)
    if not ok:
        return []
    try:
        result = subprocess.run(
            ['tesseract', 'stdin', 'stdout', '--psm', str(psm), 'tsv'],
            input=buf.tobytes(), capture_output=True, timeout=60,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return []

    rows = []
    text = result.stdout.decode('utf-8', 'ignore')
    for row in csv.DictReader(io.StringIO(text), delimiter='\t', quoting=csv.QUOTE_NONE):
        word = (row.get('text') or '').strip()
        if not word:
            continue
        try:
            conf = float(row.get('conf', -1))
            rows.append({
                'text': word,
                'conf': conf,
                'left': int(row['left']), 'top': int(row['top']),
                'width': int(row['width']), 'height': int(row['height']),
                'line': (row['block_num'], row['par_num'], row['line_num']),
            })
        except (ValueError, KeyError, TypeError):
            continue
    return rows


def _prepare(image: np.ndarray) -> np.ndarray:
    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    return cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(grey)


# Tesseract wants roughly this much of a glyph; regions are scaled up to reach it.
TARGET_GLYPH_PX = 40


def _whole_frame(grey: np.ndarray) -> list[dict]:
    """
    Read the frame as a whole, at more than one scale.

    Scale is the thing that decides whether Tesseract reads a photograph at all,
    and it cuts both ways. Type set small needs every pixel the camera captured;
    type photographed close up needs *fewer*, because a 300px-tall glyph is as
    unreadable to Tesseract as a 5px one. A close-up of a record label read as
    nothing at 3072px and as a clean "S DGL 69014" at 1075px.

    We don't know which case we have until we've read it, so read at both a
    reduced and a near-native size and let the candidates compete.
    """
    frame = max(grey.shape[:2])
    scales = {1.0}
    for target in (1300, 2600):
        if frame > target * 1.2:
            scales.add(target / frame)

    words: list[dict] = []
    for n, scale in enumerate(sorted(scales)):
        view = (
            cv2.resize(grey, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            if scale < 1 else grey
        )
        for psm in (3, 11):
            for row in _tsv(view, psm):
                words.append({
                    **row,
                    'left': int(row['left'] / scale), 'top': int(row['top'] / scale),
                    'width': int(row['width'] / scale), 'height': int(row['height'] / scale),
                    # Keep each pass's lines separate so they don't interleave.
                    'line': (f'w{n}p{psm}',) + tuple(row['line'][1:]),
                })
    return words


def _read_regions(grey: np.ndarray, regions: list[tuple[int, int, int, int]]) -> list[dict]:
    """
    Read each candidate region as a single line, in the original image's coordinates.

    psm 13 — raw line, no layout analysis at all — is what actually reads a
    catalogue number off a real sleeve. On the *It's A Beautiful Day* photo the
    number sat in the corner of the painting at about 20px; every page-level mode
    returned nothing, and psm 13 on the isolated line returned "$-63722".
    """
    words: list[dict] = []
    for index, (x, y, w, h) in enumerate(regions):
        pad = max(3, h // 4)
        y0, y1 = max(0, y - pad), min(grey.shape[0], y + h + pad)
        x0, x1 = max(0, x - pad), min(grey.shape[1], x + w + pad)
        patch = grey[y0:y1, x0:x1]
        if patch.size == 0:
            continue

        factor = min(6.0, max(1.0, TARGET_GLYPH_PX / max(1, h)))
        if factor > 1.01:
            patch = cv2.resize(patch, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)
        patch = cv2.normalize(patch, None, 0, 255, cv2.NORM_MINMAX)

        # Sleeves are as often light-on-dark as dark-on-light, and Tesseract only
        # reads the latter, so try both and keep whichever is more confident.
        best: list[dict] = []
        for candidate in (patch, cv2.bitwise_not(patch)):
            rows = _tsv(candidate, 13)
            if _confidence(rows) > _confidence(best):
                best = rows

        for row in best:
            words.append({
                **row,
                'left': x0 + int(row['left'] / factor),
                'top': y0 + int(row['top'] / factor),
                'width': int(row['width'] / factor),
                'height': int(row['height'] / factor),
                # Each region is its own line; nothing here spans two of them.
                'line': ('region', index, 0),
            })
    return words


def _confidence(rows: list[dict]) -> float:
    """Total confidence weighted by how much text was found, for picking a polarity."""
    return sum(r['conf'] * len(r['text']) for r in rows if r['conf'] > 0)


def _visual_lines(words: list[dict]) -> list[list[dict]]:
    """
    Group words into the lines a reader would see.

    Tesseract's own line numbering merges runs that sit close together, and a
    perspective-corrected photo makes that common: the artist and the title come
    back as one line, and sorting by x then interleaves them into
    "JUDAS Sad Wings Of PRIEST Destiny". Clustering by vertical centre first, and
    only then reading left to right, keeps the two apart.
    """
    grouped: dict[tuple, list[dict]] = {}
    for w in words:
        grouped.setdefault(w['line'], []).append(w)

    lines: list[list[dict]] = []
    for members in grouped.values():
        members.sort(key=lambda w: w['top'] + w['height'] / 2)
        run: list[dict] = []
        for w in members:
            centre = w['top'] + w['height'] / 2
            if run:
                prev = run[-1]
                gap = centre - (prev['top'] + prev['height'] / 2)
                if gap > 0.6 * max(prev['height'], w['height']):
                    lines.append(sorted(run, key=lambda x: x['left']))
                    run = []
            run.append(w)
        if run:
            lines.append(sorted(run, key=lambda x: x['left']))
    return lines


def _catno_candidates(words: list[dict], frame: int) -> list[dict]:
    """
    Pull catalogue-number-shaped strings out of the words.

    Catalogue numbers are frequently typeset with a space ("CFP 40243"), which
    tesseract reports as two words, so adjacent pairs on the same line are tried
    as well as single words.
    """
    found: dict[str, dict] = {}

    def offer(text: str, parts: list[dict]) -> None:
        # Tesseract reaches for punctuation when a letter is small or worn: the S of
        # "S-63722" came back as "$". Put those back before testing the shape.
        text = text.upper().translate(GLYPH_SLIPS).strip(' .,;:|-')
        squashed = re.sub(r'\s+', ' ', text)
        if not CATNO.match(squashed) or NOT_A_CATNO.match(squashed.replace(' ', '')):
            return
        if not any(c.isdigit() for c in squashed):
            return
        conf = min(p['conf'] for p in parts)
        if conf < 40:
            return
        # Rank by how confident the read is and how many digits it carries: a real
        # catalogue number has four to six, so a longer digit run is both more
        # distinctive and less likely to be a coincidence in the artwork. Position
        # and size are deliberately not used — the number is big and central in a
        # close-up of it, small and in a corner on a whole sleeve, and a prior that
        # fits one framing fights the other. Discogs is the final arbiter anyway.
        digits = sum(c.isdigit() for c in squashed)
        prior = conf + 8 * digits + 2 * len(squashed)
        best = found.get(squashed)
        if best is None or prior > best['score']:
            found[squashed] = {
                'value': squashed,
                'confidence': round(conf, 1),
                'score': round(prior, 1),
                'height': max(p['height'] for p in parts),
            }

    for line_words in _visual_lines(words):
        for i, w in enumerate(line_words):
            # A catalogue number is typeset with spaces as often as not, and each
            # gap makes it another word to Tesseract: "S DGL 69014" is three.
            for span in (1, 2, 3):
                if i + span > len(line_words):
                    break
                parts = line_words[i:i + span]
                offer(' '.join(p['text'] for p in parts), parts)

    return sorted(found.values(), key=lambda c: -c['score'])


def _phrases(words: list[dict]) -> list[dict]:
    """
    The largest type on a back cover is the artist and the album title.

    Ranking lines by glyph height rather than by length is the point: the title
    is set big and short, and a length-ranked list surfaces the credits block.
    """
    out = []
    for line_words in _visual_lines([w for w in words if w['conf'] >= 45]):
        text = ' '.join(w['text'] for w in line_words).strip()
        letters = sum(c.isalpha() for c in text)
        if len(text) < 4 or letters < len(text) * 0.55:
            continue
        # Artwork misread as text comes back big and unconfident, and because these
        # are ranked by type size it would otherwise sit at the top of the list.
        if float(np.mean([w['conf'] for w in line_words])) < 62:
            continue
        # Real words have vowels; texture read as type tends not to.
        if not re.search(r'[AEIOUaeiou]', text):
            continue
        if all(w.strip('.,()').upper() in FURNITURE for w in text.split()):
            continue
        out.append({
            'text': text,
            'height': int(np.median([w['height'] for w in line_words])),
            'confidence': round(float(np.mean([w['conf'] for w in line_words])), 1),
        })

    out.sort(key=lambda p: -p['height'])
    seen, unique = set(), []
    for p in out:
        key = re.sub(r'[^a-z0-9]', '', p['text'].lower())
        if key and key not in seen:
            seen.add(key)
            unique.append(p)
    return unique


def read_back(path: str, deskew: bool = True) -> dict:
    """
    Read a photograph of the back of a sleeve.

    Returns candidates, not conclusions: catalogue numbers ranked by how likely
    each is to be the real one, and the biggest lines of type for a text search
    when no catalogue number survives.
    """
    image = cv2.imread(path, cv2.IMREAD_COLOR)
    if image is None:
        return {'error': 'could not read the photo'}

    flat = flatten(image) if deskew else image
    prepared = _prepare(flat)
    frame = max(prepared.shape[:2])

    # Read the whole frame first, at a size that puts ordinary type in Tesseract's
    # range. This is the cheap pass and it is the one that handles the photograph
    # worth encouraging — a close-up of the catalogue number itself, where there is
    # no layout to analyse and the type is already large.
    words = _whole_frame(prepared)
    catnos = _catno_candidates(words, frame)

    # A confident, digit-rich read is almost certainly the number and needs no more
    # work. Anything less — nothing found, or only a weak partial like "O97" — is
    # worth the slow pass that cuts the type out of the picture and reads it line by
    # line, which rescues a number set small in a corner where whole-frame OCR reads
    # the artwork instead.
    strong = catnos and catnos[0]['confidence'] >= 75 and sum(
        c.isdigit() for c in catnos[0]['value']
    ) >= 4
    if not strong:
        words += _read_regions(prepared, text_regions(prepared))
        catnos = _catno_candidates(words, frame)

    phrases = _phrases(words)
    barcodes = [w['text'] for w in words if BARCODE.match(w['text'])]

    rendered = []
    for line_words in _visual_lines(words):
        text = ' '.join(w['text'] for w in line_words).strip()
        if len(text) >= 3:
            rendered.append(text)

    return {
        'catalogueNumbers': [
            {k: v for k, v in c.items() if k != 'height'} for c in catnos[:8]
        ],
        'barcodes': list(dict.fromkeys(barcodes))[:3],
        'phrases': phrases[:8],
        # For a text search, trust confidence over size — the biggest thing on a
        # sleeve is as likely to be artwork misread as it is to be the title.
        'searchTerms': ' '.join(
            p['text'] for p in sorted(phrases, key=lambda p: -p['confidence'])[:2]
        )[:120],
        'lines': rendered[:60],
        'pixelsAcross': frame,
        # Below this the small type is physically unreadable, so a poor result is
        # the photo's fault rather than the method's — worth telling the user.
        'resolutionOk': frame >= 1700,
    }
