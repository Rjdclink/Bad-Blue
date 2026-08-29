import { Contract, BigNumber, ethers, providers } from 'ethers';
import type { SupportedExecutionChain } from './onchain-payload-builder.js';
import { resolveSponsoredReceiverVault } from './sponsored-receiver-manager.js';

export type FlashLoanProviderKind = 'balancer_v2' | 'aave_v3';

export interface FlashLoanProviderEconomics {
  provider: FlashLoanProviderKind;
  chain: SupportedExecutionChain;
  infrastructure: string;
  asset: string;
  availableLiquidity: bigint | null;
  feeBps: number | null;
  feeRateNumerator: bigint | null;
  feeRateDenominator: bigint | null;
  observedAt: number;
  executableEvidenceComplete: boolean;
  missingEvidence: string[];
  provenance: string[];
}

const ERC20_ABI = ['function balanceOf(address account) view returns (uint256)'];
const BALANCER_VAULT_ABI = ['function getProtocolFeesCollector() view returns (address)'];
const BALANCER_FEES_ABI = ['function getFlashLoanFeePercentage() view returns (uint256)'];
const AAVE_POOL_ABI = ['function FLASHLOAN_PREMIUM_TOTAL() view returns (uint128)'];
const BALANCER_FIXED_POINT_ONE = 10n ** 18n;
const AAVE_BPS_DENOMINATOR = 10_000n;

function requireAddress(label: string, value: string): string {
  if (!ethers.utils.isAddress(value)) throw new Error(`${label} must be a valid EVM address`);
  return ethers.utils.getAddress(value);
}

function parseAddressMap(raw: string | undefined, label: string): Partial<Record<SupportedExecutionChain, string>> {
  if (!raw?.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a JSON object keyed by chain`);
  const result: Partial<Record<SupportedExecutionChain, string>> = {};
  for (const [chain, address] of Object.entries(value as Record<string, unknown>)) {
    if (typeof address !== 'string' || !address.trim()) continue;
    result[chain as SupportedExecutionChain] = requireAddress(`${label}.${chain}`, address);
  }
  return result;
}

export function resolveAaveV3Pool(
  chain: SupportedExecutionChain,
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const mapped = parseAddressMap(environment.ZERO_CAPITAL_AAVE_V3_POOLS, 'ZERO_CAPITAL_AAVE_V3_POOLS');
  const chainSpecific = environment[`ZERO_CAPITAL_AAVE_V3_POOL_${chain.toUpperCase()}`]?.trim();
  const candidate = chainSpecific || mapped[chain];
  return candidate ? requireAddress(`Aave V3 pool for ${chain}`, candidate) : null;
}

export function calculateMeasuredFlashLoanFee(
  evidence: FlashLoanProviderEconomics,
  amount: bigint,
): bigint | null {
  if (amount < 0n || evidence.feeRateNumerator === null || evidence.feeRateDenominator === null || evidence.feeRateDenominator <= 0n) return null;
  if (evidence.feeRateNumerator < 0n) return null;
  if (amount === 0n || evidence.feeRateNumerator === 0n) return 0n;
  // Conservative integer rounding: never understate a measured provider fee by
  // truncating fractional base units. This is especially important for Balancer's
  // 18-decimal fixed-point fee percentage.
  return (amount * evidence.feeRateNumerator + evidence.feeRateDenominator - 1n) / evidence.feeRateDenominator;
}

export async function measureBalancerFlashLoanEconomics(input: {
  chain: SupportedExecutionChain;
  provider: providers.Provider;
  asset: string;
}): Promise<FlashLoanProviderEconomics | null> {
  const vault = resolveSponsoredReceiverVault(input.chain);
  if (!vault) return null;
  const asset = requireAddress('flash-loan asset', input.asset);
  const vaultContract = new Contract(vault, BALANCER_VAULT_ABI, input.provider);
  const token = new Contract(asset, ERC20_ABI, input.provider);
  const feeCollectorAddress = requireAddress(
    'Balancer ProtocolFeesCollector',
    await vaultContract.getProtocolFeesCollector() as string,
  );
  const feeCollector = new Contract(feeCollectorAddress, BALANCER_FEES_ABI, input.provider);
  const [liquidityRaw, feePercentageRaw] = await Promise.all([
    token.balanceOf(vault) as Promise<BigNumber>,
    feeCollector.getFlashLoanFeePercentage() as Promise<BigNumber>,
  ]);
  const feeRateNumerator = feePercentageRaw.toBigInt();
  const feeBps = Number(feePercentageRaw.toString()) / 1e14;
  const feeMeasured = feeRateNumerator >= 0n && Number.isFinite(feeBps) && feeBps >= 0;
  return {
    provider: 'balancer_v2',
    chain: input.chain,
    infrastructure: vault,
    asset,
    availableLiquidity: liquidityRaw.toBigInt(),
    feeBps: feeMeasured ? feeBps : null,
    feeRateNumerator: feeMeasured ? feeRateNumerator : null,
    feeRateDenominator: feeMeasured ? BALANCER_FIXED_POINT_ONE : null,
    observedAt: Date.now(),
    executableEvidenceComplete: feeMeasured && liquidityRaw.gt(0),
    missingEvidence: [
      ...(!feeMeasured ? ['flash_loan_fee'] : []),
      ...(liquidityRaw.lte(0) ? ['flash_loan_liquidity'] : []),
    ],
    provenance: [
      'balancer_v2_vault_token_balance',
      'balancer_protocol_fees_collector_flash_loan_fee_exact_fixed_point',
      'synthetic_evidence:false',
    ],
  };
}

export async function measureAaveV3FlashLoanEconomics(input: {
  chain: SupportedExecutionChain;
  provider: providers.Provider;
  asset: string;
}): Promise<FlashLoanProviderEconomics | null> {
  const poolAddress = resolveAaveV3Pool(input.chain);
  if (!poolAddress) return null;
  const asset = requireAddress('flash-loan asset', input.asset);
  const pool = new Contract(poolAddress, AAVE_POOL_ABI, input.provider);
  const premiumRaw = BigNumber.from(await pool.FLASHLOAN_PREMIUM_TOTAL());
  const feeRateNumerator = premiumRaw.toBigInt();
  const feeBps = Number(premiumRaw.toString());
  const feeMeasured = feeRateNumerator >= 0n && Number.isFinite(feeBps) && feeBps >= 0;

  // Aave liquidity resides behind reserve aTokens rather than at the Pool address.
  // Until a reserve-liquidity authority is wired, fee evidence is useful for
  // comparison but Aave remains non-executable rather than assuming capacity.
  return {
    provider: 'aave_v3',
    chain: input.chain,
    infrastructure: poolAddress,
    asset,
    availableLiquidity: null,
    feeBps: feeMeasured ? feeBps : null,
    feeRateNumerator: feeMeasured ? feeRateNumerator : null,
    feeRateDenominator: feeMeasured ? AAVE_BPS_DENOMINATOR : null,
    observedAt: Date.now(),
    executableEvidenceComplete: false,
    missingEvidence: [
      ...(!feeMeasured ? ['flash_loan_fee'] : []),
      'flash_loan_liquidity',
      'compiled_verified_receiver_artifact',
    ],
    provenance: [
      'aave_v3_pool_FLASHLOAN_PREMIUM_TOTAL',
      'liquidity_not_assumed',
      'synthetic_evidence:false',
    ],
  };
}

export async function measureFlashLoanProviders(input: {
  chain: SupportedExecutionChain;
  provider: providers.Provider;
  asset: string;
}): Promise<FlashLoanProviderEconomics[]> {
  const settled = await Promise.allSettled([
    measureBalancerFlashLoanEconomics(input),
    measureAaveV3FlashLoanEconomics(input),
  ]);
  return settled.flatMap(result =>
    result.status === 'fulfilled' && result.value ? [result.value] : [],
  );
}

export function selectMeasuredFlashLoanProvider(
  evidence: readonly FlashLoanProviderEconomics[],
  requestedAmount: bigint,
): FlashLoanProviderEconomics | null {
  const eligible = evidence
    .filter(item =>
      item.executableEvidenceComplete &&
      item.availableLiquidity !== null &&
      item.availableLiquidity >= requestedAmount &&
      item.feeBps !== null &&
      item.feeRateNumerator !== null &&
      item.feeRateDenominator !== null,
    )
    .sort((left, right) => {
      const feeDelta = (left.feeBps ?? Number.POSITIVE_INFINITY) - (right.feeBps ?? Number.POSITIVE_INFINITY);
      if (feeDelta !== 0) return feeDelta;
      const leftLiquidity = left.availableLiquidity ?? 0n;
      const rightLiquidity = right.availableLiquidity ?? 0n;
      return leftLiquidity === rightLiquidity ? 0 : leftLiquidity > rightLiquidity ? -1 : 1;
    });
  return eligible[0] ?? null;
}
