# LEXARA Embodied Conversation — 50-Source Implementation Blueprint

Date: 2026-09-20

## Intent

LEXARA must behave as a continuously embodied conversational agent, not a photograph with decorative movement. The target experience is a real, fluid person-to-person conversation: speech, facial behavior, gaze, blinking, head/neck motion, posture, breathing, shoulder/torso motion, visible hand/arm behavior, listening behavior, thinking behavior, turn-taking and interruption behavior must form one temporally coordinated performance.

This blueprint is the second-pass implementation review. It cross-references the current LEXARA voice/browser architecture, the existing LEXARA Brain behavioral interfaces, the 4Ji cognitive taxonomy/state concepts, and the real deployment constraint that the current LegalWhat Railway service has no dedicated GPU inference runtime.

## Current-repo truth adopted

- The existing realtime Deepgram/AudioWorklet speech path remains authoritative for speech latency, interruption and rendered-audio timing.
- The avatar is a read-only subscriber. Text, legal reasoning, TTS, microphone capture and barge-in never await visual work.
- LEXARA already exposes conversational phase plus emotion/gaze hints that can drive a behavioral state engine without adding an LLM round-trip.
- 4Ji provides useful perception/reasoning/relational/style taxonomy, but many individual layer processors are still pass-through. Its taxonomy is adapted into embodiment concepts rather than inserted into the live voice hot path.
- Cain supplies useful temporal/spatial/causal/probabilistic state-space ideas, including position, momentum, entropy and coherence, but its crypto-domain evaluators and camouflage/threat machinery are not embodiment logic and are not reused directly.
- The failed first avatar attempt is explicitly retired: sub-pixel CSS region scaling is not accepted as a realization of humanlike embodiment.

## Production invariants

1. Conversation-plane latency is unchanged by the avatar.
2. Rendered audio is the master clock.
3. Visual work is bounded, stale visual work is discarded, and no visual queue may delay speech.
4. A failure in lips, face, body, GPU inference, transport or browser rendering fails locally and leaves LEXARA voice/text alive.
5. Listening, thinking, speaking and idle states remain continuous; no sentence-to-animation-clip authority exists.
6. Gaze, blinking, facial behavior, head motion, respiration, posture and gesture are coordinated by one behavioral planner.
7. Reduced-motion preferences reduce decorative motion but do not remove communicative lip movement.
8. Visible movement must exceed the previous imperceptible sub-pixel shimmer while remaining anatomically bounded.
9. Runtime telemetry must prove that avatar frames and speech-linked motion actually occurred.
10. Neural photoreal rendering is an optional isolated enhancement plane until a dedicated external GPU runtime is connected; it is never allowed to become a prerequisite for LEXARA speech.

## Adopted implementation sequence

### Now, inside the existing LegalWhat deployment
- Replace CSS-mask shimmer with a stateful embodied behavior planner and a real per-frame canvas compositor.
- Use the already-rendered realtime PCM stream to derive low-cost speech energy, spectral-change and zero-crossing cues for mouth shape.
- Add non-periodic blinking, gaze shifts, thinking gaze aversion, listener backchannel nods, respiration, head/torso movement and bounded hand/forearm movement.
- Use One-Euro-style smoothing for responsive, low-jitter behavioral trajectories.
- Preserve the original portrait as the fail-open base layer.
- Cap rendering work and device-pixel ratio so visuals cannot monopolize the browser UI/audio thread.
- Add explicit avatar runtime telemetry and regression gates.

### External GPU enhancement contract
When a dedicated GPU endpoint is available, the behavior planner remains the authority and specialist renderers become swappable capabilities:
- SoulX-FlashHead / Ditto / FasterLivePortrait: realtime portrait/head realization.
- MuseTalk / ARTalk: lip, facial, blink and head-pose refinement.
- DiffSHEG / gesture systems: speech-linked face/body gesture realization.
- MediaPipe/FACS: facial-control representation and validation.
- MODNet/SAM2/Depth Anything: one-time canonical portrait preparation and occlusion geometry.
- TensorRT/CUDA/ONNX/Triton: persistent prewarmed inference.
- NVENC + WebRTC/GStreamer: low-latency encoded transport with stale-frame dropping.
- requestVideoFrameCallback / WebCodecs: actual browser presentation-time synchronization.

## Sources — exactly 50

1. SoulX-FlashHead — https://github.com/Soul-AILab/SoulX-FlashHead
2. Ditto TalkingHead — https://github.com/antgroup/ditto-talkinghead
3. LivePortrait — https://github.com/KwaiVGI/LivePortrait
4. FasterLivePortrait — https://github.com/warmshao/FasterLivePortrait
5. MuseTalk — https://github.com/TMElyralab/MuseTalk
6. ARTalk — https://github.com/xg-chu/ARTalk
7. EchoMimic — https://github.com/antgroup/echomimic
8. EchoMimicV2 — https://github.com/antgroup/echomimic_v2
9. OmniAvatar — https://github.com/Omni-Avatar/OmniAvatar
10. Real3D-Portrait — https://github.com/yerfor/Real3DPortrait
11. DiffSHEG — https://github.com/JeremyCJM/DiffSHEG
12. MaAI — https://github.com/MaAI-Kyoto/MaAI
13. Voice Activity Projection — https://github.com/ErikEkstedt/VoiceActivityProjection
14. BEAT — https://github.com/PantoMatrix/BEAT
15. PantoMatrix / EMAGE — https://github.com/PantoMatrix/PantoMatrix
16. Virtual Human Project — https://github.com/GeoffreyGorisse/VHProject
17. USC Virtual Human Toolkit — https://github.com/USC-ICT/vhtoolkit
18. Google AgentHands — https://research.google/blog/agenthands-a-new-approach-to-embodied-reasoning/
19. SARAH: Spatially Aware Real-time Conversational Motion — https://arxiv.org/abs/2509.07042
20. Conversational Gesture Model — https://onlinelibrary.wiley.com/doi/10.1111/cgf.70092
21. MediaPipe Face Landmarker for Web — https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js
22. MediaPipe Face Blendshapes — https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/drawing_styles/face_landmarker/Blendshapes
23. MODNet — https://github.com/ZHKKKe/MODNet
24. SAM 2 — https://github.com/facebookresearch/sam2
25. Depth Anything V2 — https://github.com/DepthAnything/Depth-Anything-V2
26. One Euro Filter — https://github.com/casiez/OneEuroFilter
27. ONNX Runtime WebGPU — https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html
28. ONNX Runtime I/O Binding — https://onnxruntime.ai/docs/performance/tune-performance/iobinding.html
29. NVIDIA TensorRT Optimization — https://docs.nvidia.com/deeplearning/tensorrt/latest/performance/optimization.html
30. NVIDIA TensorRT Best Practices — https://docs.nvidia.com/deeplearning/tensorrt/latest/performance/best-practices.html
31. NVIDIA CUDA Asynchronous Execution — https://docs.nvidia.com/cuda/cuda-programming-guide/02-basics/asynchronous-execution.html
32. NVIDIA CUDA Graphs — https://docs.nvidia.com/cuda/cuda-programming-guide/04-special-topics/cuda-graphs.html
33. NVIDIA Triton Model Warmup — https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/model_configuration.html
34. NVIDIA Triton Decoupled Models — https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/decoupled_models.html
35. NVIDIA Video Codec SDK — https://developer.nvidia.com/video-codec-sdk
36. GStreamer queue — https://gstreamer.freedesktop.org/documentation/coreelements/queue.html
37. GStreamer WebRTC — https://gstreamer.freedesktop.org/documentation/webrtc/
38. GStreamer Latency Design — https://gstreamer.freedesktop.org/documentation/additional/design/latency.html
39. MDN AudioWorklet — https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet
40. MDN WebCodecs — https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API
41. MDN OffscreenCanvas — https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
42. MDN requestVideoFrameCallback — https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback
43. MDN WebRTC — https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API
44. MDN WebGPU — https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
45. IETF RFC 3550 RTP — https://www.rfc-editor.org/rfc/rfc3550
46. IETF RFC 8834 WebRTC Media Transport — https://www.rfc-editor.org/rfc/rfc8834
47. SyncNet — https://github.com/joonson/syncnet_python
48. Netflix VMAF — https://github.com/Netflix/vmaf
49. RAFT Optical Flow — https://github.com/princeton-vl/RAFT
50. Railway Hosted AI Inference Guide — https://docs.railway.com/guides/ai-inference

## Acceptance criteria

- The canonical attorney visibly breathes/blinks/moves while present, visibly changes behavior while listening/thinking/speaking, and visibly articulates during speech.
- Barge-in immediately invalidates superseded speech-linked motion.
- No avatar component can call or await legal reasoning, TTS generation or speech playback.
- Turning the avatar off yields the same conversation and voice path.
- Build verification confirms the behavior planner, canvas renderer, audio-derived mouth cues, rollback flag, runtime telemetry and literal 50-source blueprint.
- Production logs distinguish “voice played” from “avatar renderer ready” and “speech-linked avatar motion actually started.”
