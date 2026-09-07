import { createHash } from 'node:crypto';

export type EventOutcome = 'yes' | 'no';
export type EventOrderSide = 'buy' | 'sell';
export type EventOrderTimeInForce = 'fill_or_kill' | 'immediate_or_cancel' | 'good_till_canceled';

export interface EventContractSemantics {
  question: string;
  rules: string;
  outcomeDefinitionYes: string;
  outcomeDefinitionNo: string;
  settlementSource: string;
  cutoffAt: number;
  timezone: string;
  resolutionProcedure: string;
  voidTreatment: string;
  cancellationTreatment: string;
  payoutDefinition: string;
  settlementTiming: string;
}

export interface EventSemanticsFingerprint {
  question: string;
  rules: string;
  outcomes: string;
  settlementSource: string;
  cutoff: string;
  timezone: string;
  resolution: string;
  voidTreatment: string;
  cancellationTreatment: string;
  payout: string;
  settlementTiming: string;
  canonical: string;
}

export interface EventVenueMarket {
  venue: string;
  marketId: string;
  conditionId?: string | null;
  status: 'open' | 'paused' | 'closed' | 'settled' | 'unknown';
  semantics: EventContractSemantics;
  semanticsFingerprint: EventSemanticsFingerprint;
  observedAt: number;
  expiresAt: number;
  provenance: string[];
}

export interface EventVenueSizedQuote {
  venue: string;
  marketId: string;
  outcome: EventOutcome;
  side: EventOrderSide;
  contracts: number;
  complete: boolean;
  vwapPrice: number | null;
  worstPrice: number | null;
  notionalUsd: number | null;
  feeUsd: number | null;
  slippageUsd: number | null;
  observedAt: number;
  expiresAt: number;
  authenticated: boolean;
  provenance: string[];
}

export interface EventVenueAccountEvidence {
  venue: string;
  authenticated: boolean;
  accountAccessible: boolean;
  orderSubmissionAllowed: boolean;
  prefundedSystemOwnedUsd: number | null;
  systemOwnedProvenance: string[];
  feeEvidenceAuthenticated: boolean;
  observedAt: number;
  expiresAt: number;
  provenance: string[];
}

export interface EventVenueOrderRequest {
  clientOrderId: string;
  marketId: string;
  outcome: EventOutcome;
  side: EventOrderSide;
  contracts: number;
  limitPrice: number;
  timeInForce: EventOrderTimeInForce;
  postOnly: boolean;
  reduceOnly: boolean;
}

export interface EventVenueOrderState {
  venue: string;
  marketId: string;
  clientOrderId: string;
  orderId: string;
  status: 'pending' | 'open' | 'filled' | 'cancelled' | 'rejected' | 'unknown';
  filledContracts: number;
  averageFillPrice: number | null;
  realizedFeeUsd: number | null;
  terminal: boolean;
  observedAt: number;
  provenance: string[];
}

export interface EventVenueSettlement {
  venue: string;
  marketId: string;
  terminal: boolean;
  result: EventOutcome | 'void' | 'cancelled' | 'unknown';
  payoutPerWinningContractUsd: number | null;
  realizedSettlementFeeUsd: number | null;
  observedAt: number;
  provenance: string[];
}

/**
 * Venue-neutral prediction-event seam. Discovery may expose a venue adapter that
 * cannot submit orders yet, but any executor must require every execution method
 * and authenticated evidence before granting authority. This interface is never
 * an execution authority by itself.
 */
export interface EventVenue {
  readonly venue: string;
  getMarket(marketId: string): Promise<EventVenueMarket | null>;
  getSizedQuote(marketId: string, outcome: EventOutcome, side: EventOrderSide, contracts: number): Promise<EventVenueSizedQuote | null>;
  getAccountEvidence(): Promise<EventVenueAccountEvidence>;
  placeOrRecoverOrder(request: EventVenueOrderRequest): Promise<EventVenueOrderState>;
  getOrder(orderId: string): Promise<EventVenueOrderState | null>;
  cancelOrder(orderId: string): Promise<EventVenueOrderState | null>;
  getSettlement(marketId: string): Promise<EventVenueSettlement | null>;
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function hash(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

export function fingerprintEventSemantics(semantics: EventContractSemantics): EventSemanticsFingerprint {
  const normalized = {
    question: normalize(semantics.question),
    rules: normalize(semantics.rules),
    outcomeDefinitionYes: normalize(semantics.outcomeDefinitionYes),
    outcomeDefinitionNo: normalize(semantics.outcomeDefinitionNo),
    settlementSource: normalize(semantics.settlementSource),
    cutoffAt: Number(semantics.cutoffAt),
    timezone: normalize(semantics.timezone),
    resolutionProcedure: normalize(semantics.resolutionProcedure),
    voidTreatment: normalize(semantics.voidTreatment),
    cancellationTreatment: normalize(semantics.cancellationTreatment),
    payoutDefinition: normalize(semantics.payoutDefinition),
    settlementTiming: normalize(semantics.settlementTiming),
  };
  return {
    question: hash(normalized.question),
    rules: hash(normalized.rules),
    outcomes: hash([normalized.outcomeDefinitionYes, normalized.outcomeDefinitionNo]),
    settlementSource: hash(normalized.settlementSource),
    cutoff: hash(normalized.cutoffAt),
    timezone: hash(normalized.timezone),
    resolution: hash(normalized.resolutionProcedure),
    voidTreatment: hash(normalized.voidTreatment),
    cancellationTreatment: hash(normalized.cancellationTreatment),
    payout: hash(normalized.payoutDefinition),
    settlementTiming: hash(normalized.settlementTiming),
    canonical: hash(normalized),
  };
}

export interface EventSemanticEquivalenceResult {
  equivalent: boolean;
  mismatches: Array<keyof EventSemanticsFingerprint>;
  left: EventSemanticsFingerprint;
  right: EventSemanticsFingerprint;
}

export function compareEventSemantics(left: EventContractSemantics, right: EventContractSemantics): EventSemanticEquivalenceResult {
  const leftFingerprint = fingerprintEventSemantics(left);
  const rightFingerprint = fingerprintEventSemantics(right);
  const keys: Array<keyof EventSemanticsFingerprint> = [
    'question', 'rules', 'outcomes', 'settlementSource', 'cutoff', 'timezone', 'resolution',
    'voidTreatment', 'cancellationTreatment', 'payout', 'settlementTiming',
  ];
  const mismatches = keys.filter(key => leftFingerprint[key] !== rightFingerprint[key]);
  return { equivalent: mismatches.length === 0, mismatches, left: leftFingerprint, right: rightFingerprint };
}
