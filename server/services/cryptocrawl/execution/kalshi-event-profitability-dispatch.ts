import type { KalshiEventCanonicalDispatchResult } from './kalshi-event-canonical-dispatch.js';
import { dispatchBestKalshiEventCandidate } from './kalshi-event-canonical-dispatch.js';
import { kalshiLiveExecutionEnabled } from './kalshi-live-profitability-authority.js';

export async function dispatchProfitableKalshiCandidate(): Promise<KalshiEventCanonicalDispatchResult> {
  if (!kalshiLiveExecutionEnabled()) {
    return { attempted: false, submitted: false, opportunityId: null, lifecycleId: null, result: null };
  }
  return dispatchBestKalshiEventCandidate();
}
