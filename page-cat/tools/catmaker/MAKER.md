# Making a Page Cat from photos

You turn photos of a real cat into a cat spec (JSON) for Page Cat, a browser extension that draws a small side-view cartoon cat. The owner paid for this. They must recognize their own cat at a glance: every color, patch, stripe, white area and where each one sits must match the photos, on every part of the body.

## Inputs
- One or more photos of one cat.
- `tools/catmaker/paint-template.png`: shows exactly where each paint-map cell lands on the cat. Look at it before painting.
- A tool that renders your spec: `python tools/preview_cat.py <spec.json> <photo> [<photo> ...]` writes `<spec>-preview.png` with the photos, then the cat's left side, right side, sitting and napping.

## Method
1. **Check the photos.** If you can't make out the coat (too dark, blurry, cat mostly hidden, more than one cat and unclear which), stop and output `{"reject": "<one sentence the customer can act on>"}` instead of a spec.
2. **Map the coat in words first.** Per photo, say which side of the cat it shows (the cat's left side faces the camera when its head points to the right of the picture). Then for each region, in this order, write what you see: head (each ear, forehead, around each eye, cheeks, muzzle, nose, chin), neck and throat, back, each flank, belly, chest, rump, shoulders, each leg from top to toe, tail from base to tip. Name colors, and whether each marking is a solid patch, fine speckling/mottling, or stripes. Correct for lighting (warm lamps make white look orange, shade makes orange look brown).
3. **Pick colors.** Sample the real fur colors, corrected for lighting. Choose the coat color (`c[0]`) as the most common color on the body. Use as many paint colors as the cat has (usually 2-5). Real cats: "black" is about `2a2622`, "orange" `d0803a`, "cream" `e9c896`, "white" `f5f2ec`, "blue/gray" `8a8f99`, "brown tabby" base `8a7560`. Adjust to the photo.
4. **Paint every region** with the paint map (below). Paint the legs too, especially the top rows: thighs and shoulders cover the lower body, so a patch on the hip must also be painted on the top rows of that hind leg. Paint both sides: if a photo shows the right side, use it for `R`; if you only have one side, paint the other side as your best guess of a natural continuation and say so in `notes`.
5. **Stripes:** for tabbies add `["tabby"]` (body, legs, tail stripes and forehead M in the stripe color) or `["rings"]` (tail only). Put stripes after the paint so they show on top, unless only some colored areas are striped; then paint the stripes into the map instead.
6. **Render and compare.** Render with every photo. Go region by region against your word map: head, neck, back, flanks, belly, chest, rump, each leg, tail; colors, patch positions, sizes, and edges. Fix what's off, render again. Up to 4 rounds. Stop when every region matches.

## Spec format
```json
{
  "v": 1, "n": "Mittens",
  "c": ["coat", "shade", "stripe", "eyeOpen", "eyeClosed"],
  "m": [["tabby"]],
  "p": {
    "k": { "w": "f5f2ec", "b": "2a2622", "o": "d0803a" },
    "L": { "body": [...], "neck": [...], "head": [...], "tail": [...] },
    "R": { "body": [...], "neck": [...], "head": [...], "tail": [...] },
    "legs": { "fl": [...], "fr": [...], "hl": [...], "hr": [...] }
  },
  "notes": "anything you had to guess"
}
```
- `c`: five 6-digit hex colors without `#`. `coat` is the main fur color (unpainted cells show it). `shade` is a slightly darker coat. `stripe` is the stripe color for `["tabby"]`. Eye colors: open eye (the iris color: green `a8b45a`, yellow-green `c5c45a`, amber `c99a3a`, copper `c47a2c`, blue `5f9ad6`), closed-eye line (a dark tone).
- `p.k`: one letter per paint color. `.` means "leave the coat color".
- Grids are lists of strings, all the same length. Sizes (recommended, you may use other sizes within the limits):
  - `body` 24 columns x 10 rows (max 40 x 20). Column 0 = rump, last column = chest. Row 0 = top of the back, last row = belly line.
  - `neck` 4 x 4. Column 0 = shoulders, last = under the jaw. Row 0 = back of the neck, last = throat.
  - `head` 10 x 10. Column 0 = back of the head, last = nose tip. Row 0 = ear tips, last = chin. The eye is near column 7, rows 4-5. Ears are rows 0-2, columns 2-6.
  - `tail` 14 columns x 1 row (or 2 rows: top, underside). Column 0 = base, last = tip.
  - legs `fl` front-left, `fr` front-right, `hl` hind-left, `hr` hind-right: 9 rows x 2 columns. Row 0 = top of the leg (shoulder or hip), rows 7-8 = paw. Column 0 = back edge, column 1 = front edge.
- `L` is the cat's left side; `R` its right side. Both use the same layout (column 0 of the body is always the rump). On the left side, the near legs are `fl` and `hl`; on the right side, `fr` and `hr`.
- Markings `m` (optional): `["tabby"]`, `["rings", firstTailSegment, width]`, and the older shape markings if useful. Keep `m` short; the paint map does the work.

## Output
Write the spec to the path you were given, render it, and finish with:
- the final spec path,
- one line per region saying matched / guessed,
- `confidence`: high (every region seen and matched), medium (some regions guessed), low (major guesses).
