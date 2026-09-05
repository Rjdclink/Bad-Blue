import { ethers, providers } from 'ethers';
import logger from '../../../../logger.js';

export type SponsoredBuilderName = 'Titan' | 'Quasar';

interface SponsoredBuilderConfig {
  name: SponsoredBuilderName;
  endpoint: string;
  statsEndpoint: string;
  statsMethod: string;
  statsHashKey: 'bundleHash' | 'bundle_hash';
  coinbaseAddress: string;
}

/**
 * Public Ethereum builders with documented sponsored-bundle semantics.
 * Authentication is intentionally not required here; both builders accept
 * normal eth_sendBundle submissions without an API key. Optional reputation
 * authentication can be layered on later without changing execution authority.
 */
const BUILDERS: readonly SponsoredBuilderConfig[] = [
  {
    name: 'Titan',
    endpoint: 'https://rpc.titanbuilder.xyz',
    statsEndpoint: 'https://stats.titanbuilder.xyz',
    statsMethod: 'titan_getBundleStats',
    statsHashKey: 'bundleHash',
    coinbaseAddress: '0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97',
  },
  {
    name: 'Quasar',
    endpoint: 'https://rpc.quasar.win',
    statsEndpoint: 'https://stats.quasar.win',
    statsMethod: 'quasar_getBundleStats',
    statsHashKey: 'bundle_hash',
    coinbaseAddress: '0x396343362be2A4dA1cE0C1C210945346fb82Aa49',
  },
] as const;

export interface BuilderSponsoredEconomicsProof {
  /** The builder payment must be funded by value created inside this bundle. */
  source: 'execution_created_value';
  /** Exact/simulated ETH the builder must front for this bundle. */
  requiredSponsorshipWei: bigint;
  /** Minimum builder value left after reimbursement. */
  minimumBuilderResidualWei: bigint;
  /** Canonical all-in residual profit after builder payment/conversion/costs. */
  guaranteedResidualProfitUsd: number;
  observedAt: number;
  expiresAt: number;
}

export interface BuilderSpecificSignedBundle {
  builder: SponsoredBuilderName;
  signedTransactions: readonly string[];
}

export interface BuilderSponsoredBundleCandidate {
  builder: SponsoredBuilderName;
  laneId: string;
  endpoint: string;
  coinbaseAddress: string;
  signedTransactions: string[];
  transactionHashes: string[];
  paymentTransactionHash: string;
  paymentSender: string;
  targetBlock: number;
  expiresAt: number;
  replacementUuid: string;
  requiredSponsorshipWei: bigint;
  builderPaymentWei: bigint;
  minimumBuilderResidualWei: bigint;
  guaranteedResidualProfitUsd: number;
  paymentProvenance: 'execution_created_value';
  operatorNativeGasInputRequired: false;
  coldStartStructurallyEligible: true;
  executionAuthority: false;
}

export interface BuilderSponsoredBundleResult {
  status: 'confirmed' | 'definitive_failure' | 'ambiguous';
  builder: SponsoredBuilderName;
  laneId: string;
  bundleHash?: string;
  transactionHashes: string[];
  paymentTransactionHash: string;
  blockNumber?: number;
  tracedBuilderPaymentWei?: bigint;
  reason?: string;
  operatorNativeGasInputRequired: false;
  executionAuthority: false;
}

interface ParsedSignedTransaction {
  hash: string;
  from: string;
  to: string | null;
  value: bigint;
  chainId: number;
}

interface RpcEnvelope<T> {
  result?: T;
  error?: { code?: number; message?: string; data?: unknown };
}

function positiveWei(label: string, value: bigint): bigint {
  if (value <= 0n) throw new Error(`${label} must be positive`);
  return value;
}

function normalizedAddress(label: string, value: string): string {
  if (!ethers.utils.isAddress(value)) throw new Error(`${label} must be a valid EVM address`);
  return ethers.utils.getAddress(value);
}

function randomReplacementUuid(): string {
  return ethers.utils.hexlify(ethers.utils.randomBytes(16)).slice(2);
}

function parseSignedTransaction(serialized: string): ParsedSignedTransaction {
  if (!ethers.utils.isHexString(serialized)) throw new Error('Builder bundle contains a non-hex signed transaction');
  const parsed = ethers.utils.parseTransaction(serialized);
  if (parsed.chainId !== 1) throw new Error(`Builder-sponsored cold-start bundle must target Ethereum mainnet chainId=1, got ${parsed.chainId}`);
  if (!parsed.from) throw new Error('Builder bundle transaction signature does not recover a sender');
  return {
    hash: ethers.utils.keccak256(serialized),
    from: normalizedAddress('signed transaction sender', parsed.from),
    to: parsed.to ? normalizedAddress('signed transaction recipient', parsed.to) : null,
    value: BigInt(parsed.value.toString()),
    chainId: parsed.chainId,
  };
}

function configFor(builder: SponsoredBuilderName): SponsoredBuilderConfig {
  const config = BUILDERS.find(entry => entry.name === builder);
  if (!config) throw new Error(`Unsupported sponsored builder ${builder}`);
  return config;
}

function inspectBuilderPayment(input: {
  builder: SponsoredBuilderName;
  signedTransactions: readonly string[];
  expectedPaymentSender: string;
}): {
  parsed: ParsedSignedTransaction[];
  paymentTransactionHash: string;
  paymentSender: string;
  builderPaymentWei: bigint;
} {
  if (input.signedTransactions.length < 2) {
    throw new Error('Sponsored cold-start bundle requires at least an execution transaction and a terminal builder-payment transaction');
  }
  const config = configFor(input.builder);
  const expectedSender = normalizedAddress('expectedPaymentSender', input.expectedPaymentSender);
  const parsed = input.signedTransactions.map(parseSignedTransaction);
  const payment = parsed[parsed.length - 1];
  const coinbase = normalizedAddress(`${input.builder} coinbase`, config.coinbaseAddress);

  if (!payment.to || payment.to.toLowerCase() !== coinbase.toLowerCase()) {
    throw new Error(`Terminal signed transaction must pay the documented ${input.builder} coinbase address`);
  }
  if (payment.from.toLowerCase() !== expectedSender.toLowerCase()) {
    throw new Error('Terminal builder payment is not signed by the expected controlled execution wallet');
  }
  if (payment.value <= 0n) throw new Error('Terminal builder payment must transfer positive ETH value');

  return {
    parsed,
    paymentTransactionHash: payment.hash,
    paymentSender: payment.from,
    builderPaymentWei: payment.value,
  };
}

function economicsProofIsFresh(proof: BuilderSponsoredEconomicsProof, candidateExpiresAt: number): boolean {
  const now = Date.now();
  return proof.observedAt > 0 && proof.observedAt <= now && proof.expiresAt > now && candidateExpiresAt > now && proof.expiresAt >= candidateExpiresAt;
}

/**
 * A transport adapter only. It does not discover opportunities, approve
 * economics, or create an independent execution authority.
 *
 * Critical invariant: builderPaymentWei is derived from the actual terminal
 * signed transaction. A caller cannot claim a synthetic/estimated builder
 * payment that is absent from the bundle.
 */
export class BuilderSponsoredBundleAdapter {
  constructor(private readonly provider: providers.JsonRpcProvider) {}

  listBuilders(): SponsoredBuilderName[] {
    return BUILDERS.map(builder => builder.name);
  }

  getBuilderCoinbase(builder: SponsoredBuilderName): string {
    return configFor(builder).coinbaseAddress;
  }

  async prepareCandidates(input: {
    bundles: readonly BuilderSpecificSignedBundle[];
    expectedPaymentSender: string;
    targetBlock: number;
    expiresAt: number;
    economics: BuilderSponsoredEconomicsProof;
  }): Promise<BuilderSponsoredBundleCandidate[]> {
    const network = await this.provider.getNetwork();
    if (network.chainId !== 1) return [];
    if (!Number.isSafeInteger(input.targetBlock) || input.targetBlock <= 0) throw new Error('Sponsored bundle targetBlock must be a positive integer');
    if (input.economics.source !== 'execution_created_value') throw new Error('Builder sponsorship must be repaid from execution-created value');
    if (!Number.isFinite(input.economics.guaranteedResidualProfitUsd) || input.economics.guaranteedResidualProfitUsd <= 0) {
      return [];
    }
    if (!economicsProofIsFresh(input.economics, input.expiresAt)) return [];

    const required = positiveWei('requiredSponsorshipWei', input.economics.requiredSponsorshipWei);
    const builderResidual = positiveWei('minimumBuilderResidualWei', input.economics.minimumBuilderResidualWei);
    const expectedPaymentSender = normalizedAddress('expectedPaymentSender', input.expectedPaymentSender);
    const seenBuilders = new Set<SponsoredBuilderName>();
    const candidates: BuilderSponsoredBundleCandidate[] = [];

    for (const supplied of input.bundles) {
      if (seenBuilders.has(supplied.builder)) throw new Error(`Duplicate signed bundle supplied for ${supplied.builder}`);
      seenBuilders.add(supplied.builder);
      if (supplied.signedTransactions.length === 0) continue;

      const config = configFor(supplied.builder);
      const proof = inspectBuilderPayment({
        builder: supplied.builder,
        signedTransactions: supplied.signedTransactions,
        expectedPaymentSender,
      });
      if (proof.builderPaymentWei < required + builderResidual) continue;

      candidates.push({
        builder: supplied.builder,
        laneId: `builder-sponsored:ethereum:${supplied.builder.toLowerCase()}`,
        endpoint: config.endpoint,
        coinbaseAddress: config.coinbaseAddress,
        signedTransactions: [...supplied.signedTransactions],
        transactionHashes: proof.parsed.map(transaction => transaction.hash),
        paymentTransactionHash: proof.paymentTransactionHash,
        paymentSender: proof.paymentSender,
        targetBlock: input.targetBlock,
        expiresAt: Math.min(input.expiresAt, input.economics.expiresAt),
        replacementUuid: randomReplacementUuid(),
        requiredSponsorshipWei: required,
        builderPaymentWei: proof.builderPaymentWei,
        minimumBuilderResidualWei: builderResidual,
        guaranteedResidualProfitUsd: input.economics.guaranteedResidualProfitUsd,
        paymentProvenance: 'execution_created_value',
        operatorNativeGasInputRequired: false,
        coldStartStructurallyEligible: true,
        executionAuthority: false,
      });
    }

    return candidates;
  }

  /**
   * Submission is one builder at a time. Any multi-builder retry ordering must be
   * owned by the existing canonical execution authority. Once a valid bundle hash
   * exists, uncertain reconciliation is reported as ambiguous so a caller cannot
   * safely race a redundant submission.
   */
  async submitCandidate(
    candidate: BuilderSponsoredBundleCandidate,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<BuilderSponsoredBundleResult> {
    const config = configFor(candidate.builder);
    if (Date.now() >= candidate.expiresAt) {
      return this.result(candidate, 'definitive_failure', undefined, undefined, 'Sponsored builder candidate expired before submission');
    }
    if (!(candidate.guaranteedResidualProfitUsd > 0)) {
      return this.result(candidate, 'definitive_failure', undefined, undefined, 'Canonical residual profit is no longer positive');
    }

    let paymentProof: ReturnType<typeof inspectBuilderPayment>;
    try {
      paymentProof = inspectBuilderPayment({
        builder: candidate.builder,
        signedTransactions: candidate.signedTransactions,
        expectedPaymentSender: candidate.paymentSender,
      });
    } catch (error) {
      return this.result(candidate, 'definitive_failure', undefined, undefined, error instanceof Error ? error.message : String(error));
    }
    if (paymentProof.paymentTransactionHash !== candidate.paymentTransactionHash || paymentProof.builderPaymentWei !== candidate.builderPaymentWei) {
      return this.result(candidate, 'definitive_failure', undefined, undefined, 'Signed builder payment changed after candidate preparation');
    }
    if (candidate.builderPaymentWei < candidate.requiredSponsorshipWei + candidate.minimumBuilderResidualWei) {
      return this.result(candidate, 'definitive_failure', undefined, undefined, 'Signed builder payment no longer covers sponsorship plus builder residual');
    }

    const currentBlock = await this.provider.getBlockNumber();
    if (candidate.targetBlock <= currentBlock) {
      return this.result(candidate, 'definitive_failure', undefined, currentBlock, 'Sponsored bundle target block is no longer in the future');
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
      return this.result(candidate, 'ambiguous', bundleHash, landed.blockNumber, landed.reason || 'Bundle acceptance could not be reconciled');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
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
            const paymentReceipt = await this.provider.getTransactionReceipt(candidate.paymentTransactionHash);
            if (!paymentReceipt || paymentReceipt.status !== 1 || paymentReceipt.blockNumber !== candidate.targetBlock) {
              return { status: 'ambiguous', blockNumber, reason: 'Terminal builder-payment transaction is not confirmed in the atomic target block' };
            }
            return { status: 'confirmed', blockNumber: candidate.targetBlock };
          }
          return { status: 'ambiguous', blockNumber, reason: 'Sponsored bundle transactions were observed outside one atomic target block' };
        }
        if (included.length > 0) {
          return { status: 'ambiguous', blockNumber, reason: 'Only part of the sponsored bundle was observed on chain' };
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
      const response = await fetch(config.statsEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: config.statsMethod,
          params: [{ [config.statsHashKey]: bundleHash }],
        }),
      });
      if (!response.ok) return {};
      const envelope = await response.json() as RpcEnvelope<any>;
      const rawPayment = envelope.result?.builderPayment ?? envelope.result?.builderPaymentWhenIncluded;
      const builderPaymentWei = rawPayment !== undefined && /^\d+$/.test(String(rawPayment)) ? BigInt(String(rawPayment)) : undefined;
      const reason = envelope.result?.error ? String(envelope.result.error) : undefined;
      return { builderPaymentWei, reason };
    } catch {
      // Builder tracing is delayed/best-effort and never execution authority.
      return {};
    }
  }

  private result(
    candidate: BuilderSponsoredBundleCandidate,
    status: BuilderSponsoredBundleResult['status'],
    bundleHash?: string,
    blockNumber?: number,
    reason?: string,
    tracedBuilderPaymentWei?: bigint,
  ): BuilderSponsoredBundleResult {
    logger.debug('[ZeroInitialCapital] Builder-sponsored transport resolved', {
      component: 'BuilderSponsoredBundleAdapter',
      builder: candidate.builder,
      laneId: candidate.laneId,
      status,
      bundleHash,
      blockNumber,
      signedBuilderPaymentWei: candidate.builderPaymentWei.toString(),
      tracedBuilderPaymentWei: tracedBuilderPaymentWei?.toString(),
      guaranteedResidualProfitUsd: candidate.guaranteedResidualProfitUsd,
      paymentProvenance: candidate.paymentProvenance,
      operatorNativeGasInputRequired: false,
      executionAuthority: false,
    });
    return {
      status,
      builder: candidate.builder,
      laneId: candidate.laneId,
      bundleHash,
      transactionHashes: [...candidate.transactionHashes],
      paymentTransactionHash: candidate.paymentTransactionHash,
      blockNumber,
      tracedBuilderPaymentWei,
      reason,
      operatorNativeGasInputRequired: false,
      executionAuthority: false,
    };
  }
}

export default BuilderSponsoredBundleAdapter;
