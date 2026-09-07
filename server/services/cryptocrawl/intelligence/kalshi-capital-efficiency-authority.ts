import logger from '../../../logger.js';
import { getKalshiApiOrigin, kalshiAuthenticatedRequest, kalshiCredentialsPresent } from './kalshi-authenticated-authority.js';

export interface KalshiApiCapacityEvidence {
  usageTier: string;
  readRefillRate: number;
  readBucketCapacity: number;
  writeRefillRate: number;
  writeBucketCapacity: number;
  defaultEndpointCost: number | null;
  nonDefaultEndpointCosts: Array<{ method: string; path: string; cost: number }>;
  observedAt: number;
  authenticated: true;
}

export interface KalshiNettingEvidence {
  subaccountNumber: number;
  enabled: boolean;
}

export interface KalshiCapitalEfficiencyEvidence {
  observedAt: number;
  credentialsPresent: boolean;
  balanceUsd: number | null;
  portfolioValueUsd: number | null;
  nettingConfigs: KalshiNettingEvidence[];
  nettingEnabledSubaccounts: number[];
  collateralReturnPotential: boolean;
  realizedCollateralReturnUsd: null;
  interestApyBps: null;
  authenticated: boolean;
  economicCreditAllowed: false;
  capitalMovementAuthority: false;
  executionAuthority: false;
  provenance: string[];
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function centsToUsd(value: unknown): number | null {
  const cents = finite(value);
  return cents === null ? null : cents / 100;
}

async function publicJson<T>(path: string): Promise<T> {
  if (!path.startsWith('/trade-api/v2/')) throw new Error('Kalshi public path rejected');
  const response = await fetch(`${getKalshiApiOrigin()}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) throw new Error(`Kalshi public request failed HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export async function getKalshiApiCapacityEvidence(): Promise<KalshiApiCapacityEvidence | null> {
  if (!kalshiCredentialsPresent()) return null;
  const [limits, costs] = await Promise.all([
    kalshiAuthenticatedRequest<any>('/trade-api/v2/account/limits'),
    publicJson<any>('/trade-api/v2/account/endpoint_costs').catch(() => null),
  ]);
  const readRefillRate = finite(limits?.read?.refill_rate);
  const readBucketCapacity = finite(limits?.read?.bucket_capacity);
  const writeRefillRate = finite(limits?.write?.refill_rate);
  const writeBucketCapacity = finite(limits?.write?.bucket_capacity);
  if ([readRefillRate, readBucketCapacity, writeRefillRate, writeBucketCapacity].some(value => value === null || value! < 0)) return null;
  const nonDefaultEndpointCosts = (Array.isArray(costs?.endpoint_costs) ? costs.endpoint_costs : []).flatMap((row: any) => {
    const cost = finite(row?.cost);
    const method = String(row?.method || '').trim().toUpperCase();
    const path = String(row?.path || '').trim();
    return cost !== null && cost >= 0 && method && path ? [{ method, path, cost }] : [];
  });
  return {
    usageTier: String(limits?.usage_tier || 'unknown'),
    readRefillRate: readRefillRate!,
    readBucketCapacity: readBucketCapacity!,
    writeRefillRate: writeRefillRate!,
    writeBucketCapacity: writeBucketCapacity!,
    defaultEndpointCost: finite(costs?.default_cost),
    nonDefaultEndpointCosts,
    observedAt: Date.now(),
    authenticated: true,
  };
}

export async function getKalshiCapitalEfficiencyEvidence(): Promise<KalshiCapitalEfficiencyEvidence> {
  const observedAt = Date.now();
  if (!kalshiCredentialsPresent()) {
    return {
      observedAt,
      credentialsPresent: false,
      balanceUsd: null,
      portfolioValueUsd: null,
      nettingConfigs: [],
      nettingEnabledSubaccounts: [],
      collateralReturnPotential: false,
      realizedCollateralReturnUsd: null,
      interestApyBps: null,
      authenticated: false,
      economicCreditAllowed: false,
      capitalMovementAuthority: false,
      executionAuthority: false,
      provenance: ['kalshi_credentials_absent', 'fail_closed'],
    };
  }
  try {
    const [balance, netting] = await Promise.all([
      kalshiAuthenticatedRequest<any>('/trade-api/v2/portfolio/balance'),
      kalshiAuthenticatedRequest<any>('/trade-api/v2/portfolio/subaccounts/netting'),
    ]);
    const nettingConfigs = (Array.isArray(netting?.netting_configs) ? netting.netting_configs : []).flatMap((row: any) => {
      const subaccountNumber = finite(row?.subaccount_number);
      if (subaccountNumber === null || !Number.isInteger(subaccountNumber) || subaccountNumber < 0) return [];
      return [{ subaccountNumber, enabled: row?.enabled === true }];
    });
    const nettingEnabledSubaccounts = nettingConfigs.filter(row => row.enabled).map(row => row.subaccountNumber);
    return {
      observedAt,
      credentialsPresent: true,
      balanceUsd: centsToUsd(balance?.balance),
      portfolioValueUsd: centsToUsd(balance?.portfolio_value),
      nettingConfigs,
      nettingEnabledSubaccounts,
      collateralReturnPotential: nettingEnabledSubaccounts.length > 0,
      realizedCollateralReturnUsd: null,
      // Kalshi documents interest programs separately, but no authenticated
      // accrual value is assumed here. Terminal credits must supply actual value.
      interestApyBps: null,
      authenticated: true,
      economicCreditAllowed: false,
      capitalMovementAuthority: false,
      executionAuthority: false,
      provenance: [
        'kalshi_portfolio_balance_authenticated',
        'kalshi_subaccount_netting_authenticated',
        'netting_can_reduce_event_collateral_lock_but_is_not_realized_profit',
        'interest_not_credited_without_authenticated_accrual_or_paid_credit',
      ],
    };
  } catch (error) {
    logger.warn('[KalshiCapital] Capital-efficiency evidence failed closed', {
      component: 'KalshiCapitalEfficiencyAuthority',
      error: error instanceof Error ? error.message : String(error),
      economicCreditAllowed: false,
      capitalMovementAuthority: false,
      executionAuthority: false,
    });
    return {
      observedAt,
      credentialsPresent: true,
      balanceUsd: null,
      portfolioValueUsd: null,
      nettingConfigs: [],
      nettingEnabledSubaccounts: [],
      collateralReturnPotential: false,
      realizedCollateralReturnUsd: null,
      interestApyBps: null,
      authenticated: false,
      economicCreditAllowed: false,
      capitalMovementAuthority: false,
      executionAuthority: false,
      provenance: ['kalshi_capital_efficiency_unavailable', 'fail_closed'],
    };
  }
}
