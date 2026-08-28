// Legacy import compatibility only.
//
// The former dashboard module started wallet/balance services on import, owned a
// duplicate CryptoCrawler auto-start timer, exposed a separate "Divine optimizer",
// and could restart the historical faucet independently of canonical runtime
// governance. The canonical dashboard preserves the UI/read/control contract without
// those side effects or synthetic business-target authority.

export { dashboardApi, wss } from './canonical-dashboard-api.js';
export { dashboardApi as default } from './canonical-dashboard-api.js';
