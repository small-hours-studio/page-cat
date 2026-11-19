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


HEX = set("0123456789abcdefABCDEF")
LIMITS = {"body": (40, 20), "neck": (10, 10), "head": (20, 20), "tail": (24, 3)}


def problems(spec):
    """Everything the extension would silently ignore or misdraw, so the maker can fix it."""
    out = []
    ok_hex = lambda c: isinstance(c, str) and len(c) in (3, 6) and set(c) <= HEX
    if spec.get("v") != 1: out.append('"v" must be 1')
    c = spec.get("c")
    if not (isinstance(c, list) and len(c) == 5 and all(ok_hex(x) for x in c)): out.append('"c" must be 5 hex colors')
    p = spec.get("p")
    if p is not None:
        keys = p.get("k") or {}
        for ch, col in keys.items():
            if len(ch) != 1 or ch == "." or not ok_hex(col): out.append(f'paint key {ch!r}: must be one letter with a hex color')
        def grid(where, rows, maxw, maxh):
            if isinstance(rows, str): rows = [rows]
            if not isinstance(rows, list) or not rows: out.append(f"{where}: must be a list of strings"); return
            lens = {len(r) for r in rows}
            if len(lens) != 1: out.append(f"{where}: rows have different lengths {sorted(lens)} - the whole grid is ignored")
            if max(lens) > maxw or len(rows) > maxh: out.append(f"{where}: too big (max {maxw} x {maxh})")
            bad = {ch for r in rows for ch in r if ch != "." and ch not in keys}
            if bad: out.append(f"{where}: letters not in the paint key: {''.join(sorted(bad))}")
        for side in ("L", "R"):
            for part, (mw, mh) in LIMITS.items():
                if isinstance(p.get(side), dict) and part in p[side]: grid(f"{side}.{part}", p[side][part], mw, mh)
        for n, rows in (p.get("legs") or {}).items():
            if n not in ("fl", "fr", "hl", "hr"): out.append(f"legs.{n}: use fl, fr, hl, hr")
            else: grid(f"legs.{n}", rows, 2, 16)
    for m in spec.get("m", []):
        if not (isinstance(m, list) and m and isinstance(m[0], str)): out.append(f"marking {m!r}: must start with its kind")
    return out


def main():
    spec_path = Path(sys.argv[1])
    spec = json.loads(spec_path.read_text())
    for msg in problems(spec):
        print("PROBLEM:", msg)
    spec_json = json.dumps(spec, separators=(",", ":"))
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
