/**
 * Stage Governor Control Panel
 * 
 * Dashboard component for controlling the CryptoCrawler staged autonomy system
 * 
 * Features:
 * - Stage status display
 * - UNPAUSE/PAUSE controls
 * - Kill switch controls
 * - Profit ladder visualization
 * - Risk metrics display
 * - Advisory cycle history
 */

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Play,
  Pause,
  AlertTriangle,
  Shield,
  Target,
  TrendingUp,
  Lock,
  Unlock,
  Activity,
  AlertOctagon,
  ChevronRight,
  CheckCircle,
  XCircle,
  Clock,
  DollarSign,
  Loader2,
  RefreshCw,
  Zap,
  Brain,
  Scale,
  Gauge,
} from "lucide-react";

// Types
interface StageState {
  currentStage: number;
  status: 'locked' | 'paused' | 'active' | 'completed' | 'emergency_locked';
  lastPause: number | null;
  lastUnpause: number | null;
  cyclesCompleted: number;
  profitThisStage: number;
  anomalyCount: number;
  emergencyLockEngaged: boolean;
  killSwitchArmed: boolean;
}

interface StageConfig {
  stage: number;
  name: string;
  description: string;
  mode: string;
  dailyProfitTarget: number;
  maxDailyProfit: number;
  executionAuthority: string;
  evolutionLock: boolean;
  memoryPartitioned: boolean;
  autoPauseEnabled: boolean;
  requirements: Array<{
    type: string;
    description: string;
    threshold: number;
    currentValue?: number;
    met: boolean;
  }>;
}

interface ProfitLadderTier {
  tier: number;
  minProfit: number;
  maxProfit: number;
  requiredSuccessRate: number;
  requiredDays: number;
  unlocked: boolean;
}

interface RiskMetrics {
  currentCapitalAtRisk: number;
  currentPositionCount: number;
  dailyPnL: number;
  hourlyPnL: number;
  consecutiveLosses: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  currentDrawdown: number;
  kellyRecommendedSize: number;
  utilizationPercent: number;
}

interface CircuitBreakerState {
  status: 'closed' | 'half-open' | 'open';
  lastTriggered: number | null;
  triggerCount: number;
  cooldownEnds: number | null;
  halfOpenAttempts: number;
}

interface GovernanceStatus {
  stageStatus: {
    state: StageState;
    config: StageConfig;
    canExecute: { allowed: boolean; reason: string };
    advancementStatus: { ready: boolean; unmetRequirements: string[] };
    profitLadder: ProfitLadderTier[];
    uncertainties: string[];
    evolutionLock: boolean;
    killSwitchArmed: boolean;
  };
  riskStatus: {
    metrics: RiskMetrics;
    circuitBreaker: CircuitBreakerState;
    canTrade: boolean;
    tradingRestrictions: string[];
  };
}

// Stage configurations for display
const STAGE_INFO = {
  1: { color: 'bg-blue-500', icon: Brain, label: 'Advisory' },
  2: { color: 'bg-yellow-500', icon: Target, label: 'Proof' },
  3: { color: 'bg-orange-500', icon: Gauge, label: 'Dry-Run' },
  4: { color: 'bg-purple-500', icon: Lock, label: 'Limited' },
  5: { color: 'bg-green-500', icon: Scale, label: 'Supervised' },
  6: { color: 'bg-emerald-500', icon: Zap, label: 'Autonomous' },
};

export default function StageGovernorPanel() {
  const { toast } = useToast();
  
  // State
  const [loading, setLoading] = useState(true);
  const [governanceStatus, setGovernanceStatus] = useState<GovernanceStatus | null>(null);
  const [unpauseAuthority, setUnpauseAuthority] = useState('');
  const [pauseReason, setPauseReason] = useState('');
  const [killReason, setKillReason] = useState('');
  const [confirmReset, setConfirmReset] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Fetch governance status
  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/governance/status', {
        method: 'GET',
        credentials: 'include',
      });
      
      if (response.ok) {
        const data = await response.json();
        setGovernanceStatus(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch governance status:', error);
    } finally {
      setLoading(false);
    }
  }, []);
  
  // Initial fetch and polling
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchStatus]);
  
  // UNPAUSE handler
  const handleUnpause = async () => {
    if (!unpauseAuthority.trim()) {
      toast({
        title: "Authority Required",
        description: "Please enter your authority identifier",
        variant: "destructive",
      });
      return;
    }
    
    setIsProcessing(true);
    try {
      const response = await fetch('/api/governance/unpause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          stage: governanceStatus?.stageStatus.state.currentStage || 1,
          scope: [],
          duration: 0,
          authority: unpauseAuthority,
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        toast({
          title: "System UNPAUSED",
          description: data.message,
        });
        fetchStatus();
        setUnpauseAuthority('');
      } else {
        toast({
          title: "UNPAUSE Failed",
          description: data.message || data.error,
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to process UNPAUSE request",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };
  
  // PAUSE handler
  const handlePause = async () => {
    if (!pauseReason.trim()) {
      toast({
        title: "Reason Required",
        description: "Please enter a reason for pausing",
        variant: "destructive",
      });
      return;
    }
    
    setIsProcessing(true);
    try {
      const response = await fetch('/api/governance/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          reason: pauseReason,
          authority: unpauseAuthority || 'dashboard_user',
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        toast({
          title: "System PAUSED",
          description: "System has been paused",
        });
        fetchStatus();
        setPauseReason('');
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to pause system",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };
  
  // Kill switch handler
  const handleKillSwitch = async () => {
    if (!killReason.trim()) {
      toast({
        title: "Reason Required",
        description: "Please enter a reason for engaging kill switch",
        variant: "destructive",
      });
      return;
    }
    
    setIsProcessing(true);
    try {
      const response = await fetch('/api/governance/kill-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          reason: killReason,
          authority: unpauseAuthority || 'dashboard_user',
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        toast({
          title: "KILL SWITCH ENGAGED",
          description: "System has been emergency halted",
          variant: "destructive",
        });
        fetchStatus();
        setKillReason('');
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to engage kill switch",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };
  
  // Reset kill switch handler
  const handleResetKillSwitch = async () => {
    if (confirmReset !== 'CONFIRM_KILL_SWITCH_RESET') {
      toast({
        title: "Invalid Confirmation",
        description: "Please enter the exact confirmation code",
        variant: "destructive",
      });
      return;
    }
    
    setIsProcessing(true);
    try {
      const response = await fetch('/api/governance/reset-kill-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          authority: unpauseAuthority || 'dashboard_user',
          confirmation: confirmReset,
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        toast({
          title: "Kill Switch Reset",
          description: data.message,
        });
        fetchStatus();
        setConfirmReset('');
      } else {
        toast({
          title: "Reset Failed",
          description: data.message || data.error,
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to reset kill switch",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };
  
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-orange-400" />
      </div>
    );
  }
  
  if (!governanceStatus) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>Failed to load governance status</AlertDescription>
      </Alert>
    );
  }
  
  const { stageStatus, riskStatus } = governanceStatus;
  const currentStage = stageStatus.state.currentStage as keyof typeof STAGE_INFO;
  const stageInfo = STAGE_INFO[currentStage];
  const StageIcon = stageInfo?.icon || Brain;
  
  return (
    <div className="space-y-6">
      {/* Stage Overview */}
      <Card className="bg-gray-800/50 border-white/10">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-3 rounded-lg ${stageInfo?.color || 'bg-gray-500'}`}>
                <StageIcon className="w-6 h-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-white flex items-center gap-2">
                  Stage {stageStatus.state.currentStage}: {stageStatus.config.name}
                  <Badge className={
                    stageStatus.state.status === 'active' ? 'bg-green-500/20 text-green-300' :
                    stageStatus.state.status === 'paused' ? 'bg-yellow-500/20 text-yellow-300' :
                    stageStatus.state.status === 'emergency_locked' ? 'bg-red-500/20 text-red-300' :
                    'bg-gray-500/20 text-gray-300'
                  }>
                    {stageStatus.state.status.toUpperCase()}
                  </Badge>
                </CardTitle>
                <CardDescription className="text-gray-400">
                  {stageStatus.config.description}
                </CardDescription>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={fetchStatus}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 rounded-lg bg-white/5">
              <p className="text-sm text-gray-400">Mode</p>
              <p className="text-lg font-medium text-white capitalize">{stageStatus.config.mode}</p>
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <p className="text-sm text-gray-400">Daily Target</p>
              <p className="text-lg font-medium text-green-400">${stageStatus.config.dailyProfitTarget.toLocaleString()}</p>
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <p className="text-sm text-gray-400">Today's Profit</p>
              <p className={`text-lg font-medium ${stageStatus.state.profitThisStage >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                ${stageStatus.state.profitThisStage.toLocaleString()}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <p className="text-sm text-gray-400">Execution Authority</p>
              <p className="text-lg font-medium text-white capitalize">{stageStatus.config.executionAuthority}</p>
            </div>
          </div>
          
          {/* Progress to daily target */}
          <div className="mt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Daily Progress</span>
              <span className="text-white">
                ${stageStatus.state.profitThisStage.toLocaleString()} / ${stageStatus.config.dailyProfitTarget.toLocaleString()}
              </span>
            </div>
            <Progress 
              value={(stageStatus.state.profitThisStage / stageStatus.config.dailyProfitTarget) * 100} 
              className="h-2 bg-gray-700" 
            />
          </div>
          
          {/* Execution status */}
          <div className="mt-4 p-3 rounded-lg bg-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {stageStatus.canExecute.allowed ? (
                <CheckCircle className="w-5 h-5 text-green-400" />
              ) : (
                <XCircle className="w-5 h-5 text-red-400" />
              )}
              <span className="text-white">
                {stageStatus.canExecute.allowed ? 'Execution Allowed' : 'Execution Blocked'}
              </span>
            </div>
            <span className="text-sm text-gray-400">{stageStatus.canExecute.reason}</span>
          </div>
        </CardContent>
      </Card>
      
      {/* Control Panel */}
      <Card className="bg-gray-800/50 border-white/10">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-orange-400" />
            Stage Control
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="unpause" className="space-y-4">
            <TabsList className="bg-gray-900/50">
              <TabsTrigger value="unpause">UNPAUSE</TabsTrigger>
              <TabsTrigger value="pause">PAUSE</TabsTrigger>
              <TabsTrigger value="killswitch">Kill Switch</TabsTrigger>
            </TabsList>
            
            <TabsContent value="unpause" className="space-y-4">
              <div className="p-4 rounded-lg bg-green-900/20 border border-green-500/30">
                <h4 className="text-green-300 font-medium mb-2">UNPAUSE System</h4>
                <p className="text-sm text-gray-400 mb-4">
                  Resume operations with explicit authorization. Requires authority identifier.
                </p>
                <div className="space-y-3">
                  <div>
                    <Label className="text-gray-300">Authority Identifier</Label>
                    <Input
                      value={unpauseAuthority}
                      onChange={(e) => setUnpauseAuthority(e.target.value)}
                      placeholder="Your name or role"
                      className="bg-gray-900/50 border-white/10 text-white"
                    />
                  </div>
                  <Button
                    onClick={handleUnpause}
                    disabled={isProcessing || stageStatus.state.status === 'active'}
                    className="w-full bg-green-600 hover:bg-green-700"
                  >
                    {isProcessing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                    UNPAUSE Stage {stageStatus.state.currentStage}
                  </Button>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="pause" className="space-y-4">
              <div className="p-4 rounded-lg bg-yellow-900/20 border border-yellow-500/30">
                <h4 className="text-yellow-300 font-medium mb-2">PAUSE System</h4>
                <p className="text-sm text-gray-400 mb-4">
                  Pause operations immediately. This action always succeeds.
                </p>
                <div className="space-y-3">
                  <div>
                    <Label className="text-gray-300">Pause Reason</Label>
                    <Input
                      value={pauseReason}
                      onChange={(e) => setPauseReason(e.target.value)}
                      placeholder="Reason for pausing"
                      className="bg-gray-900/50 border-white/10 text-white"
                    />
                  </div>
                  <Button
                    onClick={handlePause}
                    disabled={isProcessing || stageStatus.state.status !== 'active'}
                    className="w-full bg-yellow-600 hover:bg-yellow-700"
                  >
                    {isProcessing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Pause className="w-4 h-4 mr-2" />}
                    PAUSE System
                  </Button>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="killswitch" className="space-y-4">
              <div className="p-4 rounded-lg bg-red-900/20 border border-red-500/30">
                <h4 className="text-red-300 font-medium mb-2 flex items-center gap-2">
                  <AlertOctagon className="w-5 h-5" />
                  KILL SWITCH
                </h4>
                <p className="text-sm text-gray-400 mb-4">
                  Emergency halt all operations. Requires manual reset.
                </p>
                
                {stageStatus.state.emergencyLockEngaged ? (
                  <div className="space-y-3">
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Kill Switch Engaged</AlertTitle>
                      <AlertDescription>
                        System is in emergency lock. Enter confirmation code to reset.
                      </AlertDescription>
                    </Alert>
                    <div>
                      <Label className="text-gray-300">Confirmation Code</Label>
                      <Input
                        value={confirmReset}
                        onChange={(e) => setConfirmReset(e.target.value)}
                        placeholder="CONFIRM_KILL_SWITCH_RESET"
                        className="bg-gray-900/50 border-white/10 text-white font-mono"
                      />
                    </div>
                    <Button
                      onClick={handleResetKillSwitch}
                      disabled={isProcessing}
                      className="w-full bg-blue-600 hover:bg-blue-700"
                    >
                      {isProcessing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Unlock className="w-4 h-4 mr-2" />}
                      Reset Kill Switch
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <Label className="text-gray-300">Emergency Reason</Label>
                      <Input
                        value={killReason}
                        onChange={(e) => setKillReason(e.target.value)}
                        placeholder="Reason for emergency halt"
                        className="bg-gray-900/50 border-white/10 text-white"
                      />
                    </div>
                    <Button
                      onClick={handleKillSwitch}
                      disabled={isProcessing}
                      variant="destructive"
                      className="w-full"
                    >
                      {isProcessing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <AlertOctagon className="w-4 h-4 mr-2" />}
                      ENGAGE KILL SWITCH
                    </Button>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
      
      {/* Stage Requirements */}
      <Card className="bg-gray-800/50 border-white/10">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Target className="w-5 h-5 text-purple-400" />
            Stage Requirements
          </CardTitle>
          <CardDescription className="text-gray-400">
            Requirements to advance to next stage
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {stageStatus.config.requirements.map((req, index) => (
              <div key={index} className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                <div className="flex items-center gap-3">
                  {req.met ? (
                    <CheckCircle className="w-5 h-5 text-green-400" />
                  ) : (
                    <Clock className="w-5 h-5 text-yellow-400" />
                  )}
                  <div>
                    <p className="text-white">{req.description}</p>
                    <p className="text-sm text-gray-400">Type: {req.type}</p>
                  </div>
                </div>
                <Badge className={req.met ? 'bg-green-500/20 text-green-300' : 'bg-yellow-500/20 text-yellow-300'}>
                  {req.met ? 'Met' : `${req.currentValue ?? 0} / ${req.threshold}`}
                </Badge>
              </div>
            ))}
          </div>
          
          {stageStatus.advancementStatus.ready && (
            <Alert className="mt-4 bg-green-900/20 border-green-500/30">
              <CheckCircle className="h-4 w-4 text-green-400" />
              <AlertTitle className="text-green-300">Ready to Advance</AlertTitle>
              <AlertDescription className="text-gray-400">
                All requirements met. Submit UNPAUSE request with stage={stageStatus.state.currentStage + 1} to advance.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
      
      {/* Risk Metrics */}
      <Card className="bg-gray-800/50 border-white/10">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-400" />
            Risk Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 rounded-lg bg-white/5">
              <p className="text-sm text-gray-400">Daily P&L</p>
              <p className={`text-lg font-medium ${riskStatus.metrics.dailyPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                ${riskStatus.metrics.dailyPnL.toFixed(2)}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <p className="text-sm text-gray-400">Win Rate</p>
              <p className="text-lg font-medium text-white">{(riskStatus.metrics.winRate * 100).toFixed(1)}%</p>
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <p className="text-sm text-gray-400">Sharpe Ratio</p>
              <p className="text-lg font-medium text-white">{riskStatus.metrics.sharpeRatio.toFixed(2)}</p>
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <p className="text-sm text-gray-400">Consecutive Losses</p>
              <p className={`text-lg font-medium ${riskStatus.metrics.consecutiveLosses > 2 ? 'text-red-400' : 'text-white'}`}>
                {riskStatus.metrics.consecutiveLosses}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <p className="text-sm text-gray-400">Capital at Risk</p>
              <p className="text-lg font-medium text-orange-400">${riskStatus.metrics.currentCapitalAtRisk.toFixed(2)}</p>
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <p className="text-sm text-gray-400">Utilization</p>
              <p className="text-lg font-medium text-white">{riskStatus.metrics.utilizationPercent.toFixed(1)}%</p>
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <p className="text-sm text-gray-400">Circuit Breaker</p>
              <Badge className={
                riskStatus.circuitBreaker.status === 'closed' ? 'bg-green-500/20 text-green-300' :
                riskStatus.circuitBreaker.status === 'half-open' ? 'bg-yellow-500/20 text-yellow-300' :
                'bg-red-500/20 text-red-300'
              }>
                {riskStatus.circuitBreaker.status.toUpperCase()}
              </Badge>
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <p className="text-sm text-gray-400">Can Trade</p>
              {riskStatus.canTrade ? (
                <CheckCircle className="w-6 h-6 text-green-400" />
              ) : (
                <XCircle className="w-6 h-6 text-red-400" />
              )}
            </div>
          </div>
          
          {/* Trading restrictions */}
          {riskStatus.tradingRestrictions.length > 0 && (
            <Alert className="mt-4 bg-red-900/20 border-red-500/30">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <AlertTitle className="text-red-300">Trading Restrictions</AlertTitle>
              <AlertDescription className="text-gray-400">
                <ul className="list-disc list-inside mt-2">
                  {riskStatus.tradingRestrictions.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
      
      {/* Profit Ladder */}
      <Card className="bg-gray-800/50 border-white/10">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-green-400" />
            Profit Ladder
          </CardTitle>
          <CardDescription className="text-gray-400">
            Progressive profit tiers: $200/day → $35,000/day
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {stageStatus.profitLadder.map((tier) => (
              <div 
                key={tier.tier} 
                className={`flex items-center justify-between p-3 rounded-lg ${
                  tier.unlocked ? 'bg-green-900/20 border border-green-500/30' : 'bg-white/5'
                }`}
              >
                <div className="flex items-center gap-3">
                  {tier.unlocked ? (
                    <Unlock className="w-5 h-5 text-green-400" />
                  ) : (
                    <Lock className="w-5 h-5 text-gray-400" />
                  )}
                  <div>
                    <p className={`font-medium ${tier.unlocked ? 'text-green-300' : 'text-gray-400'}`}>
                      Tier {tier.tier}
                    </p>
                    <p className="text-sm text-gray-500">
                      ${tier.minProfit.toLocaleString()} - ${tier.maxProfit.toLocaleString()}/day
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-400">{(tier.requiredSuccessRate * 100).toFixed(0)}% success rate</p>
                  <p className="text-sm text-gray-500">{tier.requiredDays} days required</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      
      {/* Global Rules */}
      <Card className="bg-gray-800/50 border-white/10">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Scale className="w-5 h-5 text-yellow-400" />
            Global Rules
          </CardTitle>
          <CardDescription className="text-gray-400">
            Immutable rules that apply to all stages
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {globalRules.map((rule, index) => (
              <div key={index} className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
                <ChevronRight className="w-4 h-4 text-yellow-400" />
                <span className="text-gray-300">{rule}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      
      {/* Uncertainties */}
      {stageStatus.uncertainties.length > 0 && (
        <Alert className="bg-orange-900/20 border-orange-500/30">
          <AlertTriangle className="h-4 w-4 text-orange-400" />
          <AlertTitle className="text-orange-300">Pending Uncertainties</AlertTitle>
          <AlertDescription className="text-gray-400">
            The following uncertainties require human resolution:
            <ul className="list-disc list-inside mt-2">
              {stageStatus.uncertainties.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
