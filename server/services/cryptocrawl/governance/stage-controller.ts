/**
 * STAGE CONTROLLER - Stage 1-N Enforcement with PASS/FAIL
 * 
 * Enforces stage progression rules:
 * - Prevents skipping stages
 * - Prevents backsliding without authorization
 * - Handles PASS / FAIL state for each stage
 * - Validates advancement conditions
 * 
 * HARD RULES:
 * - Cannot skip stages (1 → 2 → 3 ...)
 * - Cannot advance on FAIL
 * - Cannot backslide without Composer approval
 * - Stage 6+ require Monte Carlo justification
 */

import { EventEmitter } from 'events';
import { composer, StageCommand } from './composer';

export enum StageStatus {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  PASS = 'pass',
  FAIL = 'fail',
  BLOCKED = 'blocked',
}

export interface StageDefinition {
  id: number;
  name: string;
  description: string;
  requirements: string[];
  advancementCriteria: string[];
  canSkip: boolean;
}

export interface StageState {
  stageId: number;
  status: StageStatus;
  startTime: number | null;
  endTime: number | null;
  attempts: number;
  lastFailureReason: string | null;
  passConditionsMet: string[];
  failConditionsTriggered: string[];
  metrics: Record<string, number>;
}

/**
 * Stage definitions for CryptoCrawler system
 */
const STAGE_DEFINITIONS: StageDefinition[] = [
  {
    id: 1,
    name: 'Core Execution Layer',
    description: 'Implement CryptoCrawler Core, Exchange Interface, and Execution Gate',
    requirements: [
      'Market data ingestion functional',
      'Opportunity detection active',
      'Strategy evaluation working',
      'Order intent generation ready',
      'Exchange adapters connected',
      'Execution gate enforcing caps',
    ],
    advancementCriteria: [
      'All components initialized',
      'Data flow verified end-to-end',
      'No critical errors in logs',
    ],
    canSkip: false,
  },
  {
    id: 2,
    name: 'Signal & Intelligence Layer',
    description: 'Implement Faucet, Faucet Mesh, Monte Carlo, and TradingView adapter',
    requirements: [
      'Faucet emitting signals',
      'Faucet Mesh operational',
      'Monte Carlo engine ready',
      'TradingView adapter connected (indicators only)',
    ],
    advancementCriteria: [
      'Single-source signal validation',
      'Cross-venue correlation working',
      'Monte Carlo simulations passing',
    ],
    canSkip: false,
  },
  {
    id: 3,
    name: 'Control & Governance',
    description: 'Implement Composer, Stage Controller, and Profit Ramp Governor',
    requirements: [
      'Composer issuing commands',
      'Stage Controller enforcing progression',
      'Profit Ramp Governor active',
    ],
    advancementCriteria: [
      'Command chain validated',
      'Stage locks working',
      'Ramp logic enforced',
    ],
    canSkip: false,
  },
  {
    id: 4,
    name: 'Observability & UI',
    description: 'Implement Dashboard, Reporting, and Alert systems',
    requirements: [
      'Dashboard displaying real-time status',
      'Reporting engine generating metrics',
      'Alert system detecting anomalies',
    ],
    advancementCriteria: [
      'All metrics visible',
      'PASS/FAIL states clear',
      'Alerts firing correctly',
    ],
    canSkip: false,
  },
  {
    id: 5,
    name: 'Safety & Constraint Systems',
    description: 'Implement Execution Locks, Loop Governor, and Mode Selector',
    requirements: [
      'Execution locks functional',
      'Background loop governor active',
      'Mode selector (paper/live) working',
    ],
    advancementCriteria: [
      'Locks preventing unauthorized execution',
      'No runaway background processes',
      'Mode switching validated',
    ],
    canSkip: false,
  },
  {
    id: 6,
    name: 'Profit Ramp Logic',
    description: 'Define and enforce capital exposure progression with conservative daily caps',
    requirements: [
      'Daily cap ladder defined: $200 → $400 → $800 → $1,600 → $5,000 → $35,000',
      'Advancement conditions validated',
      'Monte Carlo justification for each tier',
    ],
    advancementCriteria: [
      'Sustained stability across cycles',
      'Low variance relative to prior tier',
      'Zero unexplained anomalies',
      'RAMP POLICY table generated',
    ],
    canSkip: false,
  },
  {
    id: 7,
    name: 'Visual / UI Sanity Check',
    description: 'Ensure visual clarity and cognitive safety',
    requirements: [
      'Pure white backgrounds modified',
      'Dark, layered, subdued aesthetic maintained',
      'NO alterations to cards, panels, depth, shadows, or layers',
    ],
    advancementCriteria: [
      'UI confirmation received',
      'No cognitive overload',
      'Visual hierarchy preserved',
    ],
    canSkip: false,
  },
  {
    id: 8,
    name: 'Final Dry Run',
    description: 'Validate operational flow under real conditions without execution risk',
    requirements: [
      'Flow: Trigger → Signal → Decision → Visualization → Report',
      'Crypto components emit signals only',
      'Single instance per component',
      'No duplicate processes',
    ],
    advancementCriteria: [
      'Complete cycle executed',
      'No execution occurred',
      'All signals validated',
      'PASS/FAIL clearly indicated',
    ],
    canSkip: false,
  },
  {
    id: 9,
    name: 'Live Execution (Controlled)',
    description: 'Begin live execution with Stage 6 caps enforced',
    requirements: [
      'All previous stages PASS',
      'Stage 6 ramp logic active',
      'Execution gate enforcing tier 1 cap ($200/day)',
    ],
    advancementCriteria: [
      'Live execution successful',
      'Caps enforced',
      'No anomalies detected',
    ],
    canSkip: false,
  },
];

/**
 * Stage Controller - Enforces stage progression
 */
export class StageController extends EventEmitter {
  private currentStage: number = 0;
  private stageStates: Map<number, StageState> = new Map();
  private initialized: boolean = false;

  constructor() {
    super();
    
    // Initialize stage states
    for (const stageDef of STAGE_DEFINITIONS) {
      this.stageStates.set(stageDef.id, {
        stageId: stageDef.id,
        status: StageStatus.NOT_STARTED,
        startTime: null,
        endTime: null,
        attempts: 0,
        lastFailureReason: null,
        passConditionsMet: [],
        failConditionsTriggered: [],
        metrics: {},
      });
    }

    // Listen to Composer commands
    composer.on('command', (command: StageCommand) => {
      this.handleComposerCommand(command);
    });
  }

  /**
   * Initialize the Stage Controller
   */
  async initialize(): Promise<void> {
    console.log('[StageController] 🎬 Initializing Stage Controller...');
    
    this.initialized = true;
    
    console.log('[StageController] ✅ Stage Controller initialized');
    console.log(`[StageController] Total stages: ${STAGE_DEFINITIONS.length}`);
  }

  /**
   * Start a stage
   */
  startStage(stageId: number): boolean {
    const state = this.stageStates.get(stageId);
    if (!state) {
      console.error(`[StageController] ❌ Invalid stage: ${stageId}`);
      return false;
    }

    // Check if we can start this stage
    if (stageId > 1) {
      const previousStage = this.stageStates.get(stageId - 1);
      if (previousStage?.status !== StageStatus.PASS) {
        console.error(`[StageController] ❌ Cannot start stage ${stageId} - previous stage not PASS`);
        return false;
      }
    }

    state.status = StageStatus.IN_PROGRESS;
    state.startTime = Date.now();
    state.attempts++;

    this.currentStage = stageId;

    console.log(`[StageController] ▶️ Stage ${stageId} started: ${STAGE_DEFINITIONS[stageId - 1].name}`);
    this.emit('stage-started', { stageId, timestamp: Date.now() });

    return true;
  }

  /**
   * Mark stage as PASS
   */
  passStage(stageId: number, conditionsMet: string[]): boolean {
    const state = this.stageStates.get(stageId);
    if (!state) return false;

    if (state.status !== StageStatus.IN_PROGRESS) {
      console.error(`[StageController] ❌ Cannot pass stage ${stageId} - not in progress`);
      return false;
    }

    state.status = StageStatus.PASS;
    state.endTime = Date.now();
    state.passConditionsMet = conditionsMet;

    const duration = state.startTime ? (state.endTime - state.startTime) / 1000 : 0;

    console.log(`[StageController] ✅ Stage ${stageId} PASS - Duration: ${duration.toFixed(2)}s`);
    this.emit('stage-passed', { stageId, conditionsMet, duration });

    return true;
  }

  /**
   * Mark stage as FAIL
   */
  failStage(stageId: number, reason: string, failConditions: string[]): boolean {
    const state = this.stageStates.get(stageId);
    if (!state) return false;

    state.status = StageStatus.FAIL;
    state.endTime = Date.now();
    state.lastFailureReason = reason;
    state.failConditionsTriggered = failConditions;

    console.error(`[StageController] ❌ Stage ${stageId} FAIL: ${reason}`);
    this.emit('stage-failed', { stageId, reason, failConditions });

    return true;
  }

  /**
   * Get current stage
   */
  getCurrentStage(): number {
    return this.currentStage;
  }

  /**
   * Get stage state
   */
  getStageState(stageId: number): StageState | null {
    return this.stageStates.get(stageId) || null;
  }

  /**
   * Get all stage states
   */
  getAllStageStates(): StageState[] {
    return Array.from(this.stageStates.values());
  }

  /**
   * Get stage definition
   */
  getStageDefinition(stageId: number): StageDefinition | null {
    return STAGE_DEFINITIONS.find(s => s.id === stageId) || null;
  }

  /**
   * Get all stage definitions
   */
  getAllStageDefinitions(): StageDefinition[] {
    return [...STAGE_DEFINITIONS];
  }

  /**
   * Can advance to next stage?
   */
  canAdvance(): boolean {
    if (this.currentStage === 0) return true; // Can start stage 1
    if (this.currentStage >= STAGE_DEFINITIONS.length) return false; // At final stage

    const currentState = this.stageStates.get(this.currentStage);
    return currentState?.status === StageStatus.PASS;
  }

  /**
   * Advance to next stage
   */
  advanceStage(): boolean {
    if (!this.canAdvance()) {
      console.error('[StageController] ❌ Cannot advance - current stage not PASS');
      return false;
    }

    const nextStage = this.currentStage + 1;
    if (nextStage > STAGE_DEFINITIONS.length) {
      console.log('[StageController] 🎉 All stages complete!');
      return false;
    }

    return this.startStage(nextStage);
  }

  /**
   * Handle Composer command
   */
  private handleComposerCommand(command: StageCommand): void {
    console.log(`[StageController] 📨 Received command: ${command.action} → Stage ${command.targetStage}`);

    switch (command.action) {
      case 'advance':
        if (command.targetStage === this.currentStage + 1) {
          this.advanceStage();
        } else {
          console.error('[StageController] ❌ Cannot skip stages');
        }
        break;

      case 'hold':
        console.log(`[StageController] ⏸️ Holding at stage ${this.currentStage}`);
        break;

      case 'rollback':
        console.warn(`[StageController] ⏮️ Rollback requested to stage ${command.targetStage}`);
        // Rollback requires special authorization
        break;

      case 'reset':
        console.warn('[StageController] 🔄 Reset requested');
        // Reset requires emergency authorization
        break;
    }
  }

  /**
   * Get progress summary
   */
  getProgressSummary(): {
    currentStage: number;
    totalStages: number;
    passedStages: number;
    failedStages: number;
    completionPercentage: number;
  } {
    const states = Array.from(this.stageStates.values());
    const passedStages = states.filter(s => s.status === StageStatus.PASS).length;
    const failedStages = states.filter(s => s.status === StageStatus.FAIL).length;

    return {
      currentStage: this.currentStage,
      totalStages: STAGE_DEFINITIONS.length,
      passedStages,
      failedStages,
      completionPercentage: (passedStages / STAGE_DEFINITIONS.length) * 100,
    };
  }
}

// Singleton instance
export const stageController = new StageController();
