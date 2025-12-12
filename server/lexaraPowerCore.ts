/**
 * LEXARA Power Core - Central Energy Management System
 * 
 * Manages Lexara's core power capabilities including:
 * - Power state management (idle, active, boosted, conservation)
 * - Energy flow regulation
 * - Capability amplification
 * - Resource allocation and optimization
 * - Integration with neural spine infrastructure
 * 
 * Power Formula:
 * P(t) = Σ[ωᵢ × Cᵢ(t)] × E(t) × A(t)
 * 
 * Where:
 * - P(t) = Total power output at time t
 * - Cᵢ(t) = Capability i output at time t
 * - ωᵢ = Weight of capability i
 * - E(t) = Energy efficiency factor
 * - A(t) = Amplification coefficient
 */

import { EventEmitter } from 'events';
import { createLogger } from './logger';
import crypto from 'crypto';

const log = createLogger('LexaraPowerCore');

// ============================================================================
// CONSTANTS
// ============================================================================

// Power state thresholds
const POWER_CONSERVATION_THRESHOLD = 0.2;
const POWER_IDLE_THRESHOLD = 0.4;
const POWER_ACTIVE_THRESHOLD = 0.6;
const POWER_BOOSTED_THRESHOLD = 0.85;
const POWER_MAX = 1.0;

// Energy coefficients
const BASE_ENERGY_RATE = 100;       // Base energy units per second
const BOOST_MULTIPLIER = 1.5;       // Power boost multiplier
const CONSERVATION_MULTIPLIER = 0.6; // Conservation mode multiplier
const EFFICIENCY_BASELINE = 0.85;   // Baseline efficiency

// Capability weights
const CAPABILITY_WEIGHTS = {
  voice: 0.25,
  reasoning: 0.30,
  emotion: 0.15,
  memory: 0.15,
  response: 0.15,
};

// Monitoring intervals
const POWER_MONITOR_INTERVAL_MS = 1000; // 1 second
const ENERGY_RECHARGE_INTERVAL_MS = 5000; // 5 seconds

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Power state enumeration
 */
export type PowerState = 'offline' | 'conservation' | 'idle' | 'active' | 'boosted' | 'critical';

/**
 * Capability type
 */
export type LexaraCapability = 'voice' | 'reasoning' | 'emotion' | 'memory' | 'response';

/**
 * Power level configuration
 */
export interface PowerLevel {
  current: number;      // 0-1 normalized power level
  maximum: number;      // Maximum achievable power
  minimum: number;      // Minimum operational power
  reserved: number;     // Reserved for critical operations
}

/**
 * Energy reservoir state
 */
export interface EnergyReservoir {
  capacity: number;     // Maximum energy storage
  current: number;      // Current energy level
  rechargeRate: number; // Energy units per second
  drainRate: number;    // Current drain rate
  efficiency: number;   // Conversion efficiency (0-1)
}

/**
 * Capability power allocation
 */
export interface CapabilityAllocation {
  capability: LexaraCapability;
  allocation: number;   // Percentage of power allocated (0-1)
  priority: number;     // Priority level (1-10)
  active: boolean;      // Whether capability is active
  output: number;       // Current output level (0-1)
}

/**
 * Power flow metrics
 */
export interface PowerFlowMetrics {
  timestamp: number;
  inputPower: number;
  outputPower: number;
  efficiency: number;
  losses: number;
  amplification: number;
}

/**
 * Power core state snapshot
 */
export interface PowerCoreState {
  id: string;
  state: PowerState;
  powerLevel: PowerLevel;
  energy: EnergyReservoir;
  capabilities: Map<LexaraCapability, CapabilityAllocation>;
  metrics: PowerFlowMetrics;
  uptime: number;
  lastStateChange: number;
}

/**
 * Power regulation result
 */
export interface PowerRegulationResult {
  success: boolean;
  previousState: PowerState;
  newState: PowerState;
  adjustments: string[];
  timestamp: number;
}

/**
 * Power boost request
 */
export interface PowerBoostRequest {
  capability: LexaraCapability;
  duration: number;     // Duration in milliseconds
  intensity: number;    // Boost intensity (1-3)
  reason: string;
}

/**
 * Power boost response
 */
export interface PowerBoostResponse {
  granted: boolean;
  boostId: string | null;
  actualIntensity: number;
  expiresAt: number | null;
  reason: string;
}

/**
 * Overall power metrics
 */
export interface LexaraPowerMetrics {
  totalPowerOutput: number;
  averageEfficiency: number;
  peakPower: number;
  energyConsumed: number;
  uptime: number;
  stateTransitions: number;
  boostsGranted: number;
  currentState: PowerState;
}

// ============================================================================
// LEXARA POWER CORE CLASS
// ============================================================================

export class LexaraPowerCore extends EventEmitter {
  private id: string;
  private initialized: boolean = false;
  private state: PowerState = 'offline';
  private powerLevel: PowerLevel;
  private energy: EnergyReservoir;
  private capabilities: Map<LexaraCapability, CapabilityAllocation> = new Map();
  private activeBoosts: Map<string, { capability: LexaraCapability; intensity: number; expiresAt: number }> = new Map();
  private flowHistory: PowerFlowMetrics[] = [];
  private monitorInterval: NodeJS.Timeout | null = null;
  private rechargeInterval: NodeJS.Timeout | null = null;
  private startTime: number = 0;
  private stateTransitionCount: number = 0;
  private totalBoostsGranted: number = 0;
  private peakPowerReached: number = 0;
  private totalEnergyConsumed: number = 0;

  constructor() {
    super();
    this.id = `lexara-power-${crypto.randomBytes(8).toString('hex')}`;
    
    // Initialize power level
    this.powerLevel = {
      current: 0,
      maximum: POWER_MAX,
      minimum: POWER_CONSERVATION_THRESHOLD,
      reserved: 0.1,
    };
    
    // Initialize energy reservoir
    this.energy = {
      capacity: 10000,
      current: 10000,
      rechargeRate: BASE_ENERGY_RATE,
      drainRate: 0,
      efficiency: EFFICIENCY_BASELINE,
    };
  }

  /**
   * Initialize the Power Core
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      log.warn('Power Core already initialized');
      return;
    }

    log.info('Initializing Lexara Power Core...');
    this.startTime = Date.now();

    // Initialize capabilities
    this.initializeCapabilities();

    // Transition to idle state
    await this.transitionState('idle');

    // Start monitoring
    this.startPowerMonitoring();
    this.startEnergyRecharge();

    this.initialized = true;
    this.emit('initialized', { id: this.id, state: this.state });
    log.info('Lexara Power Core initialized', { id: this.id });
  }

  /**
   * Initialize capability allocations
   */
  private initializeCapabilities(): void {
    const capabilityList: LexaraCapability[] = ['voice', 'reasoning', 'emotion', 'memory', 'response'];
    
    for (const capability of capabilityList) {
      this.capabilities.set(capability, {
        capability,
        allocation: CAPABILITY_WEIGHTS[capability],
        priority: this.getCapabilityPriority(capability),
        active: true,
        output: 0.5,
      });
    }
    
    log.debug('Capabilities initialized', { count: this.capabilities.size });
  }

  /**
   * Get default priority for capability
   */
  private getCapabilityPriority(capability: LexaraCapability): number {
    const priorities: Record<LexaraCapability, number> = {
      voice: 8,
      reasoning: 9,
      emotion: 7,
      memory: 6,
      response: 8,
    };
    return priorities[capability];
  }

  /**
   * Transition to a new power state
   */
  async transitionState(newState: PowerState): Promise<PowerRegulationResult> {
    const previousState = this.state;
    const adjustments: string[] = [];

    // Validate state transition
    if (!this.isValidTransition(previousState, newState)) {
      log.warn('Invalid state transition attempted', { from: previousState, to: newState });
      return {
        success: false,
        previousState,
        newState: previousState,
        adjustments: ['Invalid transition blocked'],
        timestamp: Date.now(),
      };
    }

    // Apply state-specific adjustments
    switch (newState) {
      case 'conservation':
        this.applyConservationMode();
        adjustments.push('Conservation mode activated');
        break;
      case 'idle':
        this.applyIdleMode();
        adjustments.push('Idle mode activated');
        break;
      case 'active':
        this.applyActiveMode();
        adjustments.push('Active mode engaged');
        break;
      case 'boosted':
        this.applyBoostedMode();
        adjustments.push('Boosted mode engaged');
        break;
      case 'critical':
        this.applyCriticalMode();
        adjustments.push('Critical mode - emergency operations only');
        break;
      case 'offline':
        this.applyOfflineMode();
        adjustments.push('System offline');
        break;
    }

    // Update state
    this.state = newState;
    this.stateTransitionCount++;

    // Update power level based on state
    this.updatePowerLevelForState(newState);

    this.emit('state-changed', { from: previousState, to: newState, adjustments });
    log.info('Power state transition', { from: previousState, to: newState });

    return {
      success: true,
      previousState,
      newState,
      adjustments,
      timestamp: Date.now(),
    };
  }

  /**
   * Check if state transition is valid
   */
  private isValidTransition(from: PowerState, to: PowerState): boolean {
    // Define valid transitions
    const validTransitions: Record<PowerState, PowerState[]> = {
      offline: ['idle', 'conservation'],
      conservation: ['idle', 'active', 'critical', 'offline'],
      idle: ['active', 'conservation', 'boosted', 'offline'],
      active: ['idle', 'boosted', 'conservation', 'critical', 'offline'],
      boosted: ['active', 'idle', 'critical', 'offline'],
      critical: ['conservation', 'idle', 'offline'],
    };

    return validTransitions[from]?.includes(to) ?? false;
  }

  /**
   * Apply conservation mode settings
   */
  private applyConservationMode(): void {
    // Reduce all capability outputs
    for (const [, allocation] of this.capabilities) {
      allocation.output = Math.min(allocation.output, 0.3);
    }
    this.energy.drainRate = BASE_ENERGY_RATE * CONSERVATION_MULTIPLIER;
  }

  /**
   * Apply idle mode settings
   */
  private applyIdleMode(): void {
    // Set moderate capability outputs
    for (const [, allocation] of this.capabilities) {
      allocation.output = 0.5;
    }
    this.energy.drainRate = BASE_ENERGY_RATE * 0.8;
  }

  /**
   * Apply active mode settings
   */
  private applyActiveMode(): void {
    // Enable full capability outputs
    for (const [, allocation] of this.capabilities) {
      allocation.output = 0.8;
    }
    this.energy.drainRate = BASE_ENERGY_RATE;
  }

  /**
   * Apply boosted mode settings
   */
  private applyBoostedMode(): void {
    // Maximize capability outputs
    for (const [, allocation] of this.capabilities) {
      allocation.output = 1.0;
    }
    this.energy.drainRate = BASE_ENERGY_RATE * BOOST_MULTIPLIER;
  }

  /**
   * Apply critical mode settings
   */
  private applyCriticalMode(): void {
    // Emergency - only essential capabilities
    for (const [capability, allocation] of this.capabilities) {
      allocation.output = capability === 'response' ? 0.5 : 0.1;
      allocation.active = capability === 'response' || capability === 'reasoning';
    }
    this.energy.drainRate = BASE_ENERGY_RATE * 0.4;
  }

  /**
   * Apply offline mode settings
   */
  private applyOfflineMode(): void {
    // All capabilities disabled
    for (const [, allocation] of this.capabilities) {
      allocation.output = 0;
      allocation.active = false;
    }
    this.energy.drainRate = 0;
  }

  /**
   * Update power level based on current state
   */
  private updatePowerLevelForState(state: PowerState): void {
    const statePowerLevels: Record<PowerState, number> = {
      offline: 0,
      critical: POWER_CONSERVATION_THRESHOLD,
      conservation: POWER_CONSERVATION_THRESHOLD + 0.1,
      idle: POWER_IDLE_THRESHOLD,
      active: POWER_ACTIVE_THRESHOLD,
      boosted: POWER_BOOSTED_THRESHOLD,
    };

    this.powerLevel.current = statePowerLevels[state];
    
    // Track peak power
    if (this.powerLevel.current > this.peakPowerReached) {
      this.peakPowerReached = this.powerLevel.current;
    }
  }

  /**
   * Request a power boost for a capability
   */
  async requestBoost(request: PowerBoostRequest): Promise<PowerBoostResponse> {
    // Check if boost can be granted
    if (this.state === 'offline' || this.state === 'critical') {
      return {
        granted: false,
        boostId: null,
        actualIntensity: 0,
        expiresAt: null,
        reason: `Cannot grant boost in ${this.state} state`,
      };
    }

    // Check energy availability
    const energyRequired = request.intensity * 500;
    if (this.energy.current < energyRequired) {
      return {
        granted: false,
        boostId: null,
        actualIntensity: 0,
        expiresAt: null,
        reason: 'Insufficient energy for boost',
      };
    }

    // Calculate actual intensity based on current state
    let actualIntensity = request.intensity;
    if (this.state === 'conservation') {
      actualIntensity = Math.min(request.intensity, 1.5);
    } else if (this.state === 'idle') {
      actualIntensity = Math.min(request.intensity, 2.0);
    }

    // Generate boost ID
    const boostId = `boost-${crypto.randomBytes(6).toString('hex')}`;
    const expiresAt = Date.now() + request.duration;

    // Register boost
    this.activeBoosts.set(boostId, {
      capability: request.capability,
      intensity: actualIntensity,
      expiresAt,
    });

    // Apply boost to capability
    const capability = this.capabilities.get(request.capability);
    if (capability) {
      capability.output = Math.min(1.0, capability.output * actualIntensity);
    }

    // Consume energy
    this.energy.current -= energyRequired;
    this.totalBoostsGranted++;

    // Schedule boost expiration
    setTimeout(() => {
      this.expireBoost(boostId);
    }, request.duration);

    this.emit('boost-granted', { boostId, capability: request.capability, intensity: actualIntensity });
    log.info('Power boost granted', { boostId, capability: request.capability, intensity: actualIntensity });

    return {
      granted: true,
      boostId,
      actualIntensity,
      expiresAt,
      reason: 'Boost granted successfully',
    };
  }

  /**
   * Expire a power boost
   */
  private expireBoost(boostId: string): void {
    const boost = this.activeBoosts.get(boostId);
    if (!boost) return;

    // Restore capability output
    const capability = this.capabilities.get(boost.capability);
    if (capability) {
      capability.output = capability.output / boost.intensity;
    }

    this.activeBoosts.delete(boostId);
    this.emit('boost-expired', { boostId, capability: boost.capability });
    log.debug('Power boost expired', { boostId });
  }

  /**
   * Set capability allocation
   */
  setCapabilityAllocation(capability: LexaraCapability, allocation: number): boolean {
    const capabilityData = this.capabilities.get(capability);
    if (!capabilityData) {
      return false;
    }

    // Validate allocation (0-1)
    allocation = Math.max(0, Math.min(1, allocation));
    capabilityData.allocation = allocation;

    // Rebalance other capabilities
    this.rebalanceAllocations(capability, allocation);

    this.emit('allocation-changed', { capability, allocation });
    return true;
  }

  /**
   * Rebalance capability allocations
   */
  private rebalanceAllocations(changedCapability: LexaraCapability, newAllocation: number): void {
    const remaining = 1 - newAllocation;
    const otherCapabilities = Array.from(this.capabilities.entries())
      .filter(([cap]) => cap !== changedCapability);
    
    const currentOtherTotal = otherCapabilities
      .reduce((sum, [, data]) => sum + data.allocation, 0);

    if (currentOtherTotal > 0) {
      const scale = remaining / currentOtherTotal;
      for (const [, data] of otherCapabilities) {
        data.allocation *= scale;
      }
    }
  }

  /**
   * Calculate total power output
   * P(t) = Σ[ωᵢ × Cᵢ(t)] × E(t) × A(t)
   */
  calculateTotalPower(): number {
    let capabilitySum = 0;

    for (const [capability, data] of this.capabilities) {
      if (data.active) {
        const weight = CAPABILITY_WEIGHTS[capability];
        capabilitySum += weight * data.output;
      }
    }

    // Apply energy efficiency
    const energyFactor = this.energy.current / this.energy.capacity;
    
    // Calculate amplification from active boosts
    let amplification = 1.0;
    for (const boost of this.activeBoosts.values()) {
      amplification *= boost.intensity * 0.5 + 0.5;
    }

    const totalPower = capabilitySum * energyFactor * amplification * this.energy.efficiency;
    return Math.min(totalPower, this.powerLevel.maximum);
  }

  /**
   * Start power monitoring
   */
  private startPowerMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }

    this.monitorInterval = setInterval(() => {
      this.recordPowerMetrics();
      this.checkPowerState();
      this.cleanupExpiredBoosts();
    }, POWER_MONITOR_INTERVAL_MS);
  }

  /**
   * Start energy recharge process
   */
  private startEnergyRecharge(): void {
    if (this.rechargeInterval) {
      clearInterval(this.rechargeInterval);
    }

    this.rechargeInterval = setInterval(() => {
      this.rechargeEnergy();
    }, ENERGY_RECHARGE_INTERVAL_MS);
  }

  /**
   * Record current power metrics
   */
  private recordPowerMetrics(): void {
    const outputPower = this.calculateTotalPower();
    const inputPower = this.energy.drainRate / BASE_ENERGY_RATE;
    
    const metrics: PowerFlowMetrics = {
      timestamp: Date.now(),
      inputPower,
      outputPower,
      efficiency: inputPower > 0 ? outputPower / inputPower : 0,
      losses: Math.max(0, inputPower - outputPower),
      amplification: this.activeBoosts.size > 0 ? 1 + this.activeBoosts.size * 0.2 : 1,
    };

    this.flowHistory.push(metrics);
    
    // Keep last 1000 metrics
    if (this.flowHistory.length > 1000) {
      this.flowHistory.shift();
    }

    // Track energy consumption
    this.totalEnergyConsumed += this.energy.drainRate * (POWER_MONITOR_INTERVAL_MS / 1000);
  }

  /**
   * Check and adjust power state based on energy
   */
  private checkPowerState(): void {
    const energyRatio = this.energy.current / this.energy.capacity;

    // Auto-transition based on energy levels
    if (energyRatio < 0.1 && this.state !== 'critical' && this.state !== 'offline') {
      this.transitionState('critical');
    } else if (energyRatio < 0.3 && this.state === 'boosted') {
      this.transitionState('active');
    } else if (energyRatio > 0.7 && this.state === 'critical') {
      this.transitionState('conservation');
    }

    // Drain energy
    const drainAmount = this.energy.drainRate * (POWER_MONITOR_INTERVAL_MS / 1000);
    this.energy.current = Math.max(0, this.energy.current - drainAmount);
  }

  /**
   * Recharge energy
   */
  private rechargeEnergy(): void {
    if (this.state === 'offline') return;

    const rechargeAmount = this.energy.rechargeRate * (ENERGY_RECHARGE_INTERVAL_MS / 1000);
    this.energy.current = Math.min(this.energy.capacity, this.energy.current + rechargeAmount);
  }

  /**
   * Cleanup expired boosts
   */
  private cleanupExpiredBoosts(): void {
    const now = Date.now();
    for (const [boostId, boost] of this.activeBoosts) {
      if (boost.expiresAt <= now) {
        this.expireBoost(boostId);
      }
    }
  }

  /**
   * Get current power state snapshot
   */
  getState(): PowerCoreState {
    return {
      id: this.id,
      state: this.state,
      powerLevel: { ...this.powerLevel },
      energy: { ...this.energy },
      capabilities: new Map(this.capabilities),
      metrics: this.flowHistory[this.flowHistory.length - 1] || this.createEmptyMetrics(),
      uptime: Date.now() - this.startTime,
      lastStateChange: Date.now(),
    };
  }

  /**
   * Create empty metrics object
   */
  private createEmptyMetrics(): PowerFlowMetrics {
    return {
      timestamp: Date.now(),
      inputPower: 0,
      outputPower: 0,
      efficiency: 0,
      losses: 0,
      amplification: 1,
    };
  }

  /**
   * Get comprehensive power metrics
   */
  getMetrics(): LexaraPowerMetrics {
    const avgEfficiency = this.flowHistory.length > 0
      ? this.flowHistory.reduce((sum, m) => sum + m.efficiency, 0) / this.flowHistory.length
      : 0;

    return {
      totalPowerOutput: this.calculateTotalPower(),
      averageEfficiency: avgEfficiency,
      peakPower: this.peakPowerReached,
      energyConsumed: this.totalEnergyConsumed,
      uptime: Date.now() - this.startTime,
      stateTransitions: this.stateTransitionCount,
      boostsGranted: this.totalBoostsGranted,
      currentState: this.state,
    };
  }

  /**
   * Get capability status
   */
  getCapabilityStatus(capability: LexaraCapability): CapabilityAllocation | null {
    return this.capabilities.get(capability) || null;
  }

  /**
   * Get all capability statuses
   */
  getAllCapabilityStatuses(): Map<LexaraCapability, CapabilityAllocation> {
    return new Map(this.capabilities);
  }

  /**
   * Get active boosts
   */
  getActiveBoosts(): Array<{ boostId: string; capability: LexaraCapability; intensity: number; expiresAt: number }> {
    return Array.from(this.activeBoosts.entries()).map(([boostId, data]) => ({
      boostId,
      ...data,
    }));
  }

  /**
   * Get power flow history
   */
  getPowerFlowHistory(count: number = 100): PowerFlowMetrics[] {
    return this.flowHistory.slice(-count);
  }

  /**
   * Check if power core is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if system is operational
   */
  isOperational(): boolean {
    return this.initialized && this.state !== 'offline' && this.state !== 'critical';
  }

  /**
   * Shutdown the power core
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down Lexara Power Core...');

    // Clear intervals
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    if (this.rechargeInterval) {
      clearInterval(this.rechargeInterval);
      this.rechargeInterval = null;
    }

    // Clear active boosts
    this.activeBoosts.clear();

    // Transition to offline
    await this.transitionState('offline');

    this.initialized = false;
    this.emit('shutdown', { id: this.id });
    log.info('Lexara Power Core shutdown complete');
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let instance: LexaraPowerCore | null = null;

/**
 * Get the Lexara Power Core singleton instance
 */
export function getLexaraPowerCore(): LexaraPowerCore {
  if (!instance) {
    instance = new LexaraPowerCore();
  }
  return instance;
}

/**
 * Initialize the Lexara Power Core
 */
export async function initializeLexaraPowerCore(): Promise<LexaraPowerCore> {
  const powerCore = getLexaraPowerCore();
  await powerCore.initialize();
  return powerCore;
}

/**
 * Shutdown the Lexara Power Core
 */
export async function shutdownLexaraPowerCore(): Promise<void> {
  if (instance) {
    await instance.shutdown();
    instance = null;
  }
}

export default {
  LexaraPowerCore,
  getLexaraPowerCore,
  initializeLexaraPowerCore,
  shutdownLexaraPowerCore,
};
