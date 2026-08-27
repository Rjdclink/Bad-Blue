// Compatibility facade only. The sole OKX credential/region authority lives in
// cex-private-authority.ts so fee discovery, execution, settlement and account
// reads cannot diverge onto different regional origins.
export {
  getCachedOkxExecutionRestBaseUrl,
  getOkxExecutionRestBaseUrl,
} from './cex-private-authority.js';
