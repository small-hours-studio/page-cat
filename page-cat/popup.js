import { DEFAULTS, canVisit, hostOf } from './shared.js';

const COATS = [
  ['ginger', '#e3893b', 'Ginger'], ['charcoal', '#34353d', 'Charcoal'], ['bluegray', '#8d97a9', 'Blue-gray'],
  ['cream', '#f1e4cd', 'Cream'], ['white', '#f4f2ed', 'White'], ['brown', '#8a6a4f', 'Brown'],
];
const PATTERNS = [['solid', 'Solid'], ['tabby', 'Tabby'], ['tuxedo', 'Tuxedo'], ['calico', 'Calico'], ['points', 'Colorpoint'],
  ['locket', 'Boba'], ['tabbywhite', 'Moe'], ['pastel', 'Linda']];
// These patterns come with their own colors.
const OWN_COAT = {
  calico: 'Calico cats are white with orange and black patches',
  locket: 'Boba is black with a white locket',
  tabbywhite: 'Moe is a brown tabby with white',
  pastel: 'Linda is pale orange and white',
};
const MOOD_NAMES = { sleepy: 'Sleepy', chill: 'Chill', playful: 'Playful', hyper: 'Zoomies' };

const $ = id => document.getElementById(id);
let settings = { ...DEFAULTS };
let tab = null;

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => chrome.storage.sync.set({ pagecat: settings }), 200);
}

function label() {
  $('sizeOut').textContent = settings.size + ' px';
  const g = settings.girth;
  $('girthOut').textContent = g < 0.95 ? 'Slim' : g < 1.3 ? 'Sturdy' : g < 1.55 ? 'Chonky' : 'Absolute unit';
  const a = settings.activity;
  $('activityOut').textContent = a < 0.25 ? 'Lazy' : a < 0.6 ? 'Easygoing' : a < 0.85 ? 'Playful' : 'Hyper';
  $('activityLbl').textContent = settings.moodCycle ? 'Energy' : 'Activity';
  $('activity').title = settings.moodCycle
    ? 'Moods still come and go; this shifts the average up or down.'
    : 'How lively the cat is.';
}

function render() {
  $('size').value = settings.size;
  $('girth').value = settings.girth;
  $('activity').value = settings.activity;
  for (const k of ['follow', 'moodCycle', 'pagePlay', 'cursorPlay']) $(k).checked = !!settings[k];
  for (const b of $('coats').children) b.setAttribute('aria-checked', String(b.dataset.v === settings.coat));
  for (const b of $('patterns').children) b.setAttribute('aria-checked', String(b.dataset.v === settings.pattern));
  const own = OWN_COAT[settings.pattern];
  $('calicoNote').hidden = !own;
  if (own) $('calicoNote').textContent = own + ", so the coat color doesn't apply.";
  $('coats').style.opacity = own ? '0.45' : '';
  label();
}

function buildPickers() {
  for (const [v, c, name] of COATS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'swatch'; b.dataset.v = v; b.title = name;
    b.setAttribute('role', 'radio'); b.setAttribute('aria-label', name);
    b.style.setProperty('--c', c);
    b.addEventListener('click', () => { settings.coat = v; render(); save(); });
    $('coats').append(b);
  }
  for (const [v, name] of PATTERNS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.dataset.v = v; b.textContent = name;
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => { settings.pattern = v; render(); save(); });
    $('patterns').append(b);
  }
}

function setVisible(visible, mood) {
  const btn = $('summon');
  btn.textContent = visible ? 'Send the cat away' : 'Call the cat here';
  btn.classList.toggle('away', visible);
  const m = $('mood');
  if (visible && mood && MOOD_NAMES[mood]) { m.hidden = false; m.textContent = MOOD_NAMES[mood]; } else m.hidden = true;
}

async function init() {
  buildPickers();
  const store = await chrome.storage.sync.get(['pagecat', 'pagecatBlocked']);
  settings = { ...DEFAULTS, ...(store.pagecat || {}) };
  render();

  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = tab ? hostOf(tab.url) : '';
  $('host').textContent = host || 'this site';
  $('siteRow').hidden = !host || !canVisit(tab.url);
  $('site').checked = (store.pagecatBlocked || []).includes(host);

  if (!tab || !canVisit(tab.url)) {
    $('summon').disabled = true;
    $('note').hidden = false;
    $('note').textContent = "Chrome doesn't let extensions onto this page. Try a regular website.";
    return;
  }
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'pagecat:status' });
    setVisible(!!(r && r.visible), r && r.mood);
  } catch (e) { setVisible(false); }
}

// The background keeps track of the one cat, so calling it here also takes it off its old tab.
$('summon').addEventListener('click', async () => {
  if (!tab) return;
  const r = await chrome.runtime.sendMessage({ type: 'pagecat:toggleTab', tabId: tab.id }).catch(() => null);
  if (!r || r.error) {
    $('note').hidden = false;
    $('note').textContent = "The cat can't get onto this page.";
    return;
  }
  const s = r.visible ? await chrome.tabs.sendMessage(tab.id, { type: 'pagecat:status' }).catch(() => null) : null;
  setVisible(!!r.visible, s && s.mood);
});

$('site').addEventListener('change', async e => {
  const host = hostOf(tab && tab.url);
  if (!host) return;
  const { pagecatBlocked = [] } = await chrome.storage.sync.get('pagecatBlocked');
  const list = new Set(pagecatBlocked);
  if (e.target.checked) list.add(host); else list.delete(host);
  await chrome.storage.sync.set({ pagecatBlocked: [...list] });
  if (e.target.checked) { try { await chrome.tabs.sendMessage(tab.id, { type: 'pagecat:hide' }); setVisible(false); } catch (err) { /* no cat here */ } }
});

for (const id of ['size', 'girth', 'activity']) {
  $(id).addEventListener('input', e => { settings[id] = +e.target.value; label(); save(); });
}
for (const id of ['follow', 'moodCycle', 'pagePlay', 'cursorPlay']) {
  $(id).addEventListener('change', e => { settings[id] = e.target.checked; label(); save(); });
}
$('reset').addEventListener('click', () => { settings = { ...DEFAULTS }; render(); save(); });

init();
