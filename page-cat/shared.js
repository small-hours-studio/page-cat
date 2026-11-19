// Shared by the popup and the background service worker.
export const DEFAULTS = {
  size: 32, girth: 1.2, activity: 0.5, coat: 'ginger', pattern: 'solid',
  moodCycle: true, pagePlay: true, cursorPlay: true, follow: true,
};

// Pages Chrome never lets extensions draw on.
export function canVisit(url) {
  if (!url) return true; // unknown: try, and report if it fails
  return !/^(chrome|chrome-extension|edge|about|devtools|view-source):/i.test(url)
    && !/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i.test(url);
}

export function hostOf(url) {
  try { return new URL(url).hostname; } catch (e) { return ''; }
}
