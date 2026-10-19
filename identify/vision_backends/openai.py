"""
GPT vision (OpenAI SDK, Responses API).

Also the engine for every OpenAI-compatible vendor: `_read()` takes the base URL,
model and key, and grok.py is a thin wrapper over it. Structured output is NOT
enforced on this path — the shared prompt pins the JSON keys and compatible
vendors don't all support schema enforcement, so the reply goes through the
lenient parser instead.
"""

from __future__ import annotations

from . import _common

# OpenAI's flagship. gpt-6.1-sol is the cheaper option if Astra's cost outweighs
# its accuracy on real deadwax.
MODEL = "gpt-6-astra"


def _read(path: str, *, backend: str, model: str, key_envs: tuple[str, ...],
          base_url: str | None = None) -> dict:
    encoded = _common.encode_image(path)
    if isinstance(encoded, dict):
        return encoded
    image_data, media_type = encoded

    key = _common.setting(*key_envs)
    if not key:
        return _common.missing_key_error(backend, *key_envs)

    import openai

    client = openai.OpenAI(api_key=key, base_url=base_url)
    try:
        response = client.responses.create(
            model=model,
            input=[{
                "role": "user",
                "content": [
                    {"type": "input_image",
                     "image_url": f"data:{media_type};base64,{image_data}"},
                    {"type": "input_text", "text": _common.PROMPT},
                ],
            }],
        )
    except openai.AuthenticationError:
        return {"error": f"{backend} credentials were rejected — check {key_envs[0]} in .env (see .env.example)"}
    except openai.RateLimitError:
        return {"error": f"{backend} rate limit hit — try again shortly"}
    except openai.APIStatusError as exc:
        return {"error": f"{backend} vision call failed: {exc.status_code} {exc.message}"}
    except openai.APIConnectionError:
        return {"error": f"Could not reach the {backend} API — check the network"}

    read = _common.parse_reading(getattr(response, "output_text", None))
    if read is None:
        return {"error": f"{backend} vision returned no readable result"}

    usage = None
    stats = getattr(response, "usage", None)
    if stats is not None and getattr(stats, "input_tokens", None) is not None:
        usage = {"input_tokens": stats.input_tokens, "output_tokens": stats.output_tokens}
    return _common.finish(read, backend, model, usage)


def read_runout(path: str) -> dict:
    return _read(path, backend="openai", model=MODEL, key_envs=("OPENAI_API_KEY",))
