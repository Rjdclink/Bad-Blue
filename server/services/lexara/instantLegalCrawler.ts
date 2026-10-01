/**
 * Canonical Lexara legal-crawler entry point.
 *
 * The implementation remains in the historical service location during the
 * compatibility window so existing imports keep working while active Lexara
 * wiring uses one canonical name/path.
 */
export * from '../alexara/instantLegalCrawler';
export { default } from '../alexara/instantLegalCrawler';
