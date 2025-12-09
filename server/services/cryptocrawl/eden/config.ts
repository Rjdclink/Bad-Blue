// Eden Configuration
// Defines all constants and thresholds for the swarm system

export const EDEN_CONFIG = {
  // Cain Configuration - Conjoined-Twin Meta-Strategy
  TOTAL_CAIN_CRAWLERS: 12, // 10 Conjoined-Twin + 1 Dual-Purpose Cataclysm + 1 Genesis Reaper
  CONJOINED_TWIN_CAINS: 10, // Original meta-strategy Cains (learn, adapt, coordinate, validate, dictate)
  DUAL_PURPOSE_CATACLYSM_CAIN: 1, // Cataclysm detection + Gravity Crawler orchestration
  GENESIS_REAPER_CAINS: 1, // The smartest crawler - monitors and terminates problematic crawlers
  MIN_CAINS_FOR_RESET: 2,
  
  // Cycle Configuration
  GENESIS_CYCLE_DURATION_MS: 3600000, // 1 hour
  EDEN_RETURN_INTERVAL_MS: 1800000, // 30 minutes
  DOOMSDAY_TRIGGER_THRESHOLD: 0.1, // 10% success rate triggers doomsday
  
  // Growth/Shrink Thresholds
  GROWTH_THRESHOLD: 0.7, // Priority score >= 0.7 triggers growth
  SHRINK_THRESHOLD: 0.3, // Priority score <= 0.3 triggers shrink
  OPPS_PER_NODE_THRESHOLD: 10, // Opportunities per node
  ROI_GROWTH_MIN: 0.05, // 5% minimum ROI to justify growth
  IDLE_LIMIT_MS: 300000, // 5 minutes idle triggers shrink
  COST_CAP_PER_OPP: 0.01, // Max $0.01 per opportunity
  
  // Starburst Configuration
  STARBURST_THRESHOLD: 0.6, // Probability >= 0.6 triggers starburst
  STARBURST_FAN_OUT_MAX: 100, // Max agents per starburst
  EXECUTION_CONFIDENCE: 0.8, // Min confidence to execute
  
  // Snake Shedding Configuration
  SNAKE_SHED_LIMIT: 3, // Max chain of sheds
  SHED_PRIORITY_DELTA: 0.2, // Minimum priority increase to justify shed
  
  // Residue Management
  RESIDUE_THRESHOLD_MB: 100, // Max 100MB per agent
  RESIDUE_PRUNE_POLICY: 'aggressive',
  ARCHIVE_AGE_DAYS: 7,
  LOG_RETENTION_DAYS: 30,
  
  // Profitability Directive
  LAMBDA_RISK: 0.3, // Risk penalty coefficient
  MU_COST: 0.2, // Cost penalty coefficient
  EPSILON_GREEDY_START: 0.3, // Initial exploration rate
  EPSILON_GREEDY_MIN: 0.05, // Minimum exploration rate
  EPSILON_DECAY: 0.99, // Decay rate per cycle
  
  // Safety Nets
  DRAWDOWN_LIMIT: 0.15, // 15% max drawdown
  CONSECUTIVE_WINS_COOLDOWN: 5, // Cooldown after 5 consecutive wins
  LOSS_FLOOR_THRESHOLD: 0.05, // 5% loss triggers halt
  
  // Network Optimization
  MAX_LATENCY_MS: 500, // Max acceptable latency
  PREFERRED_RPC_LATENCY_MS: 100, // Preferred RPC latency
  IP_ROTATION_INTERVAL_MS: 3600000, // Rotate IPs every hour
  
  // Rate Limits
  RATE_LIMIT_PER_NETWORK_PER_SECOND: 10,
  MAX_CONCURRENT_EXECUTIONS: 50,
  
  // Eden Storage
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_KEY: process.env.SUPABASE_ANON_KEY || '',
  EDEN_HOME_POSITION: 'us-east', // Primary Eden location
  EDEN_REPLICAS: ['us-west', 'eu-central', 'asia-pacific'],
  
  // Emergency Decommission
  EMERGENCY_KEY_ESCROW: process.env.EMERGENCY_KEY_ESCROW || '',
  DECOMMISSION_ENABLED: process.env.ENABLE_EMERGENCY_DECOMMISSION === 'true',
  
  // Simulation Constants
  PROFIT_VARIANCE_MIN: 0.8, // 80% of estimated profit (lower bound)
  PROFIT_VARIANCE_RANGE: 0.4, // Up to 40% above minimum (80-120% range)
  EXECUTION_COST_USD: 0.001, // $0.001 per execution
  
  // Genesis Reaper Configuration - Advanced Statistical Reasoning
  REAPER_MONITORING_INTERVAL_MS: 5000, // Monitor every 5 seconds
  REAPER_MIN_SAMPLE_SIZE: 10, // Min operations before judgement
  REAPER_INEFFICIENCY_THRESHOLD: 0.3, // < 30% success rate is inefficient
  REAPER_PROFIT_WASTE_THRESHOLD: 0.1, // Wasting > 10% of expected profit
  REAPER_ERROR_THRESHOLD: 5, // 5 consecutive errors triggers review
  REAPER_CORRUPTION_CHECK_INTERVAL_MS: 60000, // Check for corruption every minute
  REAPER_DECISION_CONFIDENCE_MIN: 0.85, // 85% confidence required for termination
  
  // Advanced Statistical Formulas for Reaper Reasoning
  REAPER_BAYESIAN_PRIOR: 0.05, // 5% prior probability of corruption
  REAPER_CONFIDENCE_INTERVAL: 0.95, // 95% confidence interval for statistical tests
  REAPER_VARIANCE_THRESHOLD: 2.5, // Standard deviations from mean (z-score)
  REAPER_TREND_WINDOW: 20, // Operations to analyze for trend detection
  REAPER_REGRESSION_R_SQUARED_MIN: 0.6, // Minimum R² for trend significance
  REAPER_OUTLIER_IQR_MULTIPLIER: 1.5, // IQR multiplier for outlier detection
  REAPER_PERFORMANCE_DECAY_FACTOR: 0.95, // Exponential decay for weighted performance
  
  // Database Error Codes
  POSTGRES_UNIQUE_VIOLATION: '23505', // Duplicate key error
  
  // Starburst Expansion Configuration
  STARBURST_INITIAL_CRAWLERS: 1000, // Initial burst size
  STARBURST_MAX_CRAWLERS: 10000000, // Maximum 10 million crawlers
  STARBURST_EXPANSION_RATE: 10, // 10x expansion per trigger
  STARBURST_RADIAL_LAYERS: 5, // Number of radial diffusion layers
  
  // Disco-Ball Mirroring
  DISCO_BALL_SHARDS_PER_CRAWLER: 200, // 200 reflective shards per crawler
  DISCO_BALL_UPDATE_INTERVAL_MS: 1000, // Update shards every second
  
  // Snipe Strategy
  SNIPE_REACTION_TIME_MS: 50, // 50ms first-touch reaction
  SNIPE_SUB_BLOCK_PRECISION_MS: 100, // 100ms sub-block timing precision
  SNIPE_MEMPOOL_FORECAST_WINDOW_MS: 2000, // 2s forecast window
  
  // CBVH Protocol
  CBVH_SAMPLE_SIZE: 100, // Validate 100 crawlers per cycle
  CBVH_DIVERGENCE_THRESHOLD: 0.15, // 15% divergence triggers doomsday
  CBVH_VALIDATION_INTERVAL_MS: 30000, // Validate every 30 seconds
  
  // Gravity Crawler (Crowd Magnet)
  GRAVITY_BOT_DETECTION_CONFIDENCE_MIN: 0.8, // 80% confidence to act
  GRAVITY_PATTERN_MEMORY: 1000, // Remember 1000 bot patterns
  GRAVITY_PREDICTION_ACCURACY_TARGET: 0.95, // 95% prediction accuracy target
  
  // Cascading Opportunity Trees
  CASCADE_MAX_DEPTH: 4, // 4 levels deep
  CASCADE_BRANCH_FACTOR: 6, // 6 branches per opportunity
  CASCADE_MIN_PROFIT_THRESHOLD: 0.01, // $0.01 minimum profit per branch
} as const;

// Control Signals (used in code)
export const CONTROL_SIGNALS = {
  PROB_SIGNAL: (opportunityProbability: number) => opportunityProbability,
  PRIORITY_SCORE: (profit: number, risk: number, latency: number, liquidity: number) => {
    return profit * (1 - risk) * (1 / (1 + latency / 1000)) * Math.log(1 + liquidity);
  },
  PROFITABILITY_OBJECTIVE: (profit: number, risk: number, cost: number) => {
    return profit - EDEN_CONFIG.LAMBDA_RISK * risk - EDEN_CONFIG.MU_COST * cost;
  },
} as const;

// Ethical Guards (immutable)
export const ETHICAL_GUARDS = [
  {
    id: 'no-exploit',
    rule: 'Never exploit smart contract vulnerabilities',
    severity: 'critical' as const,
    checkFunction: 'checkForExploitPatterns',
    enabled: true,
  },
  {
    id: 'no-manipulation',
    rule: 'Never manipulate market prices',
    severity: 'critical' as const,
    checkFunction: 'checkForManipulation',
    enabled: true,
  },
  {
    id: 'no-front-running',
    rule: 'No malicious front-running of user transactions',
    severity: 'high' as const,
    checkFunction: 'checkForFrontRunning',
    enabled: true,
  },
  {
    id: 'respect-rate-limits',
    rule: 'Respect all RPC and API rate limits',
    severity: 'medium' as const,
    checkFunction: 'checkRateLimitCompliance',
    enabled: true,
  },
  {
    id: 'legal-compliance',
    rule: 'Comply with all applicable laws and regulations',
    severity: 'critical' as const,
    checkFunction: 'checkLegalCompliance',
    enabled: true,
  },
] as const;
