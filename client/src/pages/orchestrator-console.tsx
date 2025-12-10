import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Terminal
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { SEOHead } from "@/components/SEOHead";

/**
 * 4JI Orchestrator Admin Console - Access Zone B
 * Master Password: FORGEAI
 * Role: ORCHESTRATOR_ADMIN
 * Purpose: Merged Meta-AI Control Brain - unified 13+ model orchestration
 */
export default function OrchestratorConsole() {
  const [, setLocation] = useLocation();
  const { isAuthenticated } = useAuth();
  const [systemStatus, setSystemStatus] = useState<'running' | 'paused' | 'optimizing'>('running');

  // Verify access to this zone
  useEffect(() => {
    if (!isAuthenticated) {
      setLocation('/login');
    }
  }, [isAuthenticated, setLocation]);

  // Simulated model data
  const aiModels = [
    { name: "Claude-3.5", status: "active", load: 45, tasks: 12 },
    { name: "GPT-4o", status: "active", load: 62, tasks: 18 },
    { name: "Gemini Pro", status: "active", load: 38, tasks: 8 },
    { name: "Mistral Large", status: "active", load: 55, tasks: 14 },
    { name: "LLaMA-3", status: "standby", load: 0, tasks: 0 },
    { name: "Groq-Mixtral", status: "active", load: 72, tasks: 22 },
    { name: "Anthropic-Claude", status: "active", load: 50, tasks: 15 },
    { name: "OpenRouter-Mix", status: "active", load: 41, tasks: 10 },
    { name: "Legal-Expert", status: "active", load: 88, tasks: 35 },
    { name: "Crypto-Analyzer", status: "active", load: 67, tasks: 25 },
    { name: "Document-Gen", status: "active", load: 53, tasks: 17 },
    { name: "Research-Agent", status: "active", load: 44, tasks: 11 },
    { name: "Self-Healer", status: "monitoring", load: 15, tasks: 3 },
  ];

  const workerStats = {
    totalTasks: 1847,
    completedToday: 456,
    failedTasks: 12,
    averageTime: "2.3s",
    queuedTasks: 34,
  };

  const evolutionCycles = [
    { id: 1, model: "Legal-Expert", improvement: "+4.2%", timestamp: "2h ago" },
    { id: 2, model: "Crypto-Analyzer", improvement: "+2.8%", timestamp: "4h ago" },
    { id: 3, model: "Document-Gen", improvement: "+1.5%", timestamp: "6h ago" },
  ];

  const scheduledTasks = [
    { name: "Nightly Optimization", time: "1:30 - 3:30 CST", status: "scheduled" },
    { name: "Monte Carlo Training", time: "3:30 - 5:30 CST", status: "scheduled" },
    { name: "System Diagnostics", time: "6:00 CST", status: "completed" },
  ];

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
              <Badge 
                variant={systemStatus === 'running' ? 'default' : 'secondary'}
                className={systemStatus === 'running' 
                  ? 'bg-green-500/20 text-green-300 border-green-500/30' 
                  : 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'
                }
              >
                <Activity className="w-3 h-3 mr-1" />
                {systemStatus.toUpperCase()}
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
                <h2 className="text-xl font-bold text-white">Unified Intelligence Layer Active</h2>
                <p className="text-purple-300">{aiModels.length} models merged • Continuous evolution • Self-healing enabled</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm"
                className="border-purple-500/30 text-purple-300 hover:bg-purple-500/20"
                onClick={() => setSystemStatus(systemStatus === 'running' ? 'paused' : 'running')}
              >
                {systemStatus === 'running' ? <Pause className="w-4 h-4 mr-1" /> : <Play className="w-4 h-4 mr-1" />}
                {systemStatus === 'running' ? 'Pause' : 'Resume'}
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                className="border-purple-500/30 text-purple-300 hover:bg-purple-500/20"
              >
                <RefreshCw className="w-4 h-4 mr-1" />
                Sync All
              </Button>
            </div>
          </div>
        </div>

        {/* Tabs for different sections */}
        <Tabs defaultValue="models" className="space-y-6">
          <TabsList className="bg-gray-800/50 border border-white/10">
            <TabsTrigger value="models" className="data-[state=active]:bg-purple-500/20">
              <Network className="w-4 h-4 mr-2" />
              AI Models
            </TabsTrigger>
            <TabsTrigger value="worker" className="data-[state=active]:bg-purple-500/20">
              <Cpu className="w-4 h-4 mr-2" />
              Worker Engine
            </TabsTrigger>
            <TabsTrigger value="evolution" className="data-[state=active]:bg-purple-500/20">
              <GitBranch className="w-4 h-4 mr-2" />
              Evolution
            </TabsTrigger>
            <TabsTrigger value="schedule" className="data-[state=active]:bg-purple-500/20">
              <Clock className="w-4 h-4 mr-2" />
              Schedule
            </TabsTrigger>
          </TabsList>

          {/* AI Models Tab */}
          <TabsContent value="models">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {aiModels.map((model, index) => (
                <Card key={index} className="bg-gray-800/50 border-white/10">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg text-white">{model.name}</CardTitle>
                      <Badge 
                        variant="outline"
                        className={
                          model.status === 'active' 
                            ? 'border-green-500/50 text-green-400' 
                            : model.status === 'standby'
                            ? 'border-yellow-500/50 text-yellow-400'
                            : 'border-blue-500/50 text-blue-400'
                        }
                      >
                        {model.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-400">Load</span>
                          <span className="text-white">{model.load}%</span>
                        </div>
                        <Progress value={model.load} className="h-2" />
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Active Tasks</span>
                        <span className="text-purple-300">{model.tasks}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Worker Engine Tab */}
          <TabsContent value="worker">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <Card className="bg-gray-800/50 border-white/10">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-lg bg-blue-500/20">
                      <BarChart3 className="w-6 h-6 text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-400">Total Tasks</p>
                      <p className="text-2xl font-bold text-white">{workerStats.totalTasks}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-gray-800/50 border-white/10">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-lg bg-green-500/20">
                      <CheckCircle2 className="w-6 h-6 text-green-400" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-400">Completed Today</p>
                      <p className="text-2xl font-bold text-white">{workerStats.completedToday}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-gray-800/50 border-white/10">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-lg bg-red-500/20">
                      <AlertTriangle className="w-6 h-6 text-red-400" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-400">Failed Tasks</p>
                      <p className="text-2xl font-bold text-white">{workerStats.failedTasks}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-gray-800/50 border-white/10">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-lg bg-purple-500/20">
                      <Clock className="w-6 h-6 text-purple-400" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-400">Avg. Time</p>
                      <p className="text-2xl font-bold text-white">{workerStats.averageTime}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="bg-gray-800/50 border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Terminal className="w-5 h-5" />
                  Worker Engine Console
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-black/50 rounded-lg p-4 font-mono text-sm text-green-400 h-64 overflow-auto">
                  <p>[4JI] Worker Engine initialized with unified mode</p>
                  <p>[4JI] Sub-Agent Execution Engine ready</p>
                  <p>[4JI] Cherry-picking optimal model for task: legal_document_gen</p>
                  <p>[4JI] Selected: Legal-Expert (confidence: 0.94)</p>
                  <p>[4JI] Task completed in 1.8s</p>
                  <p>[4JI] Evolution snapshot saved to Supabase</p>
                  <p>[4JI] Self-healer monitoring: no anomalies detected</p>
                  <p>[4JI] Queued tasks: {workerStats.queuedTasks}</p>
                  <p className="text-yellow-400">[4JI] Next optimization window: 1:30 CST</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Evolution Tab */}
          <TabsContent value="evolution">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="bg-gray-800/50 border-white/10">
                <CardHeader>
                  <CardTitle className="text-white">Recent Evolution Cycles</CardTitle>
                  <CardDescription className="text-gray-400">
                    Continuous improvement through deep learning
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {evolutionCycles.map((cycle) => (
                      <div 
                        key={cycle.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-white/5"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-full bg-green-500/20">
                            <Zap className="w-4 h-4 text-green-400" />
                          </div>
                          <div>
                            <p className="text-white font-medium">{cycle.model}</p>
                            <p className="text-sm text-gray-400">{cycle.timestamp}</p>
                          </div>
                        </div>
                        <Badge className="bg-green-500/20 text-green-300 border-green-500/30">
                          {cycle.improvement}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gray-800/50 border-white/10">
                <CardHeader>
                  <CardTitle className="text-white">Domain Isolation</CardTitle>
                  <CardDescription className="text-gray-400">
                    Hard boundaries between legal and crypto domains
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="p-4 rounded-lg bg-blue-900/30 border border-blue-500/30">
                      <div className="flex items-center gap-2 mb-2">
                        <Database className="w-5 h-5 text-blue-400" />
                        <span className="font-medium text-blue-300">Legal Domain</span>
                      </div>
                      <p className="text-sm text-gray-400 mb-2">Isolated tables: learning_legal, evolving_legal</p>
                      <p className="text-xs text-blue-400">Status: Active • Mode: legal</p>
                    </div>
                    <div className="p-4 rounded-lg bg-orange-900/30 border border-orange-500/30">
                      <div className="flex items-center gap-2 mb-2">
                        <Database className="w-5 h-5 text-orange-400" />
                        <span className="font-medium text-orange-300">Crypto Domain</span>
                      </div>
                      <p className="text-sm text-gray-400 mb-2">Isolated tables: learning_crypto, evolving_crypto</p>
                      <p className="text-xs text-orange-400">Status: Active • Mode: crypto</p>
                    </div>
                    <div className="p-3 rounded-lg bg-red-900/20 border border-red-500/30">
                      <p className="text-sm text-red-400 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        Cross-domain access: BLOCKED
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Schedule Tab */}
          <TabsContent value="schedule">
            <Card className="bg-gray-800/50 border-white/10">
              <CardHeader>
                <CardTitle className="text-white">Scheduled Operations</CardTitle>
                <CardDescription className="text-gray-400">
                  Automated optimization and training windows (CST)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {scheduledTasks.map((task, index) => (
                    <div 
                      key={index}
                      className="flex items-center justify-between p-4 rounded-lg bg-white/5"
                    >
                      <div className="flex items-center gap-4">
                        <Clock className="w-5 h-5 text-purple-400" />
                        <div>
                          <p className="text-white font-medium">{task.name}</p>
                          <p className="text-sm text-gray-400">{task.time}</p>
                        </div>
                      </div>
                      <Badge 
                        variant="outline"
                        className={
                          task.status === 'completed' 
                            ? 'border-green-500/50 text-green-400' 
                            : 'border-yellow-500/50 text-yellow-400'
                        }
                      >
                        {task.status}
                      </Badge>
                    </div>
                  ))}
                </div>

                <div className="mt-6 p-4 rounded-lg bg-purple-900/30 border border-purple-500/30">
                  <h4 className="text-purple-300 font-medium mb-2">On-Demand Issue Repair</h4>
                  <p className="text-sm text-gray-400 mb-3">
                    Immediate error detection and live patching without redeploy
                  </p>
                  <Button className="bg-purple-600 hover:bg-purple-700">
                    <Settings className="w-4 h-4 mr-2" />
                    Run Diagnostics
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
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
