import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileText, X, Mail } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { SEOHead } from "@/components/SEOHead";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface FOIARequestAdmin {
  id: string;
  userId: string;
  state: string;
  agencyType: string | null;
  agencyName: string | null;
  city: string | null;
  officerName: string;
  badgeNumber: string | null;
  incidentDate: string | null;
  requestDescription: string | null;
  departmentName: string;
  departmentAddress: string | null;
  generatedLetter: string | null;
  statuteId: string | null;
  status: string;
  paymentId: string | null;
  paymentStatus: string;
  amountPaid: number | null;
  certifiedTrackingNumber: string | null;
  mailedAt: Date | null;
  createdAt: Date;
  statusUpdatedAt: Date;
  user: {
    id: string;
    username: string | null;
    email: string | null;
  };
}

export default function AdminFOIA() {
  const [selectedRequest, setSelectedRequest] = useState<FOIARequestAdmin | null>(null);
  const [trackingNumber, setTrackingNumber] = useState("");
  const { toast } = useToast();

  const { data: requests, isLoading } = useQuery<FOIARequestAdmin[]>({
    queryKey: ['/api/foia-admin'],
  });

  const updateTrackingMutation = useMutation({
    mutationFn: async ({ id, trackingNumber }: { id: string; trackingNumber: string }) => {
      const response = await fetch(`/api/foia/${id}/tracking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ certifiedTrackingNumber: trackingNumber }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update tracking number");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/foia-admin'] });
      toast({
        title: "Tracking Number Updated",
        description: "The certified mail tracking number has been saved.",
      });
      setSelectedRequest(null);
      setTrackingNumber("");
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update tracking number.",
        variant: "destructive",
      });
    },
  });

  const handleUpdateTracking = () => {
    if (!selectedRequest || !trackingNumber.trim()) {
      toast({
        title: "Missing Information",
        description: "Please enter a tracking number.",
        variant: "destructive",
      });
      return;
    }

    updateTrackingMutation.mutate({
      id: selectedRequest.id,
      trackingNumber: trackingNumber.trim(),
    });
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive"> = {
      pending: "secondary",
      paid: "default",
      mailed: "default",
      completed: "default",
    };
    return <Badge variant={variants[status] || "secondary"}>{status}</Badge>;
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Admin: FOIA Requests | BadBlue"
        description="Admin panel for managing FOIA requests"
        noIndex={true}
      />

      <header className="border-b bg-card sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-6 h-6 text-primary" />
            <span className="font-semibold text-lg">Admin: FOIA Requests</span>
          </div>
          <Link href="/home">
            <Button variant="ghost">Back to Home</Button>
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">FOIA Request Management</h1>
          <p className="text-muted-foreground">
            View all FOIA requests and manage certified mail tracking
          </p>
        </div>

        {isLoading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p className="mt-4 text-muted-foreground">Loading FOIA requests...</p>
          </div>
        ) : requests && requests.length > 0 ? (
          <div className="space-y-4">
            {requests.map((request) => (
              <Card
                key={request.id}
                className="hover-elevate cursor-pointer transition-all"
                onClick={() => {
                  setSelectedRequest(request);
                  setTrackingNumber(request.certifiedTrackingNumber || "");
                }}
                data-testid={`card-foia-${request.id}`}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-xl mb-2">
                        {request.user.username || request.user.email || "Anonymous User"}
                      </CardTitle>
                      <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                        <span>Officer: {request.officerName}</span>
                        {request.city && (
                          <>
                            <span>•</span>
                            <span>{request.city}, {request.state}</span>
                          </>
                        )}
                        {request.departmentName && (
                          <>
                            <span>•</span>
                            <span>{request.departmentName}</span>
                          </>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {getStatusBadge(request.status)}
                        <Badge variant={request.paymentStatus === 'completed' ? 'default' : 'secondary'}>
                          {request.paymentStatus === 'completed' ? `Paid $${(request.amountPaid! / 100).toFixed(2)}` : request.paymentStatus}
                        </Badge>
                        {request.certifiedTrackingNumber && (
                          <Badge variant="outline" className="gap-1">
                            <Mail className="h-3 w-3" />
                            Tracking: {request.certifiedTrackingNumber}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-right text-sm text-muted-foreground">
                      <div>Created {formatDistanceToNow(new Date(request.createdAt))} ago</div>
                      {request.mailedAt && (
                        <div className="text-xs mt-1">
                          Mailed {formatDistanceToNow(new Date(request.mailedAt))} ago
                        </div>
                      )}
                    </div>
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-lg font-semibold mb-2">No FOIA Requests Yet</p>
              <p className="text-muted-foreground">
                FOIA requests will appear here once users start submitting them.
              </p>
            </CardContent>
          </Card>
        )}
      </main>

      {selectedRequest && (
        <Dialog open={!!selectedRequest} onOpenChange={() => setSelectedRequest(null)}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between">
                <span>FOIA Request Details</span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelectedRequest(null)}
                  data-testid="button-close-dialog"
                >
                  <X className="h-4 w-4" />
                </Button>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-6">
              {/* User Information */}
              <div>
                <h3 className="font-semibold mb-2">Requester Information</h3>
                <div className="space-y-1 text-sm">
                  <p><strong>Username:</strong> {selectedRequest.user.username || "N/A"}</p>
                  <p><strong>Email:</strong> {selectedRequest.user.email || "N/A"}</p>
                  <p><strong>User ID:</strong> {selectedRequest.user.id}</p>
                </div>
              </div>

              {/* Request Details */}
              <div>
                <h3 className="font-semibold mb-2">Request Details</h3>
                <div className="space-y-1 text-sm">
                  <p><strong>Officer:</strong> {selectedRequest.officerName}</p>
                  {selectedRequest.badgeNumber && (
                    <p><strong>Badge Number:</strong> {selectedRequest.badgeNumber}</p>
                  )}
                  {selectedRequest.incidentDate && (
                    <p><strong>Incident Date:</strong> {selectedRequest.incidentDate}</p>
                  )}
                  <p><strong>State:</strong> {selectedRequest.state}</p>
                  {selectedRequest.city && <p><strong>City:</strong> {selectedRequest.city}</p>}
                  {selectedRequest.agencyType && (
                    <p><strong>Agency Type:</strong> {selectedRequest.agencyType}</p>
                  )}
                  {selectedRequest.agencyName && (
                    <p><strong>Agency Name:</strong> {selectedRequest.agencyName}</p>
                  )}
                </div>
              </div>

              {/* Request Description */}
              {selectedRequest.requestDescription && (
                <div>
                  <h3 className="font-semibold mb-2">Records Requested</h3>
                  <p className="text-sm whitespace-pre-wrap bg-muted p-3 rounded">
                    {selectedRequest.requestDescription}
                  </p>
                </div>
              )}

              {/* Department Information */}
              <div>
                <h3 className="font-semibold mb-2">Department Information</h3>
                <div className="space-y-1 text-sm">
                  <p><strong>Department:</strong> {selectedRequest.departmentName}</p>
                  {selectedRequest.departmentAddress && (
                    <p><strong>Address:</strong></p>
                  )}
                  {selectedRequest.departmentAddress && (
                    <p className="whitespace-pre-line bg-muted p-2 rounded mt-1">
                      {selectedRequest.departmentAddress}
                    </p>
                  )}
                </div>
              </div>

              {/* Generated Letter */}
              {selectedRequest.generatedLetter && (
                <div>
                  <h3 className="font-semibold mb-2">Generated FOIA Letter</h3>
                  <div className="bg-background border rounded p-4 whitespace-pre-wrap font-mono text-xs max-h-96 overflow-y-auto">
                    {selectedRequest.generatedLetter}
                  </div>
                </div>
              )}

              {/* Payment Information */}
              <div>
                <h3 className="font-semibold mb-2">Payment Information</h3>
                <div className="space-y-1 text-sm">
                  <p><strong>Status:</strong> {selectedRequest.paymentStatus}</p>
                  {selectedRequest.amountPaid && (
                    <p><strong>Amount Paid:</strong> ${(selectedRequest.amountPaid / 100).toFixed(2)}</p>
                  )}
                  {selectedRequest.paymentId && (
                    <p><strong>Payment ID:</strong> {selectedRequest.paymentId}</p>
                  )}
                </div>
              </div>

              {/* Tracking Number Input */}
              <div className="border-t pt-4">
                <h3 className="font-semibold mb-3">Certified Mail Tracking</h3>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="tracking">USPS Certified Tracking Number</Label>
                    <Input
                      id="tracking"
                      value={trackingNumber}
                      onChange={(e) => setTrackingNumber(e.target.value)}
                      placeholder="e.g., 7012 1234 5678 9012 3456"
                      data-testid="input-tracking-number"
                    />
                  </div>
                  <Button
                    onClick={handleUpdateTracking}
                    disabled={updateTrackingMutation.isPending || !trackingNumber.trim()}
                    className="w-full"
                    data-testid="button-update-tracking"
                  >
                    {updateTrackingMutation.isPending ? "Updating..." : "Save Tracking Number"}
                  </Button>
                  {selectedRequest.mailedAt && (
                    <p className="text-sm text-muted-foreground">
                      Mailed on: {new Date(selectedRequest.mailedAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>

              {/* Timestamps */}
              <div className="text-xs text-muted-foreground space-y-1 border-t pt-4">
                <p><strong>Created:</strong> {new Date(selectedRequest.createdAt).toLocaleString()}</p>
                <p><strong>Status Updated:</strong> {new Date(selectedRequest.statusUpdatedAt).toLocaleString()}</p>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
