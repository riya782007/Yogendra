/* ============================================================================
 * BrainyBuzz recon — run in the browser console while LOGGED IN, on the
 * products / inventory LIST page. Read-only: it only looks at the page you're
 * already viewing and downloads a small "recon.json" describing how the
 * catalogue is served. Send that file back so the full extractor can be built.
 *
 * HOW TO RUN:
 *   1. Log into https://app.brainybuzz.digital/darwaaza  (you type the password)
 *   2. Open the page that LISTS your products / inventory
 *   3. Press F12 → "Console" tab
 *   4. Paste this whole file, press Enter
 *   5. It downloads "recon.json" — send that file back
 * ========================================================================== */
(async () => {
  const out = {
    url: location.href,
    origin: location.origin,
    csrf: document.querySelector('meta[name=csrf-token]')?.content || null,
    ts: new Date().toISOString(),
  };
  const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

  // --- Tables on the page (headers, row count, a few sample rows) ---
  out.tables = [...document.querySelectorAll('table')].slice(0, 6).map((t, i) => {
    const heads = [...t.querySelectorAll('thead th, thead td')].map(txt);
    const rows = [...t.querySelectorAll('tbody tr')];
    return {
      index: i,
      headers: heads,
      rowCount: rows.length,
      sampleRows: rows.slice(0, 3).map((r) => [...r.querySelectorAll('td')].map(txt)),
      firstRowHtml: rows[0]?.outerHTML?.slice(0, 1500) || null,
    };
  });

  // --- "Showing 1 to 50 of 9,873 entries" style counters + pagination ---
  out.infoText = [...document.querySelectorAll('.dataTables_info, .pagination, [class*="info"], [class*="paginat"]')]
    .map(txt).filter(Boolean).slice(0, 10);
  out.paginationLinks = [...document.querySelectorAll('a[href*="page="], .pagination a')]
    .map((a) => a.href).slice(0, 20);

  // --- Likely product detail / edit links ---
  out.detailLinks = [...document.querySelectorAll('a[href]')]
    .map((a) => a.href)
    .filter((h) => /product|item|inventory|catalog|edit|view|show/i.test(h))
    .filter((v, idx, arr) => arr.indexOf(v) === idx)
    .slice(0, 25);

  // --- Image URL samples (host + path pattern matter for re-hosting) ---
  out.imageSamples = [...document.querySelectorAll('img')]
    .map((i) => i.currentSrc || i.src)
    .filter((s) => s && !s.startsWith('data:'))
    .filter((v, idx, arr) => arr.indexOf(v) === idx)
    .slice(0, 12);

  // --- jQuery DataTables ajax config (if used) ---
  try {
    if (window.jQuery && jQuery.fn && jQuery.fn.dataTable) {
      out.dataTables = jQuery.fn.dataTable.tables({ api: true }).map(function () {
        const s = this.settings()[0];
        return {
          ajaxUrl: (s.ajax && (s.ajax.url || s.ajax)) || s.sAjaxSource || null,
          recordsTotal: s._iRecordsTotal ?? null,
          colCount: (s.aoColumns || []).length,
          columns: (s.aoColumns || []).map((c) => c.data ?? c.mData ?? c.sName ?? null),
        };
      });
    }
  } catch (e) { out.dtErr = String(e); }

  // --- Scan scripts for endpoints that look like product/data APIs ---
  const urls = new Set();
  document.querySelectorAll('script').forEach((s) => {
    const c = s.src || s.textContent || '';
    (c.match(/['"`](\/[^'"`\s]*(?:product|item|inventory|catalog|list|data|api|index)[^'"`\s]*)['"`]/gi) || [])
      .forEach((m) => urls.add(m.replace(/['"`]/g, '')));
  });
  out.candidateEndpoints = [...urls].slice(0, 40);

  // --- Probe server-side pagination (?page=2) using your session cookies ---
  try {
    const u = new URL(location.href);
    u.searchParams.set('page', '2');
    const r = await fetch(u.toString(), { credentials: 'include' });
    const body = await r.text();
    out.page2 = {
      status: r.status,
      length: body.length,
      looksLikeJson: body.trim().startsWith('{') || body.trim().startsWith('['),
      sample: body.slice(0, 400),
    };
  } catch (e) { out.page2Err = String(e); }

  // --- Download recon.json ---
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'recon.json';
  document.body.appendChild(a); a.click(); a.remove();
  console.log('%c✓ recon.json downloaded — send that file back', 'color:green;font-weight:bold');
  console.log(out);
})();
