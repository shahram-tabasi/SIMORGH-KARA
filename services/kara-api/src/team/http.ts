// A small JSON-over-HTTP helper for the Team Platform clients (Plane,
// Mattermost): a timeout, the method and path in every error, and never the
// credentials.

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly body?: unknown) {
    super(message);
  }
}

export interface JsonClientOptions {
  baseUrl: string;
  headers: () => Record<string, string>;
  timeoutMs: number;
  /** For error messages: "plane", "mattermost". */
  name: string;
}

export async function requestJson<T>(o: JsonClientOptions, method: string, path: string, body?: unknown): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${o.baseUrl}${path}`, {
      method,
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...o.headers() },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    const why = (e as Error).name === 'AbortError' ? `timed out after ${o.timeoutMs} ms` : (e as Error).message;
    throw new HttpError(0, `${o.name} ${method} ${path}: ${why}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  if (!res.ok) {
    const detail = typeof parsed === 'object' && parsed
      ? String((parsed as Record<string, unknown>).message ?? (parsed as Record<string, unknown>).error ?? (parsed as Record<string, unknown>).detail ?? text)
      : text;
    throw new HttpError(res.status, `${o.name} ${method} ${path}: ${res.status} ${detail.slice(0, 300)}`, parsed);
  }
  return parsed as T;
}
