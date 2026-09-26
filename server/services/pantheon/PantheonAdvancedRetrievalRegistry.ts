export type PantheonChallengeProvider = 'capsolver' | 'capmonster' | 'sadcaptcha';

export interface PantheonChallengeProviderReadiness {
  id: PantheonChallengeProvider;
  configured: boolean;
  purpose: string;
}

export interface PantheonAdvancedRetrievalReadiness {
  challengeProviders: PantheonChallengeProviderReadiness[];
  browserCapabilities: Array<{ id: 'botright' | 'scrapling' | 'spydra'; configured: boolean; purpose: string }>;
}

function present(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

/**
 * Capability/readiness registry only. Challenge providers are available to an
 * explicitly authorized challenge workflow; this module does not bypass or
 * weaken a target site's access controls.
 */
export function getPantheonAdvancedRetrievalReadiness(): PantheonAdvancedRetrievalReadiness {
  return {
    challengeProviders: [
      { id: 'capsolver', configured: present('CAPSOLVER_API_KEY'), purpose: 'authorized challenge workflow' },
      { id: 'capmonster', configured: present('CAPMONSTER_API_KEY'), purpose: 'authorized challenge workflow' },
      { id: 'sadcaptcha', configured: present('SADCAPTCHA_API_KEY'), purpose: 'authorized specialized challenge workflow' },
    ],
    browserCapabilities: [
      { id: 'botright', configured: present('BOTRIGHT_SERVICE_URL'), purpose: 'browser rendering/automation' },
      { id: 'scrapling', configured: present('SCRAPLING_SERVICE_URL'), purpose: 'dynamic-page retrieval and extraction' },
      { id: 'spydra', configured: present('SPYDRA_SERVICE_URL'), purpose: 'distributed crawling and extraction' },
    ],
  };
}

export function configuredPantheonBrowserRetrievalServices(): string[] {
  return getPantheonAdvancedRetrievalReadiness().browserCapabilities
    .filter(item => item.configured)
    .map(item => item.id);
}
