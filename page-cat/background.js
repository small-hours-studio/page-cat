import { DEFAULTS, canVisit, hostOf } from './shared.js';

// There is one cat. It lives in one tab at a time, and (with "Follow me to every tab" on) it moves
// to whichever tab you're looking at, bringing its mood and energy with it.
// Where it is lives in session storage: { catOut, catTab, catIndex, catWindow, catState }.
const session = chrome.storage.session;

// Run cat moves one at a time so fast tab switching can't leave two cats out.
let chain = Promise.resolve();
function queue(fn) { const p = chain.then(fn); chain = p.catch(() => {}); return p; }

async function settings() {
  const { pagecat } = await chrome.storage.sync.get('pagecat');
  return { ...DEFAULTS, ...(pagecat || {}) };
}
async function blocked(url) {
  const { pagecatBlocked = [] } = await chrome.storage.sync.get('pagecatBlocked');
  return pagecatBlocked.includes(hostOf(url));
}
async function send(tabId, msg) {
  try { return await chrome.tabs.sendMessage(tabId, msg); } catch (e) { return null; }
}
// Tabs opened before the extension was installed don't have the cat's script yet.
async function ensureScript(tabId) {
  if (await send(tabId, { type: 'pagecat:status' })) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => { window.__pageCatManual = true; } });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/cat.js'] });
    return true;
  } catch (e) { return false; }
}
async function isOut() {
  const { catOut } = await session.get('catOut');
  return catOut != null ? catOut : (await settings()).follow;
}

// The cat leaves its old tab (handing over its mood) and arrives in this one.
async function moveTo(tab, side, force) {
  const st = await session.get(['catTab', 'catState']);
  let state = st.catState || null;
  if (st.catTab != null && st.catTab !== tab.id) {
    const r = await send(st.catTab, { type: 'pagecat:leave' });
    if (r && r.state) state = r.state;
  }
  let shown = false;
  if (canVisit(tab.url) && (force || !(await blocked(tab.url))) && await ensureScript(tab.id)) {
    const r = await send(tab.id, { type: 'pagecat:arrive', side, state });
    shown = !!(r && r.visible);
  }
  // If it couldn't show here (a Chrome page, a hidden site), it waits and keeps its mood for later.
  await session.set({ catOut: true, catTab: shown ? tab.id : null, catIndex: tab.index, catWindow: tab.windowId, catState: shown ? null : state });
  return { visible: shown };
}

// Toolbar button / shortcut: call the cat here, or send it away if it's already here.
async function toggle(tab) {
  const here = await send(tab.id, { type: 'pagecat:status' });
  if (here && here.visible) {
    const r = await send(tab.id, { type: 'pagecat:leave' });
    await session.set({ catOut: false, catTab: null, catState: (r && r.state) || null });
    return { visible: false };
  }
  if (!canVisit(tab.url)) return { visible: false, error: 'restricted' };
  return moveTo(tab, null, true);
}

// You switched tabs or windows: if the cat is out and following you, it comes along.
async function follow(tab) {
  if (!tab || !(await settings()).follow || !(await isOut())) return;
  const st = await session.get(['catTab', 'catIndex', 'catWindow']);
  if (st.catTab === tab.id) {
    const s = await send(tab.id, { type: 'pagecat:status' });
    if (s && s.visible) return;
  }
  // It jumps in from the side your previous tab was on.
  const side = st.catWindow === tab.windowId && st.catIndex != null && st.catIndex !== tab.index
    ? (tab.index > st.catIndex ? 'left' : 'right') : null;
  await moveTo(tab, side, false);
}

// A page just loaded and asks whether the cat should be on it.
async function hello(tab) {
  if (!(await isOut())) return { show: false };
  const st = await session.get(['catTab', 'catState']);
  if (st.catTab === tab.id) { await session.set({ catState: null }); return { show: true, state: st.catState }; }
  if (!(await settings()).follow || !tab.active || await blocked(tab.url)) return { show: false };
  const win = await chrome.windows.getLastFocused().catch(() => null);
  if (win && win.id !== tab.windowId) return { show: false };
  let state = st.catState || null;
  if (st.catTab != null) {
    const r = await send(st.catTab, { type: 'pagecat:leave' });
    if (r && r.state) state = r.state;
  }
  await session.set({ catOut: true, catTab: tab.id, catIndex: tab.index, catWindow: tab.windowId, catState: null });
  return { show: true, state };
}

chrome.runtime.onInstalled.addListener(async () => {
  const { pagecat } = await chrome.storage.sync.get('pagecat');
  await chrome.storage.sync.set({ pagecat: { ...DEFAULTS, ...(pagecat || {}) } });
  // Say hello right away on the tab you're looking at.
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) queue(() => follow(tab));
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  queue(async () => follow(await chrome.tabs.get(tabId)));
});
chrome.windows.onFocusChanged.addListener(windowId => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  queue(async () => {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab) await follow(tab);
  });
});
chrome.tabs.onRemoved.addListener(tabId => {
  queue(async () => {
    const { catTab } = await session.get('catTab');
    if (catTab === tabId) await session.set({ catTab: null });
  });
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'toggle-cat') return;
  queue(async () => {
    if (!tab) [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab) await toggle(tab);
  });
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type === 'pagecat:hello' && sender.tab) {
    queue(() => hello(sender.tab)).then(reply, () => reply({ show: false }));
    return true;
  }
  if (msg.type === 'pagecat:state' && sender.tab) {
    // The cat's page is going away (navigation): remember its mood for the next page.
    queue(async () => {
      const { catTab } = await session.get('catTab');
      if (catTab === sender.tab.id) await session.set({ catState: msg.state });
    });
    return;
  }
  if (msg.type === 'pagecat:toggleTab') {
    queue(async () => toggle(await chrome.tabs.get(msg.tabId))).then(reply, e => reply({ visible: false, error: String(e) }));
    return true;
  }
});
