/**
 * CryptoCrawler Dashboard V2 - Clean Page Implementation
 * 
 * RULE 1: New route (/cryptocrawler-v2), new page component
 * RULE 2: No AppLayout, no feature guards, no auth gates, no global error boundary
 * RULE 3: Logic extracted to hooks, not copied wholesale
 * RULE 4: Functionality added incrementally (static UI → state → API → polling)
 * RULE 5: Old page untouched - this is the production future
 */

import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { 
  Activity, 
  TrendingUp, 
  DollarSign,
  Zap,
  Shield,
  AlertTriangle,
  Clock,
  BarChart3,
  Play,
  Pause,
  RefreshCw,
  Terminal,
  LineChart,
  Coins,
  Wallet,
  Send,
  Lock,
  Loader2,
  Power,
  StopCircle,
  ArrowLeft,
  Droplets,
  EyeOff,
  Brain,
  Gauge,
  Timer,
  Settings2,
  Target
} from "lucide-react";

// ============================================================================
// TYPES - Extracted for reuse
// ============================================================================

interface SystemStatus {
  running: boolean;
  cryptoCrawl: {
    enabled: boolean;
    gasOracle: boolean;
    balanceMonitor: boolean;
    networkHealth: boolean;
  };
  startedAt: string | null;
  uptime: number;
}

interface Stats {
  profit: {
    today: number;
    thisWeek: number;
    thisMonth: number;
    allTime: number;
  };
  trades: {
    total: number;
    successful: number;
    failed: number;
    successRate: string;
  };
}

interface FaucetStatus {
  enabled: boolean;
  mode: string;
  profitThisSession: number;
  profitThisHour: number;
  profitThisDay: number;
  dailyTarget: number;
  dailyTargetProgress: number;
  tradesThisHour: number;
  tradesThisDay: number;
  stealthLevel: number;
  healthScore: number;
  currentWindow: number;
  totalWindows: number;
  autoOptimize: boolean;
  profitableTimesOnly: boolean;
  antiDetectionEnabled: boolean;
}

interface ConsoleLog {
  timestamp: number;
  level: string;
  message: string;
}

// ============================================================================
// DEFAULT STATE
// ============================================================================

const DEFAULT_FAUCET_STATUS: FaucetStatus = {
  enabled: false,
  mode: 'unavailable',
  profitThisSession: 0,
  profitThisHour: 0,
  profitThisDay: 0,
  dailyTarget: 35000,
  dailyTargetProgress: 0,
  tradesThisHour: 0,
  tradesThisDay: 0,
  stealthLevel: 0,
  healthScore: 0,
  currentWindow: 0,
  totalWindows: 18,
  autoOptimize: true,
  profitableTimesOnly: true,
  antiDetectionEnabled: true,
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function CryptoCrawlerV2Dashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  // Core state
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [faucetStatus, setFaucetStatus] = useState<FaucetStatus>(DEFAULT_FAUCET_STATUS);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLog[]>([]);
  
  // Loading states
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);
  const [startingSystem, setStartingSystem] = useState(false);
  const [stoppingSystem, setStoppingSystem] = useState(false);
  const [togglingFaucet, setTogglingFaucet] = useState(false);

  // Console logging helper
  const addConsoleLog = useCallback((level: string, message: string) => {
    setConsoleLogs(prev => [{
      timestamp: Date.now(),
      level,
      message
    }, ...prev.slice(0, 99)]);
  }, []);

  // ============================================================================
  // API CALLS - Guarded, no redirects
  // ============================================================================

  const fetchStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const response = await fetch('/admin/crypto/status', {
        method: 'GET',
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setSystemStatus(data);
      } else {
        // Set default - no redirect
        setSystemStatus({
          running: false,
          cryptoCrawl: { enabled: false, gasOracle: false, balanceMonitor: false, networkHealth: false },
          startedAt: null,
          uptime: 0,
        });
        addConsoleLog('warn', `Status fetch returned ${response.status}`);
      }
    } catch (error) {
      addConsoleLog('error', `Network error: ${error instanceof Error ? error.message : 'Failed to connect'}`);
      setSystemStatus({
        running: false,
        cryptoCrawl: { enabled: false, gasOracle: false, balanceMonitor: false, networkHealth: false },
        startedAt: null,
        uptime: 0,
      });
    } finally {
      setLoadingStatus(false);
    }
  }, [addConsoleLog]);

  const fetchStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const response = await fetch('/api/crypto/stats', {
        method: 'GET',
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setStats(data);
        addConsoleLog('info', `Stats updated: ${data.trades?.total || 0} total trades`);
      }
    } catch (error) {
      addConsoleLog('error', 'Failed to fetch stats');
    } finally {
      setLoadingStats(false);
    }
  }, [addConsoleLog]);

  const fetchFaucetStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/crypto/faucet/status', {
        method: 'GET',
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setFaucetStatus(prev => ({ ...prev, ...data, enabled: data.enabled === true }));
        addConsoleLog('info', `[Faucet] Status: ${data.mode || 'unknown'}`);
      } else {
        setFaucetStatus(prev => ({ ...prev, enabled: false, mode: 'unavailable', healthScore: 0 }));
        addConsoleLog('warn', `[Faucet] Status unavailable (${response.status})`);
      }
    } catch (error) {
      setFaucetStatus(prev => ({ ...prev, enabled: false, mode: 'unavailable', healthScore: 0 }));
      addConsoleLog('warn', '[Faucet] Status unavailable');
    }
  }, [addConsoleLog]);

  const handleStartSystem = async () => {
    setStartingSystem(true);
    addConsoleLog('info', '[CryptoCrawler] Starting system...');
    try {
      const response = await fetch('/admin/crypto/start', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json();
      if (data.success) {
        toast({ title: "System Started", description: "CryptoCrawler is now running" });
        addConsoleLog('info', '[CryptoCrawler] ✓ System started');
        fetchStatus();
      } else {
        throw new Error(data.error || 'Failed to start');
      }
    } catch (error: any) {
      toast({ title: "Failed to Start", description: error.message, variant: "destructive" });
      addConsoleLog('error', `[CryptoCrawler] Failed: ${error.message}`);
    } finally {
      setStartingSystem(false);
    }
  };

  const handleStopSystem = async () => {
    setStoppingSystem(true);
    addConsoleLog('info', '[CryptoCrawler] Stopping system...');
    try {
      const response = await fetch('/admin/crypto/stop', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json();
      if (data.success) {
        toast({ title: "System Stopped", description: `Uptime: ${Math.floor(data.uptime / 1000)}s` });
        addConsoleLog('info', '[CryptoCrawler] ✓ System stopped');
        fetchStatus();
      } else {
        throw new Error(data.error || 'Failed to stop');
      }
    } catch (error: any) {
      toast({ title: "Failed to Stop", description: error.message, variant: "destructive" });
      addConsoleLog('error', `[CryptoCrawler] Failed: ${error.message}`);
    } finally {
      setStoppingSystem(false);
    }
  };

  const handleToggleFaucet = async (enabled: boolean) => {
    setTogglingFaucet(true);
    addConsoleLog('info', `[Faucet] ${enabled ? '🟢 Turning ON' : '🔴 Turning OFF'}...`);
    try {
      const response = await fetch('/api/crypto/faucet/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Faucet control request failed');
      }
      setFaucetStatus(prev => ({ ...prev, enabled: data.enabled === true, mode: data.enabled ? 'open' : 'closed' }));
      toast({
        title: enabled ? "Faucet activation requested" : "Faucet deactivation requested",
        description: "Refreshing backend status to confirm the loop state.",
      });
      addConsoleLog('info', `[Faucet] ${enabled ? 'Activation' : 'Deactivation'} requested`);
      await fetchFaucetStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast({ title: 'Faucet control failed', description: message, variant: 'destructive' });
      addConsoleLog('error', `[Faucet] Control failed: ${message}`);
    } finally {
      setTogglingFaucet(false);
    }
  };

  // ============================================================================
  // INITIALIZATION - Step 4: API calls (guarded)
  // ============================================================================

  useEffect(() => {
    const init = async () => {
      addConsoleLog('info', '[CryptoCrawler V2] Initializing...');
      await Promise.allSettled([fetchStatus(), fetchStats(), fetchFaucetStatus()]);
      addConsoleLog('info', '[CryptoCrawler V2] Dashboard ready');
    };
    init();
    
    // Step 5: Background polling (last)
    const statusInterval = setInterval(fetchStatus, 10000);
    const statsInterval = setInterval(fetchStats, 30000);
    const faucetInterval = setInterval(fetchFaucetStatus, 20000);
    
    return () => {
      clearInterval(statusInterval);
      clearInterval(statsInterval);
      clearInterval(faucetInterval);
    };
  }, [fetchStatus, fetchStats, fetchFaucetStatus, addConsoleLog]);

  const isSystemRunning = systemStatus?.running || false;

  // ============================================================================
  // RENDER - Steps 1-3: Static UI, Local state, Core logic
  // ============================================================================

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-orange-900/10 to-gray-900">
      {/* Simple Header - No AppLayout wrapper */}
      <header className="border-b border-orange-500/20 bg-black/40 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLocation('/')}
                className="text-gray-400 hover:text-white hover:bg-white/10"
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
              <div className="p-2 rounded-lg bg-gradient-to-br from-orange-500 to-red-600">
                <Coins className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">CryptoCrawler V2</h1>
                <p className="text-sm text-orange-300">Zero-Capital Flash Loan Arbitrage</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {isSystemRunning ? (
                <Button 
                  onClick={handleStopSystem}
                  disabled={stoppingSystem}
                  variant="destructive"
                  size="sm"
                >
                  {stoppingSystem ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <StopCircle className="w-4 h-4 mr-2" />}
                  Stop System
                </Button>
              ) : (
                <Button 
                  onClick={handleStartSystem}
                  disabled={startingSystem}
                  className="bg-green-600 hover:bg-green-700"
                  size="sm"
                >
                  {startingSystem ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Power className="w-4 h-4 mr-2" />}
                  Start System
                </Button>
              )}
              <Badge 
                className={isSystemRunning 
                  ? 'bg-green-500/20 text-green-300 border-green-500/30' 
                  : 'bg-red-500/20 text-red-300 border-red-500/30'
                }
              >
                <Activity className="w-3 h-3 mr-1" />
                {loadingStatus ? 'LOADING...' : isSystemRunning ? 'RUNNING' : 'STOPPED'}
              </Badge>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Card className="bg-gray-800/50 border-white/10">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">All-Time Profit</p>
                  <p className="text-2xl font-bold text-green-400">
                    {loadingStats ? '...' : stats ? `$${stats.profit.allTime.toLocaleString()}` : '$0'}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-green-500/20">
                  <DollarSign className="w-6 h-6 text-green-400" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gray-800/50 border-white/10">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">Today's Profit</p>
                  <p className="text-2xl font-bold text-white">
                    {loadingStats ? '...' : stats ? `$${stats.profit.today.toLocaleString()}` : '$0'}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-blue-500/20">
                  <TrendingUp className="w-6 h-6 text-blue-400" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gray-800/50 border-white/10">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">Total Trades</p>
                  <p className="text-2xl font-bold text-white">
                    {loadingStats ? '...' : stats?.trades.total || 0}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-purple-500/20">
                  <BarChart3 className="w-6 h-6 text-purple-400" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gray-800/50 border-white/10">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">Success Rate</p>
                  <p className="text-2xl font-bold text-white">
                    {loadingStats ? '...' : stats?.trades.successRate || '0%'}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-orange-500/20">
                  <Target className="w-6 h-6 text-orange-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="faucet" className="space-y-6">
          <TabsList className="bg-gray-800/50 border border-white/10">
            <TabsTrigger value="faucet" className="data-[state=active]:bg-green-500/20">
              <Droplets className="w-4 h-4 mr-2" />
              Faucet
            </TabsTrigger>
            <TabsTrigger value="console" className="data-[state=active]:bg-orange-500/20">
              <Terminal className="w-4 h-4 mr-2" />
              Console
            </TabsTrigger>
          </TabsList>

          {/* Faucet Tab */}
          <TabsContent value="faucet">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Main Faucet Control */}
              <Card className="bg-gray-800/50 border-white/10">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-white flex items-center gap-2">
                      <Droplets className="w-5 h-5 text-green-400" />
                      Autonomous Profit Faucet
                    </CardTitle>
                    <Badge className={faucetStatus.enabled 
                      ? 'bg-green-500/20 text-green-300 border-green-500/30 animate-pulse' 
                      : 'bg-red-500/20 text-red-300 border-red-500/30'
                    }>
                      {faucetStatus.enabled ? '🟢 ACTIVE' : '🔴 OFF'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    {/* Master ON/OFF Switch */}
                    <div className="p-4 rounded-lg bg-gradient-to-r from-green-900/30 to-emerald-900/30 border border-green-500/30">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-full ${faucetStatus.enabled ? 'bg-green-500/20' : 'bg-gray-500/20'}`}>
                            <Power className={`w-6 h-6 ${faucetStatus.enabled ? 'text-green-400' : 'text-gray-400'}`} />
                          </div>
                          <div>
                            <p className="text-white font-medium">Faucet Power</p>
                            <p className="text-sm text-gray-400">
                              {faucetStatus.enabled ? 'Automatically generating profit' : 'Faucet is OFF'}
                            </p>
                          </div>
                        </div>
                        <Switch
                          checked={faucetStatus.enabled}
                          onCheckedChange={handleToggleFaucet}
                          disabled={togglingFaucet}
                          className="data-[state=checked]:bg-green-500"
                        />
                      </div>
                    </div>

                    {/* Status Display */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 rounded-lg bg-white/5">
                        <p className="text-sm text-gray-400">Mode</p>
                        <p className="text-lg font-medium text-white capitalize">{faucetStatus.mode}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-white/5">
                        <p className="text-sm text-gray-400">Health</p>
                        <p className="text-lg font-medium text-white">{faucetStatus.healthScore}%</p>
                      </div>
                    </div>

                    {/* Daily Progress */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-400">Daily Target Progress</span>
                        <span className="text-white">${faucetStatus.profitThisDay.toLocaleString()} / ${faucetStatus.dailyTarget.toLocaleString()}</span>
                      </div>
                      <Progress value={faucetStatus.dailyTargetProgress} className="h-3 bg-gray-700" />
                    </div>

                    {/* Session Stats */}
                    <div className="p-4 rounded-lg bg-orange-900/20 border border-orange-500/30">
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                          <p className="text-2xl font-bold text-green-400">${faucetStatus.profitThisHour.toFixed(2)}</p>
                          <p className="text-xs text-gray-400">This Hour</p>
                        </div>
                        <div>
                          <p className="text-2xl font-bold text-white">{faucetStatus.tradesThisHour}</p>
                          <p className="text-xs text-gray-400">Trades/Hr</p>
                        </div>
                        <div>
                          <p className="text-2xl font-bold text-orange-400">${faucetStatus.profitThisSession.toFixed(2)}</p>
                          <p className="text-xs text-gray-400">Session</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Optimization Settings */}
              <Card className="bg-gray-800/50 border-white/10">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Brain className="w-5 h-5 text-purple-400" />
                    Profit Optimization
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                      <div className="flex items-center gap-2">
                        <Gauge className="w-4 h-4 text-blue-400" />
                        <div>
                          <p className="text-white">Auto-Optimize</p>
                          <p className="text-xs text-gray-400">Automatically adjust for max profit</p>
                        </div>
                      </div>
                      <Switch
                        checked={faucetStatus.autoOptimize}
                        onCheckedChange={(checked) => setFaucetStatus(prev => ({ ...prev, autoOptimize: checked }))}
                        className="data-[state=checked]:bg-blue-500"
                      />
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                      <div className="flex items-center gap-2">
                        <Timer className="w-4 h-4 text-yellow-400" />
                        <div>
                          <p className="text-white">Profitable Times Only</p>
                          <p className="text-xs text-gray-400">Execute only during optimal windows</p>
                        </div>
                      </div>
                      <Switch
                        checked={faucetStatus.profitableTimesOnly}
                        onCheckedChange={(checked) => setFaucetStatus(prev => ({ ...prev, profitableTimesOnly: checked }))}
                        className="data-[state=checked]:bg-yellow-500"
                      />
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                      <div className="flex items-center gap-2">
                        <EyeOff className="w-4 h-4 text-red-400" />
                        <div>
                          <p className="text-white">Anti-Detection Mode</p>
                          <p className="text-xs text-gray-400">Avoid negative attention</p>
                        </div>
                      </div>
                      <Switch
                        checked={faucetStatus.antiDetectionEnabled}
                        onCheckedChange={(checked) => setFaucetStatus(prev => ({ ...prev, antiDetectionEnabled: checked }))}
                        className="data-[state=checked]:bg-red-500"
                      />
                    </div>

                    {/* Stealth Strategies */}
                    <div className="p-4 rounded-lg bg-purple-900/20 border border-purple-500/30">
                      <div className="flex items-center gap-2 mb-3">
                        <Shield className="w-4 h-4 text-purple-400" />
                        <span className="text-purple-300 font-medium">Stealth Strategies Active</span>
                      </div>
                      <ul className="text-sm text-gray-400 space-y-1">
                        <li className="flex items-center gap-2">
                          <span className="text-green-400">✓</span> Exchange rotation (8 exchanges)
                        </li>
                        <li className="flex items-center gap-2">
                          <span className="text-green-400">✓</span> Pattern-breaking timing
                        </li>
                        <li className="flex items-center gap-2">
                          <span className="text-green-400">✓</span> Order size variation (±40%)
                        </li>
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Console Tab */}
          <TabsContent value="console">
            <Card className="bg-gray-800/50 border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Terminal className="w-5 h-5" />
                  System Console
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-black/50 rounded-lg p-4 font-mono text-sm h-96 overflow-auto">
                  {consoleLogs.length > 0 ? (
                    consoleLogs.map((log, i) => (
                      <p key={i} className={
                        log.level === 'error' ? 'text-red-400' :
                        log.level === 'warn' ? 'text-yellow-400' :
                        'text-green-400'
                      }>
                        [{new Date(log.timestamp).toLocaleTimeString()}] {log.message}
                      </p>
                    ))
                  ) : (
                    <p className="text-gray-500">Console initialized. Waiting for events...</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* System Warning */}
        {!isSystemRunning && (
          <Card className="mt-8 bg-yellow-900/20 border border-yellow-500/30">
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <AlertTriangle className="w-6 h-6 text-yellow-400 flex-shrink-0" />
                <div>
                  <h4 className="text-yellow-300 font-medium mb-1">System Not Running</h4>
                  <p className="text-sm text-gray-400">
                    The CryptoCrawler system is currently stopped. Start the system to enable trading.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-orange-500/20 py-6 mt-12">
        <div className="container mx-auto px-4 text-center text-gray-400 text-sm">
          <p>CryptoCrawler V2 Dashboard • Clean Implementation</p>
        </div>
      </footer>
    </div>
  );
}
