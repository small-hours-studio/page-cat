// Page Cat custom-cat order service (Cloudflare Worker).
//
// Flow: the order page posts photos here -> we store them and open a Stripe Checkout -> Stripe tells us
// it's paid -> we start one GitHub Actions job per cat (tools/catmaker/run_job.py) -> the job posts the
// design back -> we sign a cat code for it right away. The customer watches making.html, then sees each
// cat next to their photos on status.html with its code, and can ask for up to 2 changes (each change
// makes a new version with its own code). They can also report a problem, which opens a ticket.
//
// Every order is kept as a record: order:<id> (buyer, payment) and cat:<id>:<n> (photos, every version
// with its code, tickets, a log). The admin endpoints (/api/admin/*, password in ADMIN_PASSWORD) list and
// show orders, close tickets, and add a hand-fixed version or remake a cat without using up a change.
//
// Photos live in R2 "PHOTOS" and are deleted 30 days after upload by the daily cron (scheduled()).
// Unpaid orders expire from KV after 2 days and their photos go when Stripe's checkout expires.

const PHOTO_LABELS = ['left', 'right', 'face', 'other'];
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const REVISIONS = 2;
const DAY = 86400;
const KEEP_PHOTOS_DAYS = 30;
const MAX_OPEN_TICKETS = 3;

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
  // Daily: delete photos older than 30 days.
  async scheduled(event, env, ctx) { ctx.waitUntil(deleteOldPhotos(env)); },
};

async function route(request, env, ctx, url) {
  const p = url.pathname.split('/').filter(Boolean); // e.g. ['api','orders','abc','revise']
  const m = request.method;
  if (p[0] !== 'api') return new Response('Not found', { status: 404 });
  if (p[1] === 'orders') {
    if (m === 'POST' && p.length === 2) return createOrder(request, env);
    if (m === 'GET' && p.length === 3) return getOrder(env, p[2], url.searchParams.get('key'));
    if (m === 'GET' && p[3] === 'photo') return customerPhoto(env, p[2], url.searchParams.get('key'), p[4]);
    if (m === 'POST' && p[3] === 'revise') return revise(request, env, p[2]);
    if (m === 'POST' && p[3] === 'photos') return newPhotos(request, env, p[2]);
    if (m === 'POST' && p[3] === 'ticket') return openTicket(request, env, ctx, p[2]);
  }
  if (m === 'POST' && p[1] === 'stripe' && p[2] === 'webhook') return stripeWebhook(request, env, ctx);
  if (p[1] === 'internal') {
    if (!env.JOB_SECRET || !bearerOk(request, env.JOB_SECRET)) throw httpError(401, 'Not allowed');
    if (m === 'GET' && p[2] === 'job') return getJob(env, p[3], +p[4]);
    if (m === 'GET' && p[2] === 'photo') return photo(env, p[3], p[4]);
    if (m === 'POST' && p[2] === 'result') return putResult(request, env, ctx, p[3], +p[4]);
  }
  if (p[1] === 'admin') {
    if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 12 || !bearerOk(request, env.ADMIN_PASSWORD)) {
      await new Promise(r => setTimeout(r, 400)); // slows down password guessing
      throw httpError(401, 'Wrong password');
    }
    if (m === 'GET' && p[2] === 'orders' && p.length === 3) return adminList(env, url);
    if (m === 'GET' && p[2] === 'orders' && p.length === 4) return adminOrder(env, p[3]);
    if (m === 'GET' && p[2] === 'photo') return photo(env, p[3], p[4]);
    if (m === 'POST' && p[2] === 'orders' && p[4] === 'cats') return adminCat(request, env, ctx, p[3], +p[5], p[6]);
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
  const prices = String(env.PRICES || '300,500,600').split(',').map(Number);
  const id = randomId(12), key = randomId(24);
  const catRecords = [];
  for (let i = 0; i < cats.length; i++) {
    const name = String(cats[i].name || '').trim().slice(0, 24);
    if (!name) throw httpError(400, `Please give cat ${i + 1} a name.`);
    const photos = await savePhotos(env, id, i, form, `cat${i}_`);
    if (!photos.length) throw httpError(400, `Please add at least one photo of ${name}.`);
    catRecords.push(newCat(name, photos));
  }
  const order = {
    id, key, email, count: cats.length, amount: prices[cats.length - 1], status: 'unpaid', created: Date.now(),
    openTickets: 0, names: catRecords.map(c => c.name).join(', '),
  };
  await putOrder(env, order, 2 * DAY);
  for (let i = 0; i < catRecords.length; i++) await putCat(env, id, i, catRecords[i], 2 * DAY);
  const makingUrl = `${env.SITE_URL}/making.html?order=${id}&key=${key}`;
  if (env.MOCK === '1') return json({ url: makingUrl, mock: true });
  const session = await stripe(env, 'checkout/sessions', {
    mode: 'payment',
    success_url: makingUrl,
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

function newCat(name, photos) {
  return { name, photos, photosAt: Date.now(), status: 'unpaid', revisionsLeft: REVISIONS, versions: [], pendingNote: null, pendingBy: null, tickets: [], cost: 0, log: [] };
}

async function getOrder(env, id, key) {
  const order = await loadOrder(env, id, key);
  const open = changesOpen(order);
  const cats = [];
  for (let i = 0; i < order.count; i++) {
    const c = await getCat(env, id, i);
    cats.push({
      name: c.name, status: c.status, message: c.message || null,
      revisionsLeft: open ? c.revisionsLeft : 0,
      photos: photosKept(c) ? c.photos : [],
      versions: c.versions.map(v => ({ spec: v.spec, code: v.code, note: v.by === 'customer' ? v.note : null, by: v.by === 'customer' ? 'customer' : 'us', at: v.at })),
      pendingNote: c.pendingBy === 'customer' ? c.pendingNote : null,
      openTickets: c.tickets.filter(t => !t.closed).length,
    });
  }
  return json({ status: order.status, changesOpen: open, cats });
}

async function customerPhoto(env, id, key, file) {
  await loadOrder(env, id, key);
  return photo(env, id, file);
}

async function revise(request, env, id) {
  const body = await request.json();
  const order = await loadOrder(env, id, body.key);
  const i = +body.cat, c = await getCat(env, id, i);
  const note = String(body.note || '').trim().slice(0, 600);
  if (!changesOpen(order)) throw httpError(409, `Changes close ${KEEP_PHOTOS_DAYS} days after ordering. Use "Report a problem" instead.`);
  if (c.status !== 'ready') throw httpError(409, 'This cat is not ready for changes right now.');
  if (c.revisionsLeft < 1) throw httpError(409, 'There are no changes left for this cat.');
  if (note.length < 3) throw httpError(400, 'Tell us what to change.');
  c.revisionsLeft -= 1; c.pendingNote = note; c.pendingBy = 'customer'; c.status = 'making'; c.message = null;
  logEvent(c, 'change asked', note);
  await putCat(env, id, i, c);
  await startJob(env, order, i);
  return json({ ok: true });
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
  c.photos = photos; c.photosAt = Date.now(); c.status = 'making'; c.message = null;
  logEvent(c, 'new photos');
  await putCat(env, id, i, c);
  await startJob(env, order, i);
  return json({ ok: true });
}

async function openTicket(request, env, ctx, id) {
  const body = await request.json();
  const order = await loadOrder(env, id, body.key);
  const i = +body.cat, c = await getCat(env, id, i);
  const message = String(body.message || '').trim().slice(0, 1500);
  if (message.length < 3) throw httpError(400, 'Tell us what went wrong.');
  if (c.tickets.filter(t => !t.closed).length >= MAX_OPEN_TICKETS) throw httpError(409, "We already have your messages about this cat and we'll get back to you.");
  c.tickets.push({ at: Date.now(), message, closed: false });
  logEvent(c, 'ticket opened', message);
  await putCat(env, id, i, c);
  order.openTickets = (order.openTickets || 0) + 1;
  await putOrder(env, order);
  ctx.waitUntil(sendEmail(env, env.OWNER_EMAIL, `Ticket: ${c.name} (order ${id})`, `<p>${escapeHtml(message)}</p>`));
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
  const who = (session && session.customer_details) || {};
  order.status = 'paid';
  order.paidAt = Date.now();
  if (who.email) order.email = String(who.email).slice(0, 200);
  if (who.name) order.buyer = String(who.name).slice(0, 100);
  order.stripeSession = session && session.id;
  order.paymentIntent = session && session.payment_intent;
  await putOrder(env, order); // no expiry once paid: this is the permanent record
  for (let i = 0; i < order.count; i++) {
    const c = await getCat(env, order.id, i);
    c.status = 'making';
    logEvent(c, 'paid');
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
  const last = c.versions[c.versions.length - 1];
  const rev = !!(last && c.pendingNote);
  return json({ name: c.name, photos: c.photos, previous: rev ? last.spec : null, note: rev ? c.pendingNote : null });
}

async function photo(env, id, file) {
  if (!/^[a-z0-9]+$/i.test(id || '') || !/^[a-z0-9_-]+\.jpg$/i.test(file || '')) throw httpError(400, 'Bad file');
  const obj = await env.PHOTOS.get(`orders/${id}/${file}`);
  if (!obj) throw httpError(404, 'No such photo');
  return new Response(obj.body, { headers: { 'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/jpeg', 'Cache-Control': 'private, max-age=3600' } });
}

async function putResult(request, env, ctx, id, i) {
  const r = await request.json();
  const order = JSON.parse(await env.ORDERS.get('order:' + id));
  const c = await getCat(env, id, i);
  const revising = c.versions.length > 0;
  c.cost = (c.cost || 0) + (Number(r.cost_usd) || 0);
  if (r.ok && r.spec) {
    await addVersion(env, c, r.spec, c.pendingNote, c.pendingBy || 'maker', r.confidence);
    logEvent(c, 'made', `v${c.versions.length}${r.cost_usd ? `, $${Number(r.cost_usd).toFixed(2)}` : ''}`);
  } else if (revising) {
    // a change didn't work: keep the cat as it was and give the change back
    if (c.pendingBy === 'customer') c.revisionsLeft += 1;
    c.status = 'ready'; c.pendingNote = null; c.pendingBy = null;
    c.message = r.ok && r.reject ? String(r.reject).slice(0, 300) : "That change didn't work out, so we kept your cat as it was. You still have the change.";
    logEvent(c, 'change failed', String(r.reject || r.error || '').slice(0, 300));
  } else if (r.ok && r.reject) {
    c.status = 'needs_photos'; c.message = String(r.reject).slice(0, 300);
    logEvent(c, 'asked for photos', c.message);
  } else {
    c.status = 'failed'; c.message = "We hit a snag making this cat. We've been told and will email you.";
    logEvent(c, 'failed', String(r.error || '').slice(0, 300));
    console.error('job failed', id, i, r.error);
    ctx.waitUntil(sendEmail(env, env.OWNER_EMAIL, `Cat job failed: ${id}/${i}`, `<p>${escapeHtml(String(r.error || ''))}</p>`));
  }
  await putCat(env, id, i, c);
  if (c.status === 'ready' && r.ok && r.spec) ctx.waitUntil(sendEmail(env, order.email, `${c.name} is ready for Page Cat`, readyEmail(env, order, c)));
  if (c.status === 'needs_photos') ctx.waitUntil(sendEmail(env, order.email, `We need another photo of ${c.name}`,
    `<p>${escapeHtml(c.message)}</p><p><a href="${orderLink(env, order)}">Open your order</a></p>`));
  return json({ ok: true });
}

// A new design for a cat: sign its code right away and make it the current version.
async function addVersion(env, c, spec, note, by, confidence) {
  const code = await makeCode(spec, env.CAT_SIGNING_KEY);
  c.versions.push({ spec, code, note: note || null, by, at: Date.now(), confidence: confidence || null });
  c.status = 'ready'; c.message = null; c.pendingNote = null; c.pendingBy = null;
}

// ---------- admin ----------

async function adminList(env, url) {
  const out = [];
  let cursor;
  do {
    const page = await env.ORDERS.list({ prefix: 'order:', cursor });
    for (const k of page.keys) out.push({ id: k.name.slice(6), ...(k.metadata || {}) });
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor && out.length < 5000);
  const q = (url.searchParams.get('q') || '').toLowerCase().trim();
  const rows = out.filter(o => !q || o.id.includes(q) || (o.email || '').toLowerCase().includes(q) || (o.names || '').toLowerCase().includes(q));
  rows.sort((a, b) => (b.created || 0) - (a.created || 0));
  return json({ orders: rows });
}

async function adminOrder(env, id) {
  const raw = await env.ORDERS.get('order:' + id);
  if (!raw) throw httpError(404, 'No such order');
  const order = JSON.parse(raw);
  const link = orderLink(env, order);
  const cats = [];
  for (let i = 0; i < order.count; i++) {
    const c = await getCat(env, id, i);
    cats.push({ ...c, photosKept: photosKept(c) });
  }
  delete order.key;
  return json({ order, cats, link });
}

// POST /api/admin/orders/<id>/cats/<n>/<action>
//   fix     {spec, note, email}  add a hand-made version (signed), e.g. to answer a ticket
//   remake  {note}               run the cat maker again with a note, without using a customer change
//   close   {ticket, reply}      close ticket number <ticket>
//   changes {add}                give the customer more changes (and 14 more days to use them)
async function adminCat(request, env, ctx, id, i, action) {
  const body = await request.json().catch(() => ({}));
  const raw = await env.ORDERS.get('order:' + id);
  if (!raw) throw httpError(404, 'No such order');
  const order = JSON.parse(raw);
  const c = await getCat(env, id, i);
  if (action === 'fix') {
    const spec = body.spec;
    if (!spec || typeof spec !== 'object' || !Array.isArray(spec.c)) throw httpError(400, 'spec must be a cat design');
    spec.v = spec.v || 1; spec.n = c.name; // always the customer's name for their cat
    delete spec.notes; delete spec.confidence;
    await addVersion(env, c, spec, String(body.note || 'Fixed by hand').slice(0, 600), 'admin');
    logEvent(c, 'fixed by admin', `v${c.versions.length}`);
    await putCat(env, id, i, c);
    if (body.email) ctx.waitUntil(sendEmail(env, order.email, `We've updated ${c.name}`, readyEmail(env, order, c)));
    return json({ ok: true, code: c.versions[c.versions.length - 1].code });
  }
  if (action === 'remake') {
    if (c.status === 'making') throw httpError(409, 'Already making');
    c.pendingNote = c.versions.length ? (String(body.note || '').slice(0, 600) || 'Try again.') : null;
    c.pendingBy = 'admin'; c.status = 'making'; c.message = null;
    logEvent(c, 'remake by admin', c.pendingNote || '');
    await putCat(env, id, i, c);
    await startJob(env, order, i);
    return json({ ok: true });
  }
  if (action === 'close') {
    const t = c.tickets[+body.ticket];
    if (!t) throw httpError(404, 'No such ticket');
    if (!t.closed) {
      t.closed = true; t.closedAt = Date.now(); t.reply = body.reply ? String(body.reply).slice(0, 1500) : null;
      order.openTickets = Math.max(0, (order.openTickets || 0) - 1);
      await putOrder(env, order);
      logEvent(c, 'ticket closed', t.reply || '');
      await putCat(env, id, i, c);
    }
    return json({ ok: true });
  }
  if (action === 'changes') {
    const add = Math.max(1, Math.min(5, +body.add || 1));
    c.revisionsLeft = Math.min(10, c.revisionsLeft + add);
    order.changesUntil = Math.max(order.changesUntil || 0, Date.now() + 14 * DAY * 1000);
    await putOrder(env, order);
    logEvent(c, 'changes given', String(add));
    await putCat(env, id, i, c);
    return json({ ok: true });
  }
  throw httpError(404, 'Unknown action');
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

async function deleteOldPhotos(env) {
  const cutoff = Date.now() - KEEP_PHOTOS_DAYS * DAY * 1000;
  let cursor;
  do {
    const page = await env.PHOTOS.list({ prefix: 'orders/', cursor });
    const old = page.objects.filter(o => new Date(o.uploaded).getTime() < cutoff).map(o => o.key);
    if (old.length) await env.PHOTOS.delete(old);
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
}

function photosKept(c) { return Date.now() - (c.photosAt || 0) < KEEP_PHOTOS_DAYS * DAY * 1000; }
function changesOpen(order) {
  if (order.changesUntil && order.changesUntil > Date.now()) return true;
  return !!order.paidAt && Date.now() - order.paidAt < KEEP_PHOTOS_DAYS * DAY * 1000;
}
function logEvent(c, what, detail) { (c.log = c.log || []).push({ at: Date.now(), what, detail: detail || undefined }); if (c.log.length > 100) c.log.shift(); }
function orderLink(env, order) { return `${env.SITE_URL}/status.html?order=${order.id}&key=${order.key}`; }

async function loadOrder(env, id, key) {
  const raw = id && (await env.ORDERS.get('order:' + id));
  const order = raw && JSON.parse(raw);
  if (!order || !key || !timingSafeEqual(String(key), order.key)) throw httpError(404, 'We could not find that order. Check the link in your email.');
  return order;
}
// The list metadata lets the admin page show every order without reading each one.
async function putOrder(env, order, ttl) {
  const metadata = { email: order.email, created: order.created, status: order.status, count: order.count, amount: order.amount, openTickets: order.openTickets || 0, names: order.names || '' };
  await env.ORDERS.put('order:' + order.id, JSON.stringify(order), ttl ? { expirationTtl: ttl, metadata } : { metadata });
}
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

function readyEmail(env, order, c) {
  const v = c.versions[c.versions.length - 1];
  return `<p>Here's the code for ${escapeHtml(c.name)}:</p>
<p style="font-family:monospace;word-break:break-all;background:#f5efe6;padding:12px;border-radius:8px">${v.code}</p>
<p>To add your cat: click the Page Cat button in your Chrome toolbar, paste the code under <b>Your cats</b>, and click <b>Import</b>.</p>
<p>Something not quite right? <a href="${orderLink(env, order)}">Open your order</a> to see ${escapeHtml(c.name)} next to your photos and ask for a change.</p>
<p>Keep this email. If you ever remove your cat, paste the code again to bring them back.</p>`;
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return allowed.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', Vary: 'Origin' }
    : {};
}
function bearerOk(request, secret) { return timingSafeEqual(request.headers.get('Authorization') || '', 'Bearer ' + secret); }
function json(data, status = 200, headers = {}) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } }); }
function httpError(status, message) { return Object.assign(new Error(message), { status }); }
function randomId(n) {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789', bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map(b => abc[b % abc.length]).join('');
}
function b64url(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function timingSafeEqual(a, b) { if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
