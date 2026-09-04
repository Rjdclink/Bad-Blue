import { getOkxExecutionRestBaseUrl, okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import { cexDecimalString } from './cex-order-serialization.js';

interface BookLevel { price: number; size: number }

export interface OkxFundingExecutionEvidence {
  spotInstId: string;
  swapInstId: string;
  baseAsset: string;
  quoteAsset: string;
  contracts: number;
  baseQuantity: number;
  contractBaseQuantity: number;
  spotEntryLimit: number;
  perpEntryLimit: number;
  spotExitLimit: number;
  perpExitLimit: number;
  entryBasisBps: number;
  exitBasisReserveBps: number;
  expectedSlippageBps: number;
  maxSellContracts: number;
  accountPositionMode: string;
  marginMode: 'cross';
  measuredAt: number;
  expiresAt: number;
  provenance: string[];
}

function finitePositive(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseLevels(raw: unknown): BookLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row: any) => {
    const price = finitePositive(row?.[0]);
    const size = finitePositive(row?.[1]);
    return price && size ? [{ price, size }] : [];
  });
}

async function publicBook(instId: string): Promise<{ bids: BookLevel[]; asks: BookLevel[]; observedAt: number } | null> {
  const baseUrl = await getOkxExecutionRestBaseUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(2_000, Number(process.env.CRYPTOCRAWL_FUNDING_BOOK_TIMEOUT_MS || 5_000)));
  try {
    const response = await fetch(`${baseUrl}/api/v5/market/books?instId=${encodeURIComponent(instId)}&sz=50`, { signal: controller.signal });
    const payload: any = await response.json().catch(() => null);
    const row = response.ok && payload?.code === '0' ? payload?.data?.[0] : null;
    if (!row) return null;
    const bids = parseLevels(row.bids);
    const asks = parseLevels(row.asks);
    if (bids.length === 0 || asks.length === 0) return null;
    const observedAt = Number(row.ts) || Date.now();
    return { bids, asks, observedAt };
  } finally {
    clearTimeout(timeout);
  }
}

function vwap(levels: readonly BookLevel[], quantity: number): number | null {
  if (!(quantity > 0)) return null;
  let remaining = quantity;
  let consideration = 0;
  for (const level of levels) {
    const take = Math.min(remaining, level.size);
    consideration += take * level.price;
    remaining -= take;
    if (remaining <= 1e-12) break;
  }
  return remaining <= 1e-9 ? consideration / quantity : null;
}

function floorToStep(value: number, step: number): number {
  if (!(value > 0) || !(step > 0)) return 0;
  return Math.floor((value + 1e-12) / step) * step;
}

function bps(a: number, b: number): number {
  return b > 0 ? Math.abs(a - b) / b * 10_000 : Number.POSITIVE_INFINITY;
}

/**
 * Measures one executable long-spot/short-perp OKX hedge. This is execution
 * evidence only; it does not decide whether projected funding is canonical
 * deterministic revenue.
 */
export async function measureOkxFundingExecutionEvidence(input: {
  symbol: string;
  swapInstId: string;
  targetNotionalUsd: number;
}): Promise<OkxFundingExecutionEvidence | null> {
  const symbol = input.symbol.trim().toUpperCase();
  const match = symbol.match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  if (!match || !(input.targetNotionalUsd > 0)) return null;
  const baseAsset = match[1];
  const quoteAsset = match[2];
  const spotInstId = `${baseAsset}-${quoteAsset}`;
  const swapInstId = input.swapInstId.trim().toUpperCase();

  const [spotBook, swapBook, instruments, accountConfig, maxSize] = await Promise.all([
    publicBook(spotInstId),
    publicBook(swapInstId),
    okxPrivateRequest('/api/v5/account/instruments', 'GET', { instType: 'SWAP', instId: swapInstId }, { lane: 'account_read' }),
    okxPrivateRequest('/api/v5/account/config', 'GET', {}, { lane: 'account_read' }),
    okxPrivateRequest('/api/v5/account/max-size', 'GET', { instId: swapInstId, tdMode: 'cross' }, { lane: 'account_read' }),
  ]);
  if (!spotBook || !swapBook) return null;
  const instrument = instruments.data.find(row => String(row?.instId || '').toUpperCase() === swapInstId) || instruments.data[0];
  if (!instrument || !['live', 'post_only'].includes(String(instrument.state || '').toLowerCase())) return null;
  const ctVal = finitePositive(instrument.ctVal);
  const lotSz = finitePositive(instrument.lotSz) ?? 1;
  const minSz = finitePositive(instrument.minSz) ?? lotSz;
  const ctValCcy = String(instrument.ctValCcy || '').trim().toUpperCase();
  if (!ctVal || ctValCcy !== baseAsset) return null;

  const spotAsk = spotBook.asks[0].price;
  const rawContracts = input.targetNotionalUsd / (spotAsk * ctVal);
  const contracts = floorToStep(rawContracts, lotSz);
  if (contracts < minSz) return null;
  const baseQuantity = contracts * ctVal;
  const contractBaseQuantity = contracts * ctVal;

  const spotEntry = vwap(spotBook.asks, baseQuantity);
  const spotExit = vwap(spotBook.bids, baseQuantity);
  const perpEntry = vwap(swapBook.bids, contracts);
  const perpExit = vwap(swapBook.asks, contracts);
  if (!spotEntry || !spotExit || !perpEntry || !perpExit) return null;

  const config = accountConfig.data[0] || {};
  const posMode = String(config.posMode || '').trim();
  // The lifecycle uses reduceOnly in net mode. Long/short position mode requires
  // posSide-specific state and is intentionally not silently guessed.
  if (posMode && posMode !== 'net_mode') return null;
  const max = maxSize.data[0] || {};
  const maxSellContracts = Number(max.maxSell ?? max.maxSellSz ?? 0);
  if (!Number.isFinite(maxSellContracts) || maxSellContracts < contracts) return null;

  const spotMid = (spotBook.bids[0].price + spotBook.asks[0].price) / 2;
  const perpMid = (swapBook.bids[0].price + swapBook.asks[0].price) / 2;
  const entryBasisBps = bps(perpMid, spotMid);
  const exitBasisReserveBps = bps(perpExit, spotExit);
  const expectedSlippageBps = [
    Math.max(0, (spotEntry - spotBook.asks[0].price) / spotBook.asks[0].price * 10_000),
    Math.max(0, (swapBook.bids[0].price - perpEntry) / swapBook.bids[0].price * 10_000),
    Math.max(0, (spotBook.bids[0].price - spotExit) / spotBook.bids[0].price * 10_000),
    Math.max(0, (perpExit - swapBook.asks[0].price) / swapBook.asks[0].price * 10_000),
  ].reduce((sum, value) => sum + value, 0);
  const measuredAt = Math.min(spotBook.observedAt, swapBook.observedAt);
  const maxAgeMs = Math.max(250, Number(process.env.CRYPTOCRAWL_FUNDING_EXECUTION_EVIDENCE_MAX_AGE_MS || 2_000));

  return {
    spotInstId,
    swapInstId,
    baseAsset,
    quoteAsset,
    contracts,
    baseQuantity,
    contractBaseQuantity,
    spotEntryLimit: spotEntry,
    perpEntryLimit: perpEntry,
    spotExitLimit: spotExit,
    perpExitLimit: perpExit,
    entryBasisBps,
    exitBasisReserveBps,
    expectedSlippageBps,
    maxSellContracts,
    accountPositionMode: posMode || 'net_mode',
    marginMode: 'cross',
    measuredAt,
    expiresAt: measuredAt + maxAgeMs,
    provenance: [
      'okx_public_spot_depth:vwap',
      'okx_public_swap_depth:vwap_contract_units',
      'okx_authenticated_swap_instrument_contract_value',
      'okx_authenticated_account_position_mode',
      'okx_authenticated_max_size',
      `spot_entry_limit:${cexDecimalString(spotEntry)}`,
      `perp_entry_limit:${cexDecimalString(perpEntry)}`,
    ],
  };
}
