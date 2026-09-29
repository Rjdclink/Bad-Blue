/** Optional AI query planning after independent search lanes have run.
 * AI suggestions are never treated as evidence; discovery and source retrieval
 * still establish every factual claim. Provider failures remain isolated.
 */
import { callClaude } from '../../claude';
import { LEGAL_AI_MODELS } from '../../aiHarmonyModelRegistry';

export type PantheonAssistant = 'claude' | 'xai' | 'jenova';
export interface PantheonResearchPlan { queries: string[]; assistants: PantheonAssistant[] }

const PROVIDER_COOLDOWN_MS = 60_000;
const cooling = new Map<PantheonAssistant, number>();
const available = (provider: PantheonAssistant) => (cooling.get(provider) || 0) <= Date.now();
const active = new Map<PantheonAssistant, number>();
const concurrency: Record<PantheonAssistant, number> = { claude: 2, xai: 2, jenova: 2 };
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
async function jenovaAgent(key: string, signal: AbortSignal): Promise<string> {
  const configured = process.env.JENOVA_BACKGROUND_AGENT?.trim();
  if (configured) return configured;
  const response = await fetch('https://api.jenova.ai/v1/agents', {
    headers: { Authorization: `Bearer ${key}` }, signal,
  });
  if (!response.ok) throw new Error(`Jenova agent catalog HTTP ${response.status}`);
  const data = await response.json() as { agents?: Array<{ agent?: string; display_name?: string }> };
  const agent = data.agents?.find(item => /professional.background.investigator/i.test(`${item.agent || ''} ${item.display_name || ''}`));
  if (!agent?.agent) throw new Error('Professional Background Investigator is not available to this Jenova API key');
  return agent.agent;
}
async function askJenova(prompt: string, signal: AbortSignal): Promise<string> {
  const key = process.env.JENOVA_API_KEY?.trim(); if (!key) throw new Error('Jenova is not configured');
  const agent = await jenovaAgent(key, signal);
  const response = await fetch('https://api.jenova.ai/v1/messages', {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent, content: prompt, ephemeral: true, stream: true }),
  });
  if (!response.ok) throw new Error(`Jenova HTTP ${response.status}`);
  const reader = response.body?.getReader(); if (!reader) throw new Error('Jenova returned no stream');
  const decoder = new TextDecoder(); let buffer = '', answer = '';
  try {
    while (answer.length < 2_000) {
      const { value, done } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop() || '';
      for (const frame of frames) {
        if (!/^event: stream_delta$/m.test(frame)) continue;
        const payload = /^data: (.*)$/m.exec(frame)?.[1]; if (!payload) continue;
        try { answer += String(JSON.parse(payload).chunk_content || ''); } catch {}
      }
    }
  } finally { await reader.cancel().catch(() => {}); }
  return answer;
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

/** Claude and xAI Grok are primary redundant planners; Jenova joins when healthy. */
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
    ['jenova', !!process.env.JENOVA_API_KEY?.trim(), () => askJenova(prompt, controller.signal)],
  ];
  const configured = providers.filter(([provider, enabled]) => enabled && available(provider));
  try {
    const settled = await Promise.allSettled(configured.map(async ([provider, , call]) => {
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
    return {
      queries: [...new Set(useful.flatMap(item => item.queries))].slice(0, 4),
      assistants: useful.map(item => item.provider),
    };
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener('abort', relay); controller.abort();
  }
}
