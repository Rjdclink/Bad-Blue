import { AsyncLocalStorage } from 'node:async_hooks';
import type { MeasuredOpportunityTopology } from './measured-candidate-registry.js';

interface CandidatePublicationContext {
  topology: MeasuredOpportunityTopology;
  generation: number;
}

const publicationContext = new AsyncLocalStorage<CandidatePublicationContext>();
const currentGeneration = new Map<MeasuredOpportunityTopology, number>();

export class StaleCandidatePublicationError extends Error {
  constructor(topology: MeasuredOpportunityTopology, generation: number, current: number | null) {
    super(`Stale ${topology} candidate publication generation ${generation}; current generation is ${current ?? 'none'}`);
    this.name = 'StaleCandidatePublicationError';
  }
}

export function nextCandidatePublicationGeneration(topology: MeasuredOpportunityTopology): number {
  const generation = (currentGeneration.get(topology) || 0) + 1;
  currentGeneration.set(topology, generation);
  return generation;
}

export function invalidateCandidatePublicationGeneration(
  topology: MeasuredOpportunityTopology,
  generation: number,
): void {
  if (currentGeneration.get(topology) !== generation) return;
  currentGeneration.set(topology, generation + 1);
}

export function runWithCandidatePublicationGeneration<T>(
  topology: MeasuredOpportunityTopology,
  generation: number,
  operation: () => Promise<T> | T,
): Promise<T> {
  return publicationContext.run(
    { topology, generation },
    () => Promise.resolve().then(operation),
  );
}

export function assertCurrentCandidatePublication(topology: MeasuredOpportunityTopology): void {
  const context = publicationContext.getStore();
  if (!context || context.topology !== topology) return;
  const current = currentGeneration.get(topology) ?? null;
  if (current === context.generation) return;
  throw new StaleCandidatePublicationError(topology, context.generation, current);
}

export function getCandidatePublicationGenerationSnapshot() {
  return Object.fromEntries(currentGeneration.entries());
}
