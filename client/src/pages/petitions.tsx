import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Users, AlertTriangle, ArrowRight, ArrowLeft } from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { PageBreadcrumbs } from "@/components/PageBreadcrumbs";
import { usePageFaqSchema } from "@/hooks/useFaqSchema";
import { HiddenFAQ } from "@/components/HiddenFAQ";

export default function Petitions() {
  const { data: petitions, isLoading } = useQuery<any[]>({
    queryKey: ['/api/petitions'],
  });

  usePageFaqSchema();

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="h-32 bg-muted animate-pulse rounded" />
          <div className="h-48 bg-muted animate-pulse rounded" />
          <div className="h-48 bg-muted animate-pulse rounded" />
        </div>
      </div>
    );
  }

  const petitionServiceSchema = {
    "@context": "https://schema.org",
    "@type": "Service",
    "name": "Officer Resignation Petition Service",
    "description": "Community-driven platform for officer resignation petitions. When officers receive multiple complaints, automatic petitions are created for community signatures calling for accountability and department review.",
    "provider": {
      "@type": "Organization",
      "name": "BadBlue"
    },
    "serviceType": "Police Accountability Petition Platform",
    "areaServed": {
      "@type": "Country",
      "name": "United States"
    }
  };

  const breadcrumbs = [
    { name: "Petitions", url: "https://example.com/petitions" }
  ];

  return (
    <div className="container mx-auto p-6">
      <SEOHead
        title="Officer Resignation Petitions | BadBlue - Police Accountability Platform"
        description="View and sign community-driven officer resignation petitions. When officers receive multiple complaints, petitions are automatically created for accountability and department review."
        keywords="police officer petition, officer resignation petition, police accountability petition, community petition police, sign petition police officer, officer complaint petition, police misconduct petition, bad cop petition, officer removal petition, police department accountability"
        canonicalUrl="https://example.com/petitions"
        structuredData={petitionServiceSchema}
        breadcrumbs={breadcrumbs}
        pageType="service"
      />
      <div className="max-w-4xl mx-auto space-y-6">
        <PageBreadcrumbs currentPageName="Petitions" />
        {/* Back Button */}
        <Link href="/">
          <Button variant="ghost" data-testid="button-back">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
        </Link>

        {/* Header */}
        <Card className="border-orange-500/20 bg-orange-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <AlertTriangle className="h-6 w-6 text-orange-500" />
              Active Officer Resignation Petitions
            </CardTitle>
            <CardDescription>
              Community-driven officer resignation petitions based on multiple complaints
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                <strong>How it works:</strong> When an officer receives 3 or more complaints within a 5-year period, 
                an automatic officer resignation petition is created calling for their resignation and department review.
              </p>
              <p>
                Anyone can sign these officer resignation petitions. When an officer resignation petition reaches significant support, it is automatically 
                sent to the officer's department.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Petitions List */}
        {!petitions || petitions.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground" data-testid="text-no-petitions">
                No active officer resignation petitions at this time.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {petitions.map((petition: any) => (
              <Card key={petition.id} className="hover-elevate" data-testid={`card-petition-${petition.id}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <CardTitle className="mb-2" data-testid={`title-officer-${petition.id}`}>
                        Officer Resignation Petition: Officer {petition.officerName}
                      </CardTitle>
                      <CardDescription data-testid={`text-department-${petition.id}`}>
                        {petition.officerDepartment}
                        {petition.officerBadge && ` • Badge #${petition.officerBadge}`}
                      </CardDescription>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Badge variant="default" className="text-base" data-testid={`badge-signatures-${petition.id}`}>
                        <Users className="h-4 w-4 mr-1" />
                        {petition.signatureCount} {petition.signatureCount === 1 ? 'Signature' : 'Signatures'}
                      </Badge>
                      <Badge variant="secondary" data-testid={`badge-status-${petition.id}`}>
                        {petition.status.toUpperCase()}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-foreground" data-testid={`text-reason-${petition.id}`}>
                    {petition.reason}
                  </p>
                  
                  {petition.complaintIds && petition.complaintIds.length > 0 && (
                    <div className="text-sm text-muted-foreground">
                      Based on {petition.complaintIds.length} filed {petition.complaintIds.length === 1 ? 'complaint' : 'complaints'}
                    </div>
                  )}

                  <Link href={`/petitions/${petition.id}`}>
                    <Button className="w-full sm:w-auto" data-testid={`button-view-petition-${petition.id}`}>
                      View & Sign Officer Resignation Petition
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Hidden FAQ for SEO - Screen reader accessible, visually hidden */}
      <HiddenFAQ path="/petitions" />
    </div>
  );
}
