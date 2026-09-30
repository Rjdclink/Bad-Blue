import { AIProvider } from './aiTokenGovernor';
import {
  getConfiguredHarmonyParticipants,
  getCurrentModelForProvider,
} from './aiHarmonyModelRegistry';
import { warmGroqModelCatalog } from './groq';

export type HarmonyWarmState = 'unknown' | 'catalog' | 'ready' | 'degraded';

export interface HarmonyWarmStatus {
  provider: AIProvider;
  model: string;
  state: HarmonyWarmState;
  checkedAt: number;
  latencyMs: number;
  error?: string;
}

const warmStatus = new Map<AIProvider, HarmonyWarmStatus>();
const resolvedModels = new Map<AIProvider, string>();
const recoveryModels = new Map<AIProvider, string[]>();

export function getHarmonyRecoveryModels(provider: AIProvider): string[] {
  return [...(recoveryModels.get(provider) || [])];
}
let warmupInFlight: Promise<HarmonyWarmStatus[]> | null = null;
const CATALOG_TIMEOUT_MS = 3_500;

function normalizeModelId(value: string): string {
  return String(value || '').trim().replace(/^models\//, '');
}

async function fetchCatalog(
  url: string,
  headers: Record<string, string>,
  extractor: (payload: any) => string[],
): Promise<Set<string>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`catalog HTTP ${response.status}`);
    }
    const payload = await response.json();
    return new Set(extractor(payload).map(normalizeModelId).filter(Boolean));
  } finally {
    clearTimeout(timer);
  }
}

function chooseCatalogModel(
  catalog: Set<string>,
  preferred: string,
  predicates: Array<(model: string) => boolean>,
): string | null {
  const normalizedPreferred = normalizeModelId(preferred);
  if (catalog.has(normalizedPreferred)) return normalizedPreferred;
  const models = [...catalog];
  for (const predicate of predicates) {
    const candidate = models.find(model => predicate(model));
    if (candidate) return candidate;
  }
  return null;
}

export function getHarmonyResolvedModel(provider: AIProvider): string {
  return resolvedModels.get(provider) || getCurrentModelForProvider(provider);
}

function record(
  provider: AIProvider,
  model: string,
  startedAt: number,
  state: HarmonyWarmState,
  error?: string,
): HarmonyWarmStatus {
  const value: HarmonyWarmStatus = {
    provider,
    model,
    state,
    checkedAt: Date.now(),
    latencyMs: Date.now() - startedAt,
    ...(error ? { error } : {}),
  };
  warmStatus.set(provider, value);
  if ((state === 'ready' || state === 'catalog') && model) resolvedModels.set(provider, model);
  return value;
}

function providerUsesOpenRouter(provider: AIProvider): boolean {
  return [
    AIProvider.DEEPSEEK,
    AIProvider.GROK,
    AIProvider.KIMI,
    AIProvider.QWEN,
    AIProvider.GPT5_MINI,
    AIProvider.OPENROUTER,
    AIProvider.FALCON,
    AIProvider.CODE_LLAMA,
    AIProvider.GPT_NEOX,
    AIProvider.PERPLEXITY,
  ].includes(provider);
}

export function getHarmonyWarmStatus(): HarmonyWarmStatus[] {
  return getConfiguredHarmonyParticipants().map(participant =>
    warmStatus.get(participant.provider) || {
      provider: participant.provider,
      model: participant.model,
      state: 'unknown',
      checkedAt: 0,
      latencyMs: 0,
    }
  );
}

export function getHarmonyWarmState(provider: AIProvider): HarmonyWarmState {
  return warmStatus.get(provider)?.state || 'unknown';
}

export function getHarmonyInferenceReadyCount(): number {
  return getHarmonyWarmStatus().filter(status => status.state === 'ready').length;
}

/**
 * Unknown routes remain eligible. Only a route that has been positively checked
 * and found unusable is suppressed until the next warmup or a successful call.
 */
export function isHarmonyProviderWarmHealthy(provider: AIProvider): boolean {
  const status = warmStatus.get(provider);
  if (!status || status.state !== 'degraded') return true;

  // A provider already known degraded is excluded from user work. After a
  // short TTL, refresh only its non-inference catalog state in the background;
  // it becomes eligible again only after that refresh succeeds.
  if (Date.now() - status.checkedAt > 60_000) {
    void prewarmHarmonyProviders().catch(() => undefined);
  }
  return false;
}

export function markHarmonyProviderWarmSuccess(provider: AIProvider, successfulModel?: string): void {
  if (successfulModel) resolvedModels.set(provider, successfulModel);
  const model = successfulModel || getHarmonyResolvedModel(provider);
  warmStatus.set(provider, {
    provider,
    model,
    state: 'ready',
    checkedAt: Date.now(),
    latencyMs: warmStatus.get(provider)?.latencyMs || 0,
  });
}

export async function prewarmHarmonyProviders(): Promise<HarmonyWarmStatus[]> {
  if (warmupInFlight) return warmupInFlight;

  warmupInFlight = (async () => {
    const participants = getConfiguredHarmonyParticipants();
    const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
    let openRouterCatalogPromise: Promise<Set<string>> | null = null;

    const getOpenRouterCatalog = () => {
      if (!openRouterKey) return Promise.resolve(new Set<string>());
      if (!openRouterCatalogPromise) {
        openRouterCatalogPromise = fetchCatalog(
          'https://openrouter.ai/api/v1/models',
          { Authorization: `Bearer ${openRouterKey}` },
          payload => (payload?.data || []).map((item: any) => item?.id),
        );
      }
      return openRouterCatalogPromise;
    };

    const checks = participants.map(async participant => {
      const provider = participant.provider;
      const model = participant.model;
      const startedAt = Date.now();

      try {
        if (provider === AIProvider.GROQ) {
          const result = await warmGroqModelCatalog();
          return record(
            provider,
            result.model || model,
            startedAt,
            result.ready ? 'catalog' : 'degraded',
            result.error,
          );
        }

        if (providerUsesOpenRouter(provider)) {
          const catalog = await getOpenRouterCatalog();
          if (catalog.size === 0) return record(provider, model, startedAt, 'degraded', 'OpenRouter catalog unavailable');
          if (provider === AIProvider.OPENROUTER) {
            return record(provider, 'openrouter/auto', startedAt, 'catalog');
          }

          const predicates: Array<(candidate: string) => boolean> = provider === AIProvider.DEEPSEEK
            ? [candidate => candidate.startsWith('deepseek/')]
            : provider === AIProvider.GROK
              ? [candidate => candidate.startsWith('x-ai/')]
              : provider === AIProvider.KIMI
                ? [candidate => candidate.startsWith('moonshotai/')]
                : provider === AIProvider.QWEN
                  ? [candidate => candidate.startsWith('qwen/')]
                  : provider === AIProvider.GPT5_MINI
                    ? [candidate => /^openai\/gpt-5/i.test(candidate), candidate => candidate.startsWith('openai/')]
                    : [candidate => catalog.has(candidate)];

          const resolved = chooseCatalogModel(catalog, model, predicates);
          return record(
            provider,
            resolved || model,
            startedAt,
            resolved ? 'catalog' : 'degraded',
            resolved ? undefined : `no live capability-compatible OpenRouter model for ${provider}`,
          );
        }

        if (provider === AIProvider.GEMINI) {
          const key = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
          if (!key) return record(provider, model, startedAt, 'degraded', 'not configured');
          const catalog = await fetchCatalog(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=100`,
            {},
            payload => (payload?.models || [])
              .filter((item: any) => item?.supportedGenerationMethods?.includes('generateContent'))
              .map((item: any) => item?.name),
          );
          // Recovery must use a live text-capable Flash model, never a guessed ID
          // or an image/audio/preview route. Try at most one alternate per task.
          const supportedFreeFlash = ['gemini-3.8-flash', 'gemini-3.1-pro-preview'];
          recoveryModels.set(provider, supportedFreeFlash.filter(candidate => catalog.has(candidate)));
          const resolved = chooseCatalogModel(catalog, model, [
            candidate => supportedFreeFlash.includes(candidate),
          ]);
          return record(provider, resolved || model, startedAt, resolved ? 'catalog' : 'degraded', resolved ? undefined : 'no live compatible Gemini model');
        }

        if (provider === AIProvider.CLAUDE || provider === AIProvider.CLAUDE_OPUS) {
          const key = process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_API_KEY?.trim();
          if (!key) return record(provider, model, startedAt, 'degraded', 'not configured');
          const catalog = await fetchCatalog(
            'https://api.anthropic.com/v1/models?limit=100',
            { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
            payload => (payload?.data || []).map((item: any) => item?.id),
          );
          const wantsOpus = provider === AIProvider.CLAUDE_OPUS;
          const resolved = chooseCatalogModel(catalog, model, [
            candidate => wantsOpus ? /opus/i.test(candidate) : /sonnet/i.test(candidate),
            candidate => /claude/i.test(candidate),
          ]);
          if (!resolved) {
            return record(provider, model, startedAt, 'degraded', 'no live compatible Anthropic model');
          }

          // Startup is catalog-only. Never spend an inference call to prove
          // readiness; the first inference must belong to real user work.
          return record(provider, resolved, startedAt, 'catalog');
        }

        if (provider === AIProvider.MISTRAL) {
          const key = process.env.MISTRAL_API_KEY?.trim();
          if (!key) return record(provider, model, startedAt, 'degraded', 'not configured');
          const catalog = await fetchCatalog(
            'https://api.mistral.ai/v1/models',
            { Authorization: `Bearer ${key}` },
            payload => (payload?.data || []).map((item: any) => item?.id),
          );
          const resolved = chooseCatalogModel(catalog, model, [
            candidate => /mistral.*small/i.test(candidate),
            candidate => /mistral/i.test(candidate) && !/embed|moderation/i.test(candidate),
          ]);
          return record(provider, resolved || model, startedAt, resolved ? 'catalog' : 'degraded', resolved ? undefined : 'no live compatible Mistral model');
        }

        const openAICompatible: Partial<Record<AIProvider, { url: string; key?: string }>> = {
          [AIProvider.TOGETHER]: { url: 'https://api.together.xyz/v1/models', key: process.env.TOGETHER_API_KEY?.trim() },
          [AIProvider.COHERE]: { url: 'https://api.cohere.com/v1/models?endpoint=chat&page_size=100', key: process.env.COHERE_API_KEY?.trim() },
          [AIProvider.XAI]: { url: 'https://api.x.ai/v1/models', key: process.env.XAI_API_KEY?.trim() },
          [AIProvider.FIREWORKS]: { url: 'https://api.fireworks.ai/inference/v1/models', key: process.env.FIREWORKS_API_KEY?.trim() },
        };

        const config = openAICompatible[provider];
        if (config?.key) {
          const catalog = await fetchCatalog(
            config.url,
            { Authorization: `Bearer ${config.key}` },
            payload => (Array.isArray(payload) ? payload : (payload?.data || payload?.models || []))
              .map((item: any) => item?.id || item?.name),
          );
          const resolved = chooseCatalogModel(catalog, model, [
            candidate => provider === AIProvider.XAI ? /grok/i.test(candidate) : false,
            candidate => provider === AIProvider.FIREWORKS ? /gpt-oss|llama|qwen|mistral/i.test(candidate) : false,
            candidate => /gpt-oss|command|mistral|llama|qwen|grok/i.test(candidate),
            () => true,
          ]);
          return record(provider, resolved || model, startedAt, resolved ? 'catalog' : 'degraded', resolved ? undefined : 'no live compatible model in provider catalog');
        }

        return record(provider, model, startedAt, 'unknown');
      } catch (error) {
        return record(provider, model, startedAt, 'degraded', error instanceof Error ? error.message : String(error));
      }
    });

    return Promise.all(checks);
  })();

  try {
    return await warmupInFlight;
  } finally {
    warmupInFlight = null;
  }
}
