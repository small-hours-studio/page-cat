# Chrome Web Store listing text

Paste these into the Developer Dashboard. Edit freely.

## Name
Page Cat

## Summary (132 characters max)
A small, hand-animated cat that lives on your web pages. It naps, wanders, scratches, and now and then hunts your cursor.

## Category
Fun

## Description
Page Cat puts a small cat on the pages you visit. It isn't a sticker or a looping GIF: every movement is worked out live, so it walks with a real cat's footfall, trots and gallops when it's in a hurry, leaps between headings and images, and curls up to nap.

What it does
• Walks along the tops of headings, paragraphs, cards and images, and jumps between them.
• Naps, loafs, grooms, stretches, and scratches the sides of the window.
• Its mood drifts over time, like a real cat: long sleepy stretches, playful spells, the odd case of zoomies.
• Now and then it notices your cursor: it might stalk and pounce on it, or walk over and head-bump it.
• Sometimes it swats a small icon or word off the page and chases it like a mouse. When play is over, the item goes straight back where it was.
• Click the cat to pet it.

Make it yours
• Size, girth (from slim to absolute unit), six coat colors and five patterns: solid, tabby, tuxedo, calico and colorpoint.
• Energy level, and switches for cursor play and page play.
• Call it to the current tab with one click, or have it on every site. Hide it on sites where you'd rather work in peace.
• Shortcut: Alt+Shift+C.

Private by design
Page Cat collects nothing and makes no network requests. Your settings stay in your browser. It never changes page content; anything it plays with is put back exactly as it was.

## Single purpose (Privacy practices tab)
Displays an animated cat companion on top of web pages the user chooses.

## Permission justifications (Privacy practices tab)
- storage: Saves the user's cat settings (size, coat, pattern, activity) and the list of sites where the user has hidden the cat.
- activeTab: Lets the user call the cat onto the current tab by clicking the toolbar button or pressing the shortcut, without granting access to other sites.
- scripting: Injects the cat's drawing script into the current tab when the user calls it, and registers it for all sites only if the user turns on "Show on every site".
- Host permission (<all_urls>, optional): Requested only when the user turns on "Show on every site", so the cat can appear on each page they open. Off by default.
- Remote code: No. All code ships in the package.

## Data usage (Privacy practices tab)
Check: "This extension does not collect or use user data" — none of the data categories apply.
Certify all three disclosures (no selling, no unrelated use, no creditworthiness use).

## Assets checklist
- Store icon (128×128, 96px art + 16px padding): store/icon-store-128.png
- Small promo tile (440×280): store/promo-small.png
- Marquee promo tile (1400×560, optional): store/marquee.png
- Screenshots (1280×800): store/screenshots/1-perch.png, 2-play.png, 3-nap.png, 4-settings.png
  (staged on test/test-page.html with headless Chrome; the cat is shown larger than its 32px default so it reads in the thumbnail)
- Source art from Codex: store/codex/ (rebuild with `python tools/import_codex_art.py`)
