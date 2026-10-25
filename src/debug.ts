import type { FetchLike } from '@dewall88/bancontactpro';

export interface DebugEntry {
  at: string;
  kind: 'request' | 'callback' | 'info';
  title: string;
  method?: string;
  url?: string;
  status?: number;
  elapsedMs?: number;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  /** The body exactly as received (not pretty-printed): the bytes a callback signature covers. */
  rawRequestBody?: string;
  /** What the sample worked out about a callback's Signature header, to show why a verification failed. */
  analysis?: string;
  responseHeaders: Record<string, string>;
  responseBody?: string;
  traceId?: string;
  spanId?: string;
  error?: string;
}

const CAPACITY = 300;

/** The most recent debug entries, newest first. */
export class DebugLog {
  private readonly entries: DebugEntry[] = [];

  add(entry: Partial<DebugEntry> & Pick<DebugEntry, 'kind' | 'title'>): void {
    this.entries.unshift({ at: new Date().toISOString(), requestHeaders: {}, responseHeaders: {}, ...entry });
    if (this.entries.length > CAPACITY) this.entries.length = CAPACITY;
  }

  info(title: string, body?: string): void {
    this.add({ kind: 'info', title, ...(body === undefined ? {} : { responseBody: body }) });
  }

  recent(): readonly DebugEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries.length = 0;
  }
}

export function pretty(text: string | undefined): string | undefined {
  if (!text?.trim()) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** "Bearer abcdef1234" becomes "Bearer ••••1234": enough to tell which key was used, not enough to reuse it. */
function maskAuthorization(value: string): string {
  const [scheme, token] = value.includes(' ') ? value.split(' ', 2) : [undefined, value];
  const masked = (token ?? '').length > 8 ? `••••${(token ?? '').slice(-4)}` : '••••';
  return scheme === undefined ? masked : `${scheme} ${masked}`;
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
    result[name] = name.toLowerCase() === 'authorization' ? maskAuthorization(value) : value;
  }
  return result;
}

function bodyText(body: RequestInit['body']): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  return '[binary body]';
}

function traceIds(responseBody: string | undefined): { traceId?: string; spanId?: string } {
  try {
    const parsed = JSON.parse(responseBody ?? '') as Record<string, unknown>;
    return {
      ...(typeof parsed.traceId === 'string' ? { traceId: parsed.traceId } : {}),
      ...(typeof parsed.spanId === 'string' ? { spanId: parsed.spanId } : {}),
    };
  } catch {
    return {};
  }
}

/**
 * A `fetch` that records every request and response in the debug log. The library accepts any fetch-compatible function
 * (`BancontactClientFactoryOptions.fetch`) and uses it for the API calls and for the JWKS fetches alike, and it adds the
 * Authorization and Signature headers before calling it, so the log shows the request as it goes out on the wire.
 */
export function debugFetch(log: DebugLog): FetchLike {
  return async (input, init) => {
    const started = performance.now();
    const method = init?.method ?? 'GET';
    const common = {
      kind: 'request' as const,
      title: `${method} ${new URL(input).pathname}`,
      method,
      url: input,
      requestHeaders: headersOf(init),
      ...(bodyText(init?.body) === undefined ? {} : { requestBody: pretty(bodyText(init?.body)) as string }),
    };

    let response: Response;
    try {
      response = await fetch(input, init);
    } catch (cause) {
      log.add({ ...common, elapsedMs: Math.round(performance.now() - started), error: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause) });
      throw cause;
    }

    // Read a clone, so the library can still read the body.
    const text = await response.clone().text();
    log.add({
      ...common,
      status: response.status,
      elapsedMs: Math.round(performance.now() - started),
      responseHeaders: Object.fromEntries([...response.headers] as [string, string][]),
      responseBody: pretty(text) as string,
      ...(response.ok ? {} : traceIds(text)),
    });
    return response;
  };
}
