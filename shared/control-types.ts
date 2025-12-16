export type ExecutionContext = {
  requestId: string;
  actor?: string;
  flags?: Record<string, unknown>;
  limits?: {
    overload?: boolean;
    reason?: string;
    maxConcurrencyExceeded?: boolean;
  };
  autonomy?: {
    level?: number;
    reason?: string;
  };
  metadata?: Record<string, unknown>;
  timestamp?: number;
};

export type ControlInput = {
  action: string;
  requestedCapability?: number;
  payload?: unknown;
  caller?: string;
};

export type KillSwitchResult = {
  active: boolean;
  reason?: string;
};

export type HardLimitResult = {
  exceeded: boolean;
  reason?: string;
};

export type AutonomyResult = {
  level: number;
  reason?: string;
};

export type SystemControlResult = {
  isOn: boolean;
  capability: number;
  reasons: string[];
};
