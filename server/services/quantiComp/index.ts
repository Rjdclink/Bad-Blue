import { quantiAdaptiveOptimizer } from './adaptiveOptimizer.js';
import { installQuantiAdaptiveScheduling } from './adaptiveRuntime.js';
import { installQuantiAdmissionControl } from './admissionControl.js';
import { quantiBackendRegistry } from './backendRegistry.js';
import { installQuantiBackendRouting } from './backendRuntime.js';
import { quantiComp } from './runtime.js';

installQuantiAdaptiveScheduling(quantiComp, quantiAdaptiveOptimizer);
installQuantiBackendRouting(quantiComp, quantiBackendRegistry);
installQuantiAdmissionControl(quantiComp);

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
export { installQuantiAdmissionControl, submitCoalescedQuantiBatch, getQuantiAdmissionControlHealth } from './admissionControl.js';
export { chooseHierarchicalCompute, HIERARCHICAL_COMPUTE_TIERS, REMOTE_FINAL_SAFETY_AUTHORITY_PROVEN } from './hierarchicalComputePolicy.js';
export { executeAxialWork, QUANTI_AXIS_COORDINATION, type QuantiWorkAxis, type AxisWorkUnit } from './axisWorkCoordinator.js';
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
  QuantiParallelismGovernor,
  QuantiParallelismError,
  quantiParallelismGovernor,
  type QuantiParallelismGovernorOptions,
  type QuantiParallelismRequest,
  type QuantiParallelismLease,
  type QuantiParallelismStatus,
  type QuantiParallelismErrorCode,
} from './parallelismGovernor.js';
export { QuantiCompRuntime, quantiComp, type QuantiCompRuntimeOptions, type QuantiSubmitOptions } from './runtime.js';
