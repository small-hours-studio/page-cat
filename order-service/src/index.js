// Page Cat custom-cat order service (Cloudflare Worker).
//
// Flow: the order page posts photos here -> we store them and open a Stripe Checkout -> Stripe tells us
// it's paid -> we start one GitHub Actions job per cat (tools/catmaker/run_job.py) -> the job posts the
// cat back -> the customer previews it on the status page, asks for up to 2 changes, and approves ->
// we sign the cat code and (optionally) email it. Photos are deleted once every cat is approved.
//
// Storage: KV "ORDERS" holds order:<id> (order details) and cat:<id>:<n> (one key per cat, so cats
// finishing at the same time never overwrite each other). R2 "PHOTOS" holds the photos.

const PHOTO_LABELS = ['left', 'right', 'face', 'other'];
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const REVISIONS = 2;
const DAY = 86400;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    try {
      const res = await route(request, env, ctx, url);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e.stack || e);
      return json({ error: status === 500 ? 'Something went wrong on our side. Please try again.' : e.message }, status, cors);
    }
  },
};

async function route(request, env, ctx, url) {
  const p = url.pathname.split('/').filter(Boolean); // e.g. ['api','orders','abc','revise']
  const m = request.method;
  if (p[0] !== 'api') return new Response('Not found', { status: 404 });
  if (m === 'POST' && p[1] === 'orders' && p.length === 2) return createOrder(request, env);
  if (m === 'GET' && p[1] === 'orders' && p.length === 3) return getOrder(env, p[2], url.searchParams.get('key'));
  if (m === 'POST' && p[1] === 'orders' && p[3] === 'revise') return revise(request, env, p[2]);
  if (m === 'POST' && p[1] === 'orders' && p[3] === 'approve') return approve(request, env, ctx, p[2]);
  if (m === 'POST' && p[1] === 'orders' && p[3] === 'photos') return newPhotos(request, env, p[2]);
  if (m === 'POST' && p[1] === 'stripe' && p[2] === 'webhook') return stripeWebhook(request, env, ctx);
  if (p[1] === 'internal') {
    if (!env.JOB_SECRET || request.headers.get('Authorization') !== 'Bearer ' + env.JOB_SECRET) throw httpError(401, 'Not allowed');
    if (m === 'GET' && p[2] === 'job') return getJob(env, p[3], +p[4]);
    if (m === 'GET' && p[2] === 'photo') return getPhoto(env, p[3], p[4]);
    if (m === 'POST' && p[2] === 'result') return putResult(request, env, ctx, p[3], +p[4]);
  }
  return new Response('Not found', { status: 404 });
}

// ---------- customer endpoints ----------

async function createOrder(request, env) {
  const form = await request.formData();
  const email = String(form.get('email') || '').trim().slice(0, 200);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw httpError(400, 'Please enter a valid email address.');
  let cats;
  try { cats = JSON.parse(form.get('cats') || '[]'); } catch (e) { cats = []; }
  if (!Array.isArray(cats) || cats.length < 1 || cats.length > 3) throw httpError(400, 'Choose one, two or three cats.');
  const prices = String(env.PRICES || '300,400,500').split(',').map(Number);
  const id = randomId(12), key = randomId(24);
  const catRecords = [];
  for (let i = 0; i < cats.length; i++) {
    const name = String(cats[i].name || '').trim().slice(0, 24);
    if (!name) throw httpError(400, `Please give cat ${i + 1} a name.`);
    const photos = await savePhotos(env, id, i, form, `cat${i}_`);
    if (!photos.length) throw httpError(400, `Please add at least one photo of ${name}.`);
    catRecords.push({ name, photos, status: 'unpaid', revisionsLeft: REVISIONS, specs: [], notes: [] });
  }
  const order = { id, key, email, count: cats.length, amount: prices[cats.length - 1], status: 'unpaid', created: Date.now() };
  await env.ORDERS.put('order:' + id, JSON.stringify(order), { expirationTtl: 2 * DAY });
  for (let i = 0; i < catRecords.length; i++) await putCat(env, id, i, catRecords[i], 2 * DAY);
  const statusUrl = `${env.SITE_URL}/status.html?order=${id}&key=${key}`;
  if (env.MOCK === '1') return json({ url: statusUrl, mock: true });
  const session = await stripe(env, 'checkout/sessions', {
    mode: 'payment',
    success_url: statusUrl,
    cancel_url: `${env.SITE_URL}/order.html?cancelled=1`,
    client_reference_id: id,
    customer_email: email,
    'line_items[0][quantity]': 1,
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': order.amount,
    'line_items[0][price_data][product_data][name]': cats.length === 1 ? 'Custom Page Cat' : `Custom Page Cats (${cats.length})`,
    'metadata[order]': id,
    ...(env.STRIPE_TAX === '1' ? { 'automatic_tax[enabled]': 'true' } : {}),
  });
  return json({ url: session.url });
}

async function getOrder(env, id, key) {
  const order = await loadOrder(env, id, key);
  const cats = [];
  for (let i = 0; i < order.count; i++) {
    const c = await getCat(env, id, i);
    cats.push({
      name: c.name, status: c.status, revisionsLeft: c.revisionsLeft, message: c.message || null,
      spec: c.specs.length ? c.specs[c.specs.length - 1] : null, code: c.code || null,
    });
  }
  return json({ status: order.status, email: order.email, cats });
}

async function revise(request, env, id) {
  const body = await request.json();
  const order = await loadOrder(env, id, body.key);
  const i = +body.cat, c = await getCat(env, id, i);
  const note = String(body.note || '').trim().slice(0, 600);
  if (c.status !== 'ready') throw httpError(409, 'This cat is not ready for changes right now.');
  if (c.revisionsLeft < 1) throw httpError(409, 'There are no changes left for this cat.');
  if (note.length < 3) throw httpError(400, 'Tell us what to change.');
  c.revisionsLeft -= 1; c.notes.push(note); c.status = 'making'; c.message = null;
  await putCat(env, id, i, c);
  await startJob(env, order, i);
  return json({ ok: true });
}

async function approve(request, env, ctx, id) {
  const body = await request.json();
  const order = await loadOrder(env, id, body.key);
  const i = +body.cat, c = await getCat(env, id, i);
  if (c.status === 'approved') return json({ code: c.code });
  if (c.status !== 'ready') throw httpError(409, 'This cat is not ready yet.');
  c.code = await makeCode(c.specs[c.specs.length - 1], env.CAT_SIGNING_KEY);
  c.status = 'approved';
  await putCat(env, id, i, c);
  ctx.waitUntil(sendEmail(env, order.email, `${c.name} is ready for Page Cat`, codeEmail(env, order, c)));
  // once every cat is approved, the photos have done their job: delete them
  let all = true;
  for (let k = 0; k < order.count; k++) if (k !== i && (await getCat(env, id, k)).status !== 'approved') all = false;
  if (all) { ctx.waitUntil(deletePhotos(env, id)); order.status = 'done'; await putOrder(env, order); }
  return json({ code: c.code });
}

// After a "please send a clearer photo" answer, the customer can upload new photos for that cat.
async function newPhotos(request, env, id) {
  const form = await request.formData();
  const order = await loadOrder(env, id, form.get('key'));
  const i = +form.get('cat'), c = await getCat(env, id, i);
  if (c.status !== 'needs_photos') throw httpError(409, 'This cat does not need new photos.');
  const photos = await savePhotos(env, id, i, form, 'photo_', Date.now());
  if (!photos.length) throw httpError(400, 'Please add at least one photo.');
  for (const ph of c.photos) await env.PHOTOS.delete(`orders/${id}/${ph.file}`);
  c.photos = photos; c.status = 'making'; c.message = null;
  await putCat(env, id, i, c);
  await startJob(env, order, i);
  return json({ ok: true });
}

// ---------- Stripe ----------

async function stripeWebhook(request, env, ctx) {
  const payload = await request.text();
  if (!(await stripeSignatureOk(payload, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET))) throw httpError(400, 'Bad signature');
  const event = JSON.parse(payload);
  const session = event.data && event.data.object;
  const id = session && (session.client_reference_id || (session.metadata || {}).order);
  if (!id) return json({ ok: true });
  const raw = await env.ORDERS.get('order:' + id);
  if (!raw) return json({ ok: true });
  const order = JSON.parse(raw);
  if (event.type === 'checkout.session.completed' && order.status === 'unpaid') {
    await markPaid(env, order, session);
  } else if (event.type === 'checkout.session.expired' && order.status === 'unpaid') {
    ctx.waitUntil(deletePhotos(env, id));
  }
  return json({ ok: true });
}

async function markPaid(env, order, session) {
  order.status = 'paid';
  if (session && session.customer_details && session.customer_details.email) order.email = session.customer_details.email;
  order.stripeSession = session && session.id;
  await putOrder(env, order); // no expiry once paid
  for (let i = 0; i < order.count; i++) {
    const c = await getCat(env, order.id, i);
    c.status = 'making';
    await putCat(env, order.id, i, c);
    await startJob(env, order, i);
  }
}

async function stripe(env, path, params) {
  const res = await fetch('https://api.stripe.com/v1/' + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])),
  });
  const data = await res.json();
  if (!res.ok) { console.error('stripe', JSON.stringify(data)); throw httpError(502, 'Payment setup failed. Please try again.'); }
  return data;
}

async function stripeSignatureOk(payload, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map(kv => kv.split('=')).filter(x => x[0] === 't'));
  const sigs = header.split(',').filter(kv => kv.startsWith('v1=')).map(kv => kv.slice(3));
  const t = parts.t;
  if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`)));
  const hex = [...mac].map(b => b.toString(16).padStart(2, '0')).join('');
  return sigs.some(s => s.length === hex.length && timingSafeEqual(s, hex));
}

// ---------- jobs ----------

async function startJob(env, order, i) {
  if (env.MOCK === '1') return; // tests run the job themselves
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/make-cat.yml/dispatches`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'page-cat-orders' },
    body: JSON.stringify({ ref: 'main', inputs: { order: order.id, cat: String(i) } }),
  });
  if (!res.ok) { console.error('dispatch', res.status, await res.text()); throw httpError(502, 'Could not start making your cat. Please try again.'); }
}

async function getJob(env, id, i) {
  const c = await getCat(env, id, i);
  const rev = c.specs.length > 0 && c.notes.length >= c.specs.length;
  return json({
    name: c.name, photos: c.photos,
    previous: rev ? c.specs[c.specs.length - 1] : null,
    note: rev ? c.notes[c.notes.length - 1] : null,
  });
}

async function getPhoto(env, id, file) {
  if (!/^[a-z0-9_-]+\.jpg$/i.test(file)) throw httpError(400, 'Bad file');
  const obj = await env.PHOTOS.get(`orders/${id}/${file}`);
  if (!obj) throw httpError(404, 'No such photo');
  return new Response(obj.body, { headers: { 'Content-Type': 'image/jpeg' } });
}

async function putResult(request, env, ctx, id, i) {
  const r = await request.json();
  const order = JSON.parse(await env.ORDERS.get('order:' + id));
  const c = await getCat(env, id, i);
  c.cost = (c.cost || 0) + (Number(r.cost_usd) || 0);
  if (r.ok && r.reject) {
    c.status = 'needs_photos'; c.message = String(r.reject).slice(0, 300);
  } else if (r.ok && r.spec) {
    c.specs.push(r.spec); c.status = 'ready'; c.message = null; c.confidence = r.confidence || null;
  } else {
    c.status = 'failed'; c.message = 'We hit a snag making this cat. We\'ve been told and will email you.';
    console.error('job failed', id, i, r.error);
    ctx.waitUntil(sendEmail(env, env.OWNER_EMAIL, `Cat job failed: ${id}/${i}`, `<p>${escapeHtml(String(r.error || ''))}</p>`));
  }
  await putCat(env, id, i, c);
  if (c.status === 'ready' || c.status === 'needs_photos') {
    const link = `${env.SITE_URL}/status.html?order=${id}&key=${order.key}`;
    ctx.waitUntil(sendEmail(env, order.email, c.status === 'ready' ? `${c.name} is ready to look at` : `We need another photo of ${c.name}`,
      `<p>${c.status === 'ready' ? `Your Page Cat of ${escapeHtml(c.name)} is ready. Take a look, ask for changes if anything's off, and approve it to get the code.` : escapeHtml(c.message)}</p><p><a href="${link}">Open your order</a></p>`));
  }
  return json({ ok: true });
}

// ---------- helpers ----------

async function savePhotos(env, id, i, form, prefix, stamp = '') {
  const out = [];
  for (const label of PHOTO_LABELS) {
    const f = form.get(prefix + label);
    if (!f || typeof f === 'string' || !f.size) continue;
    if (f.size > MAX_PHOTO_BYTES) throw httpError(400, 'Each photo must be under 8 MB.');
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) throw httpError(400, 'Photos must be JPEG, PNG or WebP.');
    const file = `c${i}-${label}${stamp ? '-' + stamp : ''}.jpg`;
    await env.PHOTOS.put(`orders/${id}/${file}`, f.stream(), { httpMetadata: { contentType: f.type } });
    out.push({ label: label === 'other' ? '' : `${label}${label === 'face' ? '' : ' side'}`, file });
  }
  return out;
}

async function deletePhotos(env, id) {
  const list = await env.PHOTOS.list({ prefix: `orders/${id}/` });
  for (const o of list.objects) await env.PHOTOS.delete(o.key);
}

async function loadOrder(env, id, key) {
  const raw = id && (await env.ORDERS.get('order:' + id));
  const order = raw && JSON.parse(raw);
  if (!order || !key || !timingSafeEqual(String(key), order.key)) throw httpError(404, 'We could not find that order. Check the link in your email.');
  return order;
}
async function putOrder(env, order) { await env.ORDERS.put('order:' + order.id, JSON.stringify(order)); }
async function getCat(env, id, i) {
  const raw = await env.ORDERS.get(`cat:${id}:${i}`);
  if (!raw) throw httpError(404, 'No such cat in this order.');
  return JSON.parse(raw);
}
async function putCat(env, id, i, c, ttl) { await env.ORDERS.put(`cat:${id}:${i}`, JSON.stringify(c), ttl ? { expirationTtl: ttl } : {}); }

// A cat code: "PC1." + base64url(deflate-raw(spec JSON)) + "." + base64url(ECDSA P-256 signature),
// the same format tools/catmaker/catcode.mjs makes and the extension checks.
async function makeCode(spec, pem) {
  if (!pem) throw httpError(500, 'Signing key missing');
  const data = new Uint8Array(await new Response(new Blob([JSON.stringify(spec)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), ch => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data));
  return `PC1.${b64url(data)}.${b64url(sig)}`;
}

async function sendEmail(env, to, subject, html) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM || !to) return;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, html }),
  });
  if (!res.ok) console.error('email', res.status, await res.text());
}

function codeEmail(env, order, c) {
  return `<p>Here's the code for ${escapeHtml(c.name)}:</p>
<p style="font-family:monospace;word-break:break-all;background:#f5efe6;padding:12px;border-radius:8px">${c.code}</p>
<p>To add your cat: click the Page Cat button in your Chrome toolbar, paste the code under <b>Your cats</b>, and click <b>Import</b>.</p>
<p>Keep this email. If you ever remove your cat, paste the code again to bring them back.</p>
<p><a href="${env.SITE_URL}/status.html?order=${order.id}&key=${order.key}">Your order</a></p>`;
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return allowed.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
    : {};
}
function json(data, status = 200, headers = {}) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } }); }
function httpError(status, message) { return Object.assign(new Error(message), { status }); }
function randomId(n) {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789', bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map(b => abc[b % abc.length]).join('');
}
function b64url(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function timingSafeEqual(a, b) { if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
