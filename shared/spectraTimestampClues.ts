/** Capture dates are evidence age, never telephone identifiers. */
export function withoutSpectraTimestamps(text: string): string {
  return text.replace(/\b\d{4}[-:/]\d{2}[-:/]\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?/g, ' ');
}
