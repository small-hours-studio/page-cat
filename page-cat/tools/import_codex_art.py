"""Turns the Codex-generated art in store/codex/ into the files the extension and store need.

- icons/icon{16,32,48,128}.png  from logo-a.png (background keyed out to transparent)
- store/icon-store-128.png      128x128 with the 96x96 artwork + 16px padding Chrome recommends
- store/promo-small.png         440x280 small promo tile, from promo-wide.png + title
- store/marquee.png             1400x560 marquee, from marquee.png + title

Run from the page-cat folder:  python tools/import_codex_art.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "store" / "codex"
INK = (42, 34, 28)
SUB = (118, 104, 92)


def font(names, size):
    for n in names:
        try:
            return ImageFont.truetype(n, size)
        except OSError:
            continue
    return ImageFont.load_default()


def key_out_background(im, tol=38):
    """Make the flat off-white background transparent, keeping soft anti-aliased edges."""
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    # Background colour sampled from the corners.
    corners = [px[2, 2], px[w - 3, 2], px[2, h - 3], px[w - 3, h - 3]]
    bg = tuple(sum(c[i] for c in corners) // 4 for i in range(3))
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            d = max(abs(r - bg[0]), abs(g - bg[1]), abs(b - bg[2]))
            if d < tol:
                alpha = int(255 * max(0, (d - tol * 0.35)) / (tol * 0.65))
                px[x, y] = (r, g, b, min(a, alpha))
    return im


def trim(im, pad_ratio=0.06):
    box = im.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
    im = im.crop(box)
    side = max(im.size)
    pad = int(side * pad_ratio)
    sq = Image.new("RGBA", (side + 2 * pad, side + 2 * pad), (0, 0, 0, 0))
    sq.paste(im, ((sq.width - im.width) // 2, (sq.height - im.height) // 2), im)
    return sq


def fit_cover(im, w, h, anchor_x=0.5):
    """Scale to cover w x h, then crop (horizontally anchored)."""
    s = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    left = int((im.width - w) * anchor_x)
    top = (im.height - h) // 2
    return im.crop((left, top, left + w, top + h))


def main():
    logo = trim(key_out_background(Image.open(SRC / "logo-a.png")))
    icons = ROOT / "icons"
    for px in (16, 32, 48, 128):
        logo.resize((px, px), Image.LANCZOS).save(icons / f"icon{px}.png")
    logo.resize((512, 512), Image.LANCZOS).save(icons / "icon512.png")

    store_icon = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    art = logo.resize((96, 96), Image.LANCZOS)
    store_icon.paste(art, (16, 16), art)
    store_icon.save(ROOT / "store" / "icon-store-128.png")

    title_f = ["segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"]
    sub_f = ["segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"]

    promo = fit_cover(Image.open(SRC / "promo-wide.png").convert("RGB"), 440, 280, anchor_x=0.0)
    d = ImageDraw.Draw(promo)
    d.text((248, 96), "Page Cat", font=font(title_f, 38), fill=INK)
    d.text((250, 146), "A little cat that lives", font=font(sub_f, 15), fill=SUB)
    d.text((250, 166), "on your web pages", font=font(sub_f, 15), fill=SUB)
    promo.save(ROOT / "store" / "promo-small.png")

    mq = fit_cover(Image.open(SRC / "marquee.png").convert("RGB"), 1400, 560, anchor_x=0.0)
    d = ImageDraw.Draw(mq)
    d.text((930, 200), "Page Cat", font=font(title_f, 86), fill=INK)
    d.text((936, 312), "A little cat that lives on your web pages.", font=font(sub_f, 26), fill=SUB)
    d.text((936, 350), "It naps, wanders, scratches, and hunts.", font=font(sub_f, 26), fill=SUB)
    mq.save(ROOT / "store" / "marquee.png")
    print("icons, store icon, promo tile and marquee written")


if __name__ == "__main__":
    main()
