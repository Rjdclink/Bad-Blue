# LEXARA Live Attorney - 100-Source Implementation Blueprint

Date: 2026-09-20

## Scope

This review is the implementation blueprint for making the existing LEXARA attorney-at-desk portrait feel continuously alive while preserving the already-working conversation, text, TTS, interruption, and mobile paths.

The production constraint verified before implementation is that the current Railway service does not expose a dedicated GPU allocation in its service configuration. Heavy diffusion/video models are therefore retained as optional enhancement adapters rather than placed in the live response critical path. The first production layer is browser/compositor-driven, uses the existing portrait, and consumes already-rendering audio timing without blocking speech.

## Adopted implementation invariants

- Conversation plane remains authoritative. LLM text, TTS generation, audio playback, STT, and barge-in do not await animation.
- Presence plane is read-only and fail-open. The portrait observes speech state and playback clocks; animation failure cannot stop text or voice.
- Audio is the master clock. Realtime PCM animation reads the existing AudioWorklet rendered-frame clock. HTTP TTS reads the existing media element currentTime. No animation timer becomes speech authority.
- True realtime energy where already available. The existing realtime playback worklet calculates a tiny RMS level while it is already copying PCM samples. No second audio graph or network call is inserted.
- No stale-frame queue. Browser motion uses requestAnimationFrame and samples current clock state on every frame. Missed visual frames are skipped naturally.
- Compositor-first motion. Production motion is transform-only layered retargeting of the established 239x239 attorney image, with soft CSS masks for torso/head/mouth regions and no per-frame React state.
- Persistent life. Breathing and micro head/torso motion continue while idle/listening/thinking; speech energy modulates mouth and conversational nod movement.
- Accessibility and device safety. prefers-reduced-motion disables nonessential motion. The animation layer can be disabled entirely with VITE_LEXARA_LIVE_AVATAR_ENABLED=0.
- Heavy engines stay optional. LivePortrait/FasterLivePortrait, MuseTalk, EchoMimic, OmniAvatar, HunyuanVideo-Avatar, GoHD, Hallo2, Real3D-Portrait, LatentSync, Wav2Lip and related systems remain candidates for a dedicated GPU enhancement worker when infrastructure supports it. They may improve visual fidelity but never become prerequisites for speech.
- Regression gate. Build verification requires the live-avatar feature flag, read-only clocks, requestAnimationFrame path, source blueprint, and an explicit absence of fetch/network calls from the avatar component.

## Sources - exactly 100

1. MDN - AudioWorklet - https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet
2. MDN - Web Audio API - https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
3. MDN - BaseAudioContext.currentTime - https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/currentTime
4. MDN - AudioContext.baseLatency - https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/baseLatency
5. MDN - AudioContext.outputLatency - https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency
6. MDN - AnalyserNode - https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode
7. MDN - requestAnimationFrame - https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
8. MDN - requestVideoFrameCallback - https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback
9. MDN - WebCodecs API - https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API
10. MDN - Using WebCodecs - https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Using_the_WebCodecs_API
11. MDN - VideoFrame - https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame
12. MDN - OffscreenCanvas - https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
13. MDN - Web Workers API - https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API
14. MDN - Using Web Workers - https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers
15. MDN - mask-image - https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/mask-image
16. MDN - CSS mask properties - https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Masking/Mask_properties
17. MDN - transform - https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/transform
18. MDN - transform-origin - https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/transform-origin
19. MDN - translate3d - https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/transform-function/translate3d
20. MDN - scale - https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/transform-function/scale
21. MDN - will-change - https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/will-change
22. MDN - Animation performance and frame rate - https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Animation_performance_and_frame_rate
23. MDN - CSS performance optimization - https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Performance/CSS
24. MDN - Using CSS containment - https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Using
25. MDN - contain - https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/contain
26. MDN - content-visibility - https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility
27. MDN - Page Visibility API - https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
28. MDN - prefers-reduced-motion - https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion
29. MDN - performance.now - https://developer.mozilla.org/en-US/docs/Web/API/Performance/now
30. MDN - User Timing - https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/User_timing
31. MDN - PerformanceObserver - https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver
32. MDN - PerformanceLongTaskTiming - https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming
33. MDN - Scheduler.yield - https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield
34. MDN - requestIdleCallback - https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback
35. MDN - navigator.hardwareConcurrency - https://developer.mozilla.org/en-US/docs/Web/API/Navigator/hardwareConcurrency
36. MDN - WebGL best practices - https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
37. MDN - Intersection Observer API - https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API
38. MDN - Web Animations API - https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API
39. Google MediaPipe - Face Landmarker for Web - https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js
40. Google MediaPipe - Face Landmarker Blendshapes - https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/drawing_styles/face_landmarker/Blendshapes
41. W3C - Web Audio API - https://www.w3.org/TR/webaudio/
42. W3C - WebCodecs - https://www.w3.org/TR/webcodecs/
43. W3C - WebRTC Statistics API - https://www.w3.org/TR/webrtc-stats/
44. IETF RFC 3550 - RTP - https://www.rfc-editor.org/info/rfc3550/
45. IETF RFC 6051 - Rapid Synchronisation of RTP Flows - https://www.rfc-editor.org/info/rfc6051/
46. IETF RFC 8834 - Media Transport and RTP in WebRTC - https://www.rfc-editor.org/rfc/rfc8834.html
47. IETF RFC 8445 - ICE - https://www.rfc-editor.org/rfc/rfc8445.html
48. ITU-T J.248 - lip sync - https://www.itu.int/rec/T-REC-J.248
49. web.dev - Off-main-thread with Web Workers - https://web.dev/articles/off-main-thread
50. web.dev - Optimize long tasks - https://web.dev/articles/optimize-long-tasks
51. web.dev - Script evaluation and long tasks - https://web.dev/articles/script-evaluation-and-long-tasks
52. web.dev - Optimize Interaction to Next Paint - https://web.dev/articles/optimize-inp
53. web.dev - Optimize input delay - https://web.dev/articles/optimize-input-delay
54. web.dev - Animation smoothness - https://web.dev/articles/smoothness
55. web.dev - Core Web Vitals optimization - https://web.dev/articles/top-cwv
56. ONNX Runtime - I/O Binding - https://onnxruntime.ai/docs/performance/tune-performance/iobinding.html
57. ONNX Runtime - Device tensors - https://onnxruntime.ai/docs/performance/device-tensor.html
58. ONNX Runtime - Web performance diagnosis - https://onnxruntime.ai/docs/tutorials/web/performance-diagnosis.html
59. ONNX Runtime - WebGPU execution provider - https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html
60. ONNX Runtime - CUDA execution provider - https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html
61. ONNX Runtime - TensorRT execution provider - https://onnxruntime.ai/docs/execution-providers/TensorRT-ExecutionProvider.html
62. NVIDIA TensorRT - Optimizing performance - https://docs.nvidia.com/deeplearning/tensorrt/latest/performance/optimization.html
63. NVIDIA TensorRT - Best practices - https://docs.nvidia.com/deeplearning/tensorrt/latest/performance/best-practices.html
64. NVIDIA TensorRT - Performance benchmarking - https://docs.nvidia.com/deeplearning/tensorrt/latest/performance/benchmarking.html
65. NVIDIA CUDA - Asynchronous execution - https://docs.nvidia.com/cuda/cuda-programming-guide/02-basics/asynchronous-execution.html
66. NVIDIA CUDA - CUDA Graphs - https://docs.nvidia.com/cuda/cuda-programming-guide/04-special-topics/cuda-graphs.html
67. NVIDIA - Video Codec SDK - https://developer.nvidia.com/video-codec-sdk
68. PyTorch - torch.compile - https://docs.pytorch.org/docs/stable/generated/torch.compile
69. PyTorch - torch.compile tutorial - https://docs.pytorch.org/tutorials/intermediate/torch_compile_full_example.html
70. PyTorch - inference_mode - https://docs.pytorch.org/docs/stable/generated/torch.autograd.grad_mode.inference_mode.html
71. OpenVINO - Performance hints - https://docs.openvino.ai/2026/openvino-workflow/running-inference/optimize-inference/high-level-performance-hints.html
72. OpenVINO - Model caching overview - https://docs.openvino.ai/2026/openvino-workflow/running-inference/optimize-inference/optimizing-latency/model-caching-overview.html
73. OpenVINO Model Server - Model cache - https://docs.openvino.ai/nightly/model-server/ovms_docs_model_cache.html
74. GStreamer - queue - https://gstreamer.freedesktop.org/documentation/coreelements/queue.html
75. GStreamer - appsink - https://gstreamer.freedesktop.org/documentation/app/appsink.html
76. GStreamer - rtpjitterbuffer - https://gstreamer.freedesktop.org/documentation/rtpmanager/rtpjitterbuffer.html
77. GStreamer - Latency design - https://gstreamer.freedesktop.org/documentation/additional/design/latency.html
78. GStreamer - Pipeline manipulation - https://gstreamer.freedesktop.org/documentation/application-development/advanced/pipeline-manipulation.html
79. GStreamer - WebRTC - https://gstreamer.freedesktop.org/documentation/webrtc/
80. FFmpeg - documentation - https://ffmpeg.org/ffmpeg.html
81. KwaiVGI - LivePortrait - https://github.com/KwaiVGI/LivePortrait
82. FasterLivePortrait - https://github.com/warmshao/FasterLivePortrait
83. Tencent Music - MuseTalk - https://github.com/TMElyralab/MuseTalk
84. Ant Group - EchoMimic - https://github.com/antgroup/echomimic
85. Ant Group - EchoMimicV2 - https://github.com/antgroup/echomimic_v2
86. Ant Group - EchoMimicV3 - https://github.com/antgroup/echomimic_v3
87. OmniAvatar - https://github.com/Omni-Avatar/OmniAvatar
88. Tencent - HunyuanVideo Avatar - https://github.com/Tencent-Hunyuan/HunyuanVideo
89. GoHD - https://github.com/Jia1018/GoHD
90. Fudan - Hallo2 - https://github.com/fudan-generative-vision/hallo2
91. Real3D-Portrait - https://github.com/yerfor/Real3DPortrait
92. ByteDance - LatentSync - https://github.com/bytedance/LatentSync
93. Wav2Lip - https://github.com/Rudrabha/Wav2Lip
94. OpenTalker - SadTalker - https://github.com/OpenTalker/SadTalker
95. Adobe Research - MakeItTalk - https://github.com/adobe-research/MakeItTalk
96. First Order Motion Model - https://github.com/AliaksandrSiarohin/first-order-model
97. Thin-Plate Spline Motion Model - https://github.com/yoyo-nb/Thin-Plate-Spline-Motion-Model
98. Practical-RIFE - https://github.com/hzwer/Practical-RIFE
99. Google Research - FILM - https://github.com/google-research/frame-interpolation
100. Rhubarb Lip Sync - https://github.com/DanielSWolf/rhubarb-lip-sync

## Implementation decision

The implementation uses the smallest production-safe subset of this blueprint now: the existing AudioWorklet clock and PCM samples, the existing HTMLMediaElement playback clock, requestAnimationFrame, compositor-friendly transforms, soft CSS masks, containment, reduced-motion handling, a rollback flag, and deterministic fallback motion. The remaining model/runtime sources define the bounded upgrade path for a future dedicated GPU animation worker without changing the conversation-plane contract.
