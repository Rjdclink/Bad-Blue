import { AIProvider, UsageContext } from './aiTokenGovernor';
import { TaskComplexity, TaskPriority } from './aiModelSelector';
import { getConfiguredHarmonyProviders } from './aiHarmonyModelRegistry';
import { AICollaborationOrchestrator } from './aiCollaborationOrchestrator';

let started = false;
/** One small synthetic request per support route per process, never user facts. */
export async function verifyLegalSupportReadiness(): Promise<void> {
  if (started) return;
  started = true;
  const configured = getConfiguredHarmonyProviders('legalwhat');
  // Sequential because DeepSeek and Kimi share an OpenRouter account.
  for (const provider of [AIProvider.GROQ, AIProvider.DEEPSEEK, AIProvider.KIMI]) {
    if (!configured.includes(provider)) continue;
    try {
      const result = await AICollaborationOrchestrator.orchestrateCollaboration(
        'legal-support-readiness', 'Reply with the single word READY.',
        { context: UsageContext.USER, complexity: TaskComplexity.LIGHTWEIGHT,
          priority: TaskPriority.HIGH, needsFastResponse: true, estimatedTokens: 512 },
        [provider], { providerPolicy: 'legalwhat', maxParticipants: 1,
          maxFallbacks: 0, requestTimeoutMs: 15000 },
      );
      const successful = result.contributions.find(item => item.provider === provider && item.success && item.content.trim());
      console.info('[LEXARA SupportReadiness]', {
        provider, model: successful?.model, inferenceVerified: Boolean(successful),
        reason: successful ? undefined : 'No successful inference; inspect provider route failure',
      });
    } catch (error) {
      console.warn('[LEXARA SupportReadiness]', { provider, inferenceVerified: false,
        reason: error instanceof Error ? error.message : 'Readiness failed' });
    }
  }
}
