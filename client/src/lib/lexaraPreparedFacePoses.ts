export const LEXARA_VISEME_NAMES = [
  'sil',
  'PP',
  'FF',
  'TH',
  'DD',
  'kk',
  'CH',
  'SS',
  'nn',
  'RR',
  'aa',
  'E',
  'I',
  'O',
  'U',
] as const;

export type LexaraVisemeName = (typeof LEXARA_VISEME_NAMES)[number];

export interface LexaraPreparedFacePose {
  index: number;
  visemeIndex: number;
  viseme: LexaraVisemeName;
  strengthLevel: 1 | 2 | 3 | 4;
  strength: number;
  mouthOpen: number;
  mouthWide: number;
  mouthRound: number;
  jawDrop: number;
  cheekLift: number;
  browLift: number;
}

interface VisemeBase {
  open: number;
  wide: number;
  round: number;
  jaw: number;
  cheek: number;
  brow: number;
}

// Fifteen established speech shapes. Four controlled strengths are prepared for
// each shape below, producing sixty deterministic states without generating a
// new face during conversation.
const VISEME_BASES: readonly VisemeBase[] = [
  { open: 0.00, wide: 0.42, round: 0.08, jaw: 0.00, cheek: 0.02, brow: 0.00 }, // silence
  { open: 0.01, wide: 0.38, round: 0.06, jaw: 0.03, cheek: 0.05, brow: 0.01 }, // M/B/P
  { open: 0.15, wide: 0.62, round: 0.05, jaw: 0.16, cheek: 0.16, brow: 0.03 }, // F/V
  { open: 0.26, wide: 0.54, round: 0.08, jaw: 0.25, cheek: 0.13, brow: 0.04 }, // TH
  { open: 0.34, wide: 0.56, round: 0.08, jaw: 0.32, cheek: 0.15, brow: 0.04 }, // T/D
  { open: 0.40, wide: 0.48, round: 0.12, jaw: 0.40, cheek: 0.12, brow: 0.05 }, // K/G
  { open: 0.29, wide: 0.40, round: 0.66, jaw: 0.27, cheek: 0.10, brow: 0.04 }, // CH/SH/J
  { open: 0.13, wide: 0.72, round: 0.03, jaw: 0.13, cheek: 0.22, brow: 0.03 }, // S/Z
  { open: 0.27, wide: 0.54, round: 0.08, jaw: 0.24, cheek: 0.14, brow: 0.03 }, // N/L
  { open: 0.34, wide: 0.43, round: 0.50, jaw: 0.31, cheek: 0.11, brow: 0.04 }, // R
  { open: 0.92, wide: 0.61, round: 0.08, jaw: 0.88, cheek: 0.27, brow: 0.13 }, // AA/AH
  { open: 0.60, wide: 0.76, round: 0.04, jaw: 0.56, cheek: 0.31, brow: 0.09 }, // E/AE
  { open: 0.32, wide: 0.82, round: 0.02, jaw: 0.28, cheek: 0.34, brow: 0.06 }, // I/EE
  { open: 0.67, wide: 0.40, round: 0.88, jaw: 0.63, cheek: 0.12, brow: 0.10 }, // O
  { open: 0.30, wide: 0.32, round: 0.96, jaw: 0.25, cheek: 0.08, brow: 0.05 }, // U/OO
] as const;

const STRENGTHS = [0.34, 0.56, 0.78, 1] as const;

export const LEXARA_PREPARED_FACE_POSES: readonly LexaraPreparedFacePose[] =
  LEXARA_VISEME_NAMES.flatMap((viseme, visemeIndex) =>
    STRENGTHS.map((strength, strengthIndex) => {
      const base = VISEME_BASES[visemeIndex];
      const strengthLevel = (strengthIndex + 1) as 1 | 2 | 3 | 4;
      return {
        index: visemeIndex * STRENGTHS.length + strengthIndex,
        visemeIndex,
        viseme,
        strengthLevel,
        strength,
        mouthOpen: base.open * strength,
        mouthWide: 0.5 + (base.wide - 0.5) * strength,
        mouthRound: base.round * strength,
        jawDrop: base.jaw * strength,
        cheekLift: base.cheek * strength,
        browLift: base.brow * strength,
      } satisfies LexaraPreparedFacePose;
    }),
  );

if (LEXARA_PREPARED_FACE_POSES.length !== 60) {
  throw new Error('LEXARA prepared facial library must contain exactly 60 states');
}

export function getLexaraPreparedFacePose(index: number): LexaraPreparedFacePose {
  const safeIndex = Number.isFinite(index)
    ? Math.max(0, Math.min(LEXARA_PREPARED_FACE_POSES.length - 1, Math.round(index)))
    : 0;
  return LEXARA_PREPARED_FACE_POSES[safeIndex];
}
