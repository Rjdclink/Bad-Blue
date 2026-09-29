/** Optional AI query planning after independent search lanes have run.
 * AI suggestions are never treated as evidence; discovery and source retrieval
 * still establish every factual claim. Provider failures remain isolated.
 */
import { callClaude } from '../../claude';
import { LEGAL_AI_MODELS } from '../../aiHarmonyModelRegistry';

export type PantheonAssistant = 'claude' | 'xai';
export interface PantheonResearchPlan { queries: string[]; assistants: PantheonAssistant[] }

const PROVIDER_COOLDOWN_MS = 60_000;
const cooling = new Map<PantheonAssistant, number>();
const available = (provider: PantheonAssistant) => (cooling.get(provider) || 0) <= Date.now();
const active = new Map<PantheonAssistant, number>();
const concurrency: Record<PantheonAssistant, number> = { claude: 2, xai: 2 };
function reserve(provider: PantheonAssistant): boolean {
  const count = active.get(provider) || 0;
  if (count >= concurrency[provider]) return false;
  active.set(provider, count + 1); return true;
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
let xaiModelCache: { model: string; until: number } | null = null;
async function xaiModel(key: string, signal: AbortSignal): Promise<string> {
  const configured = process.env.PANTHEON_XAI_MODEL?.trim();
  if (configured) return configured;
  if (xaiModelCache && xaiModelCache.until > Date.now()) return xaiModelCache.model;
  const response = await fetch('https://api.x.ai/v1/models', { headers: { Authorization: `Bearer ${key}` }, signal });
  if (!response.ok) throw new Error(`xAI model catalog HTTP ${response.status}`);
  const data = await response.json() as { data?: Array<{ id?: string }> };
  const ids = (data.data || []).map(item => item.id || '').filter(id => /^grok-/i.test(id));
  const model = ids.find(id => /^grok-4\.7$/i.test(id)) || ids.find(id => /^grok-4\.6$/i.test(id)) || ids[0];
  if (!model) throw new Error('No Grok language model is available to this xAI API key');
  xaiModelCache = { model, until: Date.now() + 10 * 60_000 }; return model;
}
async function askXai(prompt: string, signal: AbortSignal): Promise<string> {
  const key = process.env.XAI_API_KEY?.trim(); if (!key) throw new Error('xAI is not configured');
  const model = await xaiModel(key, signal);
  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 220, temperature: 0.2 }),
  });
  if (!response.ok) throw new Error(`xAI Grok HTTP ${response.status}`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return String(data.choices?.[0]?.message?.content || '');
}
async function askClaude(prompt: string, signal: AbortSignal): Promise<string> {
  const result = await callClaude(prompt, { model: process.env.PANTHEON_CLAUDE_MODEL?.trim() || LEGAL_AI_MODELS.claudeBalanced, maxTokens: 220, signal });
  return result.content;
}

/** Claude leads Pantheon planning; xAI Grok independently supports it. */
export async function planPantheonResearchQueries(
  query: string, options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<PantheonResearchPlan> {
  if (options.signal?.aborted) return { queries: [], assistants: [] };
  const controller = new AbortController();
  const relay = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', relay, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Pantheon assistant budget elapsed')), Math.max(2_000, options.timeoutMs || 9_000));
  const prompt = `Suggest exactly two distinct, short public-record search queries for this objective. Preserve the subject and place. Output only the two queries, one per line. Never state or invent a finding.\n\n${query.slice(0, 800)}`;
  const providers: Array<[PantheonAssistant, boolean, () => Promise<string>]> = [
    ['claude', !!(process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_API_KEY?.trim()), () => askClaude(prompt, controller.signal)],
    ['xai', !!process.env.XAI_API_KEY?.trim(), () => askXai(prompt, controller.signal)],
  ];
  const configured = providers.filter(([provider, enabled]) => enabled && available(provider));
  try {
    const settled = await Promise.allSettled(configured.map(async ([provider, , call]) => {
      if (!reserve(provider)) return { provider, queries: [] as string[], skipped: true };
      try { return { provider, queries: queriesFromAnswer(await call(), query), skipped: false }; }
      catch (error) {
        if (!controller.signal.aborted) {
          cooling.set(provider, Date.now() + (provider === 'xai' ? 5_000 : PROVIDER_COOLDOWN_MS));
          console.warn('[PANTHEON] Research assistant unavailable', { provider, reason: error instanceof Error ? error.message : String(error) });
        }
        return { provider, queries: [] as string[], skipped: false };
      } finally { release(provider); }
    }));
    const useful = settled.flatMap(result => result.status === 'fulfilled' && result.value.queries.length ? [result.value] : []);
    return {
      queries: [...new Set(useful.flatMap(item => item.queries))].slice(0, 4),
      assistants: useful.map(item => item.provider),
    };
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener('abort', relay); controller.abort();
  }
}
