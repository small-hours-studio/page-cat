"""Render a cat spec next to its photos: left side standing, right side standing, sitting, napping.

    python tools/preview_cat.py orders/mittens.json [photo.jpg ...]

Writes orders/<name>-preview.png. The left side is what you see when the cat faces right.
Uses the local test page and headless Chrome.
"""
import json
import subprocess
import sys
import tempfile
import urllib.parse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent.parent
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PAGE = (ROOT / "test" / "test-page.html").as_uri()
BG = (250, 250, 247, 255)
TILE = 360
# (label, pose, facing)
VIEWS = [("left side", "idle", "right"), ("right side", "idle", "left"), ("sitting", "sit", "right"), ("napping", "sleep", "right")]


def font(size):
    for n in ("segoeuisb.ttf", "segoeui.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(n, size)
        except OSError:
            continue
    return ImageFont.load_default()


def render(spec_json, pose, facing, out, profile):
    url = f"{PAGE}?scene=portrait&pose={pose}&face={facing}&size=96&spec={urllib.parse.quote(spec_json)}"
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
                    "--default-background-color=00000000", "--force-device-scale-factor=3",
                    f"--user-data-dir={profile}", "--window-size=1280,800", "--virtual-time-budget=2000",
                    f"--screenshot={out}", url], capture_output=True, timeout=90)
    im = Image.open(out).convert("RGBA")
    box = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    cat = im.crop(box) if box else im
    cat.thumbnail((TILE - 20, TILE - 50))
    tile = Image.new("RGBA", (TILE, TILE), BG)
    tile.alpha_composite(cat, ((TILE - cat.width) // 2, TILE - 14 - cat.height))
    return tile


def main():
    spec_path = Path(sys.argv[1])
    spec_json = json.dumps(json.loads(spec_path.read_text()), separators=(",", ":"))
    photos = []
    for p in sys.argv[2:]:
        ph = ImageOps.exif_transpose(Image.open(p)).convert("RGBA")  # phone photos are often stored sideways
        ph.thumbnail((TILE, TILE))
        photos.append(ph)
    tiles = []
    with tempfile.TemporaryDirectory() as tmp:
        profile = Path(tmp) / "profile"
        for i, (label, pose, facing) in enumerate(VIEWS):
            tiles.append((label, render(spec_json, pose, facing, Path(tmp) / f"{i}.png", profile)))
    w = sum(p.width + 10 for p in photos) + TILE * len(tiles)
    sheet = Image.new("RGBA", (w, TILE), BG)
    d, f = ImageDraw.Draw(sheet), font(20)
    x = 0
    for p in photos:
        sheet.alpha_composite(p, (x, (TILE - p.height) // 2))
        x += p.width + 10
    for label, t in tiles:
        sheet.alpha_composite(t, (x, 0))
        d.text((x + 10, 8), label, font=f, fill=(90, 80, 70, 255))
        x += TILE
    out = spec_path.with_name(spec_path.stem + "-preview.png")
    sheet.convert("RGB").save(out)
    print(out)


if __name__ == "__main__":
    main()
