import { BigNumber, ethers, type providers } from 'ethers';
import { multiProviderRpcManager } from '../../api/blockchain-providers.js';

export interface BuilderSequentialSimulationCall {
  from: string;
  to: string;
  data: string;
  value: BigNumber;
}

export interface BuilderSequentialSimulationResult {
  gasUsed: bigint[];
  provider: string;
}

export class BuilderSequentialSimulationExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuilderSequentialSimulationExecutionError';
  }
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  const value = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.max(min, Math.min(max, value));
}

function rpcQuantity(value: BigNumber): string {
  return ethers.utils.hexValue(value);
}

/** Buffer only the measured per-transaction gas vector; it is never a fixed
 * topology estimate. 12000 = 20% safety headroom by default. */
export function builderGasSimulationSafetyBps(): bigint {
  return BigInt(boundedInteger(process.env.ZERO_CAPITAL_BUILDER_GAS_SAFETY_BPS, 12_000, 10_000, 20_000));
}

export function bufferedBuilderGasLimit(gasUsed: bigint): BigNumber {
  if (gasUsed <= 0n) throw new Error('Sequential gas simulation returned zero gas for a bundle transaction');
  const safety = builderGasSimulationSafetyBps();
  const buffered = (gasUsed * safety + 9_999n) / 10_000n;
  return BigNumber.from(buffered.toString());
}

export function sumBuilderGasLimits(limits: readonly BigNumber[]): bigint {
  return limits.reduce((sum, value) => sum + BigInt(value.toString()), 0n);
}

export function maxBuilderGasVectors(vectors: readonly bigint[][]): bigint[] {
  if (vectors.length === 0) throw new Error('No sequential gas simulation results were returned');
  const width = vectors[0].length;
  if (width === 0 || vectors.some(vector => vector.length !== width)) {
    throw new Error('Sequential gas simulation returned inconsistent transaction counts');
  }
  return Array.from({ length: width }, (_, index) => vectors.reduce(
    (maximum, vector) => vector[index] > maximum ? vector[index] : maximum,
    0n,
  ));
}

async function simulateOnProvider(
  provider: providers.JsonRpcProvider,
  calls: readonly BuilderSequentialSimulationCall[],
): Promise<bigint[]> {
  // eth_simulateV1 executes the calls in order against evolving ephemeral state.
  // That is required here: the flash execution creates value used by the repayment
  // conversion, and the conversion creates the ETH used by the terminal builder pay.
  const response = await provider.send('eth_simulateV1', [{
    blockStateCalls: [{
      calls: calls.map(call => ({
        from: call.from,
        to: call.to,
        data: call.data,
        value: rpcQuantity(call.value),
      })),
    }],
    validation: false,
    traceTransfers: false,
    returnFullTransactions: false,
  }, 'latest']);

  if (!Array.isArray(response) || response.length === 0 || !Array.isArray(response[0]?.calls)) {
    throw new Error('eth_simulateV1 returned no call-level gas evidence');
  }
  const results = response[0].calls as Array<{ status?: string; gasUsed?: string; error?: { message?: string } }>;
  if (results.length !== calls.length) throw new Error('eth_simulateV1 returned an incomplete call sequence');
  return results.map((result, index) => {
    if (result.status !== '0x1') {
      throw new BuilderSequentialSimulationExecutionError(
        `Sequential builder simulation call ${index} failed: ${result.error?.message || 'EVM failure'}`,
      );
    }
    if (typeof result.gasUsed !== 'string' || !/^0x[0-9a-fA-F]+$/.test(result.gasUsed)) {
      throw new Error(`Sequential builder simulation call ${index} omitted gasUsed`);
    }
    return BigInt(result.gasUsed);
  });
}

/**
 * Stateful multi-call gas measurement with route-local RPC failover. Provider
 * capability/transport failure can move to another RPC; an actual EVM failure is
 * surfaced immediately so another RPC cannot manufacture different economics.
 */
export async function simulateBuilderSequentialGas(
  calls: readonly BuilderSequentialSimulationCall[],
): Promise<BuilderSequentialSimulationResult> {
  if (calls.length === 0) throw new Error('Sequential builder simulation requires at least one call');
  const { result, provenance } = await multiProviderRpcManager.execute(
    'ethereum',
    'contract_calls',
    provider => simulateOnProvider(provider, calls),
  );
  return { gasUsed: result, provider: provenance.provider };
}
