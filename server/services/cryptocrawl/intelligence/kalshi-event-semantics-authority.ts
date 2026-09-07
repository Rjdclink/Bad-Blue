import { getKalshiApiOrigin } from './kalshi-authenticated-authority.js';
import {
  fingerprintEventSemantics,
  type EventContractSemantics,
  type EventSemanticsFingerprint,
} from '../discovery/event-venue.js';

export interface KalshiEventSemanticsEvidence {
  ticker: string;
  complete: boolean;
  semantics: EventContractSemantics | null;
  fingerprint: EventSemanticsFingerprint | null;
  missing: string[];
  observedAt: number;
  expiresAt: number;
  provenance: string[];
}

const TTL_MS = Math.max(2_000, Math.min(60_000, Number(process.env.CRYPTOCRAWL_KALSHI_EVENT_SEMANTICS_TTL_MS || 15_000)));
const cache = new Map<string, KalshiEventSemanticsEvidence>();

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function timestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 10_000_000_000 ? Math.trunc(value * 1_000) : Math.trunc(value);
  }
  const raw = text(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstText(row: any, keys: string[]): string {
  for (const key of keys) {
    const value = text(row?.[key]);
    if (value) return value;
  }
  return '';
}

function explicitTimezone(row: any): string {
  return firstText(row, ['timezone', 'time_zone', 'settlement_timezone', 'resolution_timezone']);
}

function explicitResolution(row: any): string {
  return firstText(row, [
    'resolution_procedure',
    'settlement_terms',
    'settlement_value_determination',
    'early_close_condition',
  ]);
}

function explicitSettlementSource(row: any): string {
  return firstText(row, [
    'settlement_source',
    'settlement_sources',
    'settlement_source_url',
    'resolution_source',
    'result_source',
  ]);
}

function explicitVoidTreatment(row: any): string {
  return firstText(row, ['void_treatment', 'void_policy', 'void_rule']);
}

function explicitCancellationTreatment(row: any): string {
  return firstText(row, ['cancellation_treatment', 'cancellation_policy', 'cancel_rule']);
}

function explicitPayout(row: any): string {
  return firstText(row, ['payout_definition', 'payout_rule', 'settlement_payout']);
}

function explicitSettlementTiming(row: any): string {
  const settlementTimer = firstText(row, ['settlement_timer_seconds', 'settlement_timer', 'settlement_delay_seconds']);
  const latestExpiration = firstText(row, ['latest_expiration_time', 'expected_expiration_time']);
  return [settlementTimer, latestExpiration].filter(Boolean).join(' | ');
}

async function publicMarket(ticker: string): Promise<any | null> {
  const path = `/trade-api/v2/markets/${encodeURIComponent(ticker)}`;
  const response = await fetch(`${getKalshiApiOrigin()}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return null;
  const payload = await response.json() as any;
  return payload?.market ?? payload ?? null;
}

function clone(value: KalshiEventSemanticsEvidence): KalshiEventSemanticsEvidence {
  return {
    ...value,
    semantics: value.semantics ? { ...value.semantics } : null,
    fingerprint: value.fingerprint ? { ...value.fingerprint } : null,
    missing: [...value.missing],
    provenance: [...value.provenance],
  };
}

export async function getKalshiEventSemanticsEvidence(ticker: string, forceRefresh = false): Promise<KalshiEventSemanticsEvidence> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const now = Date.now();
  const prior = cache.get(normalizedTicker);
  if (!forceRefresh && prior && prior.expiresAt > now) return clone(prior);

  const row = normalizedTicker ? await publicMarket(normalizedTicker).catch(() => null) : null;
  if (!row) {
    const missingEvidence: KalshiEventSemanticsEvidence = {
      ticker: normalizedTicker,
      complete: false,
      semantics: null,
      fingerprint: null,
      missing: ['required:kalshi_market_rules_document'],
      observedAt: now,
      expiresAt: now + TTL_MS,
      provenance: ['kalshi_market_semantics:public_exact_market_fetch_failed', 'execution_authority:false'],
    };
    cache.set(normalizedTicker, missingEvidence);
    return clone(missingEvidence);
  }

  const question = [text(row?.title), text(row?.subtitle)].filter(Boolean).join(' — ');
  const rules = [text(row?.rules_primary), text(row?.rules_secondary)].filter(Boolean).join(' | ');
  const yes = firstText(row, ['yes_sub_title', 'yes_subtitle', 'yes_title']);
  const no = firstText(row, ['no_sub_title', 'no_subtitle', 'no_title']);
  const settlementSource = explicitSettlementSource(row);
  const cutoffAt = timestamp(row?.expected_expiration_time ?? row?.latest_expiration_time ?? row?.occurrence_datetime);
  const timezone = explicitTimezone(row);
  const resolutionProcedure = explicitResolution(row);
  const voidTreatment = explicitVoidTreatment(row);
  const cancellationTreatment = explicitCancellationTreatment(row);
  const payoutDefinition = explicitPayout(row);
  const settlementTiming = explicitSettlementTiming(row);

  const missing = [
    ...(!question ? ['required:question'] : []),
    ...(!rules ? ['required:rules'] : []),
    ...(!yes || !no ? ['required:outcome_definitions'] : []),
    ...(!settlementSource ? ['required:settlement_source'] : []),
    ...(!cutoffAt ? ['required:cutoff_deadline'] : []),
    ...(!timezone ? ['required:timezone'] : []),
    ...(!resolutionProcedure ? ['required:resolution_procedure'] : []),
    ...(!voidTreatment ? ['required:void_treatment'] : []),
    ...(!cancellationTreatment ? ['required:cancellation_treatment'] : []),
    ...(!payoutDefinition ? ['required:payout_definition'] : []),
    ...(!settlementTiming ? ['required:settlement_timing'] : []),
  ];

  const semantics: EventContractSemantics | null = missing.length === 0 && cutoffAt !== null ? {
    question,
    rules,
    outcomeDefinitionYes: yes,
    outcomeDefinitionNo: no,
    settlementSource,
    cutoffAt,
    timezone,
    resolutionProcedure,
    voidTreatment,
    cancellationTreatment,
    payoutDefinition,
    settlementTiming,
  } : null;
  const evidence: KalshiEventSemanticsEvidence = {
    ticker: normalizedTicker,
    complete: semantics !== null,
    semantics,
    fingerprint: semantics ? fingerprintEventSemantics(semantics) : null,
    missing,
    observedAt: now,
    expiresAt: now + TTL_MS,
    provenance: [
      'kalshi_market_semantics:exact_market_public_api',
      'semantic_fields:explicit_only_no_inference',
      'semantic_equivalence_requires_all_dimensions',
      'execution_authority:false',
    ],
  };
  cache.set(normalizedTicker, evidence);
  return clone(evidence);
}
