import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileText, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { SEOHead } from "@/components/SEOHead";

interface ComplaintAdmin {
  id: string;
  officerName: string;
  officerDepartment: string;
  state: string;
  city: string;
  complaintType: string;
  incidentDate: Date;
  description: string;
  evidenceUrls: string[] | null;
  status: string;
  paymentStatus: string;
  amountPaid: number | null;
  createdAt: Date;
  submittedAt: Date | null;
  user: {
    id: string;
    username: string | null;
    email: string | null;
  };
}

export default function AdminComplaints() {
  const [selectedComplaint, setSelectedComplaint] = useState<ComplaintAdmin | null>(null);

  const { data: complaints, isLoading } = useQuery<ComplaintAdmin[]>({
    queryKey: ['/api/complaints-admin'],
  });

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive"> = {
      pending: "secondary",
      paid: "default",
      submitted: "default",
      under_review: "default",
      resolved: "default",
      closed: "secondary",
    };
    return <Badge variant={variants[status] || "secondary"}>{status}</Badge>;
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Admin: Complaints | BadBlue"
        description="Admin panel for managing complaints"
        noIndex={true}
      />

      <header className="border-b bg-card sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-6 h-6 text-primary" />
            <span className="font-semibold text-lg">Admin: Complaints</span>
          </div>
          <Link href="/home">
            <Button variant="ghost">Back to Home</Button>
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Complaint Management</h1>
          <p className="text-muted-foreground">
            View all complaints ordered by purchase date (newest first)
          </p>
        </div>

        {isLoading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p className="mt-4 text-muted-foreground">Loading complaints...</p>
          </div>
        ) : complaints && complaints.length > 0 ? (
          <div className="space-y-4">
            {complaints.map((complaint) => (
              <Card
                key={complaint.id}
                className="hover-elevate cursor-pointer transition-all"
                onClick={() => setSelectedComplaint(complaint)}
                data-testid={`card-complaint-${complaint.id}`}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-xl mb-2">
                        {complaint.user.username || complaint.user.email || "Anonymous User"}
                      </CardTitle>
                      <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                        <span>Officer: {complaint.officerName}</span>
                        <span>•</span>
                        <span>{complaint.city}, {complaint.state}</span>
                        <span>•</span>
                        <span>{complaint.officerDepartment}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {getStatusBadge(complaint.status)}
                        <Badge variant={complaint.paymentStatus === 'completed' ? 'default' : 'secondary'}>
                          {complaint.paymentStatus === 'completed' ? `Paid $${(complaint.amountPaid! / 100).toFixed(2)}` : complaint.paymentStatus}
                        </Badge>
                        <Badge variant="outline">{complaint.complaintType}</Badge>
                      </div>
                    </div>
                    <div className="text-right text-sm text-muted-foreground">
                      <div>Purchased {formatDistanceToNow(new Date(complaint.createdAt))} ago</div>
                      {complaint.submittedAt && (
                        <div className="text-xs mt-1">
                          Submitted {formatDistanceToNow(new Date(complaint.submittedAt))} ago
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
              <FileText className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-2">No Complaints Yet</h3>
              <p className="text-muted-foreground">
                No complaints have been filed yet.
              </p>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Complaint Detail Dialog */}
      <Dialog open={!!selectedComplaint} onOpenChange={(open) => !open && setSelectedComplaint(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-start justify-between">
              <DialogTitle className="text-2xl">Complaint Details</DialogTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelectedComplaint(null)}
                data-testid="button-close-dialog"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </DialogHeader>

          {selectedComplaint && (
            <div className="space-y-6">
              {/* User Information */}
              <div>
                <h3 className="font-semibold mb-2">User Information</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Username:</span>
                    <p>{selectedComplaint.user.username || "N/A"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Email:</span>
                    <p>{selectedComplaint.user.email || "N/A"}</p>
                  </div>
                </div>
              </div>

              {/* Officer Information */}
              <div>
                <h3 className="font-semibold mb-2">Officer Information</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Name:</span>
                    <p>{selectedComplaint.officerName}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Department:</span>
                    <p>{selectedComplaint.officerDepartment}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Location:</span>
                    <p>{selectedComplaint.city}, {selectedComplaint.state}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Complaint Type:</span>
                    <p className="capitalize">{selectedComplaint.complaintType.replace('-', ' ')}</p>
                  </div>
                </div>
              </div>

              {/* Incident Details */}
              <div>
                <h3 className="font-semibold mb-2">Incident Details</h3>
                <div className="text-sm mb-2">
                  <span className="text-muted-foreground">Date:</span>
                  <p>{new Date(selectedComplaint.incidentDate).toLocaleDateString()}</p>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Description:</span>
                  <p className="mt-1 whitespace-pre-wrap">{selectedComplaint.description}</p>
                </div>
              </div>

              {/* Evidence */}
              {selectedComplaint.evidenceUrls && selectedComplaint.evidenceUrls.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-2">Evidence ({selectedComplaint.evidenceUrls.length})</h3>
                  <div className="space-y-2">
                    {selectedComplaint.evidenceUrls.map((url, index) => (
                      <Button
                        key={index}
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(url, '_blank')}
                        className="w-full justify-start"
                      >
                        <FileText className="w-4 h-4 mr-2" />
                        Evidence {index + 1}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {/* Status and Payment */}
              <div>
                <h3 className="font-semibold mb-2">Status & Payment</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Status:</span>
                    <p className="mt-1">{getStatusBadge(selectedComplaint.status)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Payment:</span>
                    <p className="mt-1">
                      <Badge variant={selectedComplaint.paymentStatus === 'completed' ? 'default' : 'secondary'}>
                        {selectedComplaint.paymentStatus === 'completed' 
                          ? `Paid $${(selectedComplaint.amountPaid! / 100).toFixed(2)}` 
                          : selectedComplaint.paymentStatus}
                      </Badge>
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Created:</span>
                    <p>{new Date(selectedComplaint.createdAt).toLocaleString()}</p>
                  </div>
                  {selectedComplaint.submittedAt && (
                    <div>
                      <span className="text-muted-foreground">Submitted:</span>
                      <p>{new Date(selectedComplaint.submittedAt).toLocaleString()}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
