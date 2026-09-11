// Canonical hot learning persistence authority.
//
// The legacy implementation module is retained for compatibility, but its
// RuntimeJsonStateStore already resolves the canonical CryptoCrawler runtime
// database pool. In production that pool is the Overflow authority. Re-exporting
// through this provider-neutral/authority-correct surface prevents Stage 4+
// lifecycle wiring from implying or reintroducing direct Primary I/O.
export {
  hydratePrimaryLearningState as hydrateOverflowLearningState,
  persistPrimaryLearningState as persistOverflowLearningState,
} from './primary-learning-persistence.js';
