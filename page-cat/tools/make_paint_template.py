"""Draws tools/catmaker/paint-template.png: where each paint-map cell lands on the cat.

Every region is painted as a checkerboard in its own color, with darker ruler cells so rows and
columns can be counted. The cat maker looks at this image to place colors in the right cells.

Run from the page-cat folder:  python tools/make_paint_template.py
"""
import json
import subprocess
import tempfile
import urllib.parse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PAGE = (ROOT / "test" / "test-page.html").as_uri()
OUT = ROOT / "tools" / "catmaker" / "paint-template.png"

# key letters: two checker tints and a ruler tint per region
KEYS = {
    "a": "cfe0f5", "b": "a9c6ec", "A": "2f6fc4",   # body: blue
    "c": "d4f0d0", "d": "a8dca0", "C": "2f8f3a",   # head: green
    "e": "eadbf5", "f": "d1b6ec", "E": "7a3fb8",   # neck: purple
    "g": "fde3c4", "h": "f8c58c", "G": "c86a12",   # tail: orange
    "i": "fbf3b0", "j": "f1e06a", "I": "a08a00",   # front leg: yellow
    "k": "fbd0e0", "l": "f3a6c3", "K": "b8336a",   # hind leg: pink
}


def grid(w, h, a, b, ruler, every_c, every_r):
    rows = []
    for r in range(h):
        row = ""
        for c in range(w):
            if (every_c and c % every_c == 0) or (every_r and r % every_r == 0):
                row += ruler
            else:
                row += a if (r + c) % 2 == 0 else b
        rows.append(row)
    return rows


SIDE = {
    "body": grid(24, 10, "a", "b", "A", 4, 5),
    "head": grid(10, 10, "c", "d", "C", 5, 5),
    "neck": grid(4, 4, "e", "f", "E", 0, 2),
    "tail": grid(14, 1, "g", "h", "G", 4, 0),
}
LEGS = {n: grid(2, 9, *(("i", "j", "I") if n[0] == "f" else ("k", "l", "K")), 0, 3) for n in ("fl", "fr", "hl", "hr")}
SPEC = {"v": 1, "n": "Template", "c": ["f4f2ed", "e2ded6", "999999", "333333", "666666"], "m": [],
        "p": {"k": KEYS, "L": SIDE, "legs": LEGS}}


def shoot(pose, facing, out, profile):
    url = f"{PAGE}?scene=portrait&pose={pose}&face={facing}&size=96&spec={urllib.parse.quote(json.dumps(SPEC))}"
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
                    "--default-background-color=00000000", "--force-device-scale-factor=5",
                    f"--user-data-dir={profile}", "--window-size=1280,800", "--virtual-time-budget=2000",
                    f"--screenshot={out}", url], capture_output=True, timeout=90)
    im = Image.open(out).convert("RGBA")
    return im.crop(im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox())


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        prof = Path(tmp) / "p"
        stand = shoot("idle", "right", Path(tmp) / "a.png", prof)
        sit = shoot("sit", "right", Path(tmp) / "b.png", prof)
    stand.thumbnail((900, 700)); sit.thumbnail((520, 700))
    W, H = 1500, 1050
    img = Image.new("RGBA", (W, H), (255, 255, 255, 255))
    img.alpha_composite(stand, (20, 60)); img.alpha_composite(sit, (960, 60))
    d = ImageDraw.Draw(img)
    try:
        f, fb = ImageFont.truetype("segoeui.ttf", 22), ImageFont.truetype("segoeuib.ttf", 26)
    except OSError:
        f = fb = ImageFont.load_default()
    d.text((20, 14), "Paint map template: the cat's LEFT side (it faces right). Standing, and sitting.", font=fb, fill="black")
    lines = [
        "BLUE  body 24 columns x 10 rows. Column 0 = rump (left in the picture), column 23 = chest. Row 0 = top of the back, row 9 = belly line.",
        "      Dark blue ruler cells: columns 0, 4, 8, 12, 16, 20 and rows 0 and 5.",
        "GREEN  head 10 x 10. Column 0 = back of the head, column 9 = nose tip. Row 0 = ear tips, row 9 = chin. Rulers: columns 0, 5 and rows 0, 5.",
        "PURPLE  neck 4 x 4. Column 0 = shoulders, column 3 = under the jaw. Row 0 = back of the neck, row 3 = throat. Rulers: rows 0, 2.",
        "ORANGE  tail 14 columns x 1 row. Column 0 = base, column 13 = tip. Rulers: columns 0, 4, 8, 12.",
        "YELLOW  front legs, PINK  hind legs: 9 rows x 2 columns each. Row 0 = top of the leg (shoulder or hip), rows 7-8 = paw.",
        "      Column 0 = back edge of the leg, column 1 = front edge. Rulers: rows 0, 3, 6.",
        "The right side (seen when the cat faces left) uses the same layout, mirrored: column 0 of the body is still the rump.",
    ]
    y = 790
    for ln in lines:
        d.text((20, y), ln, font=f, fill="black"); y += 31
    img.convert("RGB").save(OUT)
    print(OUT)


if __name__ == "__main__":
    main()
