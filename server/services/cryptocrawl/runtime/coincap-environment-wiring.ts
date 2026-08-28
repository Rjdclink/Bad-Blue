import logger from '../../../logger.js';

const KEY_ALIASES = [
  'COINCAP_API_KEY',
  'COINCAP_API_KEY_PROD',
  'COINCAP_API_KEY_PRODUCTION',
  'COINCAP_PROD_API_KEY',
  'COINCAP_PRODUCTION_API_KEY',
  'COINCAP_KEY',
  'COINCAP_API_TOKEN',
  'COINCAP_TOKEN',
] as const;

const BASE_URL_ALIASES = [
  'COINCAP_API_BASE_URL',
  'COINCAP_BASE_URL',
  'COINCAP_API_URL',
] as const;

let installed = false;

function normalizedValue(name: string): string | null {
  const raw = process.env[name];
  if (!raw) return null;
  let value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) value = value.slice(1, -1).trim();
  }
  return value || null;
}

function firstVisible(names: readonly string[]): { name: string; value: string } | null {
  for (const name of names) {
    const value = normalizedValue(name);
    if (value) return { name, value };
  }
  return null;
}

export function ensureCoinCapEnvironmentWiring(): void {
  if (installed) return;
  installed = true;

  const key = firstVisible(KEY_ALIASES);
  if (key && !normalizedValue('COINCAP_API_KEY')) process.env.COINCAP_API_KEY = key.value;

  const baseUrl = firstVisible(BASE_URL_ALIASES);
  if (baseUrl && !normalizedValue('COINCAP_API_BASE_URL')) process.env.COINCAP_API_BASE_URL = baseUrl.value;

  logger.info('[CoinCapEnvironmentWiring] Paid CoinCap credential resolution completed', {
    component: 'CoinCapEnvironmentWiring',
    configured: Boolean(key),
    source: key?.name || null,
    adoptedCanonical: Boolean(key && key.name !== 'COINCAP_API_KEY'),
    baseUrlConfigured: Boolean(baseUrl),
    baseUrlSource: baseUrl?.name || null,
    secretValuesLogged: false,
  });
}
