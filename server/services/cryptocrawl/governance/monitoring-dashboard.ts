/**
 * MONITORING DASHBOARD
 * 
 * Real-time monitoring and visualization for the 6-stage governance system
 * 
 * Features:
 * - Stage progression tracking
 * - Profitability metrics
 * - Risk indicators
 * - Performance charts
 * - Alert management
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../../logger';
import { stageManager, Stage, STAGE_CONFIGS } from './stage-management';
import { riskGovernor } from './risk-governor';
import { killSwitch } from './kill-switch';
import { profitLadder, PROFIT_TIERS } from './profit-ladder';
import { composer } from './composer-interface';

const log = createLogger('MonitoringDashboard');

// ============================================================================
// DASHBOARD DATA TYPES
// ============================================================================

export interface DashboardData {
  timestamp: number;
  
  // System Overview
  overview: {
    currentStage: number;
    stageName: string;
    isPaused: boolean;
    pauseReason?: string;
    uptime: number;
    systemHealth: 'healthy' | 'warning' | 'critical';
  };
  
  // Profit Tracking
  profitMetrics: {
    dailyProfit: number;
    dailyTarget: number;
    dailyMax: number;
    totalProfit: number;
    tier: string;
    tierProgress: number; // 0-100
    avgDailyProfit: number;
    bestDay: number;
    worstDay: number;
  };
  
  // Performance Metrics
  performance: {
    successRate: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winningTrades: number;
    losingTrades: number;
    totalTrades: number;
    approvalRate: number;
  };
  
  // Risk Status
  risk: {
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    circuitBreakersTripped: number;
    anomalyCount: number;
    currentDrawdown: number;
    maxDrawdownLimit: number;
  };
  
  // Advancement Progress
  advancement: {
    readyForNextStage: boolean;
    readyForNextTier: boolean;
    daysInCurrentTier: number;
    daysAtTarget: number;
    daysRequired: number;
    blockers: string[];
  };
  
  // Alerts
  alerts: Alert[];
}

export interface Alert {
  id: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  category: 'stage' | 'profit' | 'risk' | 'system';
  message: string;
  timestamp: number;
  acknowledged: boolean;
}

// ============================================================================
// MONITORING DASHBOARD
// ============================================================================

export class MonitoringDashboard extends EventEmitter {
  private static instance: MonitoringDashboard | null = null;
  private alerts: Alert[] = [];
  private startTime: number = Date.now();
  private updateInterval?: NodeJS.Timeout;
  
  private constructor() {
    super();
    
    this.setupAlertListeners();
  }
  
  static getInstance(): MonitoringDashboard {
    if (!MonitoringDashboard.instance) {
      MonitoringDashboard.instance = new MonitoringDashboard();
    }
    return MonitoringDashboard.instance;
  }
  
  /**
   * Start monitoring dashboard
   */
  start(updateIntervalMs: number = 5000): void {
    if (this.updateInterval) {
      log.warn('Dashboard already running');
      return;
    }
    
    log.info('Starting monitoring dashboard', { updateIntervalMs });
    
    this.updateInterval = setInterval(() => {
      this.emitUpdate();
    }, updateIntervalMs);
    
    // Emit initial update
    this.emitUpdate();
  }
  
  /**
   * Stop monitoring dashboard
   */
  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
      log.info('Monitoring dashboard stopped');
    }
  }
  
  /**
   * Get current dashboard data
   */
  getDashboardData(): DashboardData {
    const systemStatus = composer.getSystemStatus();
    const tierPerformance = profitLadder.getCurrentPerformance();
    const progressSummary = profitLadder.getProgressSummary();
    const currentTier = profitLadder.getCurrentTier();
    const circuitBreakers = riskGovernor.getAllCircuitBreakers();
    
    // Calculate system health
    const systemHealth = this.calculateSystemHealth();
    
    // Calculate risk level
    const riskLevel = this.calculateRiskLevel();
    
    return {
      timestamp: Date.now(),
      
      overview: {
        currentStage: systemStatus.currentStage,
        stageName: systemStatus.stageName,
        isPaused: systemStatus.isPaused,
        pauseReason: systemStatus.pauseReason,
        uptime: Date.now() - this.startTime,
        systemHealth,
      },
      
      profitMetrics: {
        dailyProfit: systemStatus.dailyProfit,
        dailyTarget: currentTier.targetDailyProfitUSD,
        dailyMax: currentTier.maxDailyProfitUSD,
        totalProfit: systemStatus.totalProfit,
        tier: currentTier.name,
        tierProgress: progressSummary.percentToGoal,
        avgDailyProfit: tierPerformance?.avgDailyProfit || 0,
        bestDay: tierPerformance?.bestDayProfit || 0,
        worstDay: tierPerformance?.worstDayProfit || 0,
      },
      
      performance: {
        successRate: systemStatus.proofMetrics.successRate,
        sharpeRatio: systemStatus.proofMetrics.sharpeRatio,
        maxDrawdown: systemStatus.proofMetrics.maxDrawdown,
        winningTrades: systemStatus.proofMetrics.winningTrades,
        losingTrades: systemStatus.proofMetrics.losingTrades,
        totalTrades: systemStatus.proofMetrics.totalTrades,
        approvalRate: systemStatus.approvalRate,
      },
      
      risk: {
        riskLevel,
        circuitBreakersTripped: circuitBreakers.filter(b => b.isTripped).length,
        anomalyCount: stageManager.getState().anomalyCount,
        currentDrawdown: systemStatus.currentDrawdown,
        maxDrawdownLimit: currentTier.maxDrawdownPercent,
      },
      
      advancement: {
        readyForNextStage: systemStatus.proofMetrics.meetsAdvancementCriteria,
        readyForNextTier: progressSummary.readyForNextTier,
        daysInCurrentTier: progressSummary.daysInTier,
        daysAtTarget: progressSummary.daysAtTarget,
        daysRequired: currentTier.daysRequiredAtTarget,
        blockers: progressSummary.blockers,
      },
      
      alerts: this.getActiveAlerts(),
    };
  }
  
  /**
   * Calculate overall system health
   */
  private calculateSystemHealth(): 'healthy' | 'warning' | 'critical' {
    const killSwitchState = killSwitch.getState();
    const circuitBreakers = riskGovernor.getAllCircuitBreakers();
    const state = stageManager.getState();
    
    // Critical conditions
    if (killSwitchState.isActive) return 'critical';
    if (circuitBreakers.some(b => b.isTripped)) return 'critical';
    if (state.isPaused && state.pauseReason?.includes('anomaly')) return 'critical';
    
    // Warning conditions
    if (state.anomalyCount > 5) return 'warning';
    if (state.currentDrawdownPercent > 10) return 'warning';
    
    return 'healthy';
  }
  
  /**
   * Calculate current risk level
   */
  private calculateRiskLevel(): 'low' | 'medium' | 'high' | 'critical' {
    const state = stageManager.getState();
    const config = stageManager.getStageConfig();
    
    const drawdownRatio = state.currentDrawdownPercent / config.maxDrawdownPercent;
    
    if (drawdownRatio > 0.9) return 'critical';
    if (drawdownRatio > 0.7) return 'high';
    if (drawdownRatio > 0.5) return 'medium';
    return 'low';
  }
  
  /**
   * Setup alert listeners
   */
  private setupAlertListeners(): void {
    // Stage events
    stageManager.on('paused', (data) => {
      this.addAlert({
        severity: data.reason.includes('Kill-switch') || data.reason.includes('Anomaly') ? 'critical' : 'warning',
        category: 'system',
        message: `System paused: ${data.reason}`,
      });
    });
    
    stageManager.on('stage-advanced', (data) => {
      this.addAlert({
        severity: 'info',
        category: 'stage',
        message: `Advanced to Stage ${data.currentStage}: ${STAGE_CONFIGS[data.currentStage as keyof typeof STAGE_CONFIGS].stageName}`,
      });
    });
    
    stageManager.on('anomaly-detected', (data) => {
      this.addAlert({
        severity: data.severity === 'critical' || data.severity === 'high' ? 'critical' : 'warning',
        category: 'risk',
        message: `Anomaly detected: ${data.reason}`,
      });
    });
    
    // Risk events
    riskGovernor.on('circuit-breaker-tripped', (data) => {
      this.addAlert({
        severity: 'critical',
        category: 'risk',
        message: `Circuit breaker tripped: ${data.name}`,
      });
    });
    
    // Kill-switch events
    killSwitch.on('kill-switch-activated', (data) => {
      this.addAlert({
        severity: 'critical',
        category: 'system',
        message: `Kill-switch activated: ${data.reason}`,
      });
    });
    
    // Profit ladder events
    profitLadder.on('tier-advanced', (data) => {
      this.addAlert({
        severity: 'info',
        category: 'profit',
        message: `Advanced to profit tier ${data.currentTier}: ${PROFIT_TIERS[data.currentTier].name}`,
      });
    });
    
    profitLadder.on('advancement-criteria-met', (data) => {
      this.addAlert({
        severity: 'info',
        category: 'profit',
        message: `Ready for tier advancement! Current performance meets all criteria.`,
      });
    });
  }
  
  /**
   * Add new alert
   */
  private addAlert(alert: Omit<Alert, 'id' | 'timestamp' | 'acknowledged'>): void {
    const fullAlert: Alert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      acknowledged: false,
      ...alert,
    };
    
    this.alerts.push(fullAlert);
    
    // Keep last 100 alerts
    if (this.alerts.length > 100) {
      this.alerts.shift();
    }
    
    log.info('Alert added', {
      severity: fullAlert.severity,
      category: fullAlert.category,
      message: fullAlert.message,
    });
    
    this.emit('alert', fullAlert);
  }
  
  /**
   * Get active (unacknowledged) alerts
   */
  private getActiveAlerts(): Alert[] {
    return this.alerts.filter(a => !a.acknowledged);
  }
  
  /**
   * Acknowledge alert
   */
  acknowledgeAlert(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      this.emit('alert-acknowledged', alert);
    }
  }
  
  /**
   * Emit dashboard update
   */
  private emitUpdate(): void {
    const data = this.getDashboardData();
    this.emit('update', data);
  }
  
  /**
   * Export dashboard state
   */
  exportState(): any {
    return {
      alerts: this.alerts,
      startTime: this.startTime,
      timestamp: Date.now(),
    };
  }
}

// Singleton instance
export const monitoringDashboard = MonitoringDashboard.getInstance();
