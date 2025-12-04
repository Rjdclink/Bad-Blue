import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Mail, Save, Send, Loader2, Search, CheckCircle2, Paperclip, X, ArrowLeft, Settings } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { SEOHead } from "@/components/SEOHead";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { User } from "@shared/schema";

interface EmailSettings {
  fromName: string;
  fromEmail: string;
}

interface UserLogin {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  accessActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface UserLoginsResponse {
  users: UserLogin[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export default function AdminEmail() {
  const { toast} = useToast();
  const [, setLocation] = useLocation();

  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState<UserLogin | null>(null);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  
  // Custom email to any address
  const [customToEmail, setCustomToEmail] = useState("");
  const [customSubject, setCustomSubject] = useState("");
  const [customMessage, setCustomMessage] = useState("");
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

  // Fetch email settings
  const { data: settings, isLoading: isLoadingSettings } = useQuery<EmailSettings>({
    queryKey: ['/api/admin/support-email'],
    enabled: !!user && user.id === 'admin-bypass',
  });

  // Update form when settings are loaded
  useEffect(() => {
    if (settings) {
      setFromName(settings.fromName);
      setFromEmail(settings.fromEmail);
    }
  }, [settings]);

  // Fetch user logins
  const { data: loginsData, isLoading: isLoadingLogins } = useQuery<UserLoginsResponse>({
    queryKey: ['/api/admin/users/logins', { query: searchQuery, filter, page }],
    enabled: !!user && user.id === 'admin-bypass',
  });

  // Save email settings mutation
  const saveSettingsMutation = useMutation({
    mutationFn: async (data: EmailSettings) => {
      const res = await apiRequest('/api/admin/support-email', 'POST', data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/support-email'] });
      toast({
        title: "Settings Saved",
        description: "Email settings updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save settings",
        variant: "destructive",
      });
    },
  });

  // Send test email mutation
  const testEmailMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('/api/admin/support-email/test', 'POST', {});
      return await res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Test Email Sent",
        description: data.message,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Test Failed",
        description: error.message || "Failed to send test email",
        variant: "destructive",
      });
    },
  });

  // Send email to user mutation
  const sendUserEmailMutation = useMutation({
    mutationFn: async (data: { toEmail: string; subject: string; message: string; files: File[] }) => {
      const formData = new FormData();
      formData.append('toEmail', data.toEmail);
      formData.append('subject', data.subject);
      formData.append('message', data.message);
      data.files.forEach(file => {
        formData.append('attachments', file);
      });

      const res = await fetch('/api/admin/send-user-email', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to send email');
      }

      return await res.json();
    },
    onSuccess: () => {
      toast({
        title: "Email Sent",
        description: `Email successfully sent to ${selectedUser?.email}`,
      });
      setSelectedUser(null);
      setEmailSubject("");
      setEmailMessage("");
      setAttachments([]);
    },
    onError: (error: any) => {
      toast({
        title: "Send Failed",
        description: error.message || "Failed to send email",
        variant: "destructive",
      });
    },
  });

    // Send custom email mutation
  const sendCustomEmailMutation = useMutation({
    mutationFn: async (data: { to: string; subject: string; message: string }) => {
      const res = await apiRequest('/api/admin/send-custom-email', 'POST', data);
      return await res.json();
    },
    onSuccess: () => {
      toast({
        title: "Email Sent",
        description: `Email successfully sent to ${customToEmail}`,
      });
      setCustomToEmail("");
      setCustomSubject("");
      setCustomMessage("");
    },
    onError: (error: any) => {
      toast({
        title: "Send Failed",
        description: error.message || "Failed to send email",
        variant: "destructive",
      });
    },
  });

  const handleSaveSettings = async () => {
    if (!fromName) {
      toast({
        title: "Validation Error",
        description: "From Name is required",
        variant: "destructive",
      });
      return;
    }

    setIsSavingSettings(true);
    try {
      const response = await fetch('/api/admin/support-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          fromEmail: 'contact.badblue@gmail.com', // Always use static email
          fromName: fromName.trim() 
        }),
      });

      const result = await response.json();

      if (response.ok) {
        queryClient.invalidateQueries({ queryKey: ['/api/admin/support-email'] });
        toast({
          title: "Settings Saved",
          description: result.message || "Email settings have been saved successfully.",
        });
      } else {
        throw new Error(result.message || 'Failed to save settings');
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save email settings.",
        variant: "destructive",
      });
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleTestEmail = () => {
    testEmailMutation.mutate();
  };

  const handleUserClick = (user: UserLogin) => {
    setSelectedUser(user);
    setEmailSubject("");
    setEmailMessage("");
    setAttachments([]);
  };

  const handleSendEmail = () => {
    if (!selectedUser?.email || !emailSubject || !emailMessage) {
      toast({
        title: "Missing Information",
        description: "Please fill in subject and message",
        variant: "destructive",
      });
      return;
    }

    sendUserEmailMutation.mutate({
      toEmail: selectedUser.email,
      subject: emailSubject,
      message: emailMessage,
      files: attachments,
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setAttachments(prev => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSearch = () => {
    setPage(1);

       queryClient.invalidateQueries({ queryKey: ['/api/admin/users/logins'] });
  };

  const handleSendCustomEmail = () => {
    if (!customToEmail || !customSubject || !customMessage) {
      toast({
        title: "Missing Information",
        description: "Please fill in all fields: To, Subject, and Message",
        variant: "destructive",
      });
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customToEmail)) {
      toast({
        title: "Invalid Email",
        description: "Please enter a valid email address",
        variant: "destructive",
      });
      return;
    }

    sendCustomEmailMutation.mutate({
      to: customToEmail,
      subject: customSubject,
      message: customMessage,
      });
    };
  
  if (isLoadingUser) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || user.id !== 'admin-bypass') {
    return null;
  }

  return (
    <>
      <SEOHead
        title="Email Administration - BadBlue Admin"
        description="Configure email settings and view user login activity"
        noIndex={true}
      />

      <div className="container mx-auto p-6 space-y-6">
        {/* Header with Back Button */}
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setLocation('/home')}
            data-testid="button-back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-3">
            <Mail className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-3xl font-bold">Email Administration</h1>
              <p className="text-muted-foreground">Configure support email settings and monitor user activity</p>
            </div>
          </div>
        </div>

        {/* Section A: Email Configuration Settings */}
        <Card data-testid="card-email-settings">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Email Configuration Settings
            </CardTitle>
            <CardDescription>
              Configure the sender information for support emails
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="fromName">From Name</Label>
                <Input
                  id="fromName"
                  data-testid="input-from-name"
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  placeholder="Bad Blue"
                  maxLength={80}
                />
                <p className="text-xs text-muted-foreground">
                  Name displayed in recipient's inbox (max 80 characters)
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="fromEmail">From Email</Label>
                <Input
                  id="fromEmail"
                  data-testid="input-from-email"
                  type="email"
                  value="contact.badblue@gmail.com"
                  disabled
                  className="bg-muted"
                />
                <p className="text-xs text-muted-foreground">
                  Static sender address configured in Resend API
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                data-testid="button-save-settings"
                onClick={handleSaveSettings}
                disabled={saveSettingsMutation.isPending || !fromName}
              >
                {saveSettingsMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save Settings
                  </>
                )}
              </Button>

              <Button
                data-testid="button-test-email"
                variant="outline"
                onClick={handleTestEmail}
                disabled={testEmailMutation.isPending}
              >
                {testEmailMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Send Test Email
                  </>
                )}
              </Button>
            </div>

            {(saveSettingsMutation.isSuccess || testEmailMutation.isSuccess) && (
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                <p className="text-sm font-medium">
                  {saveSettingsMutation.isSuccess && "Settings saved successfully"}
                  {testEmailMutation.isSuccess && "Test email sent successfully"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

       {/* Section B: Send Email to Any Address */}
        <Card data-testid="card-send-custom-email">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Send Email to Any Address
            </CardTitle>
            <CardDescription>
              Send an email to any recipient address (not just users in the database)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md bg-muted p-3">
              <p className="text-sm text-muted-foreground">
                From: BadBlue &lt;noreply@example.com&gt;
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="customToEmail">To</Label>
              <Input
                id="customToEmail"
                data-testid="input-custom-to-email"
                type="email"
                value={customToEmail}
                onChange={(e) => setCustomToEmail(e.target.value)}
                placeholder="recipient@example.com"
                disabled={sendCustomEmailMutation.isPending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="customSubject">Subject</Label>
              <Input
                id="customSubject"
                data-testid="input-custom-subject"
                value={customSubject}
                onChange={(e) => setCustomSubject(e.target.value)}
                placeholder="Email subject line"
                disabled={sendCustomEmailMutation.isPending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="customMessage">Message</Label>
              <Textarea
                id="customMessage"
                data-testid="textarea-custom-message"
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                placeholder="Type your message here..."
                rows={8}
                disabled={sendCustomEmailMutation.isPending}
              />
            </div>

            <div className="flex justify-end">
              <Button
                data-testid="button-send-custom-email"
                onClick={handleSendCustomEmail}
                disabled={sendCustomEmailMutation.isPending || !customToEmail || !customSubject || !customMessage}
              >
                {sendCustomEmailMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Send Email
                  </>
                )}
              </Button>
            </div>

            {sendCustomEmailMutation.isSuccess && (
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                <p className="text-sm font-medium">
                  Email sent successfully to {customToEmail}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Section C: User Logins */}
    
        <Card data-testid="card-user-logins">
          <CardHeader>
            <CardTitle>User Login Activity</CardTitle>
            <CardDescription>
              Monitor user login times and subscription status
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Search and Filter */}
            <div className="flex flex-col md:flex-row gap-3">
              <div className="flex-1">
                <div className="flex gap-2">
                  <Input
                    data-testid="input-search-users"
                    placeholder="Search by name or email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  />
                  <Button
                    data-testid="button-search"
                    variant="outline"
                    onClick={handleSearch}
                  >
                    <Search className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="w-full md:w-48" data-testid="select-filter">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Users</SelectItem>
                  <SelectItem value="subscribers">Subscribers Only</SelectItem>
                  <SelectItem value="non_subscribers">Non-Subscribers Only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Users Table */}
            {isLoadingLogins ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Last Login</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loginsData?.users.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground">
                            No users found
                          </TableCell>
                        </TableRow>
                      ) : (
                        loginsData?.users.map((user) => (
                          <TableRow 
                            key={user.id} 
                            data-testid={`row-user-${user.id}`}
                            className="cursor-pointer hover-elevate"
                            onClick={() => user.email && handleUserClick(user)}
                          >
                            <TableCell className="font-medium">
                              {user.first_name || user.last_name
                                ? `${user.first_name || ''} ${user.last_name || ''}`.trim()
                                : 'N/A'}
                            </TableCell>
                            <TableCell data-testid={`text-email-${user.id}`}>
                              {user.email || 'N/A'}
                            </TableCell>
                            <TableCell>
                              <Badge
                                data-testid={`badge-status-${user.id}`}
                                variant={user.accessActive ? "default" : "secondary"}
                              >
                                {user.accessActive ? 'Active' : 'Inactive'}
                              </Badge>
                            </TableCell>
                            <TableCell data-testid={`text-last-login-${user.id}`}>
                              {user.lastLoginAt
                                ? formatDistanceToNow(new Date(user.lastLoginAt), { addSuffix: true })
                                : 'Never'}
                            </TableCell>
                            <TableCell>
                              {formatDistanceToNow(new Date(user.createdAt), { addSuffix: true })}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                {loginsData && loginsData.pagination.totalPages > 1 && (
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      Showing {((loginsData.pagination.page - 1) * loginsData.pagination.limit) + 1} to{' '}
                      {Math.min(loginsData.pagination.page * loginsData.pagination.limit, loginsData.pagination.total)}{' '}
                      of {loginsData.pagination.total} users
                    </p>
                    <div className="flex gap-2">
                      <Button
                        data-testid="button-prev-page"
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={loginsData.pagination.page === 1}
                      >
                        Previous
                      </Button>
                      <Button
                        data-testid="button-next-page"
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => p + 1)}
                        disabled={loginsData.pagination.page >= loginsData.pagination.totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Email Composition Dialog */}
      <Dialog open={!!selectedUser} onOpenChange={(open) => !open && setSelectedUser(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Send Email to User</DialogTitle>
            <DialogDescription>
              Compose and send an email to {selectedUser?.first_name} {selectedUser?.last_name} ({selectedUser?.email})
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email-subject">Subject</Label>
              <Input
                id="email-subject"
                data-testid="input-email-subject"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                placeholder="Enter email subject..."
                disabled={sendUserEmailMutation.isPending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email-message">Message</Label>
              <Textarea
                id="email-message"
                data-testid="textarea-email-message"
                value={emailMessage}
                onChange={(e) => setEmailMessage(e.target.value)}
                placeholder="Enter email message..."
                rows={8}
                disabled={sendUserEmailMutation.isPending}
              />
            </div>

            <div className="space-y-2">
              <Label>Attachments</Label>
              <div className="flex gap-2">
                <Input
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  disabled={sendUserEmailMutation.isPending}
                  data-testid="input-attachments"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled
                  data-testid="button-attach-file"
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
              </div>
              {attachments.length > 0 && (
                <div className="space-y-1 mt-2">
                  {attachments.map((file, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 text-sm p-2 rounded-md bg-muted"
                      data-testid={`attachment-${index}`}
                    >
                      <Paperclip className="h-4 w-4" />
                      <span className="flex-1">{file.name}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => handleRemoveAttachment(index)}
                        data-testid={`button-remove-attachment-${index}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSelectedUser(null)}
              disabled={sendUserEmailMutation.isPending}
              data-testid="button-cancel-email"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSendEmail}
              disabled={sendUserEmailMutation.isPending || !emailSubject || !emailMessage}
              data-testid="button-send-email"
            >
              {sendUserEmailMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Send Email
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
