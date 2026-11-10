"""
Grok vision — xAI's API is OpenAI-compatible, so this is openai.py pointed at
api.x.ai with the Grok model. xAI's own docs show exactly this pattern (the
OpenAI SDK with a base_url override, Responses API).
"""

from __future__ import annotations

from . import openai as openai_backend

MODEL = "grok-4.7"
BASE_URL = "https://api.x.ai/v1"


def read_runout(path: str) -> dict:
    return openai_backend._read(
        path, backend="grok", model=MODEL, key_envs=("XAI_API_KEY",), base_url=BASE_URL,
    )
