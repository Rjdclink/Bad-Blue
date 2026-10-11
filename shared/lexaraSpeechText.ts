/** Spoken-only rendering. The displayed answer keeps its original Markdown. */
export function lexaraSpeechText(value: string): string {
  return String(value || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|\/)[^)]*\)/g, '$1')
    .replace(/(^|\n)\s{0,3}#{1,6}\s+/g, '$1')
    .replace(/(^|\n)\s{0,3}(?:[+*-]|\d+[.)])\s+/g, '$1')
    .replace(/(\d)\s*\*\s*(?=[\p{L}\d])/gu, '$1 times ')
    .replace(/[\x60*]/g, '')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
