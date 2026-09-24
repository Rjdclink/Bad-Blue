/**
 * Additive video-assisted mouth appearance references.
 * Source: user-supplied 416x960, 124-frame, 24fps Lexara reference video.
 * These values are offline appearance observations only. They never read,
 * gate, start, stop, buffer, or otherwise own audio/voice playback.
 *
 * The existing 120 prepared viseme states remain authoritative for motion.
 * These 300 references augment rendering with lip fullness/pigment, oral depth,
 * restrained tooth separation, and tongue definition.
 */
export interface LexaraVideoAssistedMouthState {
  index: number;
  lipFullness: number;
  oralDepth: number;
  lipRgb: readonly [number, number, number];
  teethDefinition: number;
  tongueDefinition: number;
  cornerCleanup: number;
}

type Anchor = readonly [number, number, number, number, number, number];

// frame, lip-fullness, oral-depth, median lip R/G/B sampled from the supplied video.
const VIDEO_ANCHORS: readonly Anchor[] = [
  [0,1.015,0.701,80,52,38],[8,1.027,0.688,80,53,39],
  [16,1.054,0.669,81,54,41],[25,1.050,0.661,80,54,40],
  [33,1.031,0.672,79,54,40],[41,0.988,0.608,80,54,41],
  [49,0.985,0.600,81,55,41],[57,0.968,0.611,82,57,41],
  [66,0.953,0.529,84,57,43],[74,0.954,0.515,83,57,42],
  [82,0.972,0.539,82,56,41],[90,0.978,0.518,82,58,43],
  [98,0.995,0.462,82,58,44],[107,1.004,0.396,84,59,45],
  [115,0.982,0.380,85,60,47],[123,0.964,0.351,86,60,46],
] as const;

const mix = (a:number,b:number,t:number) => a + (b-a)*t;
function sampleAnchor(frame:number) {
  let hi=1;
  while (hi < VIDEO_ANCHORS.length && VIDEO_ANCHORS[hi][0] < frame) hi++;
  hi=Math.min(VIDEO_ANCHORS.length-1,hi);
  const lo=Math.max(0,hi-1);
  const a=VIDEO_ANCHORS[lo], b=VIDEO_ANCHORS[hi];
  const span=Math.max(1,b[0]-a[0]);
  const t=Math.max(0,Math.min(1,(frame-a[0])/span));
  return {
    lipFullness: mix(a[1],b[1],t),
    oralDepth: mix(a[2],b[2],t),
    lipRgb: [Math.round(mix(a[3],b[3],t)),Math.round(mix(a[4],b[4],t)),Math.round(mix(a[5],b[5],t))] as const,
  };
}

export const LEXARA_VIDEO_ASSISTED_MOUTH_STATES: readonly LexaraVideoAssistedMouthState[] =
  Array.from({length:300},(_,index)=>{
    const sourceFrame=(index/299)*123;
    const observed=sampleAnchor(sourceFrame);
    const phase=(index%20)/19;
    return {
      index,
      lipFullness: Math.max(0.94,Math.min(1.08,observed.lipFullness)),
      oralDepth: observed.oralDepth,
      lipRgb: observed.lipRgb,
      teethDefinition: 0.18 + phase*0.24,
      tongueDefinition: 0.16 + (1-phase)*0.22,
      cornerCleanup: 0.92,
    };
  });

if (LEXARA_VIDEO_ASSISTED_MOUTH_STATES.length !== 300) {
  throw new Error('LEXARA video-assisted mouth library must contain exactly 300 additive states');
}

export function getLexaraVideoAssistedMouthState(visemeIndex:number, blend:number): LexaraVideoAssistedMouthState {
  const v=Math.max(0,Math.min(14,Math.round(visemeIndex)));
  const variant=Math.max(0,Math.min(19,Math.round(Math.max(0,Math.min(1,blend))*19)));
  return LEXARA_VIDEO_ASSISTED_MOUTH_STATES[v*20+variant];
}
