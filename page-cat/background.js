import { DEFAULTS, canVisit, tellTab, syncRegistration } from './shared.js';

chrome.runtime.onInstalled.addListener(async () => {
  const { pagecat } = await chrome.storage.sync.get('pagecat');
  await chrome.storage.sync.set({ pagecat: { ...DEFAULTS, ...(pagecat || {}) } });
  await syncRegistration();
});
chrome.runtime.onStartup.addListener(syncRegistration);
chrome.permissions.onRemoved.addListener(syncRegistration);
chrome.permissions.onAdded.addListener(syncRegistration);

// Alt+Shift+C: call the cat to this tab or send it away.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-cat') return;
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !canVisit(tab.url)) return;
  try { await tellTab(tab.id, 'pagecat:toggle'); } catch (e) { /* page doesn't allow extensions */ }
});
