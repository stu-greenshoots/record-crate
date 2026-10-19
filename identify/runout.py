"""
Reading the deadwax, by asking a model that can actually see.

Runout etchings are the worst text a camera will ever hand to OCR — tesseract,
trained on flat scanned pages, proved hopeless on them — so the reading is done
by a vision model. Which vendor's is a choice: --backend on the CLI wins, then
RUNOUT_VISION_BACKEND (environment or project .env), then Claude.

A read is still candidates, never an answer. Matching them against Discogs'
matrix identifiers remains the job of shared/pressingMatch.js.
"""

from __future__ import annotations

from . import vision_backends
from .vision_backends import _common

DEFAULT_BACKEND = "claude"


def read_runout(path: str, backend: str | None = None) -> dict:
    name = backend or _common.setting("RUNOUT_VISION_BACKEND") or DEFAULT_BACKEND
    module = vision_backends.load(name)
    if isinstance(module, dict):
        return module
    return module.read_runout(path)
