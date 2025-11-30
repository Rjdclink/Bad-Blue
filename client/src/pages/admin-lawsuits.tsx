import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FileText, Calendar } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { SEOHead } from "@/components/SEOHead";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface Lawsuit {
  id: string;
  userId: string;
  plaintiffName: string;
  officerName: string;
  officerDepartment: string;
  state: string;
  city: string;
  county: string | null;
  lawsuitType: string;
  lawsuitTier: string;
  incidentDate: Date;
  description: string;
  generatedDocument: string;
  returnMailingAddress: string | null;
  createdAt: Date;
  user: User;
}

export default function AdminLawsuits() {
  const [selectedLawsuit, setSelectedLawsuit] = useState<Lawsuit | null>(null);

  const { data: lawsuits, isLoading } = useQuery<Lawsuit[]>({
    queryKey: ['/api/admin/full-service-lawsuits'],
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <SEOHead
          title="Full-Service Lawsuits - Admin Panel"
          description="Manage full-service lawsuits filed by BadBlue"
          noIndex={true}
        />
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-center h-64">
            <div className="text-muted-foreground">Loading lawsuits...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Full-Service Lawsuits - Admin Panel"
        description="Manage full-service lawsuits filed by BadBlue"
        noIndex={true}
      />

      <div className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <Link href="/">
            <Button variant="ghost" size="sm" data-testid="button-back-home">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Home
            </Button>
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Full-Service Lawsuits
              {lawsuits && <Badge variant="secondary">{lawsuits.length}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!lawsuits || lawsuits.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No full-service lawsuits found
              </div>
            ) : (
              <div className="space-y-4">
                {lawsuits.map((lawsuit) => (
                  <Card 
                    key={lawsuit.id} 
                    className="hover-elevate cursor-pointer"
                    onClick={() => setSelectedLawsuit(lawsuit)}
                    data-testid={`lawsuit-card-${lawsuit.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="font-semibold text-lg mb-1" data-testid={`text-plaintiff-${lawsuit.id}`}>
                            {lawsuit.plaintiffName || lawsuit.user.firstName + ' ' + lawsuit.user.lastName}
                          </h3>
                          <div className="space-y-1 text-sm text-muted-foreground">
                            <div>
                              <span className="font-medium">Officer:</span> {lawsuit.officerName}
                            </div>
                            <div>
                              <span className="font-medium">Department:</span> {lawsuit.officerDepartment}
                            </div>
                            <div>
                              <span className="font-medium">Location:</span> {lawsuit.city}, {lawsuit.state}
                            </div>
                            <div>
                              <span className="font-medium">Type:</span> {lawsuit.lawsuitType}
                            </div>
                          </div>
                        </div>
                        <div className="text-right space-y-2">
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Calendar className="h-4 w-4" />
                            <span data-testid={`text-date-${lawsuit.id}`}>
                              {formatDistanceToNow(new Date(lawsuit.createdAt), { addSuffix: true })}
                            </span>
                          </div>
                          <Badge variant="default">Full Service</Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Lawsuit Detail Dialog */}
      <Dialog open={!!selectedLawsuit} onOpenChange={(open) => !open && setSelectedLawsuit(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Lawsuit: {selectedLawsuit?.plaintiffName || 
                (selectedLawsuit?.user.firstName + ' ' + selectedLawsuit?.user.lastName)}
            </DialogTitle>
          </DialogHeader>
          {selectedLawsuit && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-semibold">Plaintiff:</span>{' '}
                  {selectedLawsuit.plaintiffName || 
                    (selectedLawsuit.user.firstName + ' ' + selectedLawsuit.user.lastName)}
                </div>
                <div>
                  <span className="font-semibold">Officer:</span>{' '}
                  {selectedLawsuit.officerName}
                </div>
                <div>
                  <span className="font-semibold">Department:</span>{' '}
                  {selectedLawsuit.officerDepartment}
                </div>
                <div>
                  <span className="font-semibold">Location:</span>{' '}
                  {selectedLawsuit.city}, {selectedLawsuit.state}
                </div>
                <div>
                  <span className="font-semibold">Incident Date:</span>{' '}
                  {new Date(selectedLawsuit.incidentDate).toLocaleDateString()}
                </div>
                <div>
                  <span className="font-semibold">Filed:</span>{' '}
                  {new Date(selectedLawsuit.createdAt).toLocaleDateString()}
                </div>
                {selectedLawsuit.returnMailingAddress && (
                  <div className="col-span-2">
                    <span className="font-semibold">Return Mailing Address:</span>{' '}
                    <pre className="inline whitespace-pre-wrap font-sans" data-testid="text-return-address">
                      {selectedLawsuit.returnMailingAddress}
                    </pre>
                  </div>
                )}
              </div>

              <div>
                <h3 className="font-semibold mb-2">Generated Lawsuit Document</h3>
                <Card>
                  <CardContent className="p-4">
                    <pre className="whitespace-pre-wrap font-mono text-sm">
                      {selectedLawsuit.generatedDocument || 'No document available'}
                    </pre>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
