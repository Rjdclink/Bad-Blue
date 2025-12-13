/**
 * LEXARA VOICE FORGE - Module Index
 * 
 * Exports the complete Voice Forge system for Monte Carlo voice optimization
 * including the ElevenLabs Oracle dataset generator script
 */

export * from './LexaraVoiceForge';
export { default as lexaraVoiceForge } from './LexaraVoiceForge';
export { LexaraPersonaRewriter } from './LexaraVoiceForge';

// Voice Forge Script - ElevenLabs Oracle Dataset Generator
export {
  generateLexaraOracleDataset,
  exportVoiceDatasetAsText,
  forgeVoiceProfileFromDataset,
  generateVoiceDataset,
  IDENTITY_PHRASES,
  CONSULTATION_OPENINGS,
  ANALYSIS_PHRASES,
  DISCLAIMER_PHRASES,
  GRAVITAS_PHRASES,
  YOUTHFUL_PHRASES,
} from './LexaraVoiceForgeScript';
