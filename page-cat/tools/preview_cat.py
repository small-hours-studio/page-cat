"""Render a cat spec sitting, walking and napping, side by side with an optional photo.

    python tools/preview_cat.py orders/mittens.json [photo.jpg]

Writes orders/<name>-preview.png. Uses the local test page and headless Chrome.
"""
import json
import subprocess
import sys
import tempfile
import urllib.parse
from pathlib import Path

from PIL import Image, ImageChops, ImageOps

ROOT = Path(__file__).resolve().parent.parent
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PAGE = (ROOT / "test" / "test-page.html").as_uri()
BG = (250, 250, 247)


def shoot(spec_json, scene, out, profile):
    url = f"{PAGE}?scene={scene}&size=110&t=1.3&spec={urllib.parse.quote(spec_json)}"
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
                    f"--user-data-dir={profile}", "--window-size=1280,800", "--virtual-time-budget=1500",
                    f"--screenshot={out}", url], capture_output=True, timeout=60)


def crop_cat(path, plain):
    # Find the cat by comparing with the same scene drawn in plain ginger.
    im, base = Image.open(path).convert("RGB"), Image.open(plain).convert("RGB")
    box = ImageChops.difference(im, base).convert("L").point(lambda v: 255 if v > 30 else 0).getbbox()
    if not box:
        return im.crop((540, 0, 940, 400))
    cx, cy = (box[0] + box[2]) // 2, (box[1] + box[3]) // 2
    return im.crop((cx - 120, cy - 110, cx + 120, cy + 110)).resize((360, 330))


def main():
    spec_path = Path(sys.argv[1])
    spec = json.loads(spec_path.read_text())
    spec_json = json.dumps(spec, separators=(",", ":"))
    plain = json.dumps({"v": 1, "n": "x", "c": ["e3893b", "b8662a", "b25b1f", "2b1c10", "5a2c0e"], "m": []})
    tiles = []
    with tempfile.TemporaryDirectory() as tmp:
        profile = Path(tmp) / "profile"
        for scene in ("perch", "walk", "nap"):
            a, b = Path(tmp) / f"{scene}.png", Path(tmp) / f"{scene}-plain.png"
            shoot(spec_json, scene, a, profile)
            shoot(plain, scene, b, profile)
            tiles.append(crop_cat(a, b))
    photo = None
    if len(sys.argv) > 2:
        # phone photos are often stored sideways with a rotation tag; apply it
        photo = ImageOps.exif_transpose(Image.open(sys.argv[2])).convert("RGB")
        photo.thumbnail((330, 330))
    w = 360 * len(tiles) + (photo.width + 20 if photo else 0)
    sheet = Image.new("RGB", (w, 330), BG)
    x = 0
    if photo:
        sheet.paste(photo, (0, (330 - photo.height) // 2))
        x = photo.width + 20
    for t in tiles:
        sheet.paste(t, (x, 0))
        x += 360
    out = spec_path.with_name(spec_path.stem + "-preview.png")
    sheet.save(out)
    print(out)


if __name__ == "__main__":
    main()
