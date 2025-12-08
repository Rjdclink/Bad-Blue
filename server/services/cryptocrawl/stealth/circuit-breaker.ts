// Circuit Breaker Pattern for Fault Tolerance
// Prevents cascading failures by stopping execution when error threshold is reached

export enum CircuitBreakerState {
  CLOSED = 'CLOSED',     // Normal operation
  OPEN = 'OPEN',         // Blocking all requests
  HALF_OPEN = 'HALF_OPEN' // Testing if service recovered
}

export interface CircuitBreakerConfig {
  failureThreshold: number;    // Number of failures before opening
  resetTimeoutMs: number;      // Time to wait before trying again
  halfOpenMaxAttempts: number; // Attempts allowed in half-open state
}

export interface CircuitBreakerMetrics {
  state: CircuitBreakerState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number;
  lastStateChange: number;
  halfOpenAttempts: number;
}

export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private lastStateChange = Date.now();
  private halfOpenAttempts = 0;
  private readonly config: CircuitBreakerConfig;
  private readonly name: string;

  constructor(name: string, config: CircuitBreakerConfig) {
    this.name = name;
    this.config = config;
  }

  /**
   * Execute function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === CircuitBreakerState.OPEN) {
      // Check if enough time has passed to try again
      if (Date.now() - this.lastFailureTime > this.config.resetTimeoutMs) {
        console.log(`[CIRCUIT-BREAKER:${this.name}] Transitioning to HALF_OPEN`);
        this.transitionTo(CircuitBreakerState.HALF_OPEN);
        this.halfOpenAttempts = 0;
      } else {
        throw new Error(`Circuit breaker is OPEN for ${this.name}`);
      }
    }

    // Check half-open attempt limit
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
        throw new Error(`Circuit breaker HALF_OPEN attempt limit reached for ${this.name}`);
      }
      this.halfOpenAttempts++;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.successCount++;
    this.failureCount = 0; // Reset failure count on success

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      console.log(`[CIRCUIT-BREAKER:${this.name}] Success in HALF_OPEN, transitioning to CLOSED`);
      this.transitionTo(CircuitBreakerState.CLOSED);
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      console.log(`[CIRCUIT-BREAKER:${this.name}] Failure in HALF_OPEN, transitioning to OPEN`);
      this.transitionTo(CircuitBreakerState.OPEN);
      return;
    }

    if (this.state === CircuitBreakerState.CLOSED && this.failureCount >= this.config.failureThreshold) {
      console.log(`[CIRCUIT-BREAKER:${this.name}] Failure threshold reached (${this.failureCount}), transitioning to OPEN`);
      this.transitionTo(CircuitBreakerState.OPEN);
    }
  }

  /**
   * Transition to new state
   */
  private transitionTo(newState: CircuitBreakerState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();

    if (newState === CircuitBreakerState.CLOSED) {
      this.failureCount = 0;
      this.halfOpenAttempts = 0;
    }

    console.log(`[CIRCUIT-BREAKER:${this.name}] State transition: ${oldState} → ${newState}`);
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    console.log(`[CIRCUIT-BREAKER:${this.name}] Manual reset`);
    this.transitionTo(CircuitBreakerState.CLOSED);
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenAttempts = 0;
  }

  /**
   * Get current metrics
   */
  getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastStateChange: this.lastStateChange,
      halfOpenAttempts: this.halfOpenAttempts,
    };
  }

  /**
   * Check if circuit breaker is allowing requests
   */
  isOpen(): boolean {
    return this.state === CircuitBreakerState.OPEN;
  }

  /**
   * Get current state
   */
  getState(): CircuitBreakerState {
    return this.state;
  }
}
