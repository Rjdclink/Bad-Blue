import { Contract, ethers, providers } from 'ethers';
import {
  calculateMeasuredFlashLoanFee,
  measureFlashLoanProviders,
  type FlashLoanProviderEconomics,
  type FlashLoanProviderKind,
} from '../execution/adapters/flash-loan-provider-economics.js';
import type { SupportedExecutionChain } from '../execution/adapters/onchain-payload-builder.js';
import { getGhostWalletExternalBridgeDescriptor } from './ghost-wallet-external-bridge.js';
import { ghostWalletProviderMesh, type GhostWalletChain } from './ghost-wallet-provider-mesh.js';
import { upsertGhostWalletVenue } from './ghost-wallet-work-ledger.js';

const ERC3156_LENDER_ABI = [
  'function maxFlashLoan(address token) view returns (uint256)',
  'function flashFee(address token,uint256 amount) view returns (uint256)',
];
const BRIDGE_ABI = [
  'function brokerExternalFlashLoan(address lender,address borrower,address token,uint256 amount,uint256 maxBorrowerFee,bytes borrowerData) returns (bool)',
  'function brokerAaveV3FlashLoan(address pool,address borrower,address token,uint256 amount,uint256 maxBorrowerFee,bytes borrowerData) returns (bool)',
  'function brokerMorphoFlashLoan(address morpho,address borrower,address token,uint256 amount,uint256 maxBorrowerFee,bytes borrowerData) returns (bool)',
  'function brokerBalancerV2FlashLoan(address vault,address borrower,address token,uint256 amount,uint256 maxBorrowerFee,bytes borrowerData) returns (bool)',
];

export type GhostWalletBorrowerSourceKind = FlashLoanProviderKind | 'erc3156';

export interface GhostWalletBorrowerSourceCandidate {
  kind: 'erc3156';
  address: string;
  label?: string;
}

export interface GhostWalletBorrowerQuoteRequest {
  chain: GhostWalletChain;
  borrower: string;
  asset: string;
  amountBaseUnits: string;
  borrowerData?: string;
  lenderCandidates?: GhostWalletBorrowerSourceCandidate[];
}

export interface GhostWalletBorrowerRouteQuote {
  sourceKind: GhostWalletBorrowerSourceKind;
  lender: string;
  availableLiquidity: string;
  upstreamFeeBaseUnits: string;
  ghostSpreadBaseUnits: string;
  borrowerFeeBaseUnits: string;
  observedAt: number;
  provenance: string[];
}

export interface GhostWalletBorrowerQuoteResult {
  chain: GhostWalletChain;
  chainId: number;
  bridge: string;
  bridgeDeployed: boolean;
  bootstrap: Awaited<ReturnType<typeof getGhostWalletExternalBridgeDescriptor>>['deployment'];
  borrower: string;
  asset: string;
  amountBaseUnits: string;
  transactionPayer: 'caller';
  operatorMonetaryInputRequired: false;
  selected: GhostWalletBorrowerRouteQuote;
  alternatives: GhostWalletBorrowerRouteQuote[];
  transaction: { to: string; data: string; value: '0' };
}

function asAmount(raw: string): bigint {
  if (!/^\d+$/.test(raw)) throw new Error('GHOST_WALLET_BORROW_AMOUNT_INVALID');
  const value = BigInt(raw);
  if (value <= 0n) throw new Error('GHOST_WALLET_BORROW_AMOUNT_MUST_BE_POSITIVE');
  return value;
}

function asAddress(raw: string, label: string): string {
  if (!ethers.utils.isAddress(raw)) throw new Error(`${label}_INVALID`);
  return ethers.utils.getAddress(raw);
}

function asData(raw?: string): string {
  const value = raw?.trim() || '0x';
  if (!ethers.utils.isHexString(value)) throw new Error('GHOST_WALLET_BORROWER_DATA_INVALID');
  return value;
}

function positiveSpread(amount: bigint, spreadBps: number): bigint {
  const numerator = BigInt(Math.max(0, Math.trunc(spreadBps)));
  if (numerator === 0n) return 1n;
  const calculated = (amount * numerator + 9_999n) / 10_000n;
  return calculated > 0n ? calculated : 1n;
}

function routeFromMeasured(
  evidence: FlashLoanProviderEconomics,
  amount: bigint,
  spread: bigint,
): GhostWalletBorrowerRouteQuote | null {
  if (!evidence.executableEvidenceComplete
    || evidence.availableLiquidity === null
    || evidence.availableLiquidity < amount) return null;
  const fee = calculateMeasuredFlashLoanFee(evidence, amount);
  if (fee === null) return null;
  return {
    sourceKind: evidence.provider,
    lender: evidence.infrastructure,
    availableLiquidity: evidence.availableLiquidity.toString(),
    upstreamFeeBaseUnits: fee.toString(),
    ghostSpreadBaseUnits: spread.toString(),
    borrowerFeeBaseUnits: (fee + spread).toString(),
    observedAt: evidence.observedAt,
    provenance: [...evidence.provenance, 'ghost_execution:caller_funded_atomic_bridge'],
  };
}

async function quoteErc3156Candidate(input: {
  provider: providers.Provider;
  chain: GhostWalletChain;
  asset: string;
  amount: bigint;
  spread: bigint;
  candidate: GhostWalletBorrowerSourceCandidate;
}): Promise<GhostWalletBorrowerRouteQuote | null> {
  const lender = asAddress(input.candidate.address, 'GHOST_WALLET_LENDER');
  const code = await input.provider.getCode(lender);
  if (code === '0x') return null;
  const contract = new Contract(lender, ERC3156_LENDER_ABI, input.provider);
  const [availableRaw, feeRaw] = await Promise.all([
    contract.maxFlashLoan(input.asset),
    contract.flashFee(input.asset, input.amount.toString()),
  ]);
  const available = BigInt(availableRaw.toString());
  if (available < input.amount) return null;
  const fee = BigInt(feeRaw.toString());
  await upsertGhostWalletVenue({
    venueId: `erc3156-lender:${input.chain}:${lender.toLowerCase()}:${input.asset.toLowerCase()}`,
    chain: input.chain,
    protocol: 'erc3156',
    role: 'lender',
    address: lender,
    asset: input.asset,
    adapter: 'erc3156_flash_lender',
    discoveredFrom: input.candidate.label ? `borrower_quote:${input.candidate.label}` : 'borrower_quote:caller_candidate',
    verified: true,
    enabled: true,
    capabilities: {
      maxFlashLoanMeasured: available.toString(),
      flashFeeMeasured: fee.toString(),
      exactSameTransactionRepayment: true,
      operatorCapitalRequired: false,
    },
    metadata: { lastQuoteAt: Date.now() },
  });
  return {
    sourceKind: 'erc3156',
    lender,
    availableLiquidity: available.toString(),
    upstreamFeeBaseUnits: fee.toString(),
    ghostSpreadBaseUnits: input.spread.toString(),
    borrowerFeeBaseUnits: (fee + input.spread).toString(),
    observedAt: Date.now(),
    provenance: ['erc3156_maxFlashLoan_live', 'erc3156_flashFee_live', 'ghost_execution:caller_funded_atomic_bridge'],
  };
}

function sourceMethod(kind: GhostWalletBorrowerSourceKind): string {
  if (kind === 'aave_v3') return 'brokerAaveV3FlashLoan';
  if (kind === 'morpho_blue') return 'brokerMorphoFlashLoan';
  if (kind === 'balancer_v2') return 'brokerBalancerV2FlashLoan';
  return 'brokerExternalFlashLoan';
}

export async function quoteGhostWalletBorrowerRoute(
  request: GhostWalletBorrowerQuoteRequest,
): Promise<GhostWalletBorrowerQuoteResult> {
  const chain = request.chain.trim().toLowerCase() as GhostWalletChain;
  const borrower = asAddress(request.borrower, 'GHOST_WALLET_BORROWER');
  const asset = asAddress(request.asset, 'GHOST_WALLET_ASSET');
  const amount = asAmount(request.amountBaseUnits);
  const borrowerData = asData(request.borrowerData);
  const providersForChain = await ghostWalletProviderMesh.getProviders(chain);
  if (providersForChain.length === 0) throw new Error(`GHOST_WALLET_RPC_UNAVAILABLE:${chain}`);
  const provider = providersForChain[0];
  const [borrowerCode, assetCode] = await Promise.all([provider.getCode(borrower), provider.getCode(asset)]);
  if (borrowerCode === '0x') throw new Error('GHOST_WALLET_BORROWER_CONTRACT_REQUIRED');
  if (assetCode === '0x') throw new Error('GHOST_WALLET_ASSET_CONTRACT_REQUIRED');

  const bridge = await getGhostWalletExternalBridgeDescriptor(chain);
  const spread = positiveSpread(amount, bridge.minimumBrokerSpreadBps);

  // Reuse the already-canonical flash-provider measurement code as read-only
  // evidence. Ghost owns selection for its own borrower quote, not those adapters.
  const measuredSettled = await Promise.allSettled(providersForChain.map(rpc =>
    measureFlashLoanProviders({
      chain: chain as SupportedExecutionChain,
      provider: rpc,
      asset,
    }),
  ));
  const measured = measuredSettled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const bySource = new Map<string, GhostWalletBorrowerRouteQuote>();
  for (const evidence of measured) {
    const route = routeFromMeasured(evidence, amount, spread);
    if (!route) continue;
    const key = `${route.sourceKind}:${route.lender.toLowerCase()}`;
    const existing = bySource.get(key);
    if (!existing || BigInt(route.borrowerFeeBaseUnits) < BigInt(existing.borrowerFeeBaseUnits)) bySource.set(key, route);
  }

  const callerCandidates = request.lenderCandidates || [];
  const externalSettled = await Promise.allSettled(callerCandidates.flatMap(candidate =>
    providersForChain.map(rpc => quoteErc3156Candidate({
      provider: rpc, chain, asset, amount, spread, candidate,
    })),
  ));
  for (const result of externalSettled) {
    if (result.status !== 'fulfilled' || !result.value) continue;
    const route = result.value;
    const key = `${route.sourceKind}:${route.lender.toLowerCase()}`;
    const existing = bySource.get(key);
    if (!existing || BigInt(route.borrowerFeeBaseUnits) < BigInt(existing.borrowerFeeBaseUnits)) bySource.set(key, route);
  }

  const routes = [...bySource.values()].sort((left, right) => {
    const feeLeft = BigInt(left.borrowerFeeBaseUnits);
    const feeRight = BigInt(right.borrowerFeeBaseUnits);
    if (feeLeft !== feeRight) return feeLeft < feeRight ? -1 : 1;
    const liquidityLeft = BigInt(left.availableLiquidity);
    const liquidityRight = BigInt(right.availableLiquidity);
    return liquidityLeft === liquidityRight ? 0 : liquidityLeft > liquidityRight ? -1 : 1;
  });
  const selected = routes[0];
  if (!selected) throw new Error('GHOST_WALLET_NO_COMPATIBLE_LENDER_CAPACITY');

  const iface = new ethers.utils.Interface(BRIDGE_ABI);
  const data = iface.encodeFunctionData(sourceMethod(selected.sourceKind), [
    selected.lender,
    borrower,
    asset,
    amount.toString(),
    selected.borrowerFeeBaseUnits,
    borrowerData,
  ]);

  return {
    chain,
    chainId: bridge.chainId,
    bridge: bridge.address,
    bridgeDeployed: bridge.deployed,
    bootstrap: bridge.deployment,
    borrower,
    asset,
    amountBaseUnits: amount.toString(),
    transactionPayer: 'caller',
    operatorMonetaryInputRequired: false,
    selected,
    alternatives: routes.slice(1),
    transaction: { to: bridge.address, data, value: '0' },
  };
}

export const GHOST_WALLET_BORROWER_SURFACE_POLICY = {
  hardLenderUniverseLimit: null,
  hardBorrowerUniverseLimit: null,
  selection: 'lowest_live_all_in_upstream_fee_for_same_asset_and_amount',
  providerMeasurementAuthorityReusedReadOnly: true,
  serverSubmitsBorrowTransaction: false,
  callerPaysTransactionGas: true,
  operatorMonetaryInputRequired: false,
} as const;
