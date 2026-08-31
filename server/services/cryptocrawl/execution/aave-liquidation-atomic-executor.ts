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
import { withEvmSignerLane } from './evm-signer-lane.js';

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
  simulated: true;
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
};

type PairEconomics = {
  debt: ReservePosition;
  collateral: ReservePosition;
  debtToCover: BigNumber;
  collateralReceived: BigNumber;
  collateralSellAmount: BigNumber;
  debtNotionalUsd: number;
  liquidationBonusUsd: number;
  fairSellValueUsd: number;
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
  'function getUserConfiguration(address user) view returns (uint256 data)',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase,uint256 totalDebtBase,uint256 availableBorrowsBase,uint256 currentLiquidationThreshold,uint256 ltv,uint256 healthFactor)',
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
const CLOSE_FACTOR_HF_THRESHOLD = BigNumber.from('950000000000000000');
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

function percentMulCeil(value: BigNumber, bps: number): BigNumber {
  return ceilDiv(value.mul(boundedInt(bps, 0, 0, 100_000)), PERCENTAGE_FACTOR);
}

function percentDivFloor(value: BigNumber, bps: number): BigNumber {
  const normalized = boundedInt(bps, 0, 1, 100_000);
  return value.mul(PERCENTAGE_FACTOR).div(normalized);
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

async function inspectReserve(input: {
  asset: string;
  borrower: string;
  dataProvider: Contract;
  oracle: Contract;
  borrowing: boolean;
  collateral: boolean;
}): Promise<ReservePosition | null> {
  const [userRaw, configRaw, priceRaw, symbolRaw] = await Promise.all([
    input.dataProvider.getUserReserveData(input.asset, input.borrower),
    input.dataProvider.getReserveConfigurationData(input.asset),
    input.oracle.getAssetPrice(input.asset),
    new Contract(input.asset, ERC20_ABI, input.dataProvider.provider).symbol().catch(() => input.asset.slice(0, 10)),
  ]);
  const decimals = Number(configRaw.decimals ?? configRaw[0]);
  const liquidationBonusBps = Number(configRaw.liquidationBonus ?? configRaw[3]);
  const isActive = Boolean(configRaw.isActive ?? configRaw[8]);
  const currentATokenBalance = BigNumber.from(userRaw.currentATokenBalance ?? userRaw[0] ?? 0);
  const stableDebt = BigNumber.from(userRaw.currentStableDebt ?? userRaw[1] ?? 0);
  const variableDebt = BigNumber.from(userRaw.currentVariableDebt ?? userRaw[2] ?? 0);
  const currentDebt = stableDebt.add(variableDebt);
  const usageAsCollateralEnabled = Boolean(userRaw.usageAsCollateralEnabled ?? userRaw[8]);
  const price = BigNumber.from(priceRaw);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36 || !isActive || price.lte(0)) return null;
  if (input.borrowing && currentDebt.lte(0)) return null;
  if (input.collateral && (!usageAsCollateralEnabled || currentATokenBalance.lte(0))) return null;
  let liquidationProtocolFeeBps = 0;
  if (input.collateral) {
    const raw = await input.dataProvider.getLiquidationProtocolFee(input.asset);
    liquidationProtocolFeeBps = Number(raw.toString());
    if (!Number.isFinite(liquidationProtocolFeeBps) || liquidationProtocolFeeBps < 0 || liquidationProtocolFeeBps > 10_000) return null;
  }
  if (!Number.isFinite(liquidationBonusBps) || liquidationBonusBps < 10_000 || liquidationBonusBps > 20_000) return null;
  return {
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
  };
}

function pairEconomics(input: {
  debt: ReservePosition;
  collateral: ReservePosition;
  healthFactor: BigNumber;
  oracleUnit: BigNumber;
}): PairEconomics | null {
  if (sameAddress(input.debt.asset, input.collateral.asset)) return null;
  if (input.debt.currentDebt.lte(0) || input.collateral.currentATokenBalance.lte(0)) return null;

  // Current Aave V3 liquidation logic permits 50% by default above HF 0.95 and
  // may permit 100% below it (and for certain small/dust positions). We stay
  // deliberately inside those maxima: 49% / 99%, then apply another 0.5% sizing
  // haircut so execution never depends on exact close-factor or dust boundaries.
  const closeFactorBps = input.healthFactor.gt(CLOSE_FACTOR_HF_THRESHOLD) ? 4_900 : 9_900;
  const debtCloseCap = percentMulFloor(input.debt.currentDebt, closeFactorBps);
  if (debtCloseCap.lte(0)) return null;

  const collateralUnit = BigNumber.from(10).pow(input.collateral.decimals);
  const debtUnit = BigNumber.from(10).pow(input.debt.decimals);
  const collateralDebtCapacityNumerator = input.collateral.price
    .mul(input.collateral.currentATokenBalance)
    .mul(debtUnit)
    .mul(PERCENTAGE_FACTOR);
  const collateralDebtCapacityDenominator = input.debt.price
    .mul(collateralUnit)
    .mul(input.collateral.liquidationBonusBps);
  if (collateralDebtCapacityDenominator.lte(0)) return null;
  const collateralDebtCap = collateralDebtCapacityNumerator.div(collateralDebtCapacityDenominator);
  let debtToCover = minBigNumber(debtCloseCap, collateralDebtCap);
  debtToCover = percentMulFloor(debtToCover, 9_950);
  if (debtToCover.lte(0)) return null;

  const baseCollateral = input.debt.price
    .mul(debtToCover)
    .mul(collateralUnit)
    .div(input.collateral.price.mul(debtUnit));
  let collateralReceived = percentMulFloor(baseCollateral, input.collateral.liquidationBonusBps);
  collateralReceived = minBigNumber(collateralReceived, input.collateral.currentATokenBalance);
  if (collateralReceived.lte(1)) return null;

  if (input.collateral.liquidationProtocolFeeBps > 0) {
    const noBonusCollateral = percentDivFloor(collateralReceived, input.collateral.liquidationBonusBps);
    const bonusCollateral = collateralReceived.gt(noBonusCollateral)
      ? collateralReceived.sub(noBonusCollateral)
      : BigNumber.from(0);
    const protocolFee = percentMulCeil(bonusCollateral, input.collateral.liquidationProtocolFeeBps);
    if (protocolFee.gte(collateralReceived)) return null;
    collateralReceived = collateralReceived.sub(protocolFee);
  }

  // Leave a small collateral residue rather than risk an exact-output mismatch
  // from one-unit protocol rounding/state movement. Residual collateral is not
  // counted as deterministic profit.
  const sellBps = boundedInt(process.env.CRYPTOCRAWL_LIQUIDATION_COLLATERAL_SELL_BPS, 9_990, 9_500, 9_999);
  const collateralSellAmount = percentMulFloor(collateralReceived, sellBps);
  if (collateralSellAmount.lte(0)) return null;

  const debtNotionalUsd = baseUnitsToUsd(debtToCover, input.debt.decimals, input.debt.price, input.oracleUnit);
  const receivedValueUsd = baseUnitsToUsd(collateralReceived, input.collateral.decimals, input.collateral.price, input.oracleUnit);
  const fairSellValueUsd = baseUnitsToUsd(collateralSellAmount, input.collateral.decimals, input.collateral.price, input.oracleUnit);
  const liquidationBonusUsd = Math.max(0, receivedValueUsd - debtNotionalUsd);
  if (!(debtNotionalUsd > 0) || !(liquidationBonusUsd > 0)) return null;
  return {
    debt: input.debt,
    collateral: input.collateral,
    debtToCover,
    collateralReceived,
    collateralSellAmount,
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
  reserves: ReservePosition[];
}> {
  const poolAddress = resolveAaveV3Pool(input.chain as SupportedExecutionChain);
  if (!poolAddress) throw new Error(`Aave V3 pool is not configured for ${input.chain}`);
  const pool = new Contract(poolAddress, POOL_ABI, input.provider);
  const [addressesProviderRaw, reservesRaw, userConfigurationRaw, accountRaw] = await Promise.all([
    pool.ADDRESSES_PROVIDER(),
    pool.getReservesList(),
    pool.getUserConfiguration(input.borrower),
    pool.getUserAccountData(input.borrower),
  ]);
  const addressesProvider = new Contract(asAddress('Aave addresses provider', addressesProviderRaw), ADDRESSES_PROVIDER_ABI, input.provider);
  const [dataProviderAddressRaw, oracleAddressRaw] = await Promise.all([
    addressesProvider.getPoolDataProvider(),
    addressesProvider.getPriceOracle(),
  ]);
  const dataProvider = new Contract(asAddress('Aave pool data provider', dataProviderAddressRaw), DATA_PROVIDER_ABI, input.provider);
  const oracle = new Contract(asAddress('Aave price oracle', oracleAddressRaw), ORACLE_ABI, input.provider);
  const [baseCurrencyRaw, oracleUnitRaw] = await Promise.all([
    oracle.BASE_CURRENCY(),
    oracle.BASE_CURRENCY_UNIT(),
  ]);
  if (!sameAddress(String(baseCurrencyRaw), ethers.constants.AddressZero)) {
    throw new Error('Aave liquidation USD economics require a USD-base oracle; non-USD base currency fails closed');
  }
  const oracleUnit = BigNumber.from(oracleUnitRaw);
  if (oracleUnit.lte(0)) throw new Error('Aave oracle base currency unit is invalid');
  const healthFactor = BigNumber.from(accountRaw.healthFactor ?? accountRaw[5] ?? 0);
  if (healthFactor.gte(BigNumber.from('1000000000000000000')) || healthFactor.lte(0)) {
    throw new Error('Aave borrower is no longer currently liquidatable');
  }

  const userConfiguration = BigNumber.from(userConfigurationRaw.data ?? userConfigurationRaw[0] ?? userConfigurationRaw);
  const reserveAddresses = (Array.isArray(reservesRaw) ? reservesRaw : []).map((asset: string) => asAddress('Aave reserve', asset));
  const activeRequests = reserveAddresses.flatMap((asset, index) => {
    const borrowing = !userConfiguration.shr(index * 2).and(1).isZero();
    const collateral = !userConfiguration.shr(index * 2 + 1).and(1).isZero();
    return borrowing || collateral ? [{ asset, borrowing, collateral }] : [];
  });
  if (activeRequests.length === 0) throw new Error('Aave user configuration has no active borrow/collateral reserves');

  const settled = await Promise.allSettled(activeRequests.map(request => inspectReserve({
    asset: request.asset,
    borrower: input.borrower,
    dataProvider,
    oracle,
    borrowing: request.borrowing,
    collateral: request.collateral,
  })));
  const reserves = settled.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);
  if (!reserves.some(reserve => reserve.currentDebt.gt(0))) throw new Error('Aave borrower has no measured reserve debt');
  if (!reserves.some(reserve => reserve.usageAsCollateralEnabled && reserve.currentATokenBalance.gt(0))) {
    throw new Error('Aave borrower has no measured collateral reserve');
  }
  return { poolAddress, pool, dataProvider, oracle, oracleUnit, healthFactor, reserves };
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
  const sponsor = getGasSponsorManager();
  if (sponsor.getReadiness().ready) {
    const result = await sponsor.execute({
      wallet: connected,
      chainId: input.need.chainId,
      calls: input.need.calls,
      timeoutMs: Math.max(10_000, Number(process.env.ZERO_CAPITAL_SPONSORED_DEPLOY_TIMEOUT_MS || 90_000)),
    });
    if (!result.transactionHash) throw new Error('Sponsored Aave liquidation permission transaction returned no hash');
    return;
  }
  await withEvmSignerLane({
    chainId: input.need.chainId,
    walletAddress: connected.address,
    operation: async () => {
      for (const call of input.need.calls) {
        const transaction = await connected.sendTransaction({
          to: call.to,
          data: call.data,
          value: BigNumber.from(call.value || 0),
        });
        const receipt = await transaction.wait(1);
        if (!receipt || receipt.status !== 1) throw new Error('Aave liquidation receiver permission transaction reverted');
      }
    },
  });
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
    provenance: [...plan.provenance],
  };
}

/**
 * Read-only liquidation compiler. It discovers the borrower's active Aave reserve
 * bitmap, reads reserve debt/collateral/configuration/oracle state, applies a
 * conservative close-factor haircut, verifies measured Aave flash liquidity and
 * fee, obtains a firm 0x unwind, verifies existing receiver permissions, and then
 * exact-simulates the complete flash-loan -> liquidationCall -> unwind payload.
 * No transaction is submitted from discovery.
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

  const market = await marketAuthorities({ chain: input.chain, borrower: input.borrower, provider });
  if (!sameAddress(market.poolAddress, receiverCapability.infrastructure)) {
    throw new Error('Aave liquidation receiver pool binding drifted from current market pool');
  }
  const debtReserves = market.reserves.filter(reserve => reserve.currentDebt.gt(0));
  const collateralReserves = market.reserves.filter(reserve => reserve.usageAsCollateralEnabled && reserve.currentATokenBalance.gt(0));
  const pairs = debtReserves.flatMap(debt => collateralReserves.flatMap(collateral => {
    const pair = pairEconomics({ debt, collateral, healthFactor: market.healthFactor, oracleUnit: market.oracleUnit });
    return pair ? [pair] : [];
  })).sort((left, right) => right.liquidationBonusUsd - left.liquidationBonusUsd);
  if (pairs.length === 0) throw new Error('Aave liquidation has no conservative debt/collateral pair');

  const pairLimit = boundedInt(process.env.CRYPTOCRAWL_LIQUIDATION_PAIR_HYDRATION_LIMIT, 2, 1, 6);
  const failures: string[] = [];
  for (const pair of pairs.slice(0, pairLimit)) {
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
      await provider.call({ from: connectedWallet.address, to: receiver, data, value: 0 });
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
      await provider.call({ from: connectedWallet.address, to: receiver, data, value: 0 });
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
        await provider.call({ from: connectedWallet.address, to: receiver, data, value: 0 });
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
        simulated: true,
        provenance: [
          'aave_v3:user_configuration_bitmap',
          'aave_v3:user_reserve_data',
          'aave_v3:reserve_configuration_live',
          'aave_v3:liquidation_protocol_fee_live',
          'aave_v3:usd_base_oracle_live',
          'aave_v3:conservative_close_factor_49_or_99_percent',
          'aave_v3:close_factor_boundary_haircut',
          'aave_v3:flash_liquidity_and_fee_measured_onchain',
          '0x:v2_allowance_holder_firm_liquidation_unwind',
          'receiver:aave_v3_pool_owner_bytecode_binding_verified',
          'receiver:permissions_verified_read_only',
          'receiver:preexisting_debt_token_balance_zero',
          'receiver:exact_full_liquidation_eth_call',
          'receiver:exact_full_liquidation_gas_estimate',
          'gas:live_native_usd_price_no_static_fallback',
          'gas:bounded_pretrade_reserve',
          'residual_collateral:not_counted_as_profit',
          'discovery_infrastructure_mutation:false',
          'synthetic_evidence:false',
        ],
      };
      preparedPlans.set(input.opportunityId, plan);
      return getPreparedAaveLiquidationPlan(input.opportunityId)!;
    } catch (error) {
      failures.push(`${pair.debt.symbol}/${pair.collateral.symbol}:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Aave liquidation pair hydration failed closed: ${failures.join(' | ')}`);
}

/**
 * Canonical-scheduler subordinate infrastructure reconciliation. It can only
 * apply already-computed receiver target/token permissions and never submits a
 * liquidation or mutates discovery state directly.
 */
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
  const requestedFundingMode = options.fundingMode ?? (sponsor.getReadiness().ready ? 'sponsored' : 'native');
  let transactionHash: string | undefined;
  let fundingModeUsed: 'sponsored' | 'native' | undefined;

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
      transactionHash = await withEvmSignerLane({
        chainId: CHAIN_IDS[request.chain],
        walletAddress: connectedWallet.address,
        operation: async () => {
          const latestDebtBalance = BigNumber.from(await debtToken.balanceOf(plan.receiver));
          if (!latestDebtBalance.isZero()) throw new Error('AAVE_LIQUIDATION_RECEIVER_DEBT_BALANCE_CHANGED_INSIDE_SIGNER_LANE');
          const transaction = await connectedWallet.sendTransaction({
            to: plan.payload.to,
            data: plan.payload.data,
            value: 0,
            gasLimit: plan.payload.gasLimit,
          });
          return transaction.hash;
        },
      });
      fundingModeUsed = 'native';
    }

    const receipt = await provider.waitForTransaction(
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
