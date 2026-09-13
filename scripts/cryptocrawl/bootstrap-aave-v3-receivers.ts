import 'dotenv/config';
import { Wallet } from 'ethers';
import { multiProviderRpcManager } from '../../server/services/cryptocrawl/api/blockchain-providers.js';
import { getAaveV3ReceiverManager } from '../../server/services/cryptocrawl/execution/adapters/aave-v3-receiver-manager.js';
import { resolveAaveV3Pool } from '../../server/services/cryptocrawl/execution/adapters/flash-loan-provider-economics.js';
import type { SupportedExecutionChain } from '../../server/services/cryptocrawl/execution/adapters/onchain-payload-builder.js';
import { writeAaveV3FlashLoanReceiverArtifact } from './compile-flashloan-receiver.js';

const TARGET_CHAINS: SupportedExecutionChain[] = ['ethereum', 'polygon'];

function configuredWallet(): Wallet {
  const raw = process.env.WALLET_PRIVATE_KEY?.trim();
  if (!raw) throw new Error('WALLET_PRIVATE_KEY is required for Aave receiver bootstrap');
  return new Wallet(raw.startsWith('0x') ? raw : `0x${raw}`);
}

async function main(): Promise<void> {
  const artifactPath = await writeAaveV3FlashLoanReceiverArtifact();
  const wallet = configuredWallet();
  const manager = getAaveV3ReceiverManager();
  const records: Array<{ chain: SupportedExecutionChain; address: string; pool: string; transactionHash?: string }> = [];

  for (const chain of TARGET_CHAINS) {
    const pool = resolveAaveV3Pool(chain);
    if (!pool) continue;
    await multiProviderRpcManager.initialize([chain]);
    const { http: provider } = await multiProviderRpcManager.getProvider(chain, 'json_rpc');
    const record = await manager.ensureReceiver({
      chain,
      provider,
      wallet,
      fundingMode: 'sponsored',
    });
    records.push({
      chain,
      address: record.address,
      pool: record.pool,
      ...(record.deploymentTransactionHash ? { transactionHash: record.deploymentTransactionHash } : {}),
    });
    console.log(JSON.stringify({
      marker: 'AAVE_V3_RECEIVER_BOOTSTRAP',
      chain,
      address: record.address,
      pool: record.pool,
      owner: record.owner,
      factory: record.factory,
      deployedNow: Boolean(record.deploymentTransactionHash),
      transactionHash: record.deploymentTransactionHash || null,
      syntheticEvidence: false,
    }));
  }

  if (records.length === 0) throw new Error('No configured Aave V3 pool was eligible for receiver bootstrap');
  console.log(JSON.stringify({
    marker: 'AAVE_V3_RECEIVER_BOOTSTRAP_COMPLETE',
    artifactPath,
    receivers: Object.fromEntries(records.map(record => [record.chain, record.address])),
    receiverCount: records.length,
  }));
}

void main().catch(error => {
  console.error('[bootstrap-aave-v3-receivers] failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
