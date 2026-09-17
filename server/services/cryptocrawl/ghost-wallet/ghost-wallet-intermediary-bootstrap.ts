import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Contract, ethers } from 'ethers';
import logger from '../../../logger.js';
import { resolvePrimaryProfitPayoutAddress } from '../core/wallet-identity.js';
import { ghostWalletEngine } from './ghost-wallet-engine.js';
import { getGhostWalletPimlicoSupportedChains } from './ghost-wallet-pimlico-sponsor.js';
import { ghostWalletProviderMesh, type GhostWalletChain } from './ghost-wallet-provider-mesh.js';
import { enqueueGhostWalletWork } from './ghost-wallet-work-ledger.js';
import { ghostWalletWorkSignal } from './ghost-wallet-work-signal.js';

const CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const CREATE2_DEPLOYER_CODE_HASH = '0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989';
const INTERMEDIARY_SALT = ethers.utils.keccak256(
  ethers.utils.toUtf8Bytes('bad-blue:cryptocrawl-ghost-wallet-intermediary:v1'),
);
const INTERMEDIARY_ABI = [
  'function owner() view returns (address)',
  'function profitRecipient() view returns (address)',
];
const RETRY_MS = 15_000;
const HEALTHY_RECHECK_MS = 5 * 60_000;

interface IntermediaryArtifact {
  contractName: string;
  bytecode: string;
}

interface IntermediaryDescriptor {
  chain: GhostWalletChain;
  address: string;
  owner: string;
  profitRecipient: string;
  deployed: boolean;
  deployment: null | { to: string; data: string; value: '0' };
}

let artifactPromise: Promise<IntermediaryArtifact> | null = null;

function configuredRows(): Array<{ chain: string; address: string }> {
  const raw = process.env.GHOST_WALLET_INTERMEDIARIES_JSON?.trim();
  if (!raw) return [];
  try {
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row: any) => {
      const chain = String(row?.chain || '').trim().toLowerCase();
      const address = String(row?.address || '').trim();
      if (!chain || !ethers.utils.isAddress(address)) return [];
      return [{ chain, address: ethers.utils.getAddress(address) }];
    });
  } catch {
    return [];
  }
}

async function artifact(): Promise<IntermediaryArtifact> {
  if (!artifactPromise) {
    artifactPromise = readFile(
      resolve(process.cwd(), 'artifacts/cryptocrawl/CryptocrawlGhostWalletIntermediary.json'),
      'utf8',
    ).then(raw => JSON.parse(raw) as Partial<IntermediaryArtifact>)
      .then(parsed => {
        if (parsed.contractName !== 'CryptocrawlGhostWalletIntermediary'
          || typeof parsed.bytecode !== 'string'
          || !ethers.utils.isHexString(parsed.bytecode)
          || parsed.bytecode === '0x') {
          throw new Error('GHOST_WALLET_INTERMEDIARY_ARTIFACT_INVALID');
        }
        return parsed as IntermediaryArtifact;
      });
  }
  return artifactPromise;
}

function payoutRecipient(): string {
  const recipient = resolvePrimaryProfitPayoutAddress();
  if (!recipient) throw new Error('GHOST_WALLET_PRIMARY_PAYOUT_UNAVAILABLE');
  return ethers.utils.getAddress(recipient);
}

async function descriptor(chain: GhostWalletChain): Promise<IntermediaryDescriptor> {
  const wallet = ghostWalletEngine.getExecutionWallet(chain);
  if (!wallet) throw new Error(`GHOST_WALLET_CONTROLLER_WALLET_UNAVAILABLE:${chain}`);
  const built = await artifact();
  const owner = ethers.utils.getAddress(wallet.address);
  const recipient = payoutRecipient();
  const initCode = ethers.utils.hexConcat([
    built.bytecode,
    ethers.utils.defaultAbiCoder.encode(['address', 'address'], [owner, recipient]),
  ]);
  const address = ethers.utils.getCreate2Address(
    CREATE2_DEPLOYER,
    INTERMEDIARY_SALT,
    ethers.utils.keccak256(initCode),
  );

  return ghostWalletProviderMesh.runHedged({
    chain,
    operation: 'ghost_intermediary_bootstrap_descriptor',
    execute: async provider => {
      const code = await provider.getCode(address);
      if (code !== '0x') {
        const contract = new Contract(address, INTERMEDIARY_ABI, provider);
        const [actualOwnerRaw, actualRecipientRaw] = await Promise.all([
          contract.owner(),
          contract.profitRecipient(),
        ]);
        const actualOwner = ethers.utils.getAddress(String(actualOwnerRaw));
        const actualRecipient = ethers.utils.getAddress(String(actualRecipientRaw));
        if (actualOwner.toLowerCase() !== owner.toLowerCase()
          || actualRecipient.toLowerCase() !== recipient.toLowerCase()) {
          throw new Error(`GHOST_WALLET_INTERMEDIARY_IDENTITY_MISMATCH:${chain}`);
        }
        return { chain, address, owner, profitRecipient: recipient, deployed: true, deployment: null };
      }

      const factoryCode = await provider.getCode(CREATE2_DEPLOYER);
      if (factoryCode === '0x'
        || ethers.utils.keccak256(factoryCode).toLowerCase() !== CREATE2_DEPLOYER_CODE_HASH.toLowerCase()) {
        throw new Error(`GHOST_WALLET_CREATE2_FACTORY_NOT_VERIFIED:${chain}`);
      }
      return {
        chain,
        address,
        owner,
        profitRecipient: recipient,
        deployed: false,
        deployment: {
          to: CREATE2_DEPLOYER,
          data: ethers.utils.hexConcat([INTERMEDIARY_SALT, initCode]),
          value: '0',
        },
      };
    },
  });
}

class GhostWalletIntermediaryBootstrap {
  private running = false;
  private inFlight = false;
  private timer: NodeJS.Timeout | null = null;
  private lastRunAt: number | null = null;
  private verifiedChains: GhostWalletChain[] = [];
  private pendingChains: GhostWalletChain[] = [];
  private lastErrors: Array<{ chain: GhostWalletChain; error: string }> = [];

  start(): void {
    if (this.running) return;
    this.running = true;
    queueMicrotask(() => { void this.reconcile(); });
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  getStatus() {
    return {
      running: this.running,
      inFlight: this.inFlight,
      lastRunAt: this.lastRunAt,
      verifiedChains: [...this.verifiedChains],
      pendingChains: [...this.pendingChains],
      lastErrors: this.lastErrors.map(row => ({ ...row })),
      executionGasAuthority: 'pimlico_sponsored_user_operation',
      operatorCapitalRequired: false,
    };
  }

  private schedule(delayMs: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.reconcile();
    }, delayMs);
    this.timer.unref?.();
  }

  private async reconcile(): Promise<void> {
    if (!this.running || this.inFlight) return;
    this.inFlight = true;
    this.lastRunAt = Date.now();
    try {
      await ghostWalletProviderMesh.initialize();
      const ready = new Set(ghostWalletProviderMesh.getReadyChains());
      const executable = getGhostWalletPimlicoSupportedChains().filter(chain => ready.has(chain));
      const explicit = configuredRows();
      const explicitChains = new Set(explicit.map(row => row.chain));
      const targets = executable.filter(chain => !explicitChains.has(chain));
      const settled = await Promise.allSettled(targets.map(chain => descriptor(chain)));

      const verified: Array<{ chain: string; address: string }> = [];
      const pending: GhostWalletChain[] = [];
      const errors: Array<{ chain: GhostWalletChain; error: string }> = [];
      for (let index = 0; index < settled.length; index += 1) {
        const chain = targets[index];
        const result = settled[index];
        if (result.status === 'rejected') {
          errors.push({ chain, error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
          continue;
        }
        const item = result.value;
        if (item.deployed) {
          verified.push({ chain: item.chain, address: item.address });
          continue;
        }
        if (!item.deployment) continue;
        pending.push(chain);
        await enqueueGhostWalletWork({
          dedupeKey: `ghost-intermediary-bootstrap:${chain}:${item.address.toLowerCase()}`,
          kind: 'prepared_atomic_execution',
          chain,
          priority: 1_000,
          maxAttempts: 20,
          payload: {
            mode: 'bridge_bootstrap',
            chain,
            to: item.deployment.to,
            data: item.deployment.data,
            value: item.deployment.value,
            verifyCodeAt: item.address,
            infrastructureKind: 'matched_intent_intermediary',
          },
        });
      }

      const merged = new Map<string, { chain: string; address: string }>();
      for (const row of explicit) merged.set(row.chain, row);
      for (const row of verified) if (!merged.has(row.chain)) merged.set(row.chain, row);
      const nextRows = [...merged.values()];
      const previousJson = JSON.stringify(explicit.sort((a, b) => a.chain.localeCompare(b.chain)));
      const nextJson = JSON.stringify([...nextRows].sort((a, b) => a.chain.localeCompare(b.chain)));
      if (nextJson !== previousJson) {
        process.env.GHOST_WALLET_INTERMEDIARIES_JSON = JSON.stringify(nextRows);
        await ghostWalletEngine.refresh();
        await ghostWalletEngine.enqueueReadyIntentPairWork();
        ghostWalletWorkSignal.emitWake('explicit_refresh');
      }

      if (pending.length > 0) ghostWalletWorkSignal.emitWake('local_work_enqueued');
      this.verifiedChains = nextRows.map(row => row.chain as GhostWalletChain);
      this.pendingChains = pending;
      this.lastErrors = errors;
      logger.info('[GhostWalletBootstrap] Matched-intent intermediary capability reconciled', {
        component: 'GhostWalletIntermediaryBootstrap',
        verifiedChains: this.verifiedChains,
        pendingChains: this.pendingChains,
        routeLocalErrors: errors,
        automaticCreate2Bootstrap: true,
        pimlicoSponsoredDeployment: true,
        operatorCapitalRequired: false,
      });
      this.schedule(pending.length > 0 || errors.length > 0 ? RETRY_MS : HEALTHY_RECHECK_MS);
    } catch (error) {
      this.lastErrors = [{
        chain: 'ethereum',
        error: error instanceof Error ? error.message : String(error),
      }];
      logger.warn('[GhostWalletBootstrap] Intermediary reconciliation degraded locally', {
        component: 'GhostWalletIntermediaryBootstrap',
        error: error instanceof Error ? error.message : String(error),
        globalExecutionShutdownAuthority: false,
      });
      this.schedule(RETRY_MS);
    } finally {
      this.inFlight = false;
    }
  }
}

export const ghostWalletIntermediaryBootstrap = new GhostWalletIntermediaryBootstrap();

export const GHOST_WALLET_INTERMEDIARY_BOOTSTRAP_POLICY = {
  deterministicCreate2Address: true,
  automaticDeployment: true,
  deploymentGasAuthority: 'pimlico_sponsored_user_operation',
  operatorPrincipalAuthority: false,
  explicitConfigurationPreserved: true,
  runtimeRegistrationAfterIdentityVerification: true,
  matchedIntentOnly: true,
  zeroCapitalExecutionAuthority: false,
  routeLocalFailure: true,
} as const;
