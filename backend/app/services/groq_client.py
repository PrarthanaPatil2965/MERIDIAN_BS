"""Thin async wrapper over Groq's OpenAI-compatible API.

Handles the one thing that reliably breaks hackathon demos: a model ID that was
deprecated last month. We walk a candidate list and cache the winner.
"""
import json
import logging
import httpx

from .. import config

log = logging.getLogger("blindspot.groq")

_working = {"vision": None, "text": None}

_client: httpx.AsyncClient | None = None


def client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=config.GROQ_BASE_URL,
            timeout=httpx.Timeout(30.0, connect=5.0),
            headers={"Authorization": f"Bearer {config.GROQ_API_KEY}"},
        )
    return _client


async def close():
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def _is_model_error(status: int, body: str) -> bool:
    if status in (400, 404):
        low = body.lower()
        return "model" in low and ("not found" in low or "decommission" in low or "does not exist" in low)
    return False


async def _chat(kind: str, messages: list, max_tokens: int, temperature: float, json_mode: bool):
    candidates = config.VISION_MODELS if kind == "vision" else config.TEXT_MODELS
    if _working[kind]:
        candidates = [_working[kind]] + [m for m in candidates if m != _working[kind]]

    last_err = None
    for model in candidates:
        payload = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        try:
            r = await client().post("/chat/completions", json=payload)
        except Exception as e:  # network hiccup: try next model
            last_err = str(e)
            continue

        if r.status_code == 200:
            _working[kind] = model
            return r.json()["choices"][0]["message"]["content"]

        body = r.text[:400]
        last_err = f"{r.status_code} {body}"
        if _is_model_error(r.status_code, body):
            log.warning("model %s unavailable, falling back", model)
            continue
        if r.status_code == 429:
            log.warning("rate limited on %s", model)
            continue
        break

    raise RuntimeError(f"Groq {kind} call failed: {last_err}")


async def vision_json(prompt: str, image_b64: str, max_tokens: int = 320) -> dict:
    """Ask a vision model for a strict JSON object."""
    content = [
        {"type": "text", "text": prompt},
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
    ]
    raw = await _chat("vision", [{"role": "user", "content": content}], max_tokens, 0.0, True)
    return _parse_json(raw)


async def vision_text(system: str, question: str, image_b64: str | None, max_tokens: int = 220) -> str:
    parts: list = [{"type": "text", "text": question}]
    if image_b64:
        parts.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}})
    kind = "vision" if image_b64 else "text"
    return (
        await _chat(
            kind,
            [{"role": "system", "content": system}, {"role": "user", "content": parts if image_b64 else question}],
            max_tokens,
            0.2,
            False,
        )
    ).strip()


async def text(system: str, user: str, max_tokens: int = 200) -> str:
    return (
        await _chat(
            "text",
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            max_tokens,
            0.2,
            False,
        )
    ).strip()


async def transcribe(filename: str, data: bytes, language_hint: str | None = None) -> dict:
    files = {"file": (filename, data, "application/octet-stream")}
    form = {"model": config.STT_MODEL, "response_format": "verbose_json", "temperature": "0"}
    if language_hint:
        form["language"] = language_hint
    r = await client().post("/audio/transcriptions", files=files, data=form)
    r.raise_for_status()
    j = r.json()
    return {"text": (j.get("text") or "").strip(), "language": j.get("language") or language_hint or "en"}


def _parse_json(raw: str) -> dict:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    start, end = raw.find("{"), raw.rfind("}")
    if start != -1 and end != -1:
        raw = raw[start : end + 1]
    try:
        return json.loads(raw)
    except Exception:
        log.warning("bad JSON from model: %s", raw[:200])
        return {}
