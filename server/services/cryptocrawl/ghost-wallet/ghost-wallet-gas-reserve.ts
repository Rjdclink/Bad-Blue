import { captureCryptoCrawlerWorkGuard } from '../runtime/manual-power-state.js';
import logger from '../../../logger.js';
import { ensureGhostWalletGasReserveSchema } from './ghost-wallet-gas-reserve-schema.js';

/**
 * Compatibility/accounting shell for the historical retained-profit gas-reserve ledger.
 * Ghost controller transactions no longer consume or create a native gas reserve:
 * Pimlico EIP-7702/ERC-4337 sponsorship is the exclusive execution-gas authority.
 *
 * The schema remains installed so historical reserve/provenance rows stay readable and
 * migrations remain backward compatible. No retained Ghost profit is converted to native
 * gas by this service and no operator/system-native balance is admitted as execution gas.
 */
class GhostWalletGasReserve {
  private running = false;
  private generation = 0;

  async start(): Promise<void> {
    if (this.running) return;
    const guard = captureCryptoCrawlerWorkGuard();
    const generation = this.generation;
    guard();
    await ensureGhostWalletGasReserveSchema();
    guard();
    if (generation !== this.generation) throw new Error('Ghost startup cancelled');
    this.running = true;
    logger.info('[GhostWalletGasReserve] Native reserve execution retired; ledger retained for provenance', {
      component: 'GhostWalletGasReserve',
      executionAuthority: false,
      retainedProfitConversionToNativeGas: false,
      pimlicoExclusiveExecutionGasAuthority: true,
      nativeControllerGasFallback: false,
      operatorPrincipalAuthority: false,
      zeroCapitalDependency: false,
    });
  }

  stop(): void {
    this.generation++;
    this.running = false;
  }
}

export const ghostWalletGasReserve = new GhostWalletGasReserve();

export const GHOST_WALLET_GAS_RESERVE_POLICY = {
  historicalLedgerPreserved: true,
  executionAuthority: false,
  retainedProfitConversionToNativeGas: false,
  operatorPrincipalAllowed: false,
  zeroCapitalDependency: false,
  sameChainNativeReserve: false,
  nativeGasFallbackAllowed: false,
  pimlicoExclusiveExecutionGasAuthority: true,
  pimlicoSponsorIsMandatoryDependency: true,
} as const;
