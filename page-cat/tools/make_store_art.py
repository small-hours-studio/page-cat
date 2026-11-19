"""Draws the 440x280 small promo tile for the Chrome Web Store listing.

Run from the page-cat folder (after make_icons.py):  python tools/make_store_art.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent


def font(names, size):
    for n in names:
        try:
            return ImageFont.truetype(n, size)
        except OSError:
            continue
    return ImageFont.load_default()


def main():
    W, H = 440, 280
    img = Image.new("RGB", (W, H), (251, 246, 238))
    d = ImageDraw.Draw(img)
    # a "page": a heading bar and some text lines the cat is sitting on
    d.rounded_rectangle([36, 150, 250, 166], 4, fill=(205, 196, 184))
    for i, w in enumerate([210, 196, 204, 150]):
        d.rounded_rectangle([36, 184 + i * 16, 36 + w, 190 + i * 16], 3, fill=(228, 221, 211))
    cat = Image.open(ROOT / "icons" / "icon512.png").resize((150, 150), Image.LANCZOS)
    img.paste(cat, (118, 20), cat)
    title = font(["segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"], 32)
    sub = font(["segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"], 16)
    d.text((268, 98), "Page Cat", font=title, fill=(42, 34, 28))
    d.text((270, 142), "A cat that lives", font=sub, fill=(110, 98, 88))
    d.text((270, 163), "on your web pages", font=sub, fill=(110, 98, 88))
    out = ROOT / "store" / "promo-small.png"
    out.parent.mkdir(exist_ok=True)
    img.save(out)
    print("wrote", out.relative_to(ROOT))


if __name__ == "__main__":
    main()
