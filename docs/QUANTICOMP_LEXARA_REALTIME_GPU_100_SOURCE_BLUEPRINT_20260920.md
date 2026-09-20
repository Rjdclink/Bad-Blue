# QuantiComp → LEXARA Realtime Neural Avatar — 100-Source Blueprint

Date: 2026-09-20

## Purpose

This review targets one narrow purpose: make the existing QuantiComp/Computational Beam fabric a safe realtime dispatcher for LEXARA's future neural photoreal avatar compute without allowing avatar work to delay legal reasoning, speech synthesis, microphone/barge-in, or text.

The useful ideas requested from the existing/prior architecture are translated into concrete engineering primitives rather than copied literally:

- **Ray** → resource-aware actor/service scheduling, GPU labels, state affinity, bounded concurrency, backpressure, cancellation, placement/locality, prewarmed replicas, and compiled/preallocated execution.
- **Ice Crystal / Crystal cache concept** → bounded hot Float32 tensor state for the canonical LEXARA identity, landmarks/conditioning vectors, and other reusable inference context. It is explicitly separate from crawler data and legal-user content.
- **LeBrony optimization pattern** → deadline-aware anytime operation, straggler suppression, incumbent/latest-result preservation, pre-positioned capability, idempotent generation fencing, and no waiting for optional work once useful realtime output exists.
- **snake-skin/shedding pattern** → visual work is disposable by generation. A newer conversational turn/segment sheds older visual work immediately while preserving the conversation and audio authorities.

## Cross-reference against current QuantiComp

The repository already had strong pieces worth preserving: ultra_hot/hot/warm/batch/background lanes, deadline ordering, bounded concurrency, cancellation, in-flight deduplication, result validation, adaptive scheduling, backend canary/rollback, a parallelism governor, resource profiling, a Float64 shared-state fabric, and explicit gpu/remote backend types.

The missing realtime-avatar pieces were:

1. No generation/supersession fence, so a stale visual job could still finish after a newer conversational state.
2. No avatar-specific domain isolation/preemptibility contract.
3. No Float32 hot tensor/context fabric sized for ML inference state.
4. No LEXARA-specific QuantiComp coordinator with strict visual deadlines and latest-useful-generation semantics.
5. No dormant Ray Serve transport contract that can become active only when an external accelerator is explicitly configured.
6. No circuit breaker/prewarm state for the remote avatar accelerator.
7. No regression proof that stale avatar compute cannot cancel or delay legal reasoning.
8. No build-locked research blueprint for this specialization.

## Architecture adopted

**Conversation/audio remain authority.** The realtime audio path is never routed through QuantiComp.

**QuantiComp becomes visual-compute authority.** It owns deadline, generation fencing, cancellation, validation, queue priority, and remote-dispatch lifecycle for neural visual work.

**Ray is an accelerator target, not a new authority.** A configured Ray Serve endpoint can run SoulX/Ditto/LivePortrait/MuseTalk-class models. If absent, unhealthy, late, or superseded, LEXARA keeps the browser embodiment fallback.

**Latest useful generation wins.** Every LEXARA avatar session has a monotonic generation. Newer work invalidates older work before execution, during execution, and again after validation before publication.

**Visual failures are local.** No GPU endpoint exists in the current Railway service, and QuantiComp does not create GPU hardware. The new remote path therefore remains dormant until explicitly configured.

**Hot identity context is reused.** Float32 tensor state can be cached with TTL/LRU-style bounded eviction so model-conditioning data does not need to be recreated or recopied each segment.

**No unbounded queues.** Visual work has short deadlines, explicit cancellation, supersession, bounded state memory, and remote timeout/circuit-breaker behavior.

## Sources — exactly 100

1. Ray scheduling overview — https://docs.ray.io/en/latest/ray-core/scheduling/index.html
2. Ray resources — https://docs.ray.io/en/latest/ray-core/scheduling/resources.html
3. Ray placement groups — https://docs.ray.io/en/latest/ray-core/scheduling/placement-group.html
4. Ray labels — https://docs.ray.io/en/latest/ray-core/scheduling/labels.html
5. Ray accelerators — https://docs.ray.io/en/latest/ray-core/scheduling/accelerators.html
6. Ray actors — https://docs.ray.io/en/latest/ray-core/actors.html
7. Ray async actors — https://docs.ray.io/en/latest/ray-core/actors/async_api.html
8. Ray actor task ordering — https://docs.ray.io/en/latest/ray-core/actors/task-orders.html
9. Ray actor fault tolerance — https://docs.ray.io/en/latest/ray-core/fault_tolerance/actors.html
10. Ray task fault tolerance — https://docs.ray.io/en/latest/ray-core/fault_tolerance/tasks.html
11. Ray serialization — https://docs.ray.io/en/latest/ray-core/objects/serialization.html
12. Ray memory management — https://docs.ray.io/en/latest/ray-core/scheduling/memory-management.html
13. Ray object spilling — https://docs.ray.io/en/latest/ray-core/objects/object-spilling.html
14. Ray pending-task backpressure pattern — https://docs.ray.io/en/latest/ray-core/patterns/limit-pending-tasks.html
15. Ray running-task resource limit pattern — https://docs.ray.io/en/latest/ray-core/patterns/limit-running-tasks.html
16. Ray cancel API — https://docs.ray.io/en/latest/ray-core/api/doc/ray.cancel.html
17. Ray wait API — https://docs.ray.io/en/latest/ray-core/api/doc/ray.wait.html
18. Ray Compiled Graph — https://docs.ray.io/en/latest/ray-core/compiled-graph/ray-compiled-graph.html
19. Ray Compiled Graph overlap — https://docs.ray.io/en/latest/ray-core/compiled-graph/overlap.html
20. Ray Serve overview — https://docs.ray.io/en/latest/serve/index.html
21. Ray Serve dynamic batching — https://docs.ray.io/en/latest/serve/advanced-guides/dyn-req-batch.html
22. Ray Serve autoscaling — https://docs.ray.io/en/latest/serve/autoscaling-guide.html
23. Ray Serve advanced autoscaling — https://docs.ray.io/en/latest/serve/advanced-guides/advanced-autoscaling.html
24. Ray Serve model multiplexing — https://docs.ray.io/en/latest/serve/model-multiplexing.html
25. Ray Serve asynchronous inference — https://docs.ray.io/en/latest/serve/asynchronous-inference.html
26. Ray Serve replica scheduling — https://docs.ray.io/en/latest/serve/advanced-guides/replica-scheduling.html
27. Ray Serve performance tuning — https://docs.ray.io/en/latest/serve/advanced-guides/performance.html
28. Ray Serve deployment configuration — https://docs.ray.io/en/latest/serve/configure-serve-deployment.html
29. Ray Serve production configuration — https://docs.ray.io/en/latest/serve/production-guide/config.html
30. Ray Data internals/backpressure — https://docs.ray.io/en/latest/data/data-internals.html
31. NVIDIA Triton model configuration — https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/model_configuration.html
32. NVIDIA Triton batchers — https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/batcher.html
33. NVIDIA Triton rate limiter — https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/rate_limiter.html
34. NVIDIA Triton decoupled models — https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/decoupled_models.html
35. NVIDIA Triton metrics — https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/metrics.html
36. NVIDIA Triton optimization — https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/optimization.html
37. NVIDIA Triton response cache — https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/response_cache.html
38. NVIDIA Triton model management — https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/model_management.html
39. NVIDIA Triton shared memory extension — https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/protocol/extension_shared_memory.html
40. NVIDIA Triton sequence extension — https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/protocol/extension_sequence.html
41. NVIDIA Triton model analyzer — https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/model_analyzer/README.html
42. NVIDIA Triton performance analyzer — https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/perf_analyzer/README.html
43. NVIDIA Triton Python backend — https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/python_backend/README.html
44. NVIDIA Triton dynamic batching/concurrency tutorial — https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/tutorials/Conceptual_Guide/Part_2-improving_resource_utilization/README.html
45. NVIDIA TensorRT performance optimization — https://docs.nvidia.com/deeplearning/tensorrt/latest/performance/optimization.html
46. NVIDIA TensorRT best practices — https://docs.nvidia.com/deeplearning/tensorrt/latest/performance/best-practices.html
47. NVIDIA TensorRT dynamic shapes — https://docs.nvidia.com/deeplearning/tensorrt/latest/inference-library/work-dynamic-shapes.html
48. NVIDIA TensorRT Python API — https://docs.nvidia.com/deeplearning/tensorrt/latest/inference-library/python-api-docs.html
49. NVIDIA CUDA asynchronous execution — https://docs.nvidia.com/cuda/cuda-programming-guide/02-basics/asynchronous-execution.html
50. NVIDIA CUDA Graphs — https://docs.nvidia.com/cuda/cuda-programming-guide/04-special-topics/cuda-graphs.html
51. NVIDIA CUDA streams — https://docs.nvidia.com/cuda/cuda-programming-guide/02-basics/asynchronous-execution.html#streams
52. NVIDIA CUDA page-locked host memory — https://docs.nvidia.com/cuda/cuda-c-programming-guide/index.html#page-locked-host-memory
53. NVIDIA CUDA memory pools — https://docs.nvidia.com/cuda/cuda-c-programming-guide/index.html#stream-ordered-memory-allocator
54. NVIDIA Video Codec SDK — https://developer.nvidia.com/video-codec-sdk
55. ONNX Runtime I/O Binding — https://onnxruntime.ai/docs/performance/tune-performance/iobinding.html
56. ONNX Runtime CUDA execution provider — https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html
57. ONNX Runtime TensorRT execution provider — https://onnxruntime.ai/docs/execution-providers/TensorRT-ExecutionProvider.html
58. ONNX Runtime device tensors — https://onnxruntime.ai/docs/performance/device-tensor.html
59. ONNX Runtime WebGPU execution provider — https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html
60. ONNX Runtime performance tuning — https://onnxruntime.ai/docs/performance/tune-performance/
61. PyTorch torch.compile — https://docs.pytorch.org/docs/stable/generated/torch.compile.html
62. PyTorch CUDA semantics — https://docs.pytorch.org/docs/stable/notes/cuda.html
63. PyTorch CUDA Graphs — https://pytorch.org/blog/accelerating-pytorch-with-cuda-graphs/
64. PyTorch inference mode — https://docs.pytorch.org/docs/stable/generated/torch.autograd.grad_mode.inference_mode.html
65. PyTorch performance tuning guide — https://docs.pytorch.org/tutorials/recipes/recipes/tuning_guide.html
66. GStreamer queue — https://gstreamer.freedesktop.org/documentation/coreelements/queue.html
67. GStreamer appsrc — https://gstreamer.freedesktop.org/documentation/app/appsrc.html
68. GStreamer appsink — https://gstreamer.freedesktop.org/documentation/app/appsink.html
69. GStreamer WebRTC — https://gstreamer.freedesktop.org/documentation/webrtc/
70. GStreamer RTP jitter buffer — https://gstreamer.freedesktop.org/documentation/rtpmanager/rtpjitterbuffer.html
71. GStreamer latency design — https://gstreamer.freedesktop.org/documentation/additional/design/latency.html
72. MDN WebCodecs — https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API
73. MDN VideoFrame — https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame
74. MDN requestVideoFrameCallback — https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback
75. MDN OffscreenCanvas — https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
76. MDN WebRTC — https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API
77. MDN AudioWorklet — https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet
78. IETF RFC 3550 RTP — https://www.rfc-editor.org/rfc/rfc3550
79. IETF RFC 6051 Rapid RTP Synchronization — https://www.rfc-editor.org/rfc/rfc6051
80. IETF RFC 8834 WebRTC Media Transport — https://www.rfc-editor.org/rfc/rfc8834
81. SoulX-FlashHead — https://github.com/Soul-AILab/SoulX-FlashHead
82. Ditto TalkingHead — https://github.com/antgroup/ditto-talkinghead
83. LivePortrait — https://github.com/KwaiVGI/LivePortrait
84. FasterLivePortrait — https://github.com/warmshao/FasterLivePortrait
85. MuseTalk — https://github.com/TMElyralab/MuseTalk
86. ARTalk — https://github.com/xg-chu/ARTalk
87. EchoMimic — https://github.com/antgroup/echomimic
88. EchoMimicV2 — https://github.com/antgroup/echomimic_v2
89. OmniAvatar — https://github.com/Omni-Avatar/OmniAvatar
90. Real3D-Portrait — https://github.com/yerfor/Real3DPortrait
91. DiffSHEG — https://github.com/JeremyCJM/DiffSHEG
92. MaAI — https://github.com/MaAI-Kyoto/MaAI
93. Voice Activity Projection — https://github.com/ErikEkstedt/VoiceActivityProjection
94. BEAT — https://github.com/PantoMatrix/BEAT
95. MODNet — https://github.com/ZHKKKe/MODNet
96. SAM 2 — https://github.com/facebookresearch/sam2
97. Depth Anything V2 — https://github.com/DepthAnything/Depth-Anything-V2
98. One Euro Filter — https://github.com/casiez/OneEuroFilter
99. SyncNet — https://github.com/joonson/syncnet_python
100. Netflix VMAF — https://github.com/Netflix/vmaf

## Implementation contract

- QuantiComp MUST reject stale generations with `SUPERSEDED`.
- A running visual generation MAY be aborted only when it explicitly opts into `preemptible` and the newer work belongs to the same visual supersession stream/resource domain.
- Workloads that do not opt into supersession retain the old behavior.
- Legal reasoning/TTS/audio MUST NOT use the avatar supersession key or visual resource domain.
- LEXARA neural visual work uses `ultra_hot` scheduling and a bounded deadline; it never waits indefinitely for an accelerator.
- The Ray adapter MUST make zero network requests when `QUANTI_AVATAR_RAY_INFER_URL` is absent.
- Remote transport MUST honor the QuantiComp AbortSignal.
- The Ray adapter MUST circuit-break repeated failures rather than creating a failure storm.
- The Float32 tensor fabric MUST remain bounded by pool bytes and state bytes, use reusable buffers, and expire/evict unpinned state.
- The existing Float64 numerical data fabric remains unchanged.
- Browser embodiment remains the fallback until a real GPU/Ray endpoint is configured and validated.
- QuantiComp does not create GPU horsepower; it schedules and governs available GPU/remote horsepower.
- Audio is the synchronization authority; stale visual output is disposable.
- Build verification MUST prove generation shedding, domain isolation, tensor reuse, and the literal 100-source blueprint.
