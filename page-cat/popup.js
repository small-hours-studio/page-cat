import { DEFAULTS, CAT_CODE_KEY, canVisit, hostOf } from './shared.js';

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
let cats = []; // imported cats: { id, name, spec }, saved with Chrome sync so they follow the user's account
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
  renderCats();
  const mine = cats.find(c => 'cat:' + c.id === settings.pattern);
  const own = mine ? `${mine.name} has their own colors` : OWN_COAT[settings.pattern];
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
  const store = await chrome.storage.sync.get(['pagecat', 'pagecatBlocked', 'pagecatCats']);
  settings = { ...DEFAULTS, ...(store.pagecat || {}) };
  cats = Array.isArray(store.pagecatCats) ? store.pagecatCats : [];
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

// ---------- your cats ----------
// A cat code is "PC1." + base64url(deflate-raw(spec JSON)) + "." + base64url(signature).
// Codes are signed with the developer's key (tools/catcode.mjs) and checked here, offline.
const MAX_CATS = 12;
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function readCode(text) {
  const m = text.replace(/\s+/g, '').match(/^PC1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  if (!m) throw new Error("That doesn't look like a cat code. Copy the whole thing, starting with PC1.");
  const data = unb64(m[1]), sig = unb64(m[2]);
  const key = await crypto.subtle.importKey('raw', unb64(CAT_CODE_KEY), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, data).catch(() => false);
  if (!ok) throw new Error("That code didn't check out. Make sure you copied all of it.");
  const json = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  const spec = JSON.parse(json);
  if (!spec || spec.v !== 1 || !Array.isArray(spec.c) || !Array.isArray(spec.m)) throw new Error('This code is for a newer version of Page Cat. Update the extension and try again.');
  const id = b64(await crypto.subtle.digest('SHA-256', data)).slice(0, 12);
  return { id, name: String(spec.n || 'My cat').slice(0, 24), spec };
}

function catMsg(text, isError) {
  const m = $('catMsg');
  m.hidden = !text; m.textContent = text || ''; m.classList.toggle('err', !!isError);
}

async function saveCats() {
  try { await chrome.storage.sync.set({ pagecatCats: cats }); return true; }
  catch (e) { catMsg("Couldn't save your cats. Try removing one you don't use.", true); return false; }
}

function renderCats() {
  const list = $('myCats');
  list.replaceChildren();
  for (const c of cats) {
    const li = document.createElement('li');
    li.className = 'mycat';
    const pick = document.createElement('button');
    pick.type = 'button'; pick.className = 'chip'; pick.textContent = c.name; pick.title = 'Use ' + c.name;
    pick.setAttribute('role', 'radio');
    pick.setAttribute('aria-checked', String(settings.pattern === 'cat:' + c.id));
    pick.addEventListener('click', () => { settings.pattern = 'cat:' + c.id; render(); save(); });

    const rename = document.createElement('button');
    rename.type = 'button'; rename.className = 'link'; rename.textContent = 'Rename';
    rename.setAttribute('aria-label', 'Rename ' + c.name);
    rename.addEventListener('click', () => {
      const input = document.createElement('input');
      input.value = c.name; input.maxLength = 24; input.setAttribute('aria-label', 'New name');
      let done = false;
      const finish = async keep => {
        if (done) return; done = true;
        const name = input.value.trim().slice(0, 24);
        if (keep && name && name !== c.name) { c.name = name; await saveCats(); }
        render();
      };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
      input.addEventListener('blur', () => finish(true));
      pick.replaceWith(input); rename.hidden = true;
      input.focus(); input.select();
    });

    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'link'; remove.textContent = 'Remove';
    remove.setAttribute('aria-label', 'Remove ' + c.name);
    let armed = 0;
    remove.addEventListener('click', async () => {
      if (!armed) {
        // Ask once more: the only way back is pasting the code again.
        remove.textContent = 'Sure?';
        armed = setTimeout(() => { armed = 0; remove.textContent = 'Remove'; }, 3000);
        return;
      }
      clearTimeout(armed);
      cats = cats.filter(x => x.id !== c.id);
      if (settings.pattern === 'cat:' + c.id) { settings.pattern = 'solid'; save(); }
      await saveCats();
      catMsg(`Removed ${c.name}. Paste the code again to bring them back.`);
      render();
    });
    li.append(pick, rename, remove);
    list.append(li);
  }
}

$('addCat').addEventListener('submit', async e => {
  e.preventDefault();
  const text = $('catCode').value;
  if (!text.trim()) return;
  try {
    const c = await readCode(text);
    const have = cats.find(x => x.id === c.id);
    if (have) { catMsg(`${have.name} is already in your cats.`); settings.pattern = 'cat:' + have.id; }
    else {
      if (cats.length >= MAX_CATS) { catMsg(`You can keep up to ${MAX_CATS} cats. Remove one to add another.`, true); return; }
      cats.push(c);
      if (!await saveCats()) { cats.pop(); return; }
      settings.pattern = 'cat:' + c.id;
      catMsg(`Added ${c.name}. You can rename them any time.`);
    }
    $('catCode').value = '';
    render(); save();
  } catch (err) {
    catMsg(err instanceof SyntaxError ? "That code didn't check out. Make sure you copied all of it." : err.message, true);
  }
});

init();
