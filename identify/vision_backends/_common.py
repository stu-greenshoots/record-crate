"""
What every vision backend shares: the prompt, the output contract, and the plumbing.

The prompt is deliberately identical across backends — when their readings differ,
that difference is the model, not the phrasing. Each backend module exposes
`read_runout(image_path) -> dict` and returns through `finish()` so the shape
downstream code sees never depends on which vendor produced it.
"""

from __future__ import annotations

import base64
import json
import os
import re
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

PROMPT = (
    "You are reading the etched dead wax (runout groove) of a vinyl record. "
    "Return a JSON object. Preserve all glyphs exactly — including triangles "
    "(∇, △), mastering engineer stamps, inspection marks, and special characters. "
    "Distinguish matrix characters precisely (O vs 0, I vs 1 vs lowercase L, "
    "S vs 5). If both side A and side B are visible, split them. If only one "
    "side is visible, use null for the other. Confidence: 'high' if clearly "
    "etched and well-lit, 'medium' if some ambiguity, 'low' if partially "
    "illegible. Put everything you can read verbatim in raw_text, and any "
    "observations about lighting, visibility, or specific marks in notes. "
    'The JSON object has exactly these keys: "raw_text" (string), '
    '"side_a_matrix" (string or null), "side_b_matrix" (string or null), '
    '"confidence" ("high"|"medium"|"low"), "notes" (string).'
)

SCHEMA = {
    "type": "object",
    "properties": {
        "raw_text": {"type": "string"},
        "side_a_matrix": {"type": ["string", "null"]},
        "side_b_matrix": {"type": ["string", "null"]},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "notes": {"type": "string"},
    },
    "required": ["raw_text", "side_a_matrix", "side_b_matrix", "confidence", "notes"],
    "additionalProperties": False,
}

MEDIA_TYPES = {".png": "image/png", ".webp": "image/webp", ".gif": "image/gif"}

# The matcher downstream compares strings; these numbers only shape what the UI
# and smoke script display.
CONFIDENCE = {"high": 0.9, "medium": 0.6, "low": 0.3}


def setting(*names: str) -> str | None:
    """A value from the environment, else from the project .env (the Node server
    keeps .env parsed to itself rather than exporting it, so a spawned reader
    would never inherit these otherwise)."""
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    env_file = PROJECT_ROOT / ".env"
    if env_file.exists():
        wanted = {f"{n}=": n for n in names}
        found = {}
        for line in env_file.read_text().splitlines():
            line = line.strip()
            for prefix in wanted:
                if line.startswith(prefix):
                    found[wanted[prefix]] = line.split("=", 1)[1].strip()
        for name in names:
            if found.get(name):
                return found[name]
    return None


def missing_key_error(backend: str, *env_names: str) -> dict:
    names = " or ".join(env_names)
    return {
        "error": f"{names} is not set — the {backend} deadwax reader needs it; "
                 "add it to .env (see .env.example)"
    }


def encode_image(path: str) -> tuple[str, str] | dict:
    """(base64, media_type), or the standard error dict."""
    file = Path(path)
    if not file.exists():
        return {"error": "could not read the photo"}
    media_type = MEDIA_TYPES.get(file.suffix.lower(), "image/jpeg")
    return base64.standard_b64encode(file.read_bytes()).decode("utf-8"), media_type


def parse_reading(text: str) -> dict | None:
    """The reading out of a model reply — tolerant of code fences and prose
    around the JSON, for backends without enforced structured output."""
    if not text:
        return None
    candidate = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", candidate, re.S)
    if fenced:
        candidate = fenced.group(1)
    elif not candidate.startswith("{"):
        brace = re.search(r"\{.*\}", candidate, re.S)
        if not brace:
            return None
        candidate = brace.group(0)
    try:
        read = json.loads(candidate)
    except json.JSONDecodeError:
        return None
    return read if isinstance(read, dict) else None


def finish(read: dict, backend: str, model: str, usage: dict | None = None) -> dict:
    """Normalise a parsed reading into the contract downstream code consumes."""
    confidence_label = read.get("confidence")
    if confidence_label not in CONFIDENCE:
        confidence_label = "low"
    confidence = CONFIDENCE[confidence_label]

    candidates = []
    for side in ("a", "b"):
        value = read.get(f"side_{side}_matrix")
        if value and isinstance(value, str):
            candidates.append({"value": value, "confidence": confidence, "side": side.upper()})

    out = {
        "candidates": candidates,
        "best": candidates[0]["value"] if candidates else None,
        "raw_text": str(read.get("raw_text") or ""),
        "notes": str(read.get("notes") or ""),
        "confidence": confidence_label,
        "backend_used": backend,
        "model_used": model,
    }
    if usage:
        out["usage"] = usage
    return out
