"""
Reading the deadwax, by asking a model that can actually see.

Runout etchings are the worst text a camera will ever hand to OCR: hand-scratched,
curved around the label, lit at whatever angle made the vinyl stop reflecting the
ceiling. Tesseract — trained on flat scanned pages — proved hopeless on them, so
this reader hands the photo to Claude vision instead and asks for the etchings
verbatim, triangles and stamper marks included.

A read here is still candidates, never an answer. Matching them against Discogs'
matrix identifiers remains the job of shared/pressingMatch.js.

Needs ANTHROPIC_API_KEY — from the environment, or from the project .env (the Node
server keeps .env parsed to itself rather than exporting it, so the key wouldn't
reach this child process otherwise). See .env.example.
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path

MODEL = "claude-sonnet-5-5"

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

PROMPT = (
    "You are reading the etched dead wax (runout groove) of a vinyl record. "
    "Return a JSON object. Preserve all glyphs exactly — including triangles "
    "(∇, △), mastering engineer stamps, inspection marks, and special characters. "
    "Distinguish matrix characters precisely (O vs 0, I vs 1 vs lowercase L, "
    "S vs 5). If both side A and side B are visible, split them. If only one "
    "side is visible, use null for the other. Confidence: 'high' if clearly "
    "etched and well-lit, 'medium' if some ambiguity, 'low' if partially "
    "illegible. Put everything you can read verbatim in raw_text, and any "
    "observations about lighting, visibility, or specific marks in notes."
)

MEDIA_TYPES = {".png": "image/png", ".webp": "image/webp", ".gif": "image/gif"}

# The matcher downstream compares strings; it never sees these labels. They only
# shape what the UI and smoke script display, mirroring the old reader's numbers.
CONFIDENCE = {"high": 0.9, "medium": 0.6, "low": 0.3}


def _api_key() -> str | None:
    """The key from the environment, else from the project .env."""
    key = os.environ.get("ANTHROPIC_API_KEY")
    if key:
        return key
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line.startswith("ANTHROPIC_API_KEY="):
                return line.split("=", 1)[1].strip() or None
    return None


def read_runout(path: str) -> dict:
    file = Path(path)
    if not file.exists():
        return {"error": "could not read the photo"}
    media_type = MEDIA_TYPES.get(file.suffix.lower(), "image/jpeg")
    image_data = base64.standard_b64encode(file.read_bytes()).decode("utf-8")

    import anthropic

    # An explicit key (environment or project .env) wins; otherwise let the SDK
    # resolve its own chain (ANTHROPIC_AUTH_TOKEN, an `ant auth login` profile).
    key = _api_key()
    client = anthropic.Anthropic(api_key=key) if key else anthropic.Anthropic()
    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=2000,
            output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image",
                     "source": {"type": "base64", "media_type": media_type, "data": image_data}},
                    {"type": "text", "text": PROMPT},
                ],
            }],
        )
    except anthropic.AuthenticationError:
        return {"error": "Anthropic credentials were rejected — check ANTHROPIC_API_KEY in .env (see .env.example)"}
    except TypeError:
        return {
            "error": "ANTHROPIC_API_KEY is not set — add it to .env (see .env.example); "
                     "the deadwax reader uses Claude vision"
        }
    except anthropic.APIStatusError as exc:
        return {"error": f"Claude vision call failed: {exc.status_code} {exc.message}"}
    except anthropic.APIConnectionError:
        return {"error": "Could not reach the Anthropic API — check the network"}

    if response.stop_reason == "refusal":
        return {"error": "Claude declined to read this photo"}
    text = next((b.text for b in response.content if b.type == "text"), None)
    if not text:
        return {"error": "Claude vision returned no readable result"}
    read = json.loads(text)

    confidence = CONFIDENCE.get(read.get("confidence"), 0.3)
    candidates = []
    for side, value in (("A", read.get("side_a_matrix")), ("B", read.get("side_b_matrix"))):
        if value:
            candidates.append({"value": value, "confidence": confidence, "side": side})

    return {
        "candidates": candidates,
        "best": candidates[0]["value"] if candidates else None,
        "raw_text": read.get("raw_text") or "",
        "notes": read.get("notes") or "",
        "confidence": read.get("confidence") or "low",
    }
