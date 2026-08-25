import assert from 'node:assert/strict';
import { BigNumber, providers } from 'ethers';
import { calculateAutomaticNativeGasPlan, type InitialGasReadiness } from '../initial-gas-readiness.js';
import type { SupportedChain } from '../core/zero-capital-engine.js';

const wallet = '0x0000000000000000000000000000000000000001';

function readiness(): InitialGasReadiness {
  return {
    status: 'GAS_BELOW_THRESHOLD',
    initialGasReady: false,
    thresholdUsd: 20,
    usableNativeGasUsd: 0,
    measurements: [
      {
        chain: 'polygon',
        nativeSymbol: 'POL',
        nativeDecimals: 18,
        walletAddress: wallet,
        walletAddressSource: 'execution_wallet',
        rpcReachable: true,
        nativeBalanceWei: '0',
        nativeBalance: 0,
        nativePriceUsd: 1,
        usableNativeGasUsd: 0,
        eligibleForReadinessCalculation: true,
        observedAt: Date.now(),
        status: 'verified',
      },
      {
        chain: 'arbitrum',
        nativeSymbol: 'ETH',
        nativeDecimals: 18,
        walletAddress: wallet,
        walletAddressSource: 'execution_wallet',
        rpcReachable: false,
        nativeBalanceWei: null,
        nativeBalance: null,
        nativePriceUsd: null,
        usableNativeGasUsd: null,
        eligibleForReadinessCalculation: true,
        observedAt: Date.now(),
        status: 'provider_unavailable',
      },
    ],
    observedAt: Date.now(),
    provenance: ['test_live_measurement'],
    reason: 'test readiness below threshold',
  };
}

async function main(): Promise<void> {
  const provider = {
    getFeeData: async () => ({ maxFeePerGas: BigNumber.from(2), gasPrice: BigNumber.from(2) }),
    estimateGas: async () => BigNumber.from(21_000),
  } as unknown as providers.Provider;
  const providersByChain = new Map<SupportedChain, providers.Provider>([['polygon', provider]]);
  const plan = await calculateAutomaticNativeGasPlan({
    readiness: readiness(),
    providers: providersByChain,
    walletAddresses: new Map([['polygon', wallet]]),
  });

  assert.ok(plan);
  assert.equal(plan.destinationChain, 'polygon');
  assert.equal(plan.destinationWallet, wallet);
  assert.ok(BigInt(plan.requiredNativeWei) > 20_000_000_000_000_000_000n);
  assert.equal(plan.estimatedNextTransactionGasWei, '42000');
  assert.ok(plan.provenance.includes('automatic_destination_selection'));

  console.log(JSON.stringify({
    destinationChain: plan.destinationChain,
    requiredNativeWei: plan.requiredNativeWei,
    excludedUnavailableChains: true,
  }));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
