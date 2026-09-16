import { BigNumber, Contract, ethers, providers } from 'ethers';
import { ghostWalletProviderMesh, type GhostWalletChain } from './ghost-wallet-provider-mesh.js';
import {
  ghostWalletPerformancePenalty,
  recordGhostWalletPerformance,
} from './ghost-wallet-performance-intelligence.js';
import { loadVerifiedGhostWalletVenues } from './ghost-wallet-work-ledger.js';

export type GhostWalletFundingKind = 'aave_v3' | 'morpho_blue' | 'balancer_v2' | 'erc3156';

export interface GhostWalletFundingSource {
  kind: GhostWalletFundingKind;
  chain: GhostWalletChain;
  address: string;
  label: string;
  provenance: string[];
}

export interface GhostWalletFundingQuote {
  kind: GhostWalletFundingKind;
  chain: GhostWalletChain;
  lender: string;
  asset: string;
  availableLiquidity: bigint;
  upstreamFee: bigint;
  feeBps: number;
  observedAt: number;
  providerIndex: number;
  providerLabel?: string | null;
  measurementLatencyMs?: number;
  provenance: string[];
}

const ERC20_ABI = ['function balanceOf(address account) view returns (uint256)'];
const ERC3156_ABI = [
  'function maxFlashLoan(address token) view returns (uint256)',
  'function flashFee(address token,uint256 amount) view returns (uint256)',
];
const AAVE_POOL_ABI = [
  'function FLASHLOAN_PREMIUM_TOTAL() view returns (uint128)',
  'function getReserveAToken(address asset) view returns (address)',
  'function ADDRESSES_PROVIDER() view returns (address)',
];
const AAVE_ADDRESSES_PROVIDER_ABI = ['function getPoolDataProvider() view returns (address)'];
const AAVE_DATA_PROVIDER_ABI = [
  'function getReserveTokensAddresses(address asset) view returns (address aTokenAddress,address stableDebtTokenAddress,address variableDebtTokenAddress)',
  'function getFlashLoanEnabled(address asset) view returns (bool)',
];
const BALANCER_VAULT_ABI = ['function getProtocolFeesCollector() view returns (address)'];
const BALANCER_FEES_ABI = ['function getFlashLoanFeePercentage() view returns (uint256)'];
const BPS = 10_000n;
const BALANCER_ONE = 10n ** 18n;

const AAVE_V3_DEFAULTS: Partial<Record<GhostWalletChain, string>> = {
  ethereum: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
  polygon: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  arbitrum: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  optimism: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  base: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
  bsc: '0x6807dc923806fE8Fd134338EABCA509979a7e0cB',
  avalanche: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
};

const MORPHO_BLUE_DEFAULTS: Partial<Record<GhostWalletChain, string>> = {
  ethereum: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
  base: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
  polygon: '0x1bF0c2541F820E775182832f06c0B7Fc27A25f67',
  arbitrum: '0x6c247b1F6182318877311737BaC0844bAa518F5e',
  optimism: '0xce95AfbB8EA029495c66020883F87aaE8864AF92',
};

const BALANCER_V2_DEFAULTS: Partial<Record<GhostWalletChain, string>> = {
  ethereum: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
  polygon: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
  arbitrum: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
};

interface ConfiguredSourceRow {
  chain?: unknown;
  kind?: unknown;
  address?: unknown;
  label?: unknown;
}

const resident = new Map<string, { expiresAt: number; quotes: GhostWalletFundingQuote[] }>();
const inFlight = new Map<string, Promise<GhostWalletFundingQuote[]>>();

function cacheTtlMs(): number {
  const configured = Number(process.env.GHOST_WALLET_FUNDING_EVIDENCE_TTL_MS || 1_500);
  return Number.isFinite(configured) ? Math.max(250, Math.min(10_000, Math.trunc(configured))) : 1_500;
}

function normalizeChain(value: unknown): GhostWalletChain | null {
  const chain = String(value || '').trim().toLowerCase() as GhostWalletChain;
  return ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc', 'avalanche'].includes(chain) ? chain : null;
}

function normalizeAddress(value: unknown): string | null {
  const raw = String(value || '').trim();
  return ethers.utils.isAddress(raw) ? ethers.utils.getAddress(raw) : null;
}

function feeBps(fee: bigint, amount: bigint): number {
  if (amount <= 0n) return Number.POSITIVE_INFINITY;
  return Number((fee * 10_000n * 1_000_000n) / amount) / 1_000_000;
}

function configuredSources(): GhostWalletFundingSource[] {
  const rows: ConfiguredSourceRow[] = (() => {
    const raw = process.env.GHOST_WALLET_FLASH_SOURCES_JSON?.trim();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();
  const sources: GhostWalletFundingSource[] = [];
  for (const row of rows) {
    const chain = normalizeChain(row.chain);
    const address = normalizeAddress(row.address);
    const kind = String(row.kind || '').trim().toLowerCase() as GhostWalletFundingKind;
    if (!chain || !address || !['aave_v3', 'morpho_blue', 'balancer_v2', 'erc3156'].includes(kind)) continue;
    sources.push({
      kind,
      chain,
      address,
      label: String(row.label || 'configured').slice(0, 128),
      provenance: ['ghost_wallet_flash_source:configured'],
    });
  }
  return sources;
}

async function sourcesForChain(chain: GhostWalletChain): Promise<GhostWalletFundingSource[]> {
  const result: GhostWalletFundingSource[] = [];
  const add = (kind: GhostWalletFundingKind, address: string | undefined, label: string, provenance: string) => {
    const normalized = normalizeAddress(address);
    if (!normalized) return;
    result.push({ kind, chain, address: normalized, label, provenance: [provenance] });
  };
  add('aave_v3', AAVE_V3_DEFAULTS[chain], 'Aave V3', 'ghost_builtin:aave_address_book');
  add('morpho_blue', MORPHO_BLUE_DEFAULTS[chain], 'Morpho Blue', 'ghost_builtin:morpho_official_deployment');
  add('balancer_v2', BALANCER_V2_DEFAULTS[chain], 'Balancer V2', 'ghost_builtin:balancer_v2_deployment');
  for (const source of configuredSources()) if (source.chain === chain) result.push(source);

  try {
    const venues = await loadVerifiedGhostWalletVenues(chain);
    for (const row of venues) {
      if (String(row.adapter || '') !== 'erc3156_flash_lender') continue;
      const address = normalizeAddress(row.address);
      if (!address) continue;
      result.push({
        kind: 'erc3156',
        chain,
        address,
        label: String(row.protocol || 'ERC-3156 lender').slice(0, 128),
        provenance: ['ghost_venue_registry:verified_erc3156_lender'],
      });
    }
  } catch {
    // Overflow venue lookup failure is route-local. Built-ins/configured sources remain available.
  }

  const unique = new Map<string, GhostWalletFundingSource>();
  for (const source of result) unique.set(`${source.kind}:${source.address.toLowerCase()}`, source);
  return [...unique.values()];
}

async function measureAave(input: {
  source: GhostWalletFundingSource;
  provider: providers.JsonRpcProvider;
  providerIndex: number;
  asset: string;
  amount: bigint;
}): Promise<GhostWalletFundingQuote | null> {
  const pool = new Contract(input.source.address, AAVE_POOL_ABI, input.provider);
  const code = await input.provider.getCode(input.source.address);
  if (code === '0x') return null;
  let aToken: string | null = null;
  let flashLoanEnabled: boolean | null = null;
  try {
    aToken = normalizeAddress(await pool.getReserveAToken(input.asset));
  } catch { /* data-provider fallback below */ }
  try {
    const providerAddress = normalizeAddress(await pool.ADDRESSES_PROVIDER());
    if (providerAddress) {
      const addressesProvider = new Contract(providerAddress, AAVE_ADDRESSES_PROVIDER_ABI, input.provider);
      const dataProviderAddress = normalizeAddress(await addressesProvider.getPoolDataProvider());
      if (dataProviderAddress) {
        const dataProvider = new Contract(dataProviderAddress, AAVE_DATA_PROVIDER_ABI, input.provider);
        if (!aToken) {
          const tokens = await dataProvider.getReserveTokensAddresses(input.asset);
          aToken = normalizeAddress(tokens.aTokenAddress ?? tokens[0]);
        }
        try { flashLoanEnabled = Boolean(await dataProvider.getFlashLoanEnabled(input.asset)); } catch { /* older deployments */ }
      }
    }
  } catch { /* reserve getter evidence may still be enough */ }
  if (!aToken || flashLoanEnabled === false) return null;
  const [liquidityRaw, premiumRaw] = await Promise.all([
    new Contract(input.asset, ERC20_ABI, input.provider).balanceOf(aToken) as Promise<BigNumber>,
    pool.FLASHLOAN_PREMIUM_TOTAL() as Promise<BigNumber>,
  ]);
  const liquidity = liquidityRaw.toBigInt();
  if (liquidity < input.amount) return null;
  const premium = premiumRaw.toBigInt();
  const fee = input.amount === 0n ? 0n : (input.amount * premium + BPS - 1n) / BPS;
  return {
    kind: 'aave_v3', chain: input.source.chain, lender: input.source.address, asset: input.asset,
    availableLiquidity: liquidity, upstreamFee: fee, feeBps: feeBps(fee, input.amount),
    observedAt: Date.now(), providerIndex: input.providerIndex,
    provenance: [...input.source.provenance, 'aave_flash_premium_live', 'aave_reserve_liquidity_live', `aave_flash_enabled:${flashLoanEnabled !== false}`],
  };
}

async function measureMorpho(input: {
  source: GhostWalletFundingSource;
  provider: providers.JsonRpcProvider;
  providerIndex: number;
  asset: string;
  amount: bigint;
}): Promise<GhostWalletFundingQuote | null> {
  const [code, liquidityRaw] = await Promise.all([
    input.provider.getCode(input.source.address),
    new Contract(input.asset, ERC20_ABI, input.provider).balanceOf(input.source.address) as Promise<BigNumber>,
  ]);
  if (code === '0x') return null;
  const liquidity = liquidityRaw.toBigInt();
  if (liquidity < input.amount) return null;
  return {
    kind: 'morpho_blue', chain: input.source.chain, lender: input.source.address, asset: input.asset,
    availableLiquidity: liquidity, upstreamFee: 0n, feeBps: 0, observedAt: Date.now(), providerIndex: input.providerIndex,
    provenance: [...input.source.provenance, 'morpho_flash_fee_zero_by_interface', 'morpho_token_balance_live'],
  };
}

async function measureBalancer(input: {
  source: GhostWalletFundingSource;
  provider: providers.JsonRpcProvider;
  providerIndex: number;
  asset: string;
  amount: bigint;
}): Promise<GhostWalletFundingQuote | null> {
  const vault = new Contract(input.source.address, BALANCER_VAULT_ABI, input.provider);
  const code = await input.provider.getCode(input.source.address);
  if (code === '0x') return null;
  const feeCollectorAddress = normalizeAddress(await vault.getProtocolFeesCollector());
  if (!feeCollectorAddress) return null;
  const [liquidityRaw, feeRaw] = await Promise.all([
    new Contract(input.asset, ERC20_ABI, input.provider).balanceOf(input.source.address) as Promise<BigNumber>,
    new Contract(feeCollectorAddress, BALANCER_FEES_ABI, input.provider).getFlashLoanFeePercentage() as Promise<BigNumber>,
  ]);
  const liquidity = liquidityRaw.toBigInt();
  if (liquidity < input.amount) return null;
  const feeNumerator = feeRaw.toBigInt();
  const fee = input.amount === 0n ? 0n : (input.amount * feeNumerator + BALANCER_ONE - 1n) / BALANCER_ONE;
  return {
    kind: 'balancer_v2', chain: input.source.chain, lender: input.source.address, asset: input.asset,
    availableLiquidity: liquidity, upstreamFee: fee, feeBps: feeBps(fee, input.amount),
    observedAt: Date.now(), providerIndex: input.providerIndex,
    provenance: [...input.source.provenance, 'balancer_v2_vault_liquidity_live', 'balancer_flash_fee_live'],
  };
}

async function measureErc3156(input: {
  source: GhostWalletFundingSource;
  provider: providers.JsonRpcProvider;
  providerIndex: number;
  asset: string;
  amount: bigint;
}): Promise<GhostWalletFundingQuote | null> {
  const code = await input.provider.getCode(input.source.address);
  if (code === '0x') return null;
  const lender = new Contract(input.source.address, ERC3156_ABI, input.provider);
  const [availableRaw, feeRaw] = await Promise.all([
    lender.maxFlashLoan(input.asset), lender.flashFee(input.asset, input.amount.toString()),
  ]);
  const liquidity = BigInt(availableRaw.toString());
  if (liquidity < input.amount) return null;
  const fee = BigInt(feeRaw.toString());
  return {
    kind: 'erc3156', chain: input.source.chain, lender: input.source.address, asset: input.asset,
    availableLiquidity: liquidity, upstreamFee: fee, feeBps: feeBps(fee, input.amount),
    observedAt: Date.now(), providerIndex: input.providerIndex,
    provenance: [...input.source.provenance, 'erc3156_maxFlashLoan_live', 'erc3156_flashFee_live'],
  };
}

async function measureOne(
  source: GhostWalletFundingSource,
  provider: providers.JsonRpcProvider,
  providerIndex: number,
  asset: string,
  amount: bigint,
): Promise<GhostWalletFundingQuote | null> {
  const input = { source, provider, providerIndex, asset, amount };
  if (source.kind === 'aave_v3') return measureAave(input);
  if (source.kind === 'morpho_blue') return measureMorpho(input);
  if (source.kind === 'balancer_v2') return measureBalancer(input);
  return measureErc3156(input);
}

export function invalidateGhostWalletFundingEvidence(input?: { chain?: GhostWalletChain; asset?: string }): void {
  const chainPrefix = input?.chain ? `${input.chain}:` : null;
  const assetNeedle = input?.asset && ethers.utils.isAddress(input.asset)
    ? `:${ethers.utils.getAddress(input.asset).toLowerCase()}:`
    : null;
  for (const key of resident.keys()) {
    if (chainPrefix && !key.startsWith(chainPrefix)) continue;
    if (assetNeedle && !key.includes(assetNeedle)) continue;
    resident.delete(key);
  }
}

export async function measureGhostWalletFunding(input: {
  chain: GhostWalletChain;
  asset: string;
  amount: bigint;
  forceFresh?: boolean;
}): Promise<GhostWalletFundingQuote[]> {
  if (input.amount <= 0n) return [];
  const asset = normalizeAddress(input.asset);
  if (!asset) throw new Error('GHOST_WALLET_FUNDING_ASSET_INVALID');
  const key = `${input.chain}:${asset.toLowerCase()}:${input.amount}`;
  const cached = resident.get(key);
  if (!input.forceFresh && cached && cached.expiresAt > Date.now()) {
    return cached.quotes.map(row => ({ ...row, provenance: [...row.provenance] }));
  }
  const pending = inFlight.get(key);
  if (pending) return pending;

  const work = (async () => {
    const sources = await sourcesForChain(input.chain);
    if (sources.length === 0) return [];
    const settled = await Promise.allSettled(sources.map(source =>
      ghostWalletProviderMesh.runHedged({
        chain: input.chain,
        operation: `funding:${source.kind}:${source.address.toLowerCase()}`,
        execute: async (provider, providerIndex) => {
          const startedAt = Date.now();
          try {
            const quote = await measureOne(source, provider, providerIndex, asset, input.amount);
            if (!quote) throw new Error('GHOST_WALLET_FUNDING_SOURCE_UNAVAILABLE');
            const measurementLatencyMs = Date.now() - startedAt;
            const providerLabel = ghostWalletProviderMesh.getProviderLabel(input.chain, provider);
            const enriched = { ...quote, measurementLatencyMs, providerLabel };
            recordGhostWalletPerformance({
              stage: 'funding_quote',
              chain: input.chain,
              routeKey: `${quote.kind}:${quote.lender.toLowerCase()}`,
              sourceKind: quote.kind,
              providerLabel,
              latencyMs: measurementLatencyMs,
              success: true,
            });
            return enriched;
          } catch (error) {
            recordGhostWalletPerformance({
              stage: 'funding_quote',
              chain: input.chain,
              routeKey: `${source.kind}:${source.address.toLowerCase()}`,
              sourceKind: source.kind,
              providerLabel: ghostWalletProviderMesh.getProviderLabel(input.chain, provider),
              latencyMs: Date.now() - startedAt,
              success: false,
              errorType: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        },
      }),
    ));

    const quotes = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    quotes.sort((left, right) => {
      if (left.upstreamFee !== right.upstreamFee) return left.upstreamFee < right.upstreamFee ? -1 : 1;
      const leftKey = `${left.kind}:${left.lender.toLowerCase()}`;
      const rightKey = `${right.kind}:${right.lender.toLowerCase()}`;
      const leftPerformance = ghostWalletPerformancePenalty({
        stage: 'funding_quote', chain: input.chain, routeKey: leftKey, sourceKind: left.kind,
      });
      const rightPerformance = ghostWalletPerformancePenalty({
        stage: 'funding_quote', chain: input.chain, routeKey: rightKey, sourceKind: right.kind,
      });
      if (leftPerformance.failureRate !== rightPerformance.failureRate) {
        return leftPerformance.failureRate - rightPerformance.failureRate;
      }
      const leftLatency = leftPerformance.ewmaLatencyMs ?? left.measurementLatencyMs ?? Number.POSITIVE_INFINITY;
      const rightLatency = rightPerformance.ewmaLatencyMs ?? right.measurementLatencyMs ?? Number.POSITIVE_INFINITY;
      if (leftLatency !== rightLatency) return leftLatency - rightLatency;
      if (left.availableLiquidity !== right.availableLiquidity) return left.availableLiquidity > right.availableLiquidity ? -1 : 1;
      return left.providerIndex - right.providerIndex;
    });
    resident.set(key, { expiresAt: Date.now() + cacheTtlMs(), quotes });
    return quotes;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, work);
  return work;
}

export function getGhostWalletFundingCoverage(): Record<GhostWalletChain, GhostWalletFundingKind[]> {
  const chains: GhostWalletChain[] = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc', 'avalanche'];
  return Object.fromEntries(chains.map(chain => [chain, [
    ...(AAVE_V3_DEFAULTS[chain] ? ['aave_v3' as const] : []),
    ...(MORPHO_BLUE_DEFAULTS[chain] ? ['morpho_blue' as const] : []),
    ...(BALANCER_V2_DEFAULTS[chain] ? ['balancer_v2' as const] : []),
    'erc3156' as const,
  ]])) as Record<GhostWalletChain, GhostWalletFundingKind[]>;
}

export const GHOST_WALLET_FUNDING_MESH_POLICY = {
  zeroCapitalDependency: false,
  hardSourceCountLimit: null,
  sourceMeasurementsRemainParallel: true,
  cartesianProviderFanout: false,
  hedgedProviderSelection: true,
  providerFailureRouteLocal: true,
  freshEvidenceSingleflight: true,
  lowestExactUpstreamFeeWins: true,
  latencyReliabilityTieBreak: true,
  eventInvalidationSupported: true,
  supportedChains: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc', 'avalanche'] as const,
} as const;
