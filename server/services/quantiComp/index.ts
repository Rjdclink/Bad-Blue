import { quantiAdaptiveOptimizer } from './adaptiveOptimizer.js';
import { installQuantiAdaptiveScheduling } from './adaptiveRuntime.js';
import { quantiBackendRegistry } from './backendRegistry.js';
import { installQuantiBackendRouting } from './backendRuntime.js';
import { quantiComp } from './runtime.js';

installQuantiAdaptiveScheduling(quantiComp, quantiAdaptiveOptimizer);
installQuantiBackendRouting(quantiComp, quantiBackendRegistry);

export * from './types.js';
export { QuantiResourceProfiler } from './resourceProfiler.js';
export { QuantiInteractionModel } from './interactionModel.js';
export {
  QuantiAdaptiveOptimizer,
  quantiAdaptiveOptimizer,
  type QuantiAdaptiveOptimizerOptions,
  type QuantiAdaptivePlan,
  type QuantiAdaptiveState,
  type QuantiAdaptiveStatus,
  type QuantiAdaptiveKindStatus,
  type QuantiAdaptiveStrategySummary,
} from './adaptiveOptimizer.js';
export {
  installQuantiAdaptiveScheduling,
  adaptivePlanFeatureVector,
  effectiveQuantiPower,
} from './adaptiveRuntime.js';
export {
  QuantiBackendRegistry,
  quantiBackendRegistry,
  type QuantiBackendExecutor,
  type QuantiBackendRegistryOptions,
  type QuantiBackendPlan,
  type QuantiBackendRouteState,
  type QuantiBackendSummary,
  type QuantiBackendKindStatus,
  type QuantiBackendCapability,
  type QuantiBackendRegistryStatus,
} from './backendRegistry.js';
export { installQuantiBackendRouting } from './backendRuntime.js';
export {
  QuantiDataFabric,
  quantiDataFabric,
  type QuantiDataFabricOptions,
  type QuantiDataFabricStatus,
  type QuantiSharedFloat64Lease,
  type QuantiPinnedFloat64State,
  type QuantiFloat64StateInfo,
} from './dataFabric.js';
export {
  QuantiTensorFabric,
  quantiTensorFabric,
  type QuantiTensorFabricOptions,
  type QuantiTensorFabricStatus,
  type QuantiTensorLease,
  type QuantiPinnedTensorState,
  type QuantiTensorStateInfo,
} from './tensorFabric.js';
export {
  QuantiParallelismGovernor,
  QuantiParallelismError,
  quantiParallelismGovernor,
  type QuantiParallelismGovernorOptions,
  type QuantiParallelismRequest,
  type QuantiParallelismLease,
  type QuantiParallelismStatus,
  type QuantiParallelismErrorCode,
} from './parallelismGovernor.js';
export {
  LexaraRayAvatarBackend,
  lexaraRayAvatarBackend,
  type LexaraRayAvatarRequest,
  type LexaraRayAvatarResponse,
  type LexaraRayAvatarFrame,
  type LexaraRayAvatarStatus,
} from './lexaraRayAvatarBackend.js';
export {
  LexaraAvatarComputeCoordinator,
  lexaraAvatarCompute,
  type LexaraAvatarBehaviorVector,
  type LexaraAvatarSegmentInput,
  type LexaraAvatarComputeResult,
  type LexaraAvatarComputeStatus,
} from './lexaraAvatarCompute.js';
export { QuantiCompRuntime, quantiComp, type QuantiCompRuntimeOptions, type QuantiSubmitOptions } from './runtime.js';
