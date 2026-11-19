# Page Cat

A Chrome extension (Manifest V3) that puts a small, procedurally animated cat on the pages you visit.

## Try it in your own Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this `page-cat` folder.
4. Pin Page Cat from the puzzle-piece menu, open any normal website, click the cat icon, and press **Call the cat here**.

After editing files, press the reload arrow on the Page Cat card in `chrome://extensions`, then reload the page.

Work computers often block Developer mode; test at home, or ask IT. Installing from the Web Store (below) is the route that works on managed machines.

## Files

| Path | What it is |
| --- | --- |
| `manifest.json` | Extension manifest. |
| `content/cat.js` | The cat: simulation, drawing, and reading the page. Runs in the tab. |
| `popup.html`, `popup.css`, `popup.js` | The menu that opens from the toolbar button. |
| `background.js` | Keeps track of the one cat and moves it to whichever tab you're on; keyboard shortcut. |
| `shared.js` | Defaults and helpers used by the popup and background. |
| `icons/` | Toolbar and store icons (`python tools/make_icons.py` redraws them). |
| `store/` | Store listing text and the promo tile (`python tools/make_store_art.py`). |
| `test/test-page.html` | A sample article that loads the cat directly, for testing without Chrome. |
| `PRIVACY.md` | Privacy policy to host and link from the store listing. |

## How it behaves on real pages

- There is one cat. With **Follow me to every tab** on (the default), it moves to whichever tab you're looking at and hops in from the side your previous tab was on, keeping its mood and energy. The toolbar button or **Alt+Shift+C** sends it away or calls it back. **Never show on this site** keeps it off a site.
- It draws in its own overlay (a closed shadow root) and never changes page content. The one exception is play: it may hide one small image or short word in place and chase a copy, then put the original back. It also puts it back on scroll, on tab switch, and when you hide the cat.
- It skips form fields, editable areas and code blocks, and it doesn't run inside iframes.
- It hides during full-screen video and slows its frame rate while resting.

## Custom cats

People can paste a **cat code** into the menu under **Your cats** to add their own cat. The cat is saved with Chrome sync, so it follows their Google account, and they can rename or remove it. Codes are signed, so only the developer can make them; the extension checks them offline and makes no network requests.

Making one:

1. Write the cat as a spec in `orders/<name>.json` (this folder is git-ignored; customer cats stay private).
2. Preview it next to the photo: `python tools/preview_cat.py orders/<name>.json photo.jpg`
3. Sign it: `node tools/catcode.mjs sign orders/<name>.json` and send the customer the `PC1.` code.
4. Check any code with `node tools/catcode.mjs read <code>`.

The signing key is `~/.pagecat/signing-key.pem`. **Back it up somewhere safe.** Without it no new codes can be made, and a new key would mean shipping an update that rejects every old code. `node tools/catcode.mjs keygen` refuses to replace an existing key.

### Spec format

```json
{ "v": 1, "n": "Boba", "c": ["27272c", "1b1b1f", "1b1b1f", "c5c45a", "8a8b95"], "m": [["chest", 0.08, 0.12, 0.5], ["socks", 1.6, 1.6]] }
```

`c` is five colors: coat, shading (far legs and ear), stripes, open eye, closed eye. `m` lists markings, painted in order; sizes are in body lengths. Any marking can end with a color (hex, no `#`); white areas default to white, others to the stripe color.

| Marking | Numbers |
| --- | --- |
| `tabby` | none: stripes on body, legs and tail, forehead "M" |
| `rings` | first tail segment (4), width (0.026): tail rings only |
| `chest` | width, height, depth into the chest (0.45) |
| `throat` | width, height |
| `muzzle` | width, height, how far forward (0.1) |
| `chin` | size |
| `blaze` | width (0.022): stripe up the nose |
| `belly` | depth (0.85) |
| `spot` | spine point 0 (hips) to 4 (shoulders), height (+ up the back, - down the belly, as a fraction), shift along the body, width, height |
| `face` | forward, down, width, height (head units: eye is about 0.06, -0.02) |
| `ears`, `points` | none: colored ears; darker face, ears, legs and tail |
| `tail` | first tail segment to color to the tip |
| `socks` | front, back: where the color starts on each leg, 0 = knee, 1 = ankle, 2 = toes |

## Publishing to the Chrome Web Store

1. **Register as a developer.** Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), sign in with the Google account you want to publish under, and pay the one-time $5 registration fee. Verify the contact email it asks for.
2. **Host the privacy policy.** Put `PRIVACY.md` somewhere public (a GitHub repo or Gist, Google Sites, or your own site) and fill in the contact line first. Copy the URL.
3. **Build the zip.** From this folder run:
   `powershell -ExecutionPolicy Bypass -File tools/package.ps1`
   This writes `dist/page-cat-<version>.zip` with only the runtime files.
4. **Take screenshots.** At least one, 1280×800 or 640×400, of the cat on a real page in Chrome. Up to five.
5. **Create the item.** In the dashboard click **New item**, upload the zip, then fill in:
   - **Store listing**: description, category, icon, promo tile and screenshots. Text is in `store/listing.md`.
   - **Privacy practices**: single purpose, a justification for each permission, "no remote code", and the data-use certification. All of it is in `store/listing.md`. Paste the privacy policy URL.
   - **Distribution**: choose **Public**, or **Unlisted** if only people with the link should find it.
6. **Submit for review.** Reviews usually take from a day to a few weeks. Access to all sites can lengthen review; the justification text addresses it.
7. **Updates.** Bump `version` in `manifest.json`, rebuild the zip, and upload it on the item's **Package** tab.

### Getting it onto work computers

Once it's published, people install it from its store page like any extension. If a company blocks extensions, IT can allow it by its extension ID (shown in the dashboard) with the `ExtensionInstallAllowlist` policy, or push it to everyone with `ExtensionInstallForcelist`. The short permission list (no data collection, no network access, all-sites access only on request) is what makes that an easy yes.
