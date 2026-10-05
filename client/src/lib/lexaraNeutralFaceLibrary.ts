/**
 * Lexara neutral facial-performance library.
 *
 * This is deliberately subordinate to the existing audio-authoritative embodiment engine.
 * It does not start, stop, buffer, schedule, or delay audio.
 *
 * 1,000 deterministic neutral face states = 20 viseme families x 10 articulation strengths
 * x 5 neutral micro-motion phases.
 * 750 prepared sequences = 15 sequence families x 10 articulation strengths x 5 phases.
 */
export interface LexaraNeutralFaceState {
  id: number;
  viseme: number;
  strength: number;
  phase: number;
  mouthOpen: number;
  mouthWide: number;
  mouthRound: number;
  jawDrop: number;
  cheekLift: number;
  browLift: number;
  blinkBias: number;
  headX: number;
  headY: number;
  headTilt: number;
}

export interface LexaraNeutralFaceSequence {
  id: number;
  family: number;
  strength: number;
  phase: number;
  stateIds: readonly number[];
  durationMs: number;
}

const VISEMES = 20;
const STRENGTHS = 10;
const PHASES = 5;
const SEQUENCE_FAMILIES = 15;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const stateId = (viseme: number, strength: number, phase: number) =>
  viseme * STRENGTHS * PHASES + strength * PHASES + phase;

export const LEXARA_NEUTRAL_FACE_STATES: readonly LexaraNeutralFaceState[] = Object.freeze(
  Array.from({ length: VISEMES * STRENGTHS * PHASES }, (_, id) => {
    const viseme = Math.floor(id / (STRENGTHS * PHASES));
    const remainder = id % (STRENGTHS * PHASES);
    const strength = Math.floor(remainder / PHASES);
    const phase = remainder % PHASES;
    const s = (strength + 1) / STRENGTHS;
    const vowel = viseme % 5;
    const micro = (phase - 2) / 2;
    return Object.freeze({
      id, viseme, strength, phase,
      mouthOpen: clamp01(s * ([0.10, 0.42, 0.72, 0.55, 0.30][vowel] ?? 0.35)),
      mouthWide: clamp01(s * ([0.30, 0.72, 0.42, 0.55, 0.22][vowel] ?? 0.40)),
      mouthRound: clamp01(s * ([0.12, 0.18, 0.35, 0.68, 0.82][vowel] ?? 0.30)),
      jawDrop: clamp01(s * ([0.08, 0.30, 0.76, 0.52, 0.28][vowel] ?? 0.32)),
      cheekLift: clamp01(0.04 + s * 0.08 + Math.max(0, micro) * 0.015),
      browLift: clamp01(0.035 + (phase === 3 ? 0.025 : 0)),
      blinkBias: phase === 4 ? 0.12 : phase === 0 ? 0.035 : 0,
      headX: micro * 0.0009,
      headY: Math.abs(micro) * 0.00045,
      headTilt: micro * 0.10,
    });
  }),
);

const makeSequence = (id: number): LexaraNeutralFaceSequence => {
  const family = Math.floor(id / (STRENGTHS * PHASES));
  const remainder = id % (STRENGTHS * PHASES);
  const strength = Math.floor(remainder / PHASES);
  const phase = remainder % PHASES;
  const baseViseme = family % 15;
  const path = [0, 1, 2, 3, 4, 3, 2, 1].map((step, index) =>
    stateId((baseViseme + (index > 3 ? 1 : 0)) % VISEMES, strength, (phase + step) % PHASES),
  );
  return Object.freeze({
    id, family, strength, phase,
    stateIds: Object.freeze(path),
    durationMs: 240 + family * 8 + strength * 10 + phase * 6,
  });
};

export const LEXARA_NEUTRAL_FACE_SEQUENCES: readonly LexaraNeutralFaceSequence[] = Object.freeze(
  Array.from({ length: SEQUENCE_FAMILIES * STRENGTHS * PHASES }, (_, id) => makeSequence(id)),
);

if (LEXARA_NEUTRAL_FACE_STATES.length !== 1000) throw new Error('Lexara neutral face state library must contain exactly 1000 states');
if (LEXARA_NEUTRAL_FACE_SEQUENCES.length !== 750) throw new Error('Lexara neutral face sequence library must contain exactly 750 sequences');

export function getLexaraNeutralFaceState(id: number): LexaraNeutralFaceState {
  return LEXARA_NEUTRAL_FACE_STATES[Math.max(0, Math.min(999, Math.round(id)))]!;
}

export function selectLexaraNeutralFaceSequence(viseme: number, strength01: number, phaseSeed = 0): LexaraNeutralFaceSequence {
  const family = Math.max(0, Math.min(14, Math.round(viseme) % 15));
  const strength = Math.max(0, Math.min(9, Math.round(clamp01(strength01) * 9)));
  const phase = Math.abs(Math.round(phaseSeed)) % 5;
  return LEXARA_NEUTRAL_FACE_SEQUENCES[family * 50 + strength * 5 + phase]!;
}
