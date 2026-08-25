import crypto from 'node:crypto';
import type { providers } from 'ethers';
import { SkalePowBeamWorkloadAdapter } from '../../../computationalBeam/skalePowWorkloadAdapter.js';
import {
  SkaleExternalGasPowAdapter,
  type SkaleExternalGasPowRequest,
  type SkaleExternalGasPowSolution,
} from './skale-pow-adapter.js';
import {
  estimateRailwayIncrementalMicroUsd,
  InMemoryRailwayBootstrapBudgetLedger,
  PostgresRailwayBootstrapBudgetLedger,
  RailwayBootstrapBudgetGovernor,
  type RailwayBootstrapBudgetLedger,
} from './railway-bootstrap-budget.js';

export type Stage4ComputeSource = 'zero-dollar-remote' | 'zero-dollar-local-beam' | 'railway-emergency';

export interface BootstrapComputeAvailability {
  available: boolean;
  capacity?: number;
  expiresAt?: number;
  detail?: string;
}

export interface RemotePowMetrics {
  cpuMilliseconds?: number;
  memoryMegabyteMilliseconds?: number;
}

export interface BootstrapComputeProvider {
  readonly id: string;
  readonly source: 'zero-dollar-remote' | 'railway-emergency';
  availability(signal?: AbortSignal): Promise<BootstrapComputeAvailability>;
  solve(request: SkaleExternalGasPowRequest, signal?: AbortSignal): Promise<{ solution: SkaleExternalGasPowSolution; metrics?: RemotePowMetrics }>;
}

interface HttpPowResponse {
  gasPriceWei?: unknown;
  externalGas?: unknown;
  attempts?: unknown;
  partitionId?: unknown;
  cpuMilliseconds?: unknown;
  memoryMegabyteMilliseconds?: unknown;
}

function requireNonNegativeInteger(label: string, value: unknown): number {
  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue) || numberValue < 0) throw new Error(`${label} must be a non-negative integer`);
  return numberValue;
}

function requirePositiveInteger(label: string, value: unknown): number {
  const numberValue = requireNonNegativeInteger(label, value);
  if (numberValue === 0) throw new Error(`${label} must be positive`);
  return numberValue;
}

function normalizeBaseUrl(value: string): URL {
  const url = new URL(value.trim());
  if (url.protocol !== 'https:') throw new Error('Bootstrap compute endpoint must use HTTPS');
  if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`;
  return url;
}

function endpointUrl(base: URL, path: string): string {
  return new URL(path.replace(/^\//, ''), base).toString();
}

function serializeRequest(request: SkaleExternalGasPowRequest): Record<string, unknown> {
  return {
    workloadId: request.workloadId,
    sender: request.sender,
    nonce: request.nonce,
    payload: request.payload,
    requiredGas: request.requiredGas.toString(),
    externalGasDifficulty: request.externalGasDifficulty.toString(),
    maxAttempts: request.maxAttempts,
    partitionId: request.partitionId,
    partitionCount: request.partitionCount,
  };
}

/**
 * Remote providers receive only unsigned public transaction state. They never
 * receive a private key, raw signed transaction, session secret, or database credential.
 */
export class HttpBootstrapComputeProvider implements BootstrapComputeProvider {
  readonly id: string;

  constructor(
    readonly source: 'zero-dollar-remote' | 'railway-emergency',
    endpoint: string,
    private readonly token?: string,
  ) {
    const url = normalizeBaseUrl(endpoint);
    this.baseUrl = url;
    this.id = `${source}:${url.host}${url.pathname}`;
  }

  private readonly baseUrl: URL;

  async availability(signal?: AbortSignal): Promise<BootstrapComputeAvailability> {
    try {
      const response = await fetch(endpointUrl(this.baseUrl, 'v1/health'), {
        method: 'GET',
        headers: this.token ? { authorization: `Bearer ${this.token}` } : undefined,
        signal,
      });
      if (!response.ok) return { available: false, detail: `health status ${response.status}` };
      const body = await response.json() as Record<string, unknown>;
      return {
        available: body.available === true,
        capacity: body.capacity === undefined ? undefined : requirePositiveInteger('capacity', body.capacity),
        expiresAt: body.expiresAt === undefined ? undefined : requirePositiveInteger('expiresAt', body.expiresAt),
        detail: typeof body.detail === 'string' ? body.detail : undefined,
      };
    } catch (error) {
      return { available: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async solve(request: SkaleExternalGasPowRequest, signal?: AbortSignal): Promise<{ solution: SkaleExternalGasPowSolution; metrics?: RemotePowMetrics }> {
    const response = await fetch(endpointUrl(this.baseUrl, 'v1/skale-pow'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(serializeRequest(request)),
      signal,
    });
    if (!response.ok) throw new Error(`Bootstrap compute provider ${this.id} returned ${response.status}`);
    const body = await response.json() as HttpPowResponse;
    const gasPriceWei = String(body.gasPriceWei || '');
    const externalGas = String(body.externalGas || '');
    if (!/^\d+$/.test(gasPriceWei) || !/^\d+$/.test(externalGas)) {
      throw new Error(`Bootstrap compute provider ${this.id} returned an invalid SKALE PoW solution`);
    }
    return {
      solution: {
        gasPriceWei,
        externalGas: BigInt(externalGas),
        attempts: requirePositiveInteger('attempts', body.attempts),
        partitionId: requireNonNegativeInteger('partitionId', body.partitionId),
      },
      metrics: {
        cpuMilliseconds: body.cpuMilliseconds === undefined ? undefined : requireNonNegativeInteger('cpuMilliseconds', body.cpuMilliseconds),
        memoryMegabyteMilliseconds: body.memoryMegabyteMilliseconds === undefined ? undefined : requireNonNegativeInteger('memoryMegabyteMilliseconds', body.memoryMegabyteMilliseconds),
      },
    };
  }
}

export interface Stage4PowComputeResult {
  solution: SkaleExternalGasPowSolution;
  source: Stage4ComputeSource;
  providerId?: string;
  attempts: number;
}

export interface Stage4PowComputeCoordinatorOptions {
  environment?: NodeJS.ProcessEnv;
  zeroDollarProviders?: BootstrapComputeProvider[];
  railwayProvider?: BootstrapComputeProvider;
  railwayBudgetLedger?: RailwayBootstrapBudgetLedger;
}

export class Stage4PowComputeCoordinator {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly zeroDollarProviders: BootstrapComputeProvider[];
  private readonly railwayProvider?: BootstrapComputeProvider;
  private readonly railwayBudget: RailwayBootstrapBudgetGovernor;

  constructor(
    private readonly provider: providers.Provider,
    options: Stage4PowComputeCoordinatorOptions = {},
  ) {
    this.environment = options.environment || process.env;
    this.zeroDollarProviders = options.zeroDollarProviders || this.resolveZeroDollarProviders();
    this.railwayProvider = options.railwayProvider || this.resolveRailwayProvider();
    this.railwayBudget = new RailwayBootstrapBudgetGovernor(
      options.railwayBudgetLedger ||
        (this.environment.NODE_ENV === 'test'
          ? new InMemoryRailwayBootstrapBudgetLedger()
          : new PostgresRailwayBootstrapBudgetLedger()),
    );
  }

  async findProof(request: SkaleExternalGasPowRequest, options?: { workerCount?: number; timeoutMs?: number }): Promise<Stage4PowComputeResult> {
    const verifier = new SkaleExternalGasPowAdapter(this.provider);
    for (const computeProvider of this.zeroDollarProviders) {
      const availability = await computeProvider.availability(request.signal);
      if (!availability.available) continue;
      try {
        const result = await computeProvider.solve(request, request.signal);
        if (await verifier.verifyProof(request, result.solution)) {
          return {
            solution: result.solution,
            source: 'zero-dollar-remote',
            providerId: computeProvider.id,
            attempts: result.solution.attempts,
          };
        }
      } catch {
        // Continue to another legitimate zero-dollar provider or a fail-closed fallback.
      }
    }

    if (this.localBeamIsVerifiedFree()) {
      const local = await new SkalePowBeamWorkloadAdapter(this.provider).findProofThroughBeam(request, options);
      return {
        solution: local.solution,
        source: 'zero-dollar-local-beam',
        attempts: local.metrics.attempts,
      };
    }

    return this.findProofWithRailwayEmergency(request);
  }

  private async findProofWithRailwayEmergency(request: SkaleExternalGasPowRequest): Promise<Stage4PowComputeResult> {
    if (this.environment.RAILWAY_BOOTSTRAP_ENABLE_EMERGENCY !== 'true') {
      throw new Error('No zero-dollar bootstrap compute is available and Railway emergency compute is disabled; failing closed');
    }
    if (!this.railwayProvider) {
      throw new Error('Railway emergency compute requires RAILWAY_BOOTSTRAP_COMPUTE_URL');
    }
    const availability = await this.railwayProvider.availability(request.signal);
    if (!availability.available) {
      throw new Error(`Railway emergency compute is unavailable: ${availability.detail || 'unknown health failure'}`);
    }
    const cpuMs = requirePositiveInteger('RAILWAY_BOOTSTRAP_PROJECTED_CPU_MS', this.environment.RAILWAY_BOOTSTRAP_PROJECTED_CPU_MS || '');
    const memoryMb = requirePositiveInteger('RAILWAY_BOOTSTRAP_PROJECTED_MEMORY_MB', this.environment.RAILWAY_BOOTSTRAP_PROJECTED_MEMORY_MB || '');
    const projectedMicroUsd = estimateRailwayIncrementalMicroUsd({
      cpuMilliseconds: cpuMs,
      memoryMegabyteMilliseconds: cpuMs * memoryMb,
      cpuUsdPerHour: this.requireEnvironment('RAILWAY_BOOTSTRAP_CPU_USD_PER_HOUR'),
      memoryGbUsdPerHour: this.requireEnvironment('RAILWAY_BOOTSTRAP_MEMORY_GB_USD_PER_HOUR'),
    });
    const eventId = `stage4:${request.workloadId}`;
    const workId = crypto.randomUUID();
    await this.railwayBudget.reserve(eventId, workId, projectedMicroUsd);
    try {
      const result = await this.railwayProvider.solve(request, request.signal);
      const verifier = new SkaleExternalGasPowAdapter(this.provider);
      if (!await verifier.verifyProof(request, result.solution)) {
        throw new Error('Railway emergency compute returned an invalid SKALE PoW proof');
      }
      const actualMicroUsd = estimateRailwayIncrementalMicroUsd({
        cpuMilliseconds: result.metrics?.cpuMilliseconds ?? cpuMs,
        memoryMegabyteMilliseconds: result.metrics?.memoryMegabyteMilliseconds ?? cpuMs * memoryMb,
        cpuUsdPerHour: this.requireEnvironment('RAILWAY_BOOTSTRAP_CPU_USD_PER_HOUR'),
        memoryGbUsdPerHour: this.requireEnvironment('RAILWAY_BOOTSTRAP_MEMORY_GB_USD_PER_HOUR'),
      });
      const budget = await this.railwayBudget.settle(eventId, workId, actualMicroUsd);
      if (budget.hardLimitReached) {
        throw new Error('RAILWAY_BOOTSTRAP_HARD_BUDGET_REACHED');
      }
      return {
        solution: result.solution,
        source: 'railway-emergency',
        providerId: this.railwayProvider.id,
        attempts: result.solution.attempts,
      };
    } catch (error) {
      await this.railwayBudget.cancel(eventId, workId);
      throw error;
    }
  }

  private localBeamIsVerifiedFree(): boolean {
    const isRailway = Boolean(this.environment.RAILWAY_ENVIRONMENT?.trim());
    if (isRailway) return false;
    return this.environment.NODE_ENV !== 'production' || this.environment.ZERO_CAPITAL_LOCAL_COMPUTE_CONFIRMED_FREE === 'true';
  }

  private resolveZeroDollarProviders(): BootstrapComputeProvider[] {
    return (this.environment.ZERO_CAPITAL_BOOTSTRAP_COMPUTE_URLS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
      .map(endpoint => new HttpBootstrapComputeProvider('zero-dollar-remote', endpoint, this.environment.ZERO_CAPITAL_BOOTSTRAP_COMPUTE_TOKEN));
  }

  private resolveRailwayProvider(): BootstrapComputeProvider | undefined {
    const endpoint = this.environment.RAILWAY_BOOTSTRAP_COMPUTE_URL?.trim();
    return endpoint
      ? new HttpBootstrapComputeProvider('railway-emergency', endpoint, this.environment.RAILWAY_BOOTSTRAP_COMPUTE_TOKEN)
      : undefined;
  }

  private requireEnvironment(name: string): string {
    const value = this.environment[name]?.trim();
    if (!value) throw new Error(`${name} is required for Railway emergency compute`);
    return value;
  }
}