// Shared by the popup and the background service worker.
export const DEFAULTS = {
  size: 32, girth: 1.2, activity: 0.5, coat: 'ginger', pattern: 'solid',
  moodCycle: true, pagePlay: true, cursorPlay: true,
};
export const SCRIPT_ID = 'pagecat';
export const ALL_SITES = { origins: ['<all_urls>'] };

// Pages Chrome never lets extensions draw on.
export function canVisit(url) {
  if (!url) return true; // unknown: try, and report if it fails
  return !/^(chrome|chrome-extension|edge|about|devtools|view-source):/i.test(url)
    && !/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i.test(url);
}

// Ask the tab's cat to do something; inject it first if this tab doesn't have one yet.
export async function tellTab(tabId, type) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type });
  } catch (e) {
    if (type === 'pagecat:hide' || type === 'pagecat:status') return { visible: false };
    await chrome.scripting.executeScript({ target: { tabId }, func: () => { window.__pageCatManual = true; } });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/cat.js'] });
    return await chrome.tabs.sendMessage(tabId, { type: 'pagecat:show' });
  }
}

export async function syncRegistration() {
  const { pagecatAlways } = await chrome.storage.sync.get('pagecatAlways');
  const has = await chrome.permissions.contains(ALL_SITES);
  const reg = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (pagecatAlways && has) {
    if (!reg.length) {
      await chrome.scripting.registerContentScripts([{
        id: SCRIPT_ID, matches: ['<all_urls>'], js: ['content/cat.js'], runAt: 'document_idle', allFrames: false,
      }]);
    }
  } else {
    if (reg.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    if (pagecatAlways && !has) await chrome.storage.sync.set({ pagecatAlways: false });
  }
}
