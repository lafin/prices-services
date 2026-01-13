import { fetch } from 'undici';

export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

export async function fetchJson<T>(
  url: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const { method = 'GET', body, headers = {} } = options;
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json', ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`${method} ${url} failed: ${res.status} ${res.statusText}\n${detail}`);
  }
  return data as T;
}

export function pickRandom<T>(arr: T[]): T {
  if (!arr.length) throw new Error('Cannot pick from empty array');
  return arr[Math.floor(Math.random() * arr.length)];
}

export function dedupeBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeText(text: string): string {
  return text
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\u2022/g, ';')
    .replace(/\s*;\s*/g, '; ')
    .replace(/\s+/g, ' ')
    .replace(/\s*\*+$/g, '')
    .trim();
}

export function formatPriceText(text: string): string {
  return normalizeText(text)
    .replace(/\/\s*month\b/gi, ' per month')
    .replace(/\/\s*person\b/gi, ' per person');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
