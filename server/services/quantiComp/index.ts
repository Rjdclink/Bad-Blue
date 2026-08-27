import { quantiAdaptiveOptimizer } from './adaptiveOptimizer.js';
import { installQuantiAdaptiveScheduling } from './adaptiveRuntime.js';
import { quantiComp } from './runtime.js';

installQuantiAdaptiveScheduling(quantiComp, quantiAdaptiveOptimizer);

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
