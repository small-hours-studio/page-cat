// Page Cat — content script.
// A procedurally animated cat that lives on top of the current web page.
// It draws only on its own overlay (a closed shadow root). It never edits page content, except
// while it "borrows" a small image or word to play with: the original is hidden in place (so the
// layout never shifts) and always put back exactly as it was.
(() => {
  if (window.__pageCatLoaded) return;
  window.__pageCatLoaded = true;

  const hasChrome = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);
  const alive = () => !hasChrome || !!(chrome.runtime && chrome.runtime.id);

  // ---------- helpers ----------
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const damp = (k, dt) => 1 - Math.exp(-k * dt);
  const frac = v => v - Math.floor(v);
  const smooth = u => u * u * (3 - 2 * u);
  const rand = Math.random;
  const rr = (a, b) => a + (b - a) * rand();

  // ---------- settings ----------
  const DEFAULTS = { size: 32, girth: 1.2, activity: 0.5, coat: 'ginger', pattern: 'solid', moodCycle: true, pagePlay: true, cursorPlay: true };
  const settings = { ...DEFAULTS };
  const S = () => settings.size;
  function applySettings(v) {
    const n = { ...DEFAULTS, ...(v || {}) };
    n.size = clamp(+n.size || 32, 16, 96);
    n.girth = clamp(+n.girth || 1.2, 0.8, 1.8);
    n.activity = clamp(+n.activity, 0, 1);
    if (!COATS[n.coat]) n.coat = 'ginger';
    if (!['solid', 'tabby', 'tuxedo', 'calico', 'points', 'locket', 'tabbywhite', 'pastel'].includes(n.pattern)) n.pattern = 'solid';
    const sizeChanged = n.size !== settings.size;
    Object.assign(settings, n);
    if (sizeChanged && running) scan();
  }

  const COATS = {
    ginger:   { coat: '#e3893b', shade: '#b8662a', stripe: '#b25b1f', eye: '#2b1c10', closed: '#5a2c0e' },
    charcoal: { coat: '#34353d', shade: '#24252b', stripe: '#1b1c20', eye: '#f0c64e', closed: '#9a9ba5' },
    bluegray: { coat: '#8d97a9', shade: '#6b7487', stripe: '#5f687b', eye: '#1f2330', closed: '#3e4556' },
    cream:    { coat: '#f1e4cd', shade: '#cdbc9f', stripe: '#cfae82', eye: '#3a2f25', closed: '#8a7457' },
    white:    { coat: '#f4f2ed', shade: '#d6d1c8', stripe: '#d2cbbf', eye: '#3d6db0', closed: '#9a958c' },
    brown:    { coat: '#8a6a4f', shade: '#6b4f3a', stripe: '#4e3826', eye: '#e2b84a', closed: '#3a2a1d' },
  };
  // Calico is a white cat with orange and black patches, so it brings its own base coat.
  const CALICO = { coat: '#f6f3ee', shade: '#d8d3ca', stripe: '#d8d3ca', eye: '#c7962b', closed: '#8c867c' };
  // Patterns based on real cats also bring their own colors, so the coat picker doesn't apply to them.
  const OWN_COAT = {
    calico: CALICO,
    // Boba: black with a white locket on the chest, a white chin, and yellow-green eyes.
    locket: { coat: '#27272c', shade: '#1b1b1f', stripe: '#1b1b1f', eye: '#c5c45a', closed: '#8a8b95' },
    // Moe: brown mackerel tabby with a white bib, muzzle and socks, and green eyes.
    tabbywhite: { coat: '#88735c', shade: '#665443', stripe: '#30261c', eye: '#a4b06a', closed: '#3d3226' },
    // Linda: pale apricot and white with a few smoky patches and faint tail rings.
    pastel: { coat: '#e8bb8c', shade: '#c79a6d', stripe: '#d29a68', eye: '#c7962b', closed: '#8c7660' },
  };
  const COAT = () => OWN_COAT[settings.pattern] || COATS[settings.coat] || COATS.ginger;
  const MUTED = '#8b8f99', HEART = '#e0567a', BIB = '#f7f5f0', CALICO_ORANGE = '#e08a3e', CALICO_DARK = '#2c2c31', SMOKE = '#5d5856';
  function darken(hex, k) {
    const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g2 = (n >> 8) & 255, b = n & 255;
    const f = v => Math.round(v * k).toString(16).padStart(2, '0');
    return '#' + f(r) + f(g2) + f(b);
  }

  // ---------- overlay ----------
  const host = document.createElement('page-cat');
  host.style.cssText = 'all:initial;position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483646;display:none;contain:strict;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;';
  const hit = document.createElement('div');
  hit.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:auto;cursor:pointer;background:transparent;';
  hit.title = 'Pet the cat';
  shadow.append(canvas, hit);
  const ctx = canvas.getContext('2d');
  const layer = document.createElement('canvas');
  const lctx = layer.getContext('2d');
  let g = ctx; // current drawing target (the cat is drawn on its own layer so patterns stay inside it)

  let W = 800, H = 600, dpr = 1, T = 0;
  const floor = { id: 'floor', floor: true, el: null, x0: 0, x1: 800, y: 599, h: 0 };
  let plats = [floor];
  let platByEl = new WeakMap();
  let items = [];       // small images and words the cat may steal and play with
  let hideCands = [];   // small elements prey can slip behind, and walls to scratch
  let prey = null;      // the item currently being played with
  let uid = 1;
  const mouse = { x: -999, y: -999, active: false, sx: 0, sy: 0, stillSince: performance.now() };
  // Cats can leap several body lengths; enough to get from the bottom of the window onto the page.
  const maxUp = () => 5.5 * S() + 60;
  const maxX = () => 6 * S() + 80;

  // ---------- moods ----------
  // Real cats cycle: long sleepy and chill stretches, playful spells, the odd burst of madness.
  const MOODS = {
    sleepy:  { v: 0.06, dur: [150, 300], next: [['chill', 0.7], ['playful', 0.3]] },
    chill:   { v: 0.35, dur: [180, 360], next: [['sleepy', 0.35], ['playful', 0.5], ['hyper', 0.15]] },
    playful: { v: 0.72, dur: [90, 180],  next: [['chill', 0.5], ['hyper', 0.3], ['sleepy', 0.2]] },
    hyper:   { v: 1.0,  dur: [25, 50],   next: [['sleepy', 0.6], ['chill', 0.4]] },
  };
  const mood = { name: 'chill', t: rr(60, 180), v: 0.35 };
  function updateMood(dt) {
    if (!settings.moodCycle) return;
    mood.t -= dt;
    if (mood.t <= 0) {
      mood.name = pick(MOODS[mood.name].next);
      const d = MOODS[mood.name].dur;
      mood.t = rr(d[0], d[1]);
      if (mood.name === 'sleepy') cat.energy = Math.min(cat.energy, 0.3);
      if (mood.name === 'hyper' && cat.plat && !prey && ['sit', 'idle', 'loaf'].includes(cat.state)) { cat.zoomLeft = 5; }
    }
    mood.v += (MOODS[mood.name].v - mood.v) * damp(0.08, dt);
  }
  // Effective liveliness. With moods on, the slider nudges the average up or down.
  function activity() {
    if (!settings.moodCycle) return settings.activity;
    return clamp(mood.v + (settings.activity - 0.5) * 0.6, 0, 1);
  }
  function actLevel() { return Math.pow(activity(), 1.7); }

  // ---------- poses ----------
  const POSES = {
    stand:   { hipH: .42, chestH: .41, len: 1,   curl: 0, headFwd: 0,    headDrop: 0,    arch: .025, fr: .02, hr: 0,    aF: .12,  aH: .3 },
    walk:    { hipH: .41, chestH: .39, len: 1,   curl: 0, headFwd: .03,  headDrop: .035, arch: .02,  fr: .02, hr: 0,    aF: .12,  aH: .3 },
    sit:     { hipH: .15, chestH: .45, len: .5,  curl: 0, headFwd: -.02, headDrop: -.02, arch: -.02, fr: .05, hr: .19,  aF: .05,  aH: 1.45, rump: 1 },
    crouch:  { hipH: .25, chestH: .23, len: .95, curl: 0, headFwd: .03,  headDrop: .06,  arch: .05,  fr: .05, hr: -.02, aF: .45,  aH: .9 },
    stretch: { hipH: .45, chestH: .15, len: 1.1, curl: 0, headFwd: .06,  headDrop: .15,  arch: -.06, fr: .3,  hr: -.04, aF: -.25, aH: .2 },
    sleep:   { hipH: .10, chestH: .10, len: .8,  curl: 1, headFwd: 0,    headDrop: 0,    arch: 0,    fr: .02, hr: .06,  aF: 1.6,  aH: 1.45 },
    stalk:   { hipH: .28, chestH: .21, len: 1.05, curl: 0, headFwd: .08, headDrop: .1,   arch: .04,  fr: .03, hr: 0,    aF: .3,   aH: .65 },
    scratch: { hipH: .42, chestH: .2,  len: 1.05, curl: 0, headFwd: .04, headDrop: .1,   arch: -.05, fr: .2,  hr: -.02, aF: -.1,  aH: .25 },
    loaf:    { hipH: .13, chestH: .15, len: .85,  curl: 0, headFwd: -.01, headDrop: .02, arch: .02,  fr: .06, hr: .05,  aF: 1.6,  aH: 1.45, lie: 1, rump: .3 },
    run:     { hipH: .37, chestH: .34, len: 1.08, curl: 0, headFwd: .06, headDrop: .06,  arch: .05,  fr: .03, hr: 0,    aF: .2,   aH: .4 },
    wall:    { hipH: .2,  chestH: .64, len: .38,  curl: 0, headFwd: -.03, headDrop: -.08, arch: -.03, fr: .2, hr: .06,  aF: .2,   aH: 1.05, rump: .4 },
    // Held up by the scruff: the body shape comes from the hanging rig; this just keeps it uncurled.
    hang:    { hipH: .4,  chestH: .4,  len: 1,    curl: 0, headFwd: 0,    headDrop: 0,    arch: -.03, fr: .03, hr: .03,  aF: .5,   aH: .15, rump: .15 },
  };
  Object.values(POSES).forEach(p => { if (p.rump == null) p.rump = 0; if (p.lie == null) p.lie = 0; });
  const TAILP = {
    idle:    { elev: 1.25, curl: .07,  sway: .3,  sf: 1.6 },
    walk:    { elev: 1.1,  curl: .045, sway: .08, sf: 2.5 },
    sit:     { elev: -1.3, curl: -.3,  sway: .25, sf: 1.6 },
    sleep:   { elev: -1.4, curl: -.3,  sway: .05, sf: 1.0 },
    air:     { elev: .25,  curl: .02,  sway: 0,   sf: 1.0 },
    crouch:  { elev: .2,   curl: 0,    sway: .9,  sf: 9.0 },
    stretch: { elev: 1.45, curl: .05,  sway: .2,  sf: 2.0 },
    pet:     { elev: 1.5,  curl: .12,  sway: .3,  sf: 1.2 },
    stalk:   { elev: .12,  curl: .02,  sway: .45, sf: 6.0 },
    wall:    { elev: -.15, curl: .06,  sway: .25, sf: 1.4 },
    hang:    { elev: -1.45, curl: .1,  sway: .15, sf: 1.5 },
  };

  // ---------- gait ----------
  // Feet: 0 near front, 1 far front, 2 near hind, 3 far hind.
  // Walk: lateral sequence. Trot: diagonal pairs. Gallop: hind pair, then front pair, with a
  // suspended phase and a spine that flexes and extends each stride.
  let DUTY = 0.62, STRIDE = 0.66;
  let FWD = [0.36, 0.36, 0.44, 0.44], OFFS = [0.75, 0.25, 0, 0.5], GLIFT = 1;
  const GAITS = {
    walk:   { duty: 0.62, stride: 0.66, offs: [0.75, 0.25, 0, 0.5], fwd: [0.36, 0.36, 0.44, 0.44], lift: 1 },
    trot:   { duty: 0.46, stride: 0.92, offs: [0, 0.5, 0.5, 0],      fwd: [0.4, 0.4, 0.46, 0.46],   lift: 1.1 },
    gallop: { duty: 0.3,  stride: 1.3,  offs: [0.56, 0.66, 0, 0.1],  fwd: [0.55, 0.55, 0.62, 0.62], lift: 1.3 },
  };
  const LEG = {
    front: { upper: 0.2,  lower: 0.19, distal: 0.06, w: [0.15, 0.085, 0.062, 0.052], lift: 0.095 },
    hind:  { upper: 0.19, lower: 0.2,  distal: 0.13, w: [0.25, 0.12, 0.068, 0.052], lift: 0.075 },
  };
  let gaitPhase = 0, gaitOn = false;

  const TAIL_N = 10;
  const feet = [0, 1, 2, 3].map(() => ({ x: 0, y: 0, ang: 0.2, swing: false, u: 0, dur: .2, sx: 0, sy: 0, a0: 0, a1: 0, amp: 1, lift: 0, walkStep: false, raised: false }));
  const tail = Array.from({ length: TAIL_N }, () => ({ x: 0, y: 0 }));
  const parts = [];
  const cat = {
    x: 0, y: 0, plat: null, vx: 0, vy: 0, f: 1, fa: 1, state: 'sit', timer: 3, tx: 0, plan: null, air: null,
    energy: 0.85, pose: { ...POSES.sit }, tp: { ...TAILP.sit }, lookOff: { x: 0, y: 0 }, tilt: 0,
    glance: null, glanceT: 1, behindT: 0, blink: 0, blinkT: 2.5, ear: 0, earT: 3, groom: 0, groomIn: -1,
    zT: 0, heartT: 0, rig: null, pitch: 0, airBlend: 0,
    intent: null, nuzzleBlend: 0, interestT: 1, cool: 4, landPounce: false,
    preyCool: 20, zoomLeft: 0, swatItem: null, swatDone: false, wall: null, gait: 'walk', hopCool: 0,
  };

  function poseKey() {
    switch (cat.state) {
      case 'walk': return 'walk';
      case 'stalk': return 'stalk';
      case 'chase': return cat.gait === 'gallop' ? 'run' : 'walk';
      case 'zoom': return 'run';
      case 'swat': return 'stand';
      case 'wallscratch': return 'wall';
      case 'held': return 'hang';
      case 'bat': return 'crouch';
      case 'scratch': return 'scratch';
      case 'loaf': return 'loaf';
      case 'probe': return 'stalk';
      case 'sit': case 'pet': return 'sit';
      case 'crouch': return 'crouch';
      case 'land': return cat.timer > 0.12 ? 'crouch' : 'stand';
      case 'stretch': return 'stretch';
      case 'sleep': return 'sleep';
      default: return 'stand';
    }
  }
  function tailKey() {
    switch (cat.state) {
      case 'walk': return 'walk';
      case 'sit': return 'sit';
      case 'pet': case 'nuzzle': return 'pet';
      case 'stalk': return 'stalk';
      case 'chase': return 'walk';
      case 'zoom': return 'air';
      case 'swat': case 'bat': return 'crouch';
      case 'loaf': return 'sit';
      case 'probe': return 'crouch';
      case 'wallscratch': return 'wall';
      case 'held': return 'hang';
      case 'sleep': return 'sleep';
      case 'air': return 'air';
      case 'crouch': return 'crouch';
      case 'stretch': return 'stretch';
      default: return 'idle';
    }
  }

  // ---------- behavior ----------
  function setState(st, timer = 0) {
    cat.state = st; cat.timer = timer;
    if (st !== 'sit') { cat.groom = 0; cat.groomIn = -1; }
    if (!['walk', 'stalk', 'crouch', 'air', 'land', 'chase', 'zoom'].includes(st)) cat.intent = null;
  }
  function platformUnder(x, y) {
    let best = null, bd = 1e9;
    for (const p of plats) {
      if (p.gone || x < p.x0 || x > p.x1) continue;
      const gap = p.y - y;
      if (gap >= -4 && gap < bd) { bd = gap; best = p; }
    }
    return best;
  }
  function planJump(Q, lx) {
    const s = S(), P = cat.plat, m = 0.4 * s;
    if (!P || !Q || Q.gone || P.y - Q.y > maxUp()) return null;
    const dir = Math.sign(lx - cat.x) || cat.f;
    let tx = clamp(lx - dir * 0.9 * s, P.x0 + m, P.x1 - m);
    if (Math.abs(lx - tx) > maxX()) tx = clamp(lx - Math.sign(lx - tx) * maxX() * 0.9, P.x0 + m, P.x1 - m);
    if (Math.abs(lx - tx) > maxX()) return null;
    return { to: Q, lx, tx };
  }
  // A cursor that rests near a surface is interesting: stalk-and-pounce it, or go head-bump it.
  function mouseInterest(force) {
    if (!settings.cursorPlay || !mouse.active || (!force && cat.cool > 0) || !cat.plat || prey) return false;
    if ((performance.now() - mouse.stillSince) / 1000 < (force ? 0.8 : 2.5)) return false;
    const s = S(), a = actLevel();
    const tp = platformUnder(mouse.x, mouse.y);
    if (!tp) return false;
    const gap = tp.y - mouse.y;
    if (gap > 1.0 * s || overCat(mouse)) return false;
    if (!force && rand() > 0.04 + 0.3 * a) return false;
    const mode = gap > 0.25 * s && gap < 0.85 * s && rand() < 0.5 ? 'nuzzle' : 'hunt';
    const stamp = mouse.stillSince, m = 0.35 * s, dir = Math.sign(mouse.x - cat.x) || cat.f;
    if (tp !== cat.plat) {
      const lx = clamp(mouse.x - dir * (mode === 'hunt' ? 1.5 : 0.45) * s, tp.x0 + m, tp.x1 - m);
      const j = planJump(tp, lx);
      if (!j) return false;
      cat.plan = j; cat.intent = null; goWalk(j.tx);
      return true;
    }
    cat.cool = rr(20, 40) * (1.4 - 0.6 * a);
    cat.plan = null;
    if (mode === 'nuzzle') {
      cat.intent = { kind: 'nuzzle', stamp };
      goWalk(clamp(mouse.x - dir * 0.4 * s, tp.x0 + m, tp.x1 - m));
      return true;
    }
    cat.intent = { kind: 'hunt', stamp };
    cat.tx = clamp(mouse.x - dir * 1.5 * s, tp.x0 + m, tp.x1 - m);
    if (Math.abs(cat.tx - cat.x) < 0.1 * s) arrive(); else { cat.f = Math.sign(cat.tx - cat.x) || cat.f; setState('stalk'); }
    return true;
  }
  function pick(opts) {
    let r = rand() * opts.reduce((a, o) => a + o[1], 0);
    for (const o of opts) { r -= o[1]; if (r <= 0) return o[0]; }
    return opts[0][0];
  }
  function jumpOptions(reach = 1) {
    const s = S(), P = cat.plat, m = 0.4 * s, out = [];
    for (const Q of plats) {
      if (Q === P || Q.gone || Q.x1 - Q.x0 < 2 * m) continue;
      if (P.y - Q.y > maxUp() * reach) continue;
      if (Q.y < 40 || Q.y > H - 2) continue;
      let lx = rr(Q.x0 + m, Q.x1 - m);
      if (Math.abs(lx - cat.x) > maxX()) lx = clamp(cat.x + Math.sign(lx - cat.x) * rr(1, 3) * s, Q.x0 + m, Q.x1 - m);
      const dir = Math.sign(lx - cat.x) || cat.f;
      let tx = clamp(lx - dir * rr(0.6, 1.6) * s, P.x0 + m, P.x1 - m);
      if (Math.abs(lx - tx) > maxX()) tx = clamp(lx - Math.sign(lx - tx) * maxX() * 0.9, P.x0 + m, P.x1 - m);
      if (Math.abs(lx - tx) > maxX()) continue;
      out.push({ to: Q, lx, tx });
    }
    return out;
  }
  // Exploring: prefer the boxes it hasn't stood on for the longest time.
  function pickExplore(jumps) {
    const sorted = jumps.slice().sort((a, b) => (a.to.visited || 0) - (b.to.visited || 0));
    return sorted[Math.floor(rand() * Math.min(3, sorted.length))];
  }
  function walkSomewhere() {
    const s = S(), P = cat.plat, m = 0.4 * s;
    for (let k = 0; k < 8; k++) {
      const tx = rr(P.x0 + m, P.x1 - m);
      if (Math.abs(tx - cat.x) > 1.5 * s) { cat.plan = null; goWalk(tx); return true; }
    }
    return false;
  }
  // Chill cats sit, groom and loaf; active cats zoom, jump, hunt and play.
  function decide() {
    cat.plan = null;
    if (prey && prey.mode !== 'return' && prey.mode !== 'caught') { setState('chase'); return; }
    if (cat.intent && cat.intent.kind === 'grab') {
      const it = cat.intent.item; cat.intent = null;
      if (!it.borrowed && !prey && itemAlive(it)) { goGrab(it); return; }
    }
    if (cat.zoomLeft > 0) { zoomStep(); return; }
    if (mouseInterest()) return;
    const a = actLevel(), lazy = 1.7 - a, P = cat.plat, s = S();
    // The bottom edge of the window is just somewhere to land; the page is where the cat wants to be.
    let jumps = jumpOptions();
    if (P.floor && !jumps.length) jumps = jumpOptions(1.8);
    const toys = playCandidates();
    const fl = P.floor ? 0.4 : 1;
    const opts = [
      ['walk', 1.4 * (0.25 + 0.6 * a) * fl], ['sit', 2.4 * (1.3 - a) * fl], ['loaf', 2.5 * (1.3 - a) * fl],
      ['idle', 1.0 * (1.2 - 0.6 * a) * fl], ['stretch', 0.4 * fl],
      // Livelier cats go at the page much more: scratching, and stealing words and pictures to bat around.
      ['scratch', (P.floor ? 0.2 : 0.5) + 2.6 * Math.pow(a, 1.5)],
      ['sleep', (cat.energy < 0.3 ? 4 : 0.35) * (1.8 - 1.5 * a) * fl],
    ];
    if (jumps.length) opts.push(['jump', 2.2 * (0.3 + 1.4 * a) * (P.floor ? 3 : 1)]);
    if (P.x1 - P.x0 > 5 * s) opts.push(['zoom', 1.8 * Math.pow(a, 1.5)]);
    if (toys.length) opts.push(['play', 5 * Math.pow(a, 1.5) + 0.1]);
    const st = pick(opts);
    if (st === 'walk') { if (!walkSomewhere()) setState('idle', rr(1, 2)); }
    else if (st === 'jump') { cat.plan = pickExplore(jumps); goWalk(cat.plan.tx); }
    else if (st === 'sit') { setState('sit', rr(4, 8) * lazy); if (rand() < 0.45) cat.groomIn = rr(0.8, 1.6); }
    else if (st === 'loaf') setState('loaf', rr(8, 16) * lazy);
    else if (st === 'idle') setState('idle', rr(1.2, 2.6) * lazy);
    else if (st === 'stretch') setState('stretch', 1.8);
    else if (st === 'scratch') goScratch();
    else if (st === 'zoom') { cat.zoomLeft = 4 + Math.floor(rand() * 4); zoomStep(); }
    else if (st === 'play') goGrab(toys[Math.floor(rand() * toys.length)]);
    else setState('sleep', rr(9, 15) * lazy);
  }
  function goZoom() {
    const s = S(), P = cat.plat, m = 0.4 * s;
    let tx = cat.x;
    for (let k = 0; k < 8; k++) { tx = rr(P.x0 + m, P.x1 - m); if (Math.abs(tx - cat.x) > 2.2 * s) break; }
    if (Math.abs(tx - cat.x) < 1.2 * s) tx = (cat.x - P.x0 > P.x1 - cat.x) ? P.x0 + m : P.x1 - m;
    cat.tx = tx; cat.f = Math.sign(tx - cat.x) || cat.f;
    setState('zoom');
  }
  // Zoomies: dash somewhere random, then maybe leap onto something, pounce on nothing,
  // go after the cursor, or snatch a toy off the page.
  function zoomStep() {
    if (cat.zoomLeft-- <= 0) { cat.zoomLeft = 0; setState('idle', rr(1.5, 2.5)); return; }
    const s = S(), P = cat.plat, r = rand();
    if (r < 0.15) {
      const z = cat.zoomLeft; cat.zoomLeft = 0;
      if (mouseInterest(true)) return;
      cat.zoomLeft = z;
    } else if (r < 0.32 + 0.15 * actLevel()) {
      const toys = playCandidates(true);
      if (toys.length) { cat.zoomLeft = 0; goGrab(toys[Math.floor(rand() * toys.length)]); return; }
    } else if (r < 0.58) {
      const j = jumpOptions();
      if (j.length) { cat.plan = j[Math.floor(rand() * j.length)]; goWalk(cat.plan.tx); return; }
    } else if (r < 0.76) {
      const lx = clamp(cat.x + cat.f * rr(1, 2) * s, P.x0 + 0.3 * s, P.x1 - 0.3 * s);
      if (Math.abs(lx - cat.x) > 0.6 * s) { cat.plan = { to: P, lx, tx: cat.x, pounce: true, zoomy: true }; setState('crouch', rr(0.15, 0.3)); return; }
    }
    goZoom();
  }

  // ---------- scratching ----------
  // Vertical surfaces the cat can rear up against: the sides of the window (from the bottom edge)
  // and the sides of small elements standing on the surface it is on.
  function wallsFor(P) {
    const s = S(), out = [];
    if (P.floor) out.push({ id: 'win-left', x: 0, dir: -1, h: 999 }, { id: 'win-right', x: W, dir: 1, h: 999 });
    for (const b of hideSpots(P)) {
      const h = P.y - b.y;
      if (h > 0.5 * s) out.push({ id: 'el', el: b.el, x: b.x0, dir: 1, h }, { id: 'el', el: b.el, x: b.x1, dir: -1, h });
    }
    return out;
  }
  function goScratch() {
    const s = S(), P = cat.plat;
    const ws = wallsFor(P).filter(w => { const sx = w.x - w.dir * 0.34 * s; return sx > P.x0 + 0.25 * s && sx < P.x1 - 0.25 * s; });
    if (ws.length && rand() < 0.75) {
      const w = ws[Math.floor(rand() * ws.length)];
      cat.intent = { kind: 'wall', wall: w }; cat.plan = null;
      goWalk(w.x - w.dir * 0.34 * s);
      return;
    }
    setState('scratch', rr(3, 5));
  }

  // ---------- page items as prey ----------
  function itemAlive(it) { return it.kind === 'img' ? it.el.isConnected : it.node.isConnected; }
  function playCandidates(force) {
    if (!settings.pagePlay || prey || (!force && cat.preyCool > 0) || !cat.plat) return [];
    return items.filter(it => !it.borrowed && itemAlive(it) && !it.plat.gone && (it.plat === cat.plat || planJump(it.plat, it.hx)));
  }
  function goGrab(it) {
    const s = S(), m = 0.4 * s, P = it.plat, dir = Math.sign(it.hx - cat.x) || cat.f;
    cat.intent = { kind: 'grab', item: it };
    if (P !== cat.plat) {
      const j = planJump(P, clamp(it.hx - dir * 0.7 * s, P.x0 + m, P.x1 - m));
      if (!j) { cat.intent = null; setState('idle', 1); return; }
      cat.plan = j; goWalk(j.tx); return;
    }
    let tx = it.hx - dir * 0.42 * s;
    if (tx < P.x0 + 0.25 * s || tx > P.x1 - 0.25 * s) tx = it.hx + dir * 0.42 * s;
    cat.plan = null; goWalk(clamp(tx, P.x0 + 0.25 * s, P.x1 - 0.25 * s));
  }
  function pounceAt(p) {
    const s = S(), P = cat.plat, m = 0.3 * s;
    cat.f = Math.sign(p.x - cat.x) || cat.f;
    cat.plan = { to: P, lx: clamp(p.x, P.x0 + m, P.x1 - m), tx: cat.x, pounce: true, prey: true, reach: { x: p.x, y: p.y - 0.06 * s } };
    setState('crouch', rr(0.25, 0.5));
  }
  // Play is over (caught, got away, or the page needs it back): the item floats back to its spot.
  function sendHome(fast) {
    if (!prey || prey.mode === 'return') return;
    Object.assign(prey, { mode: 'return', t: 0, rx: prey.x, ry: prey.y, rrot: prey.rot, dur: fast ? 0.35 : 0.9 });
    cat.preyCool = rr(40, 70) * lerp(1.4, 0.2, actLevel());
  }
  function updatePrey(dt) {
    if (!prey) return;
    const s = S(), p = prey;
    p.life += dt;
    if (!itemAlive(p.item)) { restoreItem(p.item); prey = null; return; }
    if (p.mode === 'return') {
      p.t += dt / p.dur;
      const u = Math.min(1, p.t), e = smooth(u), h = homeOf(p.item);
      p.x = lerp(p.rx, h.x, e); p.y = lerp(p.ry, h.y, e) - Math.sin(Math.PI * u) * 0.6 * s; p.rot = lerp(p.rrot, 0, e);
      if (u >= 1) { restoreItem(p.item); prey = null; }
      return;
    }
    if (p.mode === 'caught') { p.rot = Math.sin(p.life * 30) * 0.15; return; }
    if (p.life > 32) { sendHome(); return; } // it got away
    refreshPlat(p.plat);
    if (p.plat.gone) { p.plat = floor; }
    if (p.mode === 'fly') {
      const py = p.y;
      p.vy += 30 * s * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vx * dt * 0.04;
      if (p.x < 6 || p.x > W - 6) { p.vx = -p.vx * 0.6; p.x = clamp(p.x, 6, W - 6); }
      if (p.vy > 0) {
        const q = platformUnder(p.x, py);
        if (q && p.y >= q.y) {
          p.y = q.y; p.plat = q;
          if (p.vy > 6 * s) p.vy *= -0.3;
          else { p.vy = 0; p.vx = 0; p.mode = 'pause'; p.t = rr(0.2, 0.5); p.rot = 0; }
        }
      }
      if (p.y > H + 40) { p.y = floor.y; p.plat = floor; p.mode = 'pause'; p.vy = 0; }
      return;
    }
    p.y = p.plat.y;
    // On the ground it acts like a mouse: dart, freeze, jink, and make for cover.
    // Energy runs down as it runs, so a long chase ends with a tired, catchable prey.
    const e = p.energy;
    const dc = p.x - cat.x, away = Math.sign(dc) || 1;
    const near = Math.abs(dc) < 1.4 * s && Math.abs(cat.y - p.y) < 0.6 * s;
    p.t -= dt; p.hidCool = Math.max(0, p.hidCool - dt);
    const bolt = (dir, fast) => {
      p.mode = 'run'; p.t = rr(0.4, 1.0) * (0.6 + 0.6 * e);
      p.vx = dir * rr(2.0, 3.2) * s * (fast ? 1.15 : 1) * (0.7 + 0.4 * e);
    };
    if (p.mode === 'pause') {
      p.rot = 0;
      if (p.t <= 0 || (near && rand() < dt * (3 + 4 * e))) {
        const spots = p.hidCool > 0 ? [] : hideSpots(p.plat).filter(q => q.x1 - q.x0 > 20);
        if (spots.length && rand() < 0.15 + 0.4 * e) {
          const cost = q => Math.abs((q.x0 + q.x1) / 2 - p.x) + (Math.sign((q.x0 + q.x1) / 2 - p.x) !== away ? 2 * s : 0);
          const sp = spots.reduce((b, q) => cost(q) < cost(b) ? q : b);
          p.hide = sp; p.mode = 'tohide';
          p.hx = clamp((sp.x0 + sp.x1) / 2 + rr(-0.2, 0.2) * (sp.x1 - sp.x0), sp.x0 + 8, sp.x1 - 8);
          p.vx = (Math.sign(p.hx - p.x) || 1) * 3.0 * s * (0.75 + 0.35 * e);
        } else {
          bolt(rand() < 0.8 ? away : -away, near);
          if (rand() < 0.15) { p.mode = 'fly'; p.vy = -rr(0.8, 1.3) * s; }
        }
      }
    } else if (p.mode === 'run') {
      p.x += p.vx * dt; p.rot = Math.sin(p.life * 40) * 0.12;
      p.energy = Math.max(0, e - dt * 0.045);
      if (near && Math.sign(p.vx) !== away && rand() < dt * 3) p.vx = -p.vx;
      if (p.x < p.plat.x0 + 4 || p.x > p.plat.x1 - 4) {
        if (p.plat.floor || rand() < 0.5) { p.vx = -p.vx; p.x = clamp(p.x, p.plat.x0 + 4, p.plat.x1 - 4); }
        else { p.mode = 'fly'; p.vy = -0.3 * s; }
      }
      if (p.t <= 0 && p.mode === 'run') { p.mode = 'pause'; p.t = rr(0.25, 0.8) * (1.6 - e); }
    } else if (p.mode === 'tohide') {
      p.x += p.vx * dt; p.rot = Math.sin(p.life * 40) * 0.12;
      if (Math.sign(p.hx - p.x) !== Math.sign(p.vx)) { p.x = p.hx; p.vx = 0; p.mode = 'hide'; p.t = rr(2, 4.5); p.peekT = rr(0.6, 1.2); p.peeking = false; }
    } else if (p.mode === 'hide') {
      const sp = p.hide;
      p.rot = 0; p.peekT -= dt;
      if (p.peekT <= 0) { p.peeking = !p.peeking; p.peekT = p.peeking ? rr(0.4, 0.8) : rr(0.8, 1.6); p.peekSide = rand() < 0.5 ? -1 : 1; }
      const tx = p.peeking ? (p.peekSide < 0 ? sp.x0 - 3 : sp.x1 + 3) : p.hx;
      p.x += (tx - p.x) * damp(8, dt);
      p.energy = Math.min(1, e + dt * 0.04);
      if (p.t <= 0) { p.hidCool = 4; bolt(Math.sign(p.x - cat.x) || 1, true); }
    }
  }
  // Cover on a surface: small elements that stand on (cross) its top edge.
  function hideSpots(P) {
    return hideCands.filter(b => b.el !== P.el && b.x0 < P.x1 && b.x1 > P.x0 && b.y < P.y - 8 && b.bottom >= P.y - 1);
  }
  function flushPrey() {
    if (!prey || prey.mode !== 'hide') return;
    const s = S(), dir = Math.sign(prey.x - cat.x) || 1;
    prey.mode = 'run'; prey.t = rr(0.5, 0.9); prey.hidCool = 3;
    prey.vx = dir * rr(2.6, 3.4) * s * (0.7 + 0.4 * prey.energy);
  }
  function goWalk(tx) {
    cat.tx = tx;
    if (Math.abs(tx - cat.x) < 0.05 * S()) { cat.x = tx; arrive(); return; }
    setState(cat.zoomLeft > 0 ? 'zoom' : 'walk');
  }
  function arrive() {
    if (cat.state === 'zoom' && !cat.plan) { zoomStep(); return; }
    if (cat.plan) { cat.f = Math.sign(cat.plan.lx - cat.x) || cat.f; setState('crouch', cat.plan.pounce ? rr(0.9, 1.5) : 0.6); return; }
    const it = cat.intent;
    if (it && it.kind === 'wall') {
      cat.f = it.wall.dir; cat.wall = it.wall;
      setState('wallscratch', rr(3.5, 5.5));
      return;
    }
    if (it && it.kind === 'grab') {
      const item = it.item;
      if (item.borrowed || prey || !itemAlive(item)) { cat.intent = null; decide(); return; }
      if (item.plat !== cat.plat) { goGrab(item); return; }
      cat.f = Math.sign(item.hx - cat.x) || cat.f;
      cat.swatItem = item; cat.swatDone = false;
      setState('swat', 0.8);
      return;
    }
    if (it && it.kind === 'nuzzle') {
      cat.f = Math.sign(mouse.x - cat.x) || cat.f;
      setState('nuzzle', rr(2.6, 4));
      return;
    }
    if (it && it.kind === 'hunt') {
      const s = S(), P = cat.plat, m = 0.3 * s;
      cat.f = Math.sign(mouse.x - cat.x) || cat.f;
      const lx = clamp(mouse.x + cat.f * 0.05 * s, P.x0 + m, P.x1 - m);
      cat.plan = { to: P, lx, tx: cat.x, pounce: true, reach: { x: mouse.x, y: mouse.y } };
      setState('crouch', rr(0.9, 1.5));
      return;
    }
    decide();
  }
  function endState() {
    if (cat.state === 'swat' || cat.state === 'probe') { if (prey) setState('chase'); else setState('idle', 1); return; }
    if (cat.state === 'bat') { sendHome(); setState('sit', rr(2.5, 3.5)); cat.groomIn = 0.9; return; }
    if (cat.state === 'land' && cat.afterDrop) {
      // Put down somewhere new: sit and groom, with dignity.
      cat.afterDrop = false;
      setState('sit', rr(2.5, 4)); cat.groomIn = 0.6;
      return;
    }
    if (cat.state === 'land' && cat.landPounce) {
      cat.landPounce = false;
      setState('sit', rr(2.5, 3.5)); cat.groomIn = 0.7;
      return;
    }
    if (cat.state === 'sleep') setState('stretch', 2.3);
    else if (cat.state === 'stretch') setState('idle', rr(0.5, 1.2));
    else decide();
  }
  function arcParams(x0, y0, x1, y1, apexY) {
    const s = S(), gr = 34 * s;
    let apex = Math.min(y0, y1) - (0.45 * s + 0.12 * Math.abs(x1 - x0));
    if (apexY != null) apex = Math.min(apex, apexY);
    const vy0 = -Math.sqrt(2 * gr * (y0 - apex));
    const Tf = -vy0 / gr + Math.sqrt(2 * (y1 - apex) / gr);
    return { x0, y0, x1, y1, g: gr, vy0, T: Tf, vx: (x1 - x0) / Tf };
  }
  function launch() {
    const Q = cat.plan.to, reach = cat.plan.reach || null;
    const a = arcParams(cat.x, cat.y, cat.plan.lx, Q.y, reach ? reach.y + 0.35 * S() : null);
    a.t = 0; a.to = Q; a.reach = reach; a.pounce = !!cat.plan.pounce; a.prey = !!cat.plan.prey; a.zoomy = !!cat.plan.zoomy;
    if (a.pounce) cat.intent = null;
    if (a.prey && prey && rand() < 0.15 + 0.6 * prey.energy) {
      prey.mode = 'run'; prey.t = rr(0.4, 0.8); prey.energy = Math.max(0, prey.energy - 0.12);
      prey.vx = (Math.sign(prey.x - cat.x) || 1) * rr(2.2, 3.0) * S();
    }
    const r = cat.rig;
    if (r) cat.pitch = Math.atan2(r.chest.y - r.hip.y, Math.abs(r.chest.x - r.hip.x) + 1e-3);
    cat.air = a; cat.vx = a.vx; cat.vy = a.vy0;
    cat.f = Math.sign(a.x1 - a.x0) || cat.f;
    setState('air');
  }
  // The nearest comfortable box (in the middle band of the window) it can leap to from here.
  function scrollHop() {
    const s = S(), P = cat.plat, m = 0.35 * s;
    let best = null, bd = 1e9;
    for (const Q of plats) {
      if (Q === P || Q.floor) continue;
      refreshPlat(Q);
      if (Q.gone || Q.x1 - Q.x0 < 2 * m || Q.y < H * 0.3 || Q.y > H * 0.82) continue;
      const up = cat.y - Q.y;
      if (up > maxUp() * 1.4) continue;
      const lx = clamp(cat.x, Q.x0 + m, Q.x1 - m), dx = Math.abs(lx - cat.x);
      if (dx > maxX() * 1.3) continue;
      const d = dx + Math.abs(up) * 0.5 + Math.abs(Q.y - H * 0.55) * 0.5;
      if (d < bd) { bd = d; best = { to: Q, lx: clamp(lx + (rand() - 0.5) * s, Q.x0 + m, Q.x1 - m), tx: cat.x }; }
    }
    return best;
  }
  // The surface under the cat scrolled away or vanished: hop down to whatever is below.
  function fallFrom(p) {
    const s = S(), yFrom = clamp(p.y, 30, H - 2);
    let tgt = null, best = 1e9;
    for (const q of plats) {
      if (q === p || q.gone || cat.x < q.x0 || cat.x > q.x1) continue;
      const gap = q.y - yFrom;
      if (gap > 4 && gap < best) { best = gap; tgt = q; }
    }
    if (!tgt) tgt = floor;
    cat.y = yFrom;
    cat.plan = { to: tgt, lx: clamp(cat.x, tgt.x0 + 0.3 * s, tgt.x1 - 0.3 * s), tx: cat.x };
    launch();
  }

  function update(dt) {
    const s = S();
    updateMood(dt);
    if (cat.state === 'sleep') cat.energy = Math.min(1, cat.energy + dt * 0.09);
    else cat.energy = Math.max(0, cat.energy - dt * 0.02 * (1.6 - activity()));
    cat.cool = Math.max(0, cat.cool - dt);

    // Keep the surfaces we care about in sync with the page (it may have scrolled).
    refreshPlat(cat.plat);
    if (cat.plan) refreshPlat(cat.plan.to);
    if (cat.state !== 'air' && cat.state !== 'held' && cat.plat && !cat.plat.floor) {
      const p = cat.plat;
      if (p.gone || p.y > H - 2) { cat.plat = floor; cat.y = floor.y; cat.plan = null; feet.forEach(ft => { ft.y = floor.y; }); if (cat.state === 'crouch') setState('idle', 0.5); }
      else if (p.y < 30 || cat.x < p.x0 - 0.25 * s || cat.x > p.x1 + 0.25 * s) fallFrom(p);
    }

    if (cat.intent && cat.intent.stamp != null && mouse.stillSince !== cat.intent.stamp) {
      cat.intent = null;
      if (cat.state === 'stalk' || (cat.state === 'crouch' && cat.plan && cat.plan.pounce && !cat.plan.prey)) {
        cat.plan = null; cat.vx = 0; setState('sit', rr(1.5, 3));
      }
    }
    if (cat.state === 'nuzzle' && cat.rig && (!mouse.active || Math.hypot(mouse.x - cat.rig.head.x, mouse.y - cat.rig.head.y) > 0.6 * s)) setState('idle', 0.8);

    // While the page scrolls, hop from box to box to stay in view: when its box is sliding off the
    // top or bottom of the window (or it's down on the window's bottom edge), leap to a box nearer
    // the middle of the screen.
    cat.hopCool = Math.max(0, cat.hopCool - dt);
    if (performance.now() - lastScrollT < 700 && cat.hopCool <= 0 && !prey && cat.plat
        && !['air', 'crouch', 'chase', 'swat', 'bat', 'probe', 'pet', 'nuzzle', 'stalk', 'held'].includes(cat.state)) {
      const p = cat.plat;
      if (p.floor || p.y < H * 0.25 || p.y > H * 0.85) {
        const j = scrollHop();
        if (j) { cat.plan = j; cat.zoomLeft = 0; cat.intent = null; cat.f = Math.sign(j.lx - cat.x) || cat.f; setState('crouch', 0.1); cat.hopCool = 0.9; }
        else cat.hopCool = 0.4;
      }
    }

    switch (cat.state) {
      case 'walk': case 'stalk': case 'chase': case 'zoom': {
        if (cat.state === 'chase') {
          if (!prey || prey.mode === 'return' || prey.mode === 'caught') { cat.vx = 0; setState('idle', 1); break; }
          if (prey.mode !== 'fly' && prey.plat !== cat.plat) {
            const P2 = prey.plat, m2 = 0.4 * s;
            const j = planJump(P2, clamp(prey.x - (Math.sign(prey.x - cat.x) || cat.f) * 0.8 * s, P2.x0 + m2, P2.x1 - m2));
            if (j) { cat.plan = j; goWalk(j.tx); break; }
            cat.tx = cat.x;
          } else {
            const pd = Math.sign(prey.x - cat.x) || cat.f, pdist = Math.abs(prey.x - cat.x);
            if (prey.mode === 'hide' || prey.mode === 'tohide') {
              if (pdist < 0.8 * s) { cat.tx = cat.x; cat.f = pd; }
              else cat.tx = clamp(prey.x - pd * 0.65 * s, cat.plat.x0 + 0.3 * s, cat.plat.x1 - 0.3 * s);
              if (prey.mode === 'hide' && pdist < 0.95 * s && cat.fa * pd > 0.6) { cat.swatDone = false; setState('probe', 0.8); break; }
            } else {
              if (pdist < 1.05 * s) { cat.tx = cat.x; cat.f = pd; }
              else cat.tx = clamp(prey.x - pd * 1.0 * s, cat.plat.x0 + 0.3 * s, cat.plat.x1 - 0.3 * s);
              if (prey.mode !== 'fly' && pdist < 1.7 * s && cat.fa * pd > 0.6 && (prey.mode === 'pause' || rand() < dt * 1.5)) { pounceAt(prey); break; }
            }
          }
        }
        const dx = cat.tx - cat.x, dir = Math.sign(dx);
        if (dir) cat.f = dir;
        const turned = cat.fa * cat.f > 0.6, a = actLevel();
        const vmax = cat.state === 'stalk' ? 0.3 * s
          : cat.state === 'zoom' ? 2.7 * s * (0.85 + 0.3 * a)
          : cat.state === 'chase' ? 2.0 * s * (0.85 + 0.3 * a)
          // On the way to something to scratch or steal, a lively cat trots instead of strolling.
          : 0.9 * s * (0.85 + 0.3 * a) * (cat.intent ? 1 + 0.9 * a : 1);
        let want = turned ? dir * Math.min(vmax, Math.abs(dx) * 2.2 + 0.12 * s) : 0;
        if (cat.state === 'chase' && Math.abs(dx) < 0.1 * s) want = 0;
        cat.vx += (want - cat.vx) * damp(cat.state === 'zoom' ? 6 : 4, dt);
        cat.x += cat.vx * dt;
        if (cat.state !== 'chase' && (Math.abs(cat.tx - cat.x) < 0.02 * s || (dir !== 0 && Math.sign(cat.tx - cat.x) !== dir))) {
          cat.x = cat.tx; cat.vx = 0; arrive();
        }
        break;
      }
      case 'held': {
        // Hanging from the cursor by the scruff: the body swings like a pendulum, lagging behind
        // when you drag and settling when you stop.
        const h = cat.held;
        if (!h) { setState('idle', 0.5); break; }
        if (performance.now() - h.pt > 60) h.vx *= Math.exp(-dt * 12);
        const ax = clamp((h.vx - h.lvx) / Math.max(dt, 1e-3), -80 * s, 80 * s);
        h.lvx = h.vx;
        const L = 0.5 * s, g0 = 30 * s;
        h.av += ((-g0 * Math.sin(h.ang) - ax * Math.cos(h.ang)) / L - 3.5 * h.av) * dt;
        h.ang = clamp(h.ang + h.av * dt, -1.1, 1.1);
        cat.x = h.x + Math.sin(h.ang) * 0.95 * s;
        cat.y = h.y + Math.cos(h.ang) * 0.95 * s;
        cat.vx = 0; cat.vy = 0;
        break;
      }
      case 'crouch':
        if (cat.plan && cat.plan.prey) {
          if (!prey || ['fly', 'return', 'caught', 'hide', 'tohide'].includes(prey.mode) || prey.plat !== cat.plat || Math.abs(prey.x - cat.x) > 2.2 * s) { cat.plan = null; setState('chase'); break; }
          cat.plan.lx = clamp(prey.x, cat.plat.x0 + 0.3 * s, cat.plat.x1 - 0.3 * s);
          cat.plan.reach = { x: prey.x, y: prey.y - 0.06 * s };
        }
        cat.vx += (0 - cat.vx) * damp(12, dt);
        if (cat.fa * cat.f > 0.75) cat.timer -= dt;
        if (cat.timer <= 0) launch();
        break;
      case 'air': {
        const a = cat.air; a.t += dt;
        const tt = Math.min(a.t, a.T);
        cat.x = a.x0 + a.vx * tt;
        cat.y = a.y0 + a.vy0 * tt + 0.5 * a.g * tt * tt;
        cat.vy = a.vy0 + a.g * tt;
        if (a.t >= a.T) {
          let to = a.to;
          refreshPlat(to);
          if (to.gone || to.y > H - 2) to = floor;
          cat.plat = to; cat.x = clamp(a.x1, to.x0 + 0.2 * s, to.x1 - 0.2 * s); cat.y = to.y;
          to.visited = T;
          cat.vx = 0; cat.vy = 0; cat.plan = null;
          cat.landPounce = a.pounce && !a.prey && !a.zoomy;
          setState('land', a.pounce ? 0.45 : 0.3);
          feet.forEach(ft => { ft.y = cat.y; ft.swing = false; ft.raised = false; });
          if (a.prey && prey && !['fly', 'return', 'caught', 'hide', 'tohide'].includes(prey.mode) && prey.plat === cat.plat && Math.abs(prey.x - cat.x) < 0.5 * s) {
            prey.mode = 'caught'; prey.x = cat.x + cat.f * 0.3 * s; prey.y = cat.y;
            setState('bat', 1.8);
          }
        }
        break;
      }
      default:
        if (cat.state === 'swat' && !cat.swatDone && cat.timer < 0.38) {
          // Paw strike connects: the item pops off the page and becomes prey.
          cat.swatDone = true;
          const it = cat.swatItem;
          if (it && !it.borrowed && !prey && itemAlive(it) && borrowItem(it)) {
            const depth = Math.max(0, it.bottom - it.plat.y) + 0.3 * s;
            prey = { item: it, x: it.hx, y: it.bottom, vx: cat.f * rr(1.4, 2.1) * s, vy: -Math.sqrt(2 * 30 * s * depth), rot: 0, mode: 'fly', t: 0, life: 0, plat: it.plat, energy: 1, hidCool: 0 };
          }
        }
        if (cat.state === 'probe' && !cat.swatDone && cat.timer < 0.38) { cat.swatDone = true; flushPrey(); }
        if (cat.state === 'idle' || cat.state === 'loaf' || (cat.state === 'sit' && cat.groom <= 0 && cat.groomIn <= 0)) {
          cat.interestT -= dt;
          if (cat.interestT <= 0) {
            cat.interestT = rr(2, 4);
            if (mouseInterest()) break;
            if (cat.zoomLeft > 0) { zoomStep(); break; } // a hyper spell just started
          }
        }
        cat.vx += (0 - cat.vx) * damp(10, dt);
        cat.x += cat.vx * dt;
        cat.timer -= dt;
        if (cat.state === 'sit') {
          if (cat.groomIn > 0) { cat.groomIn -= dt; if (cat.groomIn <= 0) cat.groom = rr(1.6, 2.4); }
          if (cat.groom > 0) { cat.groom -= dt; if (cat.groom <= 0) cat.groom = 0; }
        }
        if (cat.timer <= 0) endState();
    }
    if (cat.state !== 'air' && cat.state !== 'held' && cat.plat) {
      cat.x = clamp(cat.x, cat.plat.x0 + 0.2 * s, cat.plat.x1 - 0.2 * s);
      cat.y = cat.plat.y;
    }

    cat.fa += (cat.f - cat.fa) * damp(cat.state === 'air' ? 4 : 7, dt);
    if (cat.state === 'air' && cat.air) {
      const a = cat.air;
      const velAng = Math.atan2(cat.vy, Math.abs(a.vx) + 0.3 * s);
      const aimAng = Math.atan2(a.y1 - (cat.y - 0.42 * s), Math.abs(a.x1 - cat.x) + 0.3 * s);
      // A dropped cat rights itself and comes down level, feet first.
      const pt = a.drop ? 0 : clamp(lerp(velAng, aimAng, 0.35), -1.15, 1.0);
      cat.pitch += (pt - cat.pitch) * damp(9, dt);
      cat.airBlend += (1 - cat.airBlend) * damp(12, dt);
    } else {
      cat.pitch += (0 - cat.pitch) * damp(7, dt);
      cat.airBlend += (0 - cat.airBlend) * damp(10, dt);
    }
    cat.nuzzleBlend += ((cat.state === 'nuzzle' ? 1 : 0) - cat.nuzzleBlend) * damp(6, dt);
    let target = POSES[poseKey()];
    if (cat.state === 'nuzzle') target = { ...target, chestH: target.chestH + clamp((cat.y - 0.62 * s - mouse.y) / s, 0, 0.12), headFwd: 0.05 };
    if (cat.state === 'crouch' && cat.plan) {
      const aimY = cat.plan.reach ? cat.plan.reach.y + 0.3 * s : cat.plan.to.y;
      const aim = clamp((cat.y - aimY) / (2.5 * s), -0.6, 1);
      target = { ...target, chestH: target.chestH + aim * 0.14, hipH: target.hipH - Math.max(0, aim) * 0.04, headDrop: target.headDrop - aim * 0.1 };
    }
    const pk = (cat.state === 'sleep' || cat.pose.curl > 0.02) ? 3.2 : 8;
    for (const k in target) cat.pose[k] += (target[k] - cat.pose[k]) * damp(pk, dt);
    const tt = TAILP[tailKey()];
    for (const k in tt) cat.tp[k] += (tt[k] - cat.tp[k]) * damp(6, dt);

    cat.blinkT -= dt; if (cat.blinkT <= 0) { cat.blink = 0.13; cat.blinkT = rr(2, 5); }
    cat.blink = Math.max(0, cat.blink - dt);
    cat.earT -= dt; if (cat.earT <= 0) { cat.ear = 1; cat.earT = rr(2.5, 7); }
    cat.ear = Math.max(0, cat.ear - dt * 5);

    updatePrey(dt);
    cat.preyCool = Math.max(0, cat.preyCool - dt);
    updateLook(dt);
    {
      const v = Math.abs(cat.vx) / s;
      let gt = cat.gait || 'walk';
      if (gt === 'walk' && v > 1.25) gt = 'trot';
      else if (gt === 'trot' && v < 1.0) gt = 'walk';
      else if (gt === 'trot' && v > 2.0) gt = 'gallop';
      else if (gt === 'gallop' && v < 1.7) gt = 'trot';
      cat.gait = gt;
      const G = GAITS[gt];
      DUTY = G.duty; STRIDE = G.stride; OFFS = G.offs; FWD = G.fwd; GLIFT = G.lift;
    }
    advanceGait(dt);
    cat.rig = computeRig();
    updateFeet(dt, cat.rig);
    cat.rig.legs = [0, 1, 2, 3].map(i => legChain(i, cat.rig));
    updateTail(dt, cat.rig);
    updateParticles(dt);
  }

  function updateLook(dt) {
    const s = S(), r = cat.rig;
    const hx = r ? r.head.x : cat.x, hy = r ? r.head.y : cat.y - 0.5 * s;
    let tgt = null, fromMouse = false;
    if (mouse.active && Math.hypot(mouse.x - hx, mouse.y - hy) < 7 * s) { tgt = mouse; fromMouse = true; }
    else if (!['walk', 'air', 'crouch'].includes(cat.state)) {
      cat.glanceT -= dt;
      if (cat.glanceT <= 0) {
        cat.glance = rand() < 0.35 ? null : { x: cat.x + cat.f * rr(0.6, 4) * s, y: cat.y - rr(-0.3, 2.6) * s };
        cat.glanceT = rr(1.3, 3.2);
      }
      tgt = cat.glance;
    }
    if (cat.state === 'crouch' && cat.plan) tgt = { x: cat.plan.lx, y: cat.plan.to.y - 0.3 * s };
    if (prey && prey.mode !== 'return' && ['chase', 'crouch', 'swat', 'bat', 'land', 'idle', 'probe'].includes(cat.state)) {
      tgt = { x: prey.x, y: prey.y - 0.05 * s }; fromMouse = false;
    }
    if (cat.state === 'wallscratch' && cat.wall) { tgt = { x: cat.wall.x, y: cat.y - 0.95 * s }; fromMouse = false; }
    if (cat.state === 'sleep' || cat.groom > 0) tgt = null;
    let ox = 0, oy = 0, tl = 0;
    if (tgt) {
      const dx = tgt.x - hx, dy = tgt.y - hy;
      if (Math.sign(dx) === cat.f || Math.abs(dx) < 0.3 * s) {
        const d = Math.hypot(dx, dy) || 1;
        ox = dx / d * 0.03 * s; oy = dy / d * 0.03 * s;
        tl = clamp(Math.atan2(dy, Math.abs(dx) + 0.5 * s), -0.7, 0.7) * 0.65;
        cat.behindT = 0;
      } else {
        oy = -0.01 * s;
        if (fromMouse && ['idle', 'sit', 'pet'].includes(cat.state)) {
          cat.behindT += dt;
          if (cat.behindT > 0.5) { cat.f = -cat.f; cat.behindT = 0; }
        }
      }
    }
    if (cat.state === 'air') tl = 0;
    cat.lookOff.x += (ox - cat.lookOff.x) * damp(8, dt);
    cat.lookOff.y += (oy - cat.lookOff.y) * damp(8, dt);
    cat.tilt += (tl - cat.tilt) * damp(7, dt);
  }

  // ---------- rig ----------
  function computeRig() {
    const s = S(), fa = cat.fa, f = cat.f, P = cat.pose;
    const sleeping = cat.state === 'sleep';
    const breath = 1 + Math.sin(T * (sleeping ? 2.0 : 3.2)) * (sleeping ? 0.04 : 0.015);
    const half = 0.27 * s * P.len;
    let hip, chest, headBob = 0;
    if (cat.state === 'air' && cat.air) {
      const p = cat.pitch;
      const cx = cat.x, cy = cat.y - 0.42 * s, h = half * 1.15;
      hip = { x: cx - fa * Math.cos(p) * h, y: cy - Math.sin(p) * h };
      chest = { x: cx + fa * Math.cos(p) * h, y: cy + Math.sin(p) * h };
    } else if (cat.state === 'held' && cat.held) {
      // Scruff in hand: shoulders just under the grip, body hanging straight down from there.
      const hd = cat.held, D = { x: Math.sin(hd.ang), y: Math.cos(hd.ang) };
      chest = { x: hd.x - fa * 0.03 * s + D.x * 0.17 * s, y: hd.y + D.y * 0.17 * s };
      hip = { x: chest.x + D.x * 0.5 * s, y: chest.y + D.y * 0.5 * s };
    } else {
      const gw = gaitOn ? clamp(Math.abs(cat.vx) / (0.5 * s), 0, 1) * (1 + Math.max(0, Math.abs(cat.vx) / s - 1) * 1.2) : 0;
      const bh = Math.cos(4 * Math.PI * gaitPhase) * 0.008 * s * gw;
      const bc = Math.cos(4 * Math.PI * gaitPhase + 1.6) * 0.007 * s * gw;
      headBob = -bc * 0.7;
      const wig = cat.state === 'crouch' && cat.timer > 0.12 ? Math.sin(T * 24) * 0.018 * s : 0;
      const lp = Math.sin(cat.pitch) * half * 0.8;
      let gx = 0, gh = 0, gc = 0;
      if (gaitOn && cat.gait && cat.gait !== 'walk') {
        const ph = TAU * gaitPhase, k = clamp((Math.abs(cat.vx) / s - 0.9) / 1.2, 0, 1);
        if (cat.gait === 'gallop') {
          const lift = Math.abs(Math.sin(ph)) * 0.03 * s * k;
          gx = Math.sin(ph) * 0.11 * k;
          gh = Math.sin(ph + 1.3) * 0.05 * s * k - lift;
          gc = Math.sin(ph - 0.7) * 0.05 * s * k - lift;
        } else {
          gh = gc = -Math.abs(Math.sin(2 * ph)) * 0.018 * s * k;
        }
        headBob -= gc * 0.6;
      }
      hip = { x: cat.x - fa * half * (1 + gx) + wig, y: cat.y - P.hipH * s + bh - lp + gh };
      chest = { x: cat.x + fa * half * (1 + gx), y: cat.y - P.chestH * s + bc + lp + gc };
    }
    const sp = [];
    for (let i = 0; i < 5; i++) {
      const u = i / 4;
      sp.push({ x: lerp(hip.x, chest.x, u), y: lerp(hip.y, chest.y, u) - Math.sin(Math.PI * u) * P.arch * s });
    }
    if (P.curl > 0.001) {
      const cx = cat.x, cy = cat.y - 0.16 * s, R = 0.15 * s;
      for (let i = 0; i < 5; i++) {
        const th = (Math.PI + 0.35) - i / 4 * (Math.PI + 0.7);
        sp[i].x = lerp(sp[i].x, cx + Math.cos(th) * R * fa, P.curl);
        sp[i].y = lerp(sp[i].y, cy - Math.sin(th) * R, P.curl);
      }
    }
    hip = sp[0]; chest = sp[4];
    const bulk = (1 + 0.3 * P.curl) * breath * s;
    const rump = P.rump || 0;
    const gth = settings.girth, gb = Math.max(0, gth - 1);
    const sway = gaitOn ? Math.sin(4 * Math.PI * gaitPhase - 1) * 0.05 * gb : 0;
    const back = Math.pow(gth, 0.3);
    const up = [0.13 * (1 + 0.45 * rump), 0.12, 0.115, 0.12, 0.125].map(v => v * bulk * back);
    const gut = [1 + 0.35 * gb, 1 + 1.6 * gb + sway, 1 + 1.4 * gb + sway, 1 + 0.6 * gb, 1 + 0.25 * gb].map(v => gth < 1 ? v * gth : v);
    const dn = [0.12 * (1 + 0.6 * rump), 0.085 * (1 + 0.5 * rump), 0.1, 0.145, 0.155].map((v, i) => v * bulk * gut[i]);
    const sh = { x: chest.x - fa * 0.03 * s, y: chest.y + 0.01 * s };
    const shF = { x: sh.x - fa * 0.04 * s, y: sh.y - 0.012 * s };
    const hp = { x: hip.x + fa * 0.03 * s, y: hip.y };
    const hpF = { x: hp.x - fa * 0.04 * s, y: hp.y - 0.012 * s };
    let hx = chest.x + fa * (0.16 + P.headFwd) * s, hy = chest.y - (0.17 - P.headDrop) * s + headBob;
    hx = lerp(hx, chest.x + fa * 0.05 * s, P.curl);
    hy = lerp(hy, chest.y - 0.06 * s, P.curl);
    const nod = cat.groom > 0 ? Math.sin(T * 10) * 0.02 * s + 0.03 * s : 0;
    hx += cat.lookOff.x * (1 - P.curl);
    hy += cat.lookOff.y * (1 - P.curl) + nod;
    let tiltRaw = cat.tilt * (1 - P.curl) + P.curl * 0.55 + (cat.groom > 0 ? 0.35 : 0);
    if (cat.nuzzleBlend > 0.001) {
      const nb = cat.nuzzleBlend, rub = Math.sin(T * 5.5);
      let tx = mouse.x - fa * 0.09 * s + rub * 0.035 * s * fa, ty = mouse.y + 0.05 * s + Math.cos(T * 2.75) * 0.02 * s;
      const bx = chest.x, by = chest.y - 0.05 * s, vx = tx - bx, vy = ty - by, d = Math.hypot(vx, vy), lim = 0.34 * s;
      if (d > lim) { tx = bx + vx / d * lim; ty = by + vy / d * lim; }
      hx = lerp(hx, tx, nb); hy = lerp(hy, ty, nb);
      tiltRaw = lerp(tiltRaw, -0.15 + rub * 0.3, nb);
    }
    if (cat.airBlend > 0.001 && cat.air) {
      const a = cat.air, bfx = fa * Math.cos(cat.pitch), bfy = Math.sin(cat.pitch);
      const aimPt = a.reach || { x: a.x1, y: a.y1 - 0.3 * s };
      let ax = aimPt.x - chest.x, ay = aimPt.y - chest.y;
      const al = Math.hypot(ax, ay) || 1; ax /= al; ay /= al;
      const w = cat.air.t / cat.air.T > 0.4 ? 0.75 : 0.5;
      let dx = bfx * (1 - w) + ax * w, dy = bfy * (1 - w) + ay * w;
      const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
      const ahx = chest.x + dx * 0.21 * s, ahy = chest.y + dy * 0.21 * s - 0.07 * s;
      const at = clamp(Math.atan2(dy, Math.abs(dx)), -1.1, 1.1) * 0.85;
      hx = lerp(hx, ahx, cat.airBlend); hy = lerp(hy, ahy, cat.airBlend);
      tiltRaw = lerp(tiltRaw, at, cat.airBlend);
    }
    if (cat.state === 'held' && cat.held) {
      // The head sits just in front of the hand, chin tucked a little.
      hx = cat.held.x + fa * 0.1 * s; hy = cat.held.y + 0.03 * s; tiltRaw = 0.2;
    }
    return { s, fa, f, hip, chest, sp, up, dn, sh, shF, hp, hpF, head: { x: hx, y: hy, rot: tiltRaw * f }, legs: null };
  }
  function headPt(r, lu, lv) {
    const s = r.s, c = Math.cos(r.head.rot), sn = Math.sin(r.head.rot);
    const x = r.fa * lu * s, y = lv * s;
    return { x: r.head.x + x * c - y * sn, y: r.head.y + x * sn + y * c };
  }
  function anchorOf(i, r) { return [r.sh, r.shF, r.hp, r.hpF][i]; }
  function restX(i, r) {
    const P = cat.pose, s = r.s, fa = r.fa;
    return anchorOf(i, r).x + fa * (i < 2 ? P.fr : P.hr) * s;
  }
  function ik(A, Tg, a, b, bend) {
    const dx = Tg.x - A.x, dy = Tg.y - A.y, d = Math.hypot(dx, dy) || 1e-6;
    const dc = clamp(d, Math.abs(a - b) + 1e-3, a + b - 1e-3);
    const ux = dx / d, uy = dy / d;
    const ang = Math.acos(clamp((a * a + dc * dc - b * b) / (2 * a * dc), -1, 1)) * bend;
    const c = Math.cos(ang), sn = Math.sin(ang);
    return { knee: { x: A.x + (ux * c - uy * sn) * a, y: A.y + (ux * sn + uy * c) * a }, end: { x: A.x + ux * dc, y: A.y + uy * dc } };
  }
  function legChain(i, r) {
    const s = r.s, fa = r.fa, sg = Math.sign(fa) || 1, ft = feet[i], front = i < 2, L = front ? LEG.front : LEG.hind;
    const A = anchorOf(i, r);
    const dl = L.distal * s, a = ft.ang;
    const D = { x: ft.x + (front ? 1 : -1) * fa * Math.sin(a) * dl, y: ft.y - Math.cos(a) * dl };
    const res = ik(A, D, L.upper * s, L.lower * s, front ? sg : -sg);
    const ox = res.end.x - D.x, oy = res.end.y - D.y;
    let K = res.knee, Dj = res.end, Pw = { x: ft.x + ox, y: ft.y + oy };
    if (cat.state !== 'air' && cat.state !== 'held') {
      const tuck =Math.max(clamp((cat.pose.curl - 0.15) / 0.6, 0, 1), cat.pose.lie || 0);
      if (tuck > 0) {
        const pawT = { x: A.x + fa * (front ? 0.12 : 0.05) * s, y: cat.y - 0.01 * s };
        const kneeT = { x: lerp(A.x, pawT.x, 0.45), y: lerp(A.y, pawT.y, 0.55) };
        const dT = { x: lerp(A.x, pawT.x, 0.8), y: lerp(A.y, pawT.y, 0.9) };
        K = lerpPt(K, kneeT, tuck); Dj = lerpPt(Dj, dT, tuck); Pw = lerpPt(Pw, pawT, tuck);
      }
      const lw = L.w;
      K.y = Math.min(K.y, cat.y - lw[1] * s / 2);
      Dj.y = Math.min(Dj.y, cat.y - lw[2] * s / 2);
      Pw.y = Math.min(Pw.y, cat.y);
    }
    return { A, K, D: Dj, P: Pw, front };
  }
  function lerpPt(a, b, t) { return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }; }
  function touchAng(i) { return i < 2 ? 0.0 : 0.45; }
  function poseAng(i) { return i < 2 ? cat.pose.aF : cat.pose.aH; }
  function stanceAng(i, rel, fwd, span) {
    const k = clamp((fwd - rel) / span, 0, 1);
    return i < 2 ? lerp(0.0, 0.5, k) : lerp(0.45, -0.2, k);
  }
  function swingBump(i, u) {
    if (i < 2) return 1.35 * Math.sin(Math.PI * clamp(u / 0.72, 0, 1)) - 0.3 * Math.sin(Math.PI * clamp((u - 0.6) / 0.4, 0, 1));
    return -0.85 * Math.sin(Math.PI * clamp(u / 0.7, 0, 1));
  }
  function swingDur() { return clamp((1 - DUTY) * STRIDE * S() / Math.max(Math.abs(cat.vx), 1e-3), 0.16, 0.42); }
  function startSwing(ft, i, dur, lift, a1, amp, walkStep) {
    Object.assign(ft, { swing: true, u: 0, dur, sx: ft.x, sy: ft.y, a0: ft.ang, a1, amp, lift, walkStep });
  }
  function walkingNow() {
    return ['walk', 'stalk', 'chase', 'zoom'].includes(cat.state) && cat.fa * cat.f > 0.6 && Math.abs(cat.vx) > 0.05 * S();
  }
  function advanceGait(dt) {
    const s = S(), L = STRIDE * s;
    const walking = walkingNow();
    if (walking && !gaitOn) {
      gaitOn = true;
      gaitPhase = DUTY - 0.02;
      const r = cat.rig;
      for (let i = 0; i < 4; i++) {
        const p = frac(gaitPhase + OFFS[i]), ft = feet[i];
        if (ft.swing || ft.raised) continue;
        const off = r ? Math.abs(ft.x - restX(i, r)) > 0.12 * s : false;
        if (p >= DUTY || off) {
          startSwing(ft, i, off && p < DUTY ? swingDur() * 0.8 : swingDur() * (1 - p) / (1 - DUTY) + 0.06, (i < 2 ? LEG.front : LEG.hind).lift * GLIFT * s, touchAng(i), 1, true);
        }
      }
    }
    if (!walking) { gaitOn = false; return; }
    const prev = gaitPhase;
    gaitPhase += Math.abs(cat.vx) * dt / L;
    for (let i = 0; i < 4; i++) {
      const ft = feet[i];
      if (ft.swing) continue;
      const p0 = frac(prev + OFFS[i]), p1 = frac(gaitPhase + OFFS[i]);
      const crossed = p1 >= p0 ? (p0 < DUTY && p1 >= DUTY) : (p0 < DUTY || p1 >= DUTY);
      if (crossed) startSwing(ft, i, swingDur(), (i < 2 ? LEG.front : LEG.hind).lift * GLIFT * s, touchAng(i), 1, true);
    }
  }
  function updateFeet(dt, r) {
    const s = r.s, fa = r.fa, sg = Math.sign(fa) || 1, gy = cat.y;
    const span = DUTY * STRIDE * s;
    if (cat.state === 'air' && cat.air) {
      const a = cat.air, prog = a.t / a.T;
      const F = { x: fa * Math.cos(cat.pitch), y: Math.sin(cat.pitch) };
      const N = { x: -F.y * sg, y: F.x * sg };
      const at = (A, u, v) => ({ x: A.x + (F.x * u + N.x * v) * s, y: A.y + (F.y * u + N.y * v) * s });
      for (let i = 0; i < 4; i++) {
        const ft = feet[i], A = anchorOf(i, r), front = i < 2, far = i % 2 === 1;
        let tgt, ta, k = 12;
        if (a.drop) {
          // Dropped: all four legs reach down for the landing.
          tgt = front ? at(A, 0.03, 0.3) : at(A, -0.02, 0.3); ta = front ? 0 : 0.45; k = 10;
        } else if (front) {
          if (prog < (a.reach ? 0.2 : 0.45)) { tgt = at(A, 0.07, 0.15); ta = 1.4; }
          else {
            const Lx = a.reach ? a.reach.x + fa * (far ? -0.03 : 0.02) * s : a.x1 + fa * (far ? 0.06 : 0.12) * s;
            const Ly = a.reach ? a.reach.y + (far ? 0.03 : 0) * s : a.y1;
            const vx = Lx - A.x, vy = Ly - A.y, d = Math.hypot(vx, vy) || 1, reach = Math.min(d, 0.42 * s);
            tgt = { x: A.x + vx / d * reach, y: A.y + vy / d * reach }; ta = -0.1; k = 9;
          }
        } else {
          if (prog < 0.35) { tgt = at(A, -0.32, 0.18); ta = -0.9; k = 16; }
          else { tgt = at(A, 0.06, 0.26); ta = 0.7; k = 8; }
        }
        if (far) { tgt.x -= fa * 0.03 * s; }
        ft.x += (tgt.x - ft.x) * damp(k, dt); ft.y += (tgt.y - ft.y) * damp(k, dt); ft.ang += (ta - ft.ang) * damp(k, dt);
        ft.swing = false; ft.raised = false;
      }
      return;
    }
    if (cat.state === 'held' && cat.held) {
      // Dangling: front paws hang loose a little forward, hind paws hang below the hips.
      const D = { x: Math.sin(cat.held.ang), y: Math.cos(cat.held.ang) };
      for (let i = 0; i < 4; i++) {
        const ft = feet[i], A = anchorOf(i, r), front = i < 2, far = i % 2 === 1;
        const len = (front ? 0.32 : 0.34) * s;
        const tx = A.x + D.x * len + fa * (front ? 0.13 : 0.06) * s - (far ? fa * 0.04 * s : 0) + (front && far ? 0.02 * s * D.y : 0);
        const ty = A.y + D.y * len;
        ft.x += (tx - ft.x) * damp(9, dt); ft.y += (ty - ft.y) * damp(9, dt);
        ft.ang += ((front ? 0.5 : 0.15) - ft.ang) * damp(9, dt);
        ft.swing = false; ft.raised = false;
      }
      return;
    }
    const groomPaw = cat.state === 'sit' && cat.groom > 0;
    const turning = !gaitOn && Math.abs(cat.f - fa) > 0.08;
    for (let i = 0; i < 4; i++) {
      const ft = feet[i], rest = restX(i, r);
      const A0 = anchorOf(i, r);
      if (i === 0 && ((cat.state === 'swat' && cat.swatItem) || (cat.state === 'probe' && prey))) {
        const t = 0.8 - cat.timer, wind = t < 0.38;
        const hitPt = cat.state === 'probe' ? { x: prey.x, y: prey.y - 0.04 * s } : { x: cat.swatItem.hx + fa * 0.02 * s, y: Math.min(cat.swatItem.cy, cat.swatItem.plat.y - 2) };
        const tgt = wind ? { x: A0.x + fa * 0.1 * s, y: A0.y + 0.14 * s } : hitPt;
        const k = damp(wind ? 12 : 30, dt);
        ft.x += (tgt.x - ft.x) * k; ft.y += (tgt.y - ft.y) * k; ft.ang += ((wind ? 1.3 : -0.2) - ft.ang) * damp(14, dt);
        ft.swing = false; ft.raised = true; continue;
      }
      if (cat.state === 'bat' && i < 2 && prey) {
        const tx = prey.x + fa * (i === 0 ? 0.03 : -0.03) * s, ty = gy - Math.max(0, Math.sin(T * 9 + i * Math.PI)) * 0.07 * s;
        ft.x += (tx - ft.x) * damp(18, dt); ft.y += (ty - ft.y) * damp(18, dt); ft.ang += (0.2 - ft.ang) * damp(10, dt);
        ft.swing = false; ft.raised = true; continue;
      }
      if (cat.state === 'wallscratch' && i < 2 && cat.wall && cat.pose.chestH > 0.45) {
        const w = cat.wall, top = Math.min(0.88 * s, w.h - 4);
        const p = frac(T * 0.85 + (i === 1 ? 0.5 : 0));
        let hgt, off = 0;
        if (p < 0.55) hgt = lerp(top, top - 0.22 * s, smooth(p / 0.55));
        else { const u = (p - 0.55) / 0.45; hgt = lerp(top - 0.22 * s, top, smooth(u)); off = Math.sin(Math.PI * u) * 0.04 * s; }
        const tx = w.x - w.dir * (0.03 * s + off + (i === 1 ? 0.015 * s : 0)), ty = gy - hgt;
        ft.x += (tx - ft.x) * damp(14, dt); ft.y += (ty - ft.y) * damp(14, dt);
        ft.ang += (-2.6 - ft.ang) * damp(10, dt);
        if (p < 0.55 && (ft.lastP == null || ft.lastP >= 0.55)) parts.push({ k: 'vscratch', x: w.x - w.dir * 2, y: gy - top + 0.02 * s, dir: w.dir, still: true, vx: 0, vy: 0, life: 0, max: 2.2 });
        ft.lastP = p; ft.swing = false; ft.raised = true; continue;
      }
      if (cat.state === 'scratch' && i < 2 && cat.pose.fr > 0.12) {
        const p = frac(T * 1.1 + (i === 1 ? 0.5 : 0));
        let off, lift = 0;
        if (p < 0.6) off = lerp(0.14, -0.02, p / 0.6);
        else { const u = (p - 0.6) / 0.4; off = lerp(-0.02, 0.14, smooth(u)); lift = Math.sin(Math.PI * u) * 0.05; }
        const tx = rest + fa * off * s, ty = gy - lift * s;
        ft.x += (tx - ft.x) * damp(25, dt); ft.y += (ty - ft.y) * damp(25, dt); ft.ang += ((p < 0.6 ? -0.2 : 0.8) - ft.ang) * damp(14, dt);
        if (p < 0.6 && (ft.lastP == null || ft.lastP >= 0.6)) parts.push({ k: 'scratch', x: rest + fa * 0.07 * s, y: gy, dir: Math.sign(fa) || 1, still: true, vx: 0, vy: 0, life: 0, max: 1.8 });
        ft.lastP = p; ft.swing = false; ft.raised = true; continue;
      }
      if (i === 0 && groomPaw) {
        const p = headPt(r, 0.07, 0.13);
        ft.x += (p.x - ft.x) * damp(10, dt);
        ft.y += (p.y + Math.sin(T * 10) * 0.02 * s - ft.y) * damp(10, dt);
        ft.ang += (1.4 - ft.ang) * damp(10, dt);
        ft.swing = false; ft.raised = true;
        continue;
      }
      if (ft.raised) { ft.raised = false; startSwing(ft, i, 0.3, 0.02 * s, poseAng(i), 0.2, false); }
      if (ft.swing) {
        ft.u += dt / ft.dur;
        const u = Math.min(1, ft.u);
        const e = ft.walkStep ? smooth(clamp((u - 0.08) / 0.84, 0, 1)) : smooth(u);
        const remain = (1 - u) * ft.dur;
        const tx = ft.walkStep ? rest + cat.vx * remain + fa * span * FWD[i] : rest;
        ft.x = lerp(ft.sx, tx, e);
        ft.y = lerp(ft.sy, gy, e) - ft.lift * Math.sin(Math.PI * Math.pow(u, 0.65));
        ft.ang = lerp(ft.a0, ft.a1, e) + ft.amp * swingBump(i, u);
        if (ft.u >= 1) { ft.swing = false; ft.x = tx; ft.y = gy; }
      } else {
        const err = rest - ft.x;
        if (!gaitOn && (turning || Math.abs(err) > 0.12 * s)) {
          ft.x += err * damp(turning ? 16 : 11, dt);
          const left = Math.abs(rest - ft.x);
          ft.y = gy - Math.min(0.06 * s, left * 0.45) - (turning ? 0.03 * s * (1 - Math.abs(fa)) * (i % 2 ? 0.6 : 1) : 0);
        } else ft.y = gy;
        const ta = gaitOn ? stanceAng(i, (ft.x - rest) * sg, span * FWD[i], span) : poseAng(i);
        ft.ang += (ta - ft.ang) * damp(gaitOn ? 16 : 9, dt);
      }
    }
    if (!gaitOn && !turning && !feet.some(ft => ft.swing)) {
      for (const i of [2, 0, 3, 1]) {
        const ft = feet[i];
        if (ft.raised || (i === 0 && groomPaw)) continue;
        const e = Math.abs(ft.x - restX(i, r));
        if (e > 0.04 * s && e <= 0.12 * s) { startSwing(ft, i, 0.2, (i < 2 ? 0.05 : 0.04) * s, poseAng(i), 0.45, false); break; }
      }
    }
  }
  function updateTail(dt, r) {
    const s = r.s, seg = 0.078 * s, fa = r.fa, tp = cat.tp;
    tail[0].x = r.hip.x - fa * 0.09 * s; tail[0].y = r.hip.y - 0.03 * s;
    let a = tp.elev + Math.sin(T * tp.sf) * tp.sway * 0.4;
    const k = damp(cat.state === 'walk' ? 45 : 22, dt), gy = cat.y - 0.035 * s;
    for (let i = 1; i < TAIL_N; i++) {
      a += tp.curl + Math.sin(T * tp.sf - i * 0.55) * tp.sway * 0.18 * (i / TAIL_N);
      const tx = tail[i - 1].x - fa * Math.cos(a) * seg, ty = tail[i - 1].y - Math.sin(a) * seg;
      tail[i].x += (tx - tail[i].x) * k; tail[i].y += (ty - tail[i].y) * k;
      if (cat.state !== 'air' && cat.state !== 'held' && tail[i].y > gy) tail[i].y = gy;
      const vx = tail[i].x - tail[i - 1].x, vy = tail[i].y - tail[i - 1].y, d = Math.hypot(vx, vy) || 1;
      tail[i].x = tail[i - 1].x + vx / d * seg; tail[i].y = tail[i - 1].y + vy / d * seg;
    }
  }
  function updateParticles(dt) {
    const s = S(), r = cat.rig;
    if (cat.state === 'sleep' && cat.pose.curl > 0.7) {
      cat.zT -= dt;
      if (cat.zT <= 0) { cat.zT = 1.4; parts.push({ k: 'z', x: r.head.x + r.fa * 0.05 * s, y: r.head.y - 0.14 * s, vx: r.fa * 0.06 * s, vy: -0.2 * s, life: 0, max: 2.6 }); }
    }
    if (cat.state === 'pet' || (cat.state === 'nuzzle' && cat.nuzzleBlend > 0.6)) {
      cat.heartT -= dt;
      if (cat.heartT <= 0) { cat.heartT = cat.state === 'pet' ? 0.45 : 0.8; parts.push({ k: 'heart', x: r.head.x + rr(-0.1, 0.1) * s, y: r.head.y - 0.18 * s, vx: rr(-0.05, 0.05) * s, vy: -0.28 * s, life: 0, max: 1.5 }); }
    }
    for (const p of parts) { p.life += dt; if (p.still) continue; p.x += (p.vx + Math.sin(p.life * 3) * 0.05 * s) * dt; p.y += p.vy * dt; }
    for (let i = parts.length - 1; i >= 0; i--) if (parts[i].life >= parts[i].max) parts.splice(i, 1);
  }

  // ---------- drawing ----------
  function drawPath(pts, w, color) {
    g.strokeStyle = color; g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 0; i < pts.length - 1; i++) {
      g.lineWidth = (w[i] + w[i + 1]) / 2;
      g.beginPath(); g.moveTo(pts[i].x, pts[i].y); g.lineTo(pts[i + 1].x, pts[i + 1].y); g.stroke();
    }
  }
  function drawEll(x, y, rx, ry, rot, color) {
    g.fillStyle = color; g.beginPath(); g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU); g.fill();
  }
  function drawPoly(pts, color) {
    g.fillStyle = color; g.strokeStyle = color; g.lineJoin = 'round'; g.lineWidth = 0.025 * S();
    g.beginPath(); pts.forEach((q, i) => i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)); g.closePath(); g.fill(); g.stroke();
  }
  // Spine frame at index i: position, tangent, outward (back-side) normal.
  function spineFrame(r, i) {
    const sp = r.sp, n = sp.length, sg = Math.sign(r.fa) || 1;
    const a = sp[Math.max(0, i - 1)], b = sp[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x, ty = b.y - a.y; const l = Math.hypot(tx, ty);
    if (l < 1e-3) { tx = sg; ty = 0; } else { tx /= l; ty /= l; }
    return { p: sp[i], t: { x: tx, y: ty }, n: { x: ty * sg, y: -tx * sg } };
  }
  function drawTorso(r, color) {
    const sp = r.sp, n = sp.length;
    const top = [], bot = [], fr = [];
    for (let i = 0; i < n; i++) {
      const F = spineFrame(r, i); fr.push(F);
      top.push({ x: sp[i].x + F.n.x * r.up[i] * 1.08, y: sp[i].y + F.n.y * r.up[i] * 1.08 });
      bot.push({ x: sp[i].x - F.n.x * r.dn[i] * 1.08, y: sp[i].y - F.n.y * r.dn[i] * 1.08 });
    }
    const cap = (i, dir) => {
      const rad = (r.up[i] + r.dn[i]) / 2, off = (r.up[i] - r.dn[i]) / 2;
      return { x: sp[i].x + fr[i].t.x * rad * dir + fr[i].n.x * off, y: sp[i].y + fr[i].t.y * rad * dir + fr[i].n.y * off };
    };
    const ring = [...top, cap(n - 1, 1.05), ...bot.reverse(), cap(0, -1)];
    const m = ring.length, mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    g.fillStyle = color; g.beginPath();
    const s0 = mid(ring[m - 1], ring[0]); g.moveTo(s0.x, s0.y);
    for (let i = 0; i < m; i++) { const p = ring[i], q = mid(p, ring[(i + 1) % m]); g.quadraticCurveTo(p.x, p.y, q.x, q.y); }
    g.closePath(); g.fill();
  }
  function legWidths(L) {
    const lg = Math.pow(settings.girth, 0.35), s = S();
    return (L.front ? LEG.front : LEG.hind).w.map((v, i) => v * s * (i === 0 ? lg * lg : lg));
  }
  function drawLeg(L, color) {
    const s = S();
    drawPath([L.A, L.K, L.D, L.P], legWidths(L), color);
    drawPaw(L, color);
  }
  function drawPaw(L, color) {
    const s = S(), dx = L.P.x - L.D.x, dy = L.P.y - L.D.y;
    const rot = Math.atan2(dy, dx) - Math.sign(dx || 1) * Math.PI / 2;
    drawEll(L.P.x + cat.fa * 0.016 * s, L.P.y - 0.017 * s, 0.052 * s, 0.033 * s, clamp(rot * 0.3, -0.5, 0.5), color);
  }
  function pointColor(pal) { return darken(pal.coat, settings.coat === 'cream' || settings.coat === 'white' ? 0.42 : 0.55); }
  // Leg markings are drawn right after their own leg and sized to it, so they ride along with
  // the leg and never spill onto the body or the leg in front.
  function legPattern(Lg, pal, far) {
    const pat = settings.pattern;
    if (pat === 'solid' || pat === 'calico') return;
    const s = S(), w = legWidths(Lg), along = (A, B, u) => ({ x: lerp(A.x, B.x, u), y: lerp(A.y, B.y, u) });
    const white = far ? '#dcd7cd' : BIB;
    g.save();
    g.globalCompositeOperation = 'source-atop';
    if (pat === 'locket') {
      // Boba's white toes: just the paw, with a little white peeking above it.
      drawPath([along(Lg.D, Lg.P, 0.6), Lg.P], [lerp(w[2], w[3], 0.6), w[3]], white);
      drawPaw(Lg, white);
    } else if (pat === 'pastel') {
      // White socks: up past the wrist on the front legs, just the feet behind.
      const u = Lg.front ? 0.25 : 0.8;
      drawPath([along(Lg.K, Lg.D, u), Lg.D, Lg.P], [lerp(w[1], w[2], u), w[2], w[3]], white);
      drawPaw(Lg, white);
    } else if (pat === 'tabby' || pat === 'tabbywhite') {
      const dx = Lg.D.x - Lg.K.x, dy = Lg.D.y - Lg.K.y, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
      g.strokeStyle = far ? darken(pal.stripe, 0.85) : pal.stripe; g.lineCap = 'butt'; g.lineWidth = 0.026 * s;
      for (const u of [0.3, 0.65]) {
        const p = along(Lg.K, Lg.D, u), half = lerp(w[1], w[2], u) * 0.5;
        g.beginPath(); g.moveTo(p.x + nx * half, p.y + ny * half); g.lineTo(p.x - nx * half, p.y - ny * half); g.stroke();
      }
      if (pat === 'tabbywhite') {
        drawPath([along(Lg.D, Lg.P, 0.35), Lg.P], [lerp(w[2], w[3], 0.35), w[3]], white);
        drawPaw(Lg, white);
      }
    } else {
      const col = pat === 'tuxedo' ? (far ? '#dcd7cd' : BIB) : (far ? darken(pointColor(pal), 0.85) : pointColor(pal));
      const start = along(Lg.K, Lg.D, pat === 'tuxedo' ? 0.55 : 0.3);
      drawPath([start, Lg.D, Lg.P], [lerp(w[1], w[2], pat === 'tuxedo' ? 0.55 : 0.3), w[2], w[3]], col);
      drawPaw(Lg, col);
    }
    g.restore();
  }
  function earPts(r, near) {
    const twitch = Math.sin(cat.ear * Math.PI) * 0.05, sleepy = cat.pose.curl * 0.04;
    return near
      ? [headPt(r, -0.03, -0.085), headPt(r, 0.075, -0.075), headPt(r, 0.03 + twitch, -0.21 + sleepy)]
      : [headPt(r, -0.1, -0.06), headPt(r, -0.005, -0.095), headPt(r, -0.075, -0.2 + sleepy)];
  }
  function eyesClosed() { return cat.blink > 0 || cat.pose.curl > 0.5 || cat.state === 'pet' || cat.nuzzleBlend > 0.5 || cat.groom > 0; }

  function drawBody(r, pal) {
    const s = r.s, L = r.legs, af = Math.abs(r.fa);
    drawLeg(L[3], pal.shade);
    drawLeg(L[1], pal.shade);
    legPattern(L[3], pal, true);
    legPattern(L[1], pal, true);
    drawPath(tail, tail.map((_, i) => lerp(0.08, 0.048, i / (TAIL_N - 1)) * s), pal.coat);
    drawTorso(r, pal.coat);
    const gn = 1 + (settings.girth - 1) * 1.3;
    drawPath([{ x: r.chest.x, y: r.chest.y - 0.02 * s }, { x: lerp(r.chest.x, r.head.x, 0.6), y: lerp(r.chest.y, r.head.y, 0.6) }], [0.2 * s * gn, 0.17 * s * gn], pal.coat);
    drawPoly(earPts(r, false), pal.shade);
    drawEll(r.head.x, r.head.y, 0.145 * s * (0.75 + 0.25 * af), 0.125 * s, r.head.rot, pal.coat);
    const m = headPt(r, 0.1, 0.035);
    drawEll(m.x, m.y, 0.066 * s * (0.6 + 0.4 * af), 0.066 * s * (0.6 + 0.4 * af), 0, pal.coat);
    drawPoly(earPts(r, true), pal.coat);
    drawPattern(r, pal);
    drawLeg(L[2], pal.coat);
    legPattern(L[2], pal, false);
    drawLeg(L[0], pal.coat);
    legPattern(L[0], pal, false);
  }

  // Coat patterns are painted with 'source-atop', so they only ever land on the cat itself.
  function drawPattern(r, pal) {
    const pat = settings.pattern;
    if (pat === 'solid') return;
    const s = r.s, L = r.legs, af = Math.abs(r.fa);
    g.save();
    g.globalCompositeOperation = 'source-atop';
    const line = (a, b, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); };
    const along = (A, B, u) => ({ x: lerp(A.x, B.x, u), y: lerp(A.y, B.y, u) });
    if (pat === 'tabby' || pat === 'tabbywhite') {
      const col = pal.stripe;
      for (let i = 0; i < 5; i++) {
        const F = spineFrame(r, i), p = F.p, k = i === 4 ? 0.6 : 1;
        const a = { x: p.x + F.n.x * r.up[i] * 1.3, y: p.y + F.n.y * r.up[i] * 1.3 };
        const b = { x: p.x - F.n.x * r.dn[i] * 0.2 * k, y: p.y - F.n.y * r.dn[i] * 0.2 * k };
        line({ x: a.x - F.t.x * 0.02 * s, y: a.y - F.t.y * 0.02 * s }, b, 0.045 * s, col);
      }
      for (let i = 3; i < TAIL_N; i += 2) {
        const p = tail[i], q = tail[i - 1], tx = p.x - q.x, ty = p.y - q.y, l = Math.hypot(tx, ty) || 1;
        const nx = -ty / l, ny = tx / l;
        line({ x: p.x + nx * 0.07 * s, y: p.y + ny * 0.07 * s }, { x: p.x - nx * 0.07 * s, y: p.y - ny * 0.07 * s }, 0.03 * s, col);
      }
      // forehead "M"
      line(headPt(r, -0.02, -0.12), headPt(r, 0.03, -0.06), 0.022 * s, col);
      line(headPt(r, 0.04, -0.13), headPt(r, 0.06, -0.07), 0.022 * s, col);
      if (pat === 'tabbywhite') {
        // white bib running up the throat, and a white muzzle with a thin blaze up the nose
        const F4 = spineFrame(r, 4), ang = Math.atan2(F4.t.y, F4.t.x);
        drawEll(F4.p.x - F4.n.x * r.dn[4] * 0.45 + F4.t.x * 0.07 * s, F4.p.y - F4.n.y * r.dn[4] * 0.45 + F4.t.y * 0.07 * s, 0.1 * s, 0.14 * s, ang, BIB);
        const th = { x: lerp(r.chest.x, r.head.x, 0.55), y: lerp(r.chest.y, r.head.y, 0.55) + 0.05 * s };
        drawEll(th.x + r.fa * 0.04 * s, th.y, 0.07 * s, 0.06 * s, 0, BIB);
        const m = headPt(r, 0.11, 0.055);
        drawEll(m.x, m.y, 0.065 * s * (0.6 + 0.4 * af), 0.05 * s, r.head.rot, BIB);
        line(headPt(r, 0.115, 0.02), headPt(r, 0.1, -0.04), 0.022 * s, BIB);
      }
    } else if (pat === 'locket') {
      // White locket on the chest that narrows up to the throat, a small chin spot, and a fleck on the belly.
      const F4 = spineFrame(r, 4), F2 = spineFrame(r, 2), ang = Math.atan2(F4.t.y, F4.t.x);
      drawEll(F4.p.x - F4.n.x * r.dn[4] * 0.5 + F4.t.x * 0.07 * s, F4.p.y - F4.n.y * r.dn[4] * 0.5 + F4.t.y * 0.07 * s, 0.08 * s, 0.12 * s, ang, BIB);
      const th = { x: lerp(r.chest.x, r.head.x, 0.5), y: lerp(r.chest.y, r.head.y, 0.5) + 0.06 * s };
      drawEll(th.x + r.fa * 0.05 * s, th.y + 0.02 * s, 0.065 * s, 0.075 * s, 0, BIB);
      const c = headPt(r, 0.12, 0.075);
      drawEll(c.x, c.y, 0.03 * s, 0.022 * s, r.head.rot, BIB);
      drawEll(F2.p.x - F2.n.x * r.dn[2] * 0.95, F2.p.y - F2.n.y * r.dn[2] * 0.95, 0.04 * s, 0.025 * s, Math.atan2(F2.t.y, F2.t.x), BIB);
    } else if (pat === 'pastel') {
      // White underside, chest and lower face; a few smoky patches on the back and by one eye; faint tail rings.
      for (let i = 1; i < 5; i++) {
        const F = spineFrame(r, i);
        drawEll(F.p.x - F.n.x * r.dn[i] * 0.85, F.p.y - F.n.y * r.dn[i] * 0.85, 0.13 * s, 0.065 * s + r.dn[i] * 0.25, Math.atan2(F.t.y, F.t.x), BIB);
      }
      const F4 = spineFrame(r, 4);
      drawEll(F4.p.x - F4.n.x * r.dn[4] * 0.3 + F4.t.x * 0.08 * s, F4.p.y - F4.n.y * r.dn[4] * 0.3 + F4.t.y * 0.08 * s, 0.11 * s, 0.15 * s, Math.atan2(F4.t.y, F4.t.x), BIB);
      const th = { x: lerp(r.chest.x, r.head.x, 0.55), y: lerp(r.chest.y, r.head.y, 0.55) + 0.04 * s };
      drawEll(th.x + r.fa * 0.03 * s, th.y, 0.09 * s, 0.07 * s, 0, BIB);
      const m = headPt(r, 0.08, 0.05);
      drawEll(m.x, m.y, 0.1 * s * (0.6 + 0.4 * af), 0.065 * s, r.head.rot, BIB);
      const patch = (i, v, du, rx, ry) => {
        const F = spineFrame(r, i);
        drawEll(F.p.x + F.n.x * v * s + F.t.x * du * s, F.p.y + F.n.y * v * s + F.t.y * du * s, rx * s, ry * s, Math.atan2(F.t.y, F.t.x), SMOKE);
      };
      patch(2, 0.1, 0.02, 0.07, 0.04);
      patch(1, 0.11, -0.04, 0.04, 0.03);
      const e = headPt(r, 0.01, -0.07);
      drawEll(e.x, e.y, 0.04 * s, 0.03 * s, r.head.rot, SMOKE);
      for (let i = 4; i < TAIL_N; i += 2) {
        const p = tail[i], q = tail[i - 1], tx = p.x - q.x, ty = p.y - q.y, l = Math.hypot(tx, ty) || 1;
        const nx = -ty / l, ny = tx / l;
        line({ x: p.x + nx * 0.07 * s, y: p.y + ny * 0.07 * s }, { x: p.x - nx * 0.07 * s, y: p.y - ny * 0.07 * s }, 0.026 * s, pal.stripe);
      }
    } else if (pat === 'tuxedo') {
      const F3 = spineFrame(r, 3), F4 = spineFrame(r, 4);
      // bib on the chest and a white belly
      drawEll(F4.p.x - F4.n.x * r.dn[4] * 0.55 + F4.t.x * 0.05 * s, F4.p.y - F4.n.y * r.dn[4] * 0.55 + F4.t.y * 0.05 * s, 0.11 * s, 0.13 * s, Math.atan2(F4.t.y, F4.t.x), BIB);
      drawEll(F3.p.x - F3.n.x * r.dn[3] * 0.85, F3.p.y - F3.n.y * r.dn[3] * 0.85, 0.16 * s, 0.07 * s, Math.atan2(F3.t.y, F3.t.x), BIB);
      // muzzle and chin
      const m = headPt(r, 0.11, 0.05);
      drawEll(m.x, m.y, 0.07 * s * (0.6 + 0.4 * af), 0.06 * s, r.head.rot, BIB);
    } else if (pat === 'calico') {
      const patch = (i, v, rx, ry, col) => {
        const F = spineFrame(r, i), p = F.p;
        drawEll(p.x + F.n.x * v * s, p.y + F.n.y * v * s, rx * s, ry * s, Math.atan2(F.t.y, F.t.x), col);
      };
      patch(0, 0.07, 0.15, 0.1, CALICO_ORANGE);
      patch(2, 0.1, 0.11, 0.08, CALICO_DARK);
      patch(3, 0.06, 0.08, 0.07, CALICO_ORANGE);
      const hp = headPt(r, -0.04, -0.06);
      drawEll(hp.x, hp.y, 0.09 * s, 0.08 * s, r.head.rot, CALICO_DARK);
      const ep = headPt(r, 0.02, -0.1);
      drawEll(ep.x, ep.y, 0.06 * s, 0.05 * s, r.head.rot, CALICO_ORANGE);
      drawPath(tail.slice(4), tail.slice(4).map(() => 0.09 * s), CALICO_ORANGE);
      drawPath(tail.slice(7), tail.slice(7).map(() => 0.09 * s), CALICO_DARK);
    } else if (pat === 'points') {
      const pt = pointColor(pal);
      const m = headPt(r, 0.09, 0.02);
      drawEll(m.x, m.y, 0.1 * s * (0.6 + 0.4 * af), 0.09 * s, r.head.rot, pt);
      drawPoly(earPts(r, false), pt); drawPoly(earPts(r, true), pt);
      drawPath(tail.slice(3), tail.slice(3).map(() => 0.1 * s), pt);
    }
    g.restore();
  }
  function drawEyes(r, pal) {
    const s = r.s;
    if (!eyesClosed()) {
      const e = headPt(r, 0.058, -0.02);
      drawEll(e.x, e.y, Math.max(0.6, 0.021 * s), Math.max(0.8, 0.029 * s), r.head.rot, pal.eye);
    } else {
      const happy = cat.state === 'pet' || cat.state === 'nuzzle';
      const a = headPt(r, 0.028, -0.02), b = headPt(r, 0.09, -0.02), c = headPt(r, 0.059, happy ? -0.05 : 0.01);
      g.strokeStyle = settings.pattern === 'points' ? '#2a2420' : pal.closed; g.lineWidth = Math.max(1, 0.017 * s); g.lineCap = 'round';
      g.beginPath(); g.moveTo(a.x, a.y); g.quadraticCurveTo(c.x, c.y, b.x, b.y); g.stroke();
    }
  }
  // The cat is drawn on its own small layer, then stamped onto the overlay.
  function drawCat() {
    const r = cat.rig, s = r.s, pal = COAT();
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const grow = p => { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; };
    r.sp.forEach(grow); tail.forEach(grow); grow(r.head);
    r.legs.forEach(Lg => { grow(Lg.K); grow(Lg.P); });
    const pad = 0.42 * s * Math.max(1, settings.girth);
    if (![x0, y0, x1, y1].every(Number.isFinite)) return;
    x0 = Math.floor(x0 - pad); y0 = Math.floor(y0 - pad); x1 = Math.ceil(x1 + pad); y1 = Math.ceil(y1 + pad);
    const bw = x1 - x0, bh = y1 - y0;
    const pw = Math.ceil(bw * dpr), ph = Math.ceil(bh * dpr);
    if (layer.width < pw || layer.height < ph) { layer.width = Math.max(pw, layer.width); layer.height = Math.max(ph, layer.height); }
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, pw + 2, ph + 2);
    lctx.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
    g = lctx;
    drawBody(r, pal);
    drawEyes(r, pal);
    g = ctx;
    // A soft, thin rim so white bibs, socks and light coats still read against white pages.
    ctx.save();
    ctx.shadowColor = 'rgba(45, 35, 25, 0.5)';
    ctx.shadowBlur = Math.max(1.5, 0.035 * s) * dpr;
    ctx.drawImage(layer, 0, 0, pw, ph, x0, y0, pw / dpr, ph / dpr);
    ctx.restore();
    // keep the petting target over the cat
    hit.style.transform = `translate(${x0 + pad * 0.6}px, ${y0 + pad * 0.6}px)`;
    hit.style.width = Math.max(0, bw - pad * 1.2) + 'px';
    hit.style.height = Math.max(0, bh - pad * 1.2) + 'px';
  }
  function drawHeart(x, y, sz, col) {
    g.fillStyle = col; g.beginPath();
    g.moveTo(x, y + sz * 0.35);
    g.bezierCurveTo(x - sz, y - sz * 0.35, x - sz * 0.45, y - sz * 1.05, x, y - sz * 0.45);
    g.bezierCurveTo(x + sz * 0.45, y - sz * 1.05, x + sz, y - sz * 0.35, x, y + sz * 0.35);
    g.fill();
  }
  function drawParticles() {
    const s = S();
    for (const p of parts) {
      g.globalAlpha = Math.min(1, p.life * 4) * (1 - p.life / p.max);
      if (p.k === 'heart') drawHeart(p.x, p.y, 0.08 * s * (0.8 + p.life * 0.3), HEART);
      else if (p.k === 'scratch') {
        g.strokeStyle = MUTED; g.lineWidth = Math.max(1, 0.012 * s); g.lineCap = 'round';
        for (let k = 0; k < 3; k++) {
          const yy = p.y + 2 + k * Math.max(1.6, 0.022 * s);
          g.beginPath(); g.moveTo(p.x - p.dir * 0.07 * s, yy + 1); g.lineTo(p.x + p.dir * 0.05 * s, yy); g.stroke();
        }
      } else if (p.k === 'vscratch') {
        g.strokeStyle = MUTED; g.lineWidth = Math.max(1, 0.012 * s); g.lineCap = 'round';
        for (let k = 0; k < 3; k++) {
          const xx = p.x - p.dir * k * Math.max(1.6, 0.02 * s);
          g.beginPath(); g.moveTo(xx, p.y); g.lineTo(xx - p.dir * 0.5, p.y + 0.2 * s); g.stroke();
        }
      } else {
        g.fillStyle = MUTED;
        g.font = `700 ${Math.max(9, Math.round(0.17 * s * (0.8 + p.life * 0.25)))}px system-ui, sans-serif`;
        g.fillText(p.k === 'q' ? '?' : 'z', p.x, p.y);
      }
    }
    g.globalAlpha = 1;
  }
  function drawPrey() {
    if (!prey) return;
    const p = prey, it = p.item;
    g.save();
    if (p.hide && (p.mode === 'hide' || p.mode === 'tohide') && p.hide.el.isConnected) {
      // "Behind" an element: don't draw where that element is.
      const r = p.hide.el.getBoundingClientRect();
      g.beginPath(); g.rect(0, 0, W, H); g.rect(r.left, r.top, r.width, r.height);
      g.clip('evenodd');
    }
    g.translate(p.x, p.y - it.h / 2); g.rotate(p.rot);
    if (it.kind === 'img') {
      try { g.drawImage(it.el, -it.w / 2, -it.h / 2, it.w, it.h); }
      catch (e) { g.fillStyle = MUTED; g.fillRect(-it.w / 2, -it.h / 2, it.w, it.h); }
    } else {
      g.font = it.font; g.fillStyle = it.color; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(it.text, 0, 0);
    }
    g.restore();
  }

  // ---------- reading the page ----------
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'BR', 'PAGE-CAT', 'IFRAME', 'OPTION', 'svg', 'SVG', 'CANVAS', 'VIDEO']);
  const TEXTY = new Set(['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD', 'DD', 'FIGCAPTION', 'BLOCKQUOTE']);
  const NO_TOUCH = 'input,textarea,select,option,[contenteditable=""],[contenteditable="true"],code,pre,kbd,[aria-hidden="true"]';
  function viewport() {
    W = document.documentElement.clientWidth || innerWidth;
    H = document.documentElement.clientHeight || innerHeight;
    floor.x0 = 0; floor.x1 = W; floor.y = H - 1;
  }
  function resizeCanvas() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }
  function visibleAt(el, x, y) {
    if (x < 0 || x >= W || y < 0 || y >= H) return false;
    const e = document.elementFromPoint(x, y);
    return !!e && (e === el || el.contains(e) || e === host);
  }
  function refreshPlat(p) {
    if (!p || p.floor) return;
    if (!p.el || !p.el.isConnected) { p.gone = true; return; }
    const r = p.el.getBoundingClientRect();
    if (r.width < 8 || r.height < 2) { p.gone = true; return; }
    p.x0 = Math.max(0, r.left); p.x1 = Math.min(W, r.right); p.y = r.top; p.h = r.height;
  }
  // Find walkable top edges, small things to play with, and cover. Runs about once a second.
  function scan() {
    if (!running) return;
    if (!alive()) { teardown(); return; }
    viewport();
    const s = S(), minW = Math.max(40, s * 1.0);
    const cands = [], hides = [], imgs = [], texts = [];
    const root = document.body || document.documentElement;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: n => SKIP.has(n.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let n, count = 0;
    while ((n = walker.nextNode()) && count++ < 4000) {
      const r = n.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= H || r.right <= 0 || r.left >= W || r.width < 8 || r.height < 8) continue;
      const tag = n.tagName;
      if (tag === 'IMG') { if (r.width >= 12 && r.width <= 80 && r.height >= 12 && r.height <= 80 && r.top > 40 && r.bottom < H - 4) imgs.push([n, r]); }
      else if (TEXTY.has(tag)) { if (r.top > 40 && r.top < H - 24) texts.push([n, r]); }
      if (r.width >= 30 && r.width <= 260 && r.height >= 24 && r.height <= 320) hides.push([n, r]);
      if (r.width >= minW && r.height >= 10 && r.top >= 40 && r.top <= H - s * 0.6) cands.push([n, r]);
    }
    cands.sort((a, b) => b[1].width - a[1].width);
    const found = [];
    for (const [el, r] of cands) {
      if (found.length >= 70) break;
      const y = r.top + 2;
      if (![0.2, 0.5, 0.8].some(u => visibleAt(el, r.left + r.width * u, y))) continue;
      const x0 = Math.max(0, r.left), x1 = Math.min(W, r.right);
      if (found.some(f => Math.abs(f.y - r.top) < 4 && Math.min(f.x1, x1) - Math.max(f.x0, x0) > 0.5 * Math.min(f.x1 - f.x0, x1 - x0))) continue;
      let p = platByEl.get(el);
      if (!p) { p = { id: 'p' + uid++, el }; platByEl.set(el, p); }
      Object.assign(p, { x0, x1, y: r.top, h: r.height, gone: false });
      found.push(p);
    }
    // Never drop a surface the cat, the prey or a planned jump is using while it is still on screen.
    for (const p of [cat.plat, prey && prey.plat, cat.plan && cat.plan.to]) {
      if (!p || p.floor || found.includes(p)) continue;
      refreshPlat(p);
      if (!p.gone && p.y >= 30 && p.y <= H - 2) found.push(p); else p.gone = true;
    }
    for (const p of plats) if (!p.floor && !found.includes(p)) p.gone = true;
    plats = [floor, ...found];

    const reachPlat = (cx, top) => {
      let best = null;
      for (const p of plats) {
        if (p.floor || cx < p.x0 + 4 || cx > p.x1 - 4) continue;
        if (p.y <= top + 3 && p.y >= top - 0.75 * s && (!best || p.y > best.y)) best = p;
      }
      return best;
    };
    const next = [];
    for (const [el, r] of imgs) {
      if (next.length >= 8) break;
      if (!el.complete || !el.naturalWidth || el.closest(NO_TOUCH)) continue;
      const cx = r.left + r.width / 2;
      if (!visibleAt(el, cx, r.top + r.height / 2)) continue;
      const plat = reachPlat(cx, r.top);
      if (plat) next.push({ kind: 'img', el, w: r.width, h: r.height, hx: cx, cy: r.top + r.height / 2, top: r.top, bottom: r.bottom, plat });
    }
    let words = 0;
    for (const [el] of texts) {
      if (words >= 10) break;
      const it = findWord(el);
      if (!it) continue;
      it.plat = reachPlat(it.hx, it.top);
      if (it.plat) { next.push(it); words++; }
    }
    if (prey && !next.includes(prey.item)) next.push(prey.item);
    items = next;
    hideCands = hides.slice(0, 150).map(([el, r]) => ({ el, x0: r.left, x1: r.right, y: r.top, h: r.height, bottom: r.bottom }));
  }
  function findWord(el) {
    if (el.closest(NO_TOUCH)) return null;
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let t, tries = 0;
    while ((t = tw.nextNode()) && tries++ < 6) {
      const m = /\b[A-Za-z]{3,8}\b/.exec(t.data);
      if (!m) continue;
      const pe = t.parentElement;
      if (!pe || pe.closest(NO_TOUCH)) continue;
      const range = document.createRange();
      range.setStart(t, m.index); range.setEnd(t, m.index + m[0].length);
      const r = range.getBoundingClientRect();
      if (r.width < 12 || r.width > 120 || r.height < 8 || r.height > 48 || r.top < 40 || r.bottom > H - 4) continue;
      if (!visibleAt(pe, r.left + r.width / 2, r.top + r.height / 2)) continue;
      const cs = getComputedStyle(pe);
      if (cs.visibility !== 'visible' || parseFloat(cs.opacity) < 0.5) continue;
      return {
        kind: 'word', node: t, start: m.index, len: m[0].length, text: m[0],
        w: r.width, h: r.height, hx: r.left + r.width / 2, cy: r.top + r.height / 2, top: r.top, bottom: r.bottom,
        font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`, color: cs.color,
      };
    }
    return null;
  }
  // Borrowing hides the original in place (layout untouched). Words get wrapped in a hidden span.
  function borrowItem(it) {
    try {
      if (it.kind === 'img') {
        it.prevVis = it.el.style.getPropertyValue('visibility');
        it.prevPri = it.el.style.getPropertyPriority('visibility');
        it.el.style.setProperty('visibility', 'hidden', 'important');
      } else {
        const n = it.node;
        if (!n.isConnected || n.data.substr(it.start, it.len) !== it.text) return false;
        it.before = n.data;
        const mid = n.splitText(it.start);
        const rest = mid.splitText(it.len);
        const span = document.createElement('span');
        span.style.setProperty('visibility', 'hidden', 'important');
        n.parentNode.insertBefore(span, mid);
        span.appendChild(mid);
        Object.assign(it, { mid, rest, span });
      }
      it.borrowed = true;
      return true;
    } catch (e) { return false; }
  }
  function restoreItem(it) {
    if (!it || !it.borrowed) return;
    try {
      if (it.kind === 'img') {
        if (it.prevVis) it.el.style.setProperty('visibility', it.prevVis, it.prevPri); else it.el.style.removeProperty('visibility');
      } else if (it.span) {
        const n = it.node;
        // Put the text back into the original node. If the page rewrote that node meanwhile,
        // its new text wins and we just remove our pieces.
        if (n.isConnected && n.data === it.before.slice(0, it.start)) n.data = n.data + it.mid.data + it.rest.data;
        if (it.span.isConnected) it.span.remove();
        if (it.rest.isConnected) it.rest.remove();
      }
    } catch (e) { /* page changed underneath us; nothing else to undo */ }
    it.borrowed = false; it.span = null;
  }
  function homeOf(it) {
    const el = it.kind === 'img' ? it.el : it.span;
    if (el && el.isConnected) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.bottom }; }
    return { x: it.hx, y: it.bottom };
  }
  function restoreAll() { if (prey) { restoreItem(prey.item); prey = null; } }

  // ---------- interaction ----------
  function overCat(p) {
    const r = cat.rig, s = S();
    if (!r) return false;
    return [r.sp[1], r.sp[3], r.head].some(q => Math.hypot(p.x - q.x, p.y - q.y) < 0.24 * s + 6);
  }
  addEventListener('pointermove', e => {
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true;
    if (Math.hypot(e.clientX - mouse.sx, e.clientY - mouse.sy) > 4) { mouse.sx = e.clientX; mouse.sy = e.clientY; mouse.stillSince = performance.now(); }
  }, { passive: true, capture: true });
  addEventListener('pointerdown', () => { mouse.stillSince = performance.now(); cat.intent = cat.intent && cat.intent.stamp != null ? null : cat.intent; cat.cool = Math.max(cat.cool, 3); }, { passive: true, capture: true });
  document.addEventListener('pointerleave', () => { mouse.active = false; }, { passive: true });
  addEventListener('blur', () => { mouse.active = false; });
  // Click the cat to pet it; press and drag to pick it up by the scruff; let go to drop it.
  let press = null;
  hit.style.cursor = 'grab';
  hit.title = 'Click to pet, drag to pick up';
  function petCat() {
    if (cat.state === 'air' || cat.state === 'held') return;
    cat.plan = null; cat.vx = 0; cat.zoomLeft = 0;
    setState('pet', 2.4); cat.heartT = 0;
  }
  function startHold(x, y) {
    if (prey) sendHome(true);
    cat.plan = null; cat.intent = null; cat.zoomLeft = 0; cat.air = null; cat.vx = 0; cat.vy = 0; gaitOn = false;
    cat.pose.curl = Math.min(cat.pose.curl, 0.3); cat.pose.lie = Math.min(cat.pose.lie, 0.3);
    cat.held = { x, y, pt: performance.now(), vx: 0, vy: 0, lvx: 0, ang: 0, av: 0 };
    setState('held', 1e9);
    hit.style.cursor = 'grabbing';
  }
  function moveHold(x, y) {
    const h = cat.held, now = performance.now(), dt = Math.max(1, now - h.pt) / 1000;
    h.vx = lerp(h.vx, (x - h.x) / dt, 0.5); h.vy = lerp(h.vy, (y - h.y) / dt, 0.5);
    h.x = x; h.y = y; h.pt = now;
  }
  function releaseHold() {
    const h = cat.held;
    hit.style.cursor = 'grab';
    if (!h) return;
    const moving = performance.now() - h.pt < 80 ? 0.6 : 0; // a flick carries a little momentum
    cat.held = null;
    dropCat(h.vx * moving, h.vy * moving);
  }
  // Fall from where it was let go and land feet-first on whatever is below.
  function dropCat(vx, vy) {
    const s = S(), g0 = 34 * s;
    vx = clamp(vx, -3 * s, 3 * s); vy = clamp(vy, -2.5 * s, 3 * s);
    const x0 = clamp(cat.x, 2, W - 2), y0 = Math.min(cat.y, floor.y - 1);
    const fall = q => { const d = Math.max(0, q.y - y0); return (vy + Math.sqrt(vy * vy + 2 * g0 * d)) / g0; };
    let q = platformUnder(x0, y0) || floor, t = fall(q);
    const q2 = platformUnder(clamp(x0 + vx * t, 0, W), y0) || floor;
    if (q2 !== q) { q = q2; t = fall(q); }
    t = Math.max(t, 0.05);
    const x1 = clamp(x0 + vx * t, q.x0 + 0.2 * s, q.x1 - 0.2 * s);
    cat.air = { x0, y0, x1, y1: q.y, g: g0, vy0: vy, T: t, vx: (x1 - x0) / t, t: 0, to: q, drop: true };
    cat.x = x0; cat.y = y0; cat.vx = cat.air.vx; cat.vy = vy;
    cat.pitch = -1.4; // starts out hanging upright, then rights itself on the way down
    cat.afterDrop = true;
    setState('air');
  }
  hit.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    press = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try { hit.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
  });
  hit.addEventListener('pointermove', e => {
    if (!press || e.pointerId !== press.id) return;
    if (cat.state !== 'held' && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) startHold(e.clientX, e.clientY);
    if (cat.state === 'held') moveHold(e.clientX, e.clientY);
  });
  hit.addEventListener('pointerup', e => {
    if (!press || e.pointerId !== press.id) return;
    e.preventDefault(); e.stopPropagation();
    press = null;
    if (cat.state === 'held') releaseHold(); else petCat();
  });
  hit.addEventListener('pointercancel', () => { press = null; if (cat.state === 'held') releaseHold(); });
  hit.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });

  let scrollTimer = 0, lastScrollT = -1e9;
  addEventListener('scroll', () => {
    if (!running) return;
    lastScrollT = performance.now();
    // Hand anything borrowed straight back; the page is moving.
    if (prey && prey.mode !== 'return') sendHome(true);
    if (cat.state === 'wallscratch' && cat.wall && cat.wall.el) setState('idle', 0.5);
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(scan, 150);
  }, { passive: true, capture: true });
  addEventListener('resize', () => {
    if (!running) return;
    viewport(); resizeCanvas(); scan();
    if (cat.plat === floor) cat.y = floor.y;
    cat.x = clamp(cat.x, 0, W);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) restoreAll(); });
  addEventListener('pagehide', restoreAll);
  document.addEventListener('fullscreenchange', () => {
    host.style.visibility = document.fullscreenElement ? 'hidden' : 'visible';
    if (document.fullscreenElement) restoreAll();
  });

  // ---------- lifecycle ----------
  let running = false, rafId = 0, scanTimer = 0, last = performance.now(), lastDraw = 0;
  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    if (document.fullscreenElement) { last = now; return; }
    // Resting cats don't need 60 frames a second.
    const calm = ['sleep', 'loaf', 'sit', 'idle'].includes(cat.state) && !prey && cat.nuzzleBlend < 0.01 && parts.every(p => p.k === 'z');
    if (calm && now - lastDraw < 45) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; lastDraw = now; T += dt;
    update(dt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    g = ctx;
    drawPrey();
    drawCat();
    drawParticles();
  }
  function placeCat(plat, x) {
    cat.plat = plat; cat.x = x; cat.y = plat.y; cat.vx = 0; cat.vy = 0; cat.air = null; cat.plan = null; gaitOn = false;
    cat.rig = computeRig();
    feet.forEach((ft, i) => { ft.x = restX(i, cat.rig); ft.y = cat.y; ft.ang = poseAng(i); ft.swing = false; ft.raised = false; });
    cat.rig.legs = [0, 1, 2, 3].map(i => legChain(i, cat.rig));
    tail.forEach(p => { p.x = cat.rig.hip.x; p.y = cat.rig.hip.y; });
    for (let k = 0; k < 30; k++) updateTail(0.05, cat.rig);
  }
  // side: 'left' or 'right' when the cat is coming over from another tab on that side.
  function show(side) {
    if (running) return;
    if (!alive()) return;
    running = true;
    if (!host.isConnected) document.documentElement.appendChild(host);
    host.style.display = 'block';
    viewport(); resizeCanvas(); scan();
    if (side || !cat.plat || cat.plat.gone) {
      // Come in at the bottom edge of the window, then leap up onto the page (or wander in).
      const fromLeft = side ? side === 'left' : rand() < 0.5, s = S();
      placeCat(floor, fromLeft ? 0.3 * s : W - 0.3 * s);
      cat.f = cat.fa = fromLeft ? 1 : -1;
      placeCat(floor, cat.x);
      cat.zoomLeft = 0; cat.intent = null;
      const j = side ? scrollHop() : null;
      if (j) { cat.plan = j; cat.f = Math.sign(j.lx - cat.x) || cat.f; setState('crouch', 0.08); }
      else goWalk(rr(0.25, 0.75) * W);
    }
    last = performance.now();
    rafId = requestAnimationFrame(frame);
    scanTimer = setInterval(scan, 1000);
  }
  function hide() {
    running = false;
    cancelAnimationFrame(rafId); clearInterval(scanTimer);
    restoreAll();
    host.style.display = 'none';
  }
  function teardown() { hide(); host.remove(); }

  // The cat's mood and energy travel with it from tab to tab.
  function snapshot() { return { mood: mood.name, moodT: mood.t, moodV: mood.v, energy: cat.energy }; }
  function applyState(st) {
    if (!st) return;
    if (st.mood && MOODS[st.mood]) { mood.name = st.mood; mood.t = st.moodT; mood.v = st.moodV; }
    if (Number.isFinite(st.energy)) cat.energy = st.energy;
  }

  if (hasChrome) {
    chrome.runtime.onMessage.addListener((msg, sender, reply) => {
      if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('pagecat:')) return;
      if (msg.type === 'pagecat:leave') { const state = snapshot(); hide(); reply({ visible: false, state }); return; }
      if (msg.type === 'pagecat:arrive') { if (!running) { applyState(msg.state); show(msg.side || undefined); } }
      else if (msg.type === 'pagecat:show') show();
      else if (msg.type === 'pagecat:hide') hide();
      reply({ visible: running, mood: settings.moodCycle ? mood.name : null });
    });
    chrome.storage.sync.get(['pagecat'], res => {
      applySettings(res.pagecat);
      // Ask the background whether the cat is on this tab (it follows you between tabs).
      if (!window.__pageCatManual) {
        chrome.runtime.sendMessage({ type: 'pagecat:hello' }).then(r => {
          if (r && r.show && !running) { applyState(r.state); show(); }
        }).catch(() => {});
      }
    });
    // Leaving the page (navigating): hand the cat's mood to the background for the next page.
    addEventListener('pagehide', () => {
      if (running && alive()) { try { chrome.runtime.sendMessage({ type: 'pagecat:state', state: snapshot() }).catch(() => {}); } catch (e) { /* extension reloaded */ } }
    });
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'sync') return;
      if (ch.pagecat) applySettings(ch.pagecat.newValue);
      if (ch.pagecatBlocked && (ch.pagecatBlocked.newValue || []).includes(location.hostname) && running) hide();
    });
  } else {
    // Loaded outside the extension (the local test page): run with defaults and expose a few hooks.
    show();
    window.__pageCat = {
      settings, applySettings, cat, canvas, layer, tail, feet, mood, show, hide, scan, goGrab, setState, zoomStep, goScratch,
      get prey() { return prey; }, get items() { return items; }, get plats() { return plats; }, get hideCands() { return hideCands; },
      step(dt) { T += dt; update(dt); },
      placeOn(el, frac, state, t) {
        scan();
        const p = el ? platByEl.get(el) : floor;
        if (!p || p.gone) return false;
        placeCat(p, p.x0 + (p.x1 - p.x0) * frac);
        if (state) setState(state, t == null ? 99 : t);
        return true;
      },
      pause() { running = false; cancelAnimationFrame(rafId); clearInterval(scanTimer); },
      hold(x, y) { startHold(x, y); }, moveTo(x, y) { moveHold(x, y); }, release() { releaseHold(); },
      render() { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); g = ctx; drawPrey(); drawCat(); drawParticles(); },
    };
  }
})();
