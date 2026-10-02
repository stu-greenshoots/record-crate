"""
Recognising a record sleeve from a photograph, entirely on this machine.

A phone photo of a sleeve is a hard match for a hash: it is taken at an angle,
under a lamp, cropped differently, often with a thumb in the corner. Comparing
whole-image fingerprints fails on all of that. Local features don't — they
describe small patches of the artwork independently, so a match survives
rotation, perspective, glare and partial occlusion.

Two stages, because brute-force matching every sleeve is wasteful:

  1. a cheap global fingerprint (difference hash + colour histogram) narrows
     hundreds of sleeves down to a few dozen plausible ones;
  2. ORB keypoints are matched against those, and a homography is fitted with
     RANSAC. The inlier count is the score: it counts only the matches that
     agree on one consistent flat-to-flat mapping, which is exactly what a
     photograph of a flat printed sleeve produces and what a coincidental
     texture match does not.
"""

from __future__ import annotations

import json
import cv2
import numpy as np

# Keypoints per image. More is slower and only helps up to a point.
ORB_FEATURES = 900
# Lowe's ratio test: a match must be clearly better than the runner-up.
RATIO = 0.78
# Below this many geometrically consistent matches, it isn't the same sleeve.
MIN_INLIERS = 14
# Of the matches that survived the ratio test, this fraction must also agree on
# the homography. Coincidental texture matches are numerous but incoherent.
MIN_INLIER_RATIO = 0.34
WORK_SIZE = 640


def _load(path: str, size: int = WORK_SIZE) -> np.ndarray | None:
    image = cv2.imread(path, cv2.IMREAD_COLOR)
    if image is None:
        return None
    h, w = image.shape[:2]
    scale = size / max(h, w)
    if scale < 1:
        image = cv2.resize(image, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    return image


def dhash(image: np.ndarray) -> np.uint64:
    """Difference hash — 64 bits of "is this pixel brighter than its neighbour"."""
    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(grey, (9, 8), interpolation=cv2.INTER_AREA)
    bits = small[:, 1:] > small[:, :-1]
    return np.uint64(int(''.join('1' if b else '0' for b in bits.flatten()), 2))


def histogram(image: np.ndarray) -> np.ndarray:
    """Coarse hue/saturation histogram — survives lighting shifts better than RGB."""
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, [24, 8], [0, 180, 0, 256])
    cv2.normalize(hist, hist, 0, 1, cv2.NORM_MINMAX)
    return hist.flatten().astype(np.float32)


def features(image: np.ndarray):
    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    # Local contrast equalisation, so a sleeve shot under a lamp still matches
    # the evenly-lit scan it is being compared against.
    grey = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(grey)
    orb = cv2.ORB.create(nfeatures=ORB_FEATURES)
    keypoints, descriptors = orb.detectAndCompute(grey, None)
    if descriptors is None or len(keypoints) < 8:
        return None, None
    return np.float32([k.pt for k in keypoints]), descriptors


def _plausible(H, w: int, h: int) -> bool:
    """
    Is this homography something a photograph could actually produce?

    RANSAC will happily fit a mapping to coincidental matches, and enough of them
    can out-score a real sleeve — a Santana cover scored 39 against This Heat.
    But a photo of a flat rectangular sleeve always maps its corners to a convex,
    sanely-proportioned quadrilateral, and a spurious fit usually doesn't: it
    folds, mirrors or stretches the frame into a sliver.
    """
    if H is None:
        return False
    corners = np.float32([[0, 0], [w, 0], [w, h], [0, h]]).reshape(-1, 1, 2)
    try:
        projected = cv2.perspectiveTransform(corners, H).reshape(-1, 2).astype(np.float32)
    except cv2.error:
        return False
    if not np.all(np.isfinite(projected)):
        return False
    if not cv2.isContourConvex(projected):
        return False
    area = abs(cv2.contourArea(projected))
    if area <= 0:
        return False
    # A sleeve can't shrink to a speck or blow up past the frame by 20x.
    if not 0.04 < area / float(w * h) < 25:
        return False
    _, _, bw, bh = cv2.boundingRect(projected)
    if bw < 1 or bh < 1 or max(bw / bh, bh / bw) > 4.0:
        return False
    return True


def build_index(manifest_path: str, out_path: str) -> dict:
    """Fingerprint every sleeve we hold. Runs once, then only for new records."""
    manifest = json.load(open(manifest_path))
    ids, hashes, hists, descs, points, counts = [], [], [], [], [], []

    for entry in manifest:
        image = _load(entry['path'])
        if image is None:
            continue
        pts, dsc = features(image)
        if dsc is None:
            continue
        ids.append(entry['id'])
        hashes.append(dhash(image))
        hists.append(histogram(image))
        descs.append(dsc)
        points.append(pts)
        counts.append(len(dsc))

    np.savez_compressed(
        out_path,
        ids=np.array(ids, dtype=np.int64),
        hashes=np.array(hashes, dtype=np.uint64),
        hists=np.array(hists, dtype=np.float32),
        descriptors=np.vstack(descs) if descs else np.zeros((0, 32), np.uint8),
        points=np.vstack(points) if points else np.zeros((0, 2), np.float32),
        counts=np.array(counts, dtype=np.int32),
    )
    return {'indexed': len(ids), 'of': len(manifest)}


def _hamming64(a: np.ndarray, b: np.uint64) -> np.ndarray:
    x = np.bitwise_xor(a, b)
    bits = np.zeros(x.shape, dtype=np.int32)
    for _ in range(64):
        bits += (x & np.uint64(1)).astype(np.int32)
        x >>= np.uint64(1)
    return bits


def _search(query, ids, hashes, hists, descriptors, points, counts, shortlist):
    q_pts, q_desc = features(query)
    if q_desc is None:
        return [], 0

    # Stage 1 — cheap global similarity, to pick who is worth a real comparison.
    close = _hamming64(hashes, dhash(query))
    q_hist = histogram(query)
    hist_sim = hists @ q_hist / (np.linalg.norm(hists, axis=1) * np.linalg.norm(q_hist) + 1e-9)
    rough = (1 - close / 64.0) * 0.45 + hist_sim * 0.55
    candidates = np.argsort(-rough)[:shortlist]

    # Stage 2 — geometric verification on the shortlist.
    offsets = np.concatenate([[0], np.cumsum(counts)])
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    results = []

    for i in candidates:
        lo, hi = offsets[i], offsets[i + 1]
        cand_desc, cand_pts = descriptors[lo:hi], points[lo:hi]
        if len(cand_desc) < 8:
            continue
        pairs = matcher.knnMatch(q_desc, cand_desc, k=2)
        good = [m for m, n in (p for p in pairs if len(p) == 2) if m.distance < RATIO * n.distance]
        if len(good) < MIN_INLIERS:
            continue

        src = np.float32([q_pts[m.queryIdx] for m in good]).reshape(-1, 1, 2)
        dst = np.float32([cand_pts[m.trainIdx] for m in good]).reshape(-1, 1, 2)
        H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
        if mask is None:
            continue
        inliers = int(mask.sum())
        ratio = inliers / float(len(good))
        h, w = query.shape[:2]
        if inliers >= MIN_INLIERS and ratio >= MIN_INLIER_RATIO and _plausible(H, w, h):
            results.append({
                'id': int(ids[i]),
                'inliers': inliers,
                'matches': len(good),
                'inlierRatio': round(ratio, 3),
                'rough': float(rough[i]),
            })

    results.sort(key=lambda r: -r['inliers'])
    return results, int(len(q_desc))


def identify(image_path: str, index_path: str, shortlist: int = 40, top: int = 5) -> dict:
    data = np.load(index_path)
    ids, hashes, hists = data['ids'], data['hashes'], data['hists']
    descriptors, points, counts = data['descriptors'], data['points'], data['counts']
    if len(ids) == 0:
        return {'matches': [], 'error': 'index is empty'}

    query = _load(image_path)
    if query is None:
        return {'matches': [], 'error': 'could not read the photo'}

    args = (ids, hashes, hists, descriptors, points, counts, shortlist)
    results, feature_count = _search(query, *args)
    used = 'frame'

    # Deskewing helps when the sleeve sits inside a larger frame, and hurts when
    # it already fills it (the quad detector latches onto the artwork instead).
    # So it is a fallback, not a replacement: only try it when the direct read
    # came back weak, and keep whichever result is actually better.
    best = results[0]['inliers'] if results else 0
    if best < 32:
        from .text import deskew
        flat = deskew(cv2.imread(image_path, cv2.IMREAD_COLOR))
        h, w = flat.shape[:2]
        scale = WORK_SIZE / max(h, w)
        if scale < 1:
            flat = cv2.resize(flat, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
        flat_results, flat_features = _search(flat, *args)
        if flat_results and (not results or flat_results[0]['inliers'] > best):
            results, feature_count, used = flat_results, flat_features, 'deskewed'

    results.sort(key=lambda r: -r['inliers'])
    for r in results:
        # Two clear bands: plenty of agreeing keypoints is effectively certain,
        # a handful is worth showing but not asserting.
        r['confidence'] = 'high' if r['inliers'] >= 30 else 'medium' if r['inliers'] >= 18 else 'low'
    return {'matches': results[:top], 'queryFeatures': feature_count, 'read': used}
