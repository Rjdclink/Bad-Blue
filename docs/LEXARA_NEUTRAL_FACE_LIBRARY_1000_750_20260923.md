# Lexara neutral face library — 1,000 states / 750 prepared sequences

## Non-regression boundary
The existing production lip system remains canonical. Audio playback remains authoritative. Facial rendering may observe playback features but may never delay, buffer, restart, cancel, or otherwise control voice.

## Library
- 1,000 deterministic neutral facial states.
- 20 articulation/viseme families.
- 10 articulation strengths.
- 5 neutral micro-motion phases.
- 750 prepared motion sequences.
- 15 sequence families x 10 strengths x 5 phases.

## Runtime contract
Speech/audio selects a compatible prepared sequence. The renderer interpolates locally. If visual work misses its deadline, it drops/falls back to the existing neutral portrait. Audio never waits.

## Source-extraction contract
Uploaded reference footage is source material for calibration, not a runtime dependency. Extraction must deduplicate near-identical frames and retain the highest-value neutral articulation, jaw, blink, brow, cheek and micro-head distinctions. The production library remains deterministic and precompiled.

## Finger contract
Finger drumming remains a separate low-priority ambient layer. It cannot participate in voice scheduling or facial speech authority.

## Acceptance
1. Existing 120-state lip behavior remains unchanged until the 1,000/750 library is explicitly wired behind a reversible feature flag.
2. Existing audio clock remains the only timing authority.
3. No network call is introduced into animation selection.
4. No database call is introduced into animation selection.
5. Missed animation frame => visual fallback, never delayed speech.
6. 60 FPS remains the target, not a prerequisite for audio.
