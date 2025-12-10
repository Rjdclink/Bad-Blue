import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { 
  Brain, 
  Cpu, 
  Network, 
  Activity, 
  Zap, 
  Settings, 
  Shield,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Database,
  GitBranch,
  BarChart3,
  Play,
  Pause,
  RefreshCw,
  Terminal,
  Power,
  Loader2,
  StopCircle,
  Sparkles
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { SEOHead } from "@/components/SEOHead";
import { apiRequest } from "@/lib/queryClient";

/**
 * 4JI Orchestrator Admin Console - Access Zone B
 * Master Password: FORGEAI
 * Role: ORCHESTRATOR_ADMIN
 * Purpose: Merged Meta-AI Control Brain - unified 13+ model orchestration
 * 
 * ALL DATA IS FETCHED FROM REAL API ENDPOINTS - NO DEMO DATA
 */

// Types for API responses
interface OrchestratorStatus {
  success: boolean;
  isInitialized: boolean;
  isRunning: boolean;
  uptime: number;
  activeDomain: string | null;
  modelsLoaded: number;
  totalOperations: number;
  legalwhatStats: DomainStats;
  cryptocrawlerStats: DomainStats;
  systemHealth: number;
  lastEvolutionRun: string | null;
}

interface DomainStats {
  operations: number;
  errors: number;
  evolutionCycles: number;
  lastActivity: string | null;
  activeSubAgents: number;
  workerFunctions: number;
}

interface IsolationStatus {
  success: boolean;
  isIsolated: boolean;
  violations: number;
}

interface DiagnosticsResult {
  success: boolean;
  diagnostics: {
    timestamp: string;
    orchestrator: {
      initialized: boolean;
      running: boolean;
      uptime: number;
      health: number;
    };
    models: {
      loaded: number;
      totalOperations: number;
    };
    domains: {
      isolation: boolean;
      violations: number;
      legal: { operations: number; errors: number; subAgents: number };
      crypto: { operations: number; errors: number; subAgents: number };
    };
    recommendations: string[];
  };
}

interface ConsoleLog {
  timestamp: number;
  level: string;
  message: string;
}

export default function OrchestratorConsole() {
  const [, setLocation] = useLocation();
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();
  
  // System state
  const [status, setStatus] = useState<OrchestratorStatus | null>(null);
  const [isolation, setIsolation] = useState<IsolationStatus | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResult | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLog[]>([]);
  
  // Loading states
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [startingSystem, setStartingSystem] = useState(false);
  const [stoppingSystem, setStoppingSystem] = useState(false);
  const [runningDiagnostics, setRunningDiagnostics] = useState(false);
  const [triggeringEvolution, setTriggeringEvolution] = useState(false);

  // Verify access
  useEffect(() => {
    if (!isAuthenticated) {
      setLocation('/login');
    }
  }, [isAuthenticated, setLocation]);

  // Add console log
  const addConsoleLog = useCallback((level: string, message: string) => {
    setConsoleLogs(prev => [{
      timestamp: Date.now(),
      level,
      message
    }, ...prev.slice(0, 99)]);
  }, []);

  // Fetch orchestrator status
  const fetchStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const response = await apiRequest('/api/orchestrator/status', 'GET');
      const data = await response.json();
      setStatus(data);
    } catch (error) {
      console.error('Failed to fetch status:', error);
      addConsoleLog('error', 'Failed to fetch orchestrator status');
    } finally {
      setLoadingStatus(false);
    }
  }, [addConsoleLog]);

  // Fetch isolation status
  const fetchIsolation = useCallback(async () => {
    try {
      const response = await apiRequest('/api/orchestrator/isolation', 'GET');
      const data = await response.json();
      setIsolation(data);
    } catch (error) {
      console.error('Failed to fetch isolation:', error);
    }
  }, []);

  // Start orchestrator
  const handleStart = async () => {
    setStartingSystem(true);
    addConsoleLog('info', '[4JI] Starting orchestrator...');
    try {
      const response = await apiRequest('/api/orchestrator/start', 'POST');
      const data = await response.json();
      
      if (data.success) {
        toast({
          title: "Orchestrator Started",
          description: "4JI system is now running",
        });
        addConsoleLog('info', '[4JI] ✓ Orchestrator started successfully');
        fetchStatus();
      } else {
        throw new Error(data.error || 'Failed to start');
      }
    } catch (error: any) {
      toast({
        title: "Failed to Start",
        description: error.message,
        variant: "destructive",
      });
      addConsoleLog('error', `[4JI] Failed to start: ${error.message}`);
    } finally {
      setStartingSystem(false);
    }
  };

  // Stop orchestrator
  const handleStop = async () => {
    setStoppingSystem(true);
    addConsoleLog('info', '[4JI] Stopping orchestrator...');
    try {
      const response = await apiRequest('/api/orchestrator/stop', 'POST');
      const data = await response.json();
      
      if (data.success) {
        toast({
          title: "Orchestrator Stopped",
          description: `Uptime: ${Math.floor(data.uptime / 1000)}s`,
        });
        addConsoleLog('info', '[4JI] ✓ Orchestrator stopped');
        fetchStatus();
      } else {
        throw new Error(data.error || 'Failed to stop');
      }
    } catch (error: any) {
      toast({
        title: "Failed to Stop",
        description: error.message,
        variant: "destructive",
      });
      addConsoleLog('error', `[4JI] Failed to stop: ${error.message}`);
    } finally {
      setStoppingSystem(false);
    }
  };

  // Run diagnostics
  const handleDiagnostics = async () => {
    setRunningDiagnostics(true);
    addConsoleLog('info', '[4JI] Running system diagnostics...');
    try {
      const response = await apiRequest('/api/orchestrator/diagnostics', 'POST');
      const data = await response.json();
      
      if (data.success) {
        setDiagnostics(data);
        toast({
          title: "Diagnostics Complete",
          description: `System health: ${data.diagnostics.orchestrator.health}%`,
        });
        addConsoleLog('info', `[4JI] ✓ Diagnostics complete. Health: ${data.diagnostics.orchestrator.health}%`);
        
        // Log recommendations
        data.diagnostics.recommendations.forEach((rec: string) => {
          addConsoleLog('warn', `[4JI] Recommendation: ${rec}`);
        });
      } else {
        throw new Error(data.error || 'Diagnostics failed');
      }
    } catch (error: any) {
      toast({
        title: "Diagnostics Failed",
        description: error.message,
        variant: "destructive",
      });
      addConsoleLog('error', `[4JI] Diagnostics failed: ${error.message}`);
    } finally {
      setRunningDiagnostics(false);
    }
  };

  // Trigger evolution
  const handleEvolution = async (domain: 'legal' | 'crypto' | 'both') => {
    setTriggeringEvolution(true);
    addConsoleLog('info', `[4JI] Triggering evolution for ${domain}...`);
    try {
      const response = await apiRequest('/api/orchestrator/evolve', 'POST', { domain });
      const data = await response.json();
      
      if (data.success) {
        toast({
          title: "Evolution Triggered",
          description: data.message,
        });
        addConsoleLog('info', `[4JI] ✓ ${data.message}`);
        fetchStatus();
      } else {
        throw new Error(data.error || 'Evolution failed');
      }
    } catch (error: any) {
      toast({
        title: "Evolution Failed",
        description: error.message,
        variant: "destructive",
      });
      addConsoleLog('error', `[4JI] Evolution failed: ${error.message}`);
    } finally {
      setTriggeringEvolution(false);
    }
  };

  // Initial data fetch
  useEffect(() => {
    fetchStatus();
    fetchIsolation();
    addConsoleLog('info', '[4JI] Orchestrator console initialized');
    
    // Set up polling
    const statusInterval = setInterval(fetchStatus, 10000);
    const isolationInterval = setInterval(fetchIsolation, 30000);
    
    return () => {
      clearInterval(statusInterval);
      clearInterval(isolationInterval);
    };
  }, [fetchStatus, fetchIsolation, addConsoleLog]);

  const isRunning = status?.isRunning || false;
  const systemHealth = status?.systemHealth || 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900/20 to-gray-900">
      <SEOHead
        title="4JI Orchestrator - Meta-AI Control Console"
        description="Unified AI orchestration layer controlling 13+ models for adaptive intelligence"
      />

      {/* Header */}
      <header className="border-b border-purple-500/20 bg-black/40 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-purple-500 to-pink-600">
                <Brain className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">4JI Orchestrator</h1>
                <p className="text-sm text-purple-300">Meta-AI Control Console</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {/* System Control */}
              <div className="flex items-center gap-2">
                {isRunning ? (
                  <Button 
                    onClick={handleStop}
                    disabled={stoppingSystem}
                    variant="destructive"
                    size="sm"
                  >
                    {stoppingSystem ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <StopCircle className="w-4 h-4 mr-2" />
                    )}
                    Stop
                  </Button>
                ) : (
                  <Button 
                    onClick={handleStart}
                    disabled={startingSystem}
                    className="bg-green-600 hover:bg-green-700"
                    size="sm"
                  >
                    {startingSystem ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Power className="w-4 h-4 mr-2" />
                    )}
                    Start
                  </Button>
                )}
              </div>
              
              <Badge 
                variant={isRunning ? 'default' : 'secondary'}
                className={isRunning 
                  ? 'bg-green-500/20 text-green-300 border-green-500/30' 
                  : 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'
                }
              >
                <Activity className="w-3 h-3 mr-1" />
                {loadingStatus ? 'LOADING...' : isRunning ? 'RUNNING' : 'STOPPED'}
              </Badge>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-500/20 border border-purple-500/30">
                <Shield className="w-4 h-4 text-purple-400" />
                <span className="text-sm text-purple-300">ORCHESTRATOR_ADMIN</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Status Banner */}
        <div className="mb-8 p-4 rounded-lg bg-gradient-to-r from-purple-900/50 to-pink-900/50 border border-purple-500/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-purple-500/20">
                <Cpu className="w-8 h-8 text-purple-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">
                  {isRunning ? 'Unified Intelligence Layer Active' : 'System Offline'}
                </h2>
                <p className="text-purple-300">
                  {status?.modelsLoaded || 0} models loaded • {status?.totalOperations || 0} total operations • Health: {systemHealth}%
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleDiagnostics}
                disabled={runningDiagnostics}
                className="border-purple-500/30 text-purple-300 hover:bg-purple-500/20"
              >
                {runningDiagnostics ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Settings className="w-4 h-4 mr-1" />}
                Diagnostics
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => { fetchStatus(); fetchIsolation(); }}
                className="border-purple-500/30 text-purple-300 hover:bg-purple-500/20"
              >
                <RefreshCw className="w-4 h-4 mr-1" />
                Sync
              </Button>
            </div>
          </div>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Card className="bg-gray-800/50 border-white/10">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">System Health</p>
                  <p className="text-2xl font-bold text-white">{systemHealth}%</p>
                </div>
                <div className={`p-3 rounded-lg ${systemHealth >= 80 ? 'bg-green-500/20' : systemHealth >= 50 ? 'bg-yellow-500/20' : 'bg-red-500/20'}`}>
                  <Activity className={`w-6 h-6 ${systemHealth >= 80 ? 'text-green-400' : systemHealth >= 50 ? 'text-yellow-400' : 'text-red-400'}`} />
                </div>
              </div>
              <Progress value={systemHealth} className="mt-3 h-2" />
            </CardContent>
          </Card>
          <Card className="bg-gray-800/50 border-white/10">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">Models Loaded</p>
                  <p className="text-2xl font-bold text-white">{status?.modelsLoaded || 0}</p>
                </div>
                <div className="p-3 rounded-lg bg-purple-500/20">
                  <Network className="w-6 h-6 text-purple-400" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gray-800/50 border-white/10">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">Total Operations</p>
                  <p className="text-2xl font-bold text-white">{status?.totalOperations || 0}</p>
                </div>
                <div className="p-3 rounded-lg bg-blue-500/20">
                  <BarChart3 className="w-6 h-6 text-blue-400" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gray-800/50 border-white/10">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">Domain Isolation</p>
                  <p className="text-2xl font-bold text-white">
                    {isolation?.isIsolated ? 'SECURE' : 'BREACH'}
                  </p>
                </div>
                <div className={`p-3 rounded-lg ${isolation?.isIsolated ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                  <Shield className={`w-6 h-6 ${isolation?.isIsolated ? 'text-green-400' : 'text-red-400'}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="domains" className="space-y-6">
          <TabsList className="bg-gray-800/50 border border-white/10">
            <TabsTrigger value="domains" className="data-[state=active]:bg-purple-500/20">
              <Database className="w-4 h-4 mr-2" />
              Domains
            </TabsTrigger>
            <TabsTrigger value="evolution" className="data-[state=active]:bg-purple-500/20">
              <GitBranch className="w-4 h-4 mr-2" />
              Evolution
            </TabsTrigger>
            <TabsTrigger value="diagnostics" className="data-[state=active]:bg-purple-500/20">
              <Settings className="w-4 h-4 mr-2" />
              Diagnostics
            </TabsTrigger>
            <TabsTrigger value="console" className="data-[state=active]:bg-purple-500/20">
              <Terminal className="w-4 h-4 mr-2" />
              Console
            </TabsTrigger>
          </TabsList>

          {/* Domains Tab */}
          <TabsContent value="domains">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* LegalWhat Domain */}
              <Card className="bg-gray-800/50 border-white/10">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Database className="w-5 h-5 text-blue-400" />
                    LegalWhat Domain
                  </CardTitle>
                  <CardDescription className="text-gray-400">
                    Legal platform operations and intelligence
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="p-4 rounded-lg bg-blue-900/30 border border-blue-500/30">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-gray-400">Operations</p>
                          <p className="text-xl font-bold text-white">{status?.legalwhatStats.operations || 0}</p>
                        </div>
                        <div>
                          <p className="text-gray-400">Errors</p>
                          <p className="text-xl font-bold text-white">{status?.legalwhatStats.errors || 0}</p>
                        </div>
                        <div>
                          <p className="text-gray-400">Sub-Agents</p>
                          <p className="text-xl font-bold text-white">{status?.legalwhatStats.activeSubAgents || 0}</p>
                        </div>
                        <div>
                          <p className="text-gray-400">Evolution Cycles</p>
                          <p className="text-xl font-bold text-white">{status?.legalwhatStats.evolutionCycles || 0}</p>
                        </div>
                      </div>
                    </div>
                    <Button 
                      onClick={() => handleEvolution('legal')}
                      disabled={!isRunning || triggeringEvolution}
                      className="w-full bg-blue-600 hover:bg-blue-700"
                    >
                      {triggeringEvolution ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                      Trigger Legal Evolution
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* CryptoCrawler Domain */}
              <Card className="bg-gray-800/50 border-white/10">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Database className="w-5 h-5 text-orange-400" />
                    CryptoCrawler Domain
                  </CardTitle>
                  <CardDescription className="text-gray-400">
                    Crypto trading operations and intelligence
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="p-4 rounded-lg bg-orange-900/30 border border-orange-500/30">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-gray-400">Operations</p>
                          <p className="text-xl font-bold text-white">{status?.cryptocrawlerStats.operations || 0}</p>
                        </div>
                        <div>
                          <p className="text-gray-400">Errors</p>
                          <p className="text-xl font-bold text-white">{status?.cryptocrawlerStats.errors || 0}</p>
                        </div>
                        <div>
                          <p className="text-gray-400">Sub-Agents</p>
                          <p className="text-xl font-bold text-white">{status?.cryptocrawlerStats.activeSubAgents || 0}</p>
                        </div>
                        <div>
                          <p className="text-gray-400">Evolution Cycles</p>
                          <p className="text-xl font-bold text-white">{status?.cryptocrawlerStats.evolutionCycles || 0}</p>
                        </div>
                      </div>
                    </div>
                    <Button 
                      onClick={() => handleEvolution('crypto')}
                      disabled={!isRunning || triggeringEvolution}
                      className="w-full bg-orange-600 hover:bg-orange-700"
                    >
                      {triggeringEvolution ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                      Trigger Crypto Evolution
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Domain Isolation Warning */}
            {isolation && !isolation.isIsolated && (
              <Card className="mt-6 bg-red-900/20 border border-red-500/30">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0" />
                    <div>
                      <h4 className="text-red-300 font-medium mb-1">Domain Isolation Breach Detected</h4>
                      <p className="text-sm text-gray-400">
                        {isolation.violations} violations detected. Cross-domain access should be blocked.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Evolution Tab */}
          <TabsContent value="evolution">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="bg-gray-800/50 border-white/10">
                <CardHeader>
                  <CardTitle className="text-white">Evolution Control</CardTitle>
                  <CardDescription className="text-gray-400">
                    Trigger learning and adaptation cycles
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="p-4 rounded-lg bg-purple-900/30 border border-purple-500/30">
                      <h4 className="text-purple-300 font-medium mb-2">Last Evolution Run</h4>
                      <p className="text-white">
                        {status?.lastEvolutionRun 
                          ? new Date(status.lastEvolutionRun).toLocaleString() 
                          : 'Never'}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      <Button 
                        onClick={() => handleEvolution('both')}
                        disabled={!isRunning || triggeringEvolution}
                        className="w-full bg-purple-600 hover:bg-purple-700"
                      >
                        {triggeringEvolution ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                        Evolve Both Domains
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gray-800/50 border-white/10">
                <CardHeader>
                  <CardTitle className="text-white">Evolution Statistics</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                      <span className="text-gray-400">Legal Evolution Cycles</span>
                      <span className="text-white font-bold">{status?.legalwhatStats.evolutionCycles || 0}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                      <span className="text-gray-400">Crypto Evolution Cycles</span>
                      <span className="text-white font-bold">{status?.cryptocrawlerStats.evolutionCycles || 0}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                      <span className="text-gray-400">Total Operations</span>
                      <span className="text-white font-bold">{status?.totalOperations || 0}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Diagnostics Tab */}
          <TabsContent value="diagnostics">
            <Card className="bg-gray-800/50 border-white/10">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white">System Diagnostics</CardTitle>
                  <Button 
                    onClick={handleDiagnostics}
                    disabled={runningDiagnostics}
                    className="bg-purple-600 hover:bg-purple-700"
                  >
                    {runningDiagnostics ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Settings className="w-4 h-4 mr-2" />}
                    Run Diagnostics
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {diagnostics ? (
                  <div className="space-y-6">
                    {/* Orchestrator Status */}
                    <div className="p-4 rounded-lg bg-white/5">
                      <h4 className="text-white font-medium mb-3">Orchestrator</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <p className="text-gray-400">Initialized</p>
                          <Badge className={diagnostics.diagnostics.orchestrator.initialized ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}>
                            {diagnostics.diagnostics.orchestrator.initialized ? 'Yes' : 'No'}
                          </Badge>
                        </div>
                        <div>
                          <p className="text-gray-400">Running</p>
                          <Badge className={diagnostics.diagnostics.orchestrator.running ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}>
                            {diagnostics.diagnostics.orchestrator.running ? 'Yes' : 'No'}
                          </Badge>
                        </div>
                        <div>
                          <p className="text-gray-400">Health</p>
                          <span className="text-white font-bold">{diagnostics.diagnostics.orchestrator.health}%</span>
                        </div>
                        <div>
                          <p className="text-gray-400">Uptime</p>
                          <span className="text-white font-bold">{Math.floor(diagnostics.diagnostics.orchestrator.uptime / 1000)}s</span>
                        </div>
                      </div>
                    </div>

                    {/* Recommendations */}
                    {diagnostics.diagnostics.recommendations.length > 0 && (
                      <div className="p-4 rounded-lg bg-yellow-900/30 border border-yellow-500/30">
                        <h4 className="text-yellow-300 font-medium mb-3">Recommendations</h4>
                        <ul className="space-y-2">
                          {diagnostics.diagnostics.recommendations.map((rec, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                              <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                              {rec}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-400">
                    <Settings className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>Click "Run Diagnostics" to analyze system health</p>
                  </div>
                )}
              </CardContent>
            </Card>
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

        {/* System Not Running Warning */}
        {!isRunning && (
          <Card className="mt-8 bg-yellow-900/20 border border-yellow-500/30">
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <AlertTriangle className="w-6 h-6 text-yellow-400 flex-shrink-0" />
                <div>
                  <h4 className="text-yellow-300 font-medium mb-1">Orchestrator Not Running</h4>
                  <p className="text-sm text-gray-400">
                    The 4JI Orchestrator is currently stopped. Start the system to enable AI operations, evolution cycles, and domain management.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-purple-500/20 py-6 mt-12">
        <div className="container mx-auto px-4 text-center text-gray-400 text-sm">
          <p>4JI Orchestrator • Meta-AI Control Console • Access Zone B • ORCHESTRATOR_ADMIN</p>
        </div>
      </footer>
    </div>
  );
}
