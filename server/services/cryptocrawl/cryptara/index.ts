/**
 * CRYPTARA MODULE - Stage-Gated AI Strategist
 * 
 * This module provides AI-powered market analysis with strict isolation:
 * - Analysis ONLY (no execution authority)
 * - Stage-gated activation (Stage 8+)
 * - Non-binding outputs
 * - No background loops or timers
 * 
 * Activation Stages:
 * - Stage 8: Analysis mode (dry run assistance)
 * - Stage 9+: Surveillance mode (after 10 stable cycles)
 */

export {
  CryptaraController,
  cryptaraController,
  CryptaraMode,
  type CryptaraAnalysis,
  type CryptaraMetrics,
} from './cryptara-controller';

/**
 * Initialize Cryptara (stage-aware)
 */
export async function initializeCryptara(): Promise<void> {
  const { cryptaraController } = await import('./cryptara-controller');
  await cryptaraController.initialize();
}
