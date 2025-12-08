// Advanced configuration system for Stealth Superiority
// Centralized, type-safe configuration with validation

export interface StealthConfig {
  // Executor configuration
  executor: {
    poolSize: number;
    gasHistoryWindow: number;
    gasConfidenceLevel: number; // Standard deviations (e.g., 2 = 95% confidence)
    maxRetries: number;
    retryDelayMs: number;
    poolRegenerationIntervalMs: number;
  };

  // Learning system configuration
  learning: {
    learningRate: number;
    discountFactor: number;
    explorationRate: number;
    explorationDecay: number; // Reduce exploration over time
    minExplorationRate: number;
    historyWindow: number;
    anomalyThreshold: number; // Z-score threshold
    bidMultiplierMin: number;
    bidMultiplierMax: number;
    gasMultiplierMin: number;
    gasMultiplierMax: number;
    minSamplesForPrediction: number;
  };

  // Scaling configuration
  scaling: {
    burstVolatilityThreshold: number;
    burstDensityThreshold: number;
    highDensityThreshold: number;
    mediumDensityThreshold: number;
    lowDensityThreshold: number;
    scaleUpDelayMs: number;
    scaleDownDelayMs: number;
    costOptimizationMinProfit: number;
  };

  // Operational configuration
  operational: {
    maxProviderFailures: number;
    providerHealthCheckIntervalMs: number;
    shadowTestSuccessThreshold: number;
    shadowTestMinSamples: number;
    blockSubscriptionTimeout: number;
    mutexTimeoutMs: number;
  };

  // Metrics configuration
  metrics: {
    latencyHistoryWindow: number;
    executionHistoryWindow: number;
    metricsUpdateIntervalMs: number;
    performanceReportIntervalMs: number;
  };

  // Circuit breaker configuration
  circuitBreaker: {
    enabled: boolean;
    failureThreshold: number;
    resetTimeoutMs: number;
    halfOpenMaxAttempts: number;
  };
}

// Default configuration (production-optimized)
export const DEFAULT_STEALTH_CONFIG: StealthConfig = {
  executor: {
    poolSize: 100,
    gasHistoryWindow: 100,
    gasConfidenceLevel: 2.0, // 95% confidence
    maxRetries: 3,
    retryDelayMs: 100,
    poolRegenerationIntervalMs: 100,
  },

  learning: {
    learningRate: 0.1,
    discountFactor: 0.95,
    explorationRate: 0.2,
    explorationDecay: 0.999, // Gradually reduce exploration
    minExplorationRate: 0.05,
    historyWindow: 1000,
    anomalyThreshold: 3.0,
    bidMultiplierMin: 0.8,
    bidMultiplierMax: 1.2,
    gasMultiplierMin: 0.9,
    gasMultiplierMax: 1.1,
    minSamplesForPrediction: 10,
  },

  scaling: {
    burstVolatilityThreshold: 5,
    burstDensityThreshold: 20,
    highDensityThreshold: 10,
    mediumDensityThreshold: 5,
    lowDensityThreshold: 3,
    scaleUpDelayMs: 1000,
    scaleDownDelayMs: 30000, // Wait 30s before scaling down
    costOptimizationMinProfit: 50,
  },

  operational: {
    maxProviderFailures: 5,
    providerHealthCheckIntervalMs: 30000,
    shadowTestSuccessThreshold: 0.95,
    shadowTestMinSamples: 20,
    blockSubscriptionTimeout: 60000,
    mutexTimeoutMs: 5000,
  },

  metrics: {
    latencyHistoryWindow: 200,
    executionHistoryWindow: 1000,
    metricsUpdateIntervalMs: 1000,
    performanceReportIntervalMs: 300000, // 5 minutes
  },

  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    resetTimeoutMs: 60000, // 1 minute
    halfOpenMaxAttempts: 3,
  },
};

// Configuration validation
export function validateConfig(config: Partial<StealthConfig>): StealthConfig {
  const validated = { ...DEFAULT_STEALTH_CONFIG };

  // Validate and merge executor config
  if (config.executor) {
    validated.executor = {
      ...validated.executor,
      ...config.executor,
    };

    if (validated.executor.poolSize < 10 || validated.executor.poolSize > 1000) {
      throw new Error('Executor pool size must be between 10 and 1000');
    }
    if (validated.executor.gasConfidenceLevel < 1 || validated.executor.gasConfidenceLevel > 4) {
      throw new Error('Gas confidence level must be between 1 and 4');
    }
  }

  // Validate and merge learning config
  if (config.learning) {
    validated.learning = {
      ...validated.learning,
      ...config.learning,
    };

    if (validated.learning.learningRate <= 0 || validated.learning.learningRate > 1) {
      throw new Error('Learning rate must be between 0 and 1');
    }
    if (validated.learning.explorationRate < 0 || validated.learning.explorationRate > 1) {
      throw new Error('Exploration rate must be between 0 and 1');
    }
  }

  // Validate and merge scaling config
  if (config.scaling) {
    validated.scaling = {
      ...validated.scaling,
      ...config.scaling,
    };

    if (validated.scaling.burstVolatilityThreshold <= 0) {
      throw new Error('Burst volatility threshold must be positive');
    }
  }

  // Validate and merge operational config
  if (config.operational) {
    validated.operational = {
      ...validated.operational,
      ...config.operational,
    };

    if (validated.operational.shadowTestSuccessThreshold < 0 || validated.operational.shadowTestSuccessThreshold > 1) {
      throw new Error('Shadow test success threshold must be between 0 and 1');
    }
  }

  // Validate and merge metrics config
  if (config.metrics) {
    validated.metrics = {
      ...validated.metrics,
      ...config.metrics,
    };
  }

  // Validate and merge circuit breaker config
  if (config.circuitBreaker) {
    validated.circuitBreaker = {
      ...validated.circuitBreaker,
      ...config.circuitBreaker,
    };

    if (validated.circuitBreaker.failureThreshold < 1) {
      throw new Error('Circuit breaker failure threshold must be at least 1');
    }
  }

  return validated;
}

// Environment-specific presets
export const STEALTH_PRESETS = {
  // Development: More logging, higher exploration
  development: {
    learning: {
      explorationRate: 0.3,
      minExplorationRate: 0.1,
    },
    metrics: {
      performanceReportIntervalMs: 60000, // 1 minute
    },
  } as Partial<StealthConfig>,

  // Production: Optimized for performance
  production: {
    learning: {
      explorationRate: 0.15,
      minExplorationRate: 0.02,
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 3,
    },
  } as Partial<StealthConfig>,

  // Testing: Faster iteration, smaller windows
  testing: {
    executor: {
      poolSize: 20,
    },
    learning: {
      historyWindow: 100,
    },
    metrics: {
      latencyHistoryWindow: 50,
      executionHistoryWindow: 100,
    },
  } as Partial<StealthConfig>,

  // Aggressive: Maximum performance, higher risk
  aggressive: {
    executor: {
      poolSize: 200,
    },
    learning: {
      explorationRate: 0.1,
      bidMultiplierMax: 1.5,
    },
    scaling: {
      burstVolatilityThreshold: 3,
      burstDensityThreshold: 15,
    },
  } as Partial<StealthConfig>,

  // Conservative: Lower risk, steady performance
  conservative: {
    learning: {
      explorationRate: 0.25,
      bidMultiplierMax: 1.1,
    },
    scaling: {
      burstVolatilityThreshold: 7,
      burstDensityThreshold: 25,
    },
    circuitBreaker: {
      failureThreshold: 2,
    },
  } as Partial<StealthConfig>,
};

// Load configuration from environment or preset
export function loadConfig(preset?: keyof typeof STEALTH_PRESETS): StealthConfig {
  let config: Partial<StealthConfig> = {};

  // Load preset if specified
  if (preset && STEALTH_PRESETS[preset]) {
    config = STEALTH_PRESETS[preset];
  }

  // Override with environment variables if present
  if (process.env.STEALTH_CONFIG) {
    try {
      const envConfig = JSON.parse(process.env.STEALTH_CONFIG);
      config = { ...config, ...envConfig };
    } catch (error) {
      console.warn('[STEALTH] Failed to parse STEALTH_CONFIG environment variable');
    }
  }

  return validateConfig(config);
}
