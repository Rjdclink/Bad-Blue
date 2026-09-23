import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Shield, ArrowLeft, Activity, AlertTriangle, CheckCircle, XCircle, Clock, Info } from "lucide-react";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";

interface FailureLogEntry {
  timestamp: string;
  functionAffected: string;
  cause: string;
  systemState: 'working' | 'not_working';
  severity: 1 | 2 | 3 | 4 | 5;
  resolved?: boolean;
  resolvedAt?: string;
}

interface FunctionErrorLogEntry {
  timestamp: string;
  functionTested: string;
  expectedBehavior: string;
  observedBehavior: string;
  severity: 1 | 2 | 3 | 4 | 5;
  status: 'fixed' | 'pending';
  notes?: string;
}

const getSeverityLabel = (severity: number) => {
  switch (severity) {
    case 1: return 'Notice';
    case 2: return 'Warning';
    case 3: return 'Moderate';
    case 4: return 'Serious';
    case 5: return 'Critical';
    default: return 'Unknown';
  }
};

const getSeverityColor = (severity: number) => {
  switch (severity) {
    case 1: return 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200';
    case 2: return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
    case 3: return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
    case 4: return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    case 5: return 'bg-red-200 text-red-900 dark:bg-red-800 dark:text-red-100 font-bold';
    default: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
  }
};

const getSeverityIcon = (severity: number) => {
  switch (severity) {
    case 1: return <Info className="w-4 h-4" />;
    case 2: return <AlertTriangle className="w-4 h-4" />;
    case 3: return <AlertTriangle className="w-4 h-4" />;
    case 4: return <XCircle className="w-4 h-4" />;
    case 5: return <XCircle className="w-4 h-4" />;
    default: return <Info className="w-4 h-4" />;
  }
};

export default function AdminWorkerLogs() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [sortBy, setSortBy] = useState<'time' | 'severity'>('time');
  const [filterSeverity, setFilterSeverity] = useState<number | null>(null);

  // Redirect if not admin
  if (!user || !(user as any).isAdmin) {
    setLocation('/');
    return null;
  }

  // Fetch failure logs
  const { data: failureLogsData, isLoading: failureLogsLoading, refetch: refetchFailureLogs } = useQuery<{ logs: FailureLogEntry[] }>({
    queryKey: ['/api/admin/worker/failure-logs'],
  });

  // Fetch function error logs
  const { data: functionErrorLogsData, isLoading: functionErrorLogsLoading, refetch: refetchFunctionErrorLogs } = useQuery<{ logs: FunctionErrorLogEntry[] }>({
    queryKey: ['/api/admin/worker/function-error-logs'],
  });

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/";
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to logout",
        variant: "destructive",
      });
    }
  };

  const sortAndFilterLogs = <T extends FailureLogEntry | FunctionErrorLogEntry>(logs: T[]): T[] => {
    let filtered = logs;

    // Filter by severity
    if (filterSeverity !== null) {
      filtered = filtered.filter(log => log.severity === filterSeverity);
    }

    // Sort
    if (sortBy === 'time') {
      filtered = [...filtered].sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    } else if (sortBy === 'severity') {
      filtered = [...filtered].sort((a, b) => b.severity - a.severity);
    }

    return filtered;
  };

  const failureLogs = sortAndFilterLogs(failureLogsData?.logs || []);
  const functionErrorLogs = sortAndFilterLogs(functionErrorLogsData?.logs || []);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center gap-4 px-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <span className="font-semibold">BadBlue</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <LanguageSelector />
            <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout">
              Logout
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="container px-4 py-8 max-w-7xl mx-auto">
        {/* Back Button */}
        <Button
          variant="ghost"
          onClick={() => setLocation('/')}
          className="mb-6"
          data-testid="button-back"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Home
        </Button>

        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-3 rounded-lg bg-cyan-500/10">
              <Activity className="w-8 h-8 text-cyan-600 dark:text-cyan-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Worker Logs</h1>
              <p className="text-muted-foreground">
                Monitor background worker diagnostics and system health
              </p>
            </div>
          </div>
        </div>

        {/* Controls */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Filter & Sort Options</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Sort by:</span>
                <Button
                  variant={sortBy === 'time' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSortBy('time')}
                  data-testid="button-sort-time"
                >
                  <Clock className="w-4 h-4 mr-2" />
                  Time
                </Button>
                <Button
                  variant={sortBy === 'severity' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSortBy('severity')}
                  data-testid="button-sort-severity"
                >
                  <AlertTriangle className="w-4 h-4 mr-2" />
                  Severity
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Filter:</span>
                <Button
                  variant={filterSeverity === null ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterSeverity(null)}
                  data-testid="button-filter-all"
                >
                  All
                </Button>
                {[1, 2, 3, 4, 5].map(sev => (
                  <Button
                    key={sev}
                    variant={filterSeverity === sev ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFilterSeverity(sev)}
                    data-testid={`button-filter-${sev}`}
                  >
                    {getSeverityLabel(sev)}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Logs Tabs */}
        <Tabs defaultValue="failure" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="failure" data-testid="tab-failure-logs">
              Worker Failure Log
              {failureLogs.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {failureLogs.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="function" data-testid="tab-function-logs">
              Worker Function Error Log
              {functionErrorLogs.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {functionErrorLogs.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Failure Logs Tab */}
          <TabsContent value="failure">
            <Card>
              <CardHeader>
                <CardTitle>Worker Failure Log</CardTitle>
                <CardDescription>
                  Displays failures detected by the 6-hour diagnostic cycle and daily repair operations
                </CardDescription>
              </CardHeader>
              <CardContent>
                {failureLogsLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : failureLogs.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle className="w-12 h-12 mx-auto mb-2 text-green-500" />
                    <p>No failures detected - all systems healthy</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Timestamp</TableHead>
                          <TableHead>Function/Process</TableHead>
                          <TableHead>Cause</TableHead>
                          <TableHead>System State</TableHead>
                          <TableHead>Severity</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {failureLogs.map((log, index) => (
                          <TableRow key={index} data-testid={`failure-log-${index}`}>
                            <TableCell className="text-sm">
                              {new Date(log.timestamp).toLocaleString()}
                            </TableCell>
                            <TableCell className="font-medium">{log.functionAffected}</TableCell>
                            <TableCell className="text-sm max-w-md">{log.cause}</TableCell>
                            <TableCell>
                              <Badge variant={log.systemState === 'working' ? 'default' : 'destructive'}>
                                {log.systemState === 'working' ? 'Working' : 'Not Working'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge className={getSeverityColor(log.severity)}>
                                <span className="flex items-center gap-1">
                                  {getSeverityIcon(log.severity)}
                                  {log.severity} - {getSeverityLabel(log.severity)}
                                </span>
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {log.resolved ? (
                                <div className="text-sm">
                                  <Badge variant="default" className="bg-green-500">
                                    <CheckCircle className="w-3 h-3 mr-1" />
                                    Resolved
                                  </Badge>
                                  {log.resolvedAt && (
                                    <div className="text-xs text-muted-foreground mt-1">
                                      {new Date(log.resolvedAt).toLocaleString()}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <Badge variant="secondary">Pending</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Function Error Logs Tab */}
          <TabsContent value="function">
            <Card>
              <CardHeader>
                <CardTitle>Worker Function Error Log</CardTitle>
                <CardDescription>
                  Displays results from the weekly system-wide functional test (Sunday 2:00 PM CST)
                </CardDescription>
              </CardHeader>
              <CardContent>
                {functionErrorLogsLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : functionErrorLogs.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle className="w-12 h-12 mx-auto mb-2 text-green-500" />
                    <p>No test results yet - weekly test runs every Sunday at 2:00 PM CST</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Timestamp</TableHead>
                          <TableHead>Function/Component</TableHead>
                          <TableHead>Expected</TableHead>
                          <TableHead>Observed</TableHead>
                          <TableHead>Severity</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Notes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {functionErrorLogs.map((log, index) => (
                          <TableRow 
                            key={index} 
                            data-testid={`function-log-${index}`}
                            className={log.severity >= 4 ? 'bg-red-50 dark:bg-red-950/20' : ''}
                          >
                            <TableCell className="text-sm">
                              {new Date(log.timestamp).toLocaleString()}
                            </TableCell>
                            <TableCell className="font-medium">{log.functionTested}</TableCell>
                            <TableCell className="text-sm max-w-xs">{log.expectedBehavior}</TableCell>
                            <TableCell className="text-sm max-w-xs">{log.observedBehavior}</TableCell>
                            <TableCell>
                              <Badge className={getSeverityColor(log.severity)}>
                                <span className="flex items-center gap-1">
                                  {getSeverityIcon(log.severity)}
                                  {log.severity} - {getSeverityLabel(log.severity)}
                                </span>
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={log.status === 'fixed' ? 'default' : 'secondary'}>
                                {log.status === 'fixed' ? (
                                  <span className="flex items-center gap-1">
                                    <CheckCircle className="w-3 h-3" />
                                    Fixed
                                  </span>
                                ) : (
                                  'Pending'
                                )}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {log.notes || '-'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
