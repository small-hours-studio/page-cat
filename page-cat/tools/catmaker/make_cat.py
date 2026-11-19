"""Make a Page Cat spec from photos in one Claude call (plus one fix-up call if the spec has format problems).

    python tools/catmaker/make_cat.py --name Mittens --photo left=a.jpg --photo face=b.jpg --out spec.json
    python tools/catmaker/make_cat.py --name Mittens --photo left=a.jpg --previous old.json --note "her left ear is black" --out spec.json

Credentials come from the environment (ANTHROPIC_API_KEY, or an `ant auth login` profile).
Prints one JSON line: {"ok": true, "reject": null, "confidence": ..., "usage": {...}, "cost_usd": ...}.
Set CATMAKER_MOCK=<spec.json> to skip the API and return that spec (for testing the order flow).
"""
import argparse
import base64
import io
import json
import os
import re
import sys
from pathlib import Path

from PIL import Image, ImageOps

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from catmaker.spec_check import problems  # noqa: E402

MODEL = "claude-opus-5-5"
# Claude Opus 5.5 prices per million tokens (input, output, cache read, cache write).
PRICE = {"in": 4.0, "out": 20.0, "cache_read": 0.2, "cache_write": 5.0}


def image_block(path):
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")  # phone photos are often stored sideways
    im.thumbnail((1568, 1568))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=88)
    return {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                        "data": base64.standard_b64encode(buf.getvalue()).decode()}}


def last_json(text):
    blocks = re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    raw = blocks[-1] if blocks else text[text.find("{"): text.rfind("}") + 1]
    return json.loads(raw)


def call(client, system, messages):
    # Long answers (thinking plus a few KB of grids), so stream. Fallbacks: if the model declines,
    # the API retries on a fallback model in the same call.
    with client.beta.messages.stream(
        model=MODEL, max_tokens=32000, system=system, messages=messages,
        output_config={"effort": "high"},
        betas=["server-side-fallback-2026-07-01"], fallbacks="default",
    ) as stream:
        msg = stream.get_final_message()
    if msg.stop_reason == "refusal":
        raise RuntimeError("the model declined this request")
    if msg.stop_reason == "max_tokens":
        raise RuntimeError("the answer was cut off")
    return msg


def add_usage(total, u):
    for k, src in (("in", "input_tokens"), ("out", "output_tokens"),
                   ("cache_read", "cache_read_input_tokens"), ("cache_write", "cache_creation_input_tokens")):
        total[k] = total.get(k, 0) + (getattr(u, src, 0) or 0)


def make(name, photos, previous=None, note=None):
    import anthropic
    client = anthropic.Anthropic()
    system = [{"type": "text", "text": (HERE / "MAKER.md").read_text(encoding="utf-8"), "cache_control": {"type": "ephemeral"}}]
    content = [
        {"type": "text", "text": "The paint template:"},
        {**image_block(HERE / "paint-template.png"), "cache_control": {"type": "ephemeral"}},
    ]
    for label, path in photos:
        content += [{"type": "text", "text": f"Photo ({label}):" if label else "Photo:"}, image_block(path)]
    task = f'The cat\'s name is "{name}".'
    if previous:
        task += ("\n\nThis is a revision. The previous spec:\n```json\n" + json.dumps(previous) + "\n```\n"
                 f"The customer's note: {note}\nChange what the note asks for, keep everything else.")
    else:
        task += "\n\nMake this cat."
    content.append({"type": "text", "text": task})
    messages = [{"role": "user", "content": content}]
    usage = {}
    msg = call(client, system, messages)
    add_usage(usage, msg.usage)
    text = "".join(b.text for b in msg.content if b.type == "text")
    spec = last_json(text)
    if "reject" not in spec:
        found = problems(spec)
        if found:
            # one fix-up turn; pass the whole assistant turn back unchanged
            messages += [{"role": "assistant", "content": msg.content},
                         {"role": "user", "content": "The spec has these problems:\n- " + "\n- ".join(found) +
                          "\nReply with the corrected spec in one ```json block."}]
            msg = call(client, system, messages)
            add_usage(usage, msg.usage)
            spec = last_json("".join(b.text for b in msg.content if b.type == "text"))
    return spec, usage


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--photo", action="append", default=[], help="label=path or just path")
    ap.add_argument("--previous")
    ap.add_argument("--note")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    photos = [tuple(p.split("=", 1)) if "=" in p else ("", p) for p in a.photo]
    previous = json.loads(Path(a.previous).read_text()) if a.previous else None
    if os.environ.get("CATMAKER_MOCK"):
        spec, usage = json.loads(Path(os.environ["CATMAKER_MOCK"]).read_text()), {}
    else:
        spec, usage = make(a.name, photos, previous, a.note)
    result = {"ok": True, "reject": spec.get("reject"), "confidence": spec.get("confidence"), "usage": usage,
              "cost_usd": round(sum(usage.get(k, 0) * PRICE[k] for k in PRICE) / 1e6, 4)}
    if not result["reject"]:
        spec["n"] = a.name[:24]
        left = problems(spec)
        if left:
            result.update(ok=False, error="spec still has problems: " + "; ".join(left))
        Path(a.out).write_text(json.dumps(spec))
    print(json.dumps(result))
    sys.exit(0 if result["ok"] else 1)


if __name__ == "__main__":
    main()
