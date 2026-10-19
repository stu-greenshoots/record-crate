"""Claude vision — the default deadwax reader (structured output enforced)."""

from __future__ import annotations

from . import _common

MODEL = "claude-sonnet-5-5"


def read_runout(path: str) -> dict:
    encoded = _common.encode_image(path)
    if isinstance(encoded, dict):
        return encoded
    image_data, media_type = encoded

    import anthropic

    # An explicit key (environment or project .env) wins; otherwise let the SDK
    # resolve its own chain (ANTHROPIC_AUTH_TOKEN, an `ant auth login` profile).
    key = _common.setting("ANTHROPIC_API_KEY")
    client = anthropic.Anthropic(api_key=key) if key else anthropic.Anthropic()
    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=2000,
            output_config={"format": {"type": "json_schema", "schema": _common.SCHEMA}},
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image",
                     "source": {"type": "base64", "media_type": media_type, "data": image_data}},
                    {"type": "text", "text": _common.PROMPT},
                ],
            }],
        )
    except anthropic.AuthenticationError:
        return {"error": "Anthropic credentials were rejected — check ANTHROPIC_API_KEY in .env (see .env.example)"}
    except TypeError:
        return _common.missing_key_error("claude", "ANTHROPIC_API_KEY")
    except anthropic.APIStatusError as exc:
        return {"error": f"Claude vision call failed: {exc.status_code} {exc.message}"}
    except anthropic.APIConnectionError:
        return {"error": "Could not reach the Anthropic API — check the network"}

    if response.stop_reason == "refusal":
        return {"error": "Claude declined to read this photo"}
    text = next((b.text for b in response.content if b.type == "text"), None)
    read = _common.parse_reading(text)
    if read is None:
        return {"error": "Claude vision returned no readable result"}

    usage = {"input_tokens": response.usage.input_tokens, "output_tokens": response.usage.output_tokens}
    return _common.finish(read, "claude", MODEL, usage)
