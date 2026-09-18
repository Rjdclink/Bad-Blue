# LEXARA Cross-Device Voice & UX — Literal 50-Source Review
Date: 2026-09-18

## Scope

This review cross-references the remaining LEXARA live-conversation root issues against **exactly 50 actual implementation sources**. The focus is device/browser portability, natural interruption, transcription reliability, audio continuity, mobile ergonomics, and latency without reintroducing multiple voice identities.

## Root issues cross-referenced

### 1. Browser-native SpeechRecognition cannot be the universal authority
MDN marks SpeechRecognition, continuous mode, interim results, start/error behavior as limited-availability features (Sources 20–25). That means a browser-first design will necessarily behave differently across Android, iOS/iPadOS, macOS, Windows, Chrome, Safari, Edge, and Firefox-family browsers.

**Implementation:** standards-based microphone capture + MediaRecorder + server speech-to-text is now the canonical path. Browser SpeechRecognition remains only a fallback for clients that lack the standards path.

### 2. Media capture must negotiate the device instead of assuming one microphone profile
W3C/MDN document getUserMedia, recording, MIME negotiation, echo cancellation, noise suppression, gain control, and track settings (Sources 1–17). Echo cancellation is broadly available, while noise suppression and automatic gain control vary by browser/device.

**Implementation:** retain requested AEC/noise/gain constraints where available, use MediaRecorder format negotiation, and avoid making optional device processing a prerequisite.

### 3. A fixed VAD threshold is not portable across phones, tablets, headsets, laptops, and desktops
Different microphones, OS-level processing, gain, speaker leakage, and room noise produce different RMS floors. Sources 1, 9–17, 45–47 support device-aware audio processing and VAD/commit behavior.

**Implementation:** LEXARA now continuously estimates the ambient noise floor and derives a bounded adaptive VAD threshold rather than assuming a single hard-coded level. Barge-in requires sustained recent voice energy before cutting LEXARA off, reducing false interruption from clicks, speaker leakage, or momentary noise.

### 4. Full-duplex interruption must react to actual speech onset, not a button
The speech and realtime transcription sources expose partial/committed transcript patterns and VAD-driven turn commits (Sources 20–25, 45–47).

**Implementation:** microphone monitoring remains live while LEXARA speaks. Sustained human speech onset stops TTS automatically; finalized transcription advances the legal turn. The manual interruption control is not required.

### 5. Cross-device STT needs provider-local redundancy
Groq recommends Whisper Large v3 Turbo for strong price/performance, while ElevenLabs provides independent Scribe speech-to-text capability (Sources 48–50 and 45–47).

**Implementation:** Groq Whisper Turbo is the fast primary server transcription route. ElevenLabs Scribe v2 is an independent fallback. A failure, 429, timeout, or provider-specific outage remains local rather than disabling voice for the whole consultation.

### 6. Audio unlock and lifecycle must respect mobile browser policies
AudioContext resume/state behavior and autoplay restrictions require user activation and lifecycle awareness (Sources 18–19, 38–39). Page visibility APIs expose when a page moves to the background (Sources 26–27).

**Implementation:** the consent interstitial deliberately unlocks sound from the user gesture. Server voice capture pauses when the page is hidden, commits any active utterance, and resumes AudioContext/VAD when the user returns.

### 7. Mobile layout must use dynamic viewport and safe-area primitives
Sources 28–37 cover safe-area insets, dynamic viewport sizing, iPhone/WebKit media behavior, and current Safari media support.

**Implementation:** LEXARA uses dynamic viewport sizing and safe-area padding; the attorney-at-desk region remains persistent while the transcript itself scrolls.

### 8. Friendly UX requires large targets, responsive interaction, clear recovery, and a typing escape hatch
web.dev/WCAG guidance supports generous touch targets and responsive UI (Sources 40–42). LEXARA must never strand a user because voice is unavailable.

**Implementation:** 44–48px-class touch targets, mobile-friendly send keyboard hints, plain-language microphone/audio recovery, backend voice-readiness verification, and always-available typing remain part of the canonical experience.

### 9. One acoustic identity must remain authoritative
ElevenLabs latency guidance favors Flash/streaming approaches while the application requires one stable voice identity (Sources 43–44).

**Implementation:** ElevenLabs remains the sole speaking authority. LEXARA does not silently switch to an OS/browser voice. Speech failure degrades to text, not a different person.

## Implementation sequence

1. Make standards-based server speech capture canonical.
2. Add adaptive microphone/VAD behavior and sustained-speech barge-in confirmation.
3. Add provider-local STT redundancy (Groq → ElevenLabs).
4. Add voice-backend readiness verification before entering live mode.
5. Resume/pause capture correctly across page visibility and mobile audio lifecycle.
6. Preserve the existing single ElevenLabs voice authority.
7. Preserve the attorney-at-desk visual and mobile-safe layout.
8. Preserve text as a zero-friction fallback rather than blocking the consultation.
9. Build and production-verify after merge.

## Expected functional/performance effects

- More consistent behavior across modern Android, iPhone/iPad, macOS, and Windows browsers because the canonical capture path uses broadly supported media APIs instead of limited Web Speech support.
- Faster and more reliable failure recovery because STT failures are provider-local and have an independent fallback.
- Fewer false barge-ins because interruption requires sustained recent voice energy and uses adaptive noise calibration.
- Better mobile continuity after app/tab switching because voice capture follows page/audio lifecycle state.
- Better first-run UX because the setup page verifies device capture, sound unlock, and backend voice configuration before entering LEXARA.
- The system still degrades safely to typing on genuinely unsupported/very old browsers rather than falsely claiming voice support.

## Sources — exactly 50

1. W3C — Media Capture and Streams: https://www.w3.org/TR/mediacapture-streams/
2. W3C — MediaStream Recording: https://www.w3.org/TR/mediastream-recording/
3. W3C — WebRTC: Real-Time Communication in Browsers: https://www.w3.org/TR/webrtc/
4. MDN — MediaDevices.getUserMedia(): https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
5. MDN — MediaRecorder: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder
6. MDN — MediaRecorder constructor: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/MediaRecorder
7. MDN — MediaRecorder.isTypeSupported(): https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static
8. MDN — MediaRecorder.start(): https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/start
9. MDN — MediaTrackConstraints.echoCancellation: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/echoCancellation
10. MDN — MediaTrackConstraints.noiseSuppression: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/noiseSuppression
11. MDN — MediaTrackConstraints.autoGainControl: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/autoGainControl
12. MDN — MediaTrackSupportedConstraints.echoCancellation: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSupportedConstraints/echoCancellation
13. MDN — MediaTrackSupportedConstraints.noiseSuppression: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSupportedConstraints/noiseSuppression
14. MDN — MediaTrackSupportedConstraints.autoGainControl: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSupportedConstraints/autoGainControl
15. MDN — MediaTrackSettings.echoCancellation: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSettings/echoCancellation
16. MDN — MediaTrackSettings.noiseSuppression: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSettings/noiseSuppression
17. MDN — MediaTrackSettings.autoGainControl: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSettings/autoGainControl
18. MDN — AudioContext.resume(): https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume
19. MDN — BaseAudioContext.state: https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/state
20. MDN — SpeechRecognition: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
21. MDN — SpeechRecognition.continuous: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/continuous
22. MDN — SpeechRecognition.interimResults: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/interimResults
23. MDN — SpeechRecognition.start(): https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/start
24. MDN — SpeechRecognition error event: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/error_event
25. MDN — SpeechRecognitionErrorEvent.error: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionErrorEvent/error
26. MDN — Page Visibility API: https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
27. MDN — Document.visibilityState: https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilityState
28. MDN — CSS env(): https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env
29. MDN — CSS environment variables: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Environment_variables
30. MDN — CSS length / dynamic viewport units: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/length
31. MDN — touch-action: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action
32. MDN — enterkeyhint: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/enterkeyhint
33. WebKit — Designing Websites for iPhone X / safe areas: https://webkit.org/blog/7929/designing-websites-for-iphone-x/
34. WebKit — MediaRecorder API: https://webkit.org/blog/11353/mediarecorder-api/
35. WebKit — New WebKit Features in Safari 14.1: https://webkit.org/blog/11648/new-webkit-features-in-safari-14-1/
36. WebKit — WebKit Features in Safari 17.0: https://webkit.org/blog/14445/webkit-features-in-safari-17-0/
37. WebKit — WebKit Features for Safari 26.4: https://webkit.org/blog/17862/webkit-features-for-safari-26-4/
38. Chrome for Developers — Web Audio, Autoplay Policy and Games: https://developer.chrome.com/blog/web-audio-autoplay
39. Chrome for Developers — Autoplay policy in Chrome: https://developer.chrome.com/blog/autoplay
40. web.dev — Accessible tap targets: https://web.dev/articles/accessible-tap-targets
41. web.dev — Interaction to Next Paint: https://web.dev/articles/inp
42. W3C/WAI — WCAG 2.2 Target Size (Minimum): https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
43. ElevenLabs — Latency optimization: https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization
44. ElevenLabs — Realtime TTS WebSocket: https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tts
45. ElevenLabs — Client-side realtime Speech to Text: https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming
46. ElevenLabs — Realtime transcripts and VAD commit strategies: https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/transcripts-and-commit-strategies
47. ElevenLabs — Realtime Speech to Text API: https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime
48. ElevenLabs — Create Single Use Token: https://elevenlabs.io/docs/api-reference/tokens/create
49. Groq — Speech to Text: https://console.groq.com/docs/speech-to-text
50. Groq — Whisper Large v3 Turbo: https://console.groq.com/docs/model/whisper-large-v3-turbo
