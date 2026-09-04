import { ethers, providers } from 'ethers';
import logger from '../../../../logger.js';

export type SponsoredBuilderName = 'Titan' | 'Quasar';

interface SponsoredBuilderConfig {
  name: SponsoredBuilderName;
  endpoint: string;
  statsEndpoint: string;
  statsMethod: string;
}

const BUILDERS: SponsoredBuilderConfig[] = [
  {
    name: 'Titan',
    endpoint: 'https://rpc.titanbuilder.xyz',
    statsEndpoint: 'https://stats.titanbuilder.xyz',
    statsMethod: 'titan_getBundleStats',
  },
  {
    name: 'Quasar',
    endpoint: 'https://rpc.quasar.win',
    statsEndpoint: 'https://stats.quasar.win',
    statsMethod: 'quasar_getBundleStats',
  },
];

export interface BuilderSponsoredBundleCandidate {
  builder: SponsoredBuilderName;
  laneId: string;
  endpoint: string;
  signedTransactions: string[];
  transactionHashes: string[];
  targetBlock: number;
  expiresAt: number;
  replacementUuid: string;
  requiredSponsorshipWei: bigint;
  guaranteedBuilderPaymentWei: bigint;
  minimumBuilderResidualWei: bigint;
  operatorNativeGasInputRequired: false;
  coldStartEligible: true;
}

export interface BuilderSponsoredBundleResult {
  status: 'confirmed' | 'definitive_failure' | 'ambiguous';
  builder: SponsoredBuilderName;
  laneId: string;
  bundleHash?: string;
  transactionHashes: string[];
  blockNumber?: number;
  builderPaymentWei?: bigint;
  reason?: string;
  operatorNativeGasInputRequired: false;
}

interface RpcEnvelope<T> {
  result?: T;
  error?: { code?: number; message?: string; data?: unknown };
}

function uuid(): string {
  return ethers.utils.hexlify(ethers.utils.randomBytes(16)).slice(2);
}

function positiveWei(label: string, value: bigint): bigint {
  if (value <= 0n) throw new Error(`${label} must be positive`);
  return value;
}

function transactionHash(serialized: string): string {
  if (!ethers.utils.isHexString(serialized)) throw new Error('Builder bundle contains a non-hex signed transaction');
  return ethers.utils.keccak256(serialized);
}

export class BuilderSponsoredBundleAdapter {
  private readonly provider: providers.JsonRpcProvider;

  constructor(provider: providers.JsonRpcProvider) {
    this.provider = provider;
  }

  listBuilders(): SponsoredBuilderName[] {
    return BUILDERS.map(builder => builder.name);
  }

  /**
   * Creates one independent candidate per builder. Preparation never submits.
   * Titan and Quasar both require the completed bundle to increase builder
   * balance enough to recover the ETH they inject for an underfunded sender.
   * Therefore the caller must provide a canonical guaranteed builder payment,
   * not a synthetic or historical estimate.
   */
  async prepareCandidates(input: {
    signedTransactions: string[];
    targetBlock: number;
    expiresAt: number;
    requiredSponsorshipWei: bigint;
    guaranteedBuilderPaymentWei: bigint;
    minimumBuilderResidualWei?: bigint;
  }): Promise<BuilderSponsoredBundleCandidate[]> {
    const network = await this.provider.getNetwork();
    if (network.chainId !== 1) return [];
    if (!Number.isSafeInteger(input.targetBlock) || input.targetBlock <= 0) throw new Error('Sponsored bundle targetBlock must be positive');
    if (input.expiresAt <= Date.now()) return [];
    if (!input.signedTransactions.length) throw new Error('Sponsored bundle cannot be empty');

    const required = positiveWei('requiredSponsorshipWei', input.requiredSponsorshipWei);
    const payment = positiveWei('guaranteedBuilderPaymentWei', input.guaranteedBuilderPaymentWei);
    const residual = input.minimumBuilderResidualWei ?? 1n;
    if (residual < 0n) throw new Error('minimumBuilderResidualWei cannot be negative');
    if (payment < required + residual) {
      return [];
    }

    const hashes = input.signedTransactions.map(transactionHash);
    return BUILDERS.map(builder => ({
      builder: builder.name,
      laneId: `builder-sponsored:ethereum:${builder.name.toLowerCase()}`,
      endpoint: builder.endpoint,
      signedTransactions: [...input.signedTransactions],
      transactionHashes: [...hashes],
      targetBlock: input.targetBlock,
      expiresAt: input.expiresAt,
      replacementUuid: uuid(),
      requiredSponsorshipWei: required,
      guaranteedBuilderPaymentWei: payment,
      minimumBuilderResidualWei: residual,
      operatorNativeGasInputRequired: false,
      coldStartEligible: true,
    }));
  }

  /**
   * Submission is intentionally single-builder. The outer Zero Initial Capital
   * orchestrator owns retry/redundancy ordering so two builders are never raced
   * as independent execution authorities for the same opportunity.
   */
  async submitCandidate(
    candidate: BuilderSponsoredBundleCandidate,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<BuilderSponsoredBundleResult> {
    const config = BUILDERS.find(builder => builder.name === candidate.builder);
    if (!config) throw new Error(`Unsupported sponsored builder ${candidate.builder}`);
    if (Date.now() >= candidate.expiresAt) {
      return this.result(candidate, 'definitive_failure', undefined, undefined, 'Sponsored builder candidate expired before submission');
    }
    if (candidate.guaranteedBuilderPaymentWei < candidate.requiredSponsorshipWei + candidate.minimumBuilderResidualWei) {
      return this.result(candidate, 'definitive_failure', undefined, undefined, 'Guaranteed builder payment no longer covers sponsorship plus residual');
    }

    const currentBlock = await this.provider.getBlockNumber();
    if (candidate.targetBlock <= currentBlock) {
      return this.result(candidate, 'definitive_failure', undefined, undefined, 'Sponsored bundle target block is no longer in the future');
    }

    const timeoutMs = Math.max(1_000, options.timeoutMs ?? Number(process.env.ZERO_INITIAL_CAPITAL_BUILDER_TIMEOUT_MS || 30_000));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const externalAbort = () => controller.abort();
    options.signal?.addEventListener('abort', externalAbort, { once: true });

    let bundleHash: string | undefined;
    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'eth_sendBundle',
          params: [{
            txs: candidate.signedTransactions,
            blockNumber: ethers.utils.hexValue(candidate.targetBlock),
            replacementUuid: candidate.replacementUuid,
          }],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        return this.result(candidate, 'definitive_failure', undefined, undefined, `${candidate.builder} HTTP ${response.status}`);
      }
      const envelope = await response.json() as RpcEnvelope<any>;
      if (envelope.error) {
        return this.result(
          candidate,
          'definitive_failure',
          undefined,
          undefined,
          `${candidate.builder} rejected sponsored bundle: ${envelope.error.message || envelope.error.code || 'unknown error'}`,
        );
      }
      bundleHash = String(envelope.result?.bundleHash || envelope.result || '');
      if (!/^0x[a-fA-F0-9]{64}$/.test(bundleHash)) {
        return this.result(candidate, 'ambiguous', undefined, undefined, `${candidate.builder} accepted request without a valid bundle hash`);
      }

      const landed = await this.waitForTargetBlock(candidate, controller.signal);
      if (landed.status === 'confirmed') {
        const trace = await this.tryTrace(config, bundleHash);
        return this.result(candidate, 'confirmed', bundleHash, landed.blockNumber, undefined, trace.builderPaymentWei);
      }
      if (landed.status === 'definitive_failure') {
        const trace = await this.tryTrace(config, bundleHash);
        return this.result(candidate, 'definitive_failure', bundleHash, landed.blockNumber, trace.reason || landed.reason, trace.builderPaymentWei);
      }
      return this.result(candidate, 'ambiguous', bundleHash, undefined, landed.reason || 'Bundle acceptance could not be reconciled before timeout');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // Once a valid bundle hash has been returned, a timeout/provider failure is
      // ambiguous: never allow a redundant live submission until reconciled.
      return this.result(candidate, bundleHash ? 'ambiguous' : 'definitive_failure', bundleHash, undefined, reason);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', externalAbort);
    }
  }

  private async waitForTargetBlock(
    candidate: BuilderSponsoredBundleCandidate,
    signal: AbortSignal,
  ): Promise<{ status: 'confirmed' | 'definitive_failure' | 'ambiguous'; blockNumber?: number; reason?: string }> {
    while (!signal.aborted) {
      const blockNumber = await this.provider.getBlockNumber();
      if (blockNumber >= candidate.targetBlock) {
        const receipts = await Promise.all(candidate.transactionHashes.map(hash => this.provider.getTransactionReceipt(hash)));
        const included = receipts.filter(Boolean) as providers.TransactionReceipt[];
        if (included.length === candidate.transactionHashes.length && included.every(receipt => receipt.status === 1)) {
          const blocks = new Set(included.map(receipt => receipt.blockNumber));
          if (blocks.size === 1 && blocks.has(candidate.targetBlock)) {
            return { status: 'confirmed', blockNumber: candidate.targetBlock };
          }
          return { status: 'ambiguous', reason: 'Sponsored bundle transactions were observed outside one atomic target block' };
        }
        if (included.length > 0) {
          return { status: 'ambiguous', blockNumber, reason: 'Only part of an allegedly atomic sponsored bundle was observed on chain' };
        }
        return { status: 'definitive_failure', blockNumber, reason: 'Target block mined without the sponsored bundle landing' };
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    return { status: 'ambiguous', reason: 'Timed out before sponsored bundle target block could be reconciled' };
  }

  private async tryTrace(
    config: SponsoredBuilderConfig,
    bundleHash: string,
  ): Promise<{ builderPaymentWei?: bigint; reason?: string }> {
    try {
      const key = config.name === 'Titan' ? 'bundleHash' : 'bundle_hash';
      const response = await fetch(config.statsEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: config.statsMethod,
          params: [{ [key]: bundleHash }],
        }),
      });
      if (!response.ok) return {};
      const envelope = await response.json() as RpcEnvelope<any>;
      const rawPayment = envelope.result?.builderPayment ?? envelope.result?.builderPaymentWhenIncluded;
      const builderPaymentWei = rawPayment !== undefined && /^\d+$/.test(String(rawPayment)) ? BigInt(String(rawPayment)) : undefined;
      const reason = envelope.result?.error ? String(envelope.result.error) : undefined;
      return { builderPaymentWei, reason };
    } catch {
      // Tracing is delayed/best-effort and is never execution authority.
      return {};
    }
  }

  private result(
    candidate: BuilderSponsoredBundleCandidate,
    status: BuilderSponsoredBundleResult['status'],
    bundleHash?: string,
    blockNumber?: number,
    reason?: string,
    builderPaymentWei?: bigint,
  ): BuilderSponsoredBundleResult {
    logger.debug('[ZeroInitialCapital] Sponsored builder lane resolved', {
      component: 'BuilderSponsoredBundleAdapter',
      builder: candidate.builder,
      laneId: candidate.laneId,
      status,
      bundleHash,
      blockNumber,
      builderPaymentWei: builderPaymentWei?.toString(),
      operatorNativeGasInputRequired: false,
      executionAuthority: false,
    });
    return {
      status,
      builder: candidate.builder,
      laneId: candidate.laneId,
      bundleHash,
      transactionHashes: [...candidate.transactionHashes],
      blockNumber,
      builderPaymentWei,
      reason,
      operatorNativeGasInputRequired: false,
    };
  }
}

export default BuilderSponsoredBundleAdapter;
