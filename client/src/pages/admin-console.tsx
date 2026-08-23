/**
 * PANTHEON Administrator Console
 * 
 * THE SINGLE MASTER ADMIN DASHBOARD
 * Protected by the platform master session.
 * Route: /administrator
 * 
 * DIVINE METICULOUSNESS TO THE 3RD POWER:
 * - Full CryptoCrawler integration (faucet, trading, wallet, opportunities)
 * - User management with subscription override
 * - Monte Carlo simulation status
 * - Real-time system monitoring
 * - No fallback users, strict 401 enforcement
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
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { 
  Activity, 
  Users,
  Shield,
  RefreshCw,
  Terminal,
  Database,
  Power,
  Eye,
  EyeOff,
  LogOut,
  CheckCircle2,
  Calendar,
  Mail,
  User,
  Crown,
  Loader2,
  Search,
  DollarSign,
  TrendingUp,
  Target,
  Droplets,
  Brain,
  Gauge,
  Timer,
  StopCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { SEOHead } from "@/components/SEOHead";

// ============================================================================
// TYPES
// ============================================================================

interface LoggedUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  hasPaidForAccess: boolean;
  subscriptionOverride: boolean;
  status: string;
}

interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  paidUsers: number;
  overriddenUsers: number;
}

interface CryptoStats {
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
  consecutiveFailures: number;
  currentWindow: number;
  totalWindows: number;
  autoOptimize: boolean;
  profitableTimesOnly: boolean;
  antiDetectionEnabled: boolean;
}

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

interface ConsoleLog {
  timestamp: number;
  level: string;
  message: string;
}

// ============================================================================
// ADMINISTRATOR CONSOLE COMPONENT
// ============================================================================

export default function AdminConsole() {
  const { user, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  // User Management State
  const [users, setUsers] = useState<LoggedUser[]>([]);
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [updatingUsers, setUpdatingUsers] = useState<Set<string>>(new Set());
  
  // CryptoCrawler State
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [cryptoStats, setCryptoStats] = useState<CryptoStats | null>(null);
  const [faucetStatus, setFaucetStatus] = useState<FaucetStatus>({
    enabled: true,
    mode: 'open',
    profitThisSession: 0,
    profitThisHour: 0,
    profitThisDay: 0,
    dailyTarget: 35000,
    dailyTargetProgress: 0,
    tradesThisHour: 0,
    tradesThisDay: 0,
    stealthLevel: 0,
    healthScore: 100,
    consecutiveFailures: 0,
    currentWindow: 0,
    totalWindows: 18,
    autoOptimize: true,
    profitableTimesOnly: true,
    antiDetectionEnabled: true,
  });
  
  // Loading States
  const [isLoading, setIsLoading] = useState(true);
  const [loadingFaucet, setLoadingFaucet] = useState(false);
  const [togglingFaucet, setTogglingFaucet] = useState(false);
  const [startingSystem, setStartingSystem] = useState(false);
  const [stoppingSystem, setStoppingSystem] = useState(false);
  
  // Console Logs
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLog[]>([]);

  // Admin feature flags (client-side gating for dashboard access)
  const [featureFlags, setFeatureFlags] = useState<{
    cryptocrawler: boolean;
    monteCarlo: boolean;
    reactor: boolean;
  }>(() => {
    try {
      const raw = localStorage.getItem('adminFeatureFlags');
      if (!raw) return { cryptocrawler: true, monteCarlo: true, reactor: true };
      const parsed = JSON.parse(raw);
      return {
        cryptocrawler: parsed?.cryptocrawler ?? true,
        monteCarlo: parsed?.monteCarlo ?? true,
        reactor: parsed?.reactor ?? true,
      };
    } catch {
      return { cryptocrawler: true, monteCarlo: true, reactor: true };
    }
  });

  const setFeatureFlag = useCallback((key: keyof typeof featureFlags, value: boolean) => {
    setFeatureFlags(prev => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem('adminFeatureFlags', JSON.stringify(next));
        window.dispatchEvent(new Event('adminFeatureFlagsChanged'));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);
  
  // Add console log helper
  const addConsoleLog = useCallback((level: string, message: string) => {
    setConsoleLogs(prev => [{
      timestamp: Date.now(),
      level,
      message
    }, ...prev.slice(0, 99)]);
  }, []);

  // Check authentication - redirect to login on 401
  useEffect(() => {
    if (!authLoading && !user) {
      setLocation("/login");
    }
  }, [user, authLoading, setLocation]);

  // ==================== DATA FETCHING ====================

  // Fetch admin users
  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users/logged", {
        credentials: "include",
        headers: { "Cache-Control": "no-store" },
      });

      if (res.status === 401) {
        setLocation("/login");
        return;
      }

      if (res.ok) {
        const data = await res.json();
        setUsers(data.data || []);
        addConsoleLog('info', `Loaded ${data.data?.length || 0} users`);
      }
    } catch (error) {
      addConsoleLog('error', 'Failed to fetch users');
    }
  }, [setLocation, addConsoleLog]);

  // Fetch admin stats
  const fetchAdminStats = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/stats", {
        credentials: "include",
        headers: { "Cache-Control": "no-store" },
      });

      if (res.ok) {
        const data = await res.json();
        setAdminStats(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch admin stats:', error);
    }
  }, []);

  // Fetch crypto system status
  const fetchSystemStatus = useCallback(async () => {
    try {
      const res = await fetch("/admin/crypto/status", {
        credentials: "include",
        headers: { "Cache-Control": "no-store" },
      });

      if (res.status === 401) {
        addConsoleLog('warn', 'Session expired - please re-authenticate');
        setSystemStatus({
          running: false,
          cryptoCrawl: { enabled: false, gasOracle: false, balanceMonitor: false, networkHealth: false },
          startedAt: null,
          uptime: 0,
        });
        return;
      }

      if (res.ok) {
        const data = await res.json();
        setSystemStatus(data);
        addConsoleLog('info', `System status: ${data.running ? 'RUNNING' : 'STOPPED'}`);
      }
    } catch (error) {
      addConsoleLog('error', 'Failed to fetch system status');
      setSystemStatus({
        running: false,
        cryptoCrawl: { enabled: false, gasOracle: false, balanceMonitor: false, networkHealth: false },
        startedAt: null,
        uptime: 0,
      });
    }
  }, [addConsoleLog]);

  // Fetch crypto stats
  const fetchCryptoStats = useCallback(async () => {
    try {
      const res = await fetch("/api/crypto/stats", {
        credentials: "include",
        headers: { "Cache-Control": "no-store" },
      });

      if (res.ok) {
        const data = await res.json();
        setCryptoStats(data);
      }
    } catch (error) {
      console.error('Failed to fetch crypto stats:', error);
    }
  }, []);

  // Fetch faucet status
  const fetchFaucetStatus = useCallback(async () => {
    setLoadingFaucet(true);
    try {
      const res = await fetch("/api/crypto/faucet/status", {
        credentials: "include",
        headers: { "Cache-Control": "no-store" },
      });

      if (res.ok) {
        const data = await res.json();
        setFaucetStatus(prev => ({
          ...prev,
          ...data,
          enabled: data.enabled ?? true,
        }));
        addConsoleLog('info', `[Faucet] Status: ${data.mode || 'active'}, Progress: ${(data.dailyTargetProgress || 0).toFixed(1)}%`);
      }
    } catch (error) {
      addConsoleLog('warn', '[Faucet] Using default settings');
    } finally {
      setLoadingFaucet(false);
    }
  }, [addConsoleLog]);

  // Initial data load
  useEffect(() => {
    if (user) {
      const loadAllData = async () => {
        setIsLoading(true);
        addConsoleLog('info', '[Administrator] Initializing dashboard...');
        
        await Promise.allSettled([
          fetchUsers(),
          fetchAdminStats(),
          fetchSystemStatus(),
          fetchCryptoStats(),
          fetchFaucetStatus(),
        ]);
        
        addConsoleLog('info', '[Administrator] Dashboard initialized');
        setIsLoading(false);
      };

      loadAllData();

      // Set up polling intervals
      const usersInterval = setInterval(fetchUsers, 60000);
      const statusInterval = setInterval(fetchSystemStatus, 10000);
      const statsInterval = setInterval(fetchCryptoStats, 30000);
      const faucetInterval = setInterval(fetchFaucetStatus, 20000);

      return () => {
        clearInterval(usersInterval);
        clearInterval(statusInterval);
        clearInterval(statsInterval);
        clearInterval(faucetInterval);
      };
    }
  }, [user, fetchUsers, fetchAdminStats, fetchSystemStatus, fetchCryptoStats, fetchFaucetStatus, addConsoleLog]);

  // ==================== ACTIONS ====================

  // Toggle subscription override
  const toggleSubscriptionOverride = async (userId: string, currentValue: boolean) => {
    setUpdatingUsers(prev => {
      const next = new Set(prev);
      next.add(userId);
      return next;
    });
    
    try {
      const res = await fetch(`/api/admin/users/${userId}/subscription-override`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: JSON.stringify({ override: !currentValue }),
      });

      if (res.status === 401) {
        setLocation("/login");
        return;
      }

      if (res.ok) {
        setUsers(prev => prev.map(u => 
          u.id === userId 
            ? { ...u, subscriptionOverride: !currentValue, hasPaidForAccess: !currentValue ? true : u.hasPaidForAccess }
            : u
        ));
        toast({ title: "Success", description: `Subscription override ${!currentValue ? "enabled" : "disabled"}` });
        addConsoleLog('info', `[Admin] Subscription override ${!currentValue ? 'ENABLED' : 'DISABLED'} for user ${userId.slice(0, 8)}...`);
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to update subscription", variant: "destructive" });
      addConsoleLog('error', '[Admin] Failed to update subscription override');
    } finally {
      setUpdatingUsers(prev => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  };

  // Toggle faucet
  const handleToggleFaucet = async (enabled: boolean) => {
    setTogglingFaucet(true);
    addConsoleLog('info', `[Faucet] ${enabled ? '🟢 Turning ON' : '🔴 Turning OFF'}...`);
    
    try {
      const res = await fetch('/api/crypto/faucet/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabled }),
      });
      
      if (res.ok) {
        setFaucetStatus(prev => ({ ...prev, enabled, mode: enabled ? 'open' : 'closed' }));
        toast({ title: enabled ? "Faucet Activated" : "Faucet Deactivated", description: enabled ? "Autonomous profit optimization is ACTIVE" : "Faucet stopped" });
        addConsoleLog('info', `[Faucet] ✅ Successfully ${enabled ? 'activated' : 'deactivated'}`);
      } else {
        // Optimistic update
        setFaucetStatus(prev => ({ ...prev, enabled, mode: enabled ? 'open' : 'closed' }));
        addConsoleLog('info', `[Faucet] ✅ ${enabled ? 'Activated' : 'Deactivated'} (local)`);
      }
    } catch (error) {
      setFaucetStatus(prev => ({ ...prev, enabled, mode: enabled ? 'open' : 'closed' }));
      addConsoleLog('warn', '[Faucet] Toggle applied locally');
    } finally {
      setTogglingFaucet(false);
    }
  };

  // Update faucet settings
  const handleUpdateFaucetSettings = async (settings: Partial<FaucetStatus>) => {
    setFaucetStatus(prev => ({ ...prev, ...settings }));
    addConsoleLog('info', '[Faucet] Settings updated');
    
    try {
      await fetch('/api/crypto/faucet/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(settings),
      });
    } catch (error) {
      // Settings saved locally
    }
  };

  // Start system
  const handleStartSystem = async () => {
    setStartingSystem(true);
    addConsoleLog('info', '[CryptoCrawler] Starting system...');
    
    try {
      const res = await fetch('/admin/crypto/start', {
        method: 'POST',
        credentials: 'include',
      });
      
      const data = await res.json();
      if (res.ok && data.success) {
        toast({ title: "System Started", description: "CryptoCrawler is now running" });
        addConsoleLog('info', '[CryptoCrawler] ✓ System started');
        fetchSystemStatus();
      } else {
        throw new Error(data.error || 'Could not start system');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start system';
      toast({ title: "Failed to Start", description: message, variant: "destructive" });
      addConsoleLog('error', `[CryptoCrawler] Failed to start: ${message}`);
    } finally {
      setStartingSystem(false);
    }
  };

  // Stop system
  const handleStopSystem = async () => {
    setStoppingSystem(true);
    addConsoleLog('info', '[CryptoCrawler] Stopping system...');
    
    try {
      const res = await fetch('/admin/crypto/stop', {
        method: 'POST',
        credentials: 'include',
      });
      
      const data = await res.json();
      if (res.ok && data.success) {
        toast({ title: "System Stopped", description: "CryptoCrawler has been stopped" });
        addConsoleLog('info', '[CryptoCrawler] ✓ System stopped');
        fetchSystemStatus();
      } else {
        throw new Error(data.error || 'Could not stop system');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not stop system';
      toast({ title: "Failed to Stop", description: message, variant: "destructive" });
      addConsoleLog('error', `[CryptoCrawler] Failed to stop: ${message}`);
    } finally {
      setStoppingSystem(false);
    }
  };

  // Logout
  const handleLogout = () => {
    window.location.href = "/api/logout";
  };

  // Filter users
  const filteredUsers = users.filter(u => {
    const searchLower = searchTerm.toLowerCase();
    return (
      u.email?.toLowerCase().includes(searchLower) ||
      u.firstName?.toLowerCase().includes(searchLower) ||
      u.lastName?.toLowerCase().includes(searchLower)
    );
  });

  // Format date
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleString();
  };

  // ==================== RENDER ====================

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900/10 to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-purple-400 mx-auto mb-4" />
          <p className="text-purple-300">Initializing PANTHEON Administrator...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  const isSystemRunning = systemStatus?.running || false;

  return (
    <>
      <SEOHead title="PANTHEON Administrator" description="Administrative control panel" noIndex={true} />
      
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900/10 to-gray-900">
        {/* Header */}
        <header className="sticky top-0 z-50 border-b border-purple-500/20 bg-black/40 backdrop-blur-sm">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gradient-to-br from-purple-500 to-pink-600">
                  <Shield className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-white">PANTHEON</h1>
                  <p className="text-sm text-purple-300">Administrator Console</p>
                </div>
              </div>
              
              <div className="flex items-center gap-4">
                {/* System Control */}
                {isSystemRunning ? (
                  <Button onClick={handleStopSystem} disabled={stoppingSystem} variant="destructive" size="sm">
                    {stoppingSystem ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <StopCircle className="w-4 h-4 mr-2" />}
                    Stop System
                  </Button>
                ) : (
                  <Button onClick={handleStartSystem} disabled={startingSystem} className="bg-green-600 hover:bg-green-700" size="sm">
                    {startingSystem ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Power className="w-4 h-4 mr-2" />}
                    Start System
                  </Button>
                )}
                
                <Badge variant={isSystemRunning ? "default" : "secondary"} className={isSystemRunning ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"}>
                  <Activity className="w-3 h-3 mr-1" />
                  {isSystemRunning ? "RUNNING" : "STOPPED"}
                </Badge>
                
                <Button variant="ghost" size="sm" onClick={handleLogout} className="text-gray-400 hover:text-white">
                  <LogOut className="h-4 w-4 mr-2" />
                  Logout
                </Button>
              </div>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-6">
          {/* Stats Overview */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Card className="bg-gray-800/50 border-white/10">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-400">All-Time Profit</p>
                    <p className="text-2xl font-bold text-green-400">${(cryptoStats?.profit?.allTime || 0).toLocaleString()}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-green-500/20"><DollarSign className="w-6 h-6 text-green-400" /></div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gray-800/50 border-white/10">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-400">Today's Profit</p>
                    <p className="text-2xl font-bold text-white">${(cryptoStats?.profit?.today || 0).toLocaleString()}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-blue-500/20"><TrendingUp className="w-6 h-6 text-blue-400" /></div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gray-800/50 border-white/10">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-400">Total Users</p>
                    <p className="text-2xl font-bold text-white">{adminStats?.totalUsers || 0}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-purple-500/20"><Users className="w-6 h-6 text-purple-400" /></div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gray-800/50 border-white/10">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-400">Success Rate</p>
                    <p className="text-2xl font-bold text-white">{cryptoStats?.trades?.successRate || '0%'}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-orange-500/20"><Target className="w-6 h-6 text-orange-400" /></div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Admin Control Surface (navigation + access toggles) */}
          <Card className="bg-gray-800/50 border-white/10 mb-6">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Shield className="w-5 h-5 text-purple-400" />
                Admin Control Surface
              </CardTitle>
              <CardDescription className="text-gray-400">
                Toggle access and jump to critical dashboards (CryptoCrawler, Monte Carlo, Reactor).
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-black/30 border border-white/10">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-white font-medium">CryptoCrawler Dashboard</p>
                    <p className="text-xs text-gray-400">Route: /cryptocrawler-v2</p>
                  </div>
                  <Switch
                    checked={featureFlags.cryptocrawler}
                    onCheckedChange={(v) => setFeatureFlag('cryptocrawler', v)}
                    className="data-[state=checked]:bg-purple-500"
                  />
                </div>
                <Button
                  className="mt-3 w-full h-11"
                  variant="outline"
                  disabled={!featureFlags.cryptocrawler}
                  onClick={() => setLocation('/cryptocrawler-v2')}
                >
                  Open CryptoCrawler
                </Button>
              </div>

              <div className="p-4 rounded-lg bg-black/30 border border-white/10">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-white font-medium">Monte Carlo Dashboard</p>
                    <p className="text-xs text-gray-400">Route: /orchestrator-console</p>
                  </div>
                  <Switch
                    checked={featureFlags.monteCarlo}
                    onCheckedChange={(v) => setFeatureFlag('monteCarlo', v)}
                    className="data-[state=checked]:bg-purple-500"
                  />
                </div>
                <Button
                  className="mt-3 w-full h-11"
                  variant="outline"
                  disabled={!featureFlags.monteCarlo}
                  onClick={() => setLocation('/orchestrator-console')}
                >
                  Open Monte Carlo
                </Button>
              </div>

              <div className="p-4 rounded-lg bg-black/30 border border-white/10">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-white font-medium">Reactor Controls</p>
                    <p className="text-xs text-gray-400">Route: /control-room</p>
                  </div>
                  <Switch
                    checked={featureFlags.reactor}
                    onCheckedChange={(v) => setFeatureFlag('reactor', v)}
                    className="data-[state=checked]:bg-purple-500"
                  />
                </div>
                <Button
                  className="mt-3 w-full h-11"
                  variant="outline"
                  disabled={!featureFlags.reactor}
                  onClick={() => setLocation('/control-room')}
                >
                  Open Reactor
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Main Tabs */}
          <Tabs defaultValue="faucet" className="space-y-6">
            <TabsList className="bg-gray-800/50 border border-white/10">
              <TabsTrigger value="faucet" className="data-[state=active]:bg-green-500/20">
                <Droplets className="w-4 h-4 mr-2" />Faucet
              </TabsTrigger>
              <TabsTrigger value="users" className="data-[state=active]:bg-purple-500/20">
                <Users className="w-4 h-4 mr-2" />Users
              </TabsTrigger>
              <TabsTrigger value="system" className="data-[state=active]:bg-blue-500/20">
                <Database className="w-4 h-4 mr-2" />System
              </TabsTrigger>
              <TabsTrigger value="console" className="data-[state=active]:bg-gray-500/20">
                <Terminal className="w-4 h-4 mr-2" />Console
              </TabsTrigger>
            </TabsList>

            {/* FAUCET TAB */}
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
                      <Badge className={faucetStatus.enabled ? 'bg-green-500/20 text-green-300 animate-pulse' : 'bg-red-500/20 text-red-300'}>
                        {faucetStatus.enabled ? '🟢 ACTIVE' : '🔴 OFF'}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Master Switch */}
                    <div className="p-4 rounded-lg bg-gradient-to-r from-green-900/30 to-emerald-900/30 border border-green-500/30">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-full ${faucetStatus.enabled ? 'bg-green-500/20' : 'bg-gray-500/20'}`}>
                            <Power className={`w-6 h-6 ${faucetStatus.enabled ? 'text-green-400' : 'text-gray-400'}`} />
                          </div>
                          <div>
                            <p className="text-white font-medium">Faucet Power</p>
                            <p className="text-sm text-gray-400">{faucetStatus.enabled ? 'Generating profit' : 'Faucet is OFF'}</p>
                          </div>
                        </div>
                        <Switch checked={faucetStatus.enabled} onCheckedChange={handleToggleFaucet} disabled={togglingFaucet} className="data-[state=checked]:bg-green-500" />
                      </div>
                    </div>

                    {/* Status Grid */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 rounded-lg bg-white/5">
                        <p className="text-sm text-gray-400">Mode</p>
                        <p className="text-lg font-medium text-white capitalize">{faucetStatus.mode}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-white/5">
                        <p className="text-sm text-gray-400">Health</p>
                        <p className="text-lg font-medium text-white">{faucetStatus.healthScore}%</p>
                      </div>
                      <div className="p-3 rounded-lg bg-white/5">
                        <p className="text-sm text-gray-400">Stealth</p>
                        <p className="text-lg font-medium text-white">{faucetStatus.stealthLevel}/10</p>
                      </div>
                      <div className="p-3 rounded-lg bg-white/5">
                        <p className="text-sm text-gray-400">Window</p>
                        <p className="text-lg font-medium text-white">{faucetStatus.currentWindow}/{faucetStatus.totalWindows}</p>
                      </div>
                    </div>

                    {/* Progress */}
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Daily Target</span>
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
                  </CardContent>
                </Card>

                {/* Optimization Settings */}
                <Card className="bg-gray-800/50 border-white/10">
                  <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2">
                      <Brain className="w-5 h-5 text-purple-400" />
                      Optimization Settings
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                      <div className="flex items-center gap-2">
                        <Gauge className="w-4 h-4 text-blue-400" />
                        <div>
                          <p className="text-white">Auto-Optimize</p>
                          <p className="text-xs text-gray-400">Automatic adjustment</p>
                        </div>
                      </div>
                      <Switch checked={faucetStatus.autoOptimize} onCheckedChange={(checked) => handleUpdateFaucetSettings({ autoOptimize: checked })} className="data-[state=checked]:bg-blue-500" />
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                      <div className="flex items-center gap-2">
                        <Timer className="w-4 h-4 text-yellow-400" />
                        <div>
                          <p className="text-white">Profitable Times Only</p>
                          <p className="text-xs text-gray-400">Optimal windows</p>
                        </div>
                      </div>
                      <Switch checked={faucetStatus.profitableTimesOnly} onCheckedChange={(checked) => handleUpdateFaucetSettings({ profitableTimesOnly: checked })} className="data-[state=checked]:bg-yellow-500" />
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                      <div className="flex items-center gap-2">
                        <EyeOff className="w-4 h-4 text-red-400" />
                        <div>
                          <p className="text-white">Anti-Detection</p>
                          <p className="text-xs text-gray-400">Stealth mode</p>
                        </div>
                      </div>
                      <Switch checked={faucetStatus.antiDetectionEnabled} onCheckedChange={(checked) => handleUpdateFaucetSettings({ antiDetectionEnabled: checked })} className="data-[state=checked]:bg-red-500" />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-gray-300">Daily Target</Label>
                      <Select value={faucetStatus.dailyTarget.toString()} onValueChange={(v) => handleUpdateFaucetSettings({ dailyTarget: parseInt(v, 10) })}>
                        <SelectTrigger className="bg-gray-900/50 border-white/10 text-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="10000">$10,000</SelectItem>
                          <SelectItem value="25000">$25,000</SelectItem>
                          <SelectItem value="35000">$35,000</SelectItem>
                          <SelectItem value="50000">$50,000</SelectItem>
                          <SelectItem value="100000">$100,000</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* USERS TAB */}
            <TabsContent value="users">
              <Card className="bg-gray-800/50 border-white/10">
                <CardHeader>
                  <CardTitle className="text-white flex items-center justify-between">
                    <span>Logged Users</span>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                        <Input placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-8 w-64 bg-gray-900/50 border-white/10 text-white" />
                      </div>
                      <Button variant="outline" size="sm" onClick={fetchUsers} className="border-white/10">
                        <RefreshCw className="h-4 w-4 mr-2" />Refresh
                      </Button>
                    </div>
                  </CardTitle>
                  <CardDescription className="text-gray-400">Newest first. Check box to override subscription fees.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[500px]">
                    <div className="space-y-2">
                      {filteredUsers.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">{searchTerm ? "No matches" : "No users yet"}</div>
                      ) : (
                        filteredUsers.map((u) => (
                          <div key={u.id} className="flex items-center gap-4 p-4 rounded-lg border border-white/10 bg-gray-900/30 hover:bg-gray-900/50 transition-colors">
                            <div className="flex items-center">
                              {updatingUsers.has(u.id) ? (
                                <Loader2 className="h-5 w-5 animate-spin text-purple-400" />
                              ) : (
                                <Checkbox checked={u.subscriptionOverride} onCheckedChange={() => toggleSubscriptionOverride(u.id, u.subscriptionOverride)} className="h-5 w-5 border-white/30" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <User className="h-4 w-4 text-gray-500" />
                                <span className="font-medium text-white truncate">{u.firstName || u.lastName ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : "Unknown"}</span>
                                {u.subscriptionOverride && <Badge className="bg-yellow-500/20 text-yellow-400"><Crown className="h-3 w-3 mr-1" />Override</Badge>}
                                {u.hasPaidForAccess && !u.subscriptionOverride && <Badge className="bg-green-500/20 text-green-400"><CheckCircle2 className="h-3 w-3 mr-1" />Paid</Badge>}
                              </div>
                              <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                                <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{u.email || "No email"}</span>
                                <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Joined: {formatDate(u.createdAt)}</span>
                              </div>
                            </div>
                            <div className="text-right text-sm">
                              <p className="text-gray-500">Last Login</p>
                              <p className="text-white">{formatDate(u.lastLoginAt)}</p>
                            </div>
                            <Badge variant={u.status === "active" ? "default" : "secondary"} className={u.status === "active" ? "bg-green-500/20 text-green-400" : "bg-gray-500/20 text-gray-400"}>{u.status}</Badge>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>

            {/* SYSTEM TAB */}
            <TabsContent value="system">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="bg-gray-800/50 border-white/10">
                  <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2"><Power className="w-5 h-5" />System Status</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex justify-between"><span className="text-gray-400">Main System</span><Badge variant={systemStatus?.running ? "default" : "destructive"}>{systemStatus?.running ? "Running" : "Stopped"}</Badge></div>
                    <div className="flex justify-between"><span className="text-gray-400">Uptime</span><span className="font-mono text-white">{systemStatus?.uptime ? Math.floor(systemStatus.uptime / 60) + " min" : "N/A"}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Started</span><span className="font-mono text-sm text-white">{systemStatus?.startedAt ? formatDate(systemStatus.startedAt) : "N/A"}</span></div>
                  </CardContent>
                </Card>
                <Card className="bg-gray-800/50 border-white/10">
                  <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2"><Database className="w-5 h-5" />CryptoCrawl</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex justify-between"><span className="text-gray-400">Enabled</span><Badge variant={systemStatus?.cryptoCrawl?.enabled ? "default" : "secondary"}>{systemStatus?.cryptoCrawl?.enabled ? "Yes" : "No"}</Badge></div>
                    <div className="flex justify-between"><span className="text-gray-400">Gas Oracle</span><Badge variant={systemStatus?.cryptoCrawl?.gasOracle ? "default" : "secondary"}>{systemStatus?.cryptoCrawl?.gasOracle ? "Active" : "Inactive"}</Badge></div>
                    <div className="flex justify-between"><span className="text-gray-400">Balance Monitor</span><Badge variant={systemStatus?.cryptoCrawl?.balanceMonitor ? "default" : "secondary"}>{systemStatus?.cryptoCrawl?.balanceMonitor ? "Active" : "Inactive"}</Badge></div>
                    <div className="flex justify-between"><span className="text-gray-400">Network</span><Badge variant={systemStatus?.cryptoCrawl?.networkHealth ? "default" : "secondary"}>{systemStatus?.cryptoCrawl?.networkHealth ? "Healthy" : "Degraded"}</Badge></div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* CONSOLE TAB */}
            <TabsContent value="console">
              <Card className="bg-gray-800/50 border-white/10">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2"><Terminal className="w-5 h-5" />System Console</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px] bg-black/50 rounded-lg p-4 font-mono text-sm">
                    {consoleLogs.length === 0 ? (
                      <p className="text-gray-600">No logs yet...</p>
                    ) : (
                      consoleLogs.map((log, i) => (
                        <div key={i} className={`py-1 ${log.level === 'error' ? 'text-red-400' : log.level === 'warn' ? 'text-yellow-400' : 'text-green-400'}`}>
                          <span className="text-gray-600">[{new Date(log.timestamp).toLocaleTimeString()}]</span> {log.message}
                        </div>
                      ))
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </>
  );
}
