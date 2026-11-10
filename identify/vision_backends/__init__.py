"""
The vision backends, one module per vendor, all answering `read_runout(path)`
with the same contract (see _common.finish).

BACKENDS maps names to module paths rather than imported modules so that a
missing vendor SDK only matters when that backend is actually chosen — the
default Claude path must not break because `openai` isn't installed.
"""

from importlib import import_module

BACKENDS = {
    "claude": "identify.vision_backends.claude",
    "gemini": "identify.vision_backends.gemini",
    "openai": "identify.vision_backends.openai",
    "grok": "identify.vision_backends.grok",
}


def load(name: str):
    """The backend module for a name, or a standard error dict."""
    if name not in BACKENDS:
        known = ", ".join(sorted(BACKENDS))
        return {"error": f"unknown vision backend '{name}' — expected one of: {known}"}
    try:
        return import_module(BACKENDS[name])
    except ImportError as exc:
        return {"error": f"the {name} backend needs its SDK installed: {exc}"}
