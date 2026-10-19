"""
Reading the deadwax.

Runout etchings are the worst text a camera will ever hand to OCR: hand-scratched,
curved around the label, lit at whatever angle made the vinyl stop reflecting the
ceiling. Tesseract was trained on none of that. So this module spends its effort
before the OCR call — a ladder of preprocessing variants, each a different guess
at what will make the etching look like print — and treats agreement between
variants as the real confidence signal, because tesseract's own output offers none.

A read here is a list of candidate strings, never an answer. Matching them against
Discogs' matrix identifiers is the job of shared/pressingMatch.js, which knows that
'YEX 637-2' and 'YEX637-2' are the same etching.
"""

from __future__ import annotations

import re
import cv2
import numpy as np

from .text import _ocr

# An etching worth keeping: at least four characters drawn from the alphabet
# matrix numbers actually use. Lowercase appears only when tesseract has
# misread artwork, so the pattern insists on upper case and digits.
ETCHING = re.compile(r"[A-Z0-9][A-Z0-9 \-./#Δ]{3,}")

# Characters that never appear in a matrix number but tesseract loves to emit
# when it hallucinates on vinyl grain.
JUNK = re.compile(r"[^A-Z0-9 \-./#]")


def _greyscale(image: np.ndarray) -> np.ndarray:
    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(grey)


def _variants(grey: np.ndarray):
    """
    The preprocessing ladder, mildest first.

    Each rung is one idea about what the photo got wrong: contrast (CLAHE is
    already applied), polarity (etchings read light-on-dark as often as not),
    and binarisation (adaptive for uneven lamp light, Otsu for even light).
    Rotation is handled a level up, because it multiplies everything here.
    """
    yield "clahe", grey
    yield "inverted", cv2.bitwise_not(grey)
    yield "adaptive", cv2.adaptiveThreshold(
        grey, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 10
    )
    _, otsu = cv2.threshold(grey, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    yield "otsu", otsu
    yield "otsu-inverted", cv2.bitwise_not(otsu)


def _candidates_in(raw: str) -> list[str]:
    found = []
    for line in raw.upper().splitlines():
        line = JUNK.sub(" ", line)
        for match in ETCHING.findall(line):
            cleaned = " ".join(match.split())
            # A string that is mostly spaces or one repeated glyph is grain, not text.
            if len(set(cleaned.replace(" ", ""))) >= 3:
                found.append(cleaned)
    return found


def _plausibility(value: str) -> float:
    """
    How much a string looks like a matrix number, ignoring how it was read.

    Real runouts mix letters and digits and stay short-ish; a wall of letters is
    usually the label's copyright ring misread, and a wall of digits is often a
    barcode or grain.
    """
    compact = value.replace(" ", "")
    letters = sum(c.isalpha() for c in compact)
    digits = sum(c.isdigit() for c in compact)
    score = 0.4
    if letters and digits:
        score += 0.3
    if 5 <= len(compact) <= 20:
        score += 0.2
    if "-" in value or "/" in value:
        score += 0.1
    return min(score, 1.0)


def read_runout(path: str) -> dict:
    """
    Every candidate string the ladder could pull out of a deadwax photo.

    Rotations come before variants: an etching runs along the groove, so a phone
    photo holds it at an arbitrary angle, and tesseract reads only what is within
    ~15° of horizontal. Four rotations of five variants is twenty OCR calls at
    worst; the ladder stops early once any rotation yields agreeing reads, to
    keep the common case fast.
    """
    image = cv2.imread(path, cv2.IMREAD_COLOR)
    if image is None:
        return {"error": "could not read the photo"}

    # Work at a size where 8pt etching still has pixels but OCR stays quick.
    h, w = image.shape[:2]
    scale = 1600 / max(h, w)
    if scale < 1:
        image = cv2.resize(image, (round(w * scale), round(h * scale)))

    grey = _greyscale(image)

    seen: dict[str, dict] = {}
    rotations = [None, cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_180, cv2.ROTATE_90_COUNTERCLOCKWISE]
    for rotation in rotations:
        rotated = grey if rotation is None else cv2.rotate(grey, rotation)
        for name, variant in _variants(rotated):
            for psm in (11, 7):
                for value in _candidates_in(_ocr(variant, psm)):
                    entry = seen.setdefault(
                        value, {"value": value, "variants": set(), "plausibility": _plausibility(value)}
                    )
                    entry["variants"].add(f"{name}/psm{psm}" + ("" if rotation is None else "/rot"))
        # Two independent variants agreeing on a plausible string is as good as
        # this gets — later rotations only re-find the same etching sideways.
        if any(len(e["variants"]) >= 2 and e["plausibility"] >= 0.7 for e in seen.values()):
            break

    candidates = []
    for entry in seen.values():
        agreement = min(len(entry["variants"]) / 3.0, 1.0)
        confidence = round(0.5 * entry["plausibility"] + 0.5 * agreement, 2)
        candidates.append(
            {
                "value": entry["value"],
                "confidence": confidence,
                "variants": sorted(entry["variants"]),
            }
        )
    candidates.sort(key=lambda c: c["confidence"], reverse=True)

    return {
        "candidates": candidates[:8],
        "best": candidates[0]["value"] if candidates else None,
    }
