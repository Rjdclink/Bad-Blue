import { AIProvider } from './aiTokenGovernor';
import { getConfiguredHarmonyProviders } from './aiHarmonyModelRegistry';
import { getHarmonyWarmStatus } from './aiHarmonyWarmup';

let started = false;

/**
 * Non-inference support readiness snapshot.
 * Startup must never spend a metered Claude, Gemini, or xAI inference call.
 */
export async function verifyLegalSupportReadiness(): Promise<void> {
  if (started) return;
  started = true;

  const configured = new Set(getConfiguredHarmonyProviders('legalwhat'));
  const warm = new Map(getHarmonyWarmStatus().map(status => [status.provider, status]));

  for (const provider of [AIProvider.GEMINI, AIProvider.XAI]) {
    if (!configured.has(provider)) continue;
    const status = warm.get(provider);
    console.info('[LEXARA SupportReadiness]', {
      provider,
      model: status?.model,
      inferenceVerified: false,
      catalogState: status?.state || 'unknown',
      reason: 'Startup is catalog-only; inference is reserved for real user work',
    });
  }
}
