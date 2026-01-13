import { fetchJson, sleep } from '../lib/utils.js';

const BASE_URL = 'https://chatgpt.com/backend-anon/checkout_pricing_config';
const DELAY_MS = 100;

type PlanPricing = {
  amount: number;
  tax: 'inclusive' | 'exclusive';
};

type CurrencyConfig = {
  free?: { month?: PlanPricing };
  go?: { month?: PlanPricing };
  plus?: { month?: PlanPricing };
  pro?: { month?: PlanPricing };
  business?: { month?: PlanPricing; year?: PlanPricing };
  business_non_profit?: { month?: PlanPricing; year?: PlanPricing };
  symbol_code: string;
  symbol: string;
  minor_unit_exponent: number;
  tax_type: string;
};

type CountryConfig = {
  country_code: string;
  currency_config: CurrencyConfig;
};

type CountriesResponse = {
  countries: string[];
};

async function getCountries(): Promise<string[]> {
  const data = await fetchJson<CountriesResponse>(`${BASE_URL}/countries`);
  return data.countries;
}

async function getCountryConfig(countryCode: string): Promise<CountryConfig> {
  return fetchJson<CountryConfig>(`${BASE_URL}/configs/${countryCode}`);
}

function formatPrice(amount: number, symbol: string, exponent: number): string {
  const value = amount.toFixed(exponent);
  return `${symbol}${value}`;
}

function formatPlanPrice(
  plan: { month?: PlanPricing; year?: PlanPricing } | undefined,
  symbol: string,
  exponent: number,
): string {
  if (!plan) return '-';
  const parts: string[] = [];
  if (plan.month) {
    const price = formatPrice(plan.month.amount, symbol, exponent);
    const taxNote = plan.month.tax === 'exclusive' ? ' +tax' : '';
    parts.push(`${price}/mo${taxNote}`);
  }
  if (plan.year) {
    const price = formatPrice(plan.year.amount, symbol, exponent);
    const taxNote = plan.year.tax === 'exclusive' ? ' +tax' : '';
    parts.push(`${price}/yr${taxNote}`);
  }
  return parts.join(', ') || '-';
}

function formatCountryPrices(config: CountryConfig): string {
  const { currency_config: cc } = config;
  const parts: string[] = [];

  if (cc.go?.month) {
    parts.push(`Go: ${formatPrice(cc.go.month.amount, cc.symbol, cc.minor_unit_exponent)}`);
  }
  if (cc.plus?.month) {
    parts.push(`Plus: ${formatPrice(cc.plus.month.amount, cc.symbol, cc.minor_unit_exponent)}`);
  }
  if (cc.pro?.month) {
    parts.push(`Pro: ${formatPrice(cc.pro.month.amount, cc.symbol, cc.minor_unit_exponent)}`);
  }
  if (cc.business) {
    parts.push(`Business: ${formatPlanPrice(cc.business, cc.symbol, cc.minor_unit_exponent)}`);
  }

  return parts.join('; ') || '-';
}

export async function printChatGPTReport(): Promise<void> {
  const countries = await getCountries();

  for (const code of countries) {
    try {
      const config = await getCountryConfig(code);
      const prices = formatCountryPrices(config);
      console.log(`${code} (${config.currency_config.symbol_code}): ${prices}`);
    } catch (error) {
      console.log(`${code}: ERROR ${error instanceof Error ? error.message : String(error)}`);
    }
    await sleep(DELAY_MS);
  }
}
