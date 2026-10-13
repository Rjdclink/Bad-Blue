/**
 * Per-acquisition query fingerprinting, following Scrapy's request-seen
 * approach. Query deduplication is scoped to one investigation request:
 * a later explicit refresh can re-check changed public documents.
 *
 * Never consume a budget slot for a query that was already searched in
 * an earlier recursive wave, and never mark a query as searched until
 * it is selected for dispatch. This is not a source-evidence deduper.
 */
export function takeUnseenSpectraQueries(
  queries: readonly string[],
  attempted: Set<string>,
  limit = 6,
): string[] {
  const cap = Number.isFinite(limit) ? Math.max(0, Math.min(48, Math.floor(limit))) : 6;
  const selected: string[] = [];
  for (const raw of queries) {
    if (selected.length >= cap) break;
    if (typeof raw !== 'string') continue;
    const query = raw.replace(/\s+/g, ' ').trim();
    if (!query) continue;
    const fingerprint = query.normalize('NFKC').toLocaleLowerCase('en-US');
    if (attempted.has(fingerprint)) continue;
    attempted.add(fingerprint);
    selected.push(query);
  }
  return selected;
}
