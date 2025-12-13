/**
 * PANTHEON Admin Console
 * 
 * Single master password access point for all admin functionality.
 * Consolidates CryptoCrawler, user management, and subscription controls.
 * 
 * Features:
 * - User list with login credentials and subscription dates
 * - Subscription fee override checkbox per user
 * - CryptoCrawler controls and stats
 * - Monte Carlo simulation management
 * - Real-time status monitoring
 */

import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { 
  Activity, 
  Users,
  Shield,
  AlertTriangle,
  Clock,
  BarChart3,
  Play,
  Pause,
  RefreshCw,
  Terminal,
  Database,
  Bot,
  Wallet,
  Power,
  Eye,
  EyeOff,
  Settings,
  LogOut,
  CheckCircle2,
  XCircle,
  CreditCard,
  Calendar,
  Mail,
  User,
  Crown,
  Loader2,
  Search,
  Filter,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { SEOHead } from "@/components/SEOHead";
import { apiRequest } from "@/lib/queryClient";

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

interface SystemStatus {
  running: boolean;
  cryptoCrawl: {
    enabled: boolean;
    gasOracle: boolean;
    balanceMonitor: boolean;
    networkHealth: boolean;
  };
  monteCarlo: {
    activeSimulations: number;
    totalParticles: number;
  };
  startedAt: string | null;
  uptime: number;
}

// ============================================================================
// ADMIN CONSOLE COMPONENT
// ============================================================================

export default function AdminConsole() {
  const { user, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  // State
  const [users, setUsers] = useState<LoggedUser[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [updatingUsers, setUpdatingUsers] = useState<Set<string>>(new Set());
  
  // Check authentication
  useEffect(() => {
    if (!authLoading && !user) {
      // Redirect to login on 401
      setLocation("/login");
    }
  }, [user, authLoading, setLocation]);

  // Fetch admin data
  const fetchAdminData = useCallback(async () => {
    try {
      setIsLoading(true);
      
      const [usersRes, statsRes, statusRes] = await Promise.all([
        fetch("/api/admin/users/logged", {
          credentials: "include",
          headers: { "Cache-Control": "no-store" },
        }),
        fetch("/api/admin/stats", {
          credentials: "include",
          headers: { "Cache-Control": "no-store" },
        }),
        fetch("/api/admin/system/status", {
          credentials: "include",
          headers: { "Cache-Control": "no-store" },
        }),
      ]);

      if (usersRes.status === 401 || statsRes.status === 401 || statusRes.status === 401) {
        setLocation("/login");
        return;
      }

      if (usersRes.ok) {
        const usersData = await usersRes.json();
        setUsers(usersData.data || []);
      }

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData.data);
      }

      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setSystemStatus(statusData.data);
      }
    } catch (error) {
      console.error("Failed to fetch admin data:", error);
      toast({
        title: "Error",
        description: "Failed to load admin data",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [setLocation, toast]);

  useEffect(() => {
    if (user) {
      fetchAdminData();
      // Refresh every 30 seconds
      const interval = setInterval(fetchAdminData, 30000);
      return () => clearInterval(interval);
    }
  }, [user, fetchAdminData]);

  // Toggle subscription override
  const toggleSubscriptionOverride = async (userId: string, currentValue: boolean) => {
    setUpdatingUsers(prev => new Set(prev).add(userId));
    
    try {
      const res = await fetch(`/api/admin/users/${userId}/subscription-override`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
        body: JSON.stringify({ override: !currentValue }),
      });

      if (res.status === 401) {
        setLocation("/login");
        return;
      }

      if (!res.ok) {
        throw new Error("Failed to update subscription override");
      }

      // Update local state
      setUsers(prev => prev.map(u => 
        u.id === userId 
          ? { ...u, subscriptionOverride: !currentValue, hasPaidForAccess: !currentValue ? true : u.hasPaidForAccess }
          : u
      ));

      toast({
        title: "Success",
        description: `Subscription override ${!currentValue ? "enabled" : "disabled"} for user`,
      });
    } catch (error) {
      console.error("Failed to toggle subscription override:", error);
      toast({
        title: "Error",
        description: "Failed to update subscription override",
        variant: "destructive",
      });
    } finally {
      setUpdatingUsers(prev => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  };

  // Handle logout
  const handleLogout = () => {
    window.location.href = "/api/logout";
  };

  // Filter users by search term
  const filteredUsers = users.filter(u => {
    const searchLower = searchTerm.toLowerCase();
    return (
      u.email?.toLowerCase().includes(searchLower) ||
      u.firstName?.toLowerCase().includes(searchLower) ||
      u.lastName?.toLowerCase().includes(searchLower) ||
      u.id.toLowerCase().includes(searchLower)
    );
  });

  // Format date
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleString();
  };

  // Loading state
  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading admin console...</p>
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    return null; // Will redirect via useEffect
  }

  return (
    <>
      <SEOHead
        title="PANTHEON Admin Console"
        description="Administrative control panel"
        noindex={true}
      />
      
      <div className="min-h-screen bg-background">
        {/* Header */}
        <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-14 items-center justify-between px-4">
            <div className="flex items-center gap-3">
              <Shield className="h-8 w-8 text-primary" />
              <div>
                <h1 className="text-lg font-bold">PANTHEON Admin</h1>
                <p className="text-xs text-muted-foreground">Control Console</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <Badge variant={systemStatus?.running ? "default" : "destructive"}>
                {systemStatus?.running ? "System Online" : "System Offline"}
              </Badge>
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>
        </header>

        <main className="container px-4 py-6">
          {/* Stats Overview */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Users</p>
                    <p className="text-2xl font-bold">{stats?.totalUsers || 0}</p>
                  </div>
                  <Users className="h-8 w-8 text-primary opacity-50" />
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Active Users</p>
                    <p className="text-2xl font-bold">{stats?.activeUsers || 0}</p>
                  </div>
                  <Activity className="h-8 w-8 text-green-500 opacity-50" />
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Paid Users</p>
                    <p className="text-2xl font-bold">{stats?.paidUsers || 0}</p>
                  </div>
                  <CreditCard className="h-8 w-8 text-blue-500 opacity-50" />
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Overridden</p>
                    <p className="text-2xl font-bold">{stats?.overriddenUsers || 0}</p>
                  </div>
                  <Crown className="h-8 w-8 text-yellow-500 opacity-50" />
                </div>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="users" className="space-y-4">
            <TabsList>
              <TabsTrigger value="users">
                <Users className="h-4 w-4 mr-2" />
                User Management
              </TabsTrigger>
              <TabsTrigger value="system">
                <Terminal className="h-4 w-4 mr-2" />
                System Status
              </TabsTrigger>
              <TabsTrigger value="crawlers">
                <Bot className="h-4 w-4 mr-2" />
                Crawlers
              </TabsTrigger>
            </TabsList>

            {/* Users Tab */}
            <TabsContent value="users" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>Logged Users</span>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search users..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-8 w-64"
                        />
                      </div>
                      <Button variant="outline" size="sm" onClick={fetchAdminData}>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Refresh
                      </Button>
                    </div>
                  </CardTitle>
                  <CardDescription>
                    All logged users in descending order (newest first). Check the box to override subscription fees.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[500px]">
                    <div className="space-y-2">
                      {filteredUsers.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          {searchTerm ? "No users match your search" : "No logged users yet"}
                        </div>
                      ) : (
                        filteredUsers.map((loggedUser) => (
                          <div
                            key={loggedUser.id}
                            className="flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                          >
                            {/* Override Checkbox */}
                            <div className="flex items-center">
                              {updatingUsers.has(loggedUser.id) ? (
                                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                              ) : (
                                <Checkbox
                                  checked={loggedUser.subscriptionOverride}
                                  onCheckedChange={() => toggleSubscriptionOverride(loggedUser.id, loggedUser.subscriptionOverride)}
                                  className="h-5 w-5"
                                />
                              )}
                            </div>
                            
                            {/* User Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <User className="h-4 w-4 text-muted-foreground" />
                                <span className="font-medium truncate">
                                  {loggedUser.firstName || loggedUser.lastName 
                                    ? `${loggedUser.firstName || ""} ${loggedUser.lastName || ""}`.trim()
                                    : "Unknown User"}
                                </span>
                                {loggedUser.subscriptionOverride && (
                                  <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-700">
                                    <Crown className="h-3 w-3 mr-1" />
                                    Override
                                  </Badge>
                                )}
                                {loggedUser.hasPaidForAccess && !loggedUser.subscriptionOverride && (
                                  <Badge variant="secondary" className="bg-green-500/20 text-green-700">
                                    <CheckCircle2 className="h-3 w-3 mr-1" />
                                    Paid
                                  </Badge>
                                )}
                              </div>
                              
                              <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Mail className="h-3 w-3" />
                                  {loggedUser.email || "No email"}
                                </span>
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  Joined: {formatDate(loggedUser.createdAt)}
                                </span>
                              </div>
                            </div>
                            
                            {/* Last Login */}
                            <div className="text-right text-sm">
                              <p className="text-muted-foreground">Last Login</p>
                              <p className="font-medium">{formatDate(loggedUser.lastLoginAt)}</p>
                            </div>
                            
                            {/* Status */}
                            <Badge variant={loggedUser.status === "active" ? "default" : "secondary"}>
                              {loggedUser.status}
                            </Badge>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>

            {/* System Status Tab */}
            <TabsContent value="system" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Power className="h-5 w-5" />
                      System Status
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span>Main System</span>
                      <Badge variant={systemStatus?.running ? "default" : "destructive"}>
                        {systemStatus?.running ? "Running" : "Stopped"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Uptime</span>
                      <span className="font-mono">
                        {systemStatus?.uptime ? Math.floor(systemStatus.uptime / 60) + " min" : "N/A"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Started At</span>
                      <span className="font-mono text-sm">
                        {systemStatus?.startedAt ? formatDate(systemStatus.startedAt) : "N/A"}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Database className="h-5 w-5" />
                      CryptoCrawl Status
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span>Enabled</span>
                      <Badge variant={systemStatus?.cryptoCrawl?.enabled ? "default" : "secondary"}>
                        {systemStatus?.cryptoCrawl?.enabled ? "Yes" : "No"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Gas Oracle</span>
                      <Badge variant={systemStatus?.cryptoCrawl?.gasOracle ? "default" : "secondary"}>
                        {systemStatus?.cryptoCrawl?.gasOracle ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Balance Monitor</span>
                      <Badge variant={systemStatus?.cryptoCrawl?.balanceMonitor ? "default" : "secondary"}>
                        {systemStatus?.cryptoCrawl?.balanceMonitor ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Network Health</span>
                      <Badge variant={systemStatus?.cryptoCrawl?.networkHealth ? "default" : "secondary"}>
                        {systemStatus?.cryptoCrawl?.networkHealth ? "Healthy" : "Degraded"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Activity className="h-5 w-5" />
                      Monte Carlo Engine
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span>Active Simulations</span>
                      <span className="font-mono">
                        {systemStatus?.monteCarlo?.activeSimulations || 0}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Total Particles</span>
                      <span className="font-mono">
                        {(systemStatus?.monteCarlo?.totalParticles || 0).toLocaleString()}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Crawlers Tab */}
            <TabsContent value="crawlers" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Crawler Management</CardTitle>
                  <CardDescription>
                    Control and monitor active crawlers
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-8 text-muted-foreground">
                    <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Crawler controls will be added in future updates</p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </>
  );
}
