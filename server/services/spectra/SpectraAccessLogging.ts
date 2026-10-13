/** Allowlisted route labels only: no session IDs, queries or response payloads. */
export function spectraAccessLogPath(path: string): string | null {
  const normalized = path.split('?')[0].toLowerCase();
  if (normalized !== '/api/spectra' && !normalized.startsWith('/api/spectra/')) return null;
  if (/^\/api\/spectra\/sessions\/[^/]+\/records\/?$/.test(normalized)) {
    return '/api/spectra/sessions/:sessionId/records';
  }
  const routes = ['/api/spectra', '/api/spectra/acquire', '/api/spectra/public-place', '/api/spectra/public-records'];
  const canonical = normalized.replace(/\/$/, '');
  return routes.includes(canonical) ? canonical : '/api/spectra/:unrecognized';
}
