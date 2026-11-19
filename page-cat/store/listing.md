# Chrome Web Store listing text

Paste these into the Developer Dashboard. Edit freely.

## Name
Page Cat

## Summary (132 characters max)
A little cat that lives on the websites you visit. It walks around, naps, scratches, and sometimes chases your mouse.

## Category
Fun

## Description
Page Cat adds a little cat to the websites you visit.

It walks along headings and pictures and jumps from one to the next. It naps, grooms, stretches when it wakes up, and scratches the edge of the window. Every so often it stalks your mouse pointer, or knocks a small picture or word off the page and chases it around for a while. Whatever it plays with goes back where it was.

Its mood changes over the day. Most of the time it's sleepy or relaxed, and once in a while it gets the zoomies.

You can pick its size, how chunky it is, a coat color, and a coat pattern. If you don't want it playing with the page or following your mouse, you can turn those off.

Click the toolbar button to bring the cat to the page you're on, or set it to show up on every site. Alt+Shift+C brings it over or sends it away. Click the cat to pet it.

Page Cat doesn't collect any data and never connects to the internet. Your settings stay in your browser.

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
