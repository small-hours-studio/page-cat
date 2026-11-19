"""Draws the Page Cat icon (a sitting cat silhouette) and writes the PNG sizes Chrome needs.

Run from the page-cat folder:  python tools/make_icons.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

BIG = 1024
COAT = (227, 137, 59, 255)
EYE = (43, 28, 16, 255)


def draw_cat(size=BIG):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = size / 512

    def ell(cx, cy, rx, ry, fill=COAT):
        d.ellipse([(cx - rx) * k, (cy - ry) * k, (cx + rx) * k, (cy + ry) * k], fill=fill)

    def poly(pts, fill=COAT):
        d.polygon([(x * k, y * k) for x, y in pts], fill=fill)

    def stroke(pts, w):
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            d.line([x0 * k, y0 * k, x1 * k, y1 * k], fill=COAT, width=int(w * k))
            ell(x1, y1, w / 2, w / 2)
        ell(pts[0][0], pts[0][1], w / 2, w / 2)

    # tail curling up behind
    stroke([(205, 455), (150, 452), (105, 425), (88, 380), (95, 330), (118, 292)], 34)
    # haunch, chest, front legs
    ell(225, 375, 118, 98)
    ell(285, 300, 82, 122)
    stroke([(300, 360), (305, 440), (308, 468)], 46)
    stroke([(262, 380), (262, 445), (262, 468)], 42)
    ell(215, 455, 82, 22)
    # neck and head
    ell(318, 205, 62, 66)
    ell(338, 165, 86, 78)
    ell(402, 186, 34, 28)
    # ears
    poly([(268, 128), (282, 52), (330, 102)])
    poly([(338, 96), (390, 40), (408, 120)])
    # eye
    ell(372, 160, 10, 14, EYE)
    return img


def main():
    out = Path(__file__).resolve().parent.parent / "icons"
    out.mkdir(exist_ok=True)
    big = draw_cat()
    # A little inset so the silhouette doesn't touch the edges.
    for px in (16, 32, 48, 128):
        inset = max(1, round(px * 0.04))
        im = big.resize((px - 2 * inset, px - 2 * inset), Image.LANCZOS)
        canvas = Image.new("RGBA", (px, px), (0, 0, 0, 0))
        canvas.paste(im, (inset, inset), im)
        canvas.save(out / f"icon{px}.png")
    big.resize((512, 512), Image.LANCZOS).save(out / "icon512.png")
    print("wrote", ", ".join(f"icon{p}.png" for p in (16, 32, 48, 128, 512)))


if __name__ == "__main__":
    main()
