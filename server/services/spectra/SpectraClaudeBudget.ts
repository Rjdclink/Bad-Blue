/** A refresh of an existing investigation reuses public retrieval lanes without
 * buying another model-backed background pass. Manual requests still research. */
export function shouldRunSpectraClaudeBackground(args: {
  refreshOnly?: boolean;
  sessionId?: string;
}): boolean {
  return !(args.refreshOnly === true && Boolean(args.sessionId?.trim()));
}
