/** Optional AI query planning after independent search lanes have run.
 * AI suggestions are never treated as evidence; discovery and source retrieval
 * still establish every factual claim. A failed assistant cannot block search.
 */
import { callClaude } from '../../claude';
import { getGroqClient } from '../../groq';
import { LEGAL_AI_MODELS } from '../../aiHarmonyModelRegistry';

export type PantheonAssistant = 'jenova' | 'groq' | 'claude';
export interface PantheonResearchPlan { queries: string[]; assistants: PantheonAssistant[] }

const PROVIDER_COOLDOWN_MS = 60_000;
const cooling = new Map<PantheonAssistant, number>();
const available = (provider: PantheonAssistant) => (cooling.get(provider) || 0) <= Date.now();
const active = new Map<PantheonAssistant, number>();
const concurrency: Record<PantheonAssistant, number> = { jenova: 2, groq: 3, claude: 1 };
function reserve(provider: PantheonAssistant): boolean {
  const count = active.get(provider) || 0;
  if (count >= concurrency[provider]) return false;
  active.set(provider, count + 1);
  return true;
}
function release(provider: PantheonAssistant): void {
  active.set(provider, Math.max(0, (active.get(provider) || 1) - 1));
}

function queriesFromAnswer(answer: string, original: string): string[] {
  return [...new Set(answer.split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:\d+[.)]|[-*])\s*/, '').replace(/^['"]|['"]$/g, '').trim())
    .filter(line => line.length >= 12 && line.length <= 180 && !/^https?:/i.test(line)
      && line.toLowerCase() !== original.toLowerCase()))].slice(0, 2);
}

async function jenovaAgent(key: string, signal: AbortSignal): Promise<string> {
  const configured = process.env.JENOVA_BACKGROUND_AGENT?.trim();
  if (configured) return configured;
  const response = await fetch('https://api.jenova.ai/v1/agents', {
    headers: { Authorization: `Bearer ${key}` }, signal,
  });
  if (!response.ok) throw new Error(`Jenova agent catalog HTTP ${response.status}`);
  const data = await response.json() as { agents?: Array<{ agent?: string; display_name?: string }> };
  const agent = data.agents?.find(item => /professional.background.investigator/i
    .test(`${item.agent || ''} ${item.display_name || ''}`));
  if (!agent?.agent) throw new Error('Professional Background Investigator is not available to this Jenova API key');
  return agent.agent;
}

async function askJenova(prompt: string, signal: AbortSignal): Promise<string> {
  const key = process.env.JENOVA_API_KEY?.trim();
  if (!key) throw new Error('Jenova is not configured');
  const agent = await jenovaAgent(key, signal);
  const response = await fetch('https://api.jenova.ai/v1/messages', {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent, content: prompt, ephemeral: true, stream: true }),
  });
  if (!response.ok) throw new Error(`Jenova HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Jenova returned no stream');
  const decoder = new TextDecoder();
  let buffer = '', answer = '';
  try {
    while (answer.length < 2_000) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || '';
      for (const frame of frames) {
        if (!/^event: stream_delta$/m.test(frame)) continue;
        const payload = /^data: (.*)$/m.exec(frame)?.[1];
        if (!payload) continue;
        try { answer += String(JSON.parse(payload).chunk_content || ''); } catch { /* Ignore malformed frame. */ }
      }
    }
  } finally { await reader.cancel().catch(() => {}); }
  return answer;
}

async function askGroq(prompt: string, signal: AbortSignal): Promise<string> {
  if (!process.env.GROQ_API_KEY?.trim()) throw new Error('Groq is not configured');
  const response = await getGroqClient().chat.completions.create({
    model: process.env.PANTHEON_GROQ_MODEL?.trim() || 'qwen/qwen3.8-27b',
    messages: [{ role: 'user', content: prompt }], max_tokens: 220, signal,
  });
  return String(response.choices?.[0]?.message?.content || '');
}

/** Run independent assistants together, then Claude only if neither returns a useful lead. */
export async function planPantheonResearchQueries(
  query: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<PantheonResearchPlan> {
  if (options.signal?.aborted) return { queries: [], assistants: [] };
  const controller = new AbortController();
  const relay = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', relay, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Pantheon assistant budget elapsed')),
    Math.max(1_000, options.timeoutMs || 7_000));
  const prompt = `Suggest exactly two distinct, short public-record search queries for this objective. Preserve the subject and place. Output only the two queries, one per line. Never state or invent a finding.\n\n${query.slice(0, 800)}`;
  const providers: Array<[PantheonAssistant, () => Promise<string>]> = [
    ['jenova', () => askJenova(prompt, controller.signal)],
    ['groq', () => askGroq(prompt, controller.signal)],
  ];
  const configured = providers.filter(([provider]) => available(provider)
    && (provider === 'jenova' ? !!process.env.JENOVA_API_KEY?.trim() : !!process.env.GROQ_API_KEY?.trim()));
  try {
    const settled = await Promise.allSettled(configured.map(async ([provider, call]) => {
      if (!reserve(provider)) return { provider, queries: [] as string[], skipped: true };
      try { return { provider, queries: queriesFromAnswer(await call(), query), skipped: false }; }
      catch (error) {
        if (!controller.signal.aborted) {
          cooling.set(provider, Date.now() + PROVIDER_COOLDOWN_MS);
          console.warn('[PANTHEON] Research assistant unavailable', { provider, reason: error instanceof Error ? error.message : String(error) });
        }
        return { provider, queries: [] as string[], skipped: false };
      } finally { release(provider); }
    }));
    const useful = settled.flatMap(result => result.status === 'fulfilled' && result.value.queries.length ? [result.value] : []);
    if (useful.length) return {
      queries: [...new Set(useful.flatMap(item => item.queries))].slice(0, 3),
      assistants: useful.map(item => item.provider),
    };
    if (controller.signal.aborted || !available('claude')
      || !(process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_API_KEY?.trim())) {
      return { queries: [], assistants: [] };
    }
    // Saturated primaries are still doing useful work for other searches.
    // Do not fan every simultaneous category miss out to paid Claude.
    if (configured.length && settled.every(result => result.status === 'fulfilled' && result.value.skipped)) {
      return { queries: [], assistants: [] };
    }
    if (!reserve('claude')) return { queries: [], assistants: [] };
    try {
      const result = await callClaude(prompt, { model: LEGAL_AI_MODELS.claudeFast, maxTokens: 220, signal: controller.signal });
      const queries = queriesFromAnswer(result.content, query);
      return { queries, assistants: queries.length ? ['claude'] : [] };
    } catch (error) {
      if (!controller.signal.aborted) {
        cooling.set('claude', Date.now() + PROVIDER_COOLDOWN_MS);
        console.warn('[PANTHEON] Claude research fallback unavailable', { reason: error instanceof Error ? error.message : String(error) });
      }
      return { queries: [], assistants: [] };
    } finally { release('claude'); }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', relay);
    controller.abort();
  }
}
