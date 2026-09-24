import {
  LEXARA_PREPARED_FACE_POSES as CORE_POSES,
  type LexaraPreparedFacePose,
  type LexaraVisemeName,
} from './lexaraPreparedFacePoses';

export interface LexaraPreparedFacialState extends LexaraPreparedFacePose {
  libraryIndex: number;
  sourcePoseIndex: number;
  microVariant: number;
  blinkBias: number;
  headXBias: number;
  headYBias: number;
  headRollBias: number;
}

export interface LexaraPreparedFacialSequence {
  index: number;
  family: LexaraVisemeName;
  stateIndices: readonly number[];
  nominalDurationMs: number;
  entryState: number;
  exitState: number;
}

/**
 * Offline-prepared deterministic expansion of the proven 120-pose manifold.
 * Runtime remains a read-only consumer: no network/model work and no audio ownership.
 */
const MICRO_VARIANTS = 9;
const clampSigned = (v: number, limit: number) => Math.max(-limit, Math.min(limit, v));

const candidates: LexaraPreparedFacialState[] = CORE_POSES.flatMap((pose) =>
  Array.from({ length: MICRO_VARIANTS }, (_, microVariant) => {
    const centered = (microVariant - 4) / 4;
    const alternate = ((pose.index + microVariant * 7) % 9 - 4) / 4;
    return {
      ...pose,
      libraryIndex: -1,
      sourcePoseIndex: pose.index,
      microVariant,
      mouthOpen: Math.max(0, Math.min(1, pose.mouthOpen * (1 + centered * 0.035))),
      mouthWide: Math.max(0, Math.min(1, pose.mouthWide + alternate * 0.018)),
      mouthRound: Math.max(0, Math.min(1, pose.mouthRound + centered * 0.015)),
      jawDrop: Math.max(0, Math.min(1, pose.jawDrop * (1 + alternate * 0.025))),
      cheekLift: Math.max(0, Math.min(1, pose.cheekLift + centered * 0.012)),
      browLift: Math.max(0, Math.min(1, pose.browLift + alternate * 0.010)),
      blinkBias: microVariant === 0 ? 0.08 : microVariant === 8 ? 0.04 : 0,
      headXBias: clampSigned(centered * 0.018, 0.02),
      headYBias: clampSigned(alternate * 0.012, 0.015),
      headRollBias: clampSigned((centered - alternate) * 0.28, 0.35),
    };
  }),
);

// Preserve every canonical state first, then select deterministic micro-variants
// across the full manifold until exactly 1,000 useful reference states exist.
const canonical = candidates.filter((state) => state.microVariant === 4);
const variants = candidates.filter((state) => state.microVariant !== 4);
const selected = [...canonical, ...variants.slice(0, 1000 - canonical.length)];

export const LEXARA_PREPARED_FACIAL_STATES: readonly LexaraPreparedFacialState[] =
  selected.map((state, libraryIndex) => ({ ...state, libraryIndex }));

if (LEXARA_PREPARED_FACIAL_STATES.length !== 1000) {
  throw new Error('LEXARA prepared facial state library must contain exactly 1000 states');
}

const statesByViseme = new Map<LexaraVisemeName, number[]>();
for (const state of LEXARA_PREPARED_FACIAL_STATES) {
  const bucket = statesByViseme.get(state.viseme) ?? [];
  bucket.push(state.libraryIndex);
  statesByViseme.set(state.viseme, bucket);
}

export const LEXARA_PREPARED_FACIAL_SEQUENCES: readonly LexaraPreparedFacialSequence[] =
  Array.from({ length: 750 }, (_, index) => {
    const core = CORE_POSES[index % CORE_POSES.length];
    const bucket = statesByViseme.get(core.viseme) ?? [0];
    const length = 6 + (index % 9);
    const start = (index * 11 + core.strengthLevel * 3) % bucket.length;
    const stride = 1 + ((index * 5) % Math.max(1, Math.min(7, bucket.length - 1)));
    const stateIndices = Array.from({ length }, (_, offset) =>
      bucket[(start + offset * stride) % bucket.length],
    );
    return {
      index,
      family: core.viseme,
      stateIndices,
      nominalDurationMs: 180 + length * 34 + (index % 5) * 17,
      entryState: stateIndices[0],
      exitState: stateIndices[stateIndices.length - 1],
    };
  });

if (LEXARA_PREPARED_FACIAL_SEQUENCES.length !== 750) {
  throw new Error('LEXARA prepared facial sequence library must contain exactly 750 sequences');
}

export function getLexaraPreparedFacialState(index: number): LexaraPreparedFacialState {
  const safe = Number.isFinite(index)
    ? Math.max(0, Math.min(LEXARA_PREPARED_FACIAL_STATES.length - 1, Math.round(index)))
    : 0;
  return LEXARA_PREPARED_FACIAL_STATES[safe];
}

export function selectLexaraPreparedFacialSequence(
  visemeIndex: number,
  strengthLevel: number,
  speechClockSec: number,
): LexaraPreparedFacialSequence {
  const safeViseme = Math.max(0, Math.min(14, Math.round(visemeIndex)));
  const family = CORE_POSES[safeViseme * 8]?.viseme ?? 'sil';
  const familyIndex = LEXARA_VISEME_NAMES.indexOf(family);
  const first = Math.max(0, familyIndex) * 50;
  const phase = Math.abs(Math.floor(speechClockSec * 7.5 + strengthLevel * 13));
  return LEXARA_PREPARED_FACIAL_SEQUENCES[first + (phase % 50)] ?? LEXARA_PREPARED_FACIAL_SEQUENCES[0];
}
