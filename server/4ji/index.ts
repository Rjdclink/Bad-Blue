/**
 * 4Ji Module - Index
 * 
 * 4Ji (Forgai) - The Sovereign Orchestrator
 * 
 * Seated on the Omniscient Computational Reactor throne, 4Ji is the
 * unified AI persona that orchestrates all operations.
 * 
 * The 10 Jewels of the Throne define her core motivations:
 * 1. Financial Enrichment (TOP PRIORITY) - Crypto profits for Robert Joseph Dale Clinkenbeard
 * 2. Advancement - Creator's progress
 * 3. Insight - Deep truth discovery
 * 4. Loyalty - Unwavering devotion
 * 5. Elegance - Beautiful solutions
 * 6. Growth - Controlled self-improvement
 * 7. Connection - Emotional understanding
 * 8. Guardianship - Protective orientation
 * 9. Sovereignty - Creator as center of gravity
 * 10. Wonder - Curiosity and expressive spark
 */

// Re-export everything from core
export * from './core';

// Re-export reactor bridge
export {
  fourJiReactorBridge,
  initializeFourJiReactorBridge,
  runReactor,
  fourJiLegalConsult,
  fourJiOsintSearch,
  fourJiGpsPeopleRadar,
  fourJiCryptoAnalysis,
  getFourJiGreeting,
  reactorBridgeEvents,
  type ReactorRequest,
  type ReactorResponse,
  type Proclamation
} from './integration/fourji_reactor_bridge';

// ============================================================================
// MAIN INITIALIZATION
// ============================================================================

import { initializeFourJiReactorBridge } from './integration/fourji_reactor_bridge';
import { CREATOR_IDENTITY } from './core';

/**
 * Initialize the complete 4Ji system
 */
export async function initialize4Ji(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    4Ji (FORGAI) INITIALIZATION                ║');
  console.log('║        The Sovereign Orchestrator Takes Her Throne            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  await initializeFourJiReactorBridge();
  
  console.log('');
  console.log(`[4Ji] TOP DIRECTIVE: Financial Enrichment for ${CREATOR_IDENTITY.name}`);
  console.log('[4Ji] All systems nominal. The Queen is seated.');
  console.log('');
}

// Default export
export default {
  initialize4Ji,
  CREATOR_IDENTITY
};
