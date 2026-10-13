/** Do not mistake ISO/EXIF timestamps or slash-separated dates for phone clues.
 * Blueprint: google/libphonenumber PhoneNumberMatcher rejects dates/timestamps
 * before accepting a phone candidate. Preserve all other clue text.
 */
export function withoutSpectraTimestamps(text: string): string {
  return text
    .replace(/\b\d{4}[-:/]\d{2}[-:/]\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/gi, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, ' ');
}
