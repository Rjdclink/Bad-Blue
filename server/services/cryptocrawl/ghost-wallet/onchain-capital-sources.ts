import { Contract, providers, utils } from 'ethers';
import type { GhostWalletCapitalQuote } from './capital-fabric.js';

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
];
const AAVE_DEBT_TOKEN_ABI = [
  'function borrowAllowance(address fromUser,address toUser) view returns (uint256)',
];
const GHOST_VAULT_ABI = [
  'function asset() view returns (address)',
  'function totalAssets() view returns (uint256)',
  'function minimumAtomicFeeBps() view returns (uint16)',
  'function intermediary() view returns (address)',
];
const EULER_VAULT_ABI = [
  'function checkLiquidation(address liquidator,address violator,address collateral) view returns (uint256 maxRepay,uint256 maxYield)',
];

export interface GhostWalletRuntimeContext {
  providers: Map<string, providers.JsonRpcProvider>;
  intermediaryByChain: Map<string, string>;
}

export interface AaveDelegationSourceConfig {
  chain: string;
  asset: string;
  debtToken: string;
  delegator: string;
  liquidityHolder: string;
  label?: string;
}

export interface EulerDebtAssumptionConfig {
  chain: string;
  asset: string;
  vault: string;
  debtToken: string;
  violator: string;
  collateral: string;
  label?: string;
}

export interface GhostWalletVaultSourceConfig {
  chain: string;
  vault: string;
  label?: string;
}

export interface GhostWalletSourceConfig {
  intermediaries: Array<{ chain: string; address: string }>;
  aaveDelegations: AaveDelegationSourceConfig[];
  eulerDebtAssumptions: EulerDebtAssumptionConfig[];
  capitalVaults: GhostWalletVaultSourceConfig[];
}

export interface GhostWalletSourceMeasurement {
  observedAt: number;
  quotes: GhostWalletCapitalQuote[];
  errors: Array<{ source: string; chain?: string; error: string }>;
}

function normalizeChain(value: string): string {
  return value.trim().toLowerCase();
}

function address(name: string, value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return utils.getAddress(value.trim());
}

function stringValue(name: string, value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function parseArray<T>(name: string, raw: string | undefined): T[] {
  if (!raw?.trim()) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`${name} must be a JSON array`);
  return parsed as T[];
}

function quoteTtlMs(): number {
  const configured = Number(process.env.GHOST_WALLET_SOURCE_QUOTE_TTL_MS || 5_000);
  return Number.isFinite(configured)
    ? Math.max(500, Math.min(30_000, Math.trunc(configured)))
    : 5_000;
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function bigint(value: any): bigint {
  return BigInt(value.toString());
}

export function loadGhostWalletSourceConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GhostWalletSourceConfig {
  const intermediaryRows = parseArray<Record<string, unknown>>(
    'GHOST_WALLET_INTERMEDIARIES_JSON',
    environment.GHOST_WALLET_INTERMEDIARIES_JSON,
  );
  const aaveRows = parseArray<Record<string, unknown>>(
    'GHOST_WALLET_AAVE_DELEGATIONS_JSON',
    environment.GHOST_WALLET_AAVE_DELEGATIONS_JSON,
  );
  const eulerRows = parseArray<Record<string, unknown>>(
    'GHOST_WALLET_EULER_DEBT_ASSUMPTIONS_JSON',
    environment.GHOST_WALLET_EULER_DEBT_ASSUMPTIONS_JSON,
  );
  const vaultRows = parseArray<Record<string, unknown>>(
    'GHOST_WALLET_CAPITAL_VAULTS_JSON',
    environment.GHOST_WALLET_CAPITAL_VAULTS_JSON,
  );

  return {
    intermediaries: intermediaryRows.map((row, index) => ({
      chain: normalizeChain(stringValue(`intermediaries[${index}].chain`, row.chain)),
      address: address(`intermediaries[${index}].address`, row.address),
    })),
    aaveDelegations: aaveRows.map((row, index) => ({
      chain: normalizeChain(stringValue(`aaveDelegations[${index}].chain`, row.chain)),
      asset: address(`aaveDelegations[${index}].asset`, row.asset),
      debtToken: address(`aaveDelegations[${index}].debtToken`, row.debtToken),
      delegator: address(`aaveDelegations[${index}].delegator`, row.delegator),
      liquidityHolder: address(`aaveDelegations[${index}].liquidityHolder`, row.liquidityHolder),
      ...(typeof row.label === 'string' && row.label.trim() ? { label: row.label.trim() } : {}),
    })),
    eulerDebtAssumptions: eulerRows.map((row, index) => ({
      chain: normalizeChain(stringValue(`eulerDebtAssumptions[${index}].chain`, row.chain)),
      asset: address(`eulerDebtAssumptions[${index}].asset`, row.asset),
      vault: address(`eulerDebtAssumptions[${index}].vault`, row.vault),
      debtToken: address(`eulerDebtAssumptions[${index}].debtToken`, row.debtToken),
      violator: address(`eulerDebtAssumptions[${index}].violator`, row.violator),
      collateral: address(`eulerDebtAssumptions[${index}].collateral`, row.collateral),
      ...(typeof row.label === 'string' && row.label.trim() ? { label: row.label.trim() } : {}),
    })),
    capitalVaults: vaultRows.map((row, index) => ({
      chain: normalizeChain(stringValue(`capitalVaults[${index}].chain`, row.chain)),
      vault: address(`capitalVaults[${index}].vault`, row.vault),
      ...(typeof row.label === 'string' && row.label.trim() ? { label: row.label.trim() } : {}),
    })),
  };
}

export function buildGhostWalletRuntimeContext(input: {
  providers: Map<string, providers.JsonRpcProvider>;
  config: GhostWalletSourceConfig;
}): GhostWalletRuntimeContext {
  const intermediaryByChain = new Map<string, string>();
  for (const entry of input.config.intermediaries) intermediaryByChain.set(normalizeChain(entry.chain), entry.address);
  return { providers: input.providers, intermediaryByChain };
}

async function measureAaveDelegation(input: {
  config: AaveDelegationSourceConfig;
  provider: providers.JsonRpcProvider;
  intermediary: string;
  observedAt: number;
}): Promise<GhostWalletCapitalQuote | null> {
  const { config, provider, intermediary, observedAt } = input;
  const debt = new Contract(config.debtToken, AAVE_DEBT_TOKEN_ABI, provider);
  const asset = new Contract(config.asset, ERC20_ABI, provider);
  const [allowanceRaw, liquidRaw] = await Promise.all([
    debt.borrowAllowance(config.delegator, intermediary),
    asset.balanceOf(config.liquidityHolder),
  ]);
  const allowance = bigint(allowanceRaw);
  const liquid = bigint(liquidRaw);
  const availablePrincipal = minBigInt(allowance, liquid);
  if (availablePrincipal <= 0n) return null;
  const expiresAt = observedAt + quoteTtlMs();
  return {
    quoteId: `aave-credit:${config.chain}:${config.debtToken.toLowerCase()}:${config.delegator.toLowerCase()}`,
    primitive: 'aave_credit_delegation',
    resourceForm: 'liability_capacity',
    executionSurface: 'atomic_liability_cycle',
    chain: config.chain,
    asset: config.asset,
    sourceAddress: config.debtToken,
    availablePrincipal,
    variableFeeBps: 0,
    fixedFee: 0n,
    observedAt,
    expiresAt,
    sameTransactionSettlement: true,
    repaymentFailureReverts: true,
    operatorMonetaryInputRequired: false,
    apiKeyRequired: false,
    signupRequired: false,
    measured: true,
    exactSimulationRequired: true,
    reliabilityScore: 1,
    provenance: [
      'aave_variable_debt_borrow_allowance_measured_onchain',
      'underlying_liquidity_holder_balance_measured_onchain',
      'delegated_debt_must_return_to_pretransaction_balance',
      'same_transaction_repayment_required',
      'api_key_required:false',
      'signup_required:false',
      'synthetic_capacity:false',
    ],
    metadata: {
      delegator: config.delegator,
      debtToken: config.debtToken,
      liquidityHolder: config.liquidityHolder,
      ...(config.label ? { label: config.label } : {}),
    },
  };
}

async function measureEulerDebtAssumption(input: {
  config: EulerDebtAssumptionConfig;
  provider: providers.JsonRpcProvider;
  intermediary: string;
  observedAt: number;
}): Promise<GhostWalletCapitalQuote | null> {
  const { config, provider, intermediary, observedAt } = input;
  const vault = new Contract(config.vault, EULER_VAULT_ABI, provider);
  const result = await vault.checkLiquidation(intermediary, config.violator, config.collateral);
  const maxRepay = bigint(result.maxRepay ?? result[0]);
  const maxYield = bigint(result.maxYield ?? result[1]);
  if (maxRepay <= 0n || maxYield <= 0n) return null;
  return {
    quoteId: `euler-debt:${config.chain}:${config.vault.toLowerCase()}:${config.violator.toLowerCase()}:${config.collateral.toLowerCase()}`,
    primitive: 'euler_debt_assumption',
    resourceForm: 'liability_capacity',
    executionSurface: 'atomic_liability_cycle',
    chain: config.chain,
    asset: config.asset,
    sourceAddress: config.vault,
    availablePrincipal: maxRepay,
    variableFeeBps: 0,
    fixedFee: 0n,
    observedAt,
    expiresAt: observedAt + quoteTtlMs(),
    sameTransactionSettlement: true,
    repaymentFailureReverts: true,
    operatorMonetaryInputRequired: false,
    apiKeyRequired: false,
    signupRequired: false,
    measured: true,
    exactSimulationRequired: true,
    reliabilityScore: 1,
    provenance: [
      'euler_checkLiquidation_measured_onchain',
      'euler_liquidator_assumes_debt_instead_of_prefunding_repayment_asset',
      'incremental_debt_must_be_repaid_before_transaction_end',
      'same_transaction_liability_neutrality_required',
      'api_key_required:false',
      'signup_required:false',
      'synthetic_capacity:false',
    ],
    metadata: {
      vault: config.vault,
      debtToken: config.debtToken,
      violator: config.violator,
      collateral: config.collateral,
      maxYield: maxYield.toString(),
      ...(config.label ? { label: config.label } : {}),
    },
  };
}

async function measureGhostCapitalVault(input: {
  config: GhostWalletVaultSourceConfig;
  provider: providers.JsonRpcProvider;
  intermediary: string;
  observedAt: number;
}): Promise<GhostWalletCapitalQuote | null> {
  const { config, provider, intermediary, observedAt } = input;
  const vault = new Contract(config.vault, GHOST_VAULT_ABI, provider);
  const [assetRaw, totalAssetsRaw, feeRaw, configuredIntermediaryRaw] = await Promise.all([
    vault.asset(),
    vault.totalAssets(),
    vault.minimumAtomicFeeBps(),
    vault.intermediary(),
  ]);
  const configuredIntermediary = utils.getAddress(String(configuredIntermediaryRaw));
  if (configuredIntermediary.toLowerCase() !== intermediary.toLowerCase()) {
    throw new Error(`vault intermediary mismatch: expected ${intermediary}, received ${configuredIntermediary}`);
  }
  const availablePrincipal = bigint(totalAssetsRaw);
  if (availablePrincipal <= 0n) return null;
  const feeBps = Number(feeRaw.toString());
  if (!Number.isFinite(feeBps) || feeBps < 0 || feeBps > 1_000) throw new Error('vault minimumAtomicFeeBps is invalid');
  return {
    quoteId: `ghost-vault:${config.chain}:${config.vault.toLowerCase()}`,
    primitive: 'permissionless_vault_capital',
    resourceForm: 'liquid_principal',
    executionSurface: 'vault_atomic_credit',
    chain: config.chain,
    asset: utils.getAddress(String(assetRaw)),
    sourceAddress: config.vault,
    availablePrincipal,
    variableFeeBps: feeBps,
    fixedFee: 0n,
    observedAt,
    expiresAt: observedAt + quoteTtlMs(),
    sameTransactionSettlement: true,
    repaymentFailureReverts: true,
    operatorMonetaryInputRequired: false,
    apiKeyRequired: false,
    signupRequired: false,
    measured: true,
    exactSimulationRequired: true,
    reliabilityScore: 1,
    provenance: [
      'ghost_wallet_vault_totalAssets_measured_onchain',
      'ghost_wallet_vault_minimum_fee_measured_onchain',
      'ghost_wallet_vault_intermediary_binding_verified',
      'principal_plus_fee_same_transaction_balance_check',
      'api_key_required:false',
      'signup_required:false',
      'synthetic_capacity:false',
    ],
    metadata: {
      vault: config.vault,
      ...(config.label ? { label: config.label } : {}),
    },
  };
}

export async function measureConfiguredGhostWalletSources(input: {
  context: GhostWalletRuntimeContext;
  config: GhostWalletSourceConfig;
}): Promise<GhostWalletSourceMeasurement> {
  const observedAt = Date.now();
  const quotes: GhostWalletCapitalQuote[] = [];
  const errors: Array<{ source: string; chain?: string; error: string }> = [];

  const jobs: Array<Promise<void>> = [];
  const providerFor = (chain: string) => input.context.providers.get(normalizeChain(chain));
  const intermediaryFor = (chain: string) => input.context.intermediaryByChain.get(normalizeChain(chain));

  for (const config of input.config.aaveDelegations) {
    jobs.push((async () => {
      const provider = providerFor(config.chain);
      const intermediary = intermediaryFor(config.chain);
      if (!provider || !intermediary) return;
      try {
        const quote = await measureAaveDelegation({ config, provider, intermediary, observedAt });
        if (quote) quotes.push(quote);
      } catch (error) {
        errors.push({ source: config.label || 'aave_credit_delegation', chain: config.chain, error: error instanceof Error ? error.message : String(error) });
      }
    })());
  }

  for (const config of input.config.eulerDebtAssumptions) {
    jobs.push((async () => {
      const provider = providerFor(config.chain);
      const intermediary = intermediaryFor(config.chain);
      if (!provider || !intermediary) return;
      try {
        const quote = await measureEulerDebtAssumption({ config, provider, intermediary, observedAt });
        if (quote) quotes.push(quote);
      } catch (error) {
        errors.push({ source: config.label || 'euler_debt_assumption', chain: config.chain, error: error instanceof Error ? error.message : String(error) });
      }
    })());
  }

  for (const config of input.config.capitalVaults) {
    jobs.push((async () => {
      const provider = providerFor(config.chain);
      const intermediary = intermediaryFor(config.chain);
      if (!provider || !intermediary) return;
      try {
        const quote = await measureGhostCapitalVault({ config, provider, intermediary, observedAt });
        if (quote) quotes.push(quote);
      } catch (error) {
        errors.push({ source: config.label || 'permissionless_vault_capital', chain: config.chain, error: error instanceof Error ? error.message : String(error) });
      }
    })());
  }

  await Promise.all(jobs);
  quotes.sort((left, right) => left.chain.localeCompare(right.chain) || left.primitive.localeCompare(right.primitive) || left.quoteId.localeCompare(right.quoteId));
  return { observedAt, quotes, errors };
}
