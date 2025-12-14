export type Venue = 'binance' | 'kraken';
export type Pair = 'BTS-USDT' | 'ETH-USDT' | 'SOL-USDT';

export interface BaseCandidate {
  pair: Pair;
  notionalUsd: 200; // hard-locked
  buyVenue: Venue;
  sellVenue: Venue;
  buyBestBid: number;
  buyBestAsk: number;
  sellBestBid: number;
  sellBestAsk: number;
  pessimisticFeeRateBuy: number;  // maker+taker combined
  pessimisticFeeRateSell: number; // maker+taker combined
  computedAt: number;
}

export interface ActionEnvelope {
  dailyCapUsd: 200; // hard-locked
  notionalUsd: 200; // hard-locked
  allowedVenues: readonly Venue[];
  allowedPairs: readonly Pair[];
}

export interface DecisionObject {
  kind: 'crypto_decision';
  decisionId: string; // deterministic hash of normalized inputs
  computedAt: number;
  base: {
    decision: 'SIGNAL' | 'NO SIGNAL';
    candidate: BaseCandidate | null;
  };
  monteCarlo: {
    decision: 'NO SIGNAL' | { confidenceScore: number; expectedValueUSD: number };
  };
  aiConcurrence: {
    ok: boolean;
  };
  eligibility: {
    ok: boolean; // unanimous gate
  };
  envelope: ActionEnvelope;
}

