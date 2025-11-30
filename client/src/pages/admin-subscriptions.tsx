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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { 
  CreditCard, 
  Plus, 
  Edit, 
  Trash2, 
  ArrowLeft, 
  Loader2, 
  DollarSign,
  Calendar,
  Users,
  Check,
  X,
  Mail,
  Clock,
  UserCheck,
  FileText,
  Scale,
  Megaphone,
  FileSearch,
  ShoppingBag,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { SEOHead } from "@/components/SEOHead";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { User } from "@shared/schema";

interface PaidServices {
  complaints: number;
  lawsuits: number;
  petitions: number;
  foiaRequests: number;
  total: number;
}

interface UserWithServices extends User {
  paidServices: PaidServices;
}

interface SubscriptionTier {
  id: string;
  name: string;
  description: string | null;
  priceInCents: number;
  durationDays: number;
  stripePriceId: string | null;
  stripeProductId: string | null;
  features: string[] | null;
  isActive: boolean;
  isDefault: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface UserSubscription {
  id: string;
  user_id: string;
  tier_id: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  payment_id: string | null;
  created_at: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  tier_name: string;
  price_in_cents: number;
}

export default function AdminSubscriptions() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("users");
  
  // Tier Management State
  const [showTierDialog, setShowTierDialog] = useState(false);
  const [editingTier, setEditingTier] = useState<SubscriptionTier | null>(null);
  const [tierForm, setTierForm] = useState({
    name: "",
    description: "",
    priceInCents: "",
    durationDays: "",
    features: "",
    isActive: true,
    isDefault: false,
    sortOrder: "0",
  });

  // User Subscription State
  const [page, setPage] = useState(1);
  const [usersPage, setUsersPage] = useState(1);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedTierId, setSelectedTierId] = useState("");

  // Check authentication and admin status
  const { data: user, isLoading: isLoadingUser } = useQuery<User>({
    queryKey: ['/api/auth/user'],
  });

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

  // Fetch all registered users (Bad Blue Users) with paid services
  const { data: usersData, isLoading: isLoadingUsers } = useQuery<{
    users: UserWithServices[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>({
    queryKey: ['/api/admin/users', usersPage],
    enabled: !!user && user.id === 'admin-bypass',
  });

  // Fetch subscription tiers
  const { data: tiersData, isLoading: isLoadingTiers } = useQuery<{ tiers: SubscriptionTier[] }>({
    queryKey: ['/api/admin/subscription-tiers'],
    enabled: !!user && user.id === 'admin-bypass',
  });

  // Fetch user subscriptions
  const { data: subscriptionsData, isLoading: isLoadingSubscriptions } = useQuery<{
    subscriptions: UserSubscription[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>({
    queryKey: ['/api/admin/user-subscriptions', page],
    enabled: !!user && user.id === 'admin-bypass',
  });

  // Create tier mutation
  const createTierMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest('/api/admin/subscription-tiers', 'POST', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/subscription-tiers'] });
      toast({
        title: "Success",
        description: "Subscription tier created successfully",
      });
      setShowTierDialog(false);
      resetTierForm();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create subscription tier",
        variant: "destructive",
      });
    },
  });

  // Update tier mutation
  const updateTierMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return await apiRequest(`/api/admin/subscription-tiers/${id}`, 'PATCH', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/subscription-tiers'] });
      toast({
        title: "Success",
        description: "Subscription tier updated successfully",
      });
      setShowTierDialog(false);
      setEditingTier(null);
      resetTierForm();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update subscription tier",
        variant: "destructive",
      });
    },
  });

  // Delete tier mutation
  const deleteTierMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest(`/api/admin/subscription-tiers/${id}`, 'DELETE');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/subscription-tiers'] });
      toast({
        title: "Success",
        description: "Subscription tier deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete subscription tier",
        variant: "destructive",
      });
    },
  });

  // Assign subscription mutation
  const assignSubscriptionMutation = useMutation({
    mutationFn: async (data: { userId: string; tierId: string }) => {
      return await apiRequest('/api/admin/user-subscriptions', 'POST', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/user-subscriptions'] });
      toast({
        title: "Success",
        description: "Subscription assigned successfully",
      });
      setShowAssignDialog(false);
      setSelectedUserId("");
      setSelectedTierId("");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to assign subscription",
        variant: "destructive",
      });
    },
  });

  // Cancel subscription mutation
  const cancelSubscriptionMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest(`/api/admin/user-subscriptions/${id}/cancel`, 'PATCH');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/user-subscriptions'] });
      toast({
        title: "Success",
        description: "Subscription cancelled successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to cancel subscription",
        variant: "destructive",
      });
    },
  });

  const resetTierForm = () => {
    setTierForm({
      name: "",
      description: "",
      priceInCents: "",
      durationDays: "",
      features: "",
      isActive: true,
      isDefault: false,
      sortOrder: "0",
    });
  };

  const handleEditTier = (tier: SubscriptionTier) => {
    setEditingTier(tier);
    setTierForm({
      name: tier.name,
      description: tier.description || "",
      priceInCents: tier.priceInCents.toString(),
      durationDays: tier.durationDays.toString(),
      features: tier.features?.join("\n") || "",
      isActive: tier.isActive,
      isDefault: tier.isDefault,
      sortOrder: tier.sortOrder.toString(),
    });
    setShowTierDialog(true);
  };

  const handleSaveTier = () => {
    const data = {
      name: tierForm.name,
      description: tierForm.description || null,
      priceInCents: parseInt(tierForm.priceInCents),
      durationDays: parseInt(tierForm.durationDays),
      features: tierForm.features ? tierForm.features.split("\n").filter(f => f.trim()) : [],
      isActive: tierForm.isActive,
      isDefault: tierForm.isDefault,
      sortOrder: parseInt(tierForm.sortOrder),
    };

    if (editingTier) {
      updateTierMutation.mutate({ id: editingTier.id, data });
    } else {
      createTierMutation.mutate(data);
    }
  };

  const formatPrice = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  if (isLoadingUser || !user || user.id !== 'admin-bypass') {
    return (
      <div className="flex items-center justify-center min-h-screen" data-testid="loading-spinner">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SEOHead 
        title="Bad Blue Users - Admin - BadBlue"
        description="View and manage all registered Bad Blue users"
        noIndex={true}
      />

      <div className="container mx-auto py-8 px-4 max-w-7xl">
        <div className="mb-6">
          <Button
            variant="ghost"
            onClick={() => setLocation('/')}
            className="mb-4"
            data-testid="button-back-home"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Home
          </Button>

          <h1 className="text-3xl font-bold mb-2">Bad Blue Users</h1>
          <p className="text-muted-foreground">
            View all registered users and manage subscriptions
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6 flex-wrap gap-1">
            <TabsTrigger value="users" data-testid="tab-users">
              <UserCheck className="h-4 w-4 mr-2" />
              All Users ({usersData?.pagination?.total || 0})
            </TabsTrigger>
            <TabsTrigger value="tiers" data-testid="tab-tiers">
              <CreditCard className="h-4 w-4 mr-2" />
              Subscription Tiers
            </TabsTrigger>
            <TabsTrigger value="subscriptions" data-testid="tab-subscriptions">
              <Users className="h-4 w-4 mr-2" />
              User Subscriptions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <CardTitle>All Registered Users</CardTitle>
                    <CardDescription>
                      View all users who have signed up for Bad Blue accounts
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="text-lg px-3 py-1">
                    {usersData?.pagination?.total || 0} Total Users
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingUsers ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : usersData?.users && usersData.users.length > 0 ? (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>User</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Signed Up</TableHead>
                          <TableHead>Last Login</TableHead>
                          <TableHead>Paid Services</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {usersData.users.map((u) => (
                          <TableRow key={u.id} data-testid={`user-row-${u.id}`}>
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                                  <UserCheck className="h-4 w-4 text-primary" />
                                </div>
                                <div>
                                  {u.firstName || u.lastName 
                                    ? `${u.firstName || ''} ${u.lastName || ''}`.trim()
                                    : "Unknown User"}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Mail className="h-4 w-4 text-muted-foreground" />
                                {u.email || "No email"}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Calendar className="h-4 w-4 text-muted-foreground" />
                                {u.createdAt 
                                  ? format(new Date(u.createdAt), "MMM d, yyyy")
                                  : "Unknown"}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Clock className="h-4 w-4 text-muted-foreground" />
                                {u.lastLoginAt 
                                  ? formatDistanceToNow(new Date(u.lastLoginAt), { addSuffix: true })
                                  : "Never"}
                              </div>
                            </TableCell>
                            <TableCell>
                              {u.paidServices && u.paidServices.total > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {u.paidServices.complaints > 0 && (
                                    <Badge variant="outline" className="text-xs" title="Complaints filed">
                                      <FileText className="h-3 w-3 mr-1" />
                                      {u.paidServices.complaints}
                                    </Badge>
                                  )}
                                  {u.paidServices.lawsuits > 0 && (
                                    <Badge variant="outline" className="text-xs" title="Lawsuits filed">
                                      <Scale className="h-3 w-3 mr-1" />
                                      {u.paidServices.lawsuits}
                                    </Badge>
                                  )}
                                  {u.paidServices.petitions > 0 && (
                                    <Badge variant="outline" className="text-xs" title="Petitions created">
                                      <Megaphone className="h-3 w-3 mr-1" />
                                      {u.paidServices.petitions}
                                    </Badge>
                                  )}
                                  {u.paidServices.foiaRequests > 0 && (
                                    <Badge variant="outline" className="text-xs" title="FOIA requests">
                                      <FileSearch className="h-3 w-3 mr-1" />
                                      {u.paidServices.foiaRequests}
                                    </Badge>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted-foreground text-sm">None</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant={u.hasPaidForAccess ? "default" : "secondary"}>
                                {u.hasPaidForAccess ? "Active" : "Free"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                    {usersData.pagination && usersData.pagination.totalPages > 1 && (
                      <div className="flex items-center justify-between mt-4">
                        <p className="text-sm text-muted-foreground">
                          Page {usersData.pagination.page} of {usersData.pagination.totalPages}
                          {" "}({usersData.pagination.total} total users)
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={usersPage === 1}
                            onClick={() => setUsersPage(p => p - 1)}
                            data-testid="button-prev-users-page"
                          >
                            Previous
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={usersPage >= usersData.pagination.totalPages}
                            onClick={() => setUsersPage(p => p + 1)}
                            data-testid="button-next-users-page"
                          >
                            Next
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No registered users yet</p>
                    <p className="text-sm">Users will appear here when they sign up</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tiers">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Subscription Tiers</CardTitle>
                    <CardDescription>
                      Create and manage subscription plans
                    </CardDescription>
                  </div>
                  <Button
                    onClick={() => {
                      resetTierForm();
                      setEditingTier(null);
                      setShowTierDialog(true);
                    }}
                    data-testid="button-create-tier"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Create Tier
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingTiers ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : tiersData?.tiers && tiersData.tiers.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Features</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tiersData.tiers.map((tier) => (
                        <TableRow key={tier.id} data-testid={`tier-row-${tier.id}`}>
                          <TableCell className="font-medium">
                            {tier.name}
                            {tier.isDefault && (
                              <Badge variant="outline" className="ml-2">Default</Badge>
                            )}
                          </TableCell>
                          <TableCell>{formatPrice(tier.priceInCents)}</TableCell>
                          <TableCell>{tier.durationDays} days</TableCell>
                          <TableCell>
                            <Badge variant={tier.isActive ? "default" : "secondary"}>
                              {tier.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {tier.features && tier.features.length > 0 ? (
                              <span className="text-sm text-muted-foreground">
                                {tier.features.length} feature(s)
                              </span>
                            ) : (
                              <span className="text-sm text-muted-foreground">None</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditTier(tier)}
                                data-testid={`button-edit-tier-${tier.id}`}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  if (confirm("Are you sure you want to delete this tier?")) {
                                    deleteTierMutation.mutate(tier.id);
                                  }
                                }}
                                data-testid={`button-delete-tier-${tier.id}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <CreditCard className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No subscription tiers yet</p>
                    <p className="text-sm">Create your first tier to get started</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="subscriptions">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>User Subscriptions</CardTitle>
                    <CardDescription>
                      View and manage active user subscriptions
                    </CardDescription>
                  </div>
                  <Button
                    onClick={() => setShowAssignDialog(true)}
                    data-testid="button-assign-subscription"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Assign Subscription
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingSubscriptions ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : subscriptionsData?.subscriptions && subscriptionsData.subscriptions.length > 0 ? (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>User</TableHead>
                          <TableHead>Tier</TableHead>
                          <TableHead>Price</TableHead>
                          <TableHead>Start Date</TableHead>
                          <TableHead>End Date</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {subscriptionsData.subscriptions.map((sub) => (
                          <TableRow key={sub.id} data-testid={`subscription-row-${sub.id}`}>
                            <TableCell>
                              <div>
                                <p className="font-medium">
                                  {sub.first_name && sub.last_name
                                    ? `${sub.first_name} ${sub.last_name}`
                                    : "Unknown User"}
                                </p>
                                <p className="text-sm text-muted-foreground">{sub.email}</p>
                              </div>
                            </TableCell>
                            <TableCell>{sub.tier_name}</TableCell>
                            <TableCell>{formatPrice(sub.price_in_cents)}</TableCell>
                            <TableCell>
                              {format(new Date(sub.start_date), "MMM d, yyyy")}
                            </TableCell>
                            <TableCell>
                              {format(new Date(sub.end_date), "MMM d, yyyy")}
                            </TableCell>
                            <TableCell>
                              <Badge variant={sub.is_active ? "default" : "secondary"}>
                                {sub.is_active ? "Active" : "Cancelled"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              {sub.is_active && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    if (confirm("Are you sure you want to cancel this subscription?")) {
                                      cancelSubscriptionMutation.mutate(sub.id);
                                    }
                                  }}
                                  data-testid={`button-cancel-subscription-${sub.id}`}
                                >
                                  <X className="h-4 w-4 text-destructive mr-2" />
                                  Cancel
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                    {subscriptionsData.pagination && subscriptionsData.pagination.totalPages > 1 && (
                      <div className="flex items-center justify-between mt-4">
                        <p className="text-sm text-muted-foreground">
                          Page {subscriptionsData.pagination.page} of{" "}
                          {subscriptionsData.pagination.totalPages}
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={page === 1}
                            onClick={() => setPage(p => p - 1)}
                            data-testid="button-prev-page"
                          >
                            Previous
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={page >= subscriptionsData.pagination.totalPages}
                            onClick={() => setPage(p => p + 1)}
                            data-testid="button-next-page"
                          >
                            Next
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No active subscriptions</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Create/Edit Tier Dialog */}
        <Dialog open={showTierDialog} onOpenChange={setShowTierDialog}>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>
                {editingTier ? "Edit Subscription Tier" : "Create Subscription Tier"}
              </DialogTitle>
              <DialogDescription>
                Configure the subscription plan details
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="tier-name">Name *</Label>
                <Input
                  id="tier-name"
                  value={tierForm.name}
                  onChange={(e) => setTierForm({ ...tierForm, name: e.target.value })}
                  placeholder="e.g., Premium Access"
                  data-testid="input-tier-name"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="tier-description">Description</Label>
                <Textarea
                  id="tier-description"
                  value={tierForm.description}
                  onChange={(e) => setTierForm({ ...tierForm, description: e.target.value })}
                  placeholder="Describe what's included in this tier"
                  data-testid="input-tier-description"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="tier-price">Price (cents) *</Label>
                  <Input
                    id="tier-price"
                    type="number"
                    value={tierForm.priceInCents}
                    onChange={(e) => setTierForm({ ...tierForm, priceInCents: e.target.value })}
                    placeholder="975"
                    data-testid="input-tier-price"
                  />
                  <p className="text-xs text-muted-foreground">
                    {tierForm.priceInCents && formatPrice(parseInt(tierForm.priceInCents))}
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="tier-duration">Duration (days) *</Label>
                  <Input
                    id="tier-duration"
                    type="number"
                    value={tierForm.durationDays}
                    onChange={(e) => setTierForm({ ...tierForm, durationDays: e.target.value })}
                    placeholder="7"
                    data-testid="input-tier-duration"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="tier-features">Features (one per line)</Label>
                <Textarea
                  id="tier-features"
                  value={tierForm.features}
                  onChange={(e) => setTierForm({ ...tierForm, features: e.target.value })}
                  placeholder="Full platform access&#10;AI legal consultation&#10;Officer search&#10;Document generation"
                  rows={5}
                  data-testid="input-tier-features"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="tier-active"
                    checked={tierForm.isActive}
                    onChange={(e) => setTierForm({ ...tierForm, isActive: e.target.checked })}
                    className="h-4 w-4"
                    data-testid="checkbox-tier-active"
                  />
                  <Label htmlFor="tier-active">Active</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="tier-default"
                    checked={tierForm.isDefault}
                    onChange={(e) => setTierForm({ ...tierForm, isDefault: e.target.checked })}
                    className="h-4 w-4"
                    data-testid="checkbox-tier-default"
                  />
                  <Label htmlFor="tier-default">Default Tier</Label>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="tier-sort">Sort Order</Label>
                <Input
                  id="tier-sort"
                  type="number"
                  value={tierForm.sortOrder}
                  onChange={(e) => setTierForm({ ...tierForm, sortOrder: e.target.value })}
                  placeholder="0"
                  data-testid="input-tier-sort"
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setShowTierDialog(false);
                  setEditingTier(null);
                  resetTierForm();
                }}
                data-testid="button-cancel-tier-dialog"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveTier}
                disabled={
                  !tierForm.name || 
                  !tierForm.priceInCents || 
                  !tierForm.durationDays ||
                  createTierMutation.isPending ||
                  updateTierMutation.isPending
                }
                data-testid="button-save-tier"
              >
                {createTierMutation.isPending || updateTierMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    {editingTier ? "Update" : "Create"} Tier
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Assign Subscription Dialog */}
        <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Assign Subscription</DialogTitle>
              <DialogDescription>
                Manually assign a subscription tier to a user
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="assign-user-id">User ID *</Label>
                <Input
                  id="assign-user-id"
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  placeholder="Enter user ID"
                  data-testid="input-assign-user-id"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="assign-tier-id">Tier ID *</Label>
                <Input
                  id="assign-tier-id"
                  value={selectedTierId}
                  onChange={(e) => setSelectedTierId(e.target.value)}
                  placeholder="Enter tier ID"
                  data-testid="input-assign-tier-id"
                />
                {tiersData?.tiers && tiersData.tiers.length > 0 && (
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>Available tiers:</p>
                    {tiersData.tiers.map(tier => (
                      <div key={tier.id} className="flex items-center justify-between">
                        <span>{tier.name}</span>
                        <code className="text-xs bg-muted px-1 py-0.5 rounded">{tier.id}</code>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setShowAssignDialog(false);
                  setSelectedUserId("");
                  setSelectedTierId("");
                }}
                data-testid="button-cancel-assign-dialog"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (selectedUserId && selectedTierId) {
                    assignSubscriptionMutation.mutate({
                      userId: selectedUserId,
                      tierId: selectedTierId,
                    });
                  }
                }}
                disabled={!selectedUserId || !selectedTierId || assignSubscriptionMutation.isPending}
                data-testid="button-assign-subscription-confirm"
              >
                {assignSubscriptionMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Assigning...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Assign
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
