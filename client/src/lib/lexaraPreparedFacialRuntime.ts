import {
  getLexaraPreparedFacialState,
  selectLexaraPreparedFacialSequence,
  type LexaraPreparedFacialState,
} from './lexaraPreparedFacialLibrary';

export interface LexaraFacialLibrarySample {
  state: LexaraPreparedFacialState;
  sequenceIndex: number;
  sequenceProgress: number;
}

/**
 * Pure visual adapter. Reads the already-authoritative audio clock and existing
 * viseme decision. It cannot start, stop, buffer, fetch, or otherwise own speech.
 */
export function sampleLexaraPreparedFacialLibrary(
  visemeIndex: number,
  strengthLevel: number,
  speechClockSec: number,
): LexaraFacialLibrarySample {
  const sequence = selectLexaraPreparedFacialSequence(visemeIndex, strengthLevel, speechClockSec);
  const durationSec = Math.max(0.001, sequence.nominalDurationMs / 1000);
  const local = ((speechClockSec % durationSec) + durationSec) % durationSec;
  const progress = local / durationSec;
  const slot = Math.min(sequence.stateIndices.length - 1, Math.floor(progress * sequence.stateIndices.length));
  return {
    state: getLexaraPreparedFacialState(sequence.stateIndices[slot]),
    sequenceIndex: sequence.index,
    sequenceProgress: progress,
  };
}
