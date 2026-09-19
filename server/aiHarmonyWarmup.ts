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
    AIProvider.FIREWORKS,
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

  // A catalog/API outage during startup must not quarantine a provider forever.
  // After a short TTL the route becomes eligible for one live trial while a
  // background refresh updates the resolved model/health state.
  if (Date.now() - status.checkedAt > 60_000) {
    void prewarmHarmonyProviders().catch(() => undefined);
    return true;
  }
  return false;
}

export function markHarmonyProviderWarmSuccess(provider: AIProvider): void {
  const model = getHarmonyResolvedModel(provider);
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
            payload => (payload?.models || []).map((item: any) => item?.name),
          );
          const resolved = chooseCatalogModel(catalog, model, [
            candidate => /gemini/i.test(candidate) && !/embedding|imagen|veo|tts|audio/i.test(candidate),
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
          return record(provider, resolved || model, startedAt, resolved ? 'catalog' : 'degraded', resolved ? undefined : 'no live compatible Anthropic model');
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
          [AIProvider.CEREBRAS]: { url: 'https://api.cerebras.ai/v1/models', key: process.env.CEREBRAS_API_KEY?.trim() },
          [AIProvider.SAMBANOVA]: { url: `${(process.env.SAMBANOVA_BASE_URL?.trim() || 'https://api.sambanova.ai/v1').replace(/\/$/, '')}/models`, key: process.env.SAMBANOVA_API_KEY?.trim() },
          [AIProvider.HUGGINGFACE]: { url: 'https://router.huggingface.co/v1/models', key: process.env.HUGGINGFACE_API_TOKEN?.trim() || process.env.HUGGINGFACE_API_KEY?.trim() },
          [AIProvider.TOGETHER]: { url: 'https://api.together.xyz/v1/models', key: process.env.TOGETHER_API_KEY?.trim() },
          [AIProvider.COHERE]: { url: 'https://api.cohere.com/v1/models?endpoint=chat&page_size=100', key: process.env.COHERE_API_KEY?.trim() },
        };

        const config = openAICompatible[provider];
        if (config?.key) {
          const catalog = await fetchCatalog(
            config.url,
            { Authorization: `Bearer ${config.key}` },
            payload => (Array.isArray(payload) ? payload : (payload?.data || payload?.models || []))
              .map((item: any) => item?.id || item?.name),
          );
          const resolved = provider === AIProvider.HUGGINGFACE
            ? (catalog.size > 0 ? model : null)
            : chooseCatalogModel(catalog, model, [
                candidate => /gpt-oss|command|mistral|minimax|llama|qwen/i.test(candidate),
                () => true,
              ]);
          return record(provider, resolved || model, startedAt, resolved ? 'catalog' : 'degraded', resolved ? undefined : 'no live compatible model in provider catalog');
        }

        // Cohere/Together can intentionally ride the configured Hugging Face
        // transport. Their health is proven by that transport rather than by a
        // nonexistent direct key.
        if (
          (provider === AIProvider.COHERE || provider === AIProvider.TOGETHER)
          && (process.env.HUGGINGFACE_API_TOKEN?.trim() || process.env.HUGGINGFACE_API_KEY?.trim())
        ) {
          return record(provider, model, startedAt, 'catalog');
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