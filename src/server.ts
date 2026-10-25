import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import {
  BancontactApiError,
  BancontactClientFactory,
  InvalidCallbackError,
  ProductNotConfiguredError,
  QrCodeImageFormat,
  qr,
} from '@yvebrecht/bancontactpro';
import type { BancontactProduct, CreatePaymentResponse, MerchantCallback, Payment } from '@yvebrecht/bancontactpro';
import { PRODUCTS, parseProduct, publicBaseUrl, readCredentials } from './config.ts';
import { analyseSignature } from './diagnostics.ts';
import { DebugLog, debugFetch, pretty } from './debug.ts';
import { callbacksPage, debugPage, payPage, qrPage, statusPage } from './views.ts';

const port = Number(process.env.PORT ?? 5085);
const publicDir = join(import.meta.dirname, '..', 'public');
const debug = new DebugLog();
const callbacks: { receivedAt: string; requestId: string; payload: MerchantCallback }[] = [];

// Credentials are read on every call (readCredentials), and every call to Bancontact, including the JWKS fetches of the
// callback verifier, goes through debugFetch.
const factory = new BancontactClientFactory(() => readCredentials(), { fetch: debugFetch(debug) });

const callbackPath = '/bancontact/callback';
const callbackUrl = () => `${publicBaseUrl() ?? `http://localhost:${port}`}${callbackPath}`;

function send(res: ServerResponse, status: number, body: string, type = 'text/html; charset=utf-8'): void {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}
const sendJson = (res: ServerResponse, status: number, body: unknown): void =>
  send(res, status, JSON.stringify(body), 'application/json; charset=utf-8');

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** What the browser needs to show and follow a payment. */
function view(p: CreatePaymentResponse | Payment) {
  const expires = 'expiresAt' in p ? p.expiresAt : p.expireAt;
  return {
    paymentId: p.paymentId,
    status: p.status,
    amount: p.amount,
    currency: p.currency,
    expiresAt: expires,
    qrcode: p._links?.qrcode.href ?? '',
    deeplink: p._links?.deeplink.href ?? '',
  };
}

function errorStatus(error: unknown): { status: number; message: string } {
  if (error instanceof ProductNotConfiguredError) return { status: 400, message: error.message };
  if (error instanceof BancontactApiError) return { status: error.status >= 400 ? error.status : 502, message: `Bancontact returned ${error.status} ${error.code}: ${error.message}` };
  return { status: 502, message: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  const method = req.method ?? 'GET';
  const path = url.pathname;

  if (method === 'POST' && path === callbackPath) return handleCallback(req, res, path);

  if (method === 'GET' && !path.startsWith('/api/')) {
    if (path === '/') {
      const credentials = readCredentials();
      const products = await Promise.all(PRODUCTS.map(async (p): Promise<[string, boolean]> => [p, await factory.isConfigured(p)]));
      return send(res, 200, statusPage({ environment: credentials.environment ?? 'Preprod', products, publicBaseUrl: publicBaseUrl(), port }));
    }
    if (path === '/pay') return send(res, 200, payPage(PRODUCTS));
    if (path === '/qr') return qrRoute(url, res);
    if (path === '/callbacks') return send(res, 200, callbacksPage());
    if (path === '/debug') return send(res, 200, debugPage());
    return staticFile(path, res);
  }

  if (path === '/api/debug' && method === 'GET') return sendJson(res, 200, debug.recent());
  if (path === '/api/debug/clear' && method === 'POST') {
    debug.clear();
    return sendJson(res, 200, {});
  }
  if (path === '/api/callbacks' && method === 'GET') {
    const id = url.searchParams.get('paymentId');
    return sendJson(res, 200, callbacks.filter((c) => id === null || c.payload.paymentId === id));
  }

  if (path === '/api/payments' && method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)).toString('utf8')) as Record<string, unknown>;
      const product = parseProduct(String(body.product));
      if (product === undefined) return sendJson(res, 400, { error: `Unknown product '${String(body.product)}'.` });
      const payments = await factory.payments(product);
      const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
      const description = text(body.description);
      const reference = text(body.reference);
      const common = { amount: Number(body.amount), callbackUrl: callbackUrl(), ...(description ? { description } : {}), ...(reference ? { reference } : {}) };
      const created = product === 'StaticQr'
        ? await payments.createStaticQrPayment({ ...common, posId: text(body.posId) ?? 'POS00001' })
        : await payments.create(common);
      return sendJson(res, 201, view(created));
    } catch (error) {
      const { status, message } = errorStatus(error);
      return sendJson(res, status, { error: message });
    }
  }

  const one = /^\/api\/payments\/([A-Za-z]+)\/([^/]+)$/.exec(path);
  if (one) {
    const product = parseProduct(one[1]);
    if (product === undefined) return sendJson(res, 404, { error: `Unknown product '${one[1]}'.` });
    try {
      const payments = await factory.payments(product);
      if (method === 'GET') return sendJson(res, 200, view(await payments.get(decodeURIComponent(one[2] ?? ''))));
      if (method === 'DELETE') {
        await payments.cancel(decodeURIComponent(one[2] ?? ''));
        debug.info(`Payment ${one[2]} cancelled`);
        res.writeHead(204).end();
        return;
      }
    } catch (error) {
      const { status, message } = errorStatus(error);
      return sendJson(res, status, { error: message });
    }
  }

  send(res, 404, 'Not found', 'text/plain');
}

/** Bancontact calls this when a payment changes. Every call is logged, valid or not, with the Signature header and the exact body. */
async function handleCallback(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const body = await readBody(req);
  const text = body.toString('utf8');
  const analysis = analyseSignature(String(req.headers.signature ?? ''), body);
  const received = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : (v ?? '')]));
  try {
    // The exact bytes received: re-serialising a parsed body first would change them and break the signature.
    const verified = await factory.callbackVerifier().verifyAndParse(String(req.headers.signature ?? ''), body, path);
    callbacks.unshift({ receivedAt: new Date().toISOString(), requestId: verified.requestId, payload: verified.payload });
    callbacks.length = Math.min(callbacks.length, 100);
    debug.add({
      kind: 'callback',
      title: `Callback ${verified.payload.status} for ${verified.payload.paymentId}`,
      method: 'POST',
      url: path,
      status: 200,
      requestHeaders: received,
      requestBody: pretty(text) as string,
      rawRequestBody: text,
      analysis,
      responseBody: `Signature valid. Bancontact request ID: ${verified.requestId}`,
    });
    send(res, 200, '');
  } catch (error) {
    if (!(error instanceof InvalidCallbackError)) throw error;
    debug.add({ kind: 'callback', title: 'Callback rejected', method: 'POST', url: path, status: 401, requestHeaders: received, requestBody: pretty(text) as string, rawRequestBody: text, analysis, error: error.message });
    send(res, 401, '');
  }
}

async function qrRoute(url: URL, res: ServerResponse): Promise<void> {
  const q = {
    product: url.searchParams.get('product') ?? 'OnDisplay',
    kind: url.searchParams.get('kind') ?? 'fixed',
    amount: url.searchParams.get('amount') ?? '100',
    description: url.searchParams.get('description') ?? 'sample',
    reference: url.searchParams.get('reference') ?? '',
    posId: url.searchParams.get('posId') ?? 'POS00001',
    format: url.searchParams.get('format') ?? 'PNG',
  };
  if (!url.searchParams.has('product')) return send(res, 200, qrPage(PRODUCTS, q));

  try {
    const product = parseProduct(q.product) as BancontactProduct;
    const credentials = readCredentials();
    const ppid = credentials.products?.[product]?.merchantProfileId;
    if (!ppid) throw new ProductNotConfiguredError(product);
    const environment = credentials.environment ?? 'Preprod';
    const payloadUrl = q.kind === 'pos'
      ? qr.buildStaticQrLocationUrl(environment, ppid, q.posId)
      : qr.buildFixedAmountPaymentUrl(environment, ppid, {
        amountCents: Number(q.amount),
        ...(q.description ? { description: q.description } : {}),
        ...(q.reference ? { reference: q.reference } : {}),
      });
    const imageUrl = qr.buildQrCodeImageUrl(environment, payloadUrl, q.format === 'SVG' ? QrCodeImageFormat.Svg : QrCodeImageFormat.Png);
    debug.info(`QR payload built (${q.kind}, ${environment})`, `payload: ${payloadUrl}\nimage: ${imageUrl}`);
    send(res, 200, qrPage(PRODUCTS, q, { environment, payloadUrl, imageUrl }));
  } catch (error) {
    send(res, 200, qrPage(PRODUCTS, q, { error: error instanceof Error ? error.message : String(error) }));
  }
}

const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

async function staticFile(path: string, res: ServerResponse): Promise<void> {
  const file = normalize(join(publicDir, path));
  const type = TYPES[extname(file)];
  if (!file.startsWith(publicDir) || type === undefined) return send(res, 404, 'Not found', 'text/plain');
  try {
    send(res, 200, await readFile(file, 'utf8'), type);
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
}

createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    console.error(error);
    if (!res.headersSent) send(res, 500, 'Internal error', 'text/plain');
  });
}).listen(port, process.env.HOST ?? 'localhost', () => console.log(`Bancontact Pro sample UI on http://localhost:${port}`));
