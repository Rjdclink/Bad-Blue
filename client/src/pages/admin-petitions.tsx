import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, ExternalLink, Copy, Mail, Edit } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { SEOHead } from "@/components/SEOHead";
import { apiRequest } from "@/lib/queryClient";

interface Petition {
  id: number;
  slug: string;
  officerName: string;
  department: string;
  city: string | null;
  county: string | null;
  state: string | null;
  signatureCount: number;
  createdAt: Date;
  updatedAt: Date | null;
}

export default function AdminPetitions() {
  const { toast } = useToast();

  const { data: petitions, isLoading } = useQuery<Petition[]>({
    queryKey: ['/api/petitions-admin'],
  });

  const copyPetitionUrl = (slug: string) => {
    const url = `${window.location.origin}/petition/${slug}`;
    navigator.clipboard.writeText(url);
    toast({
      title: "URL Copied",
      description: "Petition URL copied to clipboard",
    });
  };

  const compilePetition = async (petitionId: number) => {
    try {
      const response = await fetch(`/api/petition-compile/${petitionId}`, {
        headers: {
          'Accept': 'text/plain',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to compile petition');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = response.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') || 'petition.txt';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Success",
        description: "Petition compiled and downloaded",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to compile petition",
        variant: "destructive",
      });
    }
  };

  const exportZip = async (petitionId: number) => {
    try {
      const response = await fetch(`/api/petition-export-zip/${petitionId}`, {
        headers: {
          'Accept': 'application/zip',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to export ZIP');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = response.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') || 'petition.zip';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Success",
        description: "ZIP package downloaded successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to export ZIP",
        variant: "destructive",
      });
    }
  };

  const emailZip = async (petitionId: number) => {
    const email = window.prompt('Enter email address to send petition ZIP:');
    
    if (!email) {
      return; // User cancelled
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({
        title: "Invalid Email",
        description: "Please enter a valid email address",
        variant: "destructive",
      });
      return;
    }

    try {
      const response = await apiRequest(`/api/petition-email-zip/${petitionId}`, 'POST', { email });
      const result = await response.json();

      toast({
        title: "Success",
        description: `Petition ZIP emailed to ${email}`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to email petition ZIP",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto p-6">
          <div className="max-w-6xl mx-auto space-y-4">
            <div className="h-12 bg-muted animate-pulse rounded" />
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 bg-muted animate-pulse rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <SEOHead
        title="Officer Resignation Petition Management - Admin Panel"
        description="Manage all officer resignation petitions in the BadBlue system"
        noIndex={true}
      />
      
      <div className="min-h-screen bg-background">
        <div className="container mx-auto p-6">
          <div className="max-w-6xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h1 className="text-3xl font-bold" data-testid="title-admin-petitions">
                  Officer Resignation Petitions Folder
                </h1>
                <p className="text-muted-foreground mt-1">
                  Manage all officer resignation petition submissions
                </p>
              </div>
              <Link href="/home">
                <Button variant="outline" data-testid="button-back-home">
                  Back to Home
                </Button>
              </Link>
            </div>

            {/* Petitions List */}
            {!petitions || petitions.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-muted-foreground text-lg">No officer resignation petitions yet</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Officer resignation petitions will appear here after purchase
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {petitions.map((petition: any) => (
                  <Card key={petition.id} className="hover-elevate" data-testid={`card-petition-${petition.id}`}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-xl mb-2">
                            Officer {petition.officerName}
                          </CardTitle>
                          <div className="space-y-1 text-sm text-muted-foreground">
                            <div>{petition.department}</div>
                            <div>
                              {[petition.city, petition.county, petition.state]
                                .filter(Boolean)
                                .join(", ")}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap mt-2">
                              <Badge variant="outline" data-testid={`badge-signatures-${petition.id}`}>
                                {petition.signatureCount || 0} signatures
                              </Badge>
                              <span className="text-xs">
                                Created {formatDistanceToNow(new Date(petition.createdAt))} ago
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/petition/${petition.slug}`}>
                          <Button
                            size="sm"
                            variant="default"
                            data-testid={`button-open-${petition.id}`}
                          >
                            <ExternalLink className="h-4 w-4 mr-1" />
                            Open
                          </Button>
                        </Link>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => copyPetitionUrl(petition.slug)}
                          data-testid={`button-copy-url-${petition.id}`}
                        >
                          <Copy className="h-4 w-4 mr-1" />
                          Copy URL
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => compilePetition(petition.id)}
                          data-testid={`button-compile-${petition.id}`}
                        >
                          <FileText className="h-4 w-4 mr-1" />
                          Compile
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => exportZip(petition.id)}
                          data-testid={`button-download-zip-${petition.id}`}
                        >
                          <FileText className="h-4 w-4 mr-1" />
                          Download ZIP
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => emailZip(petition.id)}
                          data-testid={`button-email-${petition.id}`}
                        >
                          <Mail className="h-4 w-4 mr-1" />
                          Email ZIP
                        </Button>
                        <Link href={`/petition-edit/${petition.id}`}>
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`button-edit-${petition.id}`}
                          >
                            <Edit className="h-4 w-4 mr-1" />
                            Edit
                          </Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
