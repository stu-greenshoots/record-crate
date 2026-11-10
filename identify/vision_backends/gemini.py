"""Gemini vision (google-genai SDK, Interactions API; structured output enforced)."""

from __future__ import annotations

from . import _common

# Google's flagship. gemini-3.8-flash is the cheaper option — swap it in here if
# Argon's cost outweighs its accuracy on real deadwax.
MODEL = "gemini-4-argon"


def read_runout(path: str) -> dict:
    encoded = _common.encode_image(path)
    if isinstance(encoded, dict):
        return encoded
    image_data, media_type = encoded

    key = _common.setting("GEMINI_API_KEY", "GOOGLE_API_KEY")
    if not key:
        return _common.missing_key_error("gemini", "GEMINI_API_KEY", "GOOGLE_API_KEY")

    from google import genai
    from google.genai import errors

    client = genai.Client(api_key=key)
    try:
        interaction = client.interactions.create(
            model=MODEL,
            input=[
                {"type": "image", "data": image_data, "mime_type": media_type},
                {"type": "text", "text": _common.PROMPT},
            ],
            response_format={
                "type": "text",
                "mime_type": "application/json",
                "schema": _common.SCHEMA,
            },
        )
    except errors.APIError as exc:
        if getattr(exc, "code", None) in (401, 403):
            return {"error": "Gemini credentials were rejected — check GEMINI_API_KEY in .env (see .env.example)"}
        if getattr(exc, "code", None) == 429:
            return {"error": "Gemini rate limit hit — try again shortly"}
        return {"error": f"Gemini vision call failed: {exc.code} {exc.message}"}
    except Exception as exc:  # the SDK's connection errors vary by transport
        return {"error": f"Could not reach the Gemini API: {type(exc).__name__}"}

    read = _common.parse_reading(getattr(interaction, "output_text", None))
    if read is None:
        return {"error": "Gemini vision returned no readable result"}

    usage = None
    stats = getattr(interaction, "usage", None)
    if stats is not None:
        tokens_in = getattr(stats, "input_tokens", None) or getattr(stats, "prompt_tokens", None)
        tokens_out = getattr(stats, "output_tokens", None) or getattr(stats, "completion_tokens", None)
        if tokens_in or tokens_out:
            usage = {"input_tokens": tokens_in or 0, "output_tokens": tokens_out or 0}
    return _common.finish(read, "gemini", MODEL, usage)
