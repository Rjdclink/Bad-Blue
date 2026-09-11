import { createHash, createHmac } from 'crypto';
import { isDatabaseConfigured } from '../../../db.js';
import {
  isCoordinationDatabaseConfigured,
  withDatabaseSessionAdvisoryLock,
} from '../runtime/database-coordination.js';

export type KrakenFundingHttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type KrakenFundingScalar = string | number | boolean;
export type KrakenFundingQueryValue = KrakenFundingScalar | null | undefined | Record<string, KrakenFundingScalar | null | undefined>;

const KRAKEN_FUNDING_TIMEOUT_MS = Math.max(3_000, Number(process.env.CRYPTO_KRAKEN_FUNDING_TIMEOUT_MS || process.env.CRYPTO_KRAKEN_PRIVATE_TIMEOUT_MS || 12_000));
const KRAKEN_LOCK_ACQUIRE_TIMEOUT_MS = Math.max(250, Math.min(30_000, Number(process.env.CRYPTO_KRAKEN_LOCK_ACQUIRE_TIMEOUT_MS || 6_000)));
let fundingTail: Promise<void> = Promise.resolve();

function credential(name: string): string | null {
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

function requireCredential(name: string): string {
  const value = credential(name);
  if (!value) throw new Error(`${name} is not visible to the Kraken funding authority`);
  return value;
}

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function queryString(parameters: Record<string, KrakenFundingQueryValue> = {}): string {
  const pairs: Array<[string, string]> = [];
  const append = (name: string, value: KrakenFundingQueryValue): void => {
    if (value === null || value === undefined) return;
    if (typeof value === 'object') {
      for (const [child, childValue] of Object.entries(value)) append(`${name}[${child}]`, childValue);
      return;
    }
    pairs.push([name, typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value)]);
  };
  for (const [name, value] of Object.entries(parameters)) append(name, value);
  const params = new URLSearchParams();
  for (const [name, value] of pairs) params.append(name, value);
  return params.toString();
}

function signature(input: {
  signedPath: string;
  nonce: string;
  body: string;
  secret: Buffer;
}): string {
  const digest = createHash('sha256')
    .update(Buffer.concat([Buffer.from(input.nonce), Buffer.from(input.body)]))
    .digest();
  return createHmac('sha512', input.secret)
    .update(Buffer.concat([Buffer.from(input.signedPath), digest]))
    .digest('base64');
}

async function parseResponse(response: Response): Promise<any> {
  const text = await response.text();
  let payload: any;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Kraken Funding endpoint returned non-JSON (${response.status})`);
  }
  if (!response.ok) {
    const detail = payload?.message || payload?.error || payload?.code || response.status;
    throw new Error(`Kraken Funding request failed (${response.status}): ${String(detail)}`);
  }
  if (Array.isArray(payload?.error) && payload.error.length > 0) {
    throw new Error(`Kraken Funding request failed: ${payload.error.join(', ')}`);
  }
  return payload;
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const run = fundingTail.catch(() => undefined).then(operation);
  fundingTail = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * Kraken nonce ordering is API-key-wide. Funding Beta uses a different signature
 * format than /0/private, but it deliberately shares the exact same durable nonce
 * table and advisory-lock name as cex-private-authority.ts. There is no local
 * fallback: if the shared coordination authority is unavailable, funding fails
 * route-locally rather than creating a second nonce lane.
 */
export async function krakenFundingBetaRequest(
  method: KrakenFundingHttpMethod,
  path: string,
  options: {
    query?: Record<string, KrakenFundingQueryValue>;
    body?: Record<string, unknown>;
    timeoutMs?: number;
  } = {},
): Promise<any> {
  if (!path.startsWith('/funding/')) throw new Error('Kraken Funding authority accepts /funding/* paths only');
  if (!isDatabaseConfigured || !isCoordinationDatabaseConfigured) {
    throw new Error('Kraken Funding requires the canonical distributed nonce coordination database; local nonce fallback is forbidden');
  }

  return serialize(async () => {
    const apiKey = requireCredential('KRAKEN_API_KEY');
    const apiSecret = requireCredential('KRAKEN_API_SECRET');
    const decodedSecret = Buffer.from(apiSecret, 'base64');
    if (decodedSecret.length === 0) throw new Error('Kraken API secret is not valid base64');
    const keyHash = fingerprint(apiKey);
    const lockName = `cryptocrawl:kraken-private:${keyHash}`;

    return withDatabaseSessionAdvisoryLock(lockName, async client => {
      const proposed = String(Date.now());
      const allocated = await client.query(
        `INSERT INTO private.cryptocrawler_kraken_nonce_state (key_hash, last_nonce, updated_at)
         VALUES ($1, $2::bigint, now())
         ON CONFLICT (key_hash) DO UPDATE
         SET last_nonce = GREATEST(private.cryptocrawler_kraken_nonce_state.last_nonce + 1, EXCLUDED.last_nonce),
             updated_at = now()
         RETURNING last_nonce`,
        [keyHash, proposed],
      );
      const nonce = String(allocated.rows?.[0]?.last_nonce || '');
      if (!/^\d+$/.test(nonce)) throw new Error('Distributed Kraken Funding nonce allocation failed');

      const query = queryString(options.query);
      const signedPath = query ? `${path}?${query}` : path;
      const body = options.body === undefined ? '' : JSON.stringify(options.body);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? KRAKEN_FUNDING_TIMEOUT_MS);
      try {
        const response = await fetch(`https://api.kraken.com${signedPath}`, {
          method,
          headers: {
            'API-Key': apiKey,
            'API-Sign': signature({ signedPath, nonce, body, secret: decodedSecret }),
            'API-Nonce': nonce,
            Accept: 'application/json',
            ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: options.body === undefined ? undefined : body,
          signal: controller.signal,
        });
        return await parseResponse(response);
      } finally {
        clearTimeout(timeout);
      }
    }, { acquireTimeoutMs: KRAKEN_LOCK_ACQUIRE_TIMEOUT_MS });
  });
}
