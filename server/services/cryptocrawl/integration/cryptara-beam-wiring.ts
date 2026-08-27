import type Cryptara from '../../cryptara/index.js';
import type { MonteCarloResult } from '../../cryptara/index.js';
import { createLogger } from '../../../logger.js';
import { workloadRouter } from '../../computationalBeam/workloadRouter.js';
import { ComputeLayer, TaskIntensity, TaskPriority, TaskType, type Task } from '../../computationalBeam/types.js';
import { ensureCryptaraBootstrapWiring } from './cryptara-bootstrap-wiring.js';

const log = createLogger('CryptaraBeamWiring');
const installed = new WeakSet<object>();

function validMonteCarloResult(result: unknown): result is MonteCarloResult {
  if (!result || typeof result !== 'object') return false;
  const value = result as MonteCarloResult;
  return typeof value.simulationId === 'string' &&
    value.timestamp instanceof Date &&
    Number.isFinite(value.iterations) && value.iterations > 0 &&
    Array.isArray(value.scenarios) &&
    !!value.riskMetrics &&
    Number.isFinite(value.riskMetrics.valueAtRisk) &&
    Number.isFinite(value.riskMetrics.expectedShortfall) &&
    Number.isFinite(value.riskMetrics.maxDrawdown);
}

async function runThroughBeam(task: Task): Promise<MonteCarloResult> {
  return new Promise<MonteCarloResult>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      workloadRouter.off('task-completed', onCompleted);
      workloadRouter.off('task-failed', onFailed);
    };
    const onCompleted = (event: { taskId: string; result?: unknown }) => {
      if (event.taskId !== task.id || settled) return;
      settled = true;
      cleanup();
      const result = event.result ?? workloadRouter.consumeTaskOutcome(task.id)?.result;
      if (!validMonteCarloResult(result)) {
        reject(new Error(`Beam returned invalid Monte Carlo result for ${task.id}`));
        return;
      }
      resolve(result);
    };
    const onFailed = (event: { taskId: string; error?: string }) => {
      if (event.taskId !== task.id || settled) return;
      settled = true;
      cleanup();
      reject(new Error(event.error || `Beam task ${task.id} failed`));
    };
    workloadRouter.on('task-completed', onCompleted);
    workloadRouter.on('task-failed', onFailed);
    void workloadRouter.routeTask(task).catch(error => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
  });
}

export function ensureCryptaraBeamWiring(): Cryptara {
  const instance = ensureCryptaraBootstrapWiring();
  if (installed.has(instance)) return instance;
  installed.add(instance);
  const target = instance as unknown as { runMonteCarloSimulation: () => Promise<MonteCarloResult> };
  const originalRun = target.runMonteCarloSimulation.bind(target);

  target.runMonteCarloSimulation = async (): Promise<MonteCarloResult> => {
    const task = workloadRouter.createTask(TaskType.MONTE_CARLO, {
      source: 'cryptara_verified_opportunity',
    }, {
      intensity: TaskIntensity.HEAVY,
      priority: TaskPriority.HIGH,
      requiredLayer: ComputeLayer.BEAM,
    });
    task.workload = {
      id: `cryptara-monte-carlo:${task.id}`,
      type: 'cryptara_verified_opportunity_monte_carlo',
      input: { requestedAt: Date.now() },
      timeoutMs: Math.max(5_000, Number(process.env.CRYPTARA_BEAM_MONTE_CARLO_TIMEOUT_MS || 30_000)),
      execute: async (_input, context) => {
        if (context.signal.aborted) throw new Error('Cryptara Monte Carlo Beam workload aborted before execution');
        return originalRun();
      },
      validate: result => validMonteCarloResult(result),
    };

    try {
      const result = await runThroughBeam(task);
      log.info('Cryptara Monte Carlo completed through Computational Beam', {
        component: 'CryptaraBeamWiring',
        taskId: task.id,
        simulationId: result.simulationId,
        iterations: result.iterations,
      });
      return result;
    } catch (error) {
      // Do not silently fall back to a second independent model. The caller keeps
      // explicit incomplete evidence if the Beam workload itself is unavailable.
      log.warn('Computational Beam Monte Carlo workload unavailable', {
        component: 'CryptaraBeamWiring',
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  log.info('Cryptara Computational Beam wiring installed', {
    component: 'CryptaraBeamWiring',
    workload: 'verified_opportunity_monte_carlo',
    executionAuthority: false,
  });
  return instance;
}
