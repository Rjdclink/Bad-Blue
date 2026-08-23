import { BigNumber, ethers, providers } from 'ethers';
import type { BuiltOnchainPayload } from './onchain-payload-builder.js';

const MAX_U256 = (1n << 256n) - 1n;

export interface SkaleExternalGasPowRequest {
  workloadId: string;
  sender: string;
  nonce: number;
  payload: BuiltOnchainPayload;
  requiredGas: bigint;
  externalGasDifficulty: bigint;
  maxAttempts: number;
  partitionId?: number;
  partitionCount?: number;
  signal?: AbortSignal;
}

export interface SkaleExternalGasPowSolution {
  gasPriceWei: string;
  externalGas: bigint;
  attempts: number;
  partitionId: number;
}

function abortError(): Error {
  const error = new Error('SKALE PoW workload cancelled');
  error.name = 'AbortError';
  return error;
}

function parseU256(label: string, value: bigint | string): bigint {
  const normalized = typeof value === 'bigint' ? value : value.trim();
  try {
    const parsed = BigInt(normalized);
    if (parsed < 0n || parsed > MAX_U256) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label} must be an unsigned 256-bit integer`);
  }
}

function u256Bytes(value: bigint): Uint8Array {
  return ethers.utils.arrayify(ethers.utils.hexZeroPad(ethers.utils.hexlify(BigNumber.from(value.toString())), 32));
}

function hashAsU256(value: Uint8Array): bigint {
  return BigInt(ethers.utils.keccak256(value));
}

/**
 * Mirrors skaled Transaction::checkOutExternalGas: keccak(sender) XOR
 * keccak(nonce) XOR keccak(gasPrice), then maxU256/hash/difficulty.
 */
export function calculateSkaleExternalGas(sender: string, nonce: number, gasPriceWei: bigint, difficulty: bigint): bigint {
  const normalizedSender = ethers.utils.getAddress(sender);
  const normalizedNonce = parseU256('nonce', BigInt(nonce));
  const normalizedGasPrice = parseU256('gasPriceWei', gasPriceWei);
  const normalizedDifficulty = parseU256('externalGasDifficulty', difficulty);
  if (normalizedDifficulty === 0n) throw new Error('externalGasDifficulty must be greater than zero');

  let hash = hashAsU256(ethers.utils.arrayify(normalizedSender)) ^
    hashAsU256(u256Bytes(normalizedNonce)) ^
    hashAsU256(u256Bytes(normalizedGasPrice));
  if (hash === 0n) hash = 1n;
  return MAX_U256 / hash / normalizedDifficulty;
}

export function deriveSkalePowCandidate(workloadId: string, partitionId: number, partitionCount: number, attempt: number): bigint {
  if (!Number.isInteger(partitionId) || partitionId < 0 || !Number.isInteger(partitionCount) || partitionCount <= 0 || partitionId >= partitionCount) {
    throw new Error('Invalid SKALE PoW partition bounds');
  }
  const seed = BigInt(ethers.utils.keccak256(ethers.utils.toUtf8Bytes(workloadId)));
  return (seed + BigInt(partitionId) + BigInt(attempt) * BigInt(partitionCount)) & MAX_U256;
}

export class SkaleExternalGasPowAdapter {
  constructor(private readonly provider: providers.Provider) {}

  async findProof(request: SkaleExternalGasPowRequest): Promise<SkaleExternalGasPowSolution> {
    const difficulty = parseU256('externalGasDifficulty', request.externalGasDifficulty);
    if (difficulty === 0n) throw new Error('externalGasDifficulty must be greater than zero');
    if (!Number.isInteger(request.maxAttempts) || request.maxAttempts <= 0) {
      throw new Error('maxAttempts must be a positive integer');
    }

    const partitionId = request.partitionId ?? 0;
    const partitionCount = request.partitionCount ?? 1;
    for (let attempt = 0; attempt < request.maxAttempts; attempt += 1) {
      if (request.signal?.aborted) throw abortError();
      const candidate = deriveSkalePowCandidate(request.workloadId, partitionId, partitionCount, attempt);
      const externalGas = calculateSkaleExternalGas(request.sender, request.nonce, candidate, difficulty);
      if (externalGas < request.requiredGas) continue;

      const solution: SkaleExternalGasPowSolution = {
        gasPriceWei: candidate.toString(),
        externalGas,
        attempts: attempt + 1,
        partitionId,
      };
      if (await this.verifyProof(request, solution)) return solution;
    }
    throw new Error(`SKALE external-gas proof not found in ${request.maxAttempts} attempts for partition ${partitionId}`);
  }

  async verifyProof(request: SkaleExternalGasPowRequest, solution: SkaleExternalGasPowSolution): Promise<boolean> {
    const candidate = parseU256('solution gasPriceWei', solution.gasPriceWei);
    const difficulty = parseU256('externalGasDifficulty', request.externalGasDifficulty);
    const externalGas = calculateSkaleExternalGas(request.sender, request.nonce, candidate, difficulty);
    if (externalGas < request.requiredGas) return false;

    try {
      const estimate = await this.provider.estimateGas({
        from: ethers.utils.getAddress(request.sender),
        to: request.payload.to,
        data: request.payload.data,
        value: BigNumber.from(request.payload.value),
        gasPrice: BigNumber.from(solution.gasPriceWei),
      });
      return externalGas >= BigInt(estimate.toString()) && estimate.lte(request.payload.gasLimit);
    } catch {
      return false;
    }
  }
}

export function getEuropaExternalGasDifficulty(environment: NodeJS.ProcessEnv = process.env): bigint {
  const configured = environment.EUROPA_EXTERNAL_GAS_DIFFICULTY?.trim();
  if (!configured) {
    throw new Error('EUROPA_EXTERNAL_GAS_DIFFICULTY is required because the public Europa RPC does not expose debug_getConfig');
  }
  const difficulty = parseU256('EUROPA_EXTERNAL_GAS_DIFFICULTY', configured);
  if (difficulty === 0n) throw new Error('EUROPA_EXTERNAL_GAS_DIFFICULTY must be greater than zero');
  return difficulty;
}

function findExternalGasDifficulty(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || !value || typeof value !== 'object') return undefined;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'externalGasDifficulty' && (typeof child === 'string' || typeof child === 'number')) return String(child);
    const nested = findExternalGasDifficulty(child, depth + 1);
    if (nested) return nested;
  }
  return undefined;
}

export async function resolveEuropaExternalGasDifficulty(
  provider: providers.Provider,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<{ difficulty: bigint; source: 'rpc-config' | 'environment' }> {
  const rpcProvider = provider as providers.JsonRpcProvider;
  for (const method of ['debug_getConfig', 'skale_getConfig']) {
    try {
      const config = await rpcProvider.send(method, []);
      const configured = findExternalGasDifficulty(config);
      if (configured !== undefined) {
        const difficulty = parseU256('RPC externalGasDifficulty', configured);
        if (difficulty > 0n) return { difficulty, source: 'rpc-config' };
      }
    } catch {
      // Public Europa endpoints may disable configuration introspection.
    }
  }
  return { difficulty: getEuropaExternalGasDifficulty(environment), source: 'environment' };
}