export const esc = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const NAV: [string, string][] = [
  ['/', 'Status'],
  ['/pay', 'Payment'],
  ['/qr', 'QR test'],
  ['/callbacks', 'Callbacks'],
  ['/debug', 'Debug'],
];

export function layout(title: string, path: string, body: string): string {
  const nav = NAV.map(([href, label]) => `<a href="${href}"${href === path ? ' class="active"' : ''}>${label}</a>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><link rel="stylesheet" href="/app.css"></head>
<body><header class="topbar"><strong>Bancontact Pro sample</strong><nav>${nav}</nav></header>
<main>${body}</main><script src="/app.js" type="module"></script></body></html>`;
}

const productOptions = (products: readonly string[], selected?: string): string =>
  products.map((p) => `<option value="${esc(p)}"${p === selected ? ' selected' : ''}>${esc(p)}</option>`).join('');

export function statusPage(info: { environment: string; products: [string, boolean][]; publicBaseUrl: string | undefined; port: number }): string {
  const callback = `${info.publicBaseUrl ?? `http://localhost:${info.port}`}/bancontact/callback`;
  return layout('Status', '/', `<h1>Status</h1>
<table>
<tr><th>Environment</th><td>${esc(info.environment)}</td></tr>
<tr><th>PUBLIC_BASE_URL</th><td>${esc(info.publicBaseUrl ?? 'not set: Bancontact cannot reach the callback')}</td></tr>
<tr><th>Callback URL</th><td><code>${esc(callback)}</code></td></tr></table>
<h2>Products</h2><table>${info.products.map(([p, ok]) => `<tr><th>${esc(p)}</th><td>${ok ? 'API key and PPID set' : 'not configured'}</td></tr>`).join('')}</table>
<p class="muted">This app calls Bancontact with your credentials and is meant to stay local: it listens on localhost only.</p>`);
}

export function payPage(products: readonly string[]): string {
  return layout('Payment', '/pay', `<h1>Payment</h1>
<form id="pay-form"><div class="form-grid">
<label>Product<select name="product">${productOptions(products, 'OnDisplay')}</select></label>
<label>Amount (euro cents)<input name="amount" type="number" min="1" value="100" required></label>
<label>Description<input name="description" value="sample payment"></label>
<label>Reference<input name="reference"></label>
<label id="pos-field" hidden>POS ID (Static QR)<input name="posId" value="pos-1"></label>
</div><button type="submit">Create payment</button></form>
<p id="pay-error" class="error"></p>
<section id="pay-result"></section>
<h2>Debug</h2><div id="debug-root"></div>`);
}

export function qrPage(products: readonly string[], q: { product: string; kind: string; amount: string; description: string; reference: string; posId: string; format: string }, result?: { environment: string; payloadUrl: string; imageUrl: string } | { error: string }): string {
  const outcome = result === undefined ? '' : 'error' in result
    ? `<p class="error">${esc(result.error)}</p>`
    : `<p>Environment: <strong>${esc(result.environment)}</strong></p>
<p>Payload URL: <code>${esc(result.payloadUrl)}</code></p><p>Generator URL: <code>${esc(result.imageUrl)}</code></p>
<img class="qr" src="${esc(result.imageUrl)}" alt="QR code">
<p class="muted">No image? Open the generator URL in a tab: a 400 means the generator rejects the payload's host.</p>`;
  return layout('QR test', '/qr', `<h1>QR test</h1>
<p>Builds the self-made payload URLs the guides describe, without an API call, with the product's PPID and the hosts of the configured environment.
Scan the QR image with the preprod test app and note whether it opens.</p>
<form method="get" action="/qr"><div class="form-grid">
<label>Product<select name="product">${productOptions(products, q.product)}</select></label>
<label>Type<select name="kind"><option value="fixed"${q.kind === 'fixed' ? ' selected' : ''}>Fixed amount (/t/1/{PPID})</option><option value="pos"${q.kind === 'pos' ? ' selected' : ''}>Static QR till (/l/1/{PPID}/{POSId})</option></select></label>
<label>Amount (euro cents, fixed only)<input name="amount" type="number" min="1" value="${esc(q.amount)}"></label>
<label>Description (fixed only)<input name="description" value="${esc(q.description)}"></label>
<label>Reference (fixed only)<input name="reference" value="${esc(q.reference)}"></label>
<label>POS ID (till only)<input name="posId" value="${esc(q.posId)}"></label>
<label>Format<select name="format"><option${q.format === 'PNG' ? ' selected' : ''}>PNG</option><option${q.format === 'SVG' ? ' selected' : ''}>SVG</option></select></label>
</div><button type="submit">Build QR</button></form>${outcome}`);
}

export const callbacksPage = (): string =>
  layout('Callbacks', '/callbacks', `<h1>Callbacks</h1><p class="muted">The verified callbacks, newest first. Rejected ones are on the Debug page.</p><div id="callbacks-root"></div>`);

export const debugPage = (): string =>
  layout('Debug', '/debug', `<h1>Debug</h1>
<p class="muted">Every call the library makes to Bancontact (Authorization masked, Signature, body, response, trace IDs) and every received callback, including rejected ones.</p>
<div id="debug-root"></div>`);
