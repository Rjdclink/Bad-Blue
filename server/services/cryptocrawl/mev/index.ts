// server/services/cryptocrawl/mev/index.ts
import {FlashbotsEngine} from './flashbots-engine';
import {ValidatorTippingStrategy, ValidatorBribingStrategy} from './validator-bribing';

const flashbotsEngine = new FlashbotsEngine();
const tippingStrategy = new ValidatorTippingStrategy();

// Initialize on import (can be called explicitly if needed)
const initializeEngines = async () => {
  try {
    await flashbotsEngine.initialize();
    console.log('✅ MEV Engines initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize MEV engines:', error);
  }
};

// Backward compatibility
const bribingStrategy = tippingStrategy;

export {flashbotsEngine, tippingStrategy, bribingStrategy, initializeEngines};
