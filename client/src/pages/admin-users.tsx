import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  ArrowLeft, 
  Loader2, 
  Calendar,
  Users,
  Mail,
  Clock,
  UserCheck,
  Key,
  ShieldCheck,
  Edit,
  CreditCard,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { SEOHead } from "@/components/SEOHead";
import { useToast } from "@/hooks/use-toast";
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
  hasLocalCredentials: boolean;
  subscriptionStatus?: string | null;
  lastPaymentDate?: string | null;
  renewalDate?: string | null;
  squareSubscriptionId?: string | null;
}

export default function AdminUsers() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [usersPage, setUsersPage] = useState(1);

  const { data: user, isLoading: isLoadingUser } = useQuery<User>({
    queryKey: ['/api/auth/user'],
  });

  const ADMIN_BYPASS_USER_ID = 'admin-bypass';

  useEffect(() => {
    if (!isLoadingUser && (!user || user.id !== ADMIN_BYPASS_USER_ID)) {
      toast({
        title: "Access Denied",
        description: "Admin access required",
        variant: "destructive",
      });
      setLocation('/');
    }
  }, [user, isLoadingUser, setLocation, toast]);

  const { data: usersData, isLoading: isLoadingUsers } = useQuery<{
    users: UserWithServices[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>({
    queryKey: ['/api/admin/users', usersPage],
    enabled: !!user && user.id === ADMIN_BYPASS_USER_ID,
  });

  const getServiceNames = (services: PaidServices): string[] => {
    const names: string[] = [];
    if (services.complaints > 0) names.push(`Complaint${services.complaints > 1 ? 's' : ''} (${services.complaints})`);
    if (services.lawsuits > 0) names.push(`Lawsuit${services.lawsuits > 1 ? 's' : ''} (${services.lawsuits})`);
    if (services.petitions > 0) names.push(`Petition${services.petitions > 1 ? 's' : ''} (${services.petitions})`);
    if (services.foiaRequests > 0) names.push(`FOIA Request${services.foiaRequests > 1 ? 's' : ''} (${services.foiaRequests})`);
    return names;
  };

  if (isLoadingUser || !user || user.id !== ADMIN_BYPASS_USER_ID) {
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
        description="View all registered Bad Blue users with credentials and purchase history"
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

          <div className="flex items-center gap-3 mb-2">
            <Users className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">Bad Blue Users</h1>
          </div>
          <p className="text-muted-foreground">
            All registered users with credentials and purchased services, sorted newest to oldest
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  Registered Users
                </CardTitle>
                <CardDescription>
                  User credentials and purchase information
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
                      <TableHead>First Name</TableHead>
                      <TableHead>Last Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Password</TableHead>
                      <TableHead>Signed Up</TableHead>
                      <TableHead>Last Login</TableHead>
                      <TableHead>Subscription</TableHead>
                      <TableHead>Payment Date</TableHead>
                      <TableHead>Renewal Date</TableHead>
                      <TableHead>Purchased Services</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usersData.users.map((u) => (
                      <TableRow key={u.id} data-testid={`user-row-${u.id}`}>
                        <TableCell className="font-medium" data-testid={`text-firstname-${u.id}`}>
                          {u.firstName || "-"}
                        </TableCell>
                        <TableCell className="font-medium" data-testid={`text-lastname-${u.id}`}>
                          {u.lastName || "-"}
                        </TableCell>
                        <TableCell data-testid={`text-email-${u.id}`}>
                          <div className="flex items-center gap-2">
                            <Mail className="h-4 w-4 text-muted-foreground" />
                            {u.email || "No email"}
                          </div>
                        </TableCell>
                        <TableCell data-testid={`text-password-${u.id}`}>
                          {u.hasLocalCredentials ? (
                            <Badge variant="default" className="gap-1">
                              <Key className="h-3 w-3" />
                              Set
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="gap-1">
                              <Key className="h-3 w-3" />
                              None
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell data-testid={`text-signup-${u.id}`}>
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            {u.createdAt 
                              ? format(new Date(u.createdAt), "MMM d, yyyy")
                              : "Unknown"}
                          </div>
                        </TableCell>
                        <TableCell data-testid={`text-lastlogin-${u.id}`}>
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            {u.lastLoginAt 
                              ? formatDistanceToNow(new Date(u.lastLoginAt), { addSuffix: true })
                              : "Never"}
                          </div>
                        </TableCell>
                        <TableCell data-testid={`text-subscription-${u.id}`}>
                          {u.subscriptionStatus ? (
                            <Badge variant={u.subscriptionStatus === 'active' ? 'default' : 'secondary'}>
                              {u.subscriptionStatus}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">None</span>
                          )}
                        </TableCell>
                        <TableCell data-testid={`text-payment-${u.id}`}>
                          {u.lastPaymentDate ? (
                            <div className="flex items-center gap-2">
                              <CreditCard className="h-4 w-4 text-muted-foreground" />
                              {format(new Date(u.lastPaymentDate), 'MMM d, yyyy')}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </TableCell>
                        <TableCell data-testid={`text-renewal-${u.id}`}>
                          {u.renewalDate ? (
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              {format(new Date(u.renewalDate), 'MMM d, yyyy')}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </TableCell>
                        <TableCell data-testid={`text-services-${u.id}`}>
                          {u.paidServices && (u.paidServices.total || 0) > 0 ? (
                            <div className="flex flex-col gap-1">
                              {getServiceNames(u.paidServices).map((name, idx) => (
                                <span key={idx} className="text-sm">{name}</span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">None</span>
                          )}
                        </TableCell>
                        <TableCell data-testid={`actions-${u.id}`}>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => {
                              toast({
                                title: "Edit User",
                                description: `Edit subscription for ${u.firstName} ${u.lastName}`,
                              });
                            }}
                            title="Edit subscription"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
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
      </div>
    </div>
  );
}
