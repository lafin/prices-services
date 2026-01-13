import { fetch } from 'undici';

import { createProxyDispatcher, getProxyToken, type ProxyEndpoint, runCountryReport } from '../lib/proxy.js';
import { pickRandom, USER_AGENT } from '../lib/utils.js';

type Shapr3DPrice = { currencyCode: string; price: number; subscriptionPeriod: string };

function formatShapr3DPrices(prices: Shapr3DPrice[]): string {
  return ['monthly', 'yearly']
    .flatMap((period) => {
      const p = prices.find((x) => x.subscriptionPeriod === period);
      if (!p) return [];
      const label = period.charAt(0).toUpperCase() + period.slice(1);
      return `${label} - ${(p.price / 100).toFixed(2)} ${p.currencyCode}`;
    })
    .join(', ');
}

async function fetchShapr3DPricesViaProxy(securityTokenValue: string, proxy: ProxyEndpoint): Promise<Shapr3DPrice[]> {
  const proxyToken = await getProxyToken(securityTokenValue, proxy.signature);
  const dispatcher = createProxyDispatcher(proxy, proxyToken.value);

  const res = await fetch('https://prod.api.shapr3d.com/user-management/plans/web-prices', {
    dispatcher,
    headers: { Accept: 'application/json', 'user-agent': USER_AGENT },
  });

  if (!res.ok) throw new Error(`Shapr3D API failed: ${res.status}`);
  return (await res.json()) as Shapr3DPrice[];
}

export async function printShapr3DPricesReport(): Promise<void> {
  await runCountryReport(
    async (tokenValue, proxies) => fetchShapr3DPricesViaProxy(tokenValue, pickRandom(proxies)),
    (prices) => (prices.length ? formatShapr3DPrices(prices) : null),
  );
}
