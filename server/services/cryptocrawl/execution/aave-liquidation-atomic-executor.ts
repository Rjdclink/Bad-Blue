import { BigNumber, Contract, Wallet, ethers } from 'ethers';
import logger from '../../../logger.js';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import { resolveOperationalProfitRecipient } from '../core/wallet-identity.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { requireZeroCapitalInfrastructureDeploymentAllowed } from '../governance/zero-capital-infrastructure-policy.js';
import { stageManager } from '../governance/stage-management.js';
import { marketDataProviders, type DexQuoteObservation } from '../intelligence/market-data-providers.js';
import { getGasSponsorManager, type SponsoredCall } from '../strategies/gas-sponsorship.js';
import {
  calculateMeasuredFlashLoanFee,
  measureAaveV3FlashLoanEconomics,
  resolveAaveV3Pool,
} from './adapters/flash-loan-provider-economics.js';
import {
  resolveConfiguredFlashLoanReceiver,
  verifyFlashLoanReceiverCapability,
} from './adapters/flash-loan-receiver-capability.js';
import { getSponsoredReceiverManager } from './adapters/sponsored-receiver-manager.js';
import type { SupportedExecutionChain } from './adapters/onchain-payload-builder.js';
import { executeSystemOwnedNativeTransaction } from './system-owned-native-transaction.js';

/**
 * Liquidation execution is deliberately limited to chains where pre-trade native
 * gas can be bounded without a separate L1-data-fee oracle. Arbitrum/Optimism
 * remain discovery-only until their exact L1 data component is measured; this is
 * safer than silently treating that component as zero.
 */
export type ExecutableAaveLiquidationChain = 'ethereum' | 'polygon';

export interface AaveLiquidationRequest {
  opportunityId: string;
  chain: ExecutableAaveLiquidationChain;
  borrower: string;
  expiresAt: number;
}

export interface AaveLiquidationPreparation {
  opportunityId: string;
  chain: ExecutableAaveLiquidationChain;
  borrower: string;
  receiver: string;
  debtAsset: string;
  debtSymbol: string;
  debtDecimals: number;
  collateralAsset: string;
  collateralSymbol: string;
  collateralDecimals: number;
  debtToCover: string;
  collateralExpectedFromLiquidation: string;
  collateralSellAmount: string;
  unwindBuyAmount: string;
  flashLoanFeeAmount: string;
  expectedLiquidationBonusUsd: number;
  expectedFlashFeeUsd: number;
  expectedUnwindCostUsd: number;
  expectedGasUsd: number;
  deterministicNetProfitUsd: number;
  notionalUsd: number;
  grossProfitBps: number;
  flashLoanFeeBps: number;
  gasCostBps: number;
  allInCostBps: number;
  netProfitBps: number;
  minProfit: string;
  payload: { to: string; data: string; value: string; gasLimit: number };
  unwindQuote: DexQuoteObservation;
  expiresAt: number;
  simulated: boolean;
  simulationAdvisoryErrors?: string[];
  provenance: string[];
}

export interface AaveLiquidationExecutionResult {
  success: boolean;
  status: 'rejected' | 'failed' | 'filled' | 'settlement_unknown';
  terminal: boolean;
  settlementConfirmed: boolean;
  transactionHash?: string;
  fundingModeUsed?: 'sponsored' | 'native';
  receiptStatus?: 0 | 1;
  gasUsed?: string;
  effectiveGasPriceWei?: string;
  realizedReceiverProfitUsd?: number;
  realizedReceiverProfitBps?: number;
  error?: string;
}

export interface AaveLiquidationInfrastructureResult {
  attempted: number;
  prepared: number;
  failed: number;
  remaining: number;
  details: Array<{
    opportunityId: string;
    chain: ExecutableAaveLiquidationChain;
    ready: boolean;
    reason?: string;
  }>;
}

type ReservePosition = {
  reserveId: number | null;
  asset: string;
  symbol: string;
  decimals: number;
  price: BigNumber;
  currentATokenBalance: BigNumber;
  currentDebt: BigNumber;
  liquidationBonusBps: number;
  liquidationProtocolFeeBps: number;
  usageAsCollateralEnabled: boolean;
  isActive: boolean;
  isPaused: boolean;
  liquidationGracePeriodUntil: number;
};

type PairEconomics = {
  debt: ReservePosition;
  collateral: ReservePosition;
  debtToCover: BigNumber;
  collateralReceived: BigNumber;
  collateralSellAmount: BigNumber;
  liquidationProtocolFeeAmount: BigNumber;
  debtNotionalUsd: number;
  liquidationBonusUsd: number;
  fairSellValueUsd: number;
};

type ExactLiquidationAmounts = {
  debtAmount: BigNumber;
  collateralToLiquidator: BigNumber;
  protocolFee: BigNumber;
  grossCollateralConsumed: BigNumber;
};

type PendingInfrastructureNeed = {
  request: AaveLiquidationRequest;
  chainId: number;
  walletAddress: string;
  calls: SponsoredCall[];
  queuedAt: number;
};

const POOL_ABI = [
  'function ADDRESSES_PROVIDER() view returns (address)',
  'function getReservesList() view returns (address[])',
  'function getReservesCount() view returns (uint256)',
  'function getReserveAddressById(uint16 id) view returns (address)',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase,uint256 totalDebtBase,uint256 availableBorrowsBase,uint256 currentLiquidationThreshold,uint256 ltv,uint256 healthFactor)',
  'function getUserEMode(address user) view returns (uint256)',
  'function getEModeCategoryCollateralConfig(uint8 id) view returns (uint16 ltv,uint16 liquidationThreshold,uint16 liquidationBonus)',
  'function getEModeCategoryCollateralBitmap(uint8 id) view returns (uint128)',
  'function getLiquidationGracePeriod(address asset) view returns (uint40)',
  'function liquidationCall(address collateralAsset,address debtAsset,address user,uint256 debtToCover,bool receiveAToken)',
];
const ADDRESSES_PROVIDER_ABI = [
  'function getPoolDataProvider() view returns (address)',
  'function getPriceOracle() view returns (address)',
];
const DATA_PROVIDER_ABI = [
  'function getUserReserveData(address asset,address user) view returns (uint256 currentATokenBalance,uint256 currentStableDebt,uint256 currentVariableDebt,uint256 principalStableDebt,uint256 scaledVariableDebt,uint256 stableBorrowRate,uint256 liquidityRate,uint40 stableRateLastUpdated,bool usageAsCollateralEnabled)',
  'function getReserveConfigurationData(address asset) view returns (uint256 decimals,uint256 ltv,uint256 liquidationThreshold,uint256 liquidationBonus,uint256 reserveFactor,bool usageAsCollateralEnabled,bool borrowingEnabled,bool stableBorrowRateEnabled,bool isActive,bool isFrozen)',
  'function getLiquidationProtocolFee(address asset) view returns (uint256)',
  'function getPaused(address asset) view returns (bool isPaused)',
];
const ORACLE_ABI = [
  'function getAssetPrice(address asset) view returns (uint256)',
  'function BASE_CURRENCY() view returns (address)',
  'function BASE_CURRENCY_UNIT() view returns (uint256)',
];
const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function balanceOf(address account) view returns (uint256)',
];
const RECEIVER_ABI = [
  'function executeAaveFlashLoan(address loanToken,uint256 loanAmount,(address target,uint256 value,bytes callData,address approvalToken,uint256 approvalAmount)[] steps,uint256 minProfit,address profitRecipient) external',
  'event FlashLoanExecuted(address indexed initiator,address indexed loanToken,uint256 loanAmount,uint256 profit)',
];

const CHAIN_IDS: Record<ExecutableAaveLiquidationChain, number> = {
  ethereum: 1,
  polygon: 137,
};
const NATIVE_SYMBOLS: Record<ExecutableAaveLiquidationChain, string> = {
  ethereum: 'ETH',
  polygon: 'POL',
};
const PERCENTAGE_FACTOR = BigNumber.from(10_000);
const HALF_PERCENTAGE_FACTOR = BigNumber.from(5_000);
const CLOSE_FACTOR_HF_THRESHOLD = BigNumber.from('950000000000000000');
const HEALTH_FACTOR_LIQUIDATION_THRESHOLD = BigNumber.from('1000000000000000000');
const DEFAULT_LIQUIDATION_CLOSE_FACTOR_BPS = 5_000;
const AAVE_USD_BASE_UNIT = BigNumber.from(100_000_000);
const MIN_BASE_MAX_CLOSE_FACTOR_THRESHOLD = BigNumber.from('200000000000');
const MIN_LEFTOVER_BASE = BigNumber.from('100000000000');
const preparedPlans = new Map<string, AaveLiquidationPreparation>();
const requestInputs = new Map<string, AaveLiquidationRequest>();
const pendingInfrastructure = new Map<string, PendingInfrastructureNeed>();

function boundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function configuredWallet(): Wallet | null {
  const raw = process.env.WALLET_PRIVATE_KEY?.trim();
  if (!raw) return null;
  const normalized = raw.startsWith('0x') ? raw : `0x${raw}`;
  try { return new Wallet(normalized); } catch { return null; }
}

function asAddress(label: string, value: string | undefined | null): string {
  if (!value || !ethers.utils.isAddress(value)) throw new Error(`${label} is not a valid EVM address`);
  return ethers.utils.getAddress(value);
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function minBigNumber(left: BigNumber, right: BigNumber): BigNumber {
  return left.lte(right) ? left : right;
}

function ceilDiv(numerator: BigNumber, denominator: BigNumber): BigNumber {
  if (denominator.lte(0)) throw new Error('ceilDiv denominator must be positive');
  if (numerator.isZero()) return BigNumber.from(0);
  return numerator.add(denominator).sub(1).div(denominator);
}

function percentMulFloor(value: BigNumber, bps: number): BigNumber {
  return value.mul(boundedInt(bps, 0, 0, 100_000)).div(PERCENTAGE_FACTOR);
}

function percentMulHalfUp(value: BigNumber, bps: number): BigNumber {
  const normalized = boundedInt(bps, 0, 0, 100_000);
  if (value.isZero() || normalized === 0) return BigNumber.from(0);
  return value.mul(normalized).add(HALF_PERCENTAGE_FACTOR).div(PERCENTAGE_FACTOR);
}

function percentMulCeil(value: BigNumber, bps: number): BigNumber {
  return ceilDiv(value.mul(boundedInt(bps, 0, 0, 100_000)), PERCENTAGE_FACTOR);
}

function percentDivFloor(value: BigNumber, bps: number): BigNumber {
  const normalized = boundedInt(bps, 0, 1, 100_000);
  return value.mul(PERCENTAGE_FACTOR).div(normalized);
}

function percentDivCeil(value: BigNumber, bps: number): BigNumber {
  const normalized = boundedInt(bps, 0, 1, 100_000);
  return ceilDiv(value.mul(PERCENTAGE_FACTOR), BigNumber.from(normalized));
}

function mulDivCeil(left: BigNumber, right: BigNumber, denominator: BigNumber): BigNumber {
  return ceilDiv(left.mul(right), denominator);
}

function baseUnitsToUsd(amount: BigNumber, decimals: number, price: BigNumber, oracleUnit: BigNumber): number {
  const tokenAmount = Number(ethers.utils.formatUnits(amount, decimals));
  const priceUsd = Number(price.toString()) / Number(oracleUnit.toString());
  const usd = tokenAmount * priceUsd;
  if (!Number.isFinite(usd) || usd < 0) throw new Error('Aave reserve value could not be converted to USD safely');
  return usd;
}

function usdToTokenUnitsCeil(usd: number, decimals: number, price: BigNumber, oracleUnit: BigNumber): BigNumber {
  if (!Number.isFinite(usd) || usd < 0) throw new Error('USD amount for token conversion is invalid');
  const oracleUnitNumber = Number(oracleUnit.toString());
  if (!Number.isSafeInteger(oracleUnitNumber) || oracleUnitNumber <= 0) throw new Error('Aave oracle base unit exceeds safe conversion range');
  const usdBase = BigNumber.from(Math.ceil(usd * oracleUnitNumber).toString());
  const tokenUnit = BigNumber.from(10).pow(decimals);
  return ceilDiv(usdBase.mul(tokenUnit), price);
}

function safeSymbol(raw: unknown, asset: string): string {
  const symbol = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return symbol && /^[A-Z0-9._-]{1,24}$/.test(symbol) ? symbol : asset.slice(0, 10);
}

function quoteTransaction(quote: DexQuoteObservation, expectedSellAmount: BigNumber): {
  target: string;
  data: string;
  value: BigNumber;
  allowanceSpender: string;
  buyAmount: BigNumber;
} {
  if (!quote.executable || quote.quoteKind !== 'quote' || !quote.transaction) {
    throw new Error('0x liquidation unwind did not return executable firm transaction evidence');
  }
  const target = asAddress('0x liquidation transaction target', quote.transaction.to);
  const data = String(quote.transaction.data || '');
  if (!ethers.utils.isHexString(data) || data === '0x') throw new Error('0x liquidation unwind calldata is missing');
  const value = BigNumber.from(quote.transaction.value || '0');
  if (!value.isZero()) throw new Error('Liquidation unwind unexpectedly requires native transaction value');
  const sellAmount = BigNumber.from(quote.sellAmount || '0');
  if (!sellAmount.eq(expectedSellAmount)) throw new Error('0x liquidation unwind sell amount drifted from requested collateral amount');
  const buyAmount = BigNumber.from(quote.buyAmount || '0');
  if (buyAmount.lte(0)) throw new Error('0x liquidation unwind buy amount is missing');
  const explicitSpender = quote.allowanceSpender || quote.allowanceTarget;
  const allowanceSpender = explicitSpender ? asAddress('0x liquidation allowance spender', explicitSpender) : target;
  if (!sameAddress(allowanceSpender, target)) {
    throw new Error('0x liquidation allowance spender differs from transaction target; unsupported route fails closed');
  }
  return { target, data, value, allowanceSpender, buyAmount };
}

function encodeReceiverPayload(input: {
  receiver: string;
  pool: string;
  borrower: string;
  debtAsset: string;
  collateralAsset: string;
  debtToCover: BigNumber;
  collateralSellAmount: BigNumber;
  unwind: ReturnType<typeof quoteTransaction>;
  minProfit: BigNumber;
  profitRecipient: string;
}): string {
  const poolInterface = new ethers.utils.Interface(POOL_ABI);
  const receiverInterface = new ethers.utils.Interface(RECEIVER_ABI);
  const liquidationData = poolInterface.encodeFunctionData('liquidationCall', [
    input.collateralAsset,
    input.debtAsset,
    input.borrower,
    input.debtToCover,
    false,
  ]);
  return receiverInterface.encodeFunctionData('executeAaveFlashLoan', [
    input.debtAsset,
    input.debtToCover,
    [
      {
        target: input.pool,
        value: 0,
        callData: liquidationData,
        approvalToken: input.debtAsset,
        approvalAmount: input.debtToCover,
      },
      {
        target: input.unwind.target,
        value: input.unwind.value,
        callData: input.unwind.data,
        approvalToken: input.collateralAsset,
        approvalAmount: input.collateralSellAmount,
      },
    ],
    input.minProfit,
    input.profitRecipient,
  ]);
}

async function resolveReserveIds(
  pool: Contract,
  reserveAddresses: readonly string[],
  blockTag: number,
): Promise<Map<string, number>> {
  const byAddress = new Map<string, number>();
  try {
    const countRaw = await pool.getReservesCount({ blockTag });
    const count = Number(BigNumber.from(countRaw).toString());
    if (!Number.isInteger(count) || count < 0 || count > 256) throw new Error(`invalid reserve count ${count}`);
    const rows = await Promise.all(Array.from({ length: count }, (_, id) =>
      pool.getReserveAddressById(id, { blockTag }).then((asset: string) => ({ id, asset })).catch(() => null),
    ));
    for (const row of rows) {
      if (!row || !ethers.utils.isAddress(row.asset) || sameAddress(row.asset, ethers.constants.AddressZero)) continue;
      byAddress.set(row.asset.toLowerCase(), row.id);
    }
  } catch (error) {
    logger.debug('[LiquidationExecution] Exact Aave reserve-id map unavailable', {
      component: 'AaveLiquidationAtomicExecutor',
      blockTag,
      error: error instanceof Error ? error.message : String(error),
      listOrderSubstitutionAllowed: false,
    });
  }
  for (const asset of reserveAddresses) {
    if (!byAddress.has(asset.toLowerCase())) continue;
  }
  return byAddress;
}

async function inspectReserve(input: {
  asset: string;
  reserveId: number | null;
  borrower: string;
  pool: Contract;
  dataProvider: Contract;
  oracle: Contract;
  blockTag: number;
  eModeCategory: number;
  eModeCollateralBitmap: BigNumber | null;
  eModeLiquidationBonusBps: number | null;
}): Promise<ReservePosition | null> {
  const calls = { blockTag: input.blockTag };
  const [userRaw, configRaw, priceRaw, symbolRaw, pausedRaw, graceRaw] = await Promise.all([
    input.dataProvider.getUserReserveData(input.asset, input.borrower, calls),
    input.dataProvider.getReserveConfigurationData(input.asset, calls),
    input.oracle.getAssetPrice(input.asset, calls),
    new Contract(input.asset, ERC20_ABI, input.dataProvider.provider).symbol(calls).catch(() => input.asset.slice(0, 10)),
    input.dataProvider.getPaused(input.asset, calls),
    input.pool.getLiquidationGracePeriod(input.asset, calls).catch(() => BigNumber.from(0)),
  ]);
  const decimals = Number(configRaw.decimals ?? configRaw[0]);
  const reserveLiquidationBonusBps = Number(configRaw.liquidationBonus ?? configRaw[3]);
  const isActive = Boolean(configRaw.isActive ?? configRaw[8]);
  const currentATokenBalance = BigNumber.from(userRaw.currentATokenBalance ?? userRaw[0] ?? 0);
  const stableDebt = BigNumber.from(userRaw.currentStableDebt ?? userRaw[1] ?? 0);
  const variableDebt = BigNumber.from(userRaw.currentVariableDebt ?? userRaw[2] ?? 0);
  const currentDebt = stableDebt.add(variableDebt);
  const usageAsCollateralEnabled = Boolean(userRaw.usageAsCollateralEnabled ?? userRaw[8]);
  const price = BigNumber.from(priceRaw);
  const isPaused = Boolean(pausedRaw?.isPaused ?? pausedRaw?.[0] ?? pausedRaw);
  const liquidationGracePeriodUntil = Number(BigNumber.from(graceRaw || 0).toString());

  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36 || price.lte(0)) return null;
  if (currentDebt.lte(0) && (!usageAsCollateralEnabled || currentATokenBalance.lte(0))) return null;
  if (!Number.isSafeInteger(liquidationGracePeriodUntil) || liquidationGracePeriodUntil < 0) return null;

  let liquidationProtocolFeeBps = 0;
  if (usageAsCollateralEnabled && currentATokenBalance.gt(0)) {
    const raw = await input.dataProvider.getLiquidationProtocolFee(input.asset, calls);
    liquidationProtocolFeeBps = Number(raw.toString());
    if (!Number.isFinite(liquidationProtocolFeeBps) || liquidationProtocolFeeBps < 0 || liquidationProtocolFeeBps > 10_000) return null;
  }

  let liquidationBonusBps = reserveLiquidationBonusBps;
  if (input.eModeCategory !== 0 && usageAsCollateralEnabled && currentATokenBalance.gt(0)) {
    if (input.reserveId === null || input.reserveId < 0 || input.reserveId >= 128 || !input.eModeCollateralBitmap || input.eModeLiquidationBonusBps === null) {
      throw new Error(`Aave eMode collateral reserve ${input.asset} lacks exact reserve-id/category authority`);
    }
    if (!input.eModeCollateralBitmap.shr(input.reserveId).and(1).isZero()) {
      liquidationBonusBps = input.eModeLiquidationBonusBps;
    }
  }

  if (!Number.isFinite(liquidationBonusBps) || liquidationBonusBps < 10_000 || liquidationBonusBps > 20_000) return null;
  return {
    reserveId: input.reserveId,
    asset: asAddress('Aave reserve asset', input.asset),
    symbol: safeSymbol(symbolRaw, input.asset),
    decimals,
    price,
    currentATokenBalance,
    currentDebt,
    liquidationBonusBps,
    liquidationProtocolFeeBps,
    usageAsCollateralEnabled,
    isActive,
    isPaused,
    liquidationGracePeriodUntil,
  };
}

function calculateAaveLiquidationAmounts(
  debt: ReservePosition,
  collateral: ReservePosition,
  requestedDebt: BigNumber,
): ExactLiquidationAmounts | null {
  if (requestedDebt.lte(0)) return null;
  const collateralUnit = BigNumber.from(10).pow(collateral.decimals);
  const debtUnit = BigNumber.from(10).pow(debt.decimals);
  const baseCollateral = debt.price
    .mul(requestedDebt)
    .mul(collateralUnit)
    .div(collateral.price.mul(debtUnit));
  const maxCollateral = percentMulFloor(baseCollateral, collateral.liquidationBonusBps);
  let grossCollateralConsumed: BigNumber;
  let debtAmount: BigNumber;

  if (maxCollateral.gt(collateral.currentATokenBalance)) {
    grossCollateralConsumed = collateral.currentATokenBalance;
    const debtValueInTokenRatio = collateral.price
      .mul(grossCollateralConsumed)
      .mul(debtUnit)
      .div(debt.price.mul(collateralUnit));
    debtAmount = percentDivCeil(debtValueInTokenRatio, collateral.liquidationBonusBps);
  } else {
    grossCollateralConsumed = maxCollateral;
    debtAmount = requestedDebt;
  }
  if (debtAmount.lte(0) || grossCollateralConsumed.lte(0)) return null;

  let protocolFee = BigNumber.from(0);
  let collateralToLiquidator = grossCollateralConsumed;
  if (collateral.liquidationProtocolFeeBps > 0) {
    const noBonusCollateral = percentDivFloor(grossCollateralConsumed, collateral.liquidationBonusBps);
    const bonusCollateral = grossCollateralConsumed.gt(noBonusCollateral)
      ? grossCollateralConsumed.sub(noBonusCollateral)
      : BigNumber.from(0);
    protocolFee = percentMulCeil(bonusCollateral, collateral.liquidationProtocolFeeBps);
    if (protocolFee.gte(grossCollateralConsumed)) return null;
    collateralToLiquidator = grossCollateralConsumed.sub(protocolFee);
  }
  if (collateralToLiquidator.lte(0)) return null;
  return { debtAmount, collateralToLiquidator, protocolFee, grossCollateralConsumed };
}

function liquidationLeavesValidDust(
  debt: ReservePosition,
  collateral: ReservePosition,
  amounts: ExactLiquidationAmounts,
): boolean {
  if (amounts.debtAmount.gte(debt.currentDebt)) return true;
  if (amounts.grossCollateralConsumed.gte(collateral.currentATokenBalance)) return true;
  const debtUnit = BigNumber.from(10).pow(debt.decimals);
  const collateralUnit = BigNumber.from(10).pow(collateral.decimals);
  const leftoverDebtBase = mulDivCeil(debt.currentDebt.sub(amounts.debtAmount), debt.price, debtUnit);
  const leftoverCollateralBase = collateral.currentATokenBalance
    .sub(amounts.grossCollateralConsumed)
    .mul(collateral.price)
    .div(collateralUnit);
  return leftoverDebtBase.gte(MIN_LEFTOVER_BASE) && leftoverCollateralBase.gte(MIN_LEFTOVER_BASE);
}

function maximumProtocolValidLiquidation(input: {
  debt: ReservePosition;
  collateral: ReservePosition;
  healthFactor: BigNumber;
  totalDebtBase: BigNumber;
}): ExactLiquidationAmounts | null {
  const debtUnit = BigNumber.from(10).pow(input.debt.decimals);
  const collateralUnit = BigNumber.from(10).pow(input.collateral.decimals);
  const reserveDebtBase = mulDivCeil(input.debt.currentDebt, input.debt.price, debtUnit);
  const reserveCollateralBase = input.collateral.currentATokenBalance
    .mul(input.collateral.price)
    .div(collateralUnit);

  let maxLiquidatableDebt = input.debt.currentDebt;
  if (
    reserveCollateralBase.gte(MIN_BASE_MAX_CLOSE_FACTOR_THRESHOLD) &&
    reserveDebtBase.gte(MIN_BASE_MAX_CLOSE_FACTOR_THRESHOLD) &&
    input.healthFactor.gt(CLOSE_FACTOR_HF_THRESHOLD)
  ) {
    const totalDefaultLiquidatableDebtBase = percentMulHalfUp(input.totalDebtBase, DEFAULT_LIQUIDATION_CLOSE_FACTOR_BPS);
    if (reserveDebtBase.gt(totalDefaultLiquidatableDebtBase)) {
      maxLiquidatableDebt = totalDefaultLiquidatableDebtBase.mul(debtUnit).div(input.debt.price);
    }
  }
  if (maxLiquidatableDebt.lte(0)) return null;

  const normalize = (requested: BigNumber): ExactLiquidationAmounts | null => {
    let amounts = calculateAaveLiquidationAmounts(input.debt, input.collateral, requested);
    if (!amounts) return null;
    // When collateral is the binding constraint Aave returns debtAmountNeeded,
    // which can be below the requested close-factor cap. Re-evaluate at that exact
    // debt amount so the flash principal and Aave repayment are identical.
    for (let index = 0; index < 3 && amounts.debtAmount.lt(requested); index++) {
      requested = amounts.debtAmount;
      const recalculated = calculateAaveLiquidationAmounts(input.debt, input.collateral, requested);
      if (!recalculated) return null;
      amounts = recalculated;
    }
    return amounts;
  };

  const maximum = normalize(maxLiquidatableDebt);
  if (maximum && liquidationLeavesValidDust(input.debt, input.collateral, maximum)) return maximum;

  // If the protocol maximum would create forbidden residual dust, find the
  // greatest smaller amount that leaves both reserve debt and collateral at or
  // above Aave's MIN_LEFTOVER_BASE. No arbitrary percentage haircut is applied.
  let low = BigNumber.from(0);
  let high = maxLiquidatableDebt;
  while (low.lt(high)) {
    const midpoint = low.add(high).add(1).div(2);
    const amounts = normalize(midpoint);
    if (amounts && liquidationLeavesValidDust(input.debt, input.collateral, amounts)) low = midpoint;
    else high = midpoint.sub(1);
  }
  if (low.lte(0)) return null;
  const result = normalize(low);
  return result && liquidationLeavesValidDust(input.debt, input.collateral, result) ? result : null;
}

function pairEconomics(input: {
  debt: ReservePosition;
  collateral: ReservePosition;
  healthFactor: BigNumber;
  totalDebtBase: BigNumber;
  oracleUnit: BigNumber;
  blockTimestamp: number;
}): PairEconomics | null {
  if (sameAddress(input.debt.asset, input.collateral.asset)) return null;
  if (input.debt.currentDebt.lte(0) || input.collateral.currentATokenBalance.lte(0)) return null;
  if (!input.debt.isActive || !input.collateral.isActive || input.debt.isPaused || input.collateral.isPaused) return null;
  if (!input.collateral.usageAsCollateralEnabled) return null;
  if (input.debt.liquidationGracePeriodUntil >= input.blockTimestamp || input.collateral.liquidationGracePeriodUntil >= input.blockTimestamp) return null;

  const amounts = maximumProtocolValidLiquidation({
    debt: input.debt,
    collateral: input.collateral,
    healthFactor: input.healthFactor,
    totalDebtBase: input.totalDebtBase,
  });
  if (!amounts || amounts.debtAmount.lte(0) || amounts.collateralToLiquidator.lte(0)) return null;

  const debtToCover = amounts.debtAmount;
  const collateralReceived = amounts.collateralToLiquidator;
  // The full protocol-computed amount received by the liquidator is unwound. The
  // former 10 BPS collateral haircut was not a protocol requirement and silently
  // discarded measurable profit.
  const collateralSellAmount = collateralReceived;
  const debtNotionalUsd = baseUnitsToUsd(debtToCover, input.debt.decimals, input.debt.price, input.oracleUnit);
  const receivedValueUsd = baseUnitsToUsd(collateralReceived, input.collateral.decimals, input.collateral.price, input.oracleUnit);
  const fairSellValueUsd = receivedValueUsd;
  const liquidationBonusUsd = receivedValueUsd - debtNotionalUsd;
  if (!(debtNotionalUsd > 0) || !(liquidationBonusUsd > 0)) return null;
  return {
    debt: input.debt,
    collateral: input.collateral,
    debtToCover,
    collateralReceived,
    collateralSellAmount,
    liquidationProtocolFeeAmount: amounts.protocolFee,
    debtNotionalUsd,
    liquidationBonusUsd,
    fairSellValueUsd,
  };
}

async function marketAuthorities(input: {
  chain: ExecutableAaveLiquidationChain;
  borrower: string;
  provider: ethers.providers.JsonRpcProvider;
}): Promise<{
  poolAddress: string;
  pool: Contract;
  dataProvider: Contract;
  oracle: Contract;
  oracleUnit: BigNumber;
  healthFactor: BigNumber;
  totalDebtBase: BigNumber;
  blockTag: number;
  blockTimestamp: number;
  userEModeCategory: number;
  reserves: ReservePosition[];
}> {
  const poolAddress = resolveAaveV3Pool(input.chain as SupportedExecutionChain);
  if (!poolAddress) throw new Error(`Aave V3 pool is not configured for ${input.chain}`);
  const pool = new Contract(poolAddress, POOL_ABI, input.provider);
  const blockTag = await input.provider.getBlockNumber();
  const block = await input.provider.getBlock(blockTag);
  if (!block || !Number.isFinite(block.timestamp)) throw new Error('Aave liquidation snapshot block timestamp is unavailable');
  const calls = { blockTag };

  const [addressesProviderRaw, reservesRaw, accountRaw, userEModeRaw] = await Promise.all([
    pool.ADDRESSES_PROVIDER(calls),
    pool.getReservesList(calls),
    pool.getUserAccountData(input.borrower, calls),
    pool.getUserEMode(input.borrower, calls),
  ]);
  const addressesProvider = new Contract(asAddress('Aave addresses provider', addressesProviderRaw), ADDRESSES_PROVIDER_ABI, input.provider);
  const [dataProviderAddressRaw, oracleAddressRaw] = await Promise.all([
    addressesProvider.getPoolDataProvider(calls),
    addressesProvider.getPriceOracle(calls),
  ]);
  const dataProvider = new Contract(asAddress('Aave pool data provider', dataProviderAddressRaw), DATA_PROVIDER_ABI, input.provider);
  const oracle = new Contract(asAddress('Aave price oracle', oracleAddressRaw), ORACLE_ABI, input.provider);
  const [baseCurrencyRaw, oracleUnitRaw] = await Promise.all([
    oracle.BASE_CURRENCY(calls),
    oracle.BASE_CURRENCY_UNIT(calls),
  ]);
  if (!sameAddress(String(baseCurrencyRaw), ethers.constants.AddressZero)) {
    throw new Error('Aave liquidation exact threshold economics require a USD-base oracle; non-USD base currency fails closed');
  }
  const oracleUnit = BigNumber.from(oracleUnitRaw);
  if (!oracleUnit.eq(AAVE_USD_BASE_UNIT)) {
    throw new Error(`Aave liquidation exact v3 close-factor thresholds require 1e8 USD base units; observed ${oracleUnit.toString()}`);
  }

  const totalDebtBase = BigNumber.from(accountRaw.totalDebtBase ?? accountRaw[1] ?? 0);
  const healthFactor = BigNumber.from(accountRaw.healthFactor ?? accountRaw[5] ?? 0);
  if (healthFactor.gte(HEALTH_FACTOR_LIQUIDATION_THRESHOLD) || healthFactor.lte(0) || totalDebtBase.lte(0)) {
    throw new Error('Aave borrower is no longer currently liquidatable');
  }
  const userEModeCategory = Number(BigNumber.from(userEModeRaw || 0).toString());
  if (!Number.isInteger(userEModeCategory) || userEModeCategory < 0 || userEModeCategory > 255) {
    throw new Error('Aave borrower eMode category is invalid');
  }

  const reserveAddresses = (Array.isArray(reservesRaw) ? reservesRaw : []).map((asset: string) => asAddress('Aave reserve', asset));
  if (reserveAddresses.length === 0) throw new Error('Aave pool returned no active reserve addresses');
  const reserveIds = await resolveReserveIds(pool, reserveAddresses, blockTag);

  let eModeCollateralBitmap: BigNumber | null = null;
  let eModeLiquidationBonusBps: number | null = null;
  if (userEModeCategory !== 0) {
    const [configRaw, bitmapRaw] = await Promise.all([
      pool.getEModeCategoryCollateralConfig(userEModeCategory, calls),
      pool.getEModeCategoryCollateralBitmap(userEModeCategory, calls),
    ]);
    eModeLiquidationBonusBps = Number(configRaw.liquidationBonus ?? configRaw[2]);
    eModeCollateralBitmap = BigNumber.from(bitmapRaw);
    if (!Number.isFinite(eModeLiquidationBonusBps) || eModeLiquidationBonusBps < 10_000 || eModeLiquidationBonusBps > 20_000) {
      throw new Error('Aave eMode liquidation bonus is invalid');
    }
    if (reserveIds.size === 0) throw new Error('Aave eMode liquidation requires exact reserve-id mapping');
  }

  const settled = await Promise.allSettled(reserveAddresses.map(asset => inspectReserve({
    asset,
    reserveId: reserveIds.get(asset.toLowerCase()) ?? null,
    borrower: input.borrower,
    pool,
    dataProvider,
    oracle,
    blockTag,
    eModeCategory: userEModeCategory,
    eModeCollateralBitmap,
    eModeLiquidationBonusBps,
  })));
  const reserveFailures = settled.filter(result => result.status === 'rejected').length;
  const reserves = settled.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);
  if (reserveFailures > 0 && reserves.length === 0) throw new Error('Aave reserve-level liquidation authority could not be read at the snapshot block');
  if (!reserves.some(reserve => reserve.currentDebt.gt(0))) throw new Error('Aave borrower has no measured reserve debt');
  if (!reserves.some(reserve => reserve.usageAsCollateralEnabled && reserve.currentATokenBalance.gt(0))) {
    throw new Error('Aave borrower has no measured collateral reserve');
  }
  return {
    poolAddress,
    pool,
    dataProvider,
    oracle,
    oracleUnit,
    healthFactor,
    totalDebtBase,
    blockTag,
    blockTimestamp: block.timestamp,
    userEModeCategory,
    reserves,
  };
}

async function liveGasUsd(input: {
  chain: ExecutableAaveLiquidationChain;
  provider: ethers.providers.JsonRpcProvider;
  estimatedGas: BigNumber;
}): Promise<number> {
  const [feeData, prices] = await Promise.all([
    input.provider.getFeeData(),
    coinGeckoPriceClient.getLiveSymbolPrices([NATIVE_SYMBOLS[input.chain]]),
  ]);
  const nativePriceUsd = prices.get(NATIVE_SYMBOLS[input.chain]);
  if (!Number.isFinite(nativePriceUsd) || Number(nativePriceUsd) <= 0) {
    throw new Error('Live native-token USD price is unavailable for liquidation gas');
  }
  const feePerGas = feeData.maxFeePerGas || feeData.gasPrice;
  if (!feePerGas || feePerGas.lte(0)) throw new Error('Provider did not return usable current fee data for liquidation gas');
  const nativeFee = Number(ethers.utils.formatEther(input.estimatedGas.mul(feePerGas)));
  const measuredUsd = nativeFee * Number(nativePriceUsd);
  if (!Number.isFinite(measuredUsd) || measuredUsd < 0) throw new Error('Liquidation gas USD measurement is invalid');
  const reserveBps = boundedInt(process.env.CRYPTOCRAWL_LIQUIDATION_GAS_RESERVE_BPS, 1_500, 0, 10_000);
  return measuredUsd * (1 + reserveBps / 10_000);
}

async function executeInfrastructureCalls(input: {
  need: PendingInfrastructureNeed;
  provider: ethers.providers.JsonRpcProvider;
}): Promise<void> {
  if (input.need.calls.length === 0) return;
  requireZeroCapitalInfrastructureDeploymentAllowed({
    chain: input.need.request.chain,
    operation: 'receiver_permissions',
  });
  const wallet = configuredWallet();
  if (!wallet || !sameAddress(wallet.address, input.need.walletAddress)) {
    throw new Error('Aave liquidation infrastructure signer changed since permission need was queued');
  }
  const connected = wallet.connect(input.provider);
  for (const call of input.need.calls) {
    const data = String(call.data || '0x');
    const result = await executeSystemOwnedNativeTransaction({
      chain: input.need.request.chain,
      wallet: connected,
      provider: input.provider,
      idempotencyKey: `liquidation-infra:${input.need.request.chain}:${call.to.toLowerCase()}:${ethers.utils.keccak256(data)}`,
      purpose: 'zero_capital_receiver_permission_setup',
      transaction: { to: call.to, data, value: BigNumber.from(call.value || 0) },
      confirmations: 1,
    });
    if (result.receipt.status !== 1) throw new Error('Aave liquidation receiver permission transaction reverted');
  }
}

function rejected(error: string): AaveLiquidationExecutionResult {
  return { success: false, status: 'rejected', terminal: true, settlementConfirmed: false, error };
}

export function getPreparedAaveLiquidationPlan(opportunityId: string): AaveLiquidationPreparation | null {
  const plan = preparedPlans.get(opportunityId);
  if (!plan || plan.expiresAt <= Date.now()) {
    preparedPlans.delete(opportunityId);
    return null;
  }
  return {
    ...plan,
    payload: { ...plan.payload },
    unwindQuote: { ...plan.unwindQuote },
    ...(plan.simulationAdvisoryErrors ? { simulationAdvisoryErrors: [...plan.simulationAdvisoryErrors] } : {}),
    provenance: [...plan.provenance],
  };
}

/**
 * Read-only liquidation compiler. It binds one same-block Aave state snapshot to
 * exact current close-factor, reserve-value, dust, pause/grace, eMode bonus and
 * protocol-fee rules, then measures flash liquidity, a firm 0x unwind and gas.
 * eth_call validation is advisory only. No transaction is submitted from discovery.
 */
export async function prepareAaveLiquidation(input: AaveLiquidationRequest): Promise<AaveLiquidationPreparation> {
  requestInputs.set(input.opportunityId, { ...input });
  if (!input.opportunityId.trim()) throw new Error('Aave liquidation requires opportunityId');
  if (!ethers.utils.isAddress(input.borrower)) throw new Error('Aave liquidation borrower is invalid');
  if (!Number.isFinite(input.expiresAt) || input.expiresAt <= Date.now()) throw new Error('Aave liquidation request is expired');
  if (!Object.prototype.hasOwnProperty.call(CHAIN_IDS, input.chain)) throw new Error(`Aave liquidation execution is not reviewed for ${input.chain}`);

  await multiProviderRpcManager.initialize([input.chain]);
  const { http: provider } = await multiProviderRpcManager.getProvider(input.chain, 'json_rpc');
  const network = await provider.getNetwork();
  if (network.chainId !== CHAIN_IDS[input.chain]) throw new Error(`Aave liquidation provider chain mismatch for ${input.chain}`);
  const wallet = configuredWallet();
  if (!wallet) throw new Error('Aave liquidation preparation requires the configured execution signer');
  const connectedWallet = wallet.connect(provider);
  const receiverAddress = resolveConfiguredFlashLoanReceiver('aave_v3', input.chain as SupportedExecutionChain);
  if (!receiverAddress) throw new Error('AAVE_LIQUIDATION_AAVE_RECEIVER_NOT_CONFIGURED');
  const receiverCapability = await verifyFlashLoanReceiverCapability({
    kind: 'aave_v3',
    chain: input.chain as SupportedExecutionChain,
    provider,
    expectedOwner: connectedWallet.address,
    address: receiverAddress,
  });
  if (!receiverCapability) throw new Error('AAVE_LIQUIDATION_AAVE_RECEIVER_CAPABILITY_NOT_VERIFIED');
  const receiver = receiverCapability.address;
  if (sameAddress(receiver, input.borrower)) throw new Error('AAVE_LIQUIDATION_BORROWER_EQUALS_LIQUIDATOR_RECEIVER');

  const market = await marketAuthorities({ chain: input.chain, borrower: input.borrower, provider });
  if (!sameAddress(market.poolAddress, receiverCapability.infrastructure)) {
    throw new Error('Aave liquidation receiver pool binding drifted from current market pool');
  }
  const debtReserves = market.reserves.filter(reserve => reserve.currentDebt.gt(0));
  const collateralReserves = market.reserves.filter(reserve => reserve.usageAsCollateralEnabled && reserve.currentATokenBalance.gt(0));
  const pairs = debtReserves.flatMap(debt => collateralReserves.flatMap(collateral => {
    const pair = pairEconomics({
      debt,
      collateral,
      healthFactor: market.healthFactor,
      totalDebtBase: market.totalDebtBase,
      oracleUnit: market.oracleUnit,
      blockTimestamp: market.blockTimestamp,
    });
    return pair ? [pair] : [];
  })).sort((left, right) => right.liquidationBonusUsd - left.liquidationBonusUsd);
  if (pairs.length === 0) throw new Error('Aave liquidation has no protocol-valid debt/collateral pair');

  const failures: string[] = [];
  let bestPlan: AaveLiquidationPreparation | null = null;
  let positivePairsMeasured = 0;
  for (const pair of pairs) {
    try {
      const flash = await measureAaveV3FlashLoanEconomics({
        chain: input.chain as SupportedExecutionChain,
        provider,
        asset: pair.debt.asset,
      });
      if (!flash || !flash.executableEvidenceComplete || flash.availableLiquidity === null || flash.availableLiquidity < pair.debtToCover.toBigInt()) {
        throw new Error('Measured Aave flash-loan liquidity/fee is incomplete for debt reserve');
      }
      const flashFeeAmountRaw = calculateMeasuredFlashLoanFee(flash, pair.debtToCover.toBigInt());
      if (flashFeeAmountRaw === null) throw new Error('Measured Aave flash-loan fee cannot be calculated');
      const flashFeeAmount = BigNumber.from(flashFeeAmountRaw.toString());
      const flashFeeBps = Number(flash.feeBps);
      if (!Number.isFinite(flashFeeBps) || flashFeeBps < 0) throw new Error('Aave flash-loan fee BPS is unknown');

      const quote = await marketDataProviders.getDexQuote({
        chainId: CHAIN_IDS[input.chain],
        sellToken: pair.collateral.asset,
        buyToken: pair.debt.asset,
        sellAmount: pair.collateralSellAmount.toString(),
        takerAddress: receiver,
        purpose: 'execution',
      });
      if (!quote?.buyAmount || !quote.liquidityAvailable) throw new Error('0x firm liquidation unwind is unavailable');
      const unwind = quoteTransaction(quote, pair.collateralSellAmount);
      const unwindBuyUsd = baseUnitsToUsd(unwind.buyAmount, pair.debt.decimals, pair.debt.price, market.oracleUnit);
      const expectedUnwindCostUsd = Math.max(0, pair.fairSellValueUsd - unwindBuyUsd);
      const receiverProfitBeforeGas = unwind.buyAmount.sub(pair.debtToCover).sub(flashFeeAmount);
      if (receiverProfitBeforeGas.lte(0)) throw new Error('Firm liquidation unwind is not positive after Aave flash fee');

      const debtToken = new Contract(pair.debt.asset, ERC20_ABI, provider);
      const existingReceiverDebt = BigNumber.from(await debtToken.balanceOf(receiver));
      if (!existingReceiverDebt.isZero()) {
        throw new Error('Aave liquidation receiver debt-token balance is nonzero; pre-existing balance must not be counted as new profit');
      }

      const manager = getSponsoredReceiverManager();
      const missingPermissionCalls = await manager.buildMissingExplicitPermissionCalls({
        receiver,
        provider,
        targets: [market.poolAddress, unwind.target],
        approvalTokens: [pair.debt.asset, pair.collateral.asset],
      });
      if (missingPermissionCalls.length > 0) {
        pendingInfrastructure.set(input.opportunityId, {
          request: { ...input },
          chainId: CHAIN_IDS[input.chain],
          walletAddress: connectedWallet.address,
          calls: missingPermissionCalls,
          queuedAt: Date.now(),
        });
        throw new Error('AAVE_LIQUIDATION_RECEIVER_PERMISSIONS_NOT_READY');
      }
      pendingInfrastructure.delete(input.opportunityId);

      const simulationAdvisoryErrors: string[] = [];
      const advisorySimulate = async (data: string, stage: string): Promise<void> => {
        try {
          await provider.call({ from: connectedWallet.address, to: receiver, data, value: 0 });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          simulationAdvisoryErrors.push(`${stage}:${message}`);
          logger.debug('[LiquidationExecution] Aave liquidation eth_call advisory failed without vetoing positive executable economics', {
            component: 'AaveLiquidationAtomicExecutor',
            opportunityId: input.opportunityId,
            chain: input.chain,
            borrower: input.borrower,
            debtAsset: pair.debt.asset,
            collateralAsset: pair.collateral.asset,
            stage,
            error: message,
            simulationVetoAuthority: false,
          });
        }
      };

      const profitRecipient = asAddress('operational profit recipient', resolveOperationalProfitRecipient());
      let minProfit = BigNumber.from(1);
      let data = encodeReceiverPayload({
        receiver,
        pool: market.poolAddress,
        borrower: input.borrower,
        debtAsset: pair.debt.asset,
        collateralAsset: pair.collateral.asset,
        debtToCover: pair.debtToCover,
        collateralSellAmount: pair.collateralSellAmount,
        unwind,
        minProfit,
        profitRecipient,
      });
      await advisorySimulate(data, 'preliminary_min_profit');
      let estimatedGas = await provider.estimateGas({ from: connectedWallet.address, to: receiver, data, value: 0 });
      let expectedGasUsd = await liveGasUsd({ chain: input.chain, provider, estimatedGas });
      const gasDebtUnits = usdToTokenUnitsCeil(expectedGasUsd, pair.debt.decimals, pair.debt.price, market.oracleUnit);
      minProfit = gasDebtUnits.add(1);
      if (receiverProfitBeforeGas.lte(minProfit)) throw new Error('Aave liquidation is not positive after measured gas reserve');

      data = encodeReceiverPayload({
        receiver,
        pool: market.poolAddress,
        borrower: input.borrower,
        debtAsset: pair.debt.asset,
        collateralAsset: pair.collateral.asset,
        debtToCover: pair.debtToCover,
        collateralSellAmount: pair.collateralSellAmount,
        unwind,
        minProfit,
        profitRecipient,
      });
      await advisorySimulate(data, 'gas_backed_min_profit');
      const finalEstimatedGas = await provider.estimateGas({ from: connectedWallet.address, to: receiver, data, value: 0 });
      if (finalEstimatedGas.gt(estimatedGas)) {
        estimatedGas = finalEstimatedGas;
        expectedGasUsd = await liveGasUsd({ chain: input.chain, provider, estimatedGas });
        const finalGasDebtUnits = usdToTokenUnitsCeil(expectedGasUsd, pair.debt.decimals, pair.debt.price, market.oracleUnit);
        minProfit = finalGasDebtUnits.add(1);
        if (receiverProfitBeforeGas.lte(minProfit)) throw new Error('Aave liquidation lost positive economics after final gas estimate');
        data = encodeReceiverPayload({
          receiver,
          pool: market.poolAddress,
          borrower: input.borrower,
          debtAsset: pair.debt.asset,
          collateralAsset: pair.collateral.asset,
          debtToCover: pair.debtToCover,
          collateralSellAmount: pair.collateralSellAmount,
          unwind,
          minProfit,
          profitRecipient,
        });
        await advisorySimulate(data, 'final_gas_backed_min_profit');
      }

      const receiverProfitUsd = baseUnitsToUsd(receiverProfitBeforeGas, pair.debt.decimals, pair.debt.price, market.oracleUnit);
      const deterministicNetProfitUsd = receiverProfitUsd - expectedGasUsd;
      if (!Number.isFinite(deterministicNetProfitUsd) || deterministicNetProfitUsd <= 0) {
        throw new Error('Aave liquidation deterministic all-in net profit is not positive');
      }
      const expectedFlashFeeUsd = baseUnitsToUsd(flashFeeAmount, pair.debt.decimals, pair.debt.price, market.oracleUnit);
      const grossProfitUsd = unwindBuyUsd - pair.debtNotionalUsd;
      const grossProfitBps = grossProfitUsd / pair.debtNotionalUsd * 10_000;
      const gasCostBps = expectedGasUsd / pair.debtNotionalUsd * 10_000;
      const allInCostBps = expectedFlashFeeUsd / pair.debtNotionalUsd * 10_000 + gasCostBps;
      const netProfitBps = deterministicNetProfitUsd / pair.debtNotionalUsd * 10_000;
      const quoteTtlMs = Math.max(500, Number(process.env.ZEROX_QUOTE_TTL_MS || 2_000));
      const expiresAt = Math.min(input.expiresAt, quote.observedAt + quoteTtlMs);
      if (expiresAt <= Date.now()) throw new Error('Aave liquidation firm unwind expired during exact preparation');

      const plan: AaveLiquidationPreparation = {
        opportunityId: input.opportunityId,
        chain: input.chain,
        borrower: ethers.utils.getAddress(input.borrower),
        receiver,
        debtAsset: pair.debt.asset,
        debtSymbol: pair.debt.symbol,
        debtDecimals: pair.debt.decimals,
        collateralAsset: pair.collateral.asset,
        collateralSymbol: pair.collateral.symbol,
        collateralDecimals: pair.collateral.decimals,
        debtToCover: pair.debtToCover.toString(),
        collateralExpectedFromLiquidation: pair.collateralReceived.toString(),
        collateralSellAmount: pair.collateralSellAmount.toString(),
        unwindBuyAmount: unwind.buyAmount.toString(),
        flashLoanFeeAmount: flashFeeAmount.toString(),
        expectedLiquidationBonusUsd: pair.liquidationBonusUsd,
        expectedFlashFeeUsd,
        expectedUnwindCostUsd,
        expectedGasUsd,
        deterministicNetProfitUsd,
        notionalUsd: pair.debtNotionalUsd,
        grossProfitBps,
        flashLoanFeeBps,
        gasCostBps,
        allInCostBps,
        netProfitBps,
        minProfit: minProfit.toString(),
        payload: { to: receiver, data, value: '0', gasLimit: Number(estimatedGas.toString()) },
        unwindQuote: quote,
        expiresAt,
        simulated: simulationAdvisoryErrors.length === 0,
        ...(simulationAdvisoryErrors.length > 0 ? { simulationAdvisoryErrors: [...simulationAdvisoryErrors] } : {}),
        provenance: [
          `aave_v3:snapshot_block:${market.blockTag}`,
          'aave_v3:user_reserve_data_all_active_reserves',
          'aave_v3:reserve_id_map_exact_not_list_index',
          `aave_v3:user_emode_category:${market.userEModeCategory}`,
          'aave_v3:emode_liquidation_bonus_applied_when_bitmap_enabled',
          'aave_v3:reserve_active_pause_and_liquidation_grace_period_verified',
          'aave_v3:reserve_configuration_live',
          'aave_v3:liquidation_protocol_fee_live',
          'aave_v3:usd_base_oracle_live',
          'aave_v3:close_factor_total_debt_and_2000usd_reserve_threshold_exact',
          'aave_v3:1000usd_residual_dust_rule_exact',
          'aave_v3:percentage_rounding_floor_ceil_half_up_bound',
          'aave_v3:arbitrary_49_99_close_factor_haircut:false',
          'aave_v3:arbitrary_9950_debt_haircut:false',
          'aave_v3:arbitrary_collateral_sell_bps_haircut:false',
          `aave_v3:liquidation_protocol_fee_amount:${pair.liquidationProtocolFeeAmount.toString()}`,
          'aave_v3:flash_liquidity_and_fee_measured_onchain',
          '0x:v2_allowance_holder_firm_liquidation_unwind',
          `0x:simulation_incomplete_advisory_only:${quote.simulationIncomplete === true}`,
          'receiver:aave_v3_pool_owner_bytecode_binding_verified',
          'receiver:permissions_verified_read_only',
          'receiver:preexisting_debt_token_balance_zero',
          simulationAdvisoryErrors.length === 0 ? 'receiver:eth_call_simulation_advisory_passed' : 'receiver:eth_call_simulation_advisory_unavailable_or_failed',
          'receiver:eth_call_simulation_veto_authority:false',
          'receiver:exact_full_liquidation_gas_estimate',
          'gas:live_native_usd_price_no_static_fallback',
          'gas:bounded_pretrade_reserve',
          'gas:system_owned_native_reservation_required_at_execution',
          'residual_collateral:full_measured_liquidator_amount_unwound',
          'discovery_infrastructure_mutation:false',
          'synthetic_evidence:false',
        ],
      };
      positivePairsMeasured += 1;
      if (!bestPlan || plan.deterministicNetProfitUsd > bestPlan.deterministicNetProfitUsd) bestPlan = plan;
    } catch (error) {
      failures.push(`${pair.debt.symbol}/${pair.collateral.symbol}:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (bestPlan) {
    bestPlan.provenance.push(
      'liquidation_pair_hydration:all_structural_pairs_same_cycle',
      `liquidation_pair_candidates_attempted:${pairs.length}`,
      `liquidation_pair_positive_plans_measured:${positivePairsMeasured}`,
      'liquidation_pair_selection:highest_measured_positive_all_in_net_profit_usd',
    );
    preparedPlans.set(input.opportunityId, bestPlan);
    return getPreparedAaveLiquidationPlan(input.opportunityId)!;
  }
  throw new Error(`Aave liquidation pair hydration failed closed after all ${pairs.length} structural pairs: ${failures.join(' | ')}`);
}

export async function reconcilePendingAaveLiquidationInfrastructure(maxRequests = 1): Promise<AaveLiquidationInfrastructureResult> {
  const ttlMs = Math.max(5_000, Math.min(120_000, Number(process.env.CRYPTOCRAWL_LIQUIDATION_INFRA_REQUEST_TTL_MS || 30_000)));
  const now = Date.now();
  for (const [id, need] of pendingInfrastructure.entries()) {
    if (now - need.queuedAt > ttlMs || need.request.expiresAt <= now) pendingInfrastructure.delete(id);
  }
  const selected = [...pendingInfrastructure.values()]
    .sort((left, right) => left.queuedAt - right.queuedAt)
    .slice(0, Math.max(0, Math.min(4, Math.floor(maxRequests))));
  const details: AaveLiquidationInfrastructureResult['details'] = [];
  let prepared = 0;
  let failed = 0;
  for (const need of selected) {
    try {
      await multiProviderRpcManager.initialize([need.request.chain]);
      const { http: provider } = await multiProviderRpcManager.getProvider(need.request.chain, 'json_rpc');
      await executeInfrastructureCalls({ need, provider });
      pendingInfrastructure.delete(need.request.opportunityId);
      prepared++;
      details.push({ opportunityId: need.request.opportunityId, chain: need.request.chain, ready: true });
      logger.info('[LiquidationExecution] Receiver permissions reconciled beneath canonical scheduler', {
        component: 'AaveLiquidationAtomicExecutor',
        opportunityId: need.request.opportunityId,
        chain: need.request.chain,
        liquidationSubmitted: false,
        discoveryMutationAuthority: false,
        personalGasFallbackAllowed: false,
      });
    } catch (error) {
      failed++;
      details.push({
        opportunityId: need.request.opportunityId,
        chain: need.request.chain,
        ready: false,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { attempted: selected.length, prepared, failed, remaining: pendingInfrastructure.size, details };
}

export async function executePreparedAaveLiquidation(
  opportunityId: string,
  options: { fundingMode?: 'sponsored' | 'native' } = {},
): Promise<AaveLiquidationExecutionResult> {
  const request = requestInputs.get(opportunityId);
  if (!request) return rejected('AAVE_LIQUIDATION_REQUEST_CONTEXT_MISSING');
  if (!stageManager.canExecuteTrades()) return rejected('AAVE_LIQUIDATION_STAGE_NOT_EXECUTABLE');
  getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', { chain: request.chain });

  let plan: AaveLiquidationPreparation;
  try { plan = await prepareAaveLiquidation(request); }
  catch (error) { return rejected(error instanceof Error ? error.message : String(error)); }
  if (!(plan.deterministicNetProfitUsd > 0) || plan.expiresAt <= Date.now()) {
    return rejected('AAVE_LIQUIDATION_FRESH_ALL_IN_ECONOMICS_NOT_POSITIVE');
  }

  await multiProviderRpcManager.initialize([request.chain]);
  const { http: provider } = await multiProviderRpcManager.getProvider(request.chain, 'json_rpc');
  const wallet = configuredWallet();
  if (!wallet) return rejected('AAVE_LIQUIDATION_SIGNER_MISSING');
  const connectedWallet = wallet.connect(provider);
  const debtToken = new Contract(plan.debtAsset, ERC20_ABI, provider);
  const sponsor = getGasSponsorManager();
  const requestedFundingMode = options.fundingMode ?? 'native';
  let transactionHash: string | undefined;
  let fundingModeUsed: 'sponsored' | 'native' | undefined;
  let nativeReceipt: ethers.providers.TransactionReceipt | null = null;

  try {
    const preSubmitDebt = BigNumber.from(await debtToken.balanceOf(plan.receiver));
    if (!preSubmitDebt.isZero()) return rejected('AAVE_LIQUIDATION_RECEIVER_DEBT_BALANCE_CHANGED_BEFORE_SUBMISSION');

    if (requestedFundingMode === 'sponsored') {
      if (!sponsor.getReadiness().ready) return rejected('AAVE_LIQUIDATION_SPONSORSHIP_NOT_READY_FOR_LEASED_MODE');
      const sponsored = await sponsor.execute({
        wallet: connectedWallet,
        chainId: CHAIN_IDS[request.chain],
        calls: [{ to: plan.payload.to, data: plan.payload.data, value: BigNumber.from(0) }],
        timeoutMs: Math.max(10_000, Number(process.env.ZERO_CAPITAL_SPONSORED_EXECUTION_TIMEOUT_MS || 90_000)),
      });
      transactionHash = sponsored.transactionHash;
      fundingModeUsed = 'sponsored';
    } else {
      const native = await executeSystemOwnedNativeTransaction({
        chain: request.chain,
        wallet: connectedWallet,
        provider,
        idempotencyKey: `aave-liquidation:${opportunityId}:${plan.receiver.toLowerCase()}`,
        purpose: 'aave_liquidation_execution',
        transaction: {
          to: plan.payload.to,
          data: plan.payload.data,
          value: 0,
          gasLimit: plan.payload.gasLimit,
        },
        confirmations: 1,
        preBroadcastCheck: async () => {
          const latestDebtBalance = BigNumber.from(await debtToken.balanceOf(plan.receiver));
          if (!latestDebtBalance.isZero()) throw new Error('AAVE_LIQUIDATION_RECEIVER_DEBT_BALANCE_CHANGED_INSIDE_SIGNER_LANE');
        },
      });
      transactionHash = native.transactionHash;
      nativeReceipt = native.receipt;
      fundingModeUsed = 'native';
    }

    const receipt = nativeReceipt || await provider.waitForTransaction(
      transactionHash,
      1,
      Math.max(15_000, Number(process.env.ZERO_CAPITAL_RECEIPT_TIMEOUT_MS || 120_000)),
    );
    if (!receipt) {
      return {
        success: false,
        status: 'settlement_unknown',
        terminal: false,
        settlementConfirmed: false,
        transactionHash,
        fundingModeUsed,
        error: 'AAVE_LIQUIDATION_RECEIPT_UNAVAILABLE',
      };
    }
    const receiptStatus = receipt.status === 1 ? 1 : 0;
    const gasUsed = receipt.gasUsed?.toString();
    const effectiveGasPriceWei = receipt.effectiveGasPrice?.toString();
    if (receiptStatus !== 1) {
      return {
        success: false,
        status: 'failed',
        terminal: true,
        settlementConfirmed: true,
        transactionHash,
        fundingModeUsed,
        receiptStatus,
        gasUsed,
        effectiveGasPriceWei,
        error: 'AAVE_LIQUIDATION_RECEIPT_REVERTED',
      };
    }

    const iface = new ethers.utils.Interface(RECEIVER_ABI);
    let receiverProfit: BigNumber | null = null;
    for (const log of receipt.logs) {
      if (!sameAddress(log.address, plan.receiver)) continue;
      try {
        const parsed = iface.parseLog(log);
        if (parsed.name !== 'FlashLoanExecuted') continue;
        const loanToken = String(parsed.args.loanToken || '');
        const loanAmount = BigNumber.from(parsed.args.loanAmount || 0);
        if (!sameAddress(loanToken, plan.debtAsset) || !loanAmount.eq(plan.debtToCover)) {
          return {
            success: false,
            status: 'failed',
            terminal: true,
            settlementConfirmed: true,
            transactionHash,
            fundingModeUsed,
            receiptStatus,
            gasUsed,
            effectiveGasPriceWei,
            error: 'AAVE_LIQUIDATION_TERMINAL_EVENT_IDENTITY_MISMATCH',
          };
        }
        receiverProfit = BigNumber.from(parsed.args.profit);
      } catch {
        // Unrelated receiver log.
      }
    }
    if (!receiverProfit || receiverProfit.lte(0)) {
      return {
        success: false,
        status: 'failed',
        terminal: true,
        settlementConfirmed: true,
        transactionHash,
        fundingModeUsed,
        receiptStatus,
        gasUsed,
        effectiveGasPriceWei,
        error: 'AAVE_LIQUIDATION_TERMINAL_PROFIT_EVENT_MISSING_OR_NONPOSITIVE',
      };
    }

    const realizedReceiverProfitUsd = Number(ethers.utils.formatUnits(receiverProfit, plan.debtDecimals))
      * (plan.notionalUsd / Number(ethers.utils.formatUnits(plan.debtToCover, plan.debtDecimals)));
    const realizedReceiverProfitBps = realizedReceiverProfitUsd / plan.notionalUsd * 10_000;
    if (!Number.isFinite(realizedReceiverProfitUsd) || realizedReceiverProfitUsd <= 0) {
      return {
        success: false,
        status: 'failed',
        terminal: true,
        settlementConfirmed: true,
        transactionHash,
        fundingModeUsed,
        receiptStatus,
        gasUsed,
        effectiveGasPriceWei,
        error: 'AAVE_LIQUIDATION_REALIZED_RECEIVER_PROFIT_USD_INVALID',
      };
    }

    logger.info('[LiquidationExecution] Terminal Aave receiver event confirmed; all-in gas reconciliation delegated to canonical adapter', {
      component: 'AaveLiquidationAtomicExecutor',
      opportunityId,
      chain: request.chain,
      transactionHash,
      fundingModeUsed,
      borrower: plan.borrower,
      debtAsset: plan.debtAsset,
      collateralAsset: plan.collateralAsset,
      receiverProfitUsd: realizedReceiverProfitUsd,
      receiverProfitBps: realizedReceiverProfitBps,
      gasUsed,
      effectiveGasPriceWei,
      settlementConfirmed: true,
      personalGasFallbackAllowed: false,
      systemOwnedNativeGasLedgerApplied: fundingModeUsed === 'native',
      simulationVetoAuthority: false,
      syntheticEvidence: false,
    });
    return {
      success: true,
      status: 'filled',
      terminal: true,
      settlementConfirmed: true,
      transactionHash,
      fundingModeUsed,
      receiptStatus,
      gasUsed,
      effectiveGasPriceWei,
      realizedReceiverProfitUsd,
      realizedReceiverProfitBps,
    };
  } catch (error) {
    return transactionHash
      ? {
          success: false,
          status: 'settlement_unknown',
          terminal: false,
          settlementConfirmed: false,
          transactionHash,
          fundingModeUsed,
          error: error instanceof Error ? error.message : String(error),
        }
      : {
          success: false,
          status: 'failed',
          terminal: true,
          settlementConfirmed: false,
          fundingModeUsed,
          error: error instanceof Error ? error.message : String(error),
        };
  }
}
