const GEOBLOCK_URL = 'https://polymarket.com/api/geoblock';
const TTL_MS = Math.max(5_000, Math.min(60_000, Number(process.env.CRYPTOCRAWL_POLYMARKET_GEOBLOCK_TTL_MS || 15_000)));
const TIMEOUT_MS = Math.max(1_000, Math.min(10_000, Number(process.env.CRYPTOCRAWL_POLYMARKET_GEOBLOCK_TIMEOUT_MS || 3_000)));

export interface PolymarketGeographicEligibility {
  eligible: boolean;
  blocked: boolean | null;
  country: string | null;
  region: string | null;
  observedAt: number;
  expiresAt: number;
  provenance: string[];
}

let cached: PolymarketGeographicEligibility | null = null;
let inFlight: Promise<PolymarketGeographicEligibility> | null = null;

function normalizeCode(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return text && /^[A-Z0-9-]{1,12}$/.test(text) ? text : null;
}

async function collect(): Promise<PolymarketGeographicEligibility> {
  const now = Date.now();
  try {
    const response = await fetch(GEOBLOCK_URL, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`POLYMARKET_GEOBLOCK_HTTP_${response.status}`);
    const payload = await response.json() as any;
    if (typeof payload?.blocked !== 'boolean') throw new Error('POLYMARKET_GEOBLOCK_RESPONSE_INVALID');
    const blocked = payload.blocked === true;
    return {
      eligible: !blocked,
      blocked,
      country: normalizeCode(payload?.country),
      region: normalizeCode(payload?.region),
      observedAt: now,
      expiresAt: now + TTL_MS,
      provenance: [
        'polymarket_geoblock:official_endpoint',
        blocked ? 'polymarket_geoblock:blocked' : 'polymarket_geoblock:not_blocked',
        'geographic_restriction_bypass:false',
        'vpn_or_proxy_bypass:false',
      ],
    };
  } catch (error) {
    return {
      eligible: false,
      blocked: null,
      country: null,
      region: null,
      observedAt: now,
      expiresAt: now + Math.min(TTL_MS, 5_000),
      provenance: [
        'polymarket_geoblock:evidence_unavailable_fail_closed',
        `polymarket_geoblock_error:${error instanceof Error ? error.message : String(error)}`,
        'geographic_restriction_bypass:false',
      ],
    };
  }
}

export async function getPolymarketGeographicEligibility(forceRefresh = false): Promise<PolymarketGeographicEligibility> {
  const now = Date.now();
  if (!forceRefresh && cached && cached.expiresAt > now) return { ...cached, provenance: [...cached.provenance] };
  if (inFlight) return inFlight;
  inFlight = collect()
    .then(value => {
      cached = value;
      return { ...value, provenance: [...value.provenance] };
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

export async function requirePolymarketGeographicEligibility(forceRefresh = false): Promise<PolymarketGeographicEligibility> {
  const evidence = await getPolymarketGeographicEligibility(forceRefresh);
  if (!evidence.eligible) {
    const location = [evidence.country, evidence.region].filter(Boolean).join('-') || 'unknown';
    throw new Error(`POLYMARKET_GEOGRAPHIC_EXECUTION_NOT_ALLOWED:${location}`);
  }
  return evidence;
}
