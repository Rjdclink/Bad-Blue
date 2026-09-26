export type PantheonRetrievalObstacle =
  | 'javascript_required'
  | 'captcha_challenge'
  | 'access_denied'
  | 'rate_limited'
  | 'credential_required'
  | 'unknown';

export type PantheonEscalationLane =
  | 'direct-http'
  | 'browser-render'
  | 'structured-extraction'
  | 'stop';

export interface PantheonEscalationDecision {
  obstacle: PantheonRetrievalObstacle;
  lanes: PantheonEscalationLane[];
  reason: string;
}

export function classifyPantheonRetrievalObstacle(
  content: string,
  status = 0,
): PantheonRetrievalObstacle {
  const text = String(content || '').toLowerCase();
  if (status === 429 || /too many requests|rate limit/.test(text)) return 'rate_limited';
  if (status === 401 || /sign[ -]?in required|login required|authentication required|api key required/.test(text)) {
    return 'credential_required';
  }
  if (/captcha|recaptcha|hcaptcha|turnstile|verify you are human|unusual traffic/.test(text)) return 'captcha_challenge';
  if (status === 403 || /access denied|forbidden/.test(text)) return 'access_denied';
  if (/enable javascript|javascript (?:is )?required|requires javascript/.test(text)) return 'javascript_required';
  return 'unknown';
}

/**
 * Pantheon escalation stays latency-first: ordinary HTTP remains first. A real
 * browser is used only for pages whose useful content requires JavaScript.
 * Challenge/access-control pages are classified for audit rather than being
 * mislabeled as evidence.
 */
export function planPantheonRetrievalEscalation(
  obstacle: PantheonRetrievalObstacle,
): PantheonEscalationDecision {
  switch (obstacle) {
    case 'javascript_required':
      return {
        obstacle,
        lanes: ['browser-render', 'structured-extraction'],
        reason: 'JavaScript rendering is required before extraction.',
      };
    case 'rate_limited':
      return {
        obstacle,
        lanes: ['direct-http'],
        reason: 'Use the canonical governor/backoff path rather than adding browser load.',
      };
    case 'captcha_challenge':
    case 'access_denied':
    case 'credential_required':
      return {
        obstacle,
        lanes: ['stop'],
        reason: 'Record the retrieval barrier and do not treat the challenge page as evidence.',
      };
    default:
      return {
        obstacle,
        lanes: ['direct-http', 'structured-extraction'],
        reason: 'No specialized browser escalation is justified.',
      };
  }
}
