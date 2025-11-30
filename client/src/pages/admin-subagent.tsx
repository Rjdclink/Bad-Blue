import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Brain, Terminal, History, Loader2, Check, X, AlertCircle, ShieldAlert, Undo } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { SEOHead } from "@/components/SEOHead";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { User } from "@shared/schema";

interface SubAgentLog {
  id: string;
  adminId: string;
  command: string;
  category: string | null;
  status: string;
  response: string | null;
  executionTimeMs: number | null;
  errorMessage: string | null;
  metadata: any;
  createdAt: string;
  completedAt: string | null;
}

export default function AdminSubAgent() {
  const [command, setCommand] = useState("");
  const [currentLogId, setCurrentLogId] = useState<string | null>(null);
  const [pollInterval, setPollInterval] = useState<number | null>(null);
  const { toast } = useToast();
  const responseRef = useRef<HTMLDivElement>(null);
  const [, setLocation] = useLocation();

  // Check authentication and admin status
  const { data: user, isLoading: isLoadingUser } = useQuery<User>({
    queryKey: ['/api/auth/user'],
  });

  // Redirect if not admin
  useEffect(() => {
    if (!isLoadingUser && (!user || user.id !== 'admin-bypass')) {
      toast({
        title: "Access Denied",
        description: "Admin access required",
        variant: "destructive",
      });
      setLocation('/');
    }
  }, [user, isLoadingUser, setLocation, toast]);

  // Fetch command history
  const { data: history, isLoading: isLoadingHistory } = useQuery<SubAgentLog[]>({
    queryKey: ['/api/admin/subagent/history'],
    enabled: !!user && user.id === 'admin-bypass',
  });

  // Fetch last change for undo button
  const { data: lastChangeData } = useQuery<{ hasChange: boolean; change: any }>({
    queryKey: ['/api/admin/subagent/last-change'],
    enabled: !!user && user.id === 'admin-bypass',
    refetchInterval: 2000, // Refresh every 2 seconds
  });

  // Poll for status updates when command is processing
  const { data: statusData } = useQuery<{ log: SubAgentLog }>({
    queryKey: ['/api/admin/subagent/status', currentLogId],
    enabled: !!currentLogId && pollInterval !== null,
    refetchInterval: pollInterval || false,
  });

  // Execute command mutation
  const executeCommandMutation = useMutation({
    mutationFn: async (cmd: string) => {
      console.log('[AI SUB-AGENT CLIENT] Sending command:', cmd);
      console.log('[AI SUB-AGENT CLIENT] User:', user);
      
      const res = await apiRequest('/api/admin/subagent/command', 'POST', { command: cmd });
      const data = await res.json();
      console.log('[AI SUB-AGENT CLIENT] Response data:', data);
      return data;
    },
    onSuccess: (data) => {
      setCurrentLogId(data.logId);
      setPollInterval(1000); // Poll every second
      queryClient.invalidateQueries({ queryKey: ['/api/admin/subagent/history'] });
      
      toast({
        title: "Command Submitted",
        description: "AI Sub-Agent is processing your command...",
      });
    },
    onError: (error: any) => {
      console.error('[AI SUB-AGENT CLIENT] Mutation error:', error);
      toast({
        title: "Command Failed",
        description: error.message || "Failed to execute command",
        variant: "destructive",
      });
    },
  });

  // Undo last change mutation
  const undoMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('/api/admin/subagent/undo', 'POST', {});
      const data = await res.json();
      return data;
    },
    onSuccess: (data) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['/api/admin/subagent/last-change'] });
        queryClient.invalidateQueries({ queryKey: ['/api/admin/subagent/history'] });
        toast({
          title: "Change Undone",
          description: data.message,
        });
      } else {
        toast({
          title: "Undo Failed",
          description: data.message,
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Undo Failed",
        description: error.message || "Failed to undo change",
        variant: "destructive",
      });
    },
  });

  // Stop polling when command completes
  useEffect(() => {
    if (statusData?.log && (statusData.log.status === 'completed' || statusData.log.status === 'failed')) {
      setPollInterval(null);
      setCurrentLogId(null);
      queryClient.invalidateQueries({ queryKey: ['/api/admin/subagent/history'] });
      
      if (statusData.log.status === 'completed') {
        toast({
          title: "Command Completed",
          description: `Executed in ${statusData.log.executionTimeMs}ms`,
        });
      } else {
        toast({
          title: "Command Failed",
          description: statusData.log.errorMessage || "Unknown error",
          variant: "destructive",
        });
      }

      // Scroll to response
      setTimeout(() => {
        responseRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    }
  }, [statusData, toast]);

  const handleExecute = () => {
    if (!command.trim()) {
      toast({
        title: "Empty Command",
        description: "Please enter a command",
        variant: "destructive",
      });
      return;
    }

    executeCommandMutation.mutate(command);
    setCommand(""); // Clear input
  };

  const getStatusBadge = (status: string) => {
    const config: Record<string, { icon: any; variant: "default" | "secondary" | "destructive" }> = {
      processing: { icon: Loader2, variant: "secondary" },
      completed: { icon: Check, variant: "default" },
      failed: { icon: X, variant: "destructive" },
    };

    const { icon: Icon, variant } = config[status] || { icon: AlertCircle, variant: "secondary" };

    return (
      <Badge variant={variant} className="gap-1">
        <Icon className={`w-3 h-3 ${status === 'processing' ? 'animate-spin' : ''}`} />
        {status}
      </Badge>
    );
  };

  const quickCommands = [
    { label: "System Status", command: "Check system health and resource usage" },
    { label: "Security Audit", command: "Run full security audit of the application" },
    { label: "Performance Analysis", command: "Analyze application performance and identify bottlenecks" },
    { label: "Self-Reflection", command: "self-reflection" },
    { label: "Database Health", command: "Check database health and connection status" },
    { label: "Recent Errors", command: "Analyze recent errors and suggest fixes" },
  ];

  // Show loading state
  if (isLoadingUser) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Verifying admin access...</p>
        </div>
      </div>
    );
  }

  // Show access denied if not admin
  if (!user || user.id !== 'admin-bypass') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="w-5 h-5" />
              Access Denied
            </CardTitle>
            <CardDescription>
              Administrator privileges required to access this page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/">
              <Button className="w-full">Return to Home</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="AI Sub-Agent Control Panel | BadBlue"
        description="Advanced AI assistant with full system control"
        noIndex={true}
      />

      <header className="border-b bg-card sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-6 h-6 text-primary" />
            <span className="font-semibold text-lg">AI Sub-Agent Control Panel</span>
          </div>
          <Link href="/">
            <Button variant="outline" size="sm" data-testid="button-back-home">
              Back to Home
            </Button>
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        {/* Command Input Card */}
        <Card data-testid="card-command-input">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="w-5 h-5" />
              Execute Command
            </CardTitle>
            <CardDescription>
              Send commands to the AI Sub-Agent for system analysis, debugging, code generation, and more.
              The AI has full access to all application systems and can perform complex operations.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="command">Command</Label>
              <Textarea
                id="command"
                placeholder="Enter your command here (e.g., 'Analyze database performance', 'Check for security vulnerabilities', 'Generate report on user activity')"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleExecute();
                  }
                }}
                rows={4}
                className="font-mono text-sm"
                data-testid="input-command"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Press Cmd+Enter (Mac) or Ctrl+Enter (Windows) to execute
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={handleExecute}
                disabled={executeCommandMutation.isPending || !!currentLogId}
                data-testid="button-execute"
              >
                {executeCommandMutation.isPending || currentLogId ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Terminal className="w-4 h-4 mr-2" />
                    Execute Command
                  </>
                )}
              </Button>
            </div>

            {/* Quick Commands */}
            <div>
              <Label className="text-sm text-muted-foreground mb-2 block">Quick Commands</Label>
              <div className="flex flex-wrap gap-2">
                {quickCommands.map((qc, idx) => (
                  <Button
                    key={idx}
                    variant="outline"
                    size="sm"
                    onClick={() => setCommand(qc.command)}
                    disabled={executeCommandMutation.isPending || !!currentLogId}
                    data-testid={`button-quick-${idx}`}
                  >
                    {qc.label}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Current Execution Status */}
        {statusData?.log && statusData.log.status === 'processing' && (
          <Card className="border-primary" ref={responseRef}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                Processing Command...
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Command:</span>
                  <code className="text-sm bg-muted px-2 py-1 rounded">{statusData.log.command}</code>
                </div>
                {statusData.log.category && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Category:</span>
                    <Badge variant="secondary">{statusData.log.category}</Badge>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Command History */}
        <Card data-testid="card-history">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <CardTitle className="flex items-center gap-2">
                  <History className="w-5 h-5" />
                  Command History
                </CardTitle>
                <CardDescription>
                  View all executed commands and their results
                </CardDescription>
              </div>
              
              {/* Undo/Restore Button - Upper Right Corner */}
              {lastChangeData?.hasChange && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => undoMutation.mutate()}
                  disabled={undoMutation.isPending}
                  data-testid="button-undo"
                  className="flex items-center gap-2"
                >
                  {undoMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Undoing...
                    </>
                  ) : (
                    <>
                      <Undo className="w-4 h-4" />
                      Undo Last Change
                    </>
                  )}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isLoadingHistory ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : history && history.length > 0 ? (
              <div className="space-y-4">
                {history.map((log) => (
                  <div
                    key={log.id}
                    className="border rounded-lg p-4 space-y-3"
                    data-testid={`log-${log.id}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {getStatusBadge(log.status)}
                          {log.category && (
                            <Badge variant="outline" className="text-xs">
                              {log.category}
                            </Badge>
                          )}
                          {log.executionTimeMs && (
                            <span className="text-xs text-muted-foreground">
                              {log.executionTimeMs}ms
                            </span>
                          )}
                        </div>
                        <code className="text-sm bg-muted px-2 py-1 rounded block">
                          {log.command}
                        </code>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                      </span>
                    </div>

                    {log.response && (
                      <div className="mt-2">
                        <Label className="text-xs text-muted-foreground">Response</Label>
                        <ScrollArea className="h-[400px] mt-1">
                          <div className="p-3 bg-muted rounded text-sm whitespace-pre-wrap font-mono">
                            {log.response}
                          </div>
                        </ScrollArea>
                      </div>
                    )}

                    {log.errorMessage && (
                      <div className="mt-2">
                        <Label className="text-xs text-destructive">Error</Label>
                        <div className="mt-1 p-3 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">
                          {log.errorMessage}
                        </div>
                      </div>
                    )}

                    {log.metadata && Object.keys(log.metadata).length > 0 && (
                      <details className="mt-2">
                        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                          View Metadata
                        </summary>
                        <pre className="mt-2 p-3 bg-muted rounded text-xs overflow-auto">
                          {JSON.stringify(log.metadata, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Terminal className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No commands executed yet</p>
                <p className="text-sm">Start by entering a command above</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Capabilities Reference */}
        <Card>
          <CardHeader>
            <CardTitle>AI Sub-Agent Capabilities</CardTitle>
            <CardDescription>
              Advanced autonomous features integrated into the AI Sub-Agent
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <h4 className="font-semibold mb-2">Core Capabilities</h4>
                <ul className="space-y-1 text-muted-foreground">
                  <li>• Automatic error recovery (3-retry system)</li>
                  <li>• Learning & adaptation from past executions</li>
                  <li>• AI-powered command categorization</li>
                  <li>• Self-reflection and performance analysis</li>
                  <li>• Language learning from code samples</li>
                  <li>• Full system audits</li>
                  <li>• External system integration & mimicking</li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold mb-2">Advanced Autonomous Capabilities</h4>
                <ul className="space-y-1 text-muted-foreground">
                  <li>• Multi-modal perception (network/code/UI correlation)</li>
                  <li>• World modeling (environment understanding)</li>
                  <li>• Internal simulation (pre-deployment testing)</li>
                  <li>• Access logic modeling (security reasoning)</li>
                  <li>• Supply chain intelligence (dependency analysis)</li>
                  <li>• Behavioral baseline & anomaly detection</li>
                  <li>• Correlation analysis (signal fusion)</li>
                  <li>• Fault tolerance (recovery strategies)</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
