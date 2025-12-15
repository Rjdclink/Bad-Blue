/**
 * SIGNALS MODULE - Signal & Intelligence Layer
 * 
 * This module provides the signal generation and aggregation layer:
 * - Faucet: Single-source signal emitter (stateless)
 * - Faucet Mesh: Multiple faucets coordination
 * - Signal types: Trade, Spread, Momentum, Imbalance, Volatility
 * 
 * HARD RULES:
 * - Stateless design
 * - No execution authority
 * - Pure signal enrichment
 */

// Faucet
export {
  Faucet,
  primaryFaucet,
  SignalType,
  type Signal,
  type FaucetMetrics,
} from './faucet';

// Faucet Mesh
export {
  FaucetMesh,
  faucetMesh,
  type MeshNode,
  type AggregatedSignal,
  type MeshMetrics,
} from './faucet-mesh';

/**
 * Initialize signal layer
 */
export async function initializeSignals(): Promise<void> {
  console.log('[Signals] 📡 Initializing Signal Layer...');
  
  const { primaryFaucet } = await import('./faucet');
  const { faucetMesh } = await import('./faucet-mesh');
  
  // Add primary faucet to mesh
  faucetMesh.addFaucet(primaryFaucet, 1.0);
  
  // Start primary faucet
  primaryFaucet.start();
  
  console.log('[Signals] ✅ Signal layer initialized');
}
