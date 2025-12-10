import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { 
  Activity, 
  TrendingUp, 
  TrendingDown,
  DollarSign,
  Zap,
  Shield,
  CheckCircle2,
  AlertTriangle,
  Clock,
  BarChart3,
  Play,
  Pause,
  RefreshCw,
  Terminal,
  Database,
  Waves,
  Target,
  LineChart,
  Coins,
  Bot
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { SEOHead } from "@/components/SEOHead";

/**
 * CryptoCrawler Command Dashboard - Access Zone C
 * Master Password: CRPTCRWLR
 * Role: CRAWLER_ROOT
 * Purpose: Full access to CryptoCrawler control panel, Monte Carlo simulations, trading faucet
 */
export default function CryptoCrawlerDashboard() {
  const [, setLocation] = useLocation();
  const { isAuthenticated } = useAuth();
  const [systemActive, setSystemActive] = useState(true);
  const [monteCarloRunning, setMonteCarloRunning] = useState(false);

  // Verify access to this zone
  useEffect(() => {
    if (!isAuthenticated) {
      setLocation('/login');
    }
  }, [isAuthenticated, setLocation]);

  // Simulated market data
  const marketStats = {
    totalProfit: 12847.52,
    todayProfit: 847.23,
    totalTrades: 1524,
    successRate: 78.4,
    activeStrategies: 12,
    pendingSignals: 34,
  };

  const tradingPairs = [
    { pair: "ETH/USDT", profit: 234.56, trades: 45, trend: "up" },
    { pair: "BTC/USDT", profit: 512.34, trades: 78, trend: "up" },
    { pair: "SOL/USDT", profit: -45.23, trades: 23, trend: "down" },
    { pair: "MATIC/USDT", profit: 89.12, trades: 34, trend: "up" },
    { pair: "ARB/USDT", profit: 56.78, trades: 28, trend: "up" },
  ];

  const strategies = [
    { name: "Momentum Alpha", status: "active", roi: 12.4, trades: 156 },
    { name: "Mean Reversion", status: "active", roi: 8.7, trades: 89 },
    { name: "Arbitrage Hunter", status: "active", roi: 15.2, trades: 234 },
    { name: "Trend Follower", status: "paused", roi: 6.3, trades: 67 },
    { name: "Scalper Pro", status: "active", roi: 22.1, trades: 412 },
    { name: "DCA Bot", status: "active", roi: 4.8, trades: 45 },
  ];

  const monteCarloResults = {
    simulations: 10000,
    expectedReturn: 14.7,
    riskMetric: 0.23,
    confidence: 95,
    lastRun: "2 hours ago",
  };

  const signalSources = [
    { name: "TradingView", signals: 12, accuracy: 82 },
    { name: "On-Chain Data", signals: 8, accuracy: 76 },
    { name: "Social Sentiment", signals: 15, accuracy: 68 },
    { name: "News AI", signals: 6, accuracy: 71 },
    { name: "Technical Indicators", signals: 22, accuracy: 79 },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-orange-900/10 to-gray-900">
      <SEOHead
        title="CryptoCrawler - Command Dashboard"
        description="Full access to CryptoCrawler control panel with Monte Carlo simulations and trading operations"
      />

      {/* Header */}
      <header className="border-b border-orange-500/20 bg-black/40 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-orange-500 to-red-600">
                <Coins className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">CryptoCrawler</h1>
                <p className="text-sm text-orange-300">Command Dashboard</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">System</span>
                <Switch 
                  checked={systemActive}
                  onCheckedChange={setSystemActive}
                />
              </div>
              <Badge 
                variant={systemActive ? 'default' : 'secondary'}
                className={systemActive 
                  ? 'bg-green-500/20 text-green-300 border-green-500/30' 
                  : 'bg-red-500/20 text-red-300 border-red-500/30'
                }
              >
                <Activity className="w-3 h-3 mr-1" />
                {systemActive ? 'ACTIVE' : 'OFFLINE'}
              </Badge>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-orange-500/20 border border-orange-500/30">
                <Shield className="w-4 h-4 text-orange-400" />
                <span className="text-sm text-orange-300">CRAWLER_ROOT</span>
              </div>
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
                  <p className="text-sm text-gray-400">Total Profit</p>
                  <p className="text-2xl font-bold text-green-400">
                    ${marketStats.totalProfit.toLocaleString()}
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
                    ${marketStats.todayProfit.toLocaleString()}
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
                  <p className="text-2xl font-bold text-white">{marketStats.totalTrades}</p>
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
                  <p className="text-2xl font-bold text-white">{marketStats.successRate}%</p>
                </div>
                <div className="p-3 rounded-lg bg-orange-500/20">
                  <Target className="w-6 h-6 text-orange-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs for different sections */}
        <Tabs defaultValue="trading" className="space-y-6">
          <TabsList className="bg-gray-800/50 border border-white/10">
            <TabsTrigger value="trading" className="data-[state=active]:bg-orange-500/20">
              <LineChart className="w-4 h-4 mr-2" />
              Trading
            </TabsTrigger>
            <TabsTrigger value="montecarlo" className="data-[state=active]:bg-orange-500/20">
              <Waves className="w-4 h-4 mr-2" />
              Monte Carlo
            </TabsTrigger>
            <TabsTrigger value="strategies" className="data-[state=active]:bg-orange-500/20">
              <Bot className="w-4 h-4 mr-2" />
              Strategies
            </TabsTrigger>
            <TabsTrigger value="signals" className="data-[state=active]:bg-orange-500/20">
              <Zap className="w-4 h-4 mr-2" />
              Signal Fusion
            </TabsTrigger>
          </TabsList>

          {/* Trading Tab */}
          <TabsContent value="trading">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="bg-gray-800/50 border-white/10">
                <CardHeader>
                  <CardTitle className="text-white">Active Trading Pairs</CardTitle>
                  <CardDescription className="text-gray-400">
                    Real-time performance by trading pair
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {tradingPairs.map((pair, index) => (
                      <div 
                        key={index}
                        className="flex items-center justify-between p-3 rounded-lg bg-white/5"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${pair.trend === 'up' ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                            {pair.trend === 'up' 
                              ? <TrendingUp className="w-4 h-4 text-green-400" />
                              : <TrendingDown className="w-4 h-4 text-red-400" />
                            }
                          </div>
                          <div>
                            <p className="text-white font-medium">{pair.pair}</p>
                            <p className="text-sm text-gray-400">{pair.trades} trades</p>
                          </div>
                        </div>
                        <span className={`font-bold ${pair.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {pair.profit >= 0 ? '+' : ''}${pair.profit.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gray-800/50 border-white/10">
                <CardHeader>
                  <CardTitle className="text-white">Trading Faucet Control</CardTitle>
                  <CardDescription className="text-gray-400">
                    Manage automated trading operations
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="p-4 rounded-lg bg-orange-900/30 border border-orange-500/30">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-orange-300 font-medium">Trading Faucet</span>
                        <Badge className="bg-green-500/20 text-green-300">Active</Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-gray-400">Active Strategies</p>
                          <p className="text-white font-bold">{marketStats.activeStrategies}</p>
                        </div>
                        <div>
                          <p className="text-gray-400">Pending Signals</p>
                          <p className="text-white font-bold">{marketStats.pendingSignals}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button className="flex-1 bg-green-600 hover:bg-green-700">
                        <Play className="w-4 h-4 mr-2" />
                        Start All
                      </Button>
                      <Button variant="outline" className="flex-1 border-orange-500/30 text-orange-300">
                        <Pause className="w-4 h-4 mr-2" />
                        Pause All
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Monte Carlo Tab */}
          <TabsContent value="montecarlo">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="bg-gray-800/50 border-white/10">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Waves className="w-5 h-5 text-orange-400" />
                    Monte Carlo Engine
                  </CardTitle>
                  <CardDescription className="text-gray-400">
                    Probabilistic market simulation and risk analysis
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 rounded-lg bg-white/5">
                        <p className="text-sm text-gray-400">Simulations</p>
                        <p className="text-xl font-bold text-white">{monteCarloResults.simulations.toLocaleString()}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-white/5">
                        <p className="text-sm text-gray-400">Expected Return</p>
                        <p className="text-xl font-bold text-green-400">+{monteCarloResults.expectedReturn}%</p>
                      </div>
                      <div className="p-3 rounded-lg bg-white/5">
                        <p className="text-sm text-gray-400" title="Value at Risk - Maximum expected loss at given confidence level">Risk Metric (VaR)</p>
                        <p className="text-xl font-bold text-yellow-400">{monteCarloResults.riskMetric}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-white/5">
                        <p className="text-sm text-gray-400">Confidence</p>
                        <p className="text-xl font-bold text-white">{monteCarloResults.confidence}%</p>
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-orange-900/20 border border-orange-500/30">
                      <p className="text-sm text-gray-400 mb-1">Last Run</p>
                      <p className="text-orange-300">{monteCarloResults.lastRun}</p>
                    </div>
                    <Button 
                      className="w-full bg-orange-600 hover:bg-orange-700"
                      onClick={() => setMonteCarloRunning(!monteCarloRunning)}
                    >
                      {monteCarloRunning ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          Running Simulation...
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 mr-2" />
                          Run New Simulation
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gray-800/50 border-white/10">
                <CardHeader>
                  <CardTitle className="text-white">Scheduled Training Windows</CardTitle>
                  <CardDescription className="text-gray-400">
                    Monte Carlo training cycles (CST)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="p-4 rounded-lg bg-white/5 border-l-4 border-yellow-500">
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="w-4 h-4 text-yellow-400" />
                        <span className="text-white font-medium">Monte Carlo Window</span>
                      </div>
                      <p className="text-gray-400 text-sm">3:30 AM - 5:30 AM CST</p>
                      <p className="text-yellow-400 text-xs mt-1">Continuous training cycles</p>
                    </div>
                    <div className="p-4 rounded-lg bg-white/5 border-l-4 border-purple-500">
                      <div className="flex items-center gap-2 mb-2">
                        <Database className="w-4 h-4 text-purple-400" />
                        <span className="text-white font-medium">Strategy Evolution</span>
                      </div>
                      <p className="text-gray-400 text-sm">After Monte Carlo completion</p>
                      <p className="text-purple-400 text-xs mt-1">Auto-applies winning strategies</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Strategies Tab */}
          <TabsContent value="strategies">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {strategies.map((strategy, index) => (
                <Card key={index} className="bg-gray-800/50 border-white/10">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg text-white">{strategy.name}</CardTitle>
                      <Badge 
                        variant="outline"
                        className={
                          strategy.status === 'active' 
                            ? 'border-green-500/50 text-green-400' 
                            : 'border-yellow-500/50 text-yellow-400'
                        }
                      >
                        {strategy.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">ROI</span>
                        <span className={`font-bold ${strategy.roi >= 10 ? 'text-green-400' : 'text-white'}`}>
                          +{strategy.roi}%
                        </span>
                      </div>
                      <Progress value={strategy.roi * 4} className="h-2" />
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Total Trades</span>
                        <span className="text-white">{strategy.trades}</span>
                      </div>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full border-white/10 text-gray-300"
                      >
                        {strategy.status === 'active' ? 'Pause' : 'Activate'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Signal Fusion Tab */}
          <TabsContent value="signals">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="bg-gray-800/50 border-white/10">
                <CardHeader>
                  <CardTitle className="text-white">Multi-Source Signal Fusion</CardTitle>
                  <CardDescription className="text-gray-400">
                    Aggregated signals from multiple data sources
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {signalSources.map((source, index) => (
                      <div 
                        key={index}
                        className="flex items-center justify-between p-3 rounded-lg bg-white/5"
                      >
                        <div className="flex items-center gap-3">
                          <Zap className="w-5 h-5 text-orange-400" />
                          <div>
                            <p className="text-white font-medium">{source.name}</p>
                            <p className="text-sm text-gray-400">{source.signals} active signals</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-white font-bold">{source.accuracy}%</p>
                          <p className="text-xs text-gray-400">accuracy</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gray-800/50 border-white/10">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Terminal className="w-5 h-5" />
                    Crawler Console
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="bg-black/50 rounded-lg p-4 font-mono text-sm text-green-400 h-64 overflow-auto">
                    <p>[CryptoCrawler] System initialized with CRAWLER_ROOT access</p>
                    <p>[CryptoCrawler] AI cluster mode: crypto</p>
                    <p>[CryptoCrawler] Connected to Supabase tables: learning_crypto, evolving_crypto</p>
                    <p>[CryptoCrawler] TradingView integration: ACTIVE</p>
                    <p>[CryptoCrawler] Alchemy node: CONNECTED</p>
                    <p>[CryptoCrawler] Monte Carlo engine: READY</p>
                    <p>[CryptoCrawler] Deep-market crawler: SCANNING</p>
                    <p className="text-yellow-400">[CryptoCrawler] Signal fusion: {marketStats.pendingSignals} pending</p>
                    <p>[CryptoCrawler] Strategy evolution: AUTONOMOUS</p>
                    <p className="text-blue-400">[CryptoCrawler] Next Monte Carlo window: 3:30 CST</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        {/* Domain Isolation Warning */}
        <Card className="mt-8 bg-red-900/20 border border-red-500/30">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0" />
              <div>
                <h4 className="text-red-300 font-medium mb-1">Domain Isolation Active</h4>
                <p className="text-sm text-gray-400">
                  CryptoCrawler operates in a completely isolated domain. Cross-domain access to LegalWhat tables is BLOCKED.
                  All learning and evolution data is stored in crypto-specific Supabase tables.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Footer */}
      <footer className="border-t border-orange-500/20 py-6 mt-12">
        <div className="container mx-auto px-4 text-center text-gray-400 text-sm">
          <p>CryptoCrawler Command Dashboard • Access Zone C • CRAWLER_ROOT</p>
        </div>
      </footer>
    </div>
  );
}
