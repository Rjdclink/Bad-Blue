import { BigNumber, ethers, providers } from 'ethers';
import logger from '../../../logger.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { MultiRelaySubmitter } from '../execution/multi-relay-submitter.js';
import { UltraLowLatencyExecutor } from '../execution/ultra-low-latency-executor.js';

const installed = new WeakSet<object>();
const nonceStates = new WeakMap<object, { tail: Promise<void>; nextNonce: number | null }>();

function isSignedRawTransaction(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value) && value.length > 132;
}

async function reservePendingNonce(instance: any): Promise<number> {
  let state = nonceStates.get(instance);
  if (!state) {
    state = { tail: Promise.resolve(), nextNonce: null };
    nonceStates.set(instance, state);
  }
  let release!: () => void;
  const previous = state.tail;
  state.tail = new Promise<void>(resolve => { release = resolve; });
  await previous.catch(() => undefined);
  try {
    const pending = await instance.wallet.getTransactionCount('pending');
    if (state.nextNonce === null || state.nextNonce < pending) state.nextNonce = pending;
    const nonce = state.nextNonce;
    state.nextNonce += 1;
    return nonce;
  } finally {
    release();
  }
}

function resetNonceAuthority(instance: object): void {
  const state = nonceStates.get(instance);
  if (state) state.nextNonce = null;
}

/**
 * Installs two narrow execution corrections:
 * 1) multipath broadcast uses one fully populated signed transaction and
 *    Promise.any(), so a fast relay failure cannot beat a slower successful
 *    submission and competing paths cannot sign different payloads for one nonce;
 * 2) Flashbots bundle validation uses relay simulation and refuses transaction
 *    hashes masquerading as signed raw transactions.
 */
export function ensureLowLatencyExecutionWiring(): void {
  const relayPrototype = MultiRelaySubmitter.prototype as any;
  if (!installed.has(relayPrototype)) {
    installed.add(relayPrototype);
    const originalSubmitBundle = relayPrototype.submitBundle;

    relayPrototype.simulateBundle = async function(bundle: { signedTransactions: string[]; targetBlock: number }) {
      if (!Array.isArray(bundle?.signedTransactions) || bundle.signedTransactions.length === 0) {
        return { valid: false, reason: 'Empty bundle', score: 0 };
      }
      if (!bundle.signedTransactions.every(isSignedRawTransaction)) {
        return { valid: false, reason: 'Bundle requires signed raw transactions; transaction hashes are not executable payloads', score: 0 };
      }
      const simulationProvider = this.providers?.get?.('Flashbots') || this.providers?.values?.().next?.().value;
      if (!simulationProvider) return { valid: false, reason: 'No connected relay supports bundle simulation', score: 0 };
      try {
        const currentBlock = await this.provider.getBlockNumber();
        if (!Number.isInteger(bundle.targetBlock) || bundle.targetBlock <= currentBlock || bundle.targetBlock > currentBlock + 10) {
          return { valid: false, reason: 'Bundle target block is outside the executable near-future window', score: 0 };
        }
        const simulation = await simulationProvider.simulate(bundle.signedTransactions, bundle.targetBlock);
        if ((simulation as any)?.error) {
          return { valid: false, reason: `Flashbots simulation error: ${(simulation as any).error.message || (simulation as any).error}`, score: 0 };
        }
        const results = Array.isArray((simulation as any)?.results) ? (simulation as any).results : [];
        const failed = results.find((result: any) => result?.error || result?.revert);
        if (failed) {
          return { valid: false, reason: `Bundle transaction reverts in relay simulation: ${failed.error || failed.revert}`, score: 0 };
        }
        const coinbaseDiff = (() => {
          try { return BigNumber.from((simulation as any)?.coinbaseDiff || 0); } catch { return BigNumber.from(0); }
        })();
        const totalGasUsed = results.reduce((sum: number, result: any) => sum + Math.max(0, Number(result?.gasUsed || 0)), 0);
        // Score is telemetry only. Eligibility remains controlled by measured
        // opportunity economics and settlement, not this display value.
        const score = Math.max(1, Math.min(100, results.length * 10 + (coinbaseDiff.gt(0) ? 20 : 0) + (totalGasUsed > 0 ? 10 : 0)));
        return { valid: true, score };
      } catch (error) {
        return { valid: false, reason: `Relay simulation unavailable: ${error instanceof Error ? error.message : String(error)}`, score: 0 };
      }
    };

    relayPrototype.submitBundle = async function(bundle: { signedTransactions: string[]; targetBlock: number }, targetBlock: number) {
      if (!Array.isArray(bundle?.signedTransactions) || !bundle.signedTransactions.every(isSignedRawTransaction)) {
        logger.warn('[MultiRelaySubmitter] Invalid bundle payload withheld before relay submission', {
          component: 'MultiRelaySubmitter',
          reason: 'signed_raw_transaction_required',
          suppliedItems: Array.isArray(bundle?.signedTransactions) ? bundle.signedTransactions.length : 0,
        });
        return { submitted: 0, successful: [], failed: ['invalid_signed_transaction_payload'] };
      }
      return originalSubmitBundle.call(this, bundle, targetBlock);
    };
  }

  const executionPrototype = UltraLowLatencyExecutor.prototype as any;
  if (!installed.has(executionPrototype)) {
    installed.add(executionPrototype);
    executionPrototype.executeMultiPath = async function(opp: { to: string; data: string; value: string; gasLimit: number }) {
      const startTime = Date.now();
      getCryptocrawlGovernance().requireAllowed('SUBMIT_TX');
      if (!this.initialized) await this.initialize();
      if (!this.wallet || !this.provider) throw new Error('Ultra-low-latency signer/provider is not initialized');

      const nonce = await reservePendingNonce(this);
      try {
        const [network, feeData] = await Promise.all([
          this.provider.getNetwork(),
          this.provider.getFeeData(),
        ]);
        const transaction: providers.TransactionRequest = {
          to: opp.to,
          data: opp.data,
          value: opp.value,
          gasLimit: opp.gasLimit,
          nonce,
          chainId: network.chainId,
        };
        if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
          transaction.type = 2;
          transaction.maxFeePerGas = feeData.maxFeePerGas;
          transaction.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
        } else if (feeData.gasPrice) {
          transaction.gasPrice = feeData.gasPrice;
        } else {
          throw new Error('Provider returned no executable gas price');
        }

        const signedTransaction = await this.wallet.signTransaction(transaction);
        const expectedHash = ethers.utils.keccak256(signedTransaction);
        const paths: Array<{ name: string; provider: providers.JsonRpcProvider }> = [
          { name: 'private_rpc', provider: this.provider },
          { name: 'flashbots_rpc', provider: new providers.JsonRpcProvider(this.flashbotsUrl) },
          { name: 'bloxroute_rpc', provider: new providers.JsonRpcProvider(this.bloxrouteUrl) },
        ];
        const submissions = paths.map(({ name, provider }) => provider.sendTransaction(signedTransaction).then(response => ({
          txHash: response.hash || expectedHash,
          path: name,
        })));
        const result = await Promise.any(submissions);
        const latency = Date.now() - startTime;
        logger.info('[UltraLowLatencyExecutor] Identical signed payload accepted by at least one broadcast path', {
          component: 'UltraLowLatencyExecutor',
          txHash: result.txHash,
          winner: result.path,
          latencyMs: latency,
          nonce,
          promiseAny: true,
        });
        return { success: true, txHash: result.txHash, latency, method: 'multipath' as const, signedTransaction };
      } catch (error) {
        resetNonceAuthority(this);
        const aggregate = error instanceof AggregateError
          ? error.errors.map(item => item instanceof Error ? item.message : String(item)).join('; ')
          : error instanceof Error ? error.message : String(error);
        logger.error('[UltraLowLatencyExecutor] All broadcast paths failed', {
          component: 'UltraLowLatencyExecutor',
          nonce,
          error: aggregate,
        });
        return { success: false, latency: Date.now() - startTime, method: 'multipath' as const };
      }
    };
  }

  logger.info('[CryptoCoreRuntime] Low-latency execution correctness wiring installed', {
    component: 'CryptoCoreRuntime',
    identicalSignedPayloadAcrossPaths: true,
    firstSuccessSemantics: 'Promise.any',
    pendingNonceAuthority: true,
    flashbotsSimulation: 'real_relay_simulation',
    transactionHashRejectedAsBundlePayload: true,
  });
}
