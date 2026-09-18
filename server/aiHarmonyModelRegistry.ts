import { AIProvider } from './aiTokenGovernor';

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
  huggingFace: process.env.HUGGINGFACE_MODEL?.trim() || 'openai/gpt-oss-120b:fastest',
  cerebras: process.env.CEREBRAS_MODEL?.trim() || 'gpt-oss-120b',
  sambaNova: process.env.SAMBANOVA_MODEL?.trim() || 'MiniMax-M3',
  cohere: process.env.COHERE_MODEL?.trim() || 'command-a-plus-05-2026',
  cohereViaHuggingFace: process.env.COHERE_HF_MODEL?.trim() || 'CohereLabs/command-a-plus-05-2026-w4a4:cohere',
  together: process.env.TOGETHER_MODEL?.trim() || 'openai/gpt-oss-120b',
  togetherViaHuggingFace: process.env.TOGETHER_HF_MODEL?.trim() || 'openai/gpt-oss-120b:together',
} as const;

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
    provider: AIProvider.GEMINI,
    model: CURRENT_AI_MODELS.gemini,
    capabilities: ['fast-chat', 'research', 'long-context', 'multimodal', 'agentic', 'structured-output'],
    configured: () => !!(process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim()),
  },
  {
    provider: AIProvider.CLAUDE,
    model: CURRENT_AI_MODELS.claudeBalanced,
    capabilities: ['legal-analysis', 'deep-reasoning', 'verification', 'long-context', 'coding', 'agentic'],
    configured: () => !!(process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_API_KEY?.trim()),
  },
  {
    provider: AIProvider.CLAUDE_OPUS,
    model: CURRENT_AI_MODELS.claudeDeep,
    capabilities: ['legal-analysis', 'deep-reasoning', 'verification', 'long-context', 'coding', 'agentic'],
    configured: () => !!(process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_API_KEY?.trim()),
  },
  {
    provider: AIProvider.GROQ,
    model: CURRENT_AI_MODELS.groqDeep,
    capabilities: ['fast-chat', 'deep-reasoning', 'coding', 'structured-output'],
    configured: () => !!process.env.GROQ_API_KEY?.trim(),
  },
  {
    provider: AIProvider.MISTRAL,
    model: CURRENT_AI_MODELS.mistralFast,
    capabilities: ['fast-chat', 'coding', 'agentic', 'multimodal', 'structured-output'],
    configured: () => !!process.env.MISTRAL_API_KEY?.trim(),
  },
  {
    provider: AIProvider.DEEPSEEK,
    model: CURRENT_AI_MODELS.deepseek,
    capabilities: ['deep-reasoning', 'coding', 'agentic', 'long-context', 'multimodal'],
    configured: () => !!process.env.OPENROUTER_API_KEY?.trim(),
  },
  {
    provider: AIProvider.GROK,
    model: CURRENT_AI_MODELS.grok,
    capabilities: ['deep-reasoning', 'coding', 'research', 'multimodal', 'agentic'],
    configured: () => !!process.env.OPENROUTER_API_KEY?.trim(),
  },
  {
    provider: AIProvider.KIMI,
    model: CURRENT_AI_MODELS.kimi,
    capabilities: ['deep-reasoning', 'coding', 'long-context', 'multimodal', 'agentic'],
    configured: () => !!process.env.OPENROUTER_API_KEY?.trim(),
  },
  {
    provider: AIProvider.QWEN,
    model: CURRENT_AI_MODELS.qwen,
    capabilities: ['deep-reasoning', 'coding', 'long-context', 'multimodal', 'agentic', 'structured-output'],
    configured: () => !!process.env.OPENROUTER_API_KEY?.trim(),
  },
  {
    provider: AIProvider.GPT5_MINI,
    model: CURRENT_AI_MODELS.openaiFastViaOpenRouter,
    capabilities: ['fast-chat', 'legal-analysis', 'coding', 'structured-output', 'agentic'],
    configured: () => !!process.env.OPENROUTER_API_KEY?.trim(),
  },
  {
    provider: AIProvider.GPT_OSS,
    model: CURRENT_AI_MODELS.gptOss,
    capabilities: ['fast-chat', 'deep-reasoning', 'coding', 'structured-output'],
    configured: () => !!(process.env.GROQ_API_KEY?.trim() || process.env.CEREBRAS_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim()),
  },
  {
    provider: AIProvider.OPENROUTER,
    model: CURRENT_AI_MODELS.openRouterAuto,
    capabilities: ['fast-chat', 'deep-reasoning', 'legal-analysis', 'research', 'coding', 'long-context', 'multimodal', 'agentic'],
    configured: () => !!process.env.OPENROUTER_API_KEY?.trim(),
  },
  {
    provider: AIProvider.HUGGINGFACE,
    model: CURRENT_AI_MODELS.huggingFace,
    capabilities: ['deep-reasoning', 'coding', 'structured-output'],
    configured: () => !!(process.env.HUGGINGFACE_API_TOKEN?.trim() || process.env.HUGGINGFACE_API_KEY?.trim()),
  },
  {
    provider: AIProvider.CEREBRAS,
    model: CURRENT_AI_MODELS.cerebras,
    capabilities: ['fast-chat', 'deep-reasoning', 'coding', 'structured-output'],
    configured: () => !!process.env.CEREBRAS_API_KEY?.trim(),
  },
  {
    provider: AIProvider.SAMBANOVA,
    model: CURRENT_AI_MODELS.sambaNova,
    capabilities: ['fast-chat', 'deep-reasoning', 'coding', 'multimodal'],
    configured: () => !!process.env.SAMBANOVA_API_KEY?.trim(),
  },
  {
    provider: AIProvider.COHERE,
    model: CURRENT_AI_MODELS.cohere,
    capabilities: ['legal-analysis', 'verification', 'research', 'multimodal', 'agentic', 'structured-output'],
    configured: () => !!(
      process.env.COHERE_API_KEY?.trim()
      || process.env.HUGGINGFACE_API_TOKEN?.trim()
      || process.env.HUGGINGFACE_API_KEY?.trim()
    ),
  },
  {
    provider: AIProvider.TOGETHER,
    model: CURRENT_AI_MODELS.together,
    capabilities: ['deep-reasoning', 'coding', 'agentic'],
    configured: () => !!(
      process.env.TOGETHER_API_KEY?.trim()
      || process.env.HUGGINGFACE_API_TOKEN?.trim()
      || process.env.HUGGINGFACE_API_KEY?.trim()
    ),
  },
] as const;


if (HARMONY_17_PARTICIPANTS.length !== 17) {
  throw new Error(`Harmony registry invariant violated: expected 17 participants, found ${HARMONY_17_PARTICIPANTS.length}`);
}

const LEGACY_MODEL_ALIASES: Partial<Record<AIProvider, string>> = {
  [AIProvider.FALCON]: CURRENT_AI_MODELS.gptOss,
  [AIProvider.CODE_LLAMA]: CURRENT_AI_MODELS.qwen,
  [AIProvider.GPT_NEOX]: CURRENT_AI_MODELS.gptOss,
  [AIProvider.PERPLEXITY]: CURRENT_AI_MODELS.openRouterAuto,
  [AIProvider.FIREWORKS]: CURRENT_AI_MODELS.openRouterAuto,
};

export function getConfiguredHarmonyParticipants(): HarmonyParticipant[] {
  return HARMONY_17_PARTICIPANTS.filter(participant => participant.configured());
}

export function getConfiguredHarmonyProviders(): AIProvider[] {
  return getConfiguredHarmonyParticipants().map(participant => participant.provider);
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
    case AIProvider.DEEPSEEK: return CURRENT_AI_MODELS.deepseek;
    case AIProvider.GROK: return CURRENT_AI_MODELS.grok;
    case AIProvider.KIMI: return CURRENT_AI_MODELS.kimi;
    case AIProvider.QWEN: return CURRENT_AI_MODELS.qwen;
    case AIProvider.GPT5_MINI: return CURRENT_AI_MODELS.openaiFastViaOpenRouter;
    case AIProvider.OPENROUTER: return CURRENT_AI_MODELS.openRouterAuto;
    case AIProvider.FALCON:
    case AIProvider.CODE_LLAMA:
    case AIProvider.GPT_NEOX:
    case AIProvider.PERPLEXITY:
    case AIProvider.FIREWORKS:
      return getCurrentModelForProvider(provider);
    default:
      return null;
  }
}
