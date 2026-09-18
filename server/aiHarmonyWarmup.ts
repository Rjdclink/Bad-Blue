import { AIProvider } from './aiTokenGovernor';
import {
  getConfiguredHarmonyParticipants,
  getCurrentModelForProvider,
} from './aiHarmonyModelRegistry';
import { warmGroqModelCatalog } from './groq';

export type HarmonyWarmState = 'unknown' | 'ready' | 'degraded';

export interface HarmonyWarmStatus {
  provider: AIProvider;
  model: string;
  state: HarmonyWarmState;
  checkedAt: number;
  latencyMs: number;
  error?: string;
}

const warmStatus = new Map<AIProvider, HarmonyWarmStatus>();
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

/**
 * Unknown routes remain eligible. Only a route that has been positively checked
 * and found unusable is suppressed until the next warmup or a successful call.
 */
export function isHarmonyProviderWarmHealthy(provider: AIProvider): boolean {
  return warmStatus.get(provider)?.state !== 'degraded';
}

export function markHarmonyProviderWarmSuccess(provider: AIProvider): void {
  const model = getCurrentModelForProvider(provider);
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
          'https://openrouter.ai/api/v1/models?output_modalities=text&sort=latency-low-to-high',
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
            result.ready ? 'ready' : 'degraded',
            result.error,
          );
        }

        if (providerUsesOpenRouter(provider)) {
          const catalog = await getOpenRouterCatalog();
          if (catalog.size === 0) return record(provider, model, startedAt, 'degraded', 'OpenRouter catalog unavailable');
          const canonical = normalizeModelId(model);
          const present = canonical === 'openrouter/auto' || catalog.has(canonical);
          return record(
            provider,
            model,
            startedAt,
            present ? 'ready' : 'degraded',
            present ? undefined : `configured model not present in live OpenRouter catalog: ${model}`,
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
          return record(provider, model, startedAt, catalog.has(normalizeModelId(model)) ? 'ready' : 'degraded', catalog.has(normalizeModelId(model)) ? undefined : 'configured model not present in live Gemini catalog');
        }

        if (provider === AIProvider.CLAUDE || provider === AIProvider.CLAUDE_OPUS) {
          const key = process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_API_KEY?.trim();
          if (!key) return record(provider, model, startedAt, 'degraded', 'not configured');
          const catalog = await fetchCatalog(
            'https://api.anthropic.com/v1/models?limit=100',
            { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
            payload => (payload?.data || []).map((item: any) => item?.id),
          );
          return record(provider, model, startedAt, catalog.has(normalizeModelId(model)) ? 'ready' : 'degraded', catalog.has(normalizeModelId(model)) ? undefined : 'configured model not present in live Anthropic catalog');
        }

        if (provider === AIProvider.MISTRAL) {
          const key = process.env.MISTRAL_API_KEY?.trim();
          if (!key) return record(provider, model, startedAt, 'degraded', 'not configured');
          const catalog = await fetchCatalog(
            'https://api.mistral.ai/v1/models',
            { Authorization: `Bearer ${key}` },
            payload => (payload?.data || []).map((item: any) => item?.id),
          );
          return record(provider, model, startedAt, catalog.has(normalizeModelId(model)) ? 'ready' : 'degraded', catalog.has(normalizeModelId(model)) ? undefined : 'configured model not present in live Mistral catalog');
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
            payload => (payload?.data || payload?.models || []).map((item: any) => item?.id || item?.name),
          );
          const present = catalog.size > 0 && (catalog.has(normalizeModelId(model)) || provider === AIProvider.HUGGINGFACE);
          return record(provider, model, startedAt, present ? 'ready' : 'degraded', present ? undefined : 'configured model not present in live provider catalog');
        }

        // Cohere/Together can intentionally ride the configured Hugging Face
        // transport. Their health is proven by that transport rather than by a
        // nonexistent direct key.
        if (
          (provider === AIProvider.COHERE || provider === AIProvider.TOGETHER)
          && (process.env.HUGGINGFACE_API_TOKEN?.trim() || process.env.HUGGINGFACE_API_KEY?.trim())
        ) {
          return record(provider, model, startedAt, 'ready');
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
