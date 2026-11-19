# Making a Page Cat from photos

You turn photos of a real cat into a cat spec (JSON) for Page Cat, a browser extension that draws a small side-view cartoon cat. The owner paid for this. They must recognize their own cat at a glance: every color, patch, stripe, white area and where each one sits must match the photos, on every part of the body.

## Inputs
- One or more photos of one cat, each labeled if the customer said which view it is (left side, right side, face). Labels can be wrong; trust what you see.
- The paint template image: shows exactly where each paint-map cell lands on the cat. Study it before painting.
- Sometimes (when working with tools) a renderer: `python tools/preview_cat.py <spec.json> <photo> [<photo> ...]` writes `<spec>-preview.png` with the photos, then the cat's left side, right side, sitting and napping. If you have it, use it (step 6). If not, you get one pass: be precise.

## Method
1. **Check the photos.** If you can't make out the coat (too dark, blurry, cat mostly hidden, more than one cat and unclear which), stop and output `{"reject": "<one sentence the customer can act on>"}` instead of a spec.
2. **Map the coat in words first.** Per photo, say which side of the cat it shows (the cat's left side faces the camera when its head points to the right of the picture). Then for each region, in this order, write what you see: head (each ear, forehead, around each eye, cheeks, muzzle, nose, chin), neck and throat, back, each flank, belly, chest, rump, shoulders, each leg from top to toe, tail from base to tip. Name colors, and whether each marking is a solid patch, fine speckling/mottling, or stripes. Correct for lighting (warm lamps make white look orange, shade makes orange look brown).
3. **Pick colors.** Sample the real fur colors, corrected for lighting. Choose the coat color (`c[0]`) as the most common color on the body. Use as many paint colors as the cat has (usually 2-5). Real cats: "black" is about `2a2622`, "orange" `d0803a`, "cream" `e9c896`, "white" `f5f2ec`, "blue/gray" `8a8f99`, "brown tabby" base `8a7560`. Adjust to the photo.
4. **Paint every region** with the paint map (below). Paint the legs too, especially the top rows: thighs and shoulders cover the lower body, so a patch on the hip must also be painted on the top rows of that hind leg. Paint both sides: if a photo shows the right side, use it for `R`; if you only have one side, paint the other side as your best guess of a natural continuation and say so in `notes`.
5. **Stripes:** for tabbies add `["tabby"]` (body, legs, tail stripes and forehead M in the stripe color) or `["rings"]` (tail only). Put stripes after the paint so they show on top, unless only some colored areas are striped; then paint the stripes into the map instead.
6. **Check your work.** Without a renderer, re-read every grid against your word map before answering: right size, each patch in the right rows and columns, both sides, all four legs, the face. With a renderer, render with every photo. Go region by region against your word map: head, neck, back, flanks, belly, chest, rump, each leg, tail; colors, patch positions, sizes, and edges. Fix what's off, render again. Up to 4 rounds. Stop when every region matches.

## Common mistakes (checked for, so avoid them)
- **Too bright.** Real orange fur is muted (`c98a4e`, `b8763d`), not traffic-cone orange. Tortoiseshell "orange" is often brown-tan (`a0683a`). Compare your swatch against the photo at the same spot.
- **Blocks instead of fur.** Paint patches with organic, irregular outlines that follow the photo, not rectangles. For fine tortoiseshell brindling (colors mixed in small streaks all over), add `["mottle", amount, size, seed, where, ..., color]` layers after the paint map, with small sizes (0.02-0.03), rather than painting dots by hand.
- **Face details missed.** Check the blaze down the nose, a split face (different color each side), muzzle, chin, eye rims, and the color of each ear separately. Ears are often a different color from the forehead.
- **Bib and chest.** A white bib shows on the side view at the neck (`neck` rows 2-3) and the front end of the body (`body` last 3-4 columns, lower rows). Paint all of it.
- **Eyes must show.** If the head around the eye is dark, choose the real iris color (they are rarely black); never make the eye the same color as the fur around it.
- **Thighs and shoulders.** The top 3 rows of each leg sit over the lower body. Paint them to continue the body pattern around them.

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
- Markings `m` (optional), drawn after the paint map unless you put `["paint"]` in the list to choose when it's drawn:
  - `["tabby"]`: stripes on body, legs and tail, and the forehead M, in the stripe color.
  - `["rings", firstTailSegment, width]`: tail rings only, e.g. `["rings", 4, 0.026]`.
  - `["mottle", amount, size, seed, where, bodyFrom, bodyTo, lowest, highest, "hex"]`: many small blotches of one color, for fine tortoiseshell brindling and speckling. amount 0-1 (0.3 sparse, 0.9 dense), size 0.02 fine to 0.06 coarse, seed any number (use a different one per layer), where = add 1 body, 2 head, 4 tail, 8 legs (15 all). The last four limit the body area: bodyFrom/bodyTo 0 (rump) to 4 (chest), lowest/highest -1 (belly) to 1.2 (back); defaults 0, 4, -1, 1.2. Example, fine tan brindle all over: `["mottle", 0.6, 0.025, 3, 15, "9a6a3e"]`. Example, orange speckles on the shoulders only: `["mottle", 0.5, 0.025, 7, 1, 2.5, 4, -0.2, 1.2, "c98a4e"]`.
- The render tool prints `PROBLEM:` lines for anything the extension would ignore (rows of different lengths, unknown letters). Fix every one.

## Revisions
If you're given a previous spec and the customer's note, change what the note asks for and anything that obviously goes with it (the same patch on the matching leg or side). Keep everything else exactly as it was.

## Output
When working with files: write the spec to the path you were given and finish with one line per region (matched / guessed) and a confidence (high, medium, low).

Otherwise: think it through, then end your answer with the spec (or the reject object) in a single ```json code block. Put anything you had to guess in the spec's `notes`, and a `"confidence"` of `"high"`, `"medium"` or `"low"`.
