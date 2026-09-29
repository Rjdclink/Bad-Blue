import type { AIProvider } from './aiTokenGovernor';

const asProvider = (value: string): AIProvider => value as AIProvider;

const PROVIDER = {
  GEMINI: asProvider('gemini'),
  GROQ: asProvider('groq'),
  MISTRAL: asProvider('mistral'),
  CLAUDE: asProvider('claude'),
  OPENAI: asProvider('openai'),
  DEEPSEEK: asProvider('deepseek'),
  GROK: asProvider('grok'),
  KIMI: asProvider('kimi'),
  GPT_OSS: asProvider('gpt_oss'),
  FALCON: asProvider('falcon'),
  CODE_LLAMA: asProvider('code_llama'),
  GPT_NEOX: asProvider('gpt_neox'),
  QWEN: asProvider('qwen'),
  GPT5_MINI: asProvider('gpt5_mini'),
  CLAUDE_OPUS: asProvider('claude_opus'),
  OPENROUTER: asProvider('openrouter'),
  XAI: asProvider('xai'),
  LMAI: asProvider('lmai'),
  COHERE: asProvider('cohere'),
  TOGETHER: asProvider('together'),
  PERPLEXITY: asProvider('perplexity'),
  FIREWORKS: asProvider('fireworks'),
  CEREBRAS: asProvider('cerebras'),
  CLOUDFLARE: asProvider('cloudflare'),
} as const;

/**
 * Canonical current-model registry for the platform-wide Harmony mesh.
 *
 * Provider/model selection is capability-driven. These are current defaults,
 * not a hard priority order; environment overrides remain authoritative.
 */
export const CURRENT_AI_MODELS = {
  gemini: process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash',
  claudeFast: process.env.CLAUDE_FAST_MODEL?.trim() || 'claude-haiku-4-5-20251001',
  claudeBalanced: process.env.CLAUDE_MODEL?.trim() || 'claude-sonnet-5',
  claudeDeep: process.env.CLAUDE_OPUS_MODEL?.trim() || 'claude-opus-5',
  groqFast: process.env.GROQ_FAST_MODEL?.trim() || 'openai/gpt-oss-20b',
  groqDeep: process.env.GROQ_CHAT_MODEL?.trim() || process.env.GROQ_MODEL?.trim() || 'openai/gpt-oss-120b',
  mistralFast: process.env.MISTRAL_MODEL?.trim() || 'mistral-small-2603',
  mistralDeep: process.env.MISTRAL_DEEP_MODEL?.trim() || 'mistral-medium-3-5',
  deepseek: process.env.DEEPSEEK_MODEL?.trim() || 'deepseek/deepseek-v4.1-flash',
  grok: process.env.GROK_MODEL?.trim() || 'x-ai/grok-4.6',
  kimi: process.env.KIMI_MODEL?.trim() || 'moonshotai/kimi-k3',
  qwen: process.env.QWEN_MODEL?.trim() || 'qwen/qwen3.8-max-0902',
  openaiFastViaOpenRouter: process.env.OPENAI_FAST_MODEL?.trim() || 'openai/gpt-5.6-luna',
  gptOss: process.env.GPT_OSS_MODEL?.trim() || 'openai/gpt-oss-120b',
  openRouterAuto: process.env.OPENROUTER_MODEL?.trim() || 'openrouter/auto',
  xai: process.env.XAI_MODEL?.trim() || 'grok-4.7',
  cerebras: process.env.CEREBRAS_MODEL?.trim() || 'gpt-oss-120b',
  cloudflare: process.env.CLOUDFLARE_AI_MODEL?.trim() || '@cf/openai/gpt-oss-120b',
  fireworks: process.env.FIREWORKS_MODEL?.trim() || 'accounts/fireworks/models/gpt-oss-120b',
  cohere: process.env.COHERE_MODEL?.trim() || 'command-a-plus-05-2026',
  together: process.env.TOGETHER_MODEL?.trim() || 'openai/gpt-oss-120b',
} as const;


/** Legal-scoped models. The wider Harmony registry remains unchanged. */
export const LEGAL_AI_MODELS = {
  claudeFast: 'claude-sonnet-5', claudeDeep: 'claude-opus-5-5',
  geminiFast: 'gemini-3.8-flash', geminiDeep: 'gemini-3.8-flash',
  xaiFast: 'grok-4.7', xaiDeep: 'grok-4.7', xaiAlternate: 'grok-4.6',
} as const;
export function isCurrentLegalModel(provider: AIProvider, model: string): boolean {
  const company = provider === PROVIDER.CLAUDE_OPUS ? 'claude' : provider;
  return Object.entries(LEGAL_AI_MODELS).some(([key, value]) => key.startsWith(company) && value === model);
}

export type HarmonyCapability =
  | 'fast-chat'
  | 'deep-reasoning'
  | 'legal-analysis'
  | 'verification'
  | 'coding'
  | 'research'
  | 'long-context'
  | 'multimodal'
  | 'structured-output'
  | 'agentic';

export interface HarmonyParticipant {
  provider: AIProvider;
  model: string;
  capabilities: readonly HarmonyCapability[];
  configured: () => boolean;
}

/**
 * The 17 canonical logical participants in the Harmony mesh. A participant can
 * share transport with another participant (for example several specialist
 * model families use OpenRouter), but each retains distinct capability scoring.
 */
export const HARMONY_17_PARTICIPANTS: readonly HarmonyParticipant[] = [
  {
    provider: PROVIDER.CLAUDE,
    model: CURRENT_AI_MODELS.claudeBalanced,
    capabilities: ['legal-analysis', 'deep-reasoning', 'verification', 'long-context', 'coding', 'agentic'],
    configured: () => !!(process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_API_KEY?.trim()),
  },
  {
    provider: PROVIDER.GEMINI,
    model: CURRENT_AI_MODELS.gemini,
    capabilities: ['fast-chat', 'research', 'long-context', 'multimodal', 'agentic', 'structured-output'],
    configured: () => !!(process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim()),
  },
  {
    provider: PROVIDER.XAI,
    model: CURRENT_AI_MODELS.xai,
    capabilities: ['fast-chat', 'deep-reasoning', 'legal-analysis', 'verification', 'coding', 'research', 'multimodal', 'agentic', 'structured-output'],
    configured: () => !!process.env.XAI_API_KEY?.trim(),
  },
] as const;


const LEGACY_MODEL_ALIASES: Partial<Record<AIProvider, string>> = {
  [PROVIDER.FALCON]: CURRENT_AI_MODELS.gptOss,
  [PROVIDER.CODE_LLAMA]: CURRENT_AI_MODELS.qwen,
  [PROVIDER.GPT_NEOX]: CURRENT_AI_MODELS.gptOss,
  [PROVIDER.PERPLEXITY]: CURRENT_AI_MODELS.openRouterAuto,
};

export type HarmonyProviderPolicy = 'default' | 'capability-first' | 'capability-first-no-google' | 'legalwhat';

/** Resolve the independent transport for the GPT OSS alias without a gateway. */
export function getDirectGptOssProvider(): AIProvider | null {
  if (process.env.GROQ_API_KEY?.trim()) return PROVIDER.GROQ;
  return null;
}

/** LegalWhat membership is enforced here, alongside the canonical model registry. */
export function isHarmonyProviderAllowed(
  provider: AIProvider,
  policy: HarmonyProviderPolicy = 'capability-first',
): boolean {
  // Platform-wide inference authority is intentionally limited to the three
  // independently authenticated providers retained by LegalWhat.
  return [PROVIDER.CLAUDE, PROVIDER.GEMINI, PROVIDER.XAI].includes(provider);
}

export function getConfiguredHarmonyParticipants(
  policy: HarmonyProviderPolicy = 'capability-first',
): HarmonyParticipant[] {
  return HARMONY_17_PARTICIPANTS.filter(participant =>
    participant.configured() && isHarmonyProviderAllowed(participant.provider, policy));
}

export function getConfiguredHarmonyProviders(
  policy: HarmonyProviderPolicy = 'capability-first',
): AIProvider[] {
  return getConfiguredHarmonyParticipants(policy).map(participant => participant.provider);
}

export function getCurrentModelForProvider(provider: AIProvider): string {
  const participant = HARMONY_17_PARTICIPANTS.find(item => item.provider === provider);
  if (participant) return participant.model;
  return LEGACY_MODEL_ALIASES[provider] || CURRENT_AI_MODELS.openRouterAuto;
}

export function getHarmonyCapabilities(provider: AIProvider): readonly HarmonyCapability[] {
  return HARMONY_17_PARTICIPANTS.find(item => item.provider === provider)?.capabilities || [];
}

export function getOpenRouterModelForProvider(provider: AIProvider): string | null {
  switch (provider) {
    case PROVIDER.DEEPSEEK: return CURRENT_AI_MODELS.deepseek;
    case PROVIDER.GROK: return CURRENT_AI_MODELS.grok;
    case PROVIDER.KIMI: return CURRENT_AI_MODELS.kimi;
    case PROVIDER.QWEN: return CURRENT_AI_MODELS.qwen;
    case PROVIDER.GPT5_MINI: return CURRENT_AI_MODELS.openaiFastViaOpenRouter;
    case PROVIDER.OPENROUTER: return CURRENT_AI_MODELS.openRouterAuto;
    case PROVIDER.FALCON:
    case PROVIDER.CODE_LLAMA:
    case PROVIDER.GPT_NEOX:
    case PROVIDER.PERPLEXITY:
      return getCurrentModelForProvider(provider);
    default:
      return null;
  }
}
