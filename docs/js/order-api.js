// Shared by the order pages: where the order service is, and a small fetch helper.
(function () {
  const q = new URLSearchParams(location.search);
  // ?api= is for local testing only, so a crafted link can't send orders anywhere else
  const testApi = q.get('api') || '';
  const API = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(testApi) ? testApi : window.ORDER_API;
  const ORDER = q.get('order'), KEY = q.get('key');

  async function call(path, body, headers) {
    const opts = body !== undefined
      ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...(headers || {}) }, body: JSON.stringify(body) }
      : { headers: headers || {} };
    const res = await fetch(API + path, opts).catch(() => { throw new Error('Could not reach the order service. Check your connection and try again.'); });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: res.status });
    return data;
  }

  // Links between the order pages keep the order (and the test ?api=, if any).
  function link(page) {
    const p = new URLSearchParams({ order: ORDER || '', key: KEY || '' });
    if (API !== window.ORDER_API) p.set('api', API);
    return `${page}?${p}`;
  }

  window.orderApi = { API, ORDER, KEY, call, link, photoUrl: file => `${API}/api/orders/${ORDER}/photo/${file}?key=${encodeURIComponent(KEY || '')}` };
})();
