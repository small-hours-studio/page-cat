"""Builds the five Chrome Web Store screenshots (1280x800) in store/screenshots/.

Each is a scene staged on test/test-page.html with a one-line caption above it.
The menu shot needs the dev server:  python tools/dev_server.py 8765  (in another terminal)

Run from the page-cat folder:  python tools/make_screenshots.py
"""
import subprocess
import tempfile
import urllib.parse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PAGE = (ROOT / "test" / "test-page.html").as_uri()
MENU = "http://127.0.0.1:8765/test/popup-test.html?demo"
OUT = ROOT / "store" / "screenshots"
W, H, BAND = 1280, 800, 96
ZOOM = 1.6
BG, INK = (251, 246, 238), (42, 34, 28)


def spec(name):
    return urllib.parse.quote((ROOT / "orders" / f"{name}.json").read_text())


# (file, caption, query string for the test page)
SHOTS = [
    ("1-perch", "A little cat that lives on the websites you visit", "scene=perch&size=64&pattern=tabby"),
    ("2-play", "It steals words and bats them around", f"scene=play&size=64&t=0.5&spec={spec('boba')}"),
    ("3-held", "Pick it up by the scruff and put it somewhere else", f"scene=hold&hand&size=64&t=1.2&spec={spec('linda')}"),
    ("4-nap", "It naps when it's tired", "scene=nap&at=0.45&size=64&pattern=calico&tall"),
    ("5-menu", "Make it look like your cat", f"scene=perch&size=64&spec={spec('moe')}"),
]


def shoot(url, out, w, h, profile, dpr=1):
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
                    f"--user-data-dir={profile}", f"--window-size={w},{h}", f"--force-device-scale-factor={dpr}",
                    "--virtual-time-budget=4000", f"--screenshot={out}", url], capture_output=True, timeout=90)


def font(size):
    for n in ("segoeuisb.ttf", "seguisb.ttf", "segoeuib.ttf", "segoeui.ttf"):
        try:
            return ImageFont.truetype(n, size)
        except OSError:
            continue
    return ImageFont.load_default()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    f = font(34)
    with tempfile.TemporaryDirectory() as tmp:
        profile = Path(tmp) / "profile"
        for name, caption, query in SHOTS:
            raw = Path(tmp) / f"{name}.png"
            # Like a browser zoomed to 160%, so the cat is big enough to see in a store thumbnail.
            # "tall" scenes run in a taller window (the cat behaves as on a normal screen) and are cropped to fit.
            tall = query.endswith("&tall")
            shoot(f"{PAGE}?{query}", raw, round(W / ZOOM), round((H - BAND) / ZOOM * (1.4 if tall else 1)), profile, dpr=ZOOM)
            page = Image.open(raw).convert("RGB").crop((0, 0, W, H - BAND))
            img = Image.new("RGB", (W, H), BG)
            img.paste(page, (0, BAND))
            d = ImageDraw.Draw(img)
            d.line((0, BAND - 1, W, BAND - 1), fill=(229, 220, 206), width=2)
            tw = d.textlength(caption, font=f)
            d.text(((W - tw) / 2, BAND / 2), caption, font=f, fill=INK, anchor="lm")
            if name == "5-menu":
                menu_raw = Path(tmp) / "menu.png"
                shoot(MENU, menu_raw, 312, 800, profile, dpr=2)
                menu = Image.open(menu_raw).convert("RGB")
                # Just the top of the menu, down to the Get a custom cat button, so it's readable.
                px = menu.load()
                bg = px[menu.width // 2, 5]
                # the first divider line (a full-width row lighter than the background) after Your cats
                cut = next((y for y in range(2 * 560, menu.height)
                            if px[40, y] == px[menu.width // 2, y] == px[menu.width - 24, y] and px[40, y] != bg), menu.height)
                menu = menu.crop((0, 0, menu.width, cut + 1))
                scale = (H - BAND - 30) / menu.height
                menu = menu.resize((int(menu.width * scale), int(menu.height * scale)), Image.LANCZOS)
                x, y = W - menu.width - 40, BAND + 14
                shadow = Image.new("RGBA", (menu.width + 24, menu.height + 24), (0, 0, 0, 0))
                ImageDraw.Draw(shadow).rounded_rectangle((12, 14, menu.width + 12, menu.height + 12), 10, fill=(0, 0, 0, 70))
                img.paste(shadow, (x - 12, y - 12), shadow)
                img.paste(menu, (x, y))
            img.save(OUT / f"{name}.png", optimize=True)
            print(OUT / f"{name}.png")


if __name__ == "__main__":
    main()
