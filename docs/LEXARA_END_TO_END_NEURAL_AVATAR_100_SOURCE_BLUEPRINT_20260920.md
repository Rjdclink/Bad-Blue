# LEXARA End-to-End Neural Avatar — 100-Source Implementation Blueprint

Date: 2026-09-20

## Literal target

The implementation is complete only when the live chain is real:

**LEXARA conversation/audio authority → QuantiComp generation plan → actual neural inference → generated face pixels → browser compositor → measured production telemetry.**

A scheduler, adapter, canvas deformation, or “motion started” counter is not accepted as realization by itself.

## Blueprint cross-check applied during implementation

The 100-source scan was repeatedly cross-checked against the current repository while implementing the chain. The implementation adopts these recurring principles from the sources:

- keep audio/TTS as timing authority and never await visual generation;
- move heavy client inference to a dedicated worker;
- use browser WebGPU when available instead of pretending server CPU is GPU;
- cache large immutable models and extract source identity features once;
- maintain one pending visual request so stale frames are replaced rather than queued;
- use QuantiComp generations as the supersession/fencing authority;
- keep optional Ray/TensorRT/Triton as a real accelerator route when such hardware exists;
- validate the distinction between “renderer attempted motion” and “neural pixels were actually produced”;
- fail locally to the unchanged attorney portrait when neural compute is unavailable;
- never silently relabel procedural deformation as neural animation.

## Current production constraint

The existing Railway application does not itself supply an NVIDIA GPU. Therefore the active no-new-provider route uses the user's compatible browser GPU through WebGPU and ONNX Runtime Web. QuantiComp remains the planner/fencing authority. The previously built Ray adapter remains available for a future external accelerator, but absence of Ray does not prevent the client-WebGPU route from producing neural frames.

## Active neural path

1. QuantiComp receives an avatar turn plan request and advances the visual generation.
2. A compatible browser receives `client_webgpu`.
3. A dedicated worker loads ONNX Runtime WebGPU.
4. The canonical attorney portrait is cropped once and processed by the FasterLivePortrait appearance feature extractor.
5. LP-Distilled0.1 consumes the identity feature volume plus current pose/expression controls and generates new 256×256 RGB pixels.
6. Only the newest requested state is retained while inference is busy.
7. The generated ImageBitmap is transferred back to the UI and composited over the canonical attorney face region.
8. Production telemetry reports `avatar-neural-ready` and, separately, `avatar-neural-frame` only after an actual neural frame arrives.
9. When a turn changes/interruption occurs, QuantiComp advances the generation; stale visual work is discarded.
10. If WebGPU/model loading fails, the base attorney photo remains visible and voice/text continue unchanged.

## Quality boundary

LP-Distilled0.1 is a browser-oriented research model, not a claim of final studio-grade photorealism. It is used here because it creates a genuine end-to-end neural path on available client GPU hardware without purchasing a separate GPU service. The architecture preserves the higher-fidelity SoulX/Ditto/MuseTalk/Ray path as an upgrade rather than blocking live conversation.

## Sources — exactly 100

1. ONNX Runtime WebGPU tutorial — https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html
2. ONNX Runtime WebGPU EP — https://onnxruntime.ai/docs/execution-providers/WebGPU-ExecutionProvider.html
3. ONNX Runtime Web quick start — https://onnxruntime.ai/docs/get-started/with-javascript/web.html
4. ONNX Runtime Web performance — https://onnxruntime.ai/docs/tutorials/web/performance-diagnosis.html
5. ONNX Runtime I/O Binding — https://onnxruntime.ai/docs/performance/tune-performance/iobinding.html
6. ONNX Runtime device tensors — https://onnxruntime.ai/docs/performance/device-tensor.html
7. ONNX Runtime Web API — https://onnxruntime.ai/docs/api/js/
8. WebGPU specification — https://www.w3.org/TR/webgpu/
9. WGSL specification — https://www.w3.org/TR/WGSL/
10. MDN WebGPU API — https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
11. MDN Worker — https://developer.mozilla.org/en-US/docs/Web/API/Worker
12. MDN DedicatedWorkerGlobalScope — https://developer.mozilla.org/en-US/docs/Web/API/DedicatedWorkerGlobalScope
13. MDN OffscreenCanvas — https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
14. MDN createImageBitmap — https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap
15. MDN ImageBitmap — https://developer.mozilla.org/en-US/docs/Web/API/ImageBitmap
16. MDN CacheStorage — https://developer.mozilla.org/en-US/docs/Web/API/CacheStorage
17. MDN requestAnimationFrame — https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
18. MDN requestVideoFrameCallback — https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback
19. MDN WebCodecs — https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API
20. MDN VideoFrame — https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame
21. MDN AudioWorklet — https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet
22. MDN Web Audio API — https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
23. MDN WebRTC API — https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API
24. Chrome WebGPU overview — https://developer.chrome.com/docs/web-platform/webgpu
25. LP-Distilled0.1 ONNX — https://huggingface.co/slperez/LP-Distilled0.1-ONNX
26. LP Distillation Demo — https://huggingface.co/spaces/slperez/flp-distillation-demo
27. FasterLivePortrait ONNX models — https://huggingface.co/warmshao/FasterLivePortrait/tree/main/liveportrait_onnx
28. LivePortrait — https://github.com/KwaiVGI/LivePortrait
29. FasterLivePortrait — https://github.com/warmshao/FasterLivePortrait
30. Ray scheduling — https://docs.ray.io/en/latest/ray-core/scheduling/index.html
31. Ray resources — https://docs.ray.io/en/latest/ray-core/scheduling/resources.html
32. Ray accelerators — https://docs.ray.io/en/latest/ray-core/scheduling/accelerators.html
33. Ray placement groups — https://docs.ray.io/en/latest/ray-core/scheduling/placement-group.html
34. Ray actors — https://docs.ray.io/en/latest/ray-core/actors.html
35. Ray async actors — https://docs.ray.io/en/latest/ray-core/actors/async_api.html
36. Ray task fault tolerance — https://docs.ray.io/en/latest/ray-core/fault_tolerance/tasks.html
37. Ray actor fault tolerance — https://docs.ray.io/en/latest/ray-core/fault_tolerance/actors.html
38. Ray cancellation — https://docs.ray.io/en/latest/ray-core/api/doc/ray.cancel.html
39. Ray wait — https://docs.ray.io/en/latest/ray-core/api/doc/ray.wait.html
40. Ray pending task backpressure — https://docs.ray.io/en/latest/ray-core/patterns/limit-pending-tasks.html
41. Ray running task limits — https://docs.ray.io/en/latest/ray-core/patterns/limit-running-tasks.html
42. Ray object serialization — https://docs.ray.io/en/latest/ray-core/objects/serialization.html
43. Ray object spilling — https://docs.ray.io/en/latest/ray-core/objects/object-spilling.html
44. Ray Serve — https://docs.ray.io/en/latest/serve/index.html
45. Ray Serve batching — https://docs.ray.io/en/latest/serve/advanced-guides/dyn-req-batch.html
46. Ray Serve autoscaling — https://docs.ray.io/en/latest/serve/autoscaling-guide.html
47. Ray Serve model multiplexing — https://docs.ray.io/en/latest/serve/model-multiplexing.html
48. Ray Serve replica scheduling — https://docs.ray.io/en/latest/serve/advanced-guides/replica-scheduling.html
49. Ray Serve performance — https://docs.ray.io/en/latest/serve/advanced-guides/performance.html
50. Triton model configuration — https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/model_configuration.html
51. Triton batchers — https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/batcher.html
52. Triton rate limiter — https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/rate_limiter.html
53. Triton decoupled models — https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/decoupled_models.html
54. Triton metrics — https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/metrics.html
55. Triton optimization — https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/optimization.html
56. Triton response cache — https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/response_cache.html
57. Triton shared memory — https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/protocol/extension_shared_memory.html
58. TensorRT optimization — https://docs.nvidia.com/deeplearning/tensorrt/latest/performance/optimization.html
59. TensorRT best practices — https://docs.nvidia.com/deeplearning/tensorrt/latest/performance/best-practices.html
60. CUDA asynchronous execution — https://docs.nvidia.com/cuda/cuda-programming-guide/02-basics/asynchronous-execution.html
61. CUDA Graphs — https://docs.nvidia.com/cuda/cuda-programming-guide/04-special-topics/cuda-graphs.html
62. NVIDIA Video Codec SDK — https://developer.nvidia.com/video-codec-sdk
63. SoulX-FlashHead — https://github.com/Soul-AILab/SoulX-FlashHead
64. Ditto TalkingHead — https://github.com/antgroup/ditto-talkinghead
65. MuseTalk — https://github.com/TMElyralab/MuseTalk
66. ARTalk — https://github.com/xg-chu/ARTalk
67. EchoMimic — https://github.com/antgroup/echomimic
68. EchoMimicV2 — https://github.com/antgroup/echomimic_v2
69. OmniAvatar — https://github.com/Omni-Avatar/OmniAvatar
70. Real3D-Portrait — https://github.com/yerfor/Real3DPortrait
71. SadTalker — https://github.com/OpenTalker/SadTalker
72. Wav2Lip — https://github.com/Rudrabha/Wav2Lip
73. LatentSync — https://github.com/bytedance/LatentSync
74. Hallo2 — https://github.com/fudan-generative-vision/hallo2
75. HunyuanVideo Avatar — https://github.com/Tencent-Hunyuan/HunyuanVideo-Avatar
76. First Order Motion Model — https://github.com/AliaksandrSiarohin/first-order-model
77. Thin Plate Spline Motion Model — https://github.com/yoyo-nb/Thin-Plate-Spline-Motion-Model
78. RIFE — https://github.com/hzwer/ECCV2022-RIFE
79. FILM frame interpolation — https://github.com/google-research/frame-interpolation
80. MediaPipe Face Landmarker Web — https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js
81. MediaPipe Face Blendshapes — https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker
82. MODNet — https://github.com/ZHKKKe/MODNet
83. SAM 2 — https://github.com/facebookresearch/sam2
84. Depth Anything V2 — https://github.com/DepthAnything/Depth-Anything-V2
85. DiffSHEG — https://github.com/JeremyCJM/DiffSHEG
86. BEAT — https://github.com/PantoMatrix/BEAT
87. MaAI — https://github.com/MaAI-Kyoto/MaAI
88. Voice Activity Projection — https://github.com/ErikEkstedt/VoiceActivityProjection
89. One Euro Filter — https://github.com/casiez/OneEuroFilter
90. SyncNet — https://github.com/joonson/syncnet_python
91. Netflix VMAF — https://github.com/Netflix/vmaf
92. RAFT optical flow — https://github.com/princeton-vl/RAFT
93. GStreamer queue — https://gstreamer.freedesktop.org/documentation/coreelements/queue.html
94. GStreamer appsrc — https://gstreamer.freedesktop.org/documentation/app/appsrc.html
95. GStreamer appsink — https://gstreamer.freedesktop.org/documentation/app/appsink.html
96. GStreamer WebRTC — https://gstreamer.freedesktop.org/documentation/webrtc/
97. GStreamer RTP jitterbuffer — https://gstreamer.freedesktop.org/documentation/rtpmanager/rtpjitterbuffer.html
98. RFC 3550 RTP — https://www.rfc-editor.org/rfc/rfc3550
99. RFC 6051 rapid RTP sync — https://www.rfc-editor.org/rfc/rfc6051
100. RFC 8834 WebRTC media transport — https://www.rfc-editor.org/rfc/rfc8834

## Implementation contract

- A live route MUST call QuantiComp for each new visual generation.
- Client WebGPU MUST be selected only when the browser reports Worker + WebGPU + OffscreenCanvas + ImageBitmap capability.
- Neural inference MUST run off the UI/audio thread.
- The worker MUST load an actual ONNX portrait model and appearance extractor.
- The worker MUST use latest-wins backpressure; no unbounded frame queue is permitted.
- The worker MUST drop stale generations before and after inference.
- The UI MUST draw an actual neural ImageBitmap before logging `avatar-neural-frame`.
- Procedural deformation MUST be disabled by default and may never masquerade as neural output.
- The static attorney portrait MUST remain the fail-open baseline.
- The realtime speech 24 ms playback-start buffer and barge-in authority MUST remain unchanged.
- Build verification MUST prove all of the above and this literal 100-source list.
