import { parentPort } from 'node:worker_threads';
import {
  runProfitabilityMonteCarlo,
  type MonteCarloProfitabilityInput,
} from './monte-carlo-profitability.js';

type WorkerRequest = {
  id: string;
  input: MonteCarloProfitabilityInput;
};

type WorkerResponse = {
  id: string;
  result?: ReturnType<typeof runProfitabilityMonteCarlo>;
  error?: string;
};

if (!parentPort) throw new Error('Monte Carlo worker requires a worker_threads parent port');

parentPort.on('message', (message: WorkerRequest) => {
  const response: WorkerResponse = { id: message.id };
  try {
    response.result = runProfitabilityMonteCarlo(message.input);
  } catch (error) {
    response.error = error instanceof Error ? error.message : String(error);
  }
  parentPort!.postMessage(response);
});
