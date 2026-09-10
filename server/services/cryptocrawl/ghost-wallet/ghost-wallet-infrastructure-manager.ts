import { Wallet, providers } from 'ethers';
import { getGhostWalletExternalBridgeDescriptor } from './ghost-wallet-external-bridge.js';
import { ghostWalletProviderMesh, type GhostWalletChain } from './ghost-wallet-provider-mesh.js';

export interface GhostWalletBootstrapRuntime {
  providers: Map<any, providers.JsonRpcProvider>;
  executionWallets: Map<any, Wallet>;
}

export interface GhostWalletInfrastructureRecord {
  chain: string;
  chainId: number;
  intermediary: string;
  vaults: Array<{ asset: string; vault: string }>;
  deploymentMode: 'existing' | 'caller_funded_external_bridge';
}

export interface GhostWalletInfrastructureBootstrapResult {
  records: GhostWalletInfrastructureRecord[];
  errors: Array<{ chain: string; error: string }>;
  manualRailwayConfigurationRequired: false;
  personalGasSpent: false;
  arbitrageSystemOwnedGasSpent: false;
  serverSubmittedDeployment: false;
  alchemyDependency: false;
}

/**
 * Compatibility/readiness shim retained for callers that still ask for Ghost
 * infrastructure state. It is deliberately read-only: the Ghost server never
 * deploys contracts, grants permissions, or consumes operator/arbitrage native
 * gas. The permissionless external bridge exposes deterministic CREATE2 bootstrap
 * calldata so the transaction initiator/integrator can fund deployment when a
 * chain has not been initialized yet.
 */
export async function ensureGhostWalletInfrastructure(_input: {
  runtime: GhostWalletBootstrapRuntime;
  profitRecipient: string;
}): Promise<GhostWalletInfrastructureBootstrapResult> {
  await ghostWalletProviderMesh.initialize();
  const records: GhostWalletInfrastructureRecord[] = [];
  const errors: Array<{ chain: string; error: string }> = [];

  const chains = ghostWalletProviderMesh.getReadyChains();
  const settled = await Promise.allSettled(
    chains.map(async chain => ({ chain, descriptor: await getGhostWalletExternalBridgeDescriptor(chain) })),
  );

  settled.forEach((result, index) => {
    const chain = chains[index] as GhostWalletChain;
    if (result.status === 'rejected') {
      errors.push({ chain, error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
      return;
    }
    const descriptor = result.value.descriptor;
    records.push({
      chain,
      chainId: descriptor.chainId,
      intermediary: descriptor.address,
      vaults: [],
      deploymentMode: descriptor.deployed ? 'existing' : 'caller_funded_external_bridge',
    });
  });

  return {
    records,
    errors,
    manualRailwayConfigurationRequired: false,
    personalGasSpent: false,
    arbitrageSystemOwnedGasSpent: false,
    serverSubmittedDeployment: false,
    alchemyDependency: false,
  };
}

export const GHOST_WALLET_INFRASTRUCTURE_POLICY = {
  serverSubmittedDeployment: false,
  serverSubmittedPermissions: false,
  transactionInitiatorFundsBootstrap: true,
  operatorInitialCapitalRequired: false,
  arbitrageGasCrossSubsidyAllowed: false,
  alchemyAllowed: false,
  manualRailwayConfigurationRequired: false,
} as const;
