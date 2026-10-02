"""
Reading a sleeve you don't own yet.

Feature matching can only recognise records already in the collection — there is
no local database of every cover ever pressed. For anything else the sleeve has
to be read: artist, title, and above all the catalogue number, which is what
pins a record to one specific pressing rather than the album in general.

The sleeve is deskewed before OCR. Tesseract is trained on flat scanned pages,
so straightening a photographed sleeve is worth more than any parameter tuning.
"""

from __future__ import annotations

import re
import subprocess
import cv2
import numpy as np

# "STUMM 142", "SHVL 814", "PCS 7009", "6360 011" — a letter-ish prefix and digits.
CATNO = re.compile(r'\b([A-Z]{1,6}[- ]?\d{2,6}(?:[- ]?\d{1,3})?|\d{4} \d{3})\b')
BARCODE = re.compile(r'\b\d{12,13}\b')
NOISE = re.compile(r'^[^A-Za-z0-9]*$')


def deskew(image: np.ndarray) -> np.ndarray:
    """
    Find the sleeve in the frame and flatten it to a square.

    A record sleeve is the largest four-sided thing in a photo of a record
    sleeve, so the biggest convex quadrilateral contour is a reliable stand-in
    for "the sleeve" without needing to detect anything cleverer.
    """
    quad = find_sleeve_quad(image)
    if quad is None:
        # No sleeve found: hand back a working-sized copy, which is what the cover
        # matcher's fallback path was measured against. Reading small type needs
        # the opposite — see backcover.flatten, which keeps every pixel.
        h, w = image.shape[:2]
        scale = 900 / max(h, w)
        return cv2.resize(image, (round(w * scale), round(h * scale))) if scale < 1 else image
    side = 1000
    target = np.float32([[0, 0], [side, 0], [side, side], [0, side]])
    return cv2.warpPerspective(image, cv2.getPerspectiveTransform(quad, target), (side, side))


def find_sleeve_quad(image: np.ndarray, work_max: int = 900) -> np.ndarray | None:
    """
    Locate the sleeve's four corners, returned in the ORIGINAL image's coordinates.

    Contour finding is done on a downscaled copy because it only needs the shape,
    but the corners are scaled back up so a caller can warp the full-resolution
    photo. That distinction matters: a catalogue number is ~8pt type, and reading
    it needs every pixel the camera captured (see HANDOVER.md, discovery pass).
    """
    h, w = image.shape[:2]
    scale = work_max / max(h, w)
    work = cv2.resize(image, (round(w * scale), round(h * scale))) if scale < 1 else image

    grey = cv2.cvtColor(work, cv2.COLOR_BGR2GRAY)
    grey = cv2.bilateralFilter(grey, 9, 75, 75)
    edges = cv2.Canny(grey, 40, 140)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    frame_area = work.shape[0] * work.shape[1]
    best = None
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:8]:
        area = cv2.contourArea(contour)
        # Ignore specks, and ignore a "quad" that is just the whole photo border.
        if area < frame_area * 0.18 or area > frame_area * 0.98:
            continue
        approx = cv2.approxPolyDP(contour, 0.02 * cv2.arcLength(contour, True), True)
        if len(approx) == 4 and cv2.isContourConvex(approx):
            best = approx.reshape(4, 2).astype(np.float32)
            break

    if best is None:
        return None

    # Order the corners tl, tr, br, bl so the warp isn't mirrored or rotated.
    total = best.sum(axis=1)
    diff = np.diff(best, axis=1).flatten()
    ordered = np.float32([
        best[np.argmin(total)], best[np.argmin(diff)],
        best[np.argmax(total)], best[np.argmax(diff)],
    ])
    return ordered / (scale if scale < 1 else 1.0)


def _ocr(image: np.ndarray, psm: int) -> str:
    ok, buf = cv2.imencode('.png', image)
    if not ok:
        return ''
    try:
        result = subprocess.run(
            ['tesseract', 'stdin', 'stdout', '--psm', str(psm)],
            input=buf.tobytes(), capture_output=True, timeout=25,
        )
        return result.stdout.decode('utf-8', 'ignore')
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return ''


def read_sleeve(path: str) -> dict:
    image = cv2.imread(path, cv2.IMREAD_COLOR)
    if image is None:
        return {'error': 'could not read the photo'}

    flat = deskew(image)
    grey = cv2.cvtColor(flat, cv2.COLOR_BGR2GRAY)
    grey = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(grey)

    # Sleeve type is often light-on-dark; Tesseract expects the opposite, so read
    # both polarities and keep whichever yields more.
    raw = _ocr(grey, 11) + '\n' + _ocr(cv2.bitwise_not(grey), 11) + '\n' + _ocr(grey, 6)

    lines, seen = [], set()
    for line in raw.splitlines():
        line = ' '.join(line.split())
        # Single stray glyphs are almost always artwork misread as text.
        if len(line) < 3 or NOISE.match(line) or line.lower() in seen:
            continue
        seen.add(line.lower())
        lines.append(line)

    upper = raw.upper()
    catnos = [' '.join(m.split()) for m in CATNO.findall(upper)]
    # Drop matches that are really years or track times.
    catnos = [c for c in dict.fromkeys(catnos) if not re.fullmatch(r'\d{4}', c)]

    # The largest words on a sleeve are usually the artist and the title.
    wordy = [l for l in lines if len(l) >= 4 and sum(c.isalpha() for c in l) >= len(l) * 0.6]
    wordy.sort(key=len, reverse=True)

    return {
        'lines': lines[:40],
        'phrases': wordy[:8],
        'catalogueNumbers': catnos[:6],
        'barcodes': list(dict.fromkeys(BARCODE.findall(raw)))[:3],
        'searchTerms': ' '.join(wordy[:3])[:120],
    }
