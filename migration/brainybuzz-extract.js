/* ============================================================================
 * BrainyBuzz extractor — run in the console on  /admin/products  while logged in.
 * Captures the real product-list API call, then pages through ALL products
 * LOW-AND-SLOW (one page every few seconds, with random jitter) so it blends in
 * with normal browsing. Saves progress to localStorage, so if it stops you can
 * just re-run this same script and it RESUMES where it left off. At the end it
 * downloads products.json.
 *
 * HOW TO RUN:
 *   1. Be on https://app.brainybuzz.digital/admin/products  (logged in)
 *   2. Console → type  allow pasting  + Enter (first time only)
 *   3. Paste this whole script + Enter
 *   4. When it says so, CHANGE THE PAGE-SIZE DROPDOWN (pick 100) or click NEXT once
 *      — that makes the app fire the data call, which the script captures.
 *   5. Leave the tab open; it collects quietly. It downloads products.json at the end.
 *      If interrupted, just paste + run again to resume.
 * ========================================================================== */
(async () => {
  const MIN_MS = 2000, MAX_MS = 5000;                 // throttle between pages
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = () => MIN_MS + Math.random() * (MAX_MS - MIN_MS);
  const CKPT = 'bb_extract_ckpt_v1';
  const log = (m, c = '#999') => console.log('%c' + m, `color:${c};font-weight:bold`);

  const pickArray = (j) =>
    Array.isArray(j) ? j
      : (j?.data?.data || j?.data || j?.records || j?.products || j?.rows || j?.items || null);
  const looksLikeProducts = (txt) => {
    if (!txt || (txt[0] !== '{' && txt[0] !== '[')) return false;
    try { const arr = pickArray(JSON.parse(txt));
      return Array.isArray(arr) && arr.length > 0 && arr.some((o) => o && (o.sku || o.SKU || o.id)); }
    catch { return false; }
  };

  // ---- 1. Intercept fetch + XHR to capture the products API request ----
  let captured = null;
  const origFetch = window.fetch.bind(window);
  if (!window.__bbHooked) {
    window.__bbHooked = true;
    window.fetch = async function (...a) {
      const res = await origFetch(...a);
      try { const t = await res.clone().text();
        if (!captured && looksLikeProducts(t)) {
          const req = a[0], init = a[1] || {};
          captured = { url: typeof req === 'string' ? req : req.url, method: (init.method || 'GET').toUpperCase(),
            headers: hdrs(init.headers), body: init.body || null };
          log('✓ captured product API: ' + captured.url, 'green');
        }
      } catch {}
      return res;
    };
    const OX = XMLHttpRequest.prototype.open, SX = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__m = (m || 'GET').toUpperCase(); this.__u = u; return OX.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function (b) {
      this.addEventListener('load', () => { try {
        if (!captured && looksLikeProducts(this.responseText)) {
          captured = { url: this.__u, method: this.__m, headers: {}, body: b || null, xhr: true };
          log('✓ captured product API (xhr): ' + this.__u, 'green');
        } } catch {} });
      return SX.apply(this, arguments);
    };
  }
  function hdrs(h) { const o = {}; try { if (h instanceof Headers) h.forEach((v, k) => (o[k] = v)); else if (h) Object.assign(o, h); } catch {} return o; }

  // ---- 2. Wait for the user to trigger the data call ----
  log('➤ Now CHANGE the page-size dropdown to 100 (or click NEXT page once). Waiting for the data call…', '#c80');
  for (let i = 0; i < 180 && !captured; i++) await sleep(500);   // up to 90s
  if (!captured) { log('✗ No data call captured. Reload the products page, then run this again and interact with the table.', 'red'); return; }

  // ---- 3. Build a paginator from the captured request ----
  const csrf = document.querySelector('meta[name=csrf-token]')?.content || null;
  const baseHeaders = Object.assign(
    { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' },
    csrf ? { 'X-CSRF-TOKEN': csrf } : {}, captured.headers || {});

  function reqForPage(n) {
    // GET (or no body): page lives in the query string.
    if (captured.method === 'GET' || !captured.body) {
      const u = new URL(captured.url, location.origin);
      u.searchParams.set('page', n);
      ['per_page', 'perPage', 'limit', 'length'].forEach((k) => { if (u.searchParams.has(k)) u.searchParams.set(k, 100); });
      return { url: u.toString(), init: { method: 'GET', headers: baseHeaders, credentials: 'include' } };
    }
    // POST: page lives in the body (JSON or form-encoded).
    let body = captured.body;
    try { const j = JSON.parse(body);
      if ('page' in j) j.page = n; else if ('start' in j && 'length' in j) j.start = (n - 1) * (j.length || 100);
      ['per_page', 'perPage', 'limit', 'length'].forEach((k) => { if (k in j) j[k] = j[k] === undefined ? 100 : (k === 'length' ? j[k] : 100); });
      body = JSON.stringify(j);
      return { url: captured.url, init: { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, baseHeaders), body, credentials: 'include' } };
    } catch {
      const p = new URLSearchParams(body); p.set('page', n);
      ['per_page', 'perPage', 'limit'].forEach((k) => { if (p.has(k)) p.set(k, 100); });
      return { url: captured.url, init: { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, baseHeaders), body: p.toString(), credentials: 'include' } };
    }
  }

  // ---- 4. Resume from checkpoint if present ----
  let all = [], page = 1;
  try { const c = JSON.parse(localStorage.getItem(CKPT) || 'null');
    if (c && c.url === captured.url && Array.isArray(c.all)) { all = c.all; page = c.page; log(`↻ resuming from page ${page} (${all.length} already collected)`, '#08a'); }
  } catch {}

  // ---- 5. Page through, throttled ----
  let totalPages = Infinity, seen = new Set(all.map((r) => r.id ?? r.sku));
  while (page <= totalPages) {
    const { url, init } = reqForPage(page);
    let j;
    try { const r = await origFetch(url, init); j = await r.json(); }
    catch (e) { log('• page ' + page + ' failed, retrying once in 6s…', '#c80'); await sleep(6000);
      try { const r2 = await origFetch(url, init); j = await r2.json(); } catch { log('✗ stopped at page ' + page + ' — re-run to resume.', 'red'); break; } }

    const arr = pickArray(j) || [];
    if (!arr.length) break;
    let added = 0;
    for (const row of arr) { const key = row.id ?? row.sku; if (key != null && seen.has(key)) continue; seen.add(key); all.push(row); added++; }

    const total = j.total ?? j.meta?.total ?? j.data?.total ?? j.recordsTotal ?? null;
    const per = arr.length;
    if (total && per) totalPages = Math.ceil(total / per);
    log(`page ${page}/${isFinite(totalPages) ? totalPages : '?'} — +${added}, total ${all.length}`, '#444');

    localStorage.setItem(CKPT, JSON.stringify({ url: captured.url, page: page + 1, all }));
    if (added === 0 && isFinite(totalPages)) { /* keep going to be safe */ }
    page++;
    if (page <= totalPages) await sleep(jitter());
  }

  // ---- 6. Download ----
  const blob = new Blob([JSON.stringify({ count: all.length, source: captured.url, products: all }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'products.json';
  document.body.appendChild(a); a.click(); a.remove();
  localStorage.removeItem(CKPT);
  log('✓ DONE — products.json downloaded with ' + all.length + ' products. Send that file back.', 'green');
})();
