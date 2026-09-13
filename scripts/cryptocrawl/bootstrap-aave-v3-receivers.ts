import 'dotenv/config';
import { BigNumber, Wallet } from 'ethers';
import { multiProviderRpcManager } from '../../server/services/cryptocrawl/api/blockchain-providers.js';
import { ensureProviderSpecificReceiverCapability } from '../../server/services/cryptocrawl/execution/adapters/provider-specific-receiver-bootstrap.js';
import { resolveAaveV3Pool } from '../../server/services/cryptocrawl/execution/adapters/flash-loan-provider-economics.js';
import type { SupportedExecutionChain } from '../../server/services/cryptocrawl/execution/adapters/onchain-payload-builder.js';
import { getGasSponsorManager } from '../../server/services/cryptocrawl/strategies/gas-sponsorship.js';

const TARGET_CHAINS: SupportedExecutionChain[] = ['ethereum', 'polygon'];

function configuredWallet(): Wallet {
  const raw = process.env.WALLET_PRIVATE_KEY?.trim();
  if (!raw) throw new Error('WALLET_PRIVATE_KEY is required for Aave receiver bootstrap');
  return new Wallet(raw.startsWith('0x') ? raw : `0x${raw}`);
}

async function main(): Promise<void> {
  const wallet = configuredWallet();
  const sponsor = getGasSponsorManager();
  const readiness = sponsor.getReadiness();
  if (!readiness.ready) throw new Error(readiness.reason || 'Provider-sponsored Aave receiver bootstrap is unavailable');

  const records: Array<{ chain: SupportedExecutionChain; address: string; pool: string }> = [];
  for (const chain of TARGET_CHAINS) {
    const pool = resolveAaveV3Pool(chain);
    if (!pool) continue;
    await multiProviderRpcManager.initialize([chain]);
    const { http: provider } = await multiProviderRpcManager.getProvider(chain, 'json_rpc');
    const connectedWallet = wallet.connect(provider);
    const network = await provider.getNetwork();

    const capability = await ensureProviderSpecificReceiverCapability({
      kind: 'aave_v3',
      chain,
      provider,
      wallet: connectedWallet,
      fundingMode: 'sponsored',
      executeSetupCalls: async calls => {
        if (calls.length === 0) return;
        await sponsor.execute({
          wallet: connectedWallet,
          chainId: network.chainId,
          calls: calls.map(call => ({
            to: call.to,
            data: call.data,
            value: BigNumber.from(call.value || 0),
          })),
          timeoutMs: Math.max(10_000, Number(process.env.ZERO_CAPITAL_SPONSORED_RECEIVER_DEPLOY_TIMEOUT_MS || 90_000)),
        });
      },
    });

    if (!capability) throw new Error(`Aave V3 receiver capability could not be established for ${chain}`);
    records.push({ chain, address: capability.address, pool: capability.infrastructure });
    console.log(JSON.stringify({
      marker: 'AAVE_V3_RECEIVER_BOOTSTRAP',
      chain,
      address: capability.address,
      pool: capability.infrastructure,
      owner: capability.owner,
      codeHash: capability.codeHash,
      provenance: capability.provenance,
      operatorMonetaryInputRequired: false,
      syntheticEvidence: false,
    }));
  }

  if (records.length === 0) throw new Error('No configured Aave V3 pool was eligible for receiver bootstrap');
  console.log(JSON.stringify({
    marker: 'AAVE_V3_RECEIVER_BOOTSTRAP_COMPLETE',
    receivers: Object.fromEntries(records.map(record => [record.chain, record.address])),
    receiverCount: records.length,
    fundingMode: 'provider_sponsored',
    operatorMonetaryInputRequired: false,
  }));
}

void main().catch(error => {
  console.error('[bootstrap-aave-v3-receivers] failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
