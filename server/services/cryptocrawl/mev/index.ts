// server/services/cryptocrawl/mev/index.ts
import {FlashbotsEngine} from './flashbots-engine';
import {ValidatorBribingStrategy} from './validator-bribing';

const flashbotsEngine = new FlashbotsEngine();
const bribingStrategy = new ValidatorBribingStrategy();

// Initialize on import (can be called explicitly if needed)
const initializeEngines = async () => {
  try {
    await flashbotsEngine.initialize();
    console.log('✅ MEV Engines initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize MEV engines:', error);
  }
};

export {flashbotsEngine, bribingStrategy, initializeEngines};
