/** Document requests still need a spoken reply; only the instrument stays on screen. */
export function lexaraDocumentSpeech(answer: string, documentTurn: boolean): string {
  if (!documentTurn) return answer;
  const body = answer.trim();
  const looksLikeInstrument = /\[[A-Z][A-Z0-9 _/.-]{2,}\]|^(?:#{1,3}\s*)?(?:DEMAND LETTER|IN THE .*COURT|Dear\s|To:\s|RE:\s)/m.test(body)
    || body.length > 1200;
  return looksLikeInstrument
    ? 'The document text is on screen. You can choose PDF or DOCX to prepare a download.'
    : body;
}
