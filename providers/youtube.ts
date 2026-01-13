/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetch } from 'undici';

import { extractJsonVar, readText, walkJson } from '../lib/json-parser.js';
import { createProxyDispatcher, getProxyToken, type ProxyEndpoint, runCountryReport } from '../lib/proxy.js';
import { dedupeBy, formatPriceText, normalizeText, pickRandom, sleep, USER_AGENT } from '../lib/utils.js';

const MAX_PROXY_ATTEMPTS = 8;
const RETRY_DELAY_MS = 5_000;

type PlanPrice = { plan: string; billing?: string; price: string };

function extractYtInitialData(html: string): unknown {
  const json = extractJsonVar(html, 'ytInitialData');
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function deriveGroupLabel(title: string): string | undefined {
  const lower = title.toLowerCase();
  if (lower.includes('premium lite')) return 'Premium Lite';
  if (lower.includes('premium')) return 'Premium';
  return undefined;
}

function applyGroupLabel(plan: string, group?: string): string {
  if (!group || plan.toLowerCase().includes(group.toLowerCase())) return plan;
  return `${group} ${plan}`;
}

function parsePremiumPlansFromInitialData(data: unknown): PlanPrice[] {
  const sections: any[] = [];
  walkJson(data, (node) => {
    if (node && typeof node === 'object' && 'lpOfferCardSectionViewModel' in node) {
      sections.push((node as any).lpOfferCardSectionViewModel);
    }
  });

  const entries: PlanPrice[] = [];
  for (const section of sections) {
    const sectionTitle = normalizeText(readText(section?.title));
    const groupLabel = deriveGroupLabel(sectionTitle);
    const cards: any[] = section?.offerCards ?? [];

    for (const cardRef of cards) {
      const card = cardRef?.lpOfferCardViewModel ?? cardRef;
      const planRaw = normalizeText(readText(card?.title));
      if (!planRaw) continue;

      const plan = applyGroupLabel(planRaw, groupLabel);
      const options: any[] = card?.offerOptions ?? [];

      for (const optionRef of options) {
        const option = optionRef?.lpOfferCardOptionViewModel ?? optionRef;
        const price = formatPriceText(readText(option?.title));
        if (!price) continue;
        const billing = normalizeText(readText(option?.eyebrowText)) || undefined;
        entries.push({ plan, billing, price });
      }
    }
  }

  return entries.length
    ? dedupeBy(entries, (e) => `${e.plan}|${e.billing ?? ''}|${e.price}`)
    : parseOptionItemPlans(data);
}

function parseOptionItemPlans(data: unknown): PlanPrice[] {
  const entries: PlanPrice[] = [];
  walkJson(data, (node) => {
    if (node && typeof node === 'object' && 'optionItemRenderer' in node) {
      const item = (node as any).optionItemRenderer;
      const plan = normalizeText(readText(item?.title));
      if (!plan) return;

      const subtitle = normalizeText(readText(item?.subtitle));
      const priceMatches = subtitle.match(/\$\s*\d+(?:[.,]\d{2})?/g) ?? [];
      let price = priceMatches.length ? formatPriceText(priceMatches[priceMatches.length - 1]) : '';
      if (price && /\/\s*month\b|per\s+month\b/i.test(subtitle)) {
        price = `${price} per month`;
      }
      if (price) entries.push({ plan, price });
    }
  });
  return dedupeBy(entries, (e) => `${e.plan}|${e.billing ?? ''}|${e.price}`);
}

function formatPlanPrices(entries: PlanPrice[]): string[] {
  return entries.map(({ plan, billing, price }) => {
    const billingPart = billing ? ` (${billing})` : '';
    return `${plan}${billingPart} - ${price}`;
  });
}

function parsePremiumPrices(html: string): string[] {
  const data = extractYtInitialData(html);
  if (data) {
    const plans = parsePremiumPlansFromInitialData(data);
    if (plans.length) return formatPlanPrices(plans);
  }
  const priceRegex = /\$\s*\d+(?:[.,]\d{2})?/g;
  const matches = html.match(priceRegex) ?? [];
  return [...new Set(matches.map((m) => m.trim()))];
}

async function fetchPremiumPricesViaProxies(securityTokenValue: string, proxies: ProxyEndpoint[]): Promise<string[]> {
  if (!proxies.length) throw new Error('No proxy endpoints available');

  const maxAttempts = Math.min(MAX_PROXY_ATTEMPTS, proxies.length);
  const triedProxies = new Set<string>();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const remaining = proxies.filter((p) => !triedProxies.has(`${p.host}:${p.port}`));
    if (!remaining.length) break;
    const proxy = pickRandom(remaining);
    triedProxies.add(`${proxy.host}:${proxy.port}`);

    const proxyToken = await getProxyToken(securityTokenValue, proxy.signature);
    const dispatcher = createProxyDispatcher(proxy, proxyToken.value);

    const res = await fetch('https://www.youtube.com/premium', {
      dispatcher,
      headers: { 'accept-language': 'en-US,en;q=0.9', 'user-agent': USER_AGENT },
    });

    if (res.ok) {
      return parsePremiumPrices(await res.text());
    }
    await sleep(RETRY_DELAY_MS);
  }
  return [];
}

export async function printYtPricesReport(): Promise<void> {
  await runCountryReport(fetchPremiumPricesViaProxies, (prices) => (prices.length ? prices.join('; ') : null));
}
