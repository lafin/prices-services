/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ProxyAgent } from 'undici';

import { dedupeBy, fetchJson, normalizeText } from './utils.js';

const { CLIENT_APP = 'app', API, STATS_API } = process.env;

function getApiUrl(): string {
  if (!API) throw new Error('Missing required environment variable: API');
  return API;
}

function getStatsApiUrl(): string {
  if (!STATS_API) throw new Error('Missing required environment variable: STATS_API');
  return STATS_API;
}
const BROWSER = 'CHROME';
const TOKEN_CACHE_FILE = new URL('../.cache/token.json', import.meta.url);
const TOKEN_CACHE_GRACE_MS = 10 * 60_000;
const TOKEN_CACHE_FALLBACK_TTL_MS = 55 * 60_000;

export type Token = { value: string; expirationTime?: number; expired?: boolean };
export type ProxyEndpoint = { host: string; port: number; signature: string };
export type CountryEntry = {
  title?: string;
  code?: { iso2?: string; iso3?: string };
  accessType?: string;
  servers?: { elements?: any[] };
};

type TokenCache = { authToken: string; securityToken: Token; cachedAt: number };

function isTokenFresh(token: Token, cachedAt: number): boolean {
  if (token.expired) return false;
  if (typeof token.expirationTime === 'number' && Number.isFinite(token.expirationTime)) {
    return token.expirationTime - Date.now() > TOKEN_CACHE_GRACE_MS;
  }
  return cachedAt + TOKEN_CACHE_FALLBACK_TTL_MS > Date.now();
}

function isValidTokenCache(parsed: unknown): parsed is TokenCache {
  if (!parsed || typeof parsed !== 'object') return false;
  const cache = parsed as Record<string, unknown>;
  return (
    typeof cache.authToken === 'string' &&
    !!cache.authToken &&
    typeof cache.cachedAt === 'number' &&
    !!cache.securityToken &&
    typeof cache.securityToken === 'object' &&
    typeof (cache.securityToken as Token).value === 'string' &&
    !!(cache.securityToken as Token).value
  );
}

async function readTokenCache(): Promise<TokenCache | null> {
  try {
    const raw = await readFile(TOKEN_CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return isValidTokenCache(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeTokenCache(authToken: string, securityToken: Token): Promise<void> {
  const cachePath = fileURLToPath(TOKEN_CACHE_FILE);
  await mkdir(dirname(cachePath), { recursive: true });
  const payload: TokenCache = { authToken, securityToken, cachedAt: Date.now() };
  await writeFile(TOKEN_CACHE_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

async function registerAnonymous(): Promise<string> {
  const url = `${getApiUrl()}/registrations/clientApps/${CLIENT_APP}/users/anonymous`;
  const data = await fetchJson<any>(url, {
    method: 'POST',
    body: { clientApp: { name: CLIENT_APP, browser: BROWSER } },
  });
  if (typeof data === 'string') return data;
  if (data?.value) return String(data.value);
  throw new Error(`Unexpected anonymous registration response: ${JSON.stringify(data)}`);
}

async function getSecurityToken(authToken: string): Promise<Token> {
  const url = `${getApiUrl()}/security/tokens/accs`;
  const data = await fetchJson<Token>(url, {
    method: 'POST',
    body: { type: 'accs', clientApp: { name: CLIENT_APP } },
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!data?.value) throw new Error(`Unexpected security token response: ${JSON.stringify(data)}`);
  return data;
}

export async function getCachedAuthAndSecurityTokens(): Promise<{ authToken: string; securityToken: Token }> {
  const cached = await readTokenCache();
  if (cached && isTokenFresh(cached.securityToken, cached.cachedAt)) {
    return { authToken: cached.authToken, securityToken: cached.securityToken };
  }

  if (cached?.authToken) {
    try {
      const securityToken = await getSecurityToken(cached.authToken);
      await writeTokenCache(cached.authToken, securityToken);
      return { authToken: cached.authToken, securityToken };
    } catch {
      // Security token refresh failed, will re-register
    }
  }

  const authToken = await registerAnonymous();
  const securityToken = await getSecurityToken(authToken);
  await writeTokenCache(authToken, securityToken);
  return { authToken, securityToken };
}

export async function getCountries(securityTokenValue: string): Promise<CountryEntry[]> {
  const url = `${getStatsApiUrl()}/entrypoints/countries`;
  const root = await fetchJson<any>(url, {
    headers: {
      'X-Client-App': CLIENT_APP,
      Accept: 'application/json',
      pragma: 'no-cache',
      'cache-control': 'no-cache',
      Authorization: `Bearer ${securityTokenValue}`,
    },
  });
  return root?.countries?.elements ?? [];
}

export function getCountryProxyEndpoints(country: CountryEntry): ProxyEndpoint[] {
  const endpoints: ProxyEndpoint[] = [];
  const servers: any[] = country?.servers?.elements ?? [];

  for (const s of servers) {
    const signature = String(s?.signature ?? '');
    if (!signature) continue;

    const addresses = [s?.address?.primary, ...(s?.address?.secondary ?? [])];
    for (const addr of addresses) {
      if (addr?.host && addr?.port) {
        endpoints.push({ host: String(addr.host), port: Number(addr.port), signature });
      }
    }
  }

  return dedupeBy(endpoints, (e) => `${e.host}:${e.port}:${e.signature}`);
}

export async function getProxyToken(securityTokenValue: string, signature: string): Promise<Token> {
  const url = `${getApiUrl()}/security/tokens/accs-proxy`;
  const data = await fetchJson<Token>(url, {
    method: 'POST',
    body: { type: 'accs-proxy', clientApp: { name: CLIENT_APP }, signature },
    headers: { Authorization: `Bearer ${securityTokenValue}` },
  });
  if (!data?.value) throw new Error(`Unexpected proxy token response: ${JSON.stringify(data)}`);
  return data;
}

export function createProxyDispatcher(proxy: ProxyEndpoint, tokenValue: string): ProxyAgent {
  const proxyUrl = new URL(`http://${proxy.host}:${proxy.port}`);
  proxyUrl.username = tokenValue;
  proxyUrl.password = '1';
  return new ProxyAgent(proxyUrl.toString());
}

export function formatCountryLabel(country: CountryEntry): string {
  const name = normalizeText(String(country?.title ?? '')) || 'Unknown';
  const iso2 = normalizeText(String(country?.code?.iso2 ?? '')).toUpperCase();
  return iso2 ? `${name} (${iso2})` : name;
}

export async function runCountryReport<T>(
  fetchFn: (securityTokenValue: string, proxies: ProxyEndpoint[]) => Promise<T>,
  formatFn: (result: T) => string | null,
): Promise<void> {
  const { securityToken } = await getCachedAuthAndSecurityTokens();
  const countries = await getCountries(securityToken.value);

  for (const country of countries) {
    const label = formatCountryLabel(country);
    const proxies = getCountryProxyEndpoints(country);

    if (!proxies.length || country?.accessType === 'INACCESSIBLE') {
      console.log(`${label}: SKIP (no accessible servers)`);
      continue;
    }

    try {
      const result = await fetchFn(securityToken.value, proxies);
      const formatted = formatFn(result);
      if (formatted) console.log(`${label}: ${formatted}`);
    } catch (error) {
      console.log(`${label}: ERROR ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
