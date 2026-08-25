export type CryptocrawlStage = 1 | 2 | 3 | 4 | 5 | 6;

export type GovernanceActor = 'human' | 'composer' | 'system';

export type GovernanceAction =
  | 'ADVISE'
  | 'BOOTSTRAP_SETTLEMENT'
  | 'EXECUTE_OPPORTUNITY'
  | 'SUBMIT_TX'
  | 'PERSIST_LONG_TERM_MEMORY'
  | 'EVOLVE_STRATEGY';

export interface ExecutionEnvelopeConstraints {
  /** Hard allow-list. Omit => deny-by-default for safety. */
  chains?: string[];
  /** Human-defined pair allow-list (e.g. "ETH/USDC"). */
  pairs?: string[];
  /** Human-defined venue allow-list (e.g. "uniswapV3"). */
  venues?: string[];

  /** Max total executions allowed during envelope. */
  maxExecutions?: number;

  /** Safety caps. */
  maxNotionalUsd?: number;
  maxGasGwei?: number;
  maxSlippageBps?: number;

  /** Optional capped-profit ladder (tiering can be enforced externally). */
  maxProfitUsdPerExecution?: number;
}

export interface ExecutionEnvelope {
  id: string;
  stage: CryptocrawlStage;
  scope: string;
  authority: GovernanceActor;
  createdAt: number;
  expiresAt: number;
  allowedActions: GovernanceAction[];
  constraints: ExecutionEnvelopeConstraints;
}

export interface KillSwitchState {
  armed: boolean;
  engaged: boolean;
  engagedAt?: number;
  engagedReason?: string;
}

export interface GovernanceState {
  stage: CryptocrawlStage;
  paused: boolean;
  pauseReason?: string;
  pausedAt?: number;

  killSwitch: KillSwitchState;
  activeEnvelope: ExecutionEnvelope | null;

  /** Monotonic counter to enforce maxExecutions. */
  executionsInEnvelope: number;
}

export type GovernanceErrorCode =
  | 'KILL_SWITCH_ENGAGED'
  | 'KILL_SWITCH_NOT_ARMED'
  | 'PAUSED'
  | 'NO_ACTIVE_ENVELOPE'
  | 'ENVELOPE_EXPIRED'
  | 'ACTION_NOT_ALLOWED'
  | 'STAGE_VIOLATION'
  | 'CONSTRAINT_VIOLATION';

export class GovernanceError extends Error {
  readonly code: GovernanceErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: GovernanceErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'GovernanceError';
    this.code = code;
    this.details = details;
  }
}

